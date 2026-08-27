const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

async function addSignedOutCloudAction(page) {
  await page.locator('.doc-site-nav').evaluate(nav => {
    if (nav.querySelector('[data-sdocs-sign-in-return]')) return;
    const link = document.createElement('a');
    link.className = 'doc-site-action doc-site-sign-in';
    link.href = '/cloud/sign-in?return=%2Fdocs';
    link.setAttribute('data-sdocs-sign-in-return', '');
    link.textContent = 'Sign in';
    nav.insertBefore(link, nav.querySelector('.doc-site-menu'));
  });
}

test('signed-out desktop document navigation shows equal-height Library and Sign in actions', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/docs');
  await addSignedOutCloudAction(page);

  const library = page.locator('.doc-site-nav > #_sd_btn-library');
  await expect(library).toBeVisible();
  await expect(library).toContainText('Library');
  await expect(page.getByText('Markdown Library', { exact: true })).toHaveCount(0);

  const signIn = page.locator('[data-sdocs-sign-in-return]');
  await expect(signIn).toBeVisible();
  await expect(page.locator('#doc-site-menu')).toBeHidden();
  const heights = await Promise.all([
    library.evaluate(element => element.getBoundingClientRect().height),
    signIn.evaluate(element => element.getBoundingClientRect().height),
  ]);
  expect(heights).toEqual([36, 36]);
});

test('signed-out mobile document navigation keeps equal-height Library and Sign in actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs');
  await addSignedOutCloudAction(page);

  await expect(page.locator('.doc-site-nav > #_sd_btn-library')).toBeVisible();
  await expect(page.locator('[data-sdocs-sign-in-return]')).toBeVisible();
  await expect(page.locator('#doc-site-menu')).toBeHidden();
  const heights = await page.locator('.doc-site-nav > .doc-site-action:visible').evaluateAll(elements =>
    elements.map(element => element.getBoundingClientRect().height));
  expect(heights).toEqual([28, 28]);
  await expect(page.locator('#_sd_sidebar')).toHaveCSS('width', '390px');
  await expect(page.locator('#_sd_left')).toHaveCSS('width', '390px');
  await expect(page.locator('#_sd_left-toolbar')).toHaveCSS('top', '44px');
});

test('Library, Sign in, and the authenticated menu button share one height', async ({ page }) => {
  await page.goto('/docs');
  await addSignedOutCloudAction(page);
  await page.locator('#doc-site-menu').evaluate(element => { element.hidden = false; });
  const heights = await Promise.all([
    page.locator('#_sd_btn-library').evaluate(element => element.getBoundingClientRect().height),
    page.locator('[data-sdocs-sign-in-return]').evaluate(element => element.getBoundingClientRect().height),
    page.locator('#doc-site-menu > .doc-site-action').evaluate(element => element.getBoundingClientRect().height),
  ]);
  expect(heights).toEqual([36, 36, 36]);
});

test('desktop document shell uses a sidebar and full-width action rail', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/docs');

  const sidebar = await page.locator('#_sd_sidebar').boundingBox();
  const toolbar = await page.locator('#_sd_left-toolbar').boundingBox();
  const left = await page.locator('#_sd_left').boundingBox();

  expect(sidebar).not.toBeNull();
  expect(toolbar).not.toBeNull();
  expect(left).not.toBeNull();
  expect(sidebar.width).toBe(224);
  expect(sidebar.x + sidebar.width).toBe(left.x);
  expect(toolbar.y).toBe(0);
  expect(toolbar.width).toBe(left.width);
  expect(Math.abs((toolbar.x + toolbar.width / 2) - (left.x + left.width / 2))).toBeLessThan(1);
  await expect(page.locator('body > #_sd_statusbar')).toBeHidden();
});
