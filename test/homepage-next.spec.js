const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });
for (const width of [390, 1440]) {
  test('homepage experiment fits and exposes its sample documents at width ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/home-next');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('document format and store');
    await expect(page.locator('.sample-card')).toHaveCount(4);
    await expect(page.locator('[data-install-form]')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const link of await page.locator('[data-sample]').all()) {
      expect(await link.getAttribute('href')).toMatch(/^\/docs#md=/);
    }
    expect(errors).toEqual([]);
  });
}
for (let index = 0; index < 3; index++) {
  test('email form ' + index + ' reveals install commands only after a saved request', async ({ page }) => {
    let submitted;
    await page.route('**/api/install-interest', route => {
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { ok: true } });
    });
    await page.goto('/home-next');
    const instructions = page.locator('#install-instructions');
    await expect(instructions).toBeHidden();
    const form = page.locator('[data-install-form]').nth(index);
    await form.locator('input').fill('reader@example.com');
    await form.locator('button').click();
    await expect(instructions).toBeVisible();
    expect(submitted).toEqual({ email: 'reader@example.com' });
    await expect(page.locator('[data-install-command]')).toContainText('smalldocs.org/install');
    await expect(page.locator('[data-install-form] input').first()).toHaveValue('reader@example.com');
  });
}
test('failed email submissions preserve the address and allow retry', async ({ page }) => {
  await page.route('**/api/install-interest', route => route.fulfill({ status: 502, json: { error: 'submission_failed' } }));
  await page.goto('/home-next');
  const form = page.locator('[data-install-form]').first();
  await form.locator('input').fill('reader@example.com');
  await form.locator('button').click();
  await expect(page.locator('.start-status').first()).toContainText('Try again');
  await expect(page.locator('#install-instructions')).toBeHidden();
  await expect(form.locator('input')).toHaveValue('reader@example.com');
  await expect(form.locator('button')).toBeEnabled();
});


test('installer copy uses the shared platform command', async ({ page }) => {
  await page.route('**/api/install-interest', route => route.fulfill({ status: 201, json: { ok: true } }));
  await page.addInitScript(() => {
    navigator.clipboard.writeText = async text => { window.copiedInstallCommand = text; };
  });
  await page.goto('/home-next');
  const form = page.locator('[data-install-form]').first();
  await form.locator('input').fill('reader@example.com');
  await form.locator('button').click();
  await page.locator('[data-copy-install]').click();
  expect(await page.evaluate(() => window.copiedInstallCommand))
    .toBe('curl -fsSL https://smalldocs.org/install | sh');
});


test('the introduction is a 30-second clip with captions', async ({ page }) => {
  await page.goto('/home-next');
  await page.locator('#intro-video').evaluate(video => video.load());
  await expect.poll(() => page.locator('#intro-video').evaluate(video => video.duration)).toBeGreaterThanOrEqual(30);
  expect(await page.locator('#intro-video').evaluate(video => video.duration)).toBeLessThan(31);
  await expect(page.locator('#intro-video track')).toHaveAttribute('kind', 'captions');
});
