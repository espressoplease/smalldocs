const fs = require('fs'), os = require('os'), path = require('path');
module.exports = function ({ assert, test }) {
  const { createAuthStore } = require('../lib/cloud-auth');
  const { IdentityLinking } = require('../lib/cloud-auth-linking');
  function scenario(name, run) {
    test(name, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-link-test-'));
      let now = Date.now();
      const auth = createAuthStore({ dbPath: path.join(dir, 'auth.db'), pepper: 'identity-linking-test-only-secret', now: () => now });
      try { run(auth, new IdentityLinking(auth), ms => { now += ms; }); }
      finally { auth.close(); fs.rmSync(dir, { recursive: true, force: true }); }
    });
  }
  const google = (email, extra = {}) => ({ provider: 'google', subject: 'google-' + email, verifiedEmail: email,
    emailAuthoritative: true, ...extra });
  scenario('Google first and email first converge on one permanent user', (auth, link) => {
    const first = link.signInGoogle(google('first@gmail.com'));
    assert.strictEqual(auth.signInWithVerifiedEmail('FIRST@gmail.com').user.id, first.user.id);
    const other = auth.signInWithVerifiedEmail('work@company.test').user;
    assert.strictEqual(link.signInGoogle(google('work@company.test')).user.id, other.id);
    assert.strictEqual(auth.db.prepare('SELECT COUNT(*) AS n FROM cloud_auth_users').get().n, 2);
  });
  scenario('legacy Gmail identities gain the same email-code login', (auth) => {
    const legacy = auth.signInWithExternalIdentity(google('legacy@gmail.com')).user;
    assert.strictEqual(auth.signInWithVerifiedEmail('legacy@gmail.com').user.id, legacy.id);
  });
  scenario('third-party Google addresses require fresh mailbox proof', (auth, link) => {
    const identity = google('third@company.test', { emailAuthoritative: false });
    assert.throws(() => link.signInGoogle(identity), e => e.code === 'email_confirmation_required');
    assert.strictEqual(auth.db.prepare('SELECT COUNT(*) AS n FROM cloud_auth_users').get().n, 0);
    const existing = auth.signInWithVerifiedEmail(identity.verifiedEmail).user;
    const token = link.createContext({ identity, returnTo: '/library?scope=cloud' });
    const code = auth.issueEmailCode({ email: identity.verifiedEmail });
    link.setChallenge(token, null, code.requestId);
    const result = link.complete(token, null, { challenge_id: code.requestId, code: code.code });
    assert.strictEqual(result.user.id, existing.id);
    assert.strictEqual(result.returnTo, '/library?scope=cloud');
    assert.throws(() => link.complete(token, null, {}), e => e.code === 'link_expired');
    assert.strictEqual(auth.consumeEmailCode({ requestId: code.requestId, code: code.code }).reason, 'already_used');
  });
  scenario('wrong and unrelated email challenges cannot finish a Google connection', (auth, link) => {
    const identity = google('pending@company.test', { emailAuthoritative: false });
    const token = link.createContext({ identity, returnTo: '/library' });
    const code = auth.issueEmailCode({ email: identity.verifiedEmail });
    link.setChallenge(token, null, code.requestId);
    assert.strictEqual(link.complete(token, null, { challenge_id: 'another', code: code.code }).ok, false);
    const wrong = code.code === '111111' ? '222222' : '111111';
    assert.strictEqual(link.complete(token, null, { challenge_id: code.requestId, code: wrong }).ok, false);
    assert.strictEqual(auth.db.prepare('SELECT COUNT(*) AS n FROM cloud_auth_users').get().n, 0);
    assert.strictEqual(link.complete(token, null, { challenge_id: code.requestId, code: code.code }).ok, true);
  });
  scenario('even a correctly entered code for a different mailbox is rejected atomically', (auth, link) => {
    const token = link.createContext({ identity: google('intended@company.test', { emailAuthoritative: false }), returnTo: '/library' });
    const other = auth.issueEmailCode({ email: 'another@company.test' });
    link.setChallenge(token, null, other.requestId);
    assert.throws(() => link.complete(token, null, { challenge_id: other.requestId, code: other.code }), e => e.code === 'invalid_code');
    assert.strictEqual(auth.db.prepare('SELECT COUNT(*) AS n FROM cloud_auth_users').get().n, 0);
    assert.strictEqual(auth.consumeEmailCode({ requestId: other.requestId, code: other.code }).ok, true);
  });
  scenario('explicit Google linking requires the original recent browser session', (auth, link) => {
    const target = auth.signInWithVerifiedEmail('primary@company.test').user;
    const session = auth.createBrowserSession(target.id), anotherSession = auth.createBrowserSession(target.id);
    const token = link.createContext({ identity: google('alternate@gmail.com'), sessionToken: session.token, returnTo: '/cloud/admin?panel=preferences' });
    assert.throws(() => link.complete(token, null), e => e.code === 'recent_auth_required');
    assert.throws(() => link.complete(token, anotherSession.token), e => e.code === 'authentication_required');
    const connected = link.complete(token, session.token);
    assert.strictEqual(connected.user.id, target.id);
    assert.strictEqual(connected.linked, true);
    assert.strictEqual(auth.signInWithVerifiedEmail('alternate@gmail.com').user.id, target.id);
  });
  scenario('ordinary Google login never links to an unrelated browser user', (auth, link) => {
    const owner = auth.signInWithVerifiedEmail('owner@company.test').user;
    auth.createBrowserSession(owner.id);
    const guest = link.signInGoogle(google('guest@gmail.com')).user;
    assert.notStrictEqual(guest.id, owner.id);
    assert.strictEqual(auth.getUser(owner.id).identities.length, 1);
  });
  scenario('existing accounts are never merged or moved by explicit connection', (auth, link) => {
    const first = auth.signInWithVerifiedEmail('first@company.test').user;
    const second = link.signInGoogle(google('second@gmail.com')).user;
    const session = auth.createBrowserSession(first.id);
    const token = link.createContext({ identity: google('second@gmail.com'), sessionToken: session.token, returnTo: '/library' });
    assert.throws(() => link.complete(token, session.token), e => e.code === 'identity_in_use');
    assert.strictEqual(link.signInGoogle(google('second@gmail.com')).user.id, second.id);
    assert.strictEqual(auth.getUser(first.id).identities.length, 1);
  });
  scenario('provider subject remains stable when its authoritative email changes', (auth, link) => {
    const original = link.signInGoogle(google('before@company.test', { subject: 'stable-subject' })).user;
    const other = auth.signInWithVerifiedEmail('after@company.test').user;
    const changed = link.signInGoogle(google('after@company.test', { subject: 'stable-subject' })).user;
    assert.strictEqual(changed.id, original.id);
    assert.strictEqual(auth.signInWithVerifiedEmail('after@company.test').user.id, other.id);
    assert.strictEqual(auth.getUser(other.id).identities.length, 1);
  });
  scenario('pending contexts expire and store only hashed browser tokens', (auth, link, advance) => {
    const token = link.createContext({ identity: google('expiry@gmail.com'), returnTo: '/library' });
    const row = auth.db.prepare('SELECT * FROM cloud_auth_link_contexts').get();
    assert.notStrictEqual(row.token_hash, token);
    assert.strictEqual(JSON.stringify(row).includes(token), false);
    advance(600001);
    assert.throws(() => link.context(token), e => e.code === 'link_expired');
  });
  scenario('OAuth linking intent is consumed once and requires the bound browser', (auth, link) => {
    const owner = auth.signInWithVerifiedEmail('intent@company.test').user;
    const session = auth.createBrowserSession(owner.id);
    const token = link.createContext({ token: 'opaque-oauth-state', sessionToken: session.token, returnTo: '/cloud/admin' });
    assert.throws(() => link.finishIntent(token, null), e => e.code === 'recent_auth_required');
    assert.strictEqual(link.finishIntent(token, session.token).target_user_id, owner.id);
    assert.throws(() => link.finishIntent(token, session.token), e => e.code === 'link_expired');
    assert.strictEqual(link.finishIntent('unknown', session.token), null);
  });
  scenario('old and revoked sessions cannot connect another sign-in method', (auth, link, advance) => {
    const user = auth.signInWithVerifiedEmail('recent@company.test').user;
    const session = auth.createBrowserSession(user.id);
    advance(30 * 60 * 1000 + 1);
    assert.throws(() => link.createContext({ sessionToken: session.token, returnTo: '/library' }), e => e.code === 'recent_auth_required');
    const fresh = auth.createBrowserSession(user.id);
    auth.revokeSession({ sessionToken: fresh.token });
    assert.throws(() => link.recentSession(fresh.token), e => e.code === 'recent_auth_required');
  });
  scenario('email connection codes cannot be stolen from their target user', (auth) => {
    const target = auth.signInWithVerifiedEmail('target@company.test').user;
    const other = auth.signInWithVerifiedEmail('other@company.test').user;
    const session = auth.createBrowserSession(target.id), outsider = auth.createBrowserSession(other.id);
    const code = auth.issueEmailCode({ email: 'alias@company.test', purpose: 'link', sessionToken: session.token });
    for (const sessionToken of [undefined, outsider.token]) {
      assert.strictEqual(auth.consumeEmailCode({ requestId: code.requestId, code: code.code, sessionToken }).reason, 'authentication_required');
    }
    assert.strictEqual(auth.consumeEmailCode({ requestId: code.requestId, code: code.code, sessionToken: session.token }).user.id, target.id);
  });
  scenario('expired email proof cannot create a Google account', (auth, link, advance) => {
    const identity = google('code-expiry@company.test', { emailAuthoritative: false });
    const token = link.createContext({ identity, returnTo: '/library' });
    const code = auth.issueEmailCode({ email: identity.verifiedEmail });
    link.setChallenge(token, null, code.requestId);
    auth.db.prepare('UPDATE cloud_auth_email_codes SET expires_at_ms=? WHERE id=?').run(auth.now() + 1000, code.requestId);
    advance(1000);
    assert.strictEqual(link.complete(token, null, { challenge_id: code.requestId, code: code.code }).reason, 'expired');
    assert.strictEqual(auth.db.prepare('SELECT COUNT(*) AS n FROM cloud_auth_users').get().n, 0);
  });
  scenario('linking uses the configured recent-authentication window', (auth, _, advance) => {
    const link = new IdentityLinking(auth, { recentAuthMs: 1000 });
    const user = auth.signInWithVerifiedEmail('window@company.test').user;
    const session = auth.createBrowserSession(user.id);
    advance(1001);
    assert.throws(() => link.recentSession(session.token), e => e.code === 'recent_auth_required');
  });
  scenario('disabled owners cannot be revived through another sign-in method', (auth, link) => {
    const user = auth.signInWithVerifiedEmail('disabled@gmail.com').user;
    auth.db.prepare('UPDATE cloud_auth_users SET disabled_at_ms=? WHERE id=?').run(auth.now(), user.id);
    assert.throws(() => link.signInGoogle(google('disabled@gmail.com')), e => e.code === 'invalid_user');
    assert.strictEqual(auth.getUser(user.id).identities.length, 1);
  });
};
