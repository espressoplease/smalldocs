const { test, expect } = require('@playwright/test');
const tasks = require('../public/sdocs-tasks');
const marked = require('../public/vendor/marked.min');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startBridge } = require('../cli/bin/sdocs-bridge');

test.use({ serviceWorkers: 'block' });

test('task source positions preserve nested lists, quotes, CRLF and code examples', () => {
  const markdown = [
    '```md', '- [ ] Same task', '```', '',
    '    - [ ] Same task', '',
    '<div>', '- [ ] Same task', '</div>', '',
    '- [ ] Same task', '  - [X] Nested task', '- [ ] Same task', '',
    '> - [ ] Quoted task', '>   - [ ] Nested quote', '',
    '1. [ ] Loose task', '', '   A paragraph.', '', '   - [ ] Loose child', '',
  ].join('\r\n');
  const positions = tasks.taskPositions(markdown, marked);
  expect(positions.map(position => markdown.slice(position - 3).split('\r\n')[0]))
    .toEqual(['- [ ] Same task', '- [X] Nested task', '- [ ] Same task',
      '- [ ] Quoted task', '- [ ] Nested quote', '. [ ] Loose task', '- [ ] Loose child']);
});

async function load(page, markdown) {
  await page.goto('/docs');
  await page.evaluate(markdown => window.SDocs.loadText(markdown, 'tasks.md'), markdown);
}

test('tasks update source and raw state, keep focus, and survive a URL reload', async ({ page }) => {
  const markdown = '# Tasks\n\n- [ ] First **task**\n- [x] Second task\n';
  await load(page, markdown);
  const first = page.getByRole('checkbox', { name: 'First task', exact: true });
  const second = page.getByRole('checkbox', { name: 'Second task', exact: true });
  await first.focus();
  await page.keyboard.press('Space');
  await expect(first).toBeChecked();
  await expect(first).toBeFocused();
  await second.uncheck();
  const expected = markdown.replace('[ ] First', '[x] First').replace('[x] Second', '[ ] Second');
  expect(await page.evaluate(() => window.SDocs.currentBody)).toBe(expected);
  await expect(page.locator('#_sd_raw')).toHaveValue(new RegExp('\\[x\\] First'));
  await expect.poll(() => new URL(page.url()).hash).toContain('md=');
  await page.reload();
  await expect(first).toBeChecked();
  await expect(second).not.toBeChecked();
});

test('task updates target the exact item and preserve comments and short-link staleness', async ({ page }) => {
  const markdown = '# Tasks\n\n```md\n- [ ] Same\n```\n\n<input type="checkbox" disabled>\n\n- [ ] Same\n  - [ ] Same\n- [ ] Same\n';
  await load(page, markdown);
  await page.evaluate(() => {
    const S = window.SDocs;
    S.currentMeta.comments = [{ id: 'c1', kind: 'block', text: 'Keep this note', block: 0, color: '#7c6aef' }];
    S.shortUrl = 'https://smalldocs.org/s/old';
    S.shortLinkId = 'old';
    S.shortLinkSnapshot = 'old snapshot';
    S.setMode('comment');
  });
  const inputs = page.locator('#_sd_rendered input[data-sdoc-task]');
  await inputs.nth(1).check();
  expect(await page.evaluate(() => window.SDocs.currentBody))
    .toBe(markdown.replace('  - [ ] Same', '  - [x] Same'));
  expect(await page.evaluate(() => window.SDocs.currentMeta.comments[0].text)).toBe('Keep this note');
  expect(await page.evaluate(() => window.SDocs.shortUrl)).toBeNull();
  await expect(page.locator('#_sd_rendered input:not([data-sdoc-task])')).toBeDisabled();
  await inputs.nth(2).check();
  await expect(inputs.nth(0)).not.toBeChecked();
});

