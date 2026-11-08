const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
test.use({ serviceWorkers: 'block' });

test('authoring references render through the normal document reader without SDK dependencies', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  for (const slug of ['markdown', 'code', 'math', 'diagrams', 'charts', 'cells',
    'slides', 'slide-shapes', 'apps', 'walkthroughs', 'video', 'styles']) {
    const source = fs.readFileSync(path.join(__dirname, '../public/authoring', slug + '.md'), 'utf8');
    await page.goto('/developers/authoring/' + slug);
    await page.waitForFunction(() => window.SDocs && SDocs._appReady);
    expect(await page.evaluate(() => SDocs.currentBody.trim())).toBe(source.trim());
    await expect(page.locator('#_sd_rendered h1').first()).toBeVisible();
    await expect(page.locator('[role="toolbar"][aria-label="Document actions"]')).toBeVisible();
  }
  expect(errors).toEqual([]);
  expect(requests.filter(url => new URL(url).pathname.startsWith('/sdk/'))).toEqual([]);
});
