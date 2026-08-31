const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block', locale: 'en-GB' });

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

test('Local Connect and Cloud onboarding use the sidebar instead of a duplicate location toggle', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/connect');
  await installToggleOnConnect(page);
  await expect(page.locator('.library-onboarding-nav')).toBeHidden();
  await expect(page.locator('.sdocs-site-sidebar-row.is-active')).toContainText('Local library');

  await page.goto('/public/library/library.html?scope=cloud');
  await page.addStyleTag({ url: '/public/library/cloud-library-prototype.css' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-account-selection.js' });
  await page.addScriptTag({ url: '/public/library/cloud-library-prototype.js' });
  await expect(page.locator('.cloud-library-nav .library-scope')).toBeHidden();
  await expect(page.locator('.sdocs-site-sidebar-row.is-active')).toContainText('Cloud library');
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
  const onboardingSignIn = page.locator('#cloud-onboarding [data-cloud-sign-in]');
  await expect(onboardingSignIn).toBeVisible();
  await expect(onboardingSignIn).toHaveAttribute('href', '/cloud/sign-in?return=%2Flibrary%3Fscope%3Dcloud');
  await expect(page.locator('#_sd_site_sidebar [data-sdocs-sign-in-return]')).toBeVisible();
  await expect(page.locator('#library-menu')).toBeHidden();
});

test('mobile Library opens Cloud directly and uses phone-sized layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const loopbackRequests = [];
  page.on('request', request => {
    if (/127\.0\.0\.1|localhost:47843/.test(request.url())) loopbackRequests.push(request.url());
  });

  await page.goto('/public/library/library.html?demo=1');
  await page.addScriptTag({ url: '/public/library/library-mobile.js' });
  await page.addStyleTag({ url: '/public/library/cloud-library-prototype.css' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-account-selection.js' });
  await page.addScriptTag({ url: '/public/library/cloud-library-prototype.js' });

  await expect(page).toHaveURL(/demo=1&scope=cloud$/);
  await expect(page.getByRole('heading', { name: 'Cloud Library' })).toBeVisible();
  await expect(page.locator('#local-scope-link')).toBeHidden();
  await expect(page.locator('#cloud-scope-link')).toBeHidden();
  await expect(page.locator('.cloud-onboarding-primary')).toBeVisible();

  const layout = await page.evaluate(() => {
    const heading = getComputedStyle(document.querySelector('.cloud-onboarding h1'));
    const action = document.querySelector('.cloud-onboarding-primary').getBoundingClientRect();
    return {
      viewport: document.querySelector('meta[name="viewport"]').content,
      bodyWidth: document.body.scrollWidth,
      windowWidth: window.innerWidth,
      headingSize: parseFloat(heading.fontSize),
      actionHeight: action.height,
    };
  });
  expect(layout.viewport).toContain('width=device-width');
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.windowWidth);
  expect(layout.headingSize).toBeGreaterThanOrEqual(28);
  expect(layout.actionHeight).toBeGreaterThanOrEqual(44);
  expect(loopbackRequests).toEqual([]);
});
