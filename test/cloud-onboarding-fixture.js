const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { spawn } = require('child_process');
async function startFixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-onboarding-real-'));
  const pepper = crypto.randomBytes(32).toString('hex');
  const masterKey = crypto.randomBytes(32).toString('base64');
  const authPath = path.join(dir, 'auth.db'), storePath = path.join(dir, 'store.db'), billingPath = path.join(dir, 'billing.db');
  const auth = require('../lib/cloud-auth').createAuthStore({ dbPath: authPath, pepper });
  const store = require('../lib/cloud-store').createCloudStore({ dbPath: storePath,
    keyProvider: require('../lib/cloud-store').createLocalKeyProvider({ masterKey, environment: 'development' }), idempotencySecret: pepper });
  const billing = require('../lib/cloud-billing').createBillingStore({ dbPath: billingPath, trialIdentitySecret: pepper });
  const users = {};
  for (const [key, email] of Object.entries({ josh: 'josh@joes.com', bob: 'bob@joes.com', outsider: 'owner@other.com', member: 'member@joes.com', missing: 'new@joes.com', returning: 'returning@joes.com', gmail: 'alex@gmail.com' })) {
    let user = auth.signInWithVerifiedEmail(email).user;
    if (key !== 'missing') user = auth.updateUserProfile({ userId: user.id, firstName: key === 'josh' ? 'Josh' : key === 'bob' ? 'Bob' : 'Alex', lastName: 'Example' });
    auth.acceptCurrentTerms({ userId: user.id, termsVersion: require('../lib/cloud-terms').CURRENT_TERMS_VERSION });
    const session = auth.createBrowserSession(user.id);
    users[key] = { ...user, email, cookie: 'sdocs_cloud=' + session.token, sessionToken: session.token };
  }
  const team = await store.createTeamWorkspace({ userId: users.bob.id, name: "Joe's engineering", projectName: 'Documents' });
  store.addWorkspaceMember({ actorUserId: users.bob.id, workspaceId: team.workspaceId, userId: users.member.id, role: 'member' });
  const otherTeam = await store.createTeamWorkspace({ userId: users.outsider.id, name: 'Other team', projectName: 'Documents' });
  for (const workspace of [team, otherTeam]) billing.upsertSubscription({ workspaceId: workspace.workspaceId, plan: 'team', status: 'active', provider: 'manual' });
  const personal = await store.ensurePersonalWorkspace(users.returning.id, 'Existing personal');
  billing.upsertSubscription({ workspaceId: personal.workspaceId, plan: 'personal', status: 'active', provider: 'manual' });
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(options.port || 0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const origin = 'http://localhost:' + port;
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: {
    ...process.env, CLOUD_SINGLE_PLAN_ENABLED: options.singlePlan ? '1' : '', NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), CLOUD_MODE: 'off', CLOUD_PUBLIC_MODE: 'enabled',
    CLOUD_AUTH_PUBLIC_ORIGIN: origin, CLOUD_AUTH_PEPPER: pepper, CLOUD_AUTH_DB: authPath, CLOUD_OAUTH_DB: authPath,
    CLOUD_DB: storePath, CLOUD_MASTER_KEY: masterKey, CLOUD_BILLING_DB: billingPath,
    NOTIFY_SMTP_HOST: options.smtpPort ? '127.0.0.1' : '', NOTIFY_SMTP_PORT: String(options.smtpPort || 1025),
    NOTIFY_SMTP_SECURITY: options.smtpPort ? 'none' : '', NOTIFY_SMTP_USER: '',
    NOTIFY_EMAIL_FROM: 'login@smalldocs.test', CLOUD_AUTH_DEV_LOG_CODES: '',
    STRIPE_SECRET_KEY: options.stripeApiBase ? 'sk_test_fixture' : '', STRIPE_SECRET_KEY_FILE: '', SDOCS_STRIPE_TEST_API_BASE: options.stripeApiBase || '', STRIPE_STANDARD_PRICE_ID: options.stripeApiBase ? 'price_standard' : '', STRIPE_WEBHOOK_SECRET: options.stripeApiBase ? 'whsec_fixture' : '', CLOUD_JOBS_DB: '', CLOUD_KMS_KEY_ID: '', NOTIFY_SMTP_PASS: '',
    SDOCS_SKIP_KMS_PREFLIGHT: '1', SHORT_LINKS_DB: path.join(dir, 'links.db'),
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let startupErrors = '';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Onboarding test server did not start')), 10000);
      child.stdout.on('data', value => { if (String(value).includes('running at')) { clearTimeout(timer); resolve(); } });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Onboarding test server exited during startup: ' + startupErrors)); });
      child.stderr.on('data', value => { startupErrors += value; if (options.logErrors) process.stderr.write(value); });
    });
  } catch (error) {
    if (child.exitCode == null && child.signalCode == null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
    auth.close(); store.close(); billing.close(); fs.rmSync(dir, { recursive: true, force: true });
    // A different parallel test can claim the ephemeral port between reservation and spawn.
    if (!options.port && startupErrors.includes('EADDRINUSE') && (options.portRetries || 0) < 2) {
      return startFixture({ ...options, portRetries: (options.portRetries || 0) + 1 });
    }
    throw error;
  }
  async function api(actor, endpoint, method = 'GET', body) {
    const response = await fetch(origin + endpoint, { method, redirect: 'manual', headers: {
      Cookie: users[actor].cookie, Origin: origin, 'Content-Type': 'application/json',
    }, body: body == null ? undefined : JSON.stringify(body) });
    let data; const text = await response.text(); try { data = JSON.parse(text); } catch (_) { data = text; }
    return { status: response.status, data, headers: response.headers };
  }
  let closed = false;
  return { dir, origin, users, team, personal, otherTeam, auth, store, billing, api,
    async close() { if (closed) return; closed = true;
      if (child.exitCode == null && child.signalCode == null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
      auth.close(); store.close(); billing.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
module.exports = { startFixture };
