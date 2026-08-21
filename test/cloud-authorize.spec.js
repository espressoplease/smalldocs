const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

test('authorization page formats the code and approves the named machine', async ({ page }) => {
  const calls = [];
  await page.route('**/api/cloud/v1/cli/device-authorizations/lookup?*', route => {
    calls.push({ method: route.request().method(), path: 'lookup' });
    return route.fulfill({ json: { ok: true,
      authorization: { display_name: 'Josh MacBook' } } });
  });
  await page.route('**/api/cloud/v1/cli/device-authorizations/approve', route => {
    calls.push({ method: route.request().method(), path: 'approve',
      body: route.request().postDataJSON() });
    return route.fulfill({ json: { ok: true } });
  });

  await page.goto('/public/cloud-authorize.html?user_code=ABCD2345');
  const input = page.getByLabel('Authorization code');
  await expect(input).toHaveValue('ABCD2345');
  await input.fill('abcd2345');
  await expect(input).toHaveValue('ABCD-2345');
  await expect(page.getByText('Request from Josh MacBook.')).toBeVisible();
  await expect(page.locator('.auth-mark svg circle[cx="7.5"]')).toBeVisible();
  const style = await input.evaluate(element => ({
    borderRadius: getComputedStyle(element).borderRadius,
    fontFamily: getComputedStyle(element).fontFamily,
  }));
  expect(style.borderRadius).toBe('6px');
  expect(style.fontFamily).toContain('monospace');

  await page.getByRole('button', { name: 'Authorize CLI' }).click();
  await expect(page.getByText('CLI authorized. You can return to the terminal.')).toBeVisible();
  expect(calls.some(call => call.method === 'POST' && call.path === 'approve' &&
    call.body.user_code === 'ABCD2345')).toBe(true);
});
