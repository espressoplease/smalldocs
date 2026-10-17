const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });
async function fixture(page, options = {}) {
  let user = { email: 'alex@example.com', first_name: 'Alex', last_name: 'Rivera', ...options.user };
  let credentials = options.credentials || [];
  const calls = [];
  await page.route('**/api/cloud/v1/**', async route => {
    const req = route.request(), endpoint = new URL(req.url()).pathname;
    calls.push(endpoint);
    if (endpoint.endsWith('/me')) {
      if (req.method() === 'PATCH') {
        if (options.failSave) return route.fulfill({ status: 503, json: { error: 'temporary_service_failure' } });
        user = { ...user, ...req.postDataJSON() };
      }
      return route.fulfill({ json: { ok: true, user } });
    }
    if (endpoint.endsWith('/workspaces')) return route.fulfill({ json: { ok: true, workspaces: [] } });
    if (endpoint.endsWith('/cli/credentials')) return route.fulfill({ json: { ok: true, credentials } });
    return route.fulfill({ status: 400, json: { error: 'unexpected_api' } });
  });
  await page.route('**/cloud/profile', route => route.fulfill({ path: require('path').join(__dirname, '../public/cloud-profile.html'), contentType: 'text/html' }));
  await page.route('**/cloud/admin?*', route => route.fulfill({ path: require('path').join(__dirname, '../public/cloud-admin.html'), contentType: 'text/html' }));
  return { calls, connect() { credentials = [{ id: 'cli-1', displayName: 'Alexs-MacBook.local', createdAtMs: Date.now(), lastUsedAtMs: Date.now() }]; } };
}
for (const width of [390, 1440]) {
  test('Install works without a workspace and reuses machine status at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const api = await fixture(page);
    await page.goto('/cloud/admin?panel=install');
    await expect(page.getByRole('heading', { name: 'Install SmallDocs', exact: true })).toBeVisible();
    await expect(page.locator('#account-label')).toHaveText('Alex Rivera · alex@example.com');
    await expect(page.locator('#install-command')).toContainText('sdoc setup --cloud --yes');
    await expect(page.locator('#install-command')).toContainText('export SDOCS_CLOUD_URL=' + new URL(page.url()).origin + '\nsdoc cloud login');
    await expect(page.locator('#install-prompt')).toContainText('Let me approve the connection in my browser');
    await page.getByRole('link', { name: 'View connected machines' }).click();
    await expect(page.locator('#credentials-empty')).toBeVisible();
    api.connect();
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByText('Alexs-MacBook.local', { exact: true })).toBeVisible();
    expect(api.calls.some(path => path.endsWith('/documents/deleted'))).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
test('profile save errors preserve names and allow retry', async ({ page }) => {
  await fixture(page, { failSave: true });
  await page.goto('/cloud/profile');
  await expect(page.getByLabel('First name')).toHaveValue('Alex');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('could not be saved');
  await expect(page.getByLabel('Last name')).toHaveValue('Rivera');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
});
test('Install copies the prompt rather than a browser session credential', async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => { navigator.clipboard.writeText = async value => { window.copied = value; }; });
  await page.goto('/cloud/admin?panel=install');
  await page.getByRole('button', { name: 'Copy install prompt', exact: true }).click();
  await expect(page.locator('#install-copy-status')).toHaveText('Copied');
  expect(await page.evaluate(() => window.copied)).toContain('sdoc cloud login');
  expect(await page.evaluate(() => window.copied)).not.toMatch(/token|secret|cookie/);
});
test('signed-out requests retain the Install destination', async ({ request }) => {
  const response = await request.get('/cloud/admin?panel=install', { maxRedirects: 0 });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe('/cloud/sign-in?return=%2Fcloud%2Fadmin%3Fpanel%3Dinstall');
});
