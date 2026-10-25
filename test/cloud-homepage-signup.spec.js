const { test, expect } = require('@playwright/test');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let f, directory;
test.beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-google-signup-'));
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'signup-test', alg: 'RS256', use: 'sig' };
  const filename = path.join(directory, 'keys.json');
  fs.writeFileSync(filename, JSON.stringify({ jwk, privateKey: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }) }));
  f = await startFixture({ singlePlan: true, env: {
    GOOGLE_OAUTH_CLIENT_ID: 'signup-test-client', GOOGLE_OAUTH_CLIENT_SECRET: 'signup-test-secret',
    SDOCS_TEST_GOOGLE_KEYS: filename, NODE_OPTIONS: '--require=' + path.join(__dirname, 'google-oauth-preload.js'),
  } });
});
test.afterEach(async () => { if (f) await f.close(); fs.rmSync(directory, { recursive: true, force: true }); });

for (const width of [390, 1440]) {
  for (const index of [0, 1, 2]) {
    test('homepage Google signup ' + index + ' reaches a usable library at ' + width, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const email = 'new-google-' + index + '@gmail.com';
      await page.route('**/api/cloud/auth/oauth/google?*', async route => {
        const begun = await route.fetch({ maxRedirects: 0 });
        const request = new URL(begun.headers().location);
        expect(request.searchParams.get('scope')).toBe('openid email profile');
        expect(request.searchParams.get('code_challenge_method')).toBe('S256');
        const callback = new URL(request.searchParams.get('redirect_uri'));
        callback.searchParams.set('state', request.searchParams.get('state'));
        callback.searchParams.set('code', Buffer.from(JSON.stringify({ email, first: 'Robin',
          last: index === 1 ? '' : 'Walker', nonce: request.searchParams.get('nonce') })).toString('base64url'));
        await route.fulfill({ response: begun, headers: { ...begun.headers(), location: callback.href }, body: '' });
      });
      await page.goto(f.origin + '/home-next');
      await page.locator('.homepage-google').nth(index).click();
      await expect(page).toHaveURL(/cloud\/terms/);
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: /agree|continue/i }).click();
      if (index === 1) {
        await expect(page).toHaveURL(/cloud\/profile/);
        await expect(page.getByLabel('First name')).toHaveValue('Robin');
        await page.getByLabel('Last name').fill('Walker');
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
      }
      await expect(page).toHaveURL(/cloud\/admin\?panel=install/);
      await expect(page.locator('#account-label')).toHaveText('Robin Walker · ' + email);
      const workspaces = await (await page.request.get(f.origin + '/api/cloud/v1/workspaces')).json();
      expect(workspaces.workspaces).toHaveLength(1);
      const id = workspaces.workspaces[0].id;
      await expect(page.locator('#install-command')).toContainText('sdoc setup --cloud --account ' + id + ' --yes');
      const commands = await page.locator('#install-command').innerText();
      expect(commands.indexOf('export SDOCS_CLOUD_URL=')).toBeLessThan(commands.indexOf('sdoc cloud login'));
      expect(commands.indexOf('sdoc cloud login')).toBeLessThan(commands.indexOf('sdoc setup --cloud'));
      await expect(page.locator('#install-prompt')).toContainText('+subject +project');
      const saved = await page.request.post(f.origin + '/api/cloud/v1/account/documents', { headers: { Origin: f.origin }, data: {
        account_id: id, filename: 'first.md', markdown: '# First document', tags: ['onboarding'], idempotency_key: 'google-first-save',
      } });
      expect(saved.status()).toBe(201);
      await page.goto(f.origin + '/cloud/start');
      expect((await (await page.request.get(f.origin + '/api/cloud/v1/workspaces')).json()).workspaces).toHaveLength(1);
      await page.goto(f.origin + '/home-next');
      await page.getByRole('link', { name: 'Log in', exact: true }).click();
      await page.getByRole('link', { name: 'Continue with Google' }).click();
      await expect(page).toHaveURL(f.origin + '/library?scope=cloud');
      expect((await (await page.request.get(f.origin + '/api/cloud/v1/workspaces')).json()).workspaces.map(w => w.id)).toEqual([id]);
    });
  }
}

test('homepage Log in opens the shared Google and email sign-in page and preserves the Library destination', async ({ page }) => {
  await page.goto(f.origin + '/home-next');
  await page.getByRole('link', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(f.origin + '/cloud/sign-in?return=%2Flibrary%3Fscope%3Dcloud');
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Email me a code' })).toBeVisible();
  await expect(page.locator('.return-input').first()).toHaveValue('/library?scope=cloud');
  expect(await page.locator('.auth-card h1').evaluate(el => getComputedStyle(el).fontSize)).toBe('18px');
  expect(await page.locator('.auth-card').evaluate(el => getComputedStyle(el).borderRadius)).toBe('10px');
});

test('declining Google preserves signup when offering another sign-in method', async ({ page }) => {
  await page.route('**/api/cloud/auth/oauth/google?*', async route => {
    const begun = await route.fetch({ maxRedirects: 0 });
    const provider = new URL(begun.headers().location);
    const callback = new URL(provider.searchParams.get('redirect_uri'));
    callback.searchParams.set('state', provider.searchParams.get('state'));
    callback.searchParams.set('error', 'access_denied');
    await route.fulfill({ response: begun, headers: { ...begun.headers(), location: callback.href }, body: '' });
  });
  await page.goto(f.origin + '/home-next');
  await page.locator('.homepage-google').first().click();
  await expect(page).toHaveURL(/cloud\/sign-in\?error=oauth_denied&return=%2Fcloud%2Fprofile/);
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.locator('.return-input').first()).toHaveValue('/cloud/profile');
});

test('a failed homepage code request keeps the email and permits retry', async ({ page }) => {
  await page.route('**/api/cloud/auth/email/request', route => route.fulfill({ status: 503, json: { error: 'temporary_service_failure' } }));
  await page.goto(f.origin + '/home-next');
  const form = page.locator('[data-install-form]').first();
  await form.locator('input').fill('reader@example.test');
  await form.getByRole('button').click();
  await expect(form.locator('..').locator('.start-status')).toContainText('The code could not be sent');
  await expect(form.getByRole('button')).toBeEnabled();
  await expect(form.locator('input')).toHaveValue('reader@example.test');
  await expect(page).toHaveURL(f.origin + '/home-next');
});
