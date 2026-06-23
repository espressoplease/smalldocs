// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Agent annotations end-to-end (sdocs-code-focus.js renderAnnotations).
 *
 * An agent attaches line-anchored, markdown-rich explanations to an opened file
 * via the CLI (`sdoc app.py 22:"..."`). They arrive in the document front matter
 * (S.currentMeta.annotations), render always-on below their line, read-only, and
 * are distinct from the user's comment threads. These tests drive the data path
 * the load would: set currentMeta.annotations, open the focus view, assert DOM.
 */

const RUBY = [
  'class PriceCache',      // 1
  '  CACHE_TTL = 300',     // 2
  '',                      // 3
  '  def initialize(store:)', // 4
  '    @store = store',    // 5
  '  end',                 // 6
  '',                      // 7
  '  # Fetch a price.',    // 8
  '  def fetch(symbol)',   // 9
  '    entry = @store[symbol]', // 10
  '    return entry if entry',  // 11
  '    refresh(symbol)',   // 12
  '  end',                 // 13
  'end',                   // 14
].join('\n');

async function openWithAnnotations(page, lang, code, annotations) {
  await page.evaluate(({ lang, code, annotations }) => {
    window.SDocs.currentBody = '```' + lang + '\n' + code + '\n```\n';
    window.SDocs.currentMeta = { annotations: annotations };
    window.SDocs.render();
    var pre = document.querySelector('#_sd_rendered pre');
    window.SDocs.codeFocus.open(pre);
  }, { lang, code, annotations });
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  // Let the one-shot highlight upgrade (a row rebuild) settle so annotations
  // re-render against the final rows.
  await page.locator('.sdoc-cl-code .hljs-keyword').first().waitFor({ timeout: 2000 }).catch(() => {});
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.SDocs && window.SDocs.codeFocus && window.SDocs.render);
});

test('an annotation renders below the line it names (1-based -> 0-based)', async ({ page }) => {
  await openWithAnnotations(page, 'ruby', RUBY, [{ line: 2, endLine: 2, text: '**bold** note' }]);
  const row = page.locator('.sdoc-ann-row[data-ln="1"]');
  await expect(row).toHaveCount(1);
  await expect(row.locator('.sdoc-ann-card strong')).toHaveText('bold');
  // The marked line is the one the reader sees as line 2.
  await expect(page.locator('.sdoc-cl-row[data-ln="1"] .sdoc-cl-num')).toHaveText('2');
  await expect(page.locator('.sdoc-cl-row[data-ln="1"].sdoc-ann-marked')).toHaveCount(1);
});

test('annotations show without entering comment mode', async ({ page }) => {
  await openWithAnnotations(page, 'ruby', RUBY, [{ line: 1, endLine: 1, text: 'top of file' }]);
  await expect(page.locator('.sdoc-code-focus.sdoc-cc-on')).toHaveCount(0);
  await expect(page.locator('.sdoc-ann-card')).toBeVisible();
});

test('a range annotation stripes every covered line and anchors to the first', async ({ page }) => {
  await openWithAnnotations(page, 'ruby', RUBY, [{ line: 4, endLine: 6, text: 'the initializer' }]);
  await expect(page.locator('.sdoc-cl-row.sdoc-ann-marked')).toHaveCount(3); // lines 4,5,6
  await expect(page.locator('.sdoc-ann-row[data-ln="3"]')).toHaveCount(1);   // anchored to line 4
});

test('annotation markdown is sanitised', async ({ page }) => {
  await openWithAnnotations(page, 'ruby', RUBY, [{
    line: 1, endLine: 1,
    text: 'bad <script>window.__pwned=1</script> [x](javascript:alert(1)) <img src=x onerror="window.__pwned=1">',
  }]);
  await expect(page.locator('.sdoc-ann-card')).toBeVisible();
  await expect(page.locator('.sdoc-ann-card script')).toHaveCount(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  const imgs = page.locator('.sdoc-ann-card img');
  if (await imgs.count()) await expect(imgs.first()).not.toHaveAttribute('onerror', /.*/);
  const links = page.locator('.sdoc-ann-card a');
  if (await links.count()) {
    const href = await links.first().getAttribute('href');
    expect(href === null || !/^javascript:/i.test(href)).toBeTruthy();
  }
});

test('an annotation hides when its method folds', async ({ page }) => {
  // line 10 is inside fetch (def at line 9 -> data-ln 8); the card anchors at data-ln 9.
  await openWithAnnotations(page, 'ruby', RUBY, [{ line: 10, endLine: 10, text: 'the cache lookup' }]);
  const ann = page.locator('.sdoc-ann-row[data-ln="9"]');
  await expect(ann).toBeVisible();
  await page.locator('.sdoc-cl-row[data-ln="8"] .sdoc-cl-fold').click();
  await expect(ann).toBeHidden();
});

test('caps the number of annotations rendered', async ({ page }) => {
  const lines = [];
  for (let i = 0; i < 320; i++) lines.push('x' + i + ' = ' + i);
  const anns = [];
  for (let i = 1; i <= 320; i++) anns.push({ line: i, endLine: i, text: 'note ' + i });
  await openWithAnnotations(page, 'python', lines.join('\n'), anns);
  expect(await page.locator('.sdoc-ann-card').count()).toBe(300);
});