test('write-mode checkboxes stay interactive and preserve ordinary parent lists', async ({ page }) => {
  await load(page, '# Tasks\n\n- Parent\n  - [ ] Nested task\n');
  await page.evaluate(() => window.SDocs.setMode('write'));
  const input = page.locator('#_sd_write input[type="checkbox"]');
  await input.check();
  await expect.poll(() => page.evaluate(() => window.SDocs.currentBody)).toContain('- [x] Nested task');
  await page.evaluate(() => window.SDocs.setMode('read'));
  expect(await page.evaluate(() => window.SDocs.currentBody)).toContain('- Parent\n  - [x] Nested task');
  await expect(page.locator('#_sd_rendered input[data-sdoc-task]')).toHaveCount(1);
  await expect(page.locator('#_sd_rendered input[data-sdoc-task]')).toBeChecked();
});

test('task clicks save to a live local file and survive reopening it', async ({ page }) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-task-list-'));
  const file = path.join(directory, 'tasks.md');
  fs.writeFileSync(file, '# Local tasks\n\n- [ ] Finish reading\n');
  const bridge = await startBridge({ files: [file], mode: 'open',
    noConnectTimeoutMs: 15000, reconnectGraceMs: 5000, idleTimeoutMs: 0 });
  try {
    await page.goto('/docs#bridge=127.0.0.1:' + bridge.port + '&token=' + encodeURIComponent(bridge.token));
    const input = page.getByRole('checkbox', { name: 'Finish reading', exact: true });
    await expect(input).toBeEnabled();
    await input.check();
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('- [x] Finish reading');
    await page.reload();
    await expect(input).toBeChecked();
  } finally {
    bridge.close();
    await bridge.awaitTerminal();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Cloud task changes save through revisions and reload from the saved Markdown', async ({ page }) => {
  let markdown = '# Cloud tasks\n\n- [ ] Read the chapter\n- [ ] Write notes\n';
  const saves = [];
  let revision = 1;
  let failSave = false;
  await page.route('**/api/cloud/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/revisions')) {
      if (failSave) return route.fulfill({ status: 503, json: { ok: false, error: 'unavailable' } });
      const body = route.request().postDataJSON();
      saves.push(body);
      markdown = body.markdown;
      revision++;
      return route.fulfill({ json: { ok: true, document: {
        id: 'task-doc', markdown, filename: 'tasks.md', current_revision_id: 'rev-' + revision,
      } } });
    }
    if (path === '/api/cloud/v1/documents/task-doc') return route.fulfill({ json: {
      ok: true, document: { id: 'task-doc', markdown, filename: 'tasks.md', current_revision_id: 'rev-' + revision },
      permission: { can_edit: true },
    } });
    return route.fulfill({ status: 401, json: { ok: false, error: 'login_required' } });
  });
  async function openCloudCopy() {
    await page.goto('/docs');
    await page.evaluate(() => {
      window.SDocs.Sources._reset();
      history.replaceState(null, '', '/docs?cloud-document=task-doc');
    });
    await page.addScriptTag({ url: '/public/sdocs-cloud-account-selection.js' });
    await page.addScriptTag({ url: '/public/sdocs-cloud-prototype.js' });
    await page.evaluate(() => window.SDocs.Sources.select().load());
  }
  await openCloudCopy();
  await page.getByRole('checkbox', { name: 'Read the chapter', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Write notes', exact: true }).check();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].target_revision_id).toBe('rev-1');
  expect(saves[0].markdown).toContain('- [x] Read the chapter\n- [x] Write notes');
  await expect(page.locator('#_sd_status-text')).toHaveText('Saved to Cloud.');
  await openCloudCopy();
  await expect(page.getByRole('checkbox', { name: 'Read the chapter', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Write notes', exact: true })).toBeChecked();
  failSave = true;
  await page.getByRole('checkbox', { name: 'Write notes', exact: true }).uncheck();
  await expect(page.locator('#_sd_status-text')).toHaveText('Changes were not saved to Cloud.');
  expect(await page.evaluate(() => window.SDocs.currentBody)).toContain('- [ ] Write notes');
  expect(markdown).toContain('- [x] Write notes');
  failSave = false;
  await page.evaluate(() => window.SDocs.saveCloudNow());
  expect(markdown).toContain('- [ ] Write notes');
});
