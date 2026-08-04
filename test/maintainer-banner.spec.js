// @ts-check
const { test, expect } = require('@playwright/test');

async function openRenderedDoc(page) {
  await page.goto('/docs');
  await page.waitForFunction(() => window.SDocs && window.SDocs.currentBody);
}

test('maintainer banner appears on rendered documents, not the homepage', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#_sd_maintainer-banner')).toHaveCount(0);

  await openRenderedDoc(page);
  const banner = page.locator('#_sd_maintainer-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('SmallDocs is looking for maintainers');
  await expect(banner.locator('input[type="email"]')).toBeVisible();
});

test('maintainer banner dismissal persists in this browser', async ({ page }) => {
  await openRenderedDoc(page);
  const banner = page.locator('#_sd_maintainer-banner');
  await expect(banner).toBeVisible();

  await banner.locator('button[aria-label="Dismiss maintainer banner"]').click();
  await expect(banner).toBeHidden();

  await page.reload();
  await page.waitForFunction(() => window.SDocs && window.SDocs.currentBody);
  await expect(page.locator('#_sd_maintainer-banner')).toBeHidden();
});

test('maintainer banner submits email interest and then stays dismissed', async ({ page }) => {
  await page.route('**/api/maintainer-interest', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await openRenderedDoc(page);
  const requestPromise = page.waitForRequest((req) =>
    req.method() === 'POST' && req.url().endsWith('/api/maintainer-interest'));
  await page.locator('#_sd_maintainer-banner input[type="email"]').fill('helper@example.com');
  await page.locator('#_sd_maintainer-banner button[type="submit"]').click();

  const req = await requestPromise;
  const body = JSON.parse(req.postData() || '{}');
  expect(body.email).toBe('helper@example.com');
  expect(body.website).toBe('');

  await expect(page.locator('#_sd_maintainer-banner')).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => window.SDocs && window.SDocs.currentBody);
  await expect(page.locator('#_sd_maintainer-banner')).toBeHidden();
});

test('maintainer banner wraps on mobile in dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await openRenderedDoc(page);
  await page.evaluate(() => window.SDocs.switchThemeAndUpdate('dark'));

  const banner = page.locator('#_sd_maintainer-banner');
  await expect(banner).toBeVisible();
  const fits = await banner.evaluate((el) => {
    const viewportWidth = document.documentElement.clientWidth;
    return Array.from(el.querySelectorAll('*')).every((node) => {
      if (node.classList.contains('sdoc-maintainer-hp')) return true;
      const rect = node.getBoundingClientRect();
      return rect.left >= -1 && rect.right <= viewportWidth + 1;
    });
  });
  expect(fits).toBe(true);
});
