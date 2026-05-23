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
