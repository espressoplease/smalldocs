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
