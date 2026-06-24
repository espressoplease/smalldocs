// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Cross-surface comment parity (one store rendered in both surfaces).
 *
 * U3: a prose inline comment made on code text in the reader also shows in the
 * fullscreen viewer (read-only there - edited back in the reader).
 */

const DOC = '```ruby\nclass A\n  def run\n    1\n  end\nend\n```\n';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.SDocs && window.SDocs.codeFocus && window.SDocComments);
});

test('a prose inline comment on code shows in the viewer (read-only)', async ({ page }) => {
  await page.evaluate((body) => {
    var S = window.SDocs, SDC = window.SDocComments;
    S.currentBody = body;
    S.currentMeta = {};
    S.render();
    var res = SDC.addSelectionComment(S.currentMeta,
      { quote: 'def run', prefix: '', suffix: '', block: 'pre:0' },
      { text: 'rename run', author: 'u', color: '#ffbb00' });
    S.currentMeta = res.meta;
    S.render();
    S.codeFocus.open(document.querySelector('#_sd_rendered pre'), { comment: true });
  }, DOC);
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  // the prose comment appears as a foreign (read-only) card with its text...
  await expect(page.locator('.sdoc-code-focus .sdoc-cc-thread.sdoc-cc-foreign .sdoc-cc-card-body'))
    .toHaveText('rename run');
  // ...a precise mark over the quoted phrase...
  await expect(page.locator('.sdoc-code-focus .sdoc-cc-token-mark')).toHaveText('def run');
  // ...and no delete affordance (it is edited back in the reader).
  await expect(page.locator('.sdoc-cc-thread.sdoc-cc-foreign [data-cc="delete"]')).toHaveCount(0);
});

test('a code comment shows in the reader (read-only) in comment mode', async ({ page }) => {
  await page.evaluate((body) => {
    var S = window.SDocs;
    S.currentBody = body;
    S.currentMeta = { comments: [
      { id: 'c1', kind: 'token', block: 'pre:0', line: 1, quote: 'def run', anchorText: '  def run', text: 'rename run', author: 'u', color: '#ffbb00' },
    ] };
    S.render();
    S.setMode('comment');
  }, DOC);
  // the code comment is anchored on the code block in the reader, with its card
  await expect(page.locator('#_sd_rendered pre span.sdoc-anchor[data-c="c1"]')).toHaveText('def run');
  await expect(page.locator('#_sd_rendered .sdoc-card[data-c="c1"]')).toContainText('rename run');
  // read-only foreign card: no delete affordance (edited in the viewer)
  await expect(page.locator('.sdoc-card[data-c="c1"].sdoc-card-foreign .sdoc-card-delete')).toHaveCount(0);
});
