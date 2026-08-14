const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function signJwt(privateKey, kid, claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = header + '.' + payload;
  return input + '.' + crypto.sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
}

module.exports = function (harness) {
  const { assert, test, testAsync } = harness;

  return async function () {
    console.log('\n-- Cloud OAuth Tests ----------------------------------\n');

    const {
      OAuthError,
      createOAuthTransactionStore,
      createGoogleOAuth,
      createGitHubOAuth,
      verifyGoogleIdToken,
    } = require('../lib/cloud-oauth');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-oauth-'));
    const dbPath = path.join(dir, 'oauth.db');
    let clock = 1700000000000;
    const transactions = createOAuthTransactionStore({
      dbPath,
      pepper: 'test-oauth-pepper-more-than-16-bytes',
      now: () => clock,
      ttlMs: 60000,
    });

    let first;
    test('transaction persists a hashed state with nonce and S256 PKCE', () => {
      first = transactions.create({ provider: 'google', returnTo: '/cloud/account?from=test' });
      assert.match(first.state, /^[A-Za-z0-9_-]{40,}$/);
      assert.match(first.nonce, /^[A-Za-z0-9_-]{40,}$/);
      assert.match(first.codeVerifier, /^[A-Za-z0-9_-]{43,128}$/);
      assert.strictEqual(first.codeChallenge,
        crypto.createHash('sha256').update(first.codeVerifier).digest('base64url'));
      const row = transactions.db.prepare('SELECT * FROM cloud_oauth_transactions').get();
      assert.notStrictEqual(row.state_hash, first.state);
      assert.strictEqual(JSON.stringify(row).includes(first.state), false);
      assert.strictEqual(row.return_to, '/cloud/account?from=test');
    });

    test('transaction is atomically consumed once and is provider bound', () => {
      assert.throws(() => transactions.consume({ provider: 'github', state: first.state }),
        error => error instanceof OAuthError && error.code === 'invalid_oauth_state');
      const consumed = transactions.consume({ provider: 'google', state: first.state });
      assert.strictEqual(consumed.nonce, first.nonce);
      assert.strictEqual(consumed.codeVerifier, first.codeVerifier);
      assert.throws(() => transactions.consume({ provider: 'google', state: first.state }),
        error => error instanceof OAuthError && error.code === 'oauth_state_used');
    });

    test('expired transaction cannot be consumed', () => {
      const created = transactions.create({ provider: 'github', returnTo: 'https://evil.example' });
      clock = created.expiresAtMs;
      assert.throws(() => transactions.consume({ provider: 'github', state: created.state }),
        error => error instanceof OAuthError && error.code === 'oauth_state_expired');
      clock += 1;
    });

    const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = 'google-key-1';
    const jwk = keys.publicKey.export({ format: 'jwk' });
    Object.assign(jwk, { kid, alg: 'RS256', use: 'sig' });

    await testAsync('Google authorization and callback use nonce and PKCE and return a verified identity', async () => {
      const calls = [];
      let expectedNonce;
      const transport = async request => {
        calls.push(request);
        if (request.url.includes('/token')) {
          const claims = {
            iss: 'https://accounts.google.com', aud: 'google-client',
            exp: Math.floor(clock / 1000) + 300, nonce: expectedNonce,
            email_verified: true, sub: 'google-user-123', email: 'Person@Example.com',
          };
          return { status: 200, json: { access_token: 'discard-me', id_token: signJwt(keys.privateKey, kid, claims) } };
        }
        throw new Error('unexpected request');
      };
      const google = createGoogleOAuth({
        clientId: 'google-client', clientSecret: 'google-secret',
        redirectUri: 'https://smalldocs.org/oauth/google/callback',
        transactions, transport, jwks: { keys: [jwk] }, now: () => clock,
      });
      const begun = google.begin({ returnTo: '/cloud/account' });
      const url = new URL(begun.authorizationUrl);
      assert.strictEqual(url.hostname, 'accounts.google.com');
      assert.strictEqual(url.searchParams.get('scope'), 'openid email');
      assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(url.searchParams.get('nonce'));
      expectedNonce = url.searchParams.get('nonce');
      const result = await google.callback({ state: url.searchParams.get('state'), code: 'google-code' });
      assert.deepStrictEqual(result.identity, {
        provider: 'google', subject: 'google-user-123', verifiedEmail: 'person@example.com',
      });
      const exchange = Object.fromEntries(new URLSearchParams(calls[0].body));
      assert.ok(exchange.code_verifier);
      assert.strictEqual(JSON.stringify(transactions.db.prepare('SELECT * FROM cloud_oauth_transactions').all()).includes('discard-me'), false);
    });

    await testAsync('Google verifier rejects bad audience, expiry, nonce, and unverified email', async () => {
      const base = {
        iss: 'accounts.google.com', aud: 'google-client', exp: Math.floor(clock / 1000) + 60,
        nonce: 'expected-nonce', email_verified: true, sub: 'subject', email: 'a@example.com',
      };
      const cases = [
        [{ iss: 'https://evil.example' }, 'invalid_id_token_issuer'],
        [{ aud: 'other-client' }, 'invalid_id_token_audience'],
        [{ aud: ['google-client', 'other-client'], azp: 'other-client' }, 'invalid_id_token_audience'],
        [{ exp: Math.floor(clock / 1000) }, 'expired_id_token'],
        [{ nonce: 'wrong' }, 'invalid_id_token_nonce'],
        [{ email_verified: false }, 'unverified_email'],
        [{ sub: '' }, 'invalid_subject'],
      ];
      for (const [change, code] of cases) {
        const token = signJwt(keys.privateKey, kid, Object.assign({}, base, change));
        await assert.rejects(verifyGoogleIdToken(token, {
          clientId: 'google-client', nonce: 'expected-nonce', now: () => clock, jwks: { keys: [jwk] },
        }), error => error instanceof OAuthError && error.code === code);
      }
    });

    await testAsync('Google verifier rejects a token signed by another key', async () => {
      const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const token = signJwt(attacker.privateKey, kid, {
        iss: 'https://accounts.google.com', aud: 'google-client', exp: Math.floor(clock / 1000) + 60,
        nonce: 'nonce', email_verified: true, sub: 'subject', email: 'a@example.com',
      });
      await assert.rejects(verifyGoogleIdToken(token, {
        clientId: 'google-client', nonce: 'nonce', now: () => clock, jwks: { keys: [jwk] },
      }), error => error instanceof OAuthError && error.code === 'invalid_id_token');
    });

    await testAsync('GitHub callback uses PKCE, numeric user ID, and verified primary email', async () => {
      const calls = [];
      const transport = async request => {
        calls.push(request);
        if (request.url.includes('/login/oauth/access_token')) {
          return { status: 200, json: { access_token: 'github-discard-me', scope: 'user:email', token_type: 'bearer' } };
        }
        if (request.url.endsWith('/user')) return { status: 200, json: { id: 987654 } };
        if (request.url.endsWith('/user/emails')) return { status: 200, json: [
          { email: 'secondary@example.com', primary: false, verified: true },
          { email: 'PRIMARY@EXAMPLE.COM', primary: true, verified: true },
        ] };
        throw new Error('unexpected request');
      };
      const github = createGitHubOAuth({
        clientId: 'github-client', clientSecret: 'github-secret',
        redirectUri: 'https://smalldocs.org/oauth/github/callback', transactions, transport,
      });
      const begun = github.begin({ returnTo: '/cloud/account' });
      const url = new URL(begun.authorizationUrl);
      assert.strictEqual(url.searchParams.get('scope'), 'user:email');
      assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256');
      const result = await github.callback({ state: url.searchParams.get('state'), code: 'github-code' });
      assert.deepStrictEqual(result.identity, {
        provider: 'github', subject: '987654', verifiedEmail: 'primary@example.com',
      });
      const exchange = Object.fromEntries(new URLSearchParams(calls[0].body));
      assert.ok(exchange.code_verifier);
      assert.ok(calls[1].headers.Authorization.includes('github-discard-me'));
      assert.strictEqual(JSON.stringify(transactions.db.prepare('SELECT * FROM cloud_oauth_transactions').all()).includes('github-discard-me'), false);
    });

    await testAsync('GitHub rejects missing email scope and missing verified primary email', async () => {
      async function run(scope, emails) {
        const transport = async request => {
          if (request.url.includes('/access_token')) return { status: 200, json: { access_token: 'token', scope } };
          if (request.url.endsWith('/user')) return { status: 200, json: { id: 42 } };
          return { status: 200, json: emails };
        };
        const github = createGitHubOAuth({
          clientId: 'id', clientSecret: 'secret', redirectUri: 'https://example.com/callback',
          transactions, transport,
        });
        const begun = github.begin();
        return github.callback({ state: new URL(begun.authorizationUrl).searchParams.get('state'), code: 'code' });
      }
      await assert.rejects(run('read:user', []), error => error.code === 'provider_scope_missing');
      await assert.rejects(run('user:email', [{ email: 'a@example.com', primary: true, verified: false }]),
        error => error.code === 'verified_email_required');
    });

    test('expired and consumed transactions can be cleaned after retention', () => {
      const before = transactions.db.prepare('SELECT COUNT(*) AS n FROM cloud_oauth_transactions').get().n;
      clock += 24 * 60 * 60 * 1000 + 60001;
      const removed = transactions.cleanupExpired(24 * 60 * 60 * 1000);
      assert.ok(removed > 0);
      assert.ok(transactions.db.prepare('SELECT COUNT(*) AS n FROM cloud_oauth_transactions').get().n < before);
    });

    transactions.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
};

if (require.main === module) {
  const harness = require('./runner');
  Promise.resolve(module.exports(harness)()).then(() => harness.report());
}
