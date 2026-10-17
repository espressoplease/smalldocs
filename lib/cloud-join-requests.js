const crypto = require('crypto');
const { domainToASCII } = require('url');
const PUBLIC_PROVIDERS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com', 'me.com', 'mail.com']);
function companyDomain(email) {
  const domain = domainToASCII(String(email || '').split('@')[1] || '').toLowerCase();
  return domain && domain.includes('.') && !PUBLIC_PROVIDERS.has(domain) ? domain : null;
}
function unavailable() { return Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' }); }
class JoinRequests {
  constructor(options) {
    const Database = require('better-sqlite3');
    this.db = new Database(options.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.secret = options.secret;
    this.now = options.now || Date.now;
    this.db.exec(`CREATE TABLE IF NOT EXISTS cloud_join_requests (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, domain TEXT NOT NULL,
      note TEXT NOT NULL, created_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL,
      cancelled_at_ms INTEGER
    ); CREATE INDEX IF NOT EXISTS cloud_join_requests_user ON cloud_join_requests(user_id);
    CREATE TABLE IF NOT EXISTS cloud_join_request_invitations (request_id TEXT NOT NULL, workspace_id TEXT NOT NULL, invitation_id TEXT NOT NULL UNIQUE, PRIMARY KEY(request_id, workspace_id));`);
    if (!this.db.prepare('PRAGMA table_info(cloud_join_requests)').all().some(column => column.name === 'joined_at_ms')) {
      this.db.exec('ALTER TABLE cloud_join_requests ADD COLUMN joined_at_ms INTEGER');
    }
  }
  token(row) { return row.id + '.' + crypto.createHmac('sha256', this.secret).update('join-request:' + row.id).digest('base64url'); }
  view(row) { return { id: row.id, domain: row.domain, note: row.note,
    created_at_ms: row.created_at_ms, expires_at_ms: row.expires_at_ms,
    status: row.cancelled_at_ms != null ? 'cancelled' : row.joined_at_ms != null ? 'joined' : row.expires_at_ms <= this.now() ? 'expired' : 'pending' }; }
  create(input) {
    if (!input.consented || !input.userId || !companyDomain(input.email)) throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
    const domain = companyDomain(input.email);
    const note = typeof input.note === 'string' ? input.note.trim() : '';
    if (note.length > 1000) throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
    return this.db.transaction(() => {
      let row = this.db.prepare('SELECT * FROM cloud_join_requests WHERE user_id = ? AND domain = ? AND cancelled_at_ms IS NULL AND joined_at_ms IS NULL AND expires_at_ms > ? ORDER BY created_at_ms DESC LIMIT 1').get(input.userId, domain, this.now());
      if (!row) {
        row = { id: crypto.randomUUID(), user_id: input.userId, domain, note,
          created_at_ms: this.now(), expires_at_ms: this.now() + 7 * 86400000, cancelled_at_ms: null };
        this.db.prepare('INSERT INTO cloud_join_requests (id, user_id, domain, note, created_at_ms, expires_at_ms, cancelled_at_ms) VALUES (@id, @user_id, @domain, @note, @created_at_ms, @expires_at_ms, @cancelled_at_ms)').run(row);
      }
      return { ...this.view(row), token: this.token(row) };
    }).immediate();
  }
  own(userId) { return this.db.prepare('SELECT * FROM cloud_join_requests WHERE user_id = ? ORDER BY created_at_ms DESC, rowid DESC LIMIT 1').get(userId) || null; }
  resolve(token) {
    const id = String(token || '').split('.')[0];
    const row = this.db.prepare('SELECT * FROM cloud_join_requests WHERE id = ?').get(id);
    if (!row || row.cancelled_at_ms != null || row.joined_at_ms != null || row.expires_at_ms <= this.now()) throw unavailable();
    const expected = Buffer.from(this.token(row));
    const actual = Buffer.from(String(token));
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw unavailable();
    return row;
  }
  cancel(userId, id) {
    const result = this.db.prepare('UPDATE cloud_join_requests SET cancelled_at_ms = ? WHERE id = ? AND user_id = ? AND cancelled_at_ms IS NULL').run(this.now(), id, userId);
    if (!result.changes) {
      if (!this.db.prepare('SELECT 1 FROM cloud_join_requests WHERE id = ? AND user_id = ?').get(id, userId)) throw unavailable();
    }
  }
  recordInvitation(requestId, workspaceId, invitationId) {
    this.db.prepare('INSERT OR IGNORE INTO cloud_join_request_invitations VALUES (?, ?, ?)').run(requestId, workspaceId, invitationId);
  }
  completeForInvitation(invitationId, userId) {
    this.db.prepare(`UPDATE cloud_join_requests SET joined_at_ms = COALESCE(joined_at_ms, ?)
      WHERE user_id = ? AND id IN (SELECT request_id FROM cloud_join_request_invitations WHERE invitation_id = ?)`).run(this.now(), userId, invitationId);
  }
  close() { this.db.close(); }
}
module.exports = { JoinRequests, companyDomain };
