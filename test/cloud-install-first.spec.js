const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const execute = require('util').promisify(execFile);
const { startFixture } = require('./cloud-onboarding-fixture');
const { startCaptureServer, decodeMimeParts } = require('./test-email');
test.use({ serviceWorkers: 'block' });
test.setTimeout(120000);
let f, mail, loginProcess;
test.beforeEach(async () => {
  mail = await startCaptureServer();
  const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...keyPair.publicKey.export({ format: 'jwk' }), kid: 'install-first', alg: 'RS256', use: 'sig' };
  const keys = path.join(require('os').tmpdir(), 'sdocs-install-keys-' + crypto.randomUUID() + '.json');
  fs.writeFileSync(keys, JSON.stringify({ jwk, privateKey: keyPair.privateKey.export({ format: 'pem', type: 'pkcs8' }) }), { mode: 0o600 });
  try { f = await startFixture({ singlePlan: true, smtpPort: mail.port, env: {
    GOOGLE_OAUTH_CLIENT_ID: 'install-first-client', GOOGLE_OAUTH_CLIENT_SECRET: 'fixture-secret',
    SDOCS_TEST_GOOGLE_KEYS: keys, NODE_OPTIONS: '--require=' + path.join(__dirname, 'google-oauth-preload.js'),
  } }); } finally { fs.rmSync(keys, { force: true }); }
});
test.afterEach(async () => {
  if (loginProcess && loginProcess.exitCode == null && loginProcess.signalCode == null) {
    const done = new Promise(resolve => loginProcess.once('exit', resolve)); loginProcess.kill('SIGTERM'); await done;
  }
  loginProcess = null;
  if (f) await f.close();
  if (mail) await new Promise(resolve => mail.server.close(resolve));
});

