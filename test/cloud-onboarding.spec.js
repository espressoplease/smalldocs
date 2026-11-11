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
test('profile save errors preserve names and allow retry', async ({ page }) => {
  await fixture(page, { failSave: true });
  await page.goto('/cloud/profile');
  await expect(page.getByLabel('First name')).toHaveValue('Alex');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('could not be saved');
  await expect(page.getByLabel('Last name')).toHaveValue('Rivera');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
});

test.describe('dedicated first installation', () => {
  let cloud;
  test.beforeEach(async ({ page }) => {
    cloud = await require('./cloud-onboarding-fixture').startFixture({ singlePlan: true });
    await page.context().addCookies([{ name: 'sdocs_cloud', value: cloud.users.josh.sessionToken, url: cloud.origin }]);
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copied = text; } } }));
  });
  test.afterEach(async () => { await cloud.close(); });

  for (const width of [390, 1440]) {
    test('one primary action copies the setup prompt and manual steps delegate connection at ' + width, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(cloud.origin + '/cloud/install');
      await expect(page.getByRole('heading', { name: 'Install SmallDocs', exact: true })).toBeVisible();
      await expect(page.locator('.settings-nav, .sdocs-site-sidebar, #install-destination')).toHaveCount(0);
      await expect(page.locator('button:visible')).toHaveCount(1);
      const button = page.locator('[data-install-copy=prompt]');
      await expect(button).toHaveClass(/primary-button/);
      await expect(button).toBeInViewport();
      const before = await button.boundingBox();
      await page.locator('#install-prompt').evaluate(pre => { pre.scrollTop = pre.scrollHeight; });
      expect((await button.boundingBox()).y).toBeCloseTo(before.y, 0);
      await button.click();
      expect(await page.evaluate(() => window.copied)).toBe(await page.locator('#install-prompt').textContent());
      expect(await page.evaluate(() => window.copied)).not.toMatch(/token|secret|cookie/);
      await expect(button).toHaveAccessibleName('Copied');
      await expect(button).toHaveText('Copied');
      await expect(button).toHaveAccessibleName('Copy setup prompt');
      await expect(button).toHaveText('Copy setup prompt');
      await expect(page.locator('#install-command')).not.toBeVisible();
      await page.getByText('Install yourself', { exact: true }).click();
      for (const field of ['cli', 'skill', 'connect']) {
        await page.locator('[data-install-copy="' + field + '"]').click();
        expect(await page.evaluate(() => window.copied)).toBe(await page.locator('[data-install-field="' + field + '"]').textContent());
      }
      expect(await page.evaluate(() => window.copied)).toContain('I have installed SmallDocs');
      expect(await page.evaluate(() => window.copied)).toContain('Read the installed SmallDocs Cloud skill');
      expect(await page.evaluate(() => window.copied)).not.toContain('library-default');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('link', { name: 'Already installed', exact: true }).click();
      await expect(page).toHaveURL(/\/library\?scope=cloud&workspace=/);
    });
  }

  test('explicit library context is copied safely and someone else cannot select it', async ({ page }) => {
    const team = await cloud.store.createTeamWorkspace({ userId: cloud.users.josh.id, name: 'Shared <research>', projectName: 'Documents' });
    await page.goto(cloud.origin + '/cloud/install?workspace_id=' + team.workspaceId);
    await page.getByRole('button', { name: 'Copy setup prompt', exact: true }).click();
    expect(await page.evaluate(() => window.copied)).toContain('My library is "Shared <research>".');
    expect(await page.evaluate(() => window.copied)).toContain(team.workspaceId);
    await expect(page.getByRole('link', { name: 'Already installed' })).toHaveAttribute('href', '/library?scope=cloud&workspace=' + team.workspaceId);
    const before = f => f.billing.db.prepare('SELECT ends_at_ms FROM cloud_billing_personal_trials WHERE user_id=?').get(f.users.josh.id).ends_at_ms;
    const deadline = before(cloud);
    await page.reload();
    expect(before(cloud)).toBe(deadline);
    const foreign = await cloud.api('outsider', '/cloud/install?workspace_id=' + team.workspaceId);
    expect(foreign.status).toBe(404);
    expect(JSON.stringify(foreign.data)).not.toContain('research');
  });

  test('old Install links use the same focused page', async ({ page }) => {
    await page.goto(cloud.origin + '/cloud/admin?panel=install');
    await expect(page.locator('.install-onboarding')).toBeVisible();
    await expect(page.locator('.settings-nav')).toHaveCount(0);
    await expect(page.locator('#install-methods')).toHaveAttribute('data-library-name', 'Personal');
  });

  test('signed-out requests retain the dedicated Install destination', async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const response = await context.request.get(cloud.origin + '/cloud/install', { maxRedirects: 0 });
      expect(response.status()).toBe(303);
      expect(response.headers().location).toBe('/cloud/sign-in?return=%2Fcloud%2Finstall');
    } finally { await context.close(); }
  });
});
