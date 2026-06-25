// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Code viewer: the topbar menu order, and the "copy short link" action in the
 * file-info card (the same short-link generator the prose reader uses).
 */

async function openCodeFile(page) {
  await page.evaluate(() => {
    var S = window.SDocs, NL = String.fromCharCode(10);
    S.currentBody = '```python' + NL + 'def fetch():' + NL + '    return 1' + NL + '```' + NL;
    S.currentMeta = { file: 'fetch.py' };
    S.render();
    S.codeFocus.open(document.querySelector('#_sd_rendered pre'));
  });
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.SDocs && window.SDocs.codeFocus && window.SDocs.shortenCurrentDocument);
});

test('the code menu orders icons: wrap, fold, copy, comment, download | theme', async ({ page }) => {
  await openCodeFile(page);
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.sdoc-code-focus-center > *')).map(function (el) {
      return el.getAttribute('data-act') || (el.classList.contains('sdoc-code-focus-sep') ? 'sep' : el.tagName.toLowerCase());
    }));
  expect(order).toEqual(['wrap', 'foldall', 'copy', 'comment', 'download', 'sep', 'theme']);
});

test('the file-info card generates a short link into a copyable Short URL row', async ({ page }) => {
  // stub the short-link endpoint + the clipboard
  await page.evaluate(() => {
    window.__copies = [];
    navigator.clipboard.writeText = function (t) { window.__copies.push(t); return Promise.resolve(); };
    var realFetch = window.fetch.bind(window);
    window.fetch = function (url, opts) {
      if (String(url).indexOf('/api/short') >= 0) {
        return Promise.resolve(new Response(JSON.stringify({ id: 'abc123' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, opts);
    };
  });
  await openCodeFile(page);
  // intro state: a Generate button, no URL row yet (matches the prose card)
  const gen = page.locator('.sdoc-code-focus .sdoc-cf-shortbtn').first();
  await expect(gen).toBeVisible();
  await gen.click();
  // after generate: the Short URL appears in a copyable row, Generate is gone
  const urlVal = page.locator('.sdoc-code-focus .sdoc-cf-firow', { hasText: 'Short URL' }).locator('.sdoc-cf-fival');
  await expect(urlVal).toContainText('/s/abc123#k=');
  await expect(page.locator('.sdoc-code-focus .sdoc-cf-shortbtn')).toHaveCount(0);
  // clicking the row copies the URL (same affordance as the other file rows)
  await page.locator('.sdoc-code-focus .sdoc-cf-firow', { hasText: 'Short URL' }).locator('.sdoc-cf-ficopy').click();
  const copied = await page.evaluate(() => window.__copies[window.__copies.length - 1] || '');
  expect(copied).toContain('/s/abc123#k=');
});

test('clicking the link icon also generates the short link', async ({ page }) => {
  await page.evaluate(() => {
    var realFetch = window.fetch.bind(window);
    window.fetch = function (url, opts) {
      if (String(url).indexOf('/api/short') >= 0) {
        return Promise.resolve(new Response(JSON.stringify({ id: 'xyz789' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, opts);
    };
  });
  await openCodeFile(page);
  // click the link ICON (not the Generate text) - same reaction as Generate
  await page.locator('.sdoc-code-focus .sdoc-cf-shortintro .sdoc-cf-ficopy').click();
  const urlVal = page.locator('.sdoc-code-focus .sdoc-cf-firow', { hasText: 'Short URL' }).locator('.sdoc-cf-fival');
  await expect(urlVal).toContainText('/s/xyz789#k=');
});

test('path rows are tagged "Local only" with the shared-link footer note', async ({ page }) => {
  await page.evaluate(() => {
    var S = window.SDocs, NL = String.fromCharCode(10);
    S.currentBody = '```python' + NL + 'def f():' + NL + '    return 1' + NL + '```' + NL;
    S.currentMeta = { file: 'f.py' };
    S.localMeta = { fullPath: '/Users/dev/proj/src/f.py', path: 'src/f.py' };
    S.render();
    S.codeFocus.open(document.querySelector('#_sd_rendered pre'));
  });
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  // both path rows carry a "Local only" pill; filename/short-url rows do not
  await expect(page.locator('.sdoc-code-focus .sdoc-cf-localtag')).toHaveCount(2);
  await expect(page.locator('.sdoc-code-focus .sdoc-cf-privacy'))
    .toHaveText("Local only rows aren't included in shared sdocs");
});

test('a whole-file code doc shows the short-link row in the expanded viewer', async ({ page }) => {
  await page.evaluate(() => {
    var S = window.SDocs, NL = String.fromCharCode(10);
    S.currentBody = '```python' + NL + 'def f():' + NL + '    return 1' + NL + '```' + NL;
    S.currentMeta = { file: 'f.py' };
    S.render();
    S.codeFocus.open(document.querySelector('#_sd_rendered pre'));
  });
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  // the whole document IS this file, so the share affordance is meaningful
  await expect(page.locator('.sdoc-code-focus .sdoc-cf-shortintro')).toHaveCount(1);
});

test('a code block expanded from a mixed prose+code doc hides the short-link row', async ({ page }) => {
  // A short link encodes the WHOLE document, so sharing from a single block in a
  // larger article would open the whole article in reading mode, never this
  // block. The viewer must not offer the share affordance here.
  await page.evaluate(() => {
    var S = window.SDocs, NL = String.fromCharCode(10);
    S.currentBody = '# An article' + NL + NL + 'Some prose before the code.' + NL + NL
      + '```ruby' + NL + 'puts "hi"' + NL + '```' + NL + NL + 'And prose after.' + NL;
    S.currentMeta = { file: 'article.md' };
    S.localMeta = { fullPath: '/Users/dev/proj/article.md', path: 'article.md' };
    S.render();
    S.codeFocus.open(document.querySelector('#_sd_rendered pre'));
  });
  await expect(page.locator('.sdoc-code-focus')).toBeVisible();
  // no short-link row, and the local path rows + footer note follow the same gate
  await expect(page.locator('.sdoc-code-focus .sdoc-cf-shortintro')).toHaveCount(0);
  await expect(page.locator('.sdoc-code-focus .sdoc-cf-firow', { hasText: 'Short URL' })).toHaveCount(0);
  await expect(page.locator('.sdoc-code-focus .sdoc-cf-localtag')).toHaveCount(0);
  await expect(page.locator('.sdoc-code-focus .sdoc-cf-privacy')).toHaveCount(0);
});

test('a shared code file keeps its human comments through the round trip', async ({ page }) => {
  // The store mixes prose and code comment kinds; on load each must go through
  // its own sanitiser. The prose one strips a code note's line/anchorText, so
  // before the fix a shared code file arrived with its notes gone. This pins the
  // whole path: generate a real short link carrying a code comment, open it
  // fresh, and assert the note survived with its anchor and renders.
  const url = await page.evaluate(async () => {
    var S = window.SDocs, NL = String.fromCharCode(10);
    S.currentBody = '```js' + NL + 'function f() {' + NL + '  return 1;' + NL + '}' + NL + '```' + NL;
    S.currentMeta = { file: 'f.js', comments: [
      { id: 'c1', kind: 'line', block: 'pre:0', line: 1, anchorText: '  return 1;', author: 'Joshua', color: '#ffbb00', text: 'check this' },
    ] };
    S.render();
    var res = await S.generateShortLink();
    return res.url;
  });
  await page.goto(url + '&mode=comment');
  await expect(page.locator('.sdoc-code-focus')).toBeVisible({ timeout: 6000 });
  const c = await page.evaluate(() => (window.SDocs.currentMeta.comments || [])[0]);
  expect(c.kind).toBe('line');
  expect(c.line).toBe(1);
  expect(c.anchorText).toBe('  return 1;');
  expect(c.text).toBe('check this');
  await expect(page.locator('.sdoc-code-focus .sdoc-cc-card-body')).toHaveText('check this');
});

test('opening a short link to a code file lands straight in the expanded viewer', async ({ page }) => {
  // mint a REAL short link for a code-file doc via the dev server, then open it
  // fresh like a recipient would - it should auto-open the code viewer.
  const url = await page.evaluate(async () => {
    var S = window.SDocs, NL = String.fromCharCode(10);
    S.currentBody = '```python' + NL + 'def fetch():' + NL + '    return 1' + NL + '```' + NL;
    S.currentMeta = { file: 'fetch.py' };
    S.render();
    var res = await S.generateShortLink();
    return res.url;
  });
  expect(url).toContain('/s/');
  await page.goto(url);
  await expect(page.locator('.sdoc-code-focus')).toBeVisible({ timeout: 6000 });
});
