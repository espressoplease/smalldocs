const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
const { CURRENT_TERMS_VERSION } = require('../lib/cloud-terms');
let f;
test.beforeEach(async () => { f = await startFixture({ singlePlan: true }); });
test.afterEach(async () => { if (f) await f.close(); });
const create = (actor, workspace, key) => f.api(actor, '/api/cloud/v1/account/documents', 'POST', {
  account_id: workspace, filename: key + '.md', markdown: '---\ntags: [trial-check]\n---\n# Trial check\n\nA tagged document.',
  tags: ['trial-check'], idempotency_key: key,
});

test('repeat sign-ins and new libraries preserve the original deadline and the server paywall', async () => {
  const setup = await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', { provider: 'manual' });
  expect(setup.status).toBe(200);
  const workspace = setup.data.workspaces[0].id;
  const trial = f.billing.db.prepare('SELECT * FROM cloud_billing_personal_trials WHERE user_id=?').get(f.users.josh.id);
  expect(trial.ends_at_ms - trial.starts_at_ms).toBeGreaterThan(27 * 86400000);
  expect(f.billing.getSubscription(trial.workspace_id)).toBeNull();
  const saved = await create('josh', workspace, 'before-expiry'); expect(saved.status).toBe(201);
  const end = Date.now() - 8 * 86400000;
  f.billing.db.prepare('UPDATE cloud_billing_personal_trials SET ends_at_ms=? WHERE user_id=?').run(end, f.users.josh.id);
  f.auth.signInWithVerifiedEmail(f.users.josh.email);
  const library = await f.api('josh', '/api/cloud/v1/workspaces', 'POST', { name: 'Another library', provider: 'manual', subscription_status: 'active' });
  expect(library.status).toBe(201);
  expect(f.billing.db.prepare('SELECT ends_at_ms FROM cloud_billing_personal_trials WHERE user_id=?').get(f.users.josh.id).ends_at_ms).toBe(end);
  expect(f.billing.getSubscription(trial.workspace_id)).toBeNull();
  for (const destination of [workspace, library.data.workspace.workspaceId]) expect((await create('josh', destination, 'after-' + destination)).status).toBe(402);
  expect((await f.api('josh', '/api/cloud/v1/documents/' + saved.data.document.id)).status).toBe(402);
  expect((await f.api('josh', '/api/cloud/v1/search?account_id=' + workspace + '&q=Trial')).status).toBe(402);
  const credential = f.auth._createCliCredential(f.users.josh.id, 'Reconnected agent', Date.now());
  const read = await fetch(f.origin + '/api/cloud/v1/documents/' + saved.data.document.id, { headers: { Authorization: 'Bearer ' + credential.accessToken } });
  expect(read.status).toBe(402);
});

test('historical manual accounts retain free access and historical unpaid libraries get a trial at setup', async () => {
  const historical = f.users.returning.id;
  f.auth.db.prepare('UPDATE cloud_auth_users SET created_at_ms=? WHERE id=?').run(Date.UTC(2025, 0, 1), historical);
  await f.api('returning', '/api/cloud/v1/onboarding/complete', 'POST', {});
  const state = await f.api('returning', '/api/cloud/billing/subscription');
  expect(state.data.trial_ends_at_ms).toBeNull();
  expect(f.billing.db.prepare('SELECT * FROM cloud_billing_personal_trials WHERE user_id=?').get(historical)).toBeUndefined();
  expect((await create('returning', f.personal.workspaceId, 'manual-history')).status).toBe(201);
  f.auth.db.prepare('UPDATE cloud_auth_users SET created_at_ms=? WHERE id=?').run(Date.UTC(2025, 0, 1), f.users.gmail.id);
  await f.store.ensurePersonalWorkspace(f.users.gmail.id, 'Personal');
  const setup = await f.api('gmail', '/api/cloud/v1/onboarding/complete', 'POST', {});
  expect(setup.status).toBe(200);
  const trial = f.billing.db.prepare('SELECT * FROM cloud_billing_personal_trials WHERE user_id=?').get(f.users.gmail.id);
  expect(trial.starts_at_ms).toBeGreaterThan(Date.now() - 60000);
  expect(trial.ends_at_ms).toBeGreaterThan(Date.now() + 27 * 86400000);
});

test('different verified email aliases remain separate trial identities under the current policy', async () => {
  let friendSignup;
  for (const [actor, email] of [['aliasOne', 'trial-person@example.test'], ['aliasTwo', 'trial-person+other@example.test']]) {
    const signed = f.auth.signInWithVerifiedEmail(email);
    let user = signed.user;
    user = f.auth.updateUserProfile({ userId: user.id, firstName: 'Trial', lastName: 'Person' });
    f.auth.acceptCurrentTerms({ userId: user.id, termsVersion: CURRENT_TERMS_VERSION });
    f.users[actor] = { ...user, email, cookie: 'sdocs_cloud=' + f.auth.createBrowserSession(user.id).token };
    expect((await f.api(actor, '/api/cloud/v1/onboarding/complete', 'POST', {})).status).toBe(200);
    expect(f.billing.db.prepare('SELECT * FROM cloud_billing_personal_trials WHERE user_id=?').get(user.id)).toBeTruthy();
    if (actor === 'aliasTwo') friendSignup = { ...signed, user };
  }
  const single = new (require('../lib/cloud-single-plan').SinglePlan)({ billing: f.billing, store: f.store });
  const referrals = new (require('../lib/cloud-referrals').CloudReferrals)({ billing: f.billing, auth: f.auth, store: f.store,
    single, secret: f.auth.pepper, origin: f.origin });
  referrals.rememberIntent('alias-policy-check', referrals.link(f.users.aliasOne.id).code);
  referrals.recordSignup({ ...friendSignup, intentKey: 'alias-policy-check' });
  const credential = f.auth._createCliCredential(f.users.aliasTwo.id, 'Connected agent', Date.now());
  expect((await fetch(f.origin + '/api/cloud/v1/me', { headers: { Authorization: 'Bearer ' + credential.accessToken } })).status).toBe(200);
  const account = single.ownAccount(f.users.aliasTwo.id);
  const trial = f.billing.db.prepare('SELECT * FROM cloud_billing_personal_trials WHERE user_id=?').get(f.users.aliasTwo.id);
  expect((await create('aliasTwo', trial.workspace_id, 'alias-activation')).status).toBe(201);
  referrals.recordActivity(f.users.aliasTwo.id);
  const referral = f.billing.db.prepare('SELECT * FROM cloud_referrals WHERE referred_user_id=?').get(f.users.aliasTwo.id);
  expect(referral.activation_rewarded_at_ms).not.toBeNull();
  expect(referral.paid_at_ms).toBeNull();
  expect(f.billing.getSubscription(account.id)).toBeNull();
});
