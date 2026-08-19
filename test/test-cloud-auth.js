const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function(harness) {
  const { assert, test } = harness;

  return function() {
    console.log('\n-- Cloud Authentication Tests -------------------------\n');

    const { AuthError, createAuthStore } = require('../lib/cloud-auth');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-auth-'));
    const dbPath = path.join(dir, 'auth.db');
    let clock = 1700000000000;
    const auth = createAuthStore({
      dbPath,
      pepper: 'test-only-pepper-with-more-than-16-bytes',
      now: () => clock,
      codeTtlMs: 60000,
      sessionTtlMs: 120000,
      maxCodeAttempts: 3,
      issueLimit: 2,
      issueWindowMs: 30000,
    });

    let googleUser;
    let githubUser;

    test('external identities create users without putting email on the user row', () => {
      const result = auth.signInWithExternalIdentity({
        provider: 'google', subject: 'google-123', verifiedEmail: ' Person@Example.com ',
      });
      googleUser = result.user;
      assert.strictEqual(result.created, true);
      assert.strictEqual(googleUser.email, undefined);
      assert.strictEqual(googleUser.identities[0].verifiedEmail, 'person@example.com');
      const row = auth.db.prepare('SELECT * FROM cloud_auth_users WHERE id = ?').get(googleUser.id);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(row, 'email'), false);
    });

    test('matching provider subject signs into the existing user', () => {
      const result = auth.signInWithExternalIdentity({
        provider: 'google', subject: 'google-123', verifiedEmail: 'person@example.com',
      });
      assert.strictEqual(result.created, false);
      assert.strictEqual(result.user.id, googleUser.id);
    });

    test('a user stores normalized required names', () => {
      const updated = auth.updateUserProfile({ userId: googleUser.id,
        firstName: '  Josh  ', lastName: '  Summers  ' });
      assert.strictEqual(updated.firstName, 'Josh');
      assert.strictEqual(updated.lastName, 'Summers');
      assert.throws(() => auth.updateUserProfile({ userId: googleUser.id,
        firstName: '   ', lastName: '' }),
        (error) => error instanceof AuthError && error.code === 'invalid_request');
    });

    test('user profiles do not retain a display-name column', () => {
      const columns = auth.db.prepare('PRAGMA table_info(cloud_auth_users)').all()
        .map((column) => column.name);
      assert.strictEqual(columns.includes('display_name'), false);
    });

    test('matching email from another provider does not auto-link accounts', () => {
      const result = auth.signInWithExternalIdentity({
        provider: 'github', subject: 'github-456', verifiedEmail: 'person@example.com',
      });
      githubUser = result.user;
      assert.notStrictEqual(githubUser.id, googleUser.id);
      assert.strictEqual(auth.db.prepare('SELECT COUNT(*) AS n FROM cloud_auth_users').get().n, 2);
    });

    test('explicit external identity linking requires an active session', () => {
      assert.throws(() => auth.linkExternalIdentity({
        provider: 'github', subject: 'new-github', verifiedEmail: 'person@example.com',
      }), (error) => error instanceof AuthError && error.code === 'authentication_required');
      const session = auth.createBrowserSession(googleUser.id);
      const user = auth.linkExternalIdentity({
        sessionToken: session.token,
        provider: 'github', subject: 'new-github', verifiedEmail: 'person@example.com',
      });
      assert.strictEqual(user.id, googleUser.id);
      assert.strictEqual(user.identities.length, 2);
    });

    test('an identity already owned by another user cannot be linked', () => {
      const session = auth.createBrowserSession(googleUser.id);
      assert.throws(() => auth.linkExternalIdentity({
        sessionToken: session.token,
        provider: 'github', subject: 'github-456', verifiedEmail: 'person@example.com',
      }), (error) => error instanceof AuthError && error.code === 'identity_in_use');
    });

    let emailIssue;
    test('email codes are normalized and stored as keyed hashes', () => {
      emailIssue = auth.issueEmailCode({ email: ' New@Example.com ', ip: '192.0.2.1' });
      assert.match(emailIssue.code, /^\d{6}$/);
      const row = auth.db.prepare('SELECT * FROM cloud_auth_email_codes WHERE id = ?').get(emailIssue.requestId);
      assert.strictEqual(row.email, 'new@example.com');
      assert.notStrictEqual(row.code_hash, emailIssue.code);
      assert.strictEqual(JSON.stringify(row).includes(emailIssue.code), false);
    });

    let emailUser;
    test('a valid email code is consumed once and creates an email identity', () => {
      const result = auth.consumeEmailCode({ requestId: emailIssue.requestId, code: emailIssue.code });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.created, true);
      emailUser = result.user;
      assert.strictEqual(emailUser.identities[0].provider, 'email');
      assert.strictEqual(emailUser.identities[0].subject, 'new@example.com');
      assert.strictEqual(auth.consumeEmailCode({ requestId: emailIssue.requestId, code: emailIssue.code }).reason, 'already_used');
    });

    test('a trusted verified email sign-in reuses the email identity', () => {
      const result = auth.signInWithVerifiedEmail(' New@Example.com ');
      assert.strictEqual(result.created, false);
      assert.strictEqual(result.user.id, emailUser.id);
      assert.throws(() => auth.signInWithVerifiedEmail('not-an-email'),
        (error) => error instanceof AuthError && error.code === 'invalid_email');
    });

    test('email codes expire at their expiry boundary', () => {
      clock += 31000;
      const issue = auth.issueEmailCode({ email: 'expired@example.com' });
      clock = issue.expiresAtMs;
      const result = auth.consumeEmailCode({ requestId: issue.requestId, code: issue.code });
      assert.deepStrictEqual(result, { ok: false, reason: 'expired' });
      clock += 1;
    });

    test('requesting another email code invalidates the previous challenge', () => {
      const first = auth.issueEmailCode({ email: 'resend@example.com' });
      const second = auth.issueEmailCode({ email: 'resend@example.com' });
      assert.strictEqual(auth.consumeEmailCode({ requestId: first.requestId, code: first.code }).reason, 'already_used');
      assert.strictEqual(auth.consumeEmailCode({ requestId: second.requestId, code: second.code }).ok, true);
    });

    test('wrong email codes consume attempts and lock the request', () => {
      const issue = auth.issueEmailCode({ email: 'attempts@example.com' });
      assert.strictEqual(auth.consumeEmailCode({ requestId: issue.requestId, code: '999999' }).attemptsRemaining, 2);
      assert.strictEqual(auth.consumeEmailCode({ requestId: issue.requestId, code: '999999' }).attemptsRemaining, 1);
      assert.strictEqual(auth.consumeEmailCode({ requestId: issue.requestId, code: '999999' }).reason, 'attempts_exceeded');
      assert.strictEqual(auth.consumeEmailCode({ requestId: issue.requestId, code: issue.code }).reason, 'attempts_exceeded');
    });

    test('rate guards hash subjects and stop recording after the limit', () => {
      const first = auth.consumeRateLimit({ action: 'test_action', key: 'raw-subject', limit: 2, windowMs: 1000 });
      const second = auth.consumeRateLimit({ action: 'test_action', key: 'raw-subject', limit: 2, windowMs: 1000 });
      const third = auth.consumeRateLimit({ action: 'test_action', key: 'raw-subject', limit: 2, windowMs: 1000 });
      assert.deepStrictEqual([first.allowed, second.allowed, third.allowed], [true, true, false]);
      const rows = auth.db.prepare("SELECT * FROM cloud_auth_rate_events WHERE action = 'test_action'").all();
      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows.some((row) => row.subject_hash.includes('raw-subject')), false);
      assert.strictEqual(auth.countRateLimit({ action: 'test_action', key: 'raw-subject',
        windowMs: 1000 }), 2);
      clock += 1001;
      assert.strictEqual(auth.countRateLimit({ action: 'test_action', key: 'raw-subject',
        windowMs: 1000 }), 0);
    });

    test('email issue limits apply to normalized email and IP', () => {
      const base = clock;
      auth.issueEmailCode({ email: 'limited@example.com', ip: '198.51.100.4' });
      auth.issueEmailCode({ email: 'LIMITED@example.com', ip: '198.51.100.4' });
      assert.throws(() => auth.issueEmailCode({ email: 'limited@example.com', ip: '198.51.100.4' }),
        (error) => error instanceof AuthError && error.code === 'rate_limited' && error.retryAfterMs > 0);
      clock = base + 30001;
      assert.ok(auth.issueEmailCode({ email: 'limited@example.com', ip: '198.51.100.4' }).requestId);
    });

    test('link-purpose email codes require a session and attach to that user', () => {
      assert.throws(() => auth.issueEmailCode({ email: 'linked@example.com', purpose: 'link' }),
        (error) => error instanceof AuthError && error.code === 'authentication_required');
      const session = auth.createBrowserSession(googleUser.id);
      const issue = auth.issueEmailCode({
        email: 'linked@example.com', purpose: 'link', sessionToken: session.token,
      });
      const result = auth.consumeEmailCode({ requestId: issue.requestId, code: issue.code });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.user.id, googleUser.id);
      assert.ok(result.user.identities.some((identity) => identity.provider === 'email'));
    });

    test('an email identity owned by another user cannot be linked', () => {
      const session = auth.createBrowserSession(googleUser.id);
      const issue = auth.issueEmailCode({
        email: 'new@example.com', purpose: 'link', sessionToken: session.token,
      });
      const result = auth.consumeEmailCode({ requestId: issue.requestId, code: issue.code });
      assert.deepStrictEqual(result, { ok: false, reason: 'identity_in_use' });
      assert.strictEqual(auth.consumeEmailCode({ requestId: issue.requestId, code: issue.code }).reason,
        'already_used');
      assert.strictEqual(auth.getUser(emailUser.id).identities[0].subject, 'new@example.com');
    });

    test('browser sessions store only a keyed token hash', () => {
      const session = auth.createBrowserSession(githubUser.id);
      const row = auth.db.prepare('SELECT token_hash FROM cloud_auth_sessions WHERE id = ?').get(session.id);
      assert.notStrictEqual(row.token_hash, session.token);
      assert.strictEqual(row.token_hash.includes(session.token), false);
      const result = auth.authenticateSession(session.token);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.user.id, githubUser.id);
    });

    test('browser sessions expire and can be revoked', () => {
      const expiring = auth.createBrowserSession(githubUser.id, { ttlMs: 1000 });
      clock = expiring.expiresAtMs;
      assert.strictEqual(auth.authenticateSession(expiring.token).reason, 'expired');

      clock += 1;
      const revocable = auth.createBrowserSession(githubUser.id);
      assert.strictEqual(auth.revokeSession({ sessionToken: revocable.token }), true);
      assert.strictEqual(auth.authenticateSession(revocable.token).reason, 'revoked');
    });

    let cliCredential;
    let originalRefresh;
    test('device authorization stores only keyed device and user codes', () => {
      const issued = auth.issueDeviceAuthorization({ displayName: 'Josh MacBook' });
      originalRefresh = issued;
      const row = auth.db.prepare('SELECT * FROM cloud_cli_device_authorizations WHERE id = ?').get(issued.id);
      assert.notStrictEqual(row.device_code_hash, issued.deviceCode);
      assert.strictEqual(row.device_code_hash.includes(issued.deviceCode), false);
      assert.notStrictEqual(row.user_code_hash, issued.userCode.replace('-', ''));
      assert.strictEqual(auth.getDeviceAuthorization(issued.userCode).displayName, 'Josh MacBook');
      assert.deepStrictEqual(auth.pollDeviceAuthorization({ deviceCode: issued.deviceCode }), {
        ok: false, reason: 'authorization_pending',
      });
    });

    test('approved device authorization issues one persistent CLI credential', () => {
      auth.approveDeviceAuthorization({ userCode: originalRefresh.userCode, userId: googleUser.id });
      cliCredential = auth.pollDeviceAuthorization({ deviceCode: originalRefresh.deviceCode });
      assert.strictEqual(cliCredential.ok, true);
      assert.strictEqual(cliCredential.userId, googleUser.id);
      assert.strictEqual(auth.pollDeviceAuthorization({ deviceCode: originalRefresh.deviceCode }).reason, 'expired_token');
      const access = auth.authenticateAccessToken(cliCredential.accessToken);
      assert.strictEqual(access.ok, true);
      assert.strictEqual(access.credential.id, cliCredential.credentialId);
      const row = auth.db.prepare('SELECT * FROM cloud_cli_credentials WHERE id = ?').get(cliCredential.credentialId);
      assert.strictEqual(row.refresh_token_hash.includes(cliCredential.refreshToken), false);
    });

    test('refresh rotates both tokens and revokes the previous access token', () => {
      const previousAccess = cliCredential.accessToken;
      const previousRefresh = cliCredential.refreshToken;
      const refreshed = auth.refreshCliCredential({ refreshToken: previousRefresh });
      assert.strictEqual(refreshed.ok, true);
      assert.notStrictEqual(refreshed.refreshToken, previousRefresh);
      assert.notStrictEqual(refreshed.accessToken, previousAccess);
      assert.strictEqual(auth.authenticateAccessToken(previousAccess).ok, false);
      assert.strictEqual(auth.authenticateAccessToken(refreshed.accessToken).ok, true);
      assert.throws(() => auth.refreshCliCredential({ refreshToken: previousRefresh }),
        (error) => error instanceof AuthError && error.code === 'token_reuse');
      assert.strictEqual(auth.authenticateAccessToken(refreshed.accessToken).ok, false);
    });

    test('users can inspect and revoke CLI installations', () => {
      const device = auth.issueDeviceAuthorization({ displayName: 'Build machine' });
      auth.approveDeviceAuthorization({ userCode: device.userCode, userId: googleUser.id });
      const credential = auth.pollDeviceAuthorization({ deviceCode: device.deviceCode });
      assert.ok(auth.listCliCredentials(googleUser.id).some((item) => item.id === credential.credentialId));
      auth.revokeCliCredential({ userId: googleUser.id, credentialId: credential.credentialId });
      assert.strictEqual(auth.authenticateAccessToken(credential.accessToken).ok, false);
    });

    test('a user cannot revoke another user session by id', () => {
      const actor = auth.createBrowserSession(googleUser.id);
      const target = auth.createBrowserSession(githubUser.id);
      assert.strictEqual(auth.revokeSession({ sessionToken: actor.token, targetSessionId: target.id }), false);
      assert.strictEqual(auth.authenticateSession(target.token).ok, true);
    });

    test('expired authentication records can be pruned after retention', () => {
      const issue = auth.issueEmailCode({ email: 'cleanup@example.com' });
      const session = auth.createBrowserSession(googleUser.id, { ttlMs: 1000 });
      auth.consumeRateLimit({ action: 'cleanup_test', key: 'subject', limit: 2, windowMs: 1000 });
      clock = Math.max(issue.expiresAtMs, session.expiresAtMs) + 2000;
      const cleaned = auth.cleanupExpired({ authRetentionMs: 1000, rateRetentionMs: 1000 });
      assert.ok(cleaned.codes >= 1);
      assert.ok(cleaned.sessions >= 1);
      assert.ok(cleaned.rateEvents >= 1);
    });

    auth.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
};

if (require.main === module) {
  const harness = require('./runner');
  module.exports(harness)();
  harness.report();
}
