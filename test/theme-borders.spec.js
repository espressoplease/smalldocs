const { test, expect } = require('@playwright/test');
const contrast = require('../cli/shared/sdocs-contrast');

test.use({ serviceWorkers: 'block', colorScheme: 'light' });
const content = '# Border colours\n\n> A quotation.\n\n| Name | Value |\n|---|---|\n| Hosting | 100 |\n';
async function open(page, styles) {
  await page.goto('/docs');
  await page.waitForFunction(() => window.SDocs?._appReady);
  await page.evaluate(({ styles, content }) => {
    SDocs.loadText(SDocYaml.serializeFrontMatter({ styles }) + '\n' + content);
    SDocs.setAllSectionsOpen(true);
  }, { styles, content });
}
async function theme(page, value) {
  await page.evaluate(value => SDocs.switchThemeAndUpdate(value), value);
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
}
async function colors(page) {
  return page.evaluate(() => ({
    table: getComputedStyle(document.querySelector('#_sd_rendered td')).borderBottomColor,
    quote: getComputedStyle(document.querySelector('#_sd_rendered blockquote')).borderLeftColor,
    background: getComputedStyle(document.querySelector('#_sd_rendered')).backgroundColor,
  }));
}

test('custom borders stay visible and retain their light colours after repeated toggles', async ({ page }) => {
  const styles = { background: '#ffffff', table: { border: '#e2ddd6' }, blockquote: { borderColor: '#2563eb' } };
  await open(page, styles);
  const light = await colors(page);
  expect(light.table).toBe('rgb(226, 221, 214)');
  expect(light.quote).toBe('rgb(37, 99, 235)');
  for (let i = 0; i < 3; i++) {
    await theme(page, 'dark');
    const dark = await colors(page);
    expect(contrast.contrastRatio(dark.table, dark.background)).toBeGreaterThan(1.7);
    expect(dark.table).not.toBe(light.table);
    expect(dark.quote).not.toBe(light.quote);
    await theme(page, 'light');
    expect(await colors(page)).toEqual(light);
  }
  const saved = await page.evaluate(() => SDocs.collectStyles());
  expect(saved.table.border).toBe(styles.table.border);
  expect(saved.blockquote.borderColor).toBe(styles.blockquote.borderColor);
  expect(saved.dark).toBeUndefined();
});

test('an explicit dark border remains an author choice through save and reload', async ({ page }) => {
  const styles = { table: { border: '#e2ddd6' }, blockquote: { borderColor: '#2563eb' },
    dark: { table: { border: '#a4bcd2' }, blockquote: { borderColor: '#efbbaa' } } };
  await open(page, styles);
  await theme(page, 'dark');
  const dark = await colors(page);
  expect(dark.table).toBe('rgb(164, 188, 210)');
  expect(dark.quote).toBe('rgb(239, 187, 170)');
  const saved = await page.evaluate(() => SDocs.collectStyles());
  expect(saved.dark).toEqual(styles.dark);
  await open(page, saved);
  await theme(page, 'dark');
  expect(await colors(page)).toEqual(dark);
  await theme(page, 'light');
  expect((await colors(page)).table).toBe('rgb(226, 221, 214)');
});

test('default and explicitly default-coloured tables have the same dark border', async ({ page }) => {
  await open(page, {});
  await theme(page, 'dark');
  const defaultBorder = (await colors(page)).table;
  await open(page, { table: { border: '#e2ddd6' } });
  await theme(page, 'dark');
  expect((await colors(page)).table).toBe(defaultBorder);
});
