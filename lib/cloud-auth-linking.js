const { AuthError, normalizeEmail } = require('./cloud-auth');

class IdentityLinking {
  constructor(auth, options = {}) {
    this.auth = auth;
    this.db = auth.db;
    this.recentAuthMs = options.recentAuthMs || 30 * 60 * 1000;
    this.db.exec(`CREATE TABLE IF NOT EXISTS cloud_auth_link_contexts (
      token_hash TEXT PRIMARY KEY, identity_json TEXT, target_user_id TEXT,
      target_session_id TEXT, return_to TEXT NOT NULL, challenge_id TEXT,
      expires_at_ms INTEGER NOT NULL, consumed_at_ms INTEGER
    )`);
  }

  recentSession(token) {
    const session = this.auth.authenticateSession(token);
    if (!session.ok || this.auth.now() - session.session.createdAtMs > this.recentAuthMs) {
      throw new AuthError('recent_auth_required', 'sign in again to connect a sign-in method');
    }
    return session;
  }

  signInGoogle(identity, options = {}) {
    if (!identity || identity.provider !== 'google' || !identity.subject) throw new AuthError('invalid_provider');
    if (!identity.emailAuthoritative && !options.emailProven) throw new AuthError('email_confirmation_required');
    const email = normalizeEmail(identity.verifiedEmail), now = this.auth.now();
    return this.db.transaction(() => {
      const google = this.auth._identity('google', identity.subject);
      const alias = this.auth._identity('email', email);
      let userId = options.targetUserId || (google && google.user_id) || (alias && alias.user_id);
      if (options.targetUserId && ((google && google.user_id !== userId) || (alias && alias.user_id !== userId))) {
        throw new AuthError('identity_in_use');
      }
      let created = false;
      if (!userId) { userId = this.auth._createUser(now); created = true; }
      this.auth._getActiveUser(userId);
      // A known provider subject stays with its user, even if its email changes.
      // A matching email never moves an existing identity or library.
      if (google) this.db.prepare('UPDATE cloud_auth_identities SET verified_email=?,last_used_at_ms=? WHERE id=?').run(email, now, google.id);
      else this.auth._insertIdentity(userId, { provider: 'google', subject: identity.subject, verifiedEmail: email }, now);
      if (!alias) this.auth._insertIdentity(userId, { provider: 'email', subject: email, verifiedEmail: email }, now);
      return { user: this.auth.getUser(userId), created };
    }).immediate();
  }

  createContext({ identity, sessionToken, returnTo, token }) {
    if (!identity && !sessionToken) throw new AuthError('authentication_required');
    const session = sessionToken ? this.recentSession(sessionToken) : null;
    token = token || this.auth._token();
    this.db.prepare('DELETE FROM cloud_auth_link_contexts WHERE expires_at_ms<=?').run(this.auth.now());
    this.db.prepare(`INSERT INTO cloud_auth_link_contexts
      (token_hash,identity_json,target_user_id,target_session_id,return_to,expires_at_ms)
      VALUES (?,?,?,?,?,?)`).run(this.auth._hash('link-context', token), identity ? JSON.stringify(identity) : null,
      session && session.user.id, session && session.session.id, returnTo, this.auth.now() + 10 * 60 * 1000);
    return token;
  }

  context(token, sessionToken) {
    const row = this.db.prepare('SELECT * FROM cloud_auth_link_contexts WHERE token_hash=?')
      .get(this.auth._hash('link-context', token || ''));
    if (!row || row.consumed_at_ms != null || row.expires_at_ms <= this.auth.now()) throw new AuthError('link_expired');
    if (row.target_user_id) {
      const session = this.recentSession(sessionToken);
      if (session.user.id !== row.target_user_id || session.session.id !== row.target_session_id) throw new AuthError('authentication_required');
    }
    return { ...row, identity: row.identity_json ? JSON.parse(row.identity_json) : null };
  }

  finishIntent(state, sessionToken) {
    const exists = this.db.prepare('SELECT 1 FROM cloud_auth_link_contexts WHERE token_hash=?')
      .get(this.auth._hash('link-context', state || ''));
    if (!exists) return null;
    const row = this.context(state, sessionToken);
    this.db.prepare('UPDATE cloud_auth_link_contexts SET consumed_at_ms=? WHERE token_hash=?').run(this.auth.now(), row.token_hash);
    return row;
  }

  setChallenge(token, sessionToken, challengeId) {
    const row = this.context(token, sessionToken);
    this.db.prepare('UPDATE cloud_auth_link_contexts SET challenge_id=? WHERE token_hash=?').run(challengeId, row.token_hash);
  }

  complete(token, sessionToken, input = {}) {
    return this.db.transaction(() => {
      const row = this.context(token, sessionToken);
      if (!row.identity) throw new AuthError('link_expired');
      let result;
      const finish = email => {
        if (email !== row.identity.verifiedEmail) throw new AuthError('invalid_code');
        return this.signInGoogle(row.identity, { emailProven: true, targetUserId: row.target_user_id });
      };
      if (!row.identity.emailAuthoritative) {
        if (!row.challenge_id || input.challenge_id !== row.challenge_id) return { ok: false, reason: 'invalid_code' };
        result = this.auth.consumeEmailCode({ requestId: row.challenge_id, code: input.code, onVerified: finish });
        if (!result.ok) return result;
      } else {
        if (!row.target_user_id) throw new AuthError('authentication_required');
        result = { ok: true, ...finish(row.identity.verifiedEmail) };
      }
      this.db.prepare('UPDATE cloud_auth_link_contexts SET consumed_at_ms=? WHERE token_hash=? AND consumed_at_ms IS NULL')
        .run(this.auth.now(), row.token_hash);
      return { ...result, returnTo: row.return_to, linked: Boolean(row.target_user_id) };
    }).immediate();
  }
}
module.exports = { IdentityLinking };
