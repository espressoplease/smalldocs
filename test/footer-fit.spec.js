// @ts-check
const { test, expect } = require('@playwright/test');

const WIDTHS = [1280, 1100, 950, 900, 770];

test('reader shell keeps the legacy status footer hidden across desktop widths', async ({ page }) => {
  await page.goto('/new');
  await page.waitForFunction(() => window.SDocs);
  await expect(page.locator('body')).toHaveClass(/sdocs-reader-shell/);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('#_sd_statusbar'), `legacy footer hidden at ${width}px`).toBeHidden();
  }
});

test('expanded reader sidebar preserves the site footer destinations', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/new');
  const sidebar = page.locator('#_sd_sidebar');

  const signIn = sidebar.locator('[data-sdocs-sign-in-return]');
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveAttribute('href', /\/cloud\/sign-in\?return=/);

  const privacy = sidebar.locator('[data-rail-label="Private by design"]');
  await expect(privacy).toBeVisible();
  await expect(privacy).toHaveAttribute('href', '/privacy');

  const source = sidebar.locator('[data-rail-label="Source on GitHub"]');
  await expect(source).toBeVisible();
  await expect(source).toHaveAttribute('href', 'https://github.com/espressoplease/smalldocs');

  const terms = sidebar.getByRole('link', { name: 'Terms' });
  await expect(terms).toBeVisible();
  await expect(terms).toHaveAttribute('href', '/legal');
});
