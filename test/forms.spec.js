// @ts-check
//
// Playwright spec for interactive ```form blocks.
//
// Exercises: render of every field type, submit with scope, multi-round
// flow with --keep-open, required validation, stale-token rejection,
// in-flight discard on external rewrite, XSS sanitisation.

const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { startBridge } = require('../cli/bin/sdocs-bridge');

const BASE = 'http://localhost:3000';

function tmpFile(name, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-forms-pw-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, body);
  return p;
}

function bridgeUrl(bridge) {
  return BASE + '/#bridge=127.0.0.1:' + bridge.port + '&token=' + encodeURIComponent(bridge.token);
}

const FORM_BODY = `# A small ask

\`\`\`form
id: demo
fields:
  - name: ready
    type: radio
    label: "Are you ready?"
    options: [Yes, "Needs more time", Push out]
    required: true
    default: Yes
  - name: notes
    type: textarea
    label: "Detailed thoughts"
    rows: 4
    default: |
      Pre-filled. Edit me.
  - name: nick
    type: text
    label: "Your name"
buttons:
  - name: send_ready
    label: "Send decision"
    scope: [ready]
  - name: send_all
    label: "Submit everything"
    final: true
\`\`\`
`;

async function waitForFormReady(page) {
  await page.waitForFunction(() => window.SDocs && window.SDocs.bridge && window.SDocs.bridge._helloed === true);
  await page.waitForSelector('.sdoc-form');
}

test('form: every field type renders with defaults', async ({ page }) => {
  const file = tmpFile('a.md', FORM_BODY);
  const bridge = await startBridge({
    files: [file], mode: 'feedback',
    noConnectTimeoutMs: 15000, reconnectGraceMs: 0, idleTimeoutMs: 0,
  });
  try {
    await page.goto(bridgeUrl(bridge));
    await waitForFormReady(page);

    // text
    await expect(page.locator('.sdoc-form-field-text input[type="text"]')).toBeVisible();
    // textarea with pre-fill
    const ta = page.locator('.sdoc-form-field-textarea textarea');
    await expect(ta).toBeVisible();
    expect(await ta.inputValue()).toContain('Pre-filled. Edit me.');
    // radio with Yes pre-selected
    const checked = page.locator('input[type="radio"][name="ready"]:checked');
    await expect(checked).toHaveValue('Yes');
  } finally {
    bridge.close();
    await bridge.awaitTerminal();
  }
});

test('form: scoped submit writes only those fields, bridge stays alive with keepOpen', async ({ page }) => {
  const file = tmpFile('s.md', FORM_BODY);
  const bridge = await startBridge({
    files: [file], mode: 'feedback', keepOpen: true,
    noConnectTimeoutMs: 15000, reconnectGraceMs: 10000, idleTimeoutMs: 0,
  });
  let terminated = false;
  bridge.awaitTerminal().then(() => { terminated = true; });
  try {
    await page.goto(bridgeUrl(bridge));
    await waitForFormReady(page);

    // Pick a different radio option and click the scoped submit.
    await page.locator('input[type="radio"][name="ready"][value="Push out"]').check();
    await page.locator('button[data-button-name="send_ready"]').click();

    await expect.poll(
      () => fs.readFileSync(file, 'utf-8'),
      { timeout: 5000 }
    ).toContain('ready: Push out');

    // Bridge MUST still be alive because --keep-open and the button is
    // not final. Give the terminal promise a beat to fire (it shouldn't).
    await page.waitForTimeout(400);
    expect(terminated).toBe(false);

    // Submissions array got an entry.
    const after = fs.readFileSync(file, 'utf-8');
    expect(after).toContain('submissions:');
    expect(after).toContain('by: send_ready');
    expect(after).toContain('scope: [ready]');
  } finally {
    bridge.close();
    await bridge.awaitTerminal();
  }
});

