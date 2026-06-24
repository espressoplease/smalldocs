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

test('the file-info card mints and copies a short link', async ({ page }) => {
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
  const btn = page.locator('.sdoc-code-focus .sdoc-cf-shorten');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(async () => {
    const copied = await page.evaluate(() => window.__copies[window.__copies.length - 1] || '');
    expect(copied).toContain('/s/abc123#k=');
  }).toPass({ timeout: 4000 });
  // brief "Copied link" confirmation on the button
  await expect(btn).toContainText('Copied link');
});
