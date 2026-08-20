const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

async function shellAndToggle(page, url, shellSelector) {
  await page.goto(url);
  await page.addStyleTag({ url: '/public/library/cloud-library-prototype.css' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-account-selection.js' });
  await page.addScriptTag({ url: '/public/library/cloud-library-prototype.js' });
  return page.evaluate(selector => {
    const shell = document.querySelector(selector).getBoundingClientRect();
    const options = Array.from(document.querySelectorAll('.library-scope-option'))
      .map(element => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
    return { left: shell.left, width: shell.width, options };
  }, shellSelector);
}

async function installToggleOnConnect(page) {
  await page.evaluate(() => {
    const nav = document.createElement('nav');
    nav.className = 'library-scope connect-library-scope';
    nav.innerHTML = '<a class="library-scope-option active" href="/library">Local</a>' +
      '<a class="library-scope-option" href="/library?scope=cloud">Cloud</a>';
    document.querySelector('main').prepend(nav);
  });
}

test('Local Connect and Cloud Library use the same shell and location toggle', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/connect');
  await installToggleOnConnect(page);
  const local = await page.evaluate(() => {
    const shell = document.querySelector('.library-page-shell').getBoundingClientRect();
    const options = Array.from(document.querySelectorAll('.library-scope-option')).map(element => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    return { left: shell.left, width: shell.width, options };
  });
  const cloud = await shellAndToggle(page, '/public/library/library.html?scope=cloud', '.container');

  expect(local.left).toBe(cloud.left);
  expect(local.width).toBe(cloud.width);
  expect(local.options).toEqual(cloud.options);
  expect(local.options.map(option => option.height)).toEqual([30, 30]);
});

test('signed-out Cloud Library provides the full onboarding flow', async ({ page }) => {
  await page.goto('/public/library/library.html?scope=cloud');
  await page.addStyleTag({ url: '/public/library/cloud-library-prototype.css' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-account-selection.js' });
  await page.addScriptTag({ url: '/public/library/cloud-library-prototype.js' });
  await page.locator('#library-menu').evaluate(element => { element.hidden = true; });
  await expect(page.getByRole('heading', { name: 'Cloud Library' })).toBeVisible();
  await expect(page.getByText('Across devices', { exact: true })).toBeVisible();
  await expect(page.getByText('Search and tags', { exact: true })).toBeVisible();
  await expect(page.getByText('Permission groups', { exact: true })).toBeVisible();
  await expect(page.locator('.cloud-steps li')).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'Subscribe to Cloud' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('#library-menu')).toBeHidden();
});
