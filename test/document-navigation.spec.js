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
  const heights = await page.locator('.doc-site-nav > .doc-site-action:visible').evaluateAll(elements =>
    elements.map(element => element.getBoundingClientRect().height));
  expect(heights).toEqual([28, 28]);
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
});

test('Library, Sign in, and the authenticated menu button share one height', async ({ page }) => {
  await page.goto('/docs');
  await addSignedOutCloudAction(page);
  await page.locator('#doc-site-menu').evaluate(element => { element.hidden = false; });
  const heights = await page.locator('.doc-site-nav > .doc-site-action, .doc-site-menu > .doc-site-action')
    .evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
  expect(heights).toEqual([28, 28, 28]);
});