for (const width of [390, 1440]) for (const provider of ['email', 'google']) {
  test(provider + ' connects a fresh installed agent and saves a working tour at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const home = path.join(f.dir, 'fresh-home'); fs.mkdirSync(home);
    const codex = path.join(home, '.codex'); fs.mkdirSync(codex);
    const env = { ...process.env, HOME: home, CODEX_HOME: codex, SDOCS_HOME: path.join(home, '.sdocs'),
      SDOCS_CLOUD_URL: f.origin, SDOCS_CLOUD_FILE_CREDENTIALS: '1', SDOCS_NO_SETUP: '1',
      SDOCS_NO_REFRESH: '1', SDOCS_NO_UPDATE_CHECK: '1', npm_config_cache: path.join(f.dir, 'npm-cache') };
    const pack = JSON.parse((await execute('npm', ['pack', '--json', '--pack-destination', f.dir], {
      cwd: path.join(__dirname, '../cli'), env })).stdout)[0];
    const installed = path.join(f.dir, 'installed'); fs.mkdirSync(installed);
    await execute('tar', ['-xzf', path.join(f.dir, pack.filename), '-C', installed]);
    const binary = path.join(installed, 'package/bin/sdocs-dev.js');
    const run = async args => JSON.parse((await execute(process.execPath, [binary, ...args], { env, cwd: home })).stdout);
    // Exercise the real cross-agent installer once, before any SmallDocs account exists.
    if (provider === 'email' && width === 1440) {
      await execute('npx', ['--yes', 'skills@latest', 'add', f.origin + '/agent-skills/cloud', '--global', '--yes'], { env, cwd: home, timeout: 90000 });
      const installedSkill = fs.readFileSync(path.join(home, '.agents/skills/smalldocs/SKILL.md'), 'utf8');
      expect(installedSkill).toContain('First setup and tour');
      expect(installedSkill).toContain(f.origin + '/public/getting-started.md');
    }
    const ref = (await f.api('josh', '/api/cloud/v1/referrals')).data.url;
    const refCode = new URL(ref).searchParams.get('ref');
    let output = '', diagnostics = '';
    loginProcess = spawn(process.execPath, [binary, 'cloud', 'login', '--json', '--no-open', '--referral-code', refCode], { env, cwd: home });
    loginProcess.stdout.on('data', bytes => { output += bytes; });
    loginProcess.stderr.on('data', bytes => { diagnostics += bytes; });
    const completed = new Promise(resolve => loginProcess.once('exit', code => resolve(code)));
    await expect.poll(() => (diagnostics.match(/http[^\s]+\/cloud\/authorize[^\s]*/) || [])[0]).toBeTruthy();
    const authorizationUrl = diagnostics.match(/http[^\s]+\/cloud\/authorize[^\s]*/)[0];
    expect(new URL(authorizationUrl).searchParams.get('ref')).toBe(refCode);
    await page.goto(authorizationUrl);
    await expect(page.getByRole('heading', { name: 'Connect your agent', exact: true })).toBeVisible();
    await expect(page.locator('#agent-library-note')).toContainText('encrypted in storage');
    const email = 'install-' + provider + '-' + width + '@gmail.com';
    if (provider === 'google') {
      await page.route('**/api/cloud/auth/oauth/google?*', async route => {
        const begun = await route.fetch({ maxRedirects: 0 });
        const request = new URL(begun.headers().location);
        const callback = new URL(request.searchParams.get('redirect_uri'));
        callback.searchParams.set('state', request.searchParams.get('state'));
        callback.searchParams.set('code', Buffer.from(JSON.stringify({ email, first: 'Taylor', last: 'Reader', nonce: request.searchParams.get('nonce') })).toString('base64url'));
        await route.fulfill({ response: begun, headers: { ...begun.headers(), location: callback.href }, body: '' });
      });
      await page.getByRole('link', { name: 'Continue with Google', exact: true }).click();
    } else {
      await page.getByLabel('Email address', { exact: true }).fill(email);
      await page.locator('#email-form').getByRole('button').click();
      await expect.poll(() => mail.messages.length).toBe(1);
      const text = decodeMimeParts(mail.messages[0]).map(part => part.body).join('\n');
      await page.locator('#code').fill(text.match(/\b\d{6}\b/)[0]);
      await page.locator('#code-form').getByRole('button').click();
    }
    await expect(page).toHaveURL(/cloud\/terms/);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /agree|continue/i }).click();
    if (provider === 'email') {
      await expect(page).toHaveURL(/cloud\/profile/);
      await page.getByLabel('First name').fill('Taylor'); await page.getByLabel('Last name').fill('Reader');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    }
    await expect(page).toHaveURL(authorizationUrl);
    await page.getByRole('button', { name: 'Connect agent', exact: true }).click();
    await expect(page.locator('#authorization-result')).toContainText('Agent connected');
    expect(await completed).toBe(0); expect(JSON.parse(output).ok).toBe(true);
    const status = await run(['cloud', 'status', '--json']);
    expect(status.account.can_create_document).toBe(true);
    const tags = await run(['cloud', 'tags', '--json']); expect(tags.ok).toBe(true);
    const file = path.join(home, 'Getting started.md');
    fs.writeFileSync(file, await (await fetch(f.origin + '/public/getting-started.md')).text());
    expect((await run(['cells', 'verify', file, '--json'])).ok).toBe(true);
    expect((await run(['slides', 'verify', file, '--json'])).ok).toBe(true);
    const saved = await run([file, '--cloud', '--no-open', '--json', '+getting-started', '+smalldocs']);
    expect(saved.ok).toBe(true); expect(saved.tags).toEqual(expect.arrayContaining(['getting-started', 'smalldocs']));
    const receipt = JSON.parse(fs.readFileSync(path.join(env.SDOCS_HOME, 'cloud/credentials.json'), 'utf8'))[f.origin];
    const libraries = await f.store.listWorkspaces(receipt.user_id);
    expect(libraries).toHaveLength(1); expect(libraries[0].kind).toBe('personal');
    const referral = f.billing.db.prepare('SELECT * FROM cloud_referrals WHERE referred_user_id=?').get(receipt.user_id);
    expect(referral.referrer_user_id).toBe(f.users.josh.id);
    await page.goto(saved.url);
    await expect(page.locator('#_sd_rendered h1')).toHaveText('Your SmallDocs library');
    await expect(page.locator('.sdoc-slide')).toHaveCount(2);
    await expect(page.locator('.sdoc-cells-grid')).toHaveCount(1);
    await expect(page.locator('.sdoc-app-frame-inline')).toHaveCount(1);
    await page.getByRole('heading', { name: 'Explore an assumption', exact: true }).click();
    const component = page.frameLocator('.sdoc-app-frame-inline');
    await expect(component.locator('#days')).toHaveText('6');
    await component.locator('#hours').focus();
    await component.locator('#hours').press('ArrowRight');
    await component.locator('#hours').press('ArrowRight');
    await expect(component.locator('#days')).toHaveText('3');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
