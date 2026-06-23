// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Reader-side indicator for code-viewer comments (Step 2a).
 *
 * Code comments live in the document and are read/edited in the fullscreen
 * viewer. Before this, a comment made in the viewer was invisible once you left
 * it. Now a code block that carries code comments shows a dot indicator in the
 * reader; clicking it opens the viewer straight into comment mode so the notes
 * are visible. The indicator is block-scoped (pre:N) and reflects the document.
 */

const RUBY = ['class A', '  def run', '    1', '  end', 'end'].join('\n');

async function renderDoc(page, body, meta) {
  await page.evaluate(({ body, meta }) => {
    window.SDocs.currentBody = body;
    window.SDocs.currentMeta = meta || {};
    window.SDocs.render();
  }, { body, meta });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.SDocs && window.SDocs.render && window.SDocs.codeFocus);
});

test('a code block with no comments shows no indicator', async ({ page }) => {
  await renderDoc(page, '```ruby\n' + RUBY + '\n```\n', {});
  await expect(page.locator('#_sd_rendered .pre-wrapper .code-comment-btn')).toHaveCount(0);
});

test('a code block with comments shows an indicator that opens the viewer in comment mode', async ({ page }) => {
  await renderDoc(page, '```ruby\n' + RUBY + '\n```\n', {
    codeComments: [
      { id: 'c1', kind: 'line', block: 'pre:0', line: 1, anchorText: 'def run', text: 'rename this', author: 'u', color: '#ffbb00' },
    ],
  });
  const btn = page.locator('#_sd_rendered .pre-wrapper .code-comment-btn');
  await expect(btn).toHaveCount(1);
  await btn.click();
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await expect(page.locator('.sdoc-code-focus.sdoc-cc-on')).toBeVisible();
  await expect(page.locator('.sdoc-cc-thread[data-ln="1"] .sdoc-cc-card-body')).toHaveText('rename this');
});

test('a comment made in the viewer surfaces as a reader indicator after closing', async ({ page }) => {
  await renderDoc(page, '```ruby\n' + RUBY + '\n```\n', {});
  await expect(page.locator('#_sd_rendered .pre-wrapper .code-comment-btn')).toHaveCount(0);
  // open the block in the viewer, enter comment mode, add a line note
  await page.evaluate(() => window.SDocs.codeFocus.open(document.querySelector('#_sd_rendered pre')));
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await page.locator('.sdoc-cl-code .hljs-keyword').first().waitFor({ timeout: 5000 }).catch(() => {});
  await page.locator('.sdoc-code-focus [data-act="comment"]').click();
  await page.locator('.sdoc-cl-row[data-ln="1"] .sdoc-cl-code').hover();
  await page.locator('.sdoc-cl-row[data-ln="1"] .sdoc-cc-add').click();
  await page.locator('.sdoc-cc-composer .sdoc-cc-input').fill('from the viewer');
  await page.locator('.sdoc-cc-composer [data-cc="save"]').click();
  await page.evaluate(() => window.SDocs.codeFocus.close());
  // the reader now carries the indicator for that block
  await expect(page.locator('#_sd_rendered .pre-wrapper .code-comment-btn')).toHaveCount(1);
});

test('the indicator is block-scoped in a multi-block document', async ({ page }) => {
  await renderDoc(page, '```ruby\nputs 1\n```\n\n```ruby\nputs 2\n```\n', {
    codeComments: [
      { id: 'c1', kind: 'line', block: 'pre:1', line: 0, anchorText: 'puts 2', text: 'second block note', author: 'u', color: '#ffbb00' },
    ],
  });
  const wrappers = page.locator('#_sd_rendered .pre-wrapper');
  await expect(wrappers).toHaveCount(2);
  await expect(wrappers.nth(0).locator('.code-comment-btn')).toHaveCount(0);
  await expect(wrappers.nth(1).locator('.code-comment-btn')).toHaveCount(1);
});
