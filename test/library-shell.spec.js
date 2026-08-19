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
    const wrapper = document.createElement('div');
    wrapper.className = 'library-onboarding-nav';
    const nav = document.createElement('nav');
    nav.className = 'library-scope connect-library-scope';
    nav.innerHTML = '<a class="library-scope-option active" href="/library">Local</a>' +
      '<a class="library-scope-option" href="/library?scope=cloud">Cloud</a>';
    wrapper.append(nav);
    document.querySelector('main').prepend(wrapper);
  });
}

test('Local Connect and Cloud onboarding use the same centered column and location toggle', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/connect');
  await installToggleOnConnect(page);
  const local = await page.evaluate(() => {
    const shell = document.querySelector('.library-page-shell').getBoundingClientRect();
    const content = document.querySelector('.connect-content').getBoundingClientRect();
    const nav = document.querySelector('.library-onboarding-nav').getBoundingClientRect();
    const options = Array.from(document.querySelectorAll('.library-scope-option')).map(element => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    return { left: shell.left, width: shell.width, contentLeft: content.left,
      contentWidth: content.width, navLeft: nav.left, navWidth: nav.width, options };
  });
  await page.goto('/public/library/library.html?scope=cloud');
  await page.addStyleTag({ url: '/public/library/cloud-library-prototype.css' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-account-selection.js' });
  await page.addScriptTag({ url: '/public/library/cloud-library-prototype.js' });
  const cloud = await page.evaluate(() => {
    const shell = document.querySelector('.container').getBoundingClientRect();
    const content = document.querySelector('.cloud-onboarding').getBoundingClientRect();
    const nav = document.querySelector('.cloud-library-nav').getBoundingClientRect();
    const options = Array.from(document.querySelectorAll('.library-scope-option')).map(element => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    return { left: shell.left, width: shell.width, contentLeft: content.left,
      contentWidth: content.width, navLeft: nav.left, navWidth: nav.width, options };
  });

  expect(local.left).toBe(cloud.left);
  expect(local.width).toBe(cloud.width);
  expect(local.contentLeft).toBe(cloud.contentLeft);
  expect(local.contentWidth).toBe(cloud.contentWidth);
  expect(local.navLeft).toBe(cloud.navLeft);
  expect(local.navWidth).toBe(cloud.navWidth);
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
  await expect(page.getByText('£4', { exact: true })).toBeVisible();
  await expect(page.getByText('£7', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Security and privacy' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Subscribe to Cloud' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('#library-menu')).toBeHidden();
});
