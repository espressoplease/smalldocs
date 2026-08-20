const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

test('document navigation separates the Library link from the site menu on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/docs');

  const library = page.locator('.doc-site-nav > #_sd_btn-library');
  await expect(library).toBeVisible();
  await expect(library).toContainText('Library');
  await expect(page.getByText('Markdown Library', { exact: true })).toHaveCount(0);

  const menu = page.locator('.doc-site-menu-button');
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.locator('.doc-site-menu-panel')).toBeVisible();
  await expect(page.locator('.doc-site-menu-panel').getByRole('menuitem', { name: 'Docs' })).toBeVisible();
  await expect(page.locator('.doc-site-menu-panel').getByRole('menuitem', { name: 'GitHub' })).toBeVisible();
});

test('mobile document navigation keeps the site menu and moves Library into it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs');

  await expect(page.locator('.doc-site-nav > #_sd_btn-library')).toBeHidden();
  const menu = page.locator('.doc-site-menu-button');
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.locator('.doc-site-menu-panel')).toBeVisible();
  await expect(page.locator('.doc-site-menu-panel').getByRole('menuitem', { name: 'Library' })).toBeVisible();
});