test('form: final button terminates the bridge with exit 0', async ({ page }) => {
  const file = tmpFile('f.md', FORM_BODY);
  const bridge = await startBridge({
    files: [file], mode: 'feedback', keepOpen: true,
    noConnectTimeoutMs: 15000, reconnectGraceMs: 5000, idleTimeoutMs: 0,
  });
  const termPromise = bridge.awaitTerminal();
  try {
    await page.goto(bridgeUrl(bridge));
    await waitForFormReady(page);

    await page.locator('button[data-button-name="send_all"]').click();
    const result = await termPromise;
    expect(result.kind).toBe('submit');
    expect(result.code).toBe(0);

    const final = fs.readFileSync(file, 'utf-8');
    expect(final).toContain('by: send_all');
  } finally {
    bridge.close();
  }
});

test('form: required field blocks submit with inline error', async ({ page }) => {
  // A form with a required text field that has no default; click the
  // scoped submit; it should refuse and surface an error.
  const body = `\`\`\`form
id: req
fields:
  - name: who
    type: text
    label: "Your name"
    required: true
buttons:
  - name: send
    label: "Send"
    scope: [who]
\`\`\`
`;
  const file = tmpFile('r.md', body);
  const bridge = await startBridge({
    files: [file], mode: 'feedback',
    noConnectTimeoutMs: 15000, reconnectGraceMs: 0, idleTimeoutMs: 0,
  });
  try {
    await page.goto(bridgeUrl(bridge));
    await waitForFormReady(page);

    await page.locator('button[data-button-name="send"]').click();
    await expect(page.locator('.sdoc-form-field-invalid .sdoc-form-error-text')).toBeVisible();
    // File should NOT have a submissions entry.
    const stillSrc = fs.readFileSync(file, 'utf-8');
    expect(stillSrc).not.toContain('submissions:');
  } finally {
    bridge.close();
    await bridge.awaitTerminal();
  }
});

test('form: multi-round — agent rewrites file, browser re-renders', async ({ page }) => {
  const file = tmpFile('mr.md', FORM_BODY);
  const bridge = await startBridge({
    files: [file], mode: 'feedback', keepOpen: true,
    noConnectTimeoutMs: 15000, reconnectGraceMs: 10000, idleTimeoutMs: 0,
  });
  try {
    await page.goto(bridgeUrl(bridge));
    await waitForFormReady(page);

    // Submit non-final once.
    await page.locator('button[data-button-name="send_ready"]').click();
    await expect.poll(
      () => fs.readFileSync(file, 'utf-8'),
      { timeout: 5000 }
    ).toContain('submissions:');

    // Now the agent rewrites the file with a new question. We install
    // a one-shot listener BEFORE the write so we can await the
    // re-render deterministically.
    await page.evaluate(() => {
      window.__formRerenderedPromise = new Promise(resolve => {
        document.addEventListener('sdocs-form-rerendered', resolve, { once: true });
      });
    });

    const newBody = `\`\`\`form
id: demo
fields:
  - name: detail
    type: textarea
    label: "Tell us more"
    rows: 3
buttons:
  - name: finish
    label: "Done"
    final: true
\`\`\`
`;
    // Atomic-ish: write to temp, rename. The bridge's watcher fires.
    const dir = path.dirname(file);
    const tmp = path.join(dir, '.tmp-rewrite');
    fs.writeFileSync(tmp, newBody);
    fs.renameSync(tmp, file);

    // Wait for the re-render to land.
    await page.evaluate(() => window.__formRerenderedPromise);

    // The new field "detail" must be visible; old "ready" must not.
    await expect(page.locator('.sdoc-form textarea[data-field-name="detail"]')).toBeVisible();
    await expect(page.locator('input[name="ready"]')).toHaveCount(0);
    await expect(page.locator('button[data-button-name="finish"]')).toBeVisible();
  } finally {
    bridge.close();
    await bridge.awaitTerminal();
  }
});

