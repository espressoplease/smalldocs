// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

const SIMPLE_CHART = '# Test\n\n```chart\n{"type":"bar","title":"Revenue","labels":["Q1","Q2","Q3","Q4"],"values":[12,18,15,22],"format":"currency"}\n```';

const TWO_CHARTS = '# Test\n\n```chart\n{"type":"bar","title":"First","labels":["A","B"],"values":[10,20]}\n```\n\n```chart\n{"type":"pie","title":"Second","labels":["X","Y","Z"],"values":[40,35,25]}\n```';

async function loadDoc(page, md) {
  await page.goto(BASE);
  await page.waitForTimeout(1000);
  await page.evaluate((content) => {
    window.SDocs.loadText(content, 'test.md');
  }, md);
  await page.waitForTimeout(3000); // wait for Chart.js CDN + render
}

async function getRawText(page) {
  return page.evaluate(() => document.getElementById('_sd_raw').value);
}

// ═══════════════════════════════════════════════════
//  MENU RENDERING
// ═══════════════════════════════════════════════════

test.describe('Chart menu rendering', () => {
  test('menu button appears on chart', async ({ page }) => {
    await loadDoc(page, SIMPLE_CHART);
    const btns = await page.locator('.chart-menu-btn').count();
    expect(btns).toBe(1);
  });

  test('menu dropdown exists but is hidden', async ({ page }) => {
    await loadDoc(page, SIMPLE_CHART);
    const menu = page.locator('.chart-menu');
    await expect(menu).toHaveCount(1);
    await expect(menu).not.toHaveClass(/open/);
  });

  test('clicking menu button opens dropdown', async ({ page }) => {
    await loadDoc(page, SIMPLE_CHART);
    await page.locator('.chart-menu-btn').click();
    await expect(page.locator('.chart-menu')).toHaveClass(/open/);
  });

  test('clicking outside closes dropdown', async ({ page }) => {
    await loadDoc(page, SIMPLE_CHART);
    await page.locator('.chart-menu-btn').click();
    await expect(page.locator('.chart-menu')).toHaveClass(/open/);
    await page.locator('h1').click();
    await expect(page.locator('.chart-menu')).not.toHaveClass(/open/);
  });

  test('menu has copy and download buttons', async ({ page }) => {
    await loadDoc(page, SIMPLE_CHART);
    await page.locator('.chart-menu-btn').click();
    await expect(page.locator('[data-action="copy-png"]')).toHaveText('Copy as image');
    await expect(page.locator('[data-action="download-png"]')).toHaveText('Download as PNG');
  });

  test('menu has data labels and legend toggles', async ({ page }) => {
    await loadDoc(page, SIMPLE_CHART);
    await page.locator('.chart-menu-btn').click();
    const labels = page.locator('.chart-menu-toggle');
    await expect(labels).toHaveCount(2); // data labels + legend
  });

  test('menu has type switcher for bar chart', async ({ page }) => {
    await loadDoc(page, SIMPLE_CHART);
    await page.locator('.chart-menu-btn').click();
    const types = page.locator('.chart-type-btn');
    await expect(types).toHaveCount(3); // bar, horizontal, stacked
    await expect(types.nth(0)).toHaveText('Bar');
    await expect(types.nth(1)).toHaveText('Horizontal');
    await expect(types.nth(2)).toHaveText('Stacked');
  });

  test('menu has title and subtitle inputs', async ({ page }) => {
    await loadDoc(page, SIMPLE_CHART);
    await page.locator('.chart-menu-btn').click();
    const titleInput = page.locator('.chart-menu-input[data-field="title"]');
    await expect(titleInput).toHaveValue('Revenue');
    const subInput = page.locator('.chart-menu-input[data-field="subtitle"]');
    await expect(subInput).toHaveValue('');
  });

  test('two charts have independent menus', async ({ page }) => {
    await loadDoc(page, TWO_CHARTS);
    const btns = await page.locator('.chart-menu-btn').count();
    expect(btns).toBe(2);
    const menus = await page.locator('.chart-menu').count();
    expect(menus).toBe(2);
  });
});

// ═══════════════════════════════════════════════════
//  CONFIG CHANGES → MARKDOWN
// ═══════════════════════════════════════════════════

test.describe('Chart config changes update markdown', () => {
  test('toggling data labels off updates raw markdown', async ({ page }) => {
    await loadDoc(page, SIMPLE_CHART);
    await page.locator('.chart-menu-btn').click();
    const cb = page.locator('.chart-menu-toggle input[data-field="dataLabels"]');
    await expect(cb).toBeChecked();
    await cb.uncheck();
    await page.waitForTimeout(500);
    const raw = await getRawText(page);
    expect(raw).toContain('"dataLabels": false');
  });

  test('toggling legend off updates raw markdown', async ({ page }) => {
    await loadDoc(page, SIMPLE_CHART);
    await page.locator('.chart-menu-btn').click();
    await page.locator('.chart-menu-toggle input[data-field="legend"]').uncheck();
    await page.waitForTimeout(500);
    const raw = await getRawText(page);
    expect(raw).toContain('"legend": false');
  });

  test('switching chart type updates raw markdown', async ({ page }) => {
    await loadDoc(page, SIMPLE_CHART);
    await page.locator('.chart-menu-btn').click();
    await page.locator('.chart-type-btn:has-text("Horizontal")').click();
    await page.waitForTimeout(500);
    const raw = await getRawText(page);
    expect(raw).toContain('"type": "horizontal_bar"');
  });

  test('editing title updates raw markdown', async ({ page }) => {
    await loadDoc(page, SIMPLE_CHART);
    await page.locator('.chart-menu-btn').click();
    const titleInput = page.locator('.chart-menu-input[data-field="title"]');
    await titleInput.fill('New Title');
    await titleInput.dispatchEvent('change');
    await page.waitForTimeout(500);
    const raw = await getRawText(page);
    expect(raw).toContain('"title": "New Title"');
  });

  test('adding subtitle updates raw markdown', async ({ page }) => {
    await loadDoc(page, SIMPLE_CHART);
    await page.locator('.chart-menu-btn').click();
    const subInput = page.locator('.chart-menu-input[data-field="subtitle"]');
    await subInput.fill('My subtitle');
    await subInput.dispatchEvent('change');
    await page.waitForTimeout(500);
    const raw = await getRawText(page);
    expect(raw).toContain('"subtitle": "My subtitle"');
  });
});

// ═══════════════════════════════════════════════════
//  MULTIPLE CHARTS INDEPENDENCE
// ═══════════════════════════════════════════════════

test.describe('Multiple charts are independent', () => {
  test('changing second chart type does not affect first', async ({ page }) => {
    await loadDoc(page, TWO_CHARTS);
    // Open second chart menu
    await page.locator('.chart-menu-btn').nth(1).click();
    // Pie chart should not have type switcher with Bar/Horizontal/Stacked
    // It should have Pie/Doughnut/Polar
    const types = page.locator('.chart-menu.open .chart-type-btn');
    await expect(types.nth(0)).toHaveText('Pie');
  });
});

// ═══════════════════════════════════════════════════
//  URL PERSISTENCE
// ═══════════════════════════════════════════════════

test.describe('Config changes persist in URL', () => {
  test('type change updates URL hash', async ({ page }) => {
    await loadDoc(page, SIMPLE_CHART);
    await page.locator('.chart-menu-btn').click();
    await page.locator('.chart-type-btn:has-text("Stacked")').click();
    await page.waitForTimeout(1500); // hash update is debounced
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toContain('md=');
  });
});
