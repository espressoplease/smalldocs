const crypto = require('crypto');

const DEFAULT_TRANSACTION_TTL_MS = 10 * 60 * 1000;
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';

class OAuthError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'OAuthError';
    this.code = code;
  }
}

function requiredText(value, field, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maxLength) throw new OAuthError('invalid_' + field, field + ' is required');
  return text;
}

function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/cloud/account';
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/cloud/account';
  try {
    const parsed = new URL(value, 'https://smalldocs.invalid');
    if (parsed.origin !== 'https://smalldocs.invalid') return '/cloud/account';
    return parsed.pathname + parsed.search + parsed.hash;
  } catch (_) {
    return '/cloud/account';
  }
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function decodeJsonPart(part, code) {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch (_) {
    throw new OAuthError(code || 'invalid_id_token', 'token contains invalid JSON');
  }
}

function timingSafeText(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeTransportResponse(response) {
  if (!response || !Number.isInteger(response.status)) {
    throw new OAuthError('provider_unavailable', 'provider transport returned an invalid response');
  }
  return response;
}

async function defaultTransport(input) {
  if (typeof fetch !== 'function') throw new OAuthError('provider_unavailable', 'fetch is unavailable');
  const response = await fetch(input.url, {
    method: input.method || 'GET',
    headers: input.headers,
    body: input.body,
  });
  let json = null;
  try { json = await response.json(); } catch (_) {}
  return { status: response.status, headers: response.headers, json };
}

class OAuthTransactionStore {
  constructor(options) {
    options = options || {};
    if (!options.dbPath) throw new Error('dbPath is required');
    if (!options.pepper || Buffer.byteLength(String(options.pepper)) < 16) {
      throw new Error('pepper must contain at least 16 bytes');
    }
    const Database = require('better-sqlite3');
    this.db = new Database(options.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.pepper = String(options.pepper);
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.randomBytes = typeof options.randomBytes === 'function' ? options.randomBytes : crypto.randomBytes;
    this.ttlMs = options.ttlMs || DEFAULT_TRANSACTION_TTL_MS;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_oauth_transactions (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK(provider IN ('google', 'github')),
        state_hash TEXT NOT NULL UNIQUE,
        nonce TEXT NOT NULL,
        code_verifier TEXT NOT NULL,
        return_to TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        consumed_at_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS cloud_oauth_transactions_expiry_idx
        ON cloud_oauth_transactions(expires_at_ms, consumed_at_ms);
    `);
  }

  _hashState(state) {
    return crypto.createHmac('sha256', this.pepper).update('oauth-state\0').update(state).digest('hex');
  }

  create(input) {
    input = input || {};
    const provider = requiredText(input.provider, 'provider', 32).toLowerCase();
    if (provider !== 'google' && provider !== 'github') throw new OAuthError('invalid_provider');
    const now = this.now();
    const state = base64url(this.randomBytes(32));
    const nonce = base64url(this.randomBytes(32));
    const codeVerifier = base64url(this.randomBytes(64));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
    const id = 'oat_' + this.randomBytes(16).toString('hex');
    const expiresAtMs = now + this.ttlMs;
    this.db.prepare(`
      INSERT INTO cloud_oauth_transactions
        (id, provider, state_hash, nonce, code_verifier, return_to, created_at_ms, expires_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, provider, this._hashState(state), nonce, codeVerifier, safeReturnPath(input.returnTo), now, expiresAtMs);
    return { state, nonce, codeVerifier, codeChallenge, expiresAtMs };
  }

  consume(input) {
    input = input || {};
    const provider = requiredText(input.provider, 'provider', 32).toLowerCase();
    const state = requiredText(input.state, 'state', 1024);
    const now = this.now();
    return this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT * FROM cloud_oauth_transactions WHERE state_hash = ? AND provider = ?
      `).get(this._hashState(state), provider);
      if (!row) throw new OAuthError('invalid_oauth_state', 'OAuth state is invalid');
      if (row.consumed_at_ms != null) throw new OAuthError('oauth_state_used', 'OAuth state was already used');
      if (now >= row.expires_at_ms) throw new OAuthError('oauth_state_expired', 'OAuth state has expired');
      const claimed = this.db.prepare(`
        UPDATE cloud_oauth_transactions SET consumed_at_ms = ?
        WHERE id = ? AND consumed_at_ms IS NULL AND expires_at_ms > ?
      `).run(now, row.id, now);
      if (claimed.changes !== 1) throw new OAuthError('oauth_state_used', 'OAuth state was already used');
      return {
        provider: row.provider,
        nonce: row.nonce,
        codeVerifier: row.code_verifier,
        returnTo: row.return_to,
        expiresAtMs: row.expires_at_ms,
      };
    }).immediate();
  }

  cleanupExpired(retentionMs) {
    const retention = retentionMs == null ? 24 * 60 * 60 * 1000 : retentionMs;
    if (!Number.isSafeInteger(retention) || retention < 0) throw new Error('retentionMs must be non-negative');
    const cutoff = this.now() - retention;
    return this.db.prepare(`
      DELETE FROM cloud_oauth_transactions
      WHERE expires_at_ms < ? OR (consumed_at_ms IS NOT NULL AND consumed_at_ms < ?)
    `).run(cutoff, cutoff).changes;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

async function resolveJwks(source, transport, keyId) {
  if (typeof source === 'function') return source(keyId);
  if (source && Array.isArray(source.keys)) return source;
  const response = normalizeTransportResponse(await transport({ url: GOOGLE_JWKS_URL, method: 'GET' }));
  if (response.status !== 200 || !response.json) throw new OAuthError('provider_unavailable', 'Google keys are unavailable');
  return response.json;
}

async function verifyGoogleIdToken(token, options) {
  options = options || {};
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3 || !parts.every(Boolean)) throw new OAuthError('invalid_id_token');
  const header = decodeJsonPart(parts[0]);
  const claims = decodeJsonPart(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new OAuthError('invalid_id_token', 'Google token algorithm or key is invalid');
  }
  const jwks = await resolveJwks(options.jwks, options.transport || defaultTransport, header.kid);
  const key = jwks && Array.isArray(jwks.keys) && jwks.keys.find(candidate =>
    candidate && candidate.kid === header.kid && candidate.kty === 'RSA' &&
    (!candidate.alg || candidate.alg === 'RS256') && (!candidate.use || candidate.use === 'sig'));
  if (!key) throw new OAuthError('invalid_id_token', 'Google signing key was not found');
  let publicKey;
  try { publicKey = crypto.createPublicKey({ key, format: 'jwk' }); } catch (_) {
    throw new OAuthError('invalid_id_token', 'Google signing key is invalid');
  }
  let signature;
  try { signature = Buffer.from(parts[2], 'base64url'); } catch (_) {
    throw new OAuthError('invalid_id_token');
  }
  const validSignature = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), publicKey, signature);
  if (!validSignature) throw new OAuthError('invalid_id_token', 'Google token signature is invalid');

  const issuers = ['https://accounts.google.com', 'accounts.google.com'];
  if (!issuers.includes(claims.iss)) throw new OAuthError('invalid_id_token_issuer');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(options.clientId)) throw new OAuthError('invalid_id_token_audience');
  if (audiences.length > 1 && claims.azp !== options.clientId) {
    throw new OAuthError('invalid_id_token_audience', 'Google authorized party is invalid');
  }
  const nowSeconds = Math.floor((options.now ? options.now() : Date.now()) / 1000);
  if (!Number.isSafeInteger(claims.exp) || claims.exp <= nowSeconds) throw new OAuthError('expired_id_token');
  if (typeof claims.nonce !== 'string' || !timingSafeText(claims.nonce, options.nonce)) {
    throw new OAuthError('invalid_id_token_nonce');
  }
  if (claims.email_verified !== true) throw new OAuthError('unverified_email');
  const subject = requiredText(claims.sub, 'subject', 512);
  const email = requiredText(claims.email, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OAuthError('invalid_email');
  return { provider: 'google', subject, verifiedEmail: email };
}

function formBody(values) {
  return new URLSearchParams(values).toString();
}

function createGoogleOAuth(options) {
  options = options || {};
  const clientId = requiredText(options.clientId, 'client_id', 1000);
  const clientSecret = requiredText(options.clientSecret, 'client_secret', 2000);
  const redirectUri = requiredText(options.redirectUri, 'redirect_uri', 2000);
  const transactions = options.transactions;
  if (!transactions || typeof transactions.create !== 'function' || typeof transactions.consume !== 'function') {
    throw new Error('transactions store is required');
  }
  const transport = options.transport || defaultTransport;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const jwksCacheTtlMs = options.jwksCacheTtlMs || 5 * 60 * 1000;
  let cachedJwks = null;
  let cachedJwksUntilMs = 0;
  async function googleJwks(keyId) {
    const cacheHasKey = cachedJwks && Array.isArray(cachedJwks.keys) &&
      cachedJwks.keys.some((key) => key && key.kid === keyId);
    if (cacheHasKey && now() < cachedJwksUntilMs) return cachedJwks;
    cachedJwks = await resolveJwks(options.jwks, transport, keyId);
    cachedJwksUntilMs = now() + jwksCacheTtlMs;
    return cachedJwks;
  }
  return {
    begin(input) {
      const transaction = transactions.create({ provider: 'google', returnTo: input && input.returnTo });
      const url = new URL(GOOGLE_AUTH_URL);
      url.search = formBody({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email',
        state: transaction.state,
        nonce: transaction.nonce,
        code_challenge: transaction.codeChallenge,
        code_challenge_method: 'S256',
      });
      return { authorizationUrl: url.toString(), expiresAtMs: transaction.expiresAtMs };
    },
    async callback(input) {
      input = input || {};
      const code = requiredText(input.code, 'code', 4096);
      const transaction = transactions.consume({ provider: 'google', state: input.state });
      const response = normalizeTransportResponse(await transport({
        url: GOOGLE_TOKEN_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: formBody({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: transaction.codeVerifier,
        }),
      }));
      if (response.status !== 200 || !response.json || typeof response.json.id_token !== 'string') {
        throw new OAuthError('provider_exchange_failed', 'Google code exchange failed');
      }
      const identity = await verifyGoogleIdToken(response.json.id_token, {
        clientId,
        nonce: transaction.nonce,
        now: options.now,
        jwks: googleJwks,
        transport,
      });
      return { identity, returnTo: transaction.returnTo };
    },
  };
}

function createGitHubOAuth(options) {
  options = options || {};
  const clientId = requiredText(options.clientId, 'client_id', 1000);
  const clientSecret = requiredText(options.clientSecret, 'client_secret', 2000);
  const redirectUri = requiredText(options.redirectUri, 'redirect_uri', 2000);
  const transactions = options.transactions;
  if (!transactions || typeof transactions.create !== 'function' || typeof transactions.consume !== 'function') {
    throw new Error('transactions store is required');
  }
  const transport = options.transport || defaultTransport;
  return {
    begin(input) {
      const transaction = transactions.create({ provider: 'github', returnTo: input && input.returnTo });
      const url = new URL(GITHUB_AUTH_URL);
      url.search = formBody({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'user:email',
        state: transaction.state,
        code_challenge: transaction.codeChallenge,
        code_challenge_method: 'S256',
      });
      return { authorizationUrl: url.toString(), expiresAtMs: transaction.expiresAtMs };
    },
    async callback(input) {
      input = input || {};
      const code = requiredText(input.code, 'code', 4096);
      const transaction = transactions.consume({ provider: 'github', state: input.state });
      const exchanged = normalizeTransportResponse(await transport({
        url: GITHUB_TOKEN_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: formBody({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          code_verifier: transaction.codeVerifier,
        }),
      }));
      const tokenBody = exchanged.json;
      if (exchanged.status !== 200 || !tokenBody || typeof tokenBody.access_token !== 'string') {
        throw new OAuthError('provider_exchange_failed', 'GitHub code exchange failed');
      }
      const scopes = String(tokenBody.scope || '').split(/[,\s]+/).map(value => value.trim()).filter(Boolean);
      if (!scopes.includes('user:email')) throw new OAuthError('provider_scope_missing', 'GitHub email scope was not granted');
      const headers = {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + tokenBody.access_token,
        'X-GitHub-Api-Version': '2022-11-28',
      };
      const userResponse = normalizeTransportResponse(await transport({
        url: GITHUB_API_URL + '/user', method: 'GET', headers,
      }));
      if (userResponse.status !== 200 || !userResponse.json ||
          !Number.isSafeInteger(userResponse.json.id) || userResponse.json.id < 1) {
        throw new OAuthError('invalid_provider_identity', 'GitHub user identity is invalid');
      }
      const emailResponse = normalizeTransportResponse(await transport({
        url: GITHUB_API_URL + '/user/emails', method: 'GET', headers,
      }));
      const emails = emailResponse.status === 200 && Array.isArray(emailResponse.json) ? emailResponse.json : [];
      const selected = emails.find(item => item && item.primary === true && item.verified === true && typeof item.email === 'string');
      if (!selected) throw new OAuthError('verified_email_required', 'GitHub has no verified primary email');
      const email = selected.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        throw new OAuthError('invalid_email');
      }
      return {
        identity: { provider: 'github', subject: String(userResponse.json.id), verifiedEmail: email },
        returnTo: transaction.returnTo,
      };
    },
  };
}

function createOAuthTransactionStore(options) {
  return new OAuthTransactionStore(options);
}

module.exports = {
  DEFAULT_TRANSACTION_TTL_MS,
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_JWKS_URL,
  GITHUB_AUTH_URL,
  GITHUB_TOKEN_URL,
  GITHUB_API_URL,
  OAuthError,
  OAuthTransactionStore,
  createOAuthTransactionStore,
  createGoogleOAuth,
  createGitHubOAuth,
  verifyGoogleIdToken,
};