test('form: --log-file appends one JSON event per submit, onEvent fires in-process', async ({ page }) => {
  const file = tmpFile('events.md', FORM_BODY);
  const logFile = file + '.events.jsonl';
  const events = [];
  const bridge = await startBridge({
    files: [file], mode: 'feedback', keepOpen: true,
    logFile: logFile,
    onEvent: (ev) => events.push(ev),
    noConnectTimeoutMs: 15000, reconnectGraceMs: 10000, idleTimeoutMs: 0,
  });
  try {
    await page.goto(bridgeUrl(bridge));
    await waitForFormReady(page);

    // Click two non-final scoped submits.
    await page.locator('input[type="radio"][name="ready"][value="Push out"]').check();
    await page.locator('button[data-button-name="send_ready"]').click();
    await expect.poll(() => events.length, { timeout: 5000 }).toBeGreaterThanOrEqual(1);

    await page.locator('button[data-button-name="send_ready"]').click();
    await expect.poll(() => events.length, { timeout: 5000 }).toBeGreaterThanOrEqual(2);

    // In-process onEvent saw both with the right shape.
    expect(events[0].event).toBe('submit');
    expect(events[0].by).toBe('send_ready');
    expect(events[0].form_id).toBe('demo');
    expect(events[0].scope).toEqual(['ready']);
    expect(events[0].values).toEqual({ ready: 'Push out' });
    expect(events[0].final).toBe(false);
    expect(typeof events[0].at).toBe('string');

    // --log-file got both lines, each a parseable JSON object on its own line.
    const logContents = fs.readFileSync(logFile, 'utf-8');
    const lines = logContents.split('\n').filter(Boolean);
    expect(lines.length).toBe(2);
    const parsed0 = JSON.parse(lines[0]);
    expect(parsed0.event).toBe('submit');
    expect(parsed0.by).toBe('send_ready');
    expect(parsed0.values).toEqual({ ready: 'Push out' });
  } finally {
    bridge.close();
    await bridge.awaitTerminal();
  }
});

test('form: startBridge throws fast when --log-file is unwritable', async () => {
  const file = tmpFile('badlog.md', FORM_BODY);
  // A nonexistent directory means the appendFileSync probe fails.
  const badLog = '/this/path/does/not/exist/sdoc.jsonl';
  let threw = null;
  try {
    await startBridge({
      files: [file], mode: 'feedback', keepOpen: true,
      logFile: badLog,
      noConnectTimeoutMs: 15000, reconnectGraceMs: 0, idleTimeoutMs: 0,
    });
  } catch (e) {
    threw = e;
  }
  expect(threw).not.toBeNull();
  expect(threw.message).toMatch(/log-file/);
});

test('form: orphan copy button from code-block decorator is removed', async ({ page }) => {
  const file = tmpFile('nocopy.md', FORM_BODY);
  const bridge = await startBridge({
    files: [file], mode: 'feedback',
    noConnectTimeoutMs: 15000, reconnectGraceMs: 0, idleTimeoutMs: 0,
  });
  try {
    await page.goto(bridgeUrl(bridge));
    await waitForFormReady(page);
    // The .pre-wrapper that decorates code blocks must not survive next
    // to the rendered form, and neither must its .copy-btn child.
    await expect(page.locator('.sdoc-form-host .copy-btn')).toHaveCount(0);
    await expect(page.locator('.pre-wrapper:has(.sdoc-form)')).toHaveCount(0);
    // The pre-wrapper that would normally contain the form's <pre> is gone
    // entirely; no orphan wrapper next to the form host.
    const orphans = await page.evaluate(() => {
      const host = document.querySelector('.sdoc-form-host');
      if (!host) return -1;
      const sib = host.previousElementSibling;
      return sib && sib.classList && sib.classList.contains('pre-wrapper') ? 1 : 0;
    });
    expect(orphans).toBe(0);
  } finally {
    bridge.close();
    await bridge.awaitTerminal();
  }
});

