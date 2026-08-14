const crypto = require('crypto');

const DEFAULT_CODE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_CODE_ATTEMPTS = 5;
const DEFAULT_ISSUE_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_ISSUE_LIMIT = 5;
const DEFAULT_DEVICE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_ACCESS_TTL_MS = 15 * 60 * 1000;

class AuthError extends Error {
  constructor(code, message, detail) {
    super(message || code);
    this.name = 'AuthError';
    this.code = code;
    if (detail) Object.assign(this, detail);
  }
}

function normalizeEmail(value) {
  if (typeof value !== 'string') throw new AuthError('invalid_email', 'email must be a string');
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError('invalid_email', 'email is not valid');
  }
  return email;
}

function normalizeIdentity(input) {
  const provider = input && typeof input.provider === 'string' ? input.provider.trim().toLowerCase() : '';
  const subject = input && typeof input.subject === 'string' ? input.subject.trim() : '';
  if (!provider || provider === 'email' || !/^[a-z0-9_-]{1,32}$/.test(provider)) {
    throw new AuthError('invalid_provider', 'provider must identify an external login provider');
  }
  if (!subject || subject.length > 512) throw new AuthError('invalid_subject', 'identity subject is required');
  const verifiedEmail = input.verifiedEmail == null ? null : normalizeEmail(input.verifiedEmail);
  return { provider, subject, verifiedEmail };
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

class CloudAuthStore {
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
    this.codeTtlMs = options.codeTtlMs || DEFAULT_CODE_TTL_MS;
    this.sessionTtlMs = options.sessionTtlMs || DEFAULT_SESSION_TTL_MS;
    this.maxCodeAttempts = options.maxCodeAttempts || DEFAULT_MAX_CODE_ATTEMPTS;
    this.issueWindowMs = options.issueWindowMs || DEFAULT_ISSUE_WINDOW_MS;
    this.issueLimit = options.issueLimit || DEFAULT_ISSUE_LIMIT;
    this.deviceTtlMs = options.deviceTtlMs || DEFAULT_DEVICE_TTL_MS;
    this.accessTtlMs = options.accessTtlMs || DEFAULT_ACCESS_TTL_MS;
    this._createSchema();
  }

  _createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_auth_users (
        id TEXT PRIMARY KEY,
        created_at_ms INTEGER NOT NULL,
        disabled_at_ms INTEGER
      );

      CREATE TABLE IF NOT EXISTS cloud_auth_identities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES cloud_auth_users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_subject TEXT NOT NULL,
        verified_email TEXT,
        created_at_ms INTEGER NOT NULL,
        last_used_at_ms INTEGER NOT NULL,
        UNIQUE(provider, provider_subject)
      );
      CREATE INDEX IF NOT EXISTS cloud_auth_identities_user_idx
        ON cloud_auth_identities(user_id);
      CREATE INDEX IF NOT EXISTS cloud_auth_identities_email_idx
        ON cloud_auth_identities(verified_email);

      CREATE TABLE IF NOT EXISTS cloud_auth_email_codes (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK(purpose IN ('signin', 'link')),
        link_user_id TEXT REFERENCES cloud_auth_users(id) ON DELETE CASCADE,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL,
        issued_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        consumed_at_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS cloud_auth_email_codes_email_idx
        ON cloud_auth_email_codes(email, issued_at_ms);

      CREATE TABLE IF NOT EXISTS cloud_auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES cloud_auth_users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        last_seen_at_ms INTEGER NOT NULL,
        revoked_at_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS cloud_auth_sessions_user_idx
        ON cloud_auth_sessions(user_id, revoked_at_ms);

      CREATE TABLE IF NOT EXISTS cloud_auth_rate_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        subject_hash TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS cloud_auth_rate_events_lookup_idx
        ON cloud_auth_rate_events(action, subject_hash, created_at_ms);

      CREATE TABLE IF NOT EXISTS cloud_cli_device_authorizations (
        id TEXT PRIMARY KEY,
        device_code_hash TEXT NOT NULL UNIQUE,
        user_code_hash TEXT NOT NULL UNIQUE,
        user_code_display TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        approved_by_user_id TEXT REFERENCES cloud_auth_users(id) ON DELETE CASCADE,
        approved_at_ms INTEGER,
        denied_at_ms INTEGER,
        consumed_at_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS cloud_cli_device_user_code_idx
        ON cloud_cli_device_authorizations(user_code_hash, expires_at_ms);

      CREATE TABLE IF NOT EXISTS cloud_cli_credentials (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES cloud_auth_users(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        token_family_id TEXT NOT NULL,
        refresh_token_hash TEXT NOT NULL UNIQUE,
        previous_refresh_token_hash TEXT UNIQUE,
        created_at_ms INTEGER NOT NULL,
        last_used_at_ms INTEGER NOT NULL,
        revoked_at_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS cloud_cli_credentials_user_idx
        ON cloud_cli_credentials(user_id, revoked_at_ms);

      CREATE TABLE IF NOT EXISTS cloud_cli_access_tokens (
        id TEXT PRIMARY KEY,
        credential_id TEXT NOT NULL REFERENCES cloud_cli_credentials(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        revoked_at_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS cloud_cli_access_tokens_credential_idx
        ON cloud_cli_access_tokens(credential_id, expires_at_ms);
    `);
  }

  _id(prefix) {
    return prefix + '_' + this.randomBytes(16).toString('hex');
  }

  _token() {
    return this.randomBytes(32).toString('base64url');
  }

  _userCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = this.randomBytes(8);
    let value = '';
    for (let i = 0; i < bytes.length; i++) value += alphabet[bytes[i] % alphabet.length];
    return value.slice(0, 4) + '-' + value.slice(4);
  }

  _hash(domain, value) {
    return crypto.createHmac('sha256', this.pepper).update(domain).update('\0').update(String(value)).digest('hex');
  }

  _getActiveUser(userId) {
    const row = this.db.prepare(
      'SELECT id, created_at_ms, disabled_at_ms FROM cloud_auth_users WHERE id = ?'
    ).get(userId);
    if (!row || row.disabled_at_ms != null) throw new AuthError('invalid_user', 'user is missing or disabled');
    return row;
  }

  _createUser(now) {
    const id = this._id('usr');
    this.db.prepare('INSERT INTO cloud_auth_users (id, created_at_ms) VALUES (?, ?)').run(id, now);
    return id;
  }

  _identity(provider, subject) {
    return this.db.prepare(`
      SELECT id, user_id, provider, provider_subject, verified_email, created_at_ms, last_used_at_ms
      FROM cloud_auth_identities WHERE provider = ? AND provider_subject = ?
    `).get(provider, subject) || null;
  }

  _insertIdentity(userId, identity, now) {
    const id = this._id('idn');
    this.db.prepare(`
      INSERT INTO cloud_auth_identities
        (id, user_id, provider, provider_subject, verified_email, created_at_ms, last_used_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, identity.provider, identity.subject, identity.verifiedEmail, now, now);
    return this._identity(identity.provider, identity.subject);
  }

  signInWithExternalIdentity(input) {
    const identity = normalizeIdentity(input);
    const now = this.now();
    return this.db.transaction(() => {
      const found = this._identity(identity.provider, identity.subject);
      if (found) {
        this._getActiveUser(found.user_id);
        this.db.prepare(`
          UPDATE cloud_auth_identities SET verified_email = ?, last_used_at_ms = ? WHERE id = ?
        `).run(identity.verifiedEmail, now, found.id);
        return { user: this.getUser(found.user_id), created: false };
      }

      // A matching email from another provider is not enough to merge users.
      // Linking requires an authenticated session through linkExternalIdentity.
      const userId = this._createUser(now);
      this._insertIdentity(userId, identity, now);
      return { user: this.getUser(userId), created: true };
    }).immediate();
  }

  linkExternalIdentity(input) {
    const session = this.authenticateSession(input && input.sessionToken);
    if (!session.ok) throw new AuthError('authentication_required', 'an active session is required');
    const identity = normalizeIdentity(input);
    const now = this.now();
    return this.db.transaction(() => {
      const found = this._identity(identity.provider, identity.subject);
      if (found && found.user_id !== session.user.id) {
        throw new AuthError('identity_in_use', 'identity belongs to another user');
      }
      if (!found) this._insertIdentity(session.user.id, identity, now);
      else this.db.prepare(`
        UPDATE cloud_auth_identities SET verified_email = ?, last_used_at_ms = ? WHERE id = ?
      `).run(identity.verifiedEmail, now, found.id);
      return this.getUser(session.user.id);
    }).immediate();
  }

  getUser(userId) {
    const user = this.db.prepare(`
      SELECT id, created_at_ms, disabled_at_ms FROM cloud_auth_users WHERE id = ?
    `).get(userId);
    if (!user) return null;
    const identities = this.db.prepare(`
      SELECT provider, provider_subject AS subject, verified_email AS verifiedEmail,
             created_at_ms AS createdAtMs, last_used_at_ms AS lastUsedAtMs
      FROM cloud_auth_identities WHERE user_id = ? ORDER BY created_at_ms, id
    `).all(userId);
    return {
      id: user.id,
      createdAtMs: user.created_at_ms,
      disabledAtMs: user.disabled_at_ms,
      identities,
    };
  }

  issueDeviceAuthorization(input) {
    input = input || {};
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
    if (!displayName || displayName.length > 128) throw new AuthError('invalid_request', 'display name is required');
    const now = this.now();
    const deviceCode = this._token();
    const userCode = this._userCode();
    const id = this._id('dev');
    const expiresAtMs = now + (input.ttlMs || this.deviceTtlMs);
    this.db.prepare(`
      INSERT INTO cloud_cli_device_authorizations
        (id, device_code_hash, user_code_hash, user_code_display, display_name, created_at_ms, expires_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, this._hash('cli-device', deviceCode), this._hash('cli-user-code', userCode.replace('-', '')),
      userCode, displayName, now, expiresAtMs);
    return { id, deviceCode, userCode, displayName, expiresAtMs };
  }

  getDeviceAuthorization(userCode) {
    const normalized = String(userCode || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
    if (normalized.length !== 8) return null;
    const row = this.db.prepare(`
      SELECT id, user_code_display, display_name, created_at_ms, expires_at_ms,
             approved_at_ms, denied_at_ms, consumed_at_ms
      FROM cloud_cli_device_authorizations WHERE user_code_hash = ?
    `).get(this._hash('cli-user-code', normalized));
    if (!row || row.expires_at_ms <= this.now()) return null;
    return {
      id: row.id, userCode: row.user_code_display, displayName: row.display_name,
      createdAtMs: row.created_at_ms, expiresAtMs: row.expires_at_ms,
      approved: row.approved_at_ms != null, denied: row.denied_at_ms != null,
      consumed: row.consumed_at_ms != null,
    };
  }

  approveDeviceAuthorization(input) {
    input = input || {};
    this._getActiveUser(input.userId);
    const normalized = String(input.userCode || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
    if (normalized.length !== 8) throw new AuthError('invalid_request');
    const now = this.now();
    const result = this.db.prepare(`
      UPDATE cloud_cli_device_authorizations
      SET approved_by_user_id = ?, approved_at_ms = ?
      WHERE user_code_hash = ? AND expires_at_ms > ? AND approved_at_ms IS NULL
        AND denied_at_ms IS NULL AND consumed_at_ms IS NULL
    `).run(input.userId, now, this._hash('cli-user-code', normalized), now);
    if (result.changes !== 1) throw new AuthError('resource_unavailable');
    return { ok: true };
  }

  denyDeviceAuthorization(input) {
    const normalized = String(input && input.userCode || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
    const now = this.now();
    const result = this.db.prepare(`
      UPDATE cloud_cli_device_authorizations SET denied_at_ms = ?
      WHERE user_code_hash = ? AND expires_at_ms > ? AND approved_at_ms IS NULL
        AND denied_at_ms IS NULL AND consumed_at_ms IS NULL
    `).run(now, this._hash('cli-user-code', normalized), now);
    if (result.changes !== 1) throw new AuthError('resource_unavailable');
    return { ok: true };
  }

  _createAccessToken(credentialId, now) {
    const token = this._token();
    const expiresAtMs = now + this.accessTtlMs;
    this.db.prepare(`
      INSERT INTO cloud_cli_access_tokens
        (id, credential_id, token_hash, created_at_ms, expires_at_ms)
      VALUES (?, ?, ?, ?, ?)
    `).run(this._id('at'), credentialId, this._hash('cli-access', token), now, expiresAtMs);
    return { token, expiresAtMs };
  }

  _createCliCredential(userId, displayName, now) {
    const id = this._id('cli');
    const familyId = this._id('fam');
    const refreshToken = this._token();
    this.db.prepare(`
      INSERT INTO cloud_cli_credentials
        (id, user_id, display_name, token_family_id, refresh_token_hash, created_at_ms, last_used_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, displayName, familyId, this._hash('cli-refresh', refreshToken), now, now);
    const access = this._createAccessToken(id, now);
    return { credentialId: id, userId, displayName, refreshToken,
      accessToken: access.token, accessExpiresAtMs: access.expiresAtMs };
  }

  pollDeviceAuthorization(input) {
    const deviceHash = this._hash('cli-device', input && input.deviceCode);
    const now = this.now();
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM cloud_cli_device_authorizations WHERE device_code_hash = ?')
        .get(deviceHash);
      if (!row || row.expires_at_ms <= now) return { ok: false, reason: 'expired_token' };
      if (row.denied_at_ms != null) return { ok: false, reason: 'access_denied' };
      if (row.consumed_at_ms != null) return { ok: false, reason: 'expired_token' };
      if (row.approved_at_ms == null || !row.approved_by_user_id) return { ok: false, reason: 'authorization_pending' };
      this._getActiveUser(row.approved_by_user_id);
      const credential = this._createCliCredential(row.approved_by_user_id, row.display_name, now);
      this.db.prepare('UPDATE cloud_cli_device_authorizations SET consumed_at_ms = ? WHERE id = ?')
        .run(now, row.id);
      return { ok: true, ...credential };
    }).immediate();
  }

  authenticateAccessToken(token) {
    if (typeof token !== 'string' || !token) return { ok: false, reason: 'missing' };
    const now = this.now();
    const row = this.db.prepare(`
      SELECT a.id AS access_id, a.expires_at_ms, a.revoked_at_ms AS access_revoked_at_ms,
             c.id AS credential_id, c.user_id, c.display_name, c.revoked_at_ms
      FROM cloud_cli_access_tokens a JOIN cloud_cli_credentials c ON c.id = a.credential_id
      WHERE a.token_hash = ?
    `).get(this._hash('cli-access', token));
    if (!row || row.revoked_at_ms != null || row.access_revoked_at_ms != null) return { ok: false, reason: 'revoked' };
    if (row.expires_at_ms <= now) return { ok: false, reason: 'expired' };
    let user;
    try { user = this.getUser(row.user_id); } catch (_) { return { ok: false, reason: 'disabled' }; }
    if (!user || user.disabledAtMs != null) return { ok: false, reason: 'disabled' };
    return { ok: true, user, credential: { id: row.credential_id, displayName: row.display_name },
      expiresAtMs: row.expires_at_ms };
  }

  refreshCliCredential(input) {
    const refreshHash = this._hash('cli-refresh', input && input.refreshToken);
    const now = this.now();
    const result = this.db.transaction(() => {
      const reused = this.db.prepare(`
        SELECT id FROM cloud_cli_credentials WHERE previous_refresh_token_hash = ? AND revoked_at_ms IS NULL
      `).get(refreshHash);
      if (reused) {
        this.db.prepare('UPDATE cloud_cli_credentials SET revoked_at_ms = ? WHERE id = ?').run(now, reused.id);
        this.db.prepare('UPDATE cloud_cli_access_tokens SET revoked_at_ms = ? WHERE credential_id = ? AND revoked_at_ms IS NULL')
          .run(now, reused.id);
        return { tokenReuse: true };
      }
      const credential = this.db.prepare(`
        SELECT * FROM cloud_cli_credentials WHERE refresh_token_hash = ? AND revoked_at_ms IS NULL
      `).get(refreshHash);
      if (!credential) throw new AuthError('invalid_token');
      this._getActiveUser(credential.user_id);
      const nextRefresh = this._token();
      this.db.prepare(`
        UPDATE cloud_cli_credentials
        SET previous_refresh_token_hash = refresh_token_hash, refresh_token_hash = ?, last_used_at_ms = ?
        WHERE id = ?
      `).run(this._hash('cli-refresh', nextRefresh), now, credential.id);
      this.db.prepare(`
        UPDATE cloud_cli_access_tokens SET revoked_at_ms = ?
        WHERE credential_id = ? AND revoked_at_ms IS NULL
      `).run(now, credential.id);
      const access = this._createAccessToken(credential.id, now);
      return { ok: true, credentialId: credential.id, userId: credential.user_id,
        refreshToken: nextRefresh, accessToken: access.token, accessExpiresAtMs: access.expiresAtMs };
    }).immediate();
    if (result.tokenReuse) throw new AuthError('token_reuse', 'refresh token reuse revoked this installation');
    return result;
  }

  listCliCredentials(userId) {
    this._getActiveUser(userId);
    return this.db.prepare(`
      SELECT id, display_name, created_at_ms, last_used_at_ms, revoked_at_ms
      FROM cloud_cli_credentials WHERE user_id = ? ORDER BY created_at_ms DESC, id
    `).all(userId).map((row) => ({ id: row.id, displayName: row.display_name,
      createdAtMs: row.created_at_ms, lastUsedAtMs: row.last_used_at_ms,
      revokedAtMs: row.revoked_at_ms }));
  }

  revokeCliCredential(input) {
    const now = this.now();
    const result = this.db.prepare(`
      UPDATE cloud_cli_credentials SET revoked_at_ms = ?
      WHERE id = ? AND user_id = ? AND revoked_at_ms IS NULL
    `).run(now, input.credentialId, input.userId);
    if (result.changes !== 1) throw new AuthError('resource_unavailable');
    this.db.prepare(`
      UPDATE cloud_cli_access_tokens SET revoked_at_ms = ?
      WHERE credential_id = ? AND revoked_at_ms IS NULL
    `).run(now, input.credentialId);
    return { ok: true };
  }

  consumeRateLimit(input) {
    input = input || {};
    const action = typeof input.action === 'string' ? input.action.trim() : '';
    const key = typeof input.key === 'string' ? input.key.trim() : '';
    const limit = Number(input.limit);
    const windowMs = Number(input.windowMs);
    if (!action || !key || !Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
      throw new Error('action, key, positive limit, and positive windowMs are required');
    }
    return this._consumeRateGuards([{ action, key, limit, windowMs }])[0];
  }

  _consumeRateGuards(guards) {
    const now = this.now();
    return this.db.transaction(() => {
      const results = guards.map((guard) => {
        const subjectHash = this._hash('rate:' + guard.action, guard.key);
        const since = now - guard.windowMs;
        const rows = this.db.prepare(`
          SELECT created_at_ms FROM cloud_auth_rate_events
          WHERE action = ? AND subject_hash = ? AND created_at_ms > ?
          ORDER BY created_at_ms
        `).all(guard.action, subjectHash, since);
        const allowed = rows.length < guard.limit;
        const retryAfterMs = allowed || !rows.length ? 0 : Math.max(1, rows[0].created_at_ms + guard.windowMs - now);
        return { allowed, remaining: Math.max(0, guard.limit - rows.length - (allowed ? 1 : 0)), retryAfterMs, subjectHash };
      });
      if (results.every((result) => result.allowed)) {
        const insert = this.db.prepare(`
          INSERT INTO cloud_auth_rate_events (action, subject_hash, created_at_ms) VALUES (?, ?, ?)
        `);
        guards.forEach((guard, index) => insert.run(guard.action, results[index].subjectHash, now));
      }
      return results.map(({ allowed, remaining, retryAfterMs }) => ({ allowed, remaining, retryAfterMs }));
    }).immediate();
  }

  issueEmailCode(input) {
    input = input || {};
    const email = normalizeEmail(input.email);
    const purpose = input.purpose || 'signin';
    if (purpose !== 'signin' && purpose !== 'link') throw new AuthError('invalid_purpose', 'purpose must be signin or link');

    let linkUserId = null;
    if (purpose === 'link') {
      const session = this.authenticateSession(input.sessionToken);
      if (!session.ok) throw new AuthError('authentication_required', 'an active session is required to link email');
      linkUserId = session.user.id;
    }

    const guards = [{
      action: 'email_code_issue_email', key: email, limit: this.issueLimit, windowMs: this.issueWindowMs,
    }];
    if (input.ip) guards.push({
      action: 'email_code_issue_ip', key: String(input.ip), limit: this.issueLimit, windowMs: this.issueWindowMs,
    });
    const rateResults = this._consumeRateGuards(guards);
    const denied = rateResults.find((result) => !result.allowed);
    if (denied) throw new AuthError('rate_limited', 'too many email code requests', { retryAfterMs: denied.retryAfterMs });

    const now = this.now();
    const requestId = this._id('emc');
    const code = String(this.randomBytes(4).readUInt32BE(0) % 1000000).padStart(6, '0');
    const expiresAtMs = now + this.codeTtlMs;
    const codeHash = this._hash('email-code', requestId + ':' + code);
    this.db.transaction(() => {
      // A resend replaces the previous challenge for this exact login action.
      // The browser retains only the newest opaque request ID, so leaving older
      // codes valid would create an unnecessary second path into the account.
      this.db.prepare(`
        UPDATE cloud_auth_email_codes SET consumed_at_ms = ?
        WHERE email = ? AND purpose = ? AND link_user_id IS ? AND consumed_at_ms IS NULL
      `).run(now, email, purpose, linkUserId);
      this.db.prepare(`
        INSERT INTO cloud_auth_email_codes
          (id, email, code_hash, purpose, link_user_id, max_attempts, issued_at_ms, expires_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(requestId, email, codeHash, purpose, linkUserId, this.maxCodeAttempts, now, expiresAtMs);
    }).immediate();
    return { requestId, code, expiresAtMs };
  }

  consumeEmailCode(input) {
    input = input || {};
    const requestId = typeof input.requestId === 'string' ? input.requestId : '';
    const code = typeof input.code === 'string' ? input.code.trim() : '';
    if (!requestId || !/^\d{6}$/.test(code)) return { ok: false, reason: 'invalid_code' };
    const now = this.now();

    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM cloud_auth_email_codes WHERE id = ?').get(requestId);
      if (!row) return { ok: false, reason: 'invalid_code' };
      if (row.consumed_at_ms != null) return { ok: false, reason: 'already_used' };
      if (now >= row.expires_at_ms) return { ok: false, reason: 'expired' };
      if (row.attempts >= row.max_attempts) return { ok: false, reason: 'attempts_exceeded' };

      const candidate = this._hash('email-code', requestId + ':' + code);
      if (!timingSafeEqualText(candidate, row.code_hash)) {
        const attempts = row.attempts + 1;
        this.db.prepare('UPDATE cloud_auth_email_codes SET attempts = ? WHERE id = ?').run(attempts, requestId);
        return {
          ok: false,
          reason: attempts >= row.max_attempts ? 'attempts_exceeded' : 'invalid_code',
          attemptsRemaining: Math.max(0, row.max_attempts - attempts),
        };
      }

      const claimed = this.db.prepare(`
        UPDATE cloud_auth_email_codes SET consumed_at_ms = ?
        WHERE id = ? AND consumed_at_ms IS NULL AND attempts < max_attempts
      `).run(now, requestId);
      if (claimed.changes !== 1) return { ok: false, reason: 'already_used' };

      const existing = this._identity('email', row.email);
      let userId;
      let created = false;
      if (row.purpose === 'link') {
        this._getActiveUser(row.link_user_id);
        if (existing && existing.user_id !== row.link_user_id) {
          throw new AuthError('identity_in_use', 'email identity belongs to another user');
        }
        userId = row.link_user_id;
        if (!existing) this._insertIdentity(userId, {
          provider: 'email', subject: row.email, verifiedEmail: row.email,
        }, now);
      } else if (existing) {
        this._getActiveUser(existing.user_id);
        userId = existing.user_id;
        this.db.prepare('UPDATE cloud_auth_identities SET last_used_at_ms = ? WHERE id = ?').run(now, existing.id);
      } else {
        userId = this._createUser(now);
        this._insertIdentity(userId, {
          provider: 'email', subject: row.email, verifiedEmail: row.email,
        }, now);
        created = true;
      }
      return { ok: true, user: this.getUser(userId), created, purpose: row.purpose };
    }).immediate();
  }

  createBrowserSession(userId, options) {
    this._getActiveUser(userId);
    options = options || {};
    const now = this.now();
    const ttlMs = options.ttlMs || this.sessionTtlMs;
    if (!Number.isFinite(ttlMs) || ttlMs < 1) throw new Error('ttlMs must be positive');
    const id = this._id('ses');
    const token = this._token();
    const expiresAtMs = now + ttlMs;
    this.db.prepare(`
      INSERT INTO cloud_auth_sessions
        (id, user_id, token_hash, created_at_ms, expires_at_ms, last_seen_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, this._hash('session', token), now, expiresAtMs, now);
    return { id, token, expiresAtMs };
  }

  authenticateSession(token) {
    if (typeof token !== 'string' || token.length < 20) return { ok: false, reason: 'invalid_session' };
    const now = this.now();
    const row = this.db.prepare(`
      SELECT id, user_id, expires_at_ms, revoked_at_ms
      FROM cloud_auth_sessions WHERE token_hash = ?
    `).get(this._hash('session', token));
    if (!row) return { ok: false, reason: 'invalid_session' };
    if (row.revoked_at_ms != null) return { ok: false, reason: 'revoked' };
    if (now >= row.expires_at_ms) return { ok: false, reason: 'expired' };
    const user = this.getUser(row.user_id);
    if (!user || user.disabledAtMs != null) return { ok: false, reason: 'invalid_session' };
    this.db.prepare('UPDATE cloud_auth_sessions SET last_seen_at_ms = ? WHERE id = ?').run(now, row.id);
    return { ok: true, session: { id: row.id, expiresAtMs: row.expires_at_ms }, user };
  }

  revokeSession(input) {
    input = input || {};
    const authenticated = this.authenticateSession(input.sessionToken);
    if (!authenticated.ok) throw new AuthError('authentication_required', 'an active session is required');
    const targetId = input.targetSessionId || authenticated.session.id;
    const result = this.db.prepare(`
      UPDATE cloud_auth_sessions SET revoked_at_ms = ?
      WHERE id = ? AND user_id = ? AND revoked_at_ms IS NULL
    `).run(this.now(), targetId, authenticated.user.id);
    return result.changes === 1;
  }

  revokeAllSessions(userId) {
    this._getActiveUser(userId);
    return this.db.prepare(`
      UPDATE cloud_auth_sessions SET revoked_at_ms = ?
      WHERE user_id = ? AND revoked_at_ms IS NULL
    `).run(this.now(), userId).changes;
  }

  cleanupExpired(options) {
    options = options || {};
    const now = this.now();
    const authRetentionMs = options.authRetentionMs || 7 * 24 * 60 * 60 * 1000;
    const rateRetentionMs = options.rateRetentionMs || 24 * 60 * 60 * 1000;
    return this.db.transaction(() => ({
      codes: this.db.prepare(`
        DELETE FROM cloud_auth_email_codes
        WHERE expires_at_ms < ? OR (consumed_at_ms IS NOT NULL AND consumed_at_ms < ?)
      `).run(now - authRetentionMs, now - authRetentionMs).changes,
      sessions: this.db.prepare(`
        DELETE FROM cloud_auth_sessions
        WHERE expires_at_ms < ? OR (revoked_at_ms IS NOT NULL AND revoked_at_ms < ?)
      `).run(now - authRetentionMs, now - authRetentionMs).changes,
      deviceAuthorizations: this.db.prepare(`
        DELETE FROM cloud_cli_device_authorizations
        WHERE expires_at_ms < ? OR (consumed_at_ms IS NOT NULL AND consumed_at_ms < ?)
      `).run(now - authRetentionMs, now - authRetentionMs).changes,
      accessTokens: this.db.prepare(`
        DELETE FROM cloud_cli_access_tokens
        WHERE expires_at_ms < ? OR (revoked_at_ms IS NOT NULL AND revoked_at_ms < ?)
      `).run(now - authRetentionMs, now - authRetentionMs).changes,
      rateEvents: this.db.prepare(`
        DELETE FROM cloud_auth_rate_events WHERE created_at_ms < ?
      `).run(now - rateRetentionMs).changes,
    })).immediate();
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

function createAuthStore(options) {
  return new CloudAuthStore(options);
}

module.exports = {
  AuthError,
  CloudAuthStore,
  createAuthStore,
  normalizeEmail,
};
