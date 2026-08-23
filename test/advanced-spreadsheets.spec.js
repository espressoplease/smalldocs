// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');

const BASE = 'http://localhost:3000';

async function loadDemo(page) {
  await page.goto(BASE + '/advanced-spreadsheets');
  await page.waitForSelector('.sdoc-cells-pane', { state: 'attached' });
  await page.locator('#_sd_btn-fold').click();
  await expect(page.locator('.sdoc-cells-pane').first()).toBeVisible();
}

async function loadedCellsFeatures(page) {
  return page.evaluate(() => performance.getEntriesByType('resource')
    .map((entry) => new URL(entry.name).pathname)
    .filter((pathname) => /sdocs-cells-(xlsx|focus|edit)\.js$/.test(pathname)));
}

test('advanced spreadsheet product update renders the linked, formula, and editing demonstrations', async ({ page }) => {
  await loadDemo(page);

  await expect(page.getByRole('heading', { name: 'New things you can do' })).toBeVisible();
  await expect(page.locator('#_sd_rendered h3')).toHaveText([
    'Connect several sheets into one model',
    'Use deeper formulas and keep them useful in Excel',
    'Edit sheets fullscreen',
  ]);
  await expect(page.getByRole('heading', { name: 'Prompts to try with an agent' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Loaded when you need it' })).toBeVisible();
  await expect(page.locator('#_sd_rendered blockquote')).toHaveCount(3);
  await expect(page.locator('#_sd_rendered')).toContainText('Turn this analysis into an editable decision model with clear assumptions and scenarios.');
  await expect(page.locator('#_sd_rendered')).toContainText('run sdoc cells verify');

  const panes = page.locator('.sdoc-cells-pane');
  await expect(panes).toHaveCount(2);
  await expect(panes.nth(0).locator('.sdoc-cells-pane-tab')).toHaveText([
    'Assumptions', 'Sales', 'Model', 'Dashboard',
  ]);
  await expect(panes.nth(1).locator('.sdoc-cells-pane-tab')).toHaveText([
    'Quoted sheet?', 'Formula Lab',
  ]);

  await panes.nth(0).locator('.sdoc-cells-pane-tab', { hasText: 'Dashboard' }).click();
  await expect(panes.nth(0).locator('.sdoc-cells-pane-body')).toContainText('391,500');
  await expect(panes.nth(0).locator('.sdoc-cells-pane-body')).toContainText('147,750');
  await expect(panes.nth(0).locator('.sdoc-cells-pane-body')).toContainText('2030 revenue: 573195');

  await panes.nth(1).locator('.sdoc-cells-pane-tab', { hasText: 'Formula Lab' }).click();
  await expect(panes.nth(1).locator('.sdoc-cells-pane-body')).toContainText('Recovered');
  await expect(panes.nth(1).locator('.sdoc-cells-pane-body')).toContainText('ABC-123');

  const editing = page.locator('.sdoc-cells', { has: page.locator('.sdoc-cells-caption', { hasText: 'Editing playground' }) });
  await expect(editing).toContainText('24,000');
});

test('deep editing and Excel export load only when requested', async ({ page }) => {
  await loadDemo(page);
  await expect.poll(() => loadedCellsFeatures(page)).toEqual([]);

  await page.locator('.sdoc-cells-pane').first().locator('.sdoc-cells-expand:visible').click();
  await expect(page.locator('.sdoc-cells-focus')).toBeVisible();
  await expect.poll(() => loadedCellsFeatures(page)).toEqual([
    '/public/sdocs-cells-edit.js',
    '/public/sdocs-cells-focus.js',
  ]);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.sdoc-cells-focus-dl').click(),
  ]);
  expect(await download.path()).toBeTruthy();
  await expect.poll(() => loadedCellsFeatures(page)).toEqual([
    '/public/sdocs-cells-edit.js',
    '/public/sdocs-cells-focus.js',
    '/public/sdocs-cells-xlsx.js',
  ]);
  const featureVersions = await page.evaluate(() => {
    const urls = performance.getEntriesByType('resource').map((entry) => new URL(entry.name));
    const ui = urls.find((url) => url.pathname.endsWith('/sdocs-cells-ui.js'));
    return {
      ui: ui && ui.searchParams.get('v'),
      lazy: urls.filter((url) => /sdocs-cells-(xlsx|focus|edit)\.js$/.test(url.pathname))
        .map((url) => url.searchParams.get('v')),
    };
  });
  expect(featureVersions.ui).toBeTruthy();
  expect(featureVersions.lazy).toEqual([
    featureVersions.ui,
    featureVersions.ui,
    featureVersions.ui,
  ]);
});

test('forecast demonstration downloads four linked Excel sheets', async ({ page }) => {
  await loadDemo(page);
  const forecast = page.locator('.sdoc-cells-pane').first();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    forecast.locator('.sdoc-cells-xlsx:visible').click(),
  ]);
  const xml = fs.readFileSync(await download.path()).toString('latin1');
  expect(xml).toContain('xl/worksheets/sheet4.xml');
  expect(xml).toContain('name="Assumptions"');
  expect(xml).toContain('name="Dashboard"');
  expect(xml).toContain('<f>Sales!E8</f>');
  expect(xml).toContain('<f>SUMIF(Sales!A2:A7,&quot;North&quot;,Sales!E2:E7)</f>');
  expect(xml).toContain('<f>_xlfn.XLOOKUP(&quot;Platform&quot;,Sales!B2:B7,Sales!D2:D7)</f>');
});

test('formula lab export sanitizes its tab name and preserves typed formulas', async ({ page }) => {
  await loadDemo(page);
  const lab = page.locator('.sdoc-cells-pane').nth(1);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    lab.locator('.sdoc-cells-xlsx:visible').click(),
  ]);
  const xml = fs.readFileSync(await download.path()).toString('latin1');
  expect(xml).toContain('xl/worksheets/sheet2.xml');
  expect(xml).toContain('name="Quoted sheet"');
  expect(xml).toContain('<f>\'Quoted sheet\'!B2*2</f><v>200</v>');
  expect(xml).toContain('<f>UPPER(\'Quoted sheet\'!B4)</f><v>ABC-123</v>');
  expect(xml).toContain('<f>AND(\'Quoted sheet\'!B5,1&lt;2)</f><v>1</v>');
});