test('form: new field types (checkbox, select, number, date) render and submit', async ({ page }) => {
  const body = `\`\`\`form
id: types
fields:
  - name: tags
    type: checkbox
    label: "Tags"
    options: [api, web, docs]
    default: [api, docs]
  - name: tier
    type: select
    label: "Tier"
    options: [free, pro, team]
    default: pro
  - name: head
    type: number
    label: "How many"
    min: 1
    max: 99
    default: 5
  - name: when
    type: date
    label: "Date"
    default: "2026-06-01"
buttons:
  - name: send
    label: "Send"
    final: true
\`\`\`
`;
  const file = tmpFile('types.md', body);
  const bridge = await startBridge({
    files: [file], mode: 'feedback',
    noConnectTimeoutMs: 15000, reconnectGraceMs: 0, idleTimeoutMs: 0,
  });
  const termPromise = bridge.awaitTerminal();
  try {
    await page.goto(bridgeUrl(bridge));
    await waitForFormReady(page);

    // Defaults arrive.
    await expect(page.locator('input[type="checkbox"][data-field-name="tags"][value="api"]')).toBeChecked();
    await expect(page.locator('input[type="checkbox"][data-field-name="tags"][value="docs"]')).toBeChecked();
    await expect(page.locator('input[type="checkbox"][data-field-name="tags"][value="web"]')).not.toBeChecked();
    expect(await page.locator('select[data-field-name="tier"]').inputValue()).toBe('pro');
    expect(await page.locator('input[type="number"][data-field-name="head"]').inputValue()).toBe('5');
    expect(await page.locator('input[type="date"][data-field-name="when"]').inputValue()).toBe('2026-06-01');

    // Edit and submit.
    await page.locator('input[type="checkbox"][data-field-name="tags"][value="web"]').check();
    await page.locator('select[data-field-name="tier"]').selectOption('team');
    await page.locator('input[type="number"][data-field-name="head"]').fill('12');
    await page.locator('input[type="date"][data-field-name="when"]').fill('2026-09-15');
    await page.locator('button[data-button-name="send"]').click();
    const result = await termPromise;
    expect(result.code).toBe(0);

    const after = fs.readFileSync(file, 'utf-8');
    // Checkbox array landed (DOM-iteration order, not authoring order).
    const tagsLine = after.split('\n').find(l => l.trim().startsWith('tags:'));
    expect(tagsLine).toBeTruthy();
    expect(tagsLine).toContain('api');
    expect(tagsLine).toContain('web');
    expect(tagsLine).toContain('docs');
    expect(after).toContain('tier: team');
    expect(after).toContain('head: 12');
    expect(after).toContain('when: "2026-09-15"');
  } finally {
    bridge.close();
  }
});

