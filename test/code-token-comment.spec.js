// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Token (text-selection) comments in the fullscreen viewer (Step 2b).
 *
 * In comment mode you can drag-select a phrase inside a line and comment on it
 * (e.g. a single token like `dog_count`). The phrase is stored as the comment's
 * `quote` (kind: 'token'), a precise mark is painted over it, and the card sits
 * under the line. It lives in the same document store as line/method comments,
 * so it travels with the doc.
 */

const PY = [
  'def check(dog_count):',
  '    if dog_count == 5:',
  '        return True',
  '    return False',
].join('\n');

async function openViewer(page, code) {
  await page.evaluate((code) => {
    window.SDocs.currentBody = '```python\n' + code + '\n```\n';
    window.SDocs.currentMeta = {};
    window.SDocs.render();
    window.SDocs.codeFocus.open(document.querySelector('#_sd_rendered pre'));
  }, code);
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await page.locator('.sdoc-cl-code .hljs-keyword').first().waitFor({ timeout: 5000 }).catch(() => {});
}

// Programmatically select the first occurrence of `token` within one line, then
// dispatch the mouseup the selection handler listens for.
async function selectToken(page, token) {
  await page.evaluate((token) => {
    var rows = document.querySelectorAll('.sdoc-code-focus-lines .sdoc-cl-row');
    var code = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].textContent.indexOf(token) >= 0) { code = rows[i].querySelector('.sdoc-cl-code'); break; }
    }
    var walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT, null);
    var node, hit = null;
    while ((node = walker.nextNode())) {
      var idx = node.nodeValue.indexOf(token);
      if (idx >= 0) { hit = { node: node, idx: idx }; break; }
    }
    var range = document.createRange();
    range.setStart(hit.node, hit.idx);
    range.setEnd(hit.node, hit.idx + token.length);
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    document.querySelector('.sdoc-code-focus-lines').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, token);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.SDocs && window.SDocs.codeFocus && window.SDocs.render);
});

test('select a token in the viewer, comment on it, and see a precise mark', async ({ page }) => {
  await openViewer(page, PY);
  await page.locator('.sdoc-code-focus [data-act="comment"]').click();
  await selectToken(page, 'dog_count');
  await expect(page.locator('.sdoc-cc-selbtn')).toBeVisible();
  await page.locator('.sdoc-cc-selbtn').click();
  await page.locator('.sdoc-cc-composer .sdoc-cc-input').fill('should be cat_count');
  await page.locator('.sdoc-cc-composer [data-cc="save"]').click();

  // stored as a token comment carrying the quote, in the document store
  const stored = await page.evaluate(() => (window.SDocs.currentMeta.comments || [])[0]);
  expect(stored.kind).toBe('token');
  expect(stored.quote).toBe('dog_count');

  // a precise mark is painted over the phrase, and the comment renders as a
  // full-width card BELOW the line (never inline, to avoid colliding with code)
  await expect(page.locator('.sdoc-cc-token-mark')).toHaveCount(1);
  await expect(page.locator('.sdoc-cc-token-mark').first()).toHaveText('dog_count');
  await expect(page.locator('.sdoc-cc-thread .sdoc-cc-card-body')).toHaveText('should be cat_count');
});

test('a token comment re-renders its mark after close and reopen', async ({ page }) => {
  await openViewer(page, PY);
  await page.locator('.sdoc-code-focus [data-act="comment"]').click();
  await selectToken(page, 'dog_count');
  await page.locator('.sdoc-cc-selbtn').click();
  await page.locator('.sdoc-cc-composer .sdoc-cc-input').fill('rename');
  await page.locator('.sdoc-cc-composer [data-cc="save"]').click();
  // reopen and re-enter comment mode: the mark comes back from the stored quote
  await page.evaluate(() => window.SDocs.codeFocus.close());
  await page.evaluate(() => window.SDocs.codeFocus.open(document.querySelector('#_sd_rendered pre'), { comment: true }));
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await page.locator('.sdoc-cl-code .hljs-keyword').first().waitFor({ timeout: 5000 }).catch(() => {});
  await expect(page.locator('.sdoc-cc-token-mark')).toHaveCount(1);
  await expect(page.locator('.sdoc-cc-token-mark').first()).toHaveText('dog_count');
});

test('a token comment survives a trip through prose mode and reopen', async ({ page }) => {
  await openViewer(page, PY);
  await page.locator('.sdoc-code-focus [data-act="comment"]').click();
  await selectToken(page, 'dog_count');
  await page.locator('.sdoc-cc-selbtn').click();
  await page.locator('.sdoc-cc-composer .sdoc-cc-input').fill('rename');
  await page.locator('.sdoc-cc-composer [data-cc="save"]').click();
  // close from comment mode -> the reader lands in comment mode and shows it
  await page.evaluate(() => window.SDocs.codeFocus.close());
  await expect(page.locator('body.comment-mode')).toBeVisible();
  await expect(page.locator('#_sd_rendered pre span.sdoc-anchor')).toHaveCount(1);
  // reopen the viewer -> the token comment is STILL visible (source is read clean,
  // not polluted by the card the reader injected into the <pre>).
  await page.evaluate(() => window.SDocs.codeFocus.open(document.querySelector('#_sd_rendered pre'), { comment: true }));
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  await page.locator('.sdoc-cl-code .hljs-keyword').first().waitFor({ timeout: 5000 }).catch(() => {});
  await expect(page.locator('.sdoc-code-focus .sdoc-cc-token-mark')).toHaveText('dog_count');
});

test('a token comment edits and deletes in place', async ({ page }) => {
  await openViewer(page, PY);
  await page.locator('.sdoc-code-focus [data-act="comment"]').click();
  await selectToken(page, 'dog_count');
  await page.locator('.sdoc-cc-selbtn').click();
  await page.locator('.sdoc-cc-composer .sdoc-cc-input').fill('first');
  await page.locator('.sdoc-cc-composer [data-cc="save"]').click();
  await expect(page.locator('.sdoc-cc-thread .sdoc-cc-card-body')).toHaveText('first');
  // click the card body to edit it in place
  await page.locator('.sdoc-cc-thread .sdoc-cc-card-body').click();
  await page.locator('.sdoc-cc-composer .sdoc-cc-input').fill('second');
  await page.locator('.sdoc-cc-composer [data-cc="save"]').click();
  await expect(page.locator('.sdoc-cc-thread .sdoc-cc-card-body')).toHaveText('second');
  // delete via the card's delete button; the mark goes with it
  await page.locator('.sdoc-cc-thread [data-cc="delete"]').click();
  await expect(page.locator('.sdoc-cc-thread')).toHaveCount(0);
  await expect(page.locator('.sdoc-cc-token-mark')).toHaveCount(0);
});

test('a multi-line selection does not offer the token button', async ({ page }) => {
  await openViewer(page, PY);
  await page.locator('.sdoc-code-focus [data-act="comment"]').click();
  await page.evaluate(() => {
    var rows = document.querySelectorAll('.sdoc-code-focus-lines .sdoc-cl-row');
    var c0 = rows[0].querySelector('.sdoc-cl-code');
    var c1 = rows[1].querySelector('.sdoc-cl-code');
    var range = document.createRange();
    range.setStart(c0, 0);
    range.setEnd(c1, c1.childNodes.length);
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    document.querySelector('.sdoc-code-focus-lines').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(page.locator('.sdoc-cc-selbtn')).toBeHidden();
});
