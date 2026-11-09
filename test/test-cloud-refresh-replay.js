const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function ({ assert, testAsync }) {
  const { createAuthStore, CURRENT_TERMS_VERSION } = require('../lib/cloud-auth');
  const requestId = () => crypto.randomBytes(32).toString('base64url');
  async function scenario(name, run) {
    await testAsync(name, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-refresh-replay-'));
      let now = Date.now();
      const options = { dbPath: path.join(dir, 'auth.db'), pepper: 'refresh-replay-fixture-secret', now: () => now };
      const fixture = { auth: createAuthStore(options), options,
        advance: ms => { now += ms; },
        reopen() { this.auth.close(); this.auth = createAuthStore(options); },
        issue() {
          const user = this.auth.signInWithVerifiedEmail(crypto.randomUUID() + '@company.test').user;
          this.auth.acceptCurrentTerms({ userId: user.id, termsVersion: CURRENT_TERMS_VERSION });
          return this.auth._createCliCredential(user.id, 'Laptop', now);
        } };
      try { await run(fixture); }
      finally { fixture.auth.close(); fs.rmSync(dir, { recursive: true, force: true }); }
    });
  }

  return async function () {
    await scenario('replaying any consumed refresh token revokes the current installation family', async f => {
      const first = f.issue(), other = f.issue();
      let current = first;
      for (let i = 0; i < 4; i++) current = f.auth.refreshCliCredential({ refreshToken: current.refreshToken, requestId: requestId() });
      assert.strictEqual(f.auth.db.prepare('SELECT COUNT(*) AS n FROM cloud_cli_consumed_refresh_tokens WHERE credential_id=?').get(first.credentialId).n, 4);
      assert.throws(() => f.auth.refreshCliCredential({ refreshToken: first.refreshToken, requestId: requestId() }), error => error.code === 'token_reuse');
      assert.strictEqual(f.auth.authenticateAccessToken(current.accessToken).ok, false);
      assert.throws(() => f.auth.refreshCliCredential({ refreshToken: current.refreshToken }), error => error.code === 'invalid_token');
      assert.strictEqual(f.auth.authenticateAccessToken(other.accessToken).ok, true);
    });

    await scenario('the most recent lost-response retry still recovers the same rotation', async f => {
      const first = f.issue(), id = requestId();
      const current = f.auth.refreshCliCredential({ refreshToken: first.refreshToken, requestId: id });
      assert.deepStrictEqual(f.auth.refreshCliCredential({ refreshToken: first.refreshToken, requestId: id }), current);
      f.advance(3600000);
      const recovered = f.auth.refreshCliCredential({ refreshToken: first.refreshToken, requestId: id });
      assert.strictEqual(recovered.refreshToken, current.refreshToken);
      assert.strictEqual(recovered.accessToken, current.accessToken);
      assert.strictEqual(f.auth.authenticateAccessToken(recovered.accessToken).ok, true);
      assert.strictEqual(f.auth.db.prepare('SELECT COUNT(*) AS n FROM cloud_cli_consumed_refresh_tokens').get().n, 1);
      f.auth.refreshCliCredential({ refreshToken: current.refreshToken, requestId: requestId() });
      assert.throws(() => f.auth.refreshCliCredential({ refreshToken: first.refreshToken, requestId: id }), error => error.code === 'token_reuse');
    });

    await scenario('deployed previous hashes migrate without invalidating credentials or safe retries', async f => {
      const first = f.issue(), id = requestId();
      const current = f.auth.refreshCliCredential({ refreshToken: first.refreshToken, requestId: id });
      f.auth.db.exec('DROP TABLE cloud_cli_consumed_refresh_tokens');
      f.reopen();
      assert.strictEqual(f.auth.authenticateAccessToken(current.accessToken).ok, true);
      assert.strictEqual(f.auth.db.prepare('SELECT credential_id FROM cloud_cli_consumed_refresh_tokens').get().credential_id, first.credentialId);
      assert.deepStrictEqual(f.auth.refreshCliCredential({ refreshToken: first.refreshToken, requestId: id }), current);
      f.auth.refreshCliCredential({ refreshToken: current.refreshToken, requestId: requestId() });
      assert.throws(() => f.auth.refreshCliCredential({ refreshToken: first.refreshToken, requestId: id }), error => error.code === 'token_reuse');
    });

    await scenario('rotation failure rolls back consumed hashes and keeps the previous credential usable', async f => {
      const first = f.issue();
      const create = f.auth._createAccessToken;
      f.auth._createAccessToken = () => { throw new Error('injected access failure'); };
      try {
        assert.throws(() => f.auth.refreshCliCredential({ refreshToken: first.refreshToken, requestId: requestId() }), /injected access failure/);
      } finally { f.auth._createAccessToken = create; }
      assert.strictEqual(f.auth.db.prepare('SELECT COUNT(*) AS n FROM cloud_cli_consumed_refresh_tokens').get().n, 0);
      assert.strictEqual(f.auth.authenticateAccessToken(first.accessToken).ok, true);
      const current = f.auth.refreshCliCredential({ refreshToken: first.refreshToken, requestId: requestId() });
      assert.strictEqual(f.auth.authenticateAccessToken(current.accessToken).ok, true);
    });

    await scenario('replay revocation updates credentials and access tokens atomically', async f => {
      const first = f.issue();
      const next = f.auth.refreshCliCredential({ refreshToken: first.refreshToken });
      const current = f.auth.refreshCliCredential({ refreshToken: next.refreshToken });
      f.auth.db.exec(`CREATE TEMP TRIGGER reject_access_revocation BEFORE UPDATE OF revoked_at_ms ON cloud_cli_access_tokens
        BEGIN SELECT RAISE(ABORT, 'injected revocation failure'); END`);
      assert.throws(() => f.auth.refreshCliCredential({ refreshToken: first.refreshToken }), /injected revocation failure/);
      assert.strictEqual(f.auth.authenticateAccessToken(current.accessToken).ok, true);
      assert.strictEqual(f.auth.listCliCredentials(first.userId)[0].revokedAtMs, null);
      f.auth.db.exec('DROP TRIGGER reject_access_revocation');
      assert.throws(() => f.auth.refreshCliCredential({ refreshToken: first.refreshToken }), error => error.code === 'token_reuse');
      assert.strictEqual(f.auth.authenticateAccessToken(current.accessToken).ok, false);
    });

    await scenario('consumed family history persists across processes without plaintext credentials', async f => {
      const first = f.issue();
      const next = f.auth.refreshCliCredential({ refreshToken: first.refreshToken, requestId: requestId() });
      const current = f.auth.refreshCliCredential({ refreshToken: next.refreshToken, requestId: requestId() });
      const stored = JSON.stringify(f.auth.db.prepare('SELECT * FROM cloud_cli_consumed_refresh_tokens').all());
      for (const token of [first.refreshToken, next.refreshToken, current.refreshToken]) assert.ok(!stored.includes(token));
      f.reopen();
      const secondConnection = createAuthStore(f.options);
      try {
        assert.throws(() => secondConnection.refreshCliCredential({ refreshToken: first.refreshToken }), error => error.code === 'token_reuse');
        assert.strictEqual(f.auth.authenticateAccessToken(current.accessToken).ok, false);
      } finally { secondConnection.close(); }
    });
  };
};