test('form: button with after: renders inline under that field', async ({ page }) => {
  const body = `\`\`\`form
id: place
fields:
  - name: first
    type: text
    label: "First"
    default: "alpha"
  - name: second
    type: text
    label: "Second"
buttons:
  - name: inline_one
    label: "Inline one"
    scope: [first]
    after: first
  - name: bottom_one
    label: "Bottom one"
\`\`\`
`;
  const file = tmpFile('place.md', body);
  const bridge = await startBridge({
    files: [file], mode: 'feedback', keepOpen: true,
    noConnectTimeoutMs: 15000, reconnectGraceMs: 10000, idleTimeoutMs: 0,
  });
  try {
    await page.goto(bridgeUrl(bridge));
    await waitForFormReady(page);

    // The inline button is rendered after the 'first' field, BEFORE the
    // 'second' field. Compare document positions.
    const orderOk = await page.evaluate(() => {
      const first  = document.querySelector('.sdoc-form [data-field="first"]');
      const second = document.querySelector('.sdoc-form [data-field="second"]');
      const inline = document.querySelector('.sdoc-form button[data-button-name="inline_one"]');
      const bottom = document.querySelector('.sdoc-form button[data-button-name="bottom_one"]');
      if (!first || !second || !inline || !bottom) return 'missing';
      const pos = (a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
      return (pos(first, inline) && pos(inline, second) && pos(second, bottom)) ? 'ok' : 'wrong';
    });
    expect(orderOk).toBe('ok');

    // The inline scoped submit only writes 'first'.
    await page.locator('button[data-button-name="inline_one"]').click();
    await expect.poll(
      () => fs.readFileSync(file, 'utf-8'),
      { timeout: 5000 }
    ).toContain('first: alpha');
    const after = fs.readFileSync(file, 'utf-8');
    expect(after).toContain('scope: [first]');
  } finally {
    bridge.close();
    await bridge.awaitTerminal();
  }
});

test('form: button hint text auto-generates from final/scope and accepts help override', async ({ page }) => {
  const body = `\`\`\`form
id: hints
fields:
  - name: a
    type: text
    label: "A"
buttons:
  - name: only_a
    label: "Only A"
    scope: [a]
  - name: all
    label: "All"
  - name: done
    label: "Done"
    final: true
  - name: custom
    label: "Custom"
    scope: [a]
    help: "This is the agent's own note."
\`\`\`
`;
  const file = tmpFile('hints.md', body);
  const bridge = await startBridge({
    files: [file], mode: 'feedback', keepOpen: true,
    noConnectTimeoutMs: 15000, reconnectGraceMs: 10000, idleTimeoutMs: 0,
  });
  try {
    await page.goto(bridgeUrl(bridge));
    await waitForFormReady(page);
    const hints = await page.$$eval('.sdoc-form-button-hint', els => els.map(e => e.textContent));
    expect(hints[0]).toMatch(/Sends just these answers.*a/);
    expect(hints[1]).toMatch(/Sends all answers/);
    expect(hints[2]).toMatch(/ends this session/);
    expect(hints[3]).toBe("This is the agent's own note.");
  } finally {
    bridge.close();
    await bridge.awaitTerminal();
  }
});

test('form: submit button flips to Sending then ✓ Sent on ack', async ({ page }) => {
  const file = tmpFile('states.md', FORM_BODY);
  const bridge = await startBridge({
    files: [file], mode: 'feedback', keepOpen: true,
    noConnectTimeoutMs: 15000, reconnectGraceMs: 10000, idleTimeoutMs: 0,
  });
  try {
    await page.goto(bridgeUrl(bridge));
    await waitForFormReady(page);
    const btn = page.locator('button[data-button-name="send_ready"]');
    await btn.click();
    // The "Sent" state lasts ~1200ms, so we should be able to see it.
    await expect(btn).toContainText('Sent', { timeout: 3000 });
    // After the timeout, it reverts to its label.
    await expect(btn).toContainText('Send decision', { timeout: 3000 });
  } finally {
    bridge.close();
    await bridge.awaitTerminal();
  }
});

test('form: final submit locks every field + every button', async ({ page }) => {
  const file = tmpFile('lock.md', FORM_BODY);
  const bridge = await startBridge({
    files: [file], mode: 'feedback',
    noConnectTimeoutMs: 15000, reconnectGraceMs: 0, idleTimeoutMs: 0,
  });
  const termPromise = bridge.awaitTerminal();
  try {
    await page.goto(bridgeUrl(bridge));
    await waitForFormReady(page);
    await page.locator('button[data-button-name="send_all"]').click();
    await termPromise;
    // Wait for the lock to apply (driven by the WS `submitted` round-trip).
    await expect(page.locator('.sdoc-form-locked')).toBeVisible({ timeout: 3000 });
    // Every input + textarea + button inside the form is now disabled.
    const enabledCount = await page.$$eval(
      '.sdoc-form input:not([disabled]), .sdoc-form textarea:not([disabled]), .sdoc-form select:not([disabled]), .sdoc-form button:not([disabled])',
      els => els.length
    );
    expect(enabledCount).toBe(0);
    // The "session ended" status appears.
    await expect(page.locator('.sdoc-form-ended-note')).toContainText(/Session ended/);
  } finally {
    bridge.close();
  }
});

test('form: XSS payloads in option labels are not executed', async ({ page }) => {
  const body = `\`\`\`form
id: xss
fields:
  - name: pick
    type: radio
    label: "Pick one"
    options:
      - "<script>window.__xss=true</script>"
      - "<img src=x onerror=window.__xss=true>"
      - "javascript:alert(1)"
buttons:
  - name: ok
    label: "<img src=x onerror=window.__xss=true>"
\`\`\`
`;
  const file = tmpFile('xss.md', body);
  const bridge = await startBridge({
    files: [file], mode: 'feedback',
    noConnectTimeoutMs: 15000, reconnectGraceMs: 0, idleTimeoutMs: 0,
  });
  try {
    await page.goto(bridgeUrl(bridge));
    await waitForFormReady(page);
    // Give any injected handlers a moment to misbehave.
    await page.waitForTimeout(300);
    const polluted = await page.evaluate(() => window.__xss === true);
    expect(polluted).toBe(false);
    // The option labels should appear as literal text, not parsed HTML.
    const text = await page.locator('.sdoc-form-radio-group').innerText();
    expect(text).toContain('<script>');
  } finally {
    bridge.close();
    await bridge.awaitTerminal();
  }
});
