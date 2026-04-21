// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

async function loadMd(page, md) {
  await page.goto(BASE);
  await page.waitForSelector('#_sd_rendered');
  await page.evaluate((m) => window.SDocs.loadText(m, 'math.md'), md);
  // Give KaTeX time to lazy-load from CDN. An element is "settled" once it
  // has either a .katex child (success) or a .katex-error child (render
  // failure with throwOnError: false).
  await page.waitForFunction(() => {
    const n = document.querySelectorAll('#_sd_rendered .sdocs-math-display, #_sd_rendered .sdocs-math-inline');
    if (!n.length) return true;
    return Array.from(n).every(el => el.querySelector('.katex, .katex-error'));
  }, { timeout: 10000 });
}

test('renders $$...$$ as KaTeX display math', async ({ page }) => {
  await loadMd(page, '# t\n\n$$E = mc^2$$\n');
  const html = await page.locator('#_sd_rendered').innerHTML();
  expect(html).toContain('sdocs-math-display');
  expect(html).toContain('katex-display');
});

test('renders $...$ as KaTeX inline math', async ({ page }) => {
  await loadMd(page, '# t\n\nThe value $a_1 + b_2$ goes here.\n');
  const inline = page.locator('#_sd_rendered .sdocs-math-inline');
  await expect(inline).toHaveCount(1);
  await expect(inline.locator('.katex')).toHaveCount(1);
});

test('underscores inside math do not get eaten by italic parsing', async ({ page }) => {
  await loadMd(page, '# t\n\nSee $U_{env}(\\mathbf{x}_{env})$ in the text.\n');
  // Surrounding paragraph should have no <em> introduced by underscore runs
  // inside the math. And the math should contain subscripts (msupsub class).
  const p = page.locator('#_sd_rendered p').first();
  const hasEm = await p.locator('em').count();
  expect(hasEm).toBe(0);
  const subs = await page.locator('#_sd_rendered .sdocs-math-inline .msupsub').count();
  expect(subs).toBeGreaterThan(0);
});

test('currency-style $5 / $10 is not treated as math', async ({ page }) => {
  await loadMd(page, '# t\n\nHe paid $5 and $10 for lunch.\n');
  const mathCount = await page.locator('#_sd_rendered .sdocs-math-inline, #_sd_rendered .sdocs-math-display').count();
  expect(mathCount).toBe(0);
});

test('inline code with dollars stays a code span', async ({ page }) => {
  await loadMd(page, '# t\n\nRun `$foo$` from your shell.\n');
  const html = await page.locator('#_sd_rendered').innerHTML();
  expect(html).toContain('<code>$foo$</code>');
  const mathCount = await page.locator('#_sd_rendered .sdocs-math-inline').count();
  expect(mathCount).toBe(0);
});

test('$$ inside a code span in prose does not open a display block', async ({ page }) => {
  // Regression: a paragraph containing `$$...$$` in backticks, followed
  // later by a real $$...$$ block, used to greedily eat the prose in
  // between. Block opener must only fire at the start of a line.
  const md = '# t\n\nWrite math between `$...$` or `$$...$$` delimiters.\n\n$$\ny = x^2\n$$\n\nDone.\n';
  await loadMd(page, md);
  // Exactly one display block (the real one), and the code span survived.
  const displays = await page.locator('#_sd_rendered .sdocs-math-display').count();
  expect(displays).toBe(1);
  const html = await page.locator('#_sd_rendered').innerHTML();
  expect(html).toContain('<code>$$...$$</code>');
});

test('invalid LaTeX renders with error style, does not crash', async ({ page }) => {
  await loadMd(page, '# t\n\n$$\\frac{1}{$$\n');
  // Rendered with throwOnError: false, so KaTeX emits a .katex-error span
  const errors = await page.locator('#_sd_rendered .katex-error').count();
  expect(errors).toBeGreaterThan(0);
});

test('write-mode round-trip preserves $$ and $ delimiters', async ({ page }) => {
  const orig = '# t\n\nInline: $E = mc^2$ here.\n\n$$\na^2 + b^2 = c^2\n$$\n\nEnd.\n';
  await loadMd(page, orig);
  await page.evaluate(() => window.SDocs.setMode('write'));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.SDocs.setMode('read'));
  await page.waitForTimeout(200);
  const body = await page.evaluate(() => window.SDocs.currentBody);
  expect(body).toContain('$E = mc^2$');
  expect(body).toContain('$$\na^2 + b^2 = c^2\n$$');
});

test('math renders even when doc has a heading with id="exports"', async ({ page }) => {
  // Regression: HTML's named-access-on-Window rule populates window.exports
  // with any element that has id="exports". KaTeX's UMD wrapper sees
  // typeof exports === 'object' and assigns exports.katex instead of
  // window.katex, so lazy load never completes. loadKatex() must shadow
  // the global during script load.
  const md = '# t\n\n## Exports\n\nSome content.\n\n$$\nx = y^2\n$$\n';
  await loadMd(page, md);
  // The exports heading element must exist (otherwise this test is moot)
  const exportsEl = await page.locator('#exports').count();
  expect(exportsEl).toBe(1);
  // And the math must have rendered.
  const katex = await page.locator('#_sd_rendered .sdocs-math-display .katex-display').count();
  expect(katex).toBe(1);
});

test('CSP allows jsdelivr for style and font', async ({ page }) => {
  const response = await page.goto(BASE);
  const csp = response && response.headers()['content-security-policy'];
  expect(csp).toContain('style-src');
  expect(csp).toMatch(/style-src[^;]+cdn\.jsdelivr\.net/);
  expect(csp).toMatch(/font-src[^;]+cdn\.jsdelivr\.net/);
});
