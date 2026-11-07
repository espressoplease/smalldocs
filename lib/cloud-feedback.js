'use strict';

const crypto = require('crypto');
const { CloudError, encryptAead, decryptAead } = require('./cloud-store');
const MAX_MESSAGE_BYTES = 4096;

class FeedbackInbox {
  constructor({ store, adminUserIds = '' }) {
    this.store = store;
    this.db = store.db;
    this.admins = new Set(String(adminUserIds).split(/[\s,]+/).filter(Boolean));
    this.db.exec(`CREATE TABLE IF NOT EXISTS cloud_feedback_key (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL,
      ciphertext BLOB NOT NULL, nonce BLOB NOT NULL, reference TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cloud_private_feedback (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at_ms INTEGER NOT NULL,
        request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, ciphertext BLOB NOT NULL,
        nonce BLOB NOT NULL, UNIQUE(user_id,request_id));
      CREATE INDEX IF NOT EXISTS cloud_private_feedback_created
        ON cloud_private_feedback(created_at_ms DESC,id DESC)`);
    this.keyLoading = null;
  }

  isAdmin(userId) { return this.admins.has(userId); }

  async key() {
    if (this.keyLoading) return Buffer.from(await this.keyLoading);
    // The provider owns the bounded key cache. Do not retain an unwrapped key here.
    this.keyLoading = (async () => {
      let row = this.db.prepare('SELECT * FROM cloud_feedback_key WHERE singleton=1').get();
      if (!row) {
        const id = crypto.randomUUID(), raw = crypto.randomBytes(32);
        try {
          const wrapped = await this.store._keyOperation(() => this.store.keyProvider.wrapProjectKey(id, 1, raw));
          this.db.prepare('INSERT OR IGNORE INTO cloud_feedback_key VALUES (1,?,?,?,?)')
            .run(id, wrapped.ciphertext, wrapped.nonce, wrapped.reference);
        } finally { raw.fill(0); }
        row = this.db.prepare('SELECT * FROM cloud_feedback_key WHERE singleton=1').get();
      }
      return this.store._keyOperation(() => this.store.keyProvider.unwrapProjectKey(row.id, 1, row));
    })();
    try { return Buffer.from(await this.keyLoading); }
    finally { const pending = this.keyLoading; this.keyLoading = null; pending.then(key => key.fill(0), () => {}); }
  }

  aad(row) {
    return Buffer.from(['sdocs-private-feedback', this.store.environment, row.id, row.user_id, String(row.created_at_ms)].join('\0'));
  }

  async submit({ user, email, message, requestId, beforeCommit, consumeRate }) {
    if (typeof message !== 'string' || !message.trim() || Buffer.byteLength(message, 'utf8') > MAX_MESSAGE_BYTES ||
        typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) throw new CloudError('invalid_request');
    message = message.trim();
    const key = await this.key();
    try {
      const fingerprint = crypto.createHmac('sha256', key).update(user.id).update('\0').update(message).digest('hex');
      const previous = this.db.prepare('SELECT id,created_at_ms,fingerprint FROM cloud_private_feedback WHERE user_id=? AND request_id=?').get(user.id, requestId);
      if (beforeCommit) beforeCommit();
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new CloudError('idempotency_mismatch');
        return { id: previous.id, created_at_ms: previous.created_at_ms, received: true };
      }
      if (consumeRate) consumeRate();
      const row = { id: crypto.randomUUID(), user_id: user.id, created_at_ms: Date.now() };
      const data = { message, name: [user.firstName, user.lastName].filter(Boolean).join(' '), email: email || null };
      const sealed = encryptAead(key, Buffer.from(JSON.stringify(data)), this.aad(row), crypto.randomBytes);
      this.db.prepare('INSERT INTO cloud_private_feedback VALUES (?,?,?,?,?,?,?)')
        .run(row.id, row.user_id, row.created_at_ms, requestId, fingerprint, sealed.ciphertext, sealed.nonce);
      return { id: row.id, created_at_ms: row.created_at_ms, received: true };
    } finally { key.fill(0); }
  }

  async list({ userId, after, beforeReturn }) {
    if (!this.isAdmin(userId)) throw new CloudError('resource_unavailable');
    let position = null;
    if (after) {
      if (typeof after !== 'string' || after.length > 128) throw new CloudError('invalid_request');
      position = this.db.prepare('SELECT created_at_ms,id FROM cloud_private_feedback WHERE id=?').get(after);
      if (!position) throw new CloudError('invalid_request');
    }
    const rows = position
      ? this.db.prepare(`SELECT * FROM cloud_private_feedback WHERE created_at_ms<? OR (created_at_ms=? AND id<?)
          ORDER BY created_at_ms DESC,id DESC LIMIT 51`).all(position.created_at_ms, position.created_at_ms, position.id)
      : this.db.prepare('SELECT * FROM cloud_private_feedback ORDER BY created_at_ms DESC,id DESC LIMIT 51').all();
    const items = [];
    if (rows.length) {
      const key = await this.key();
      try {
        for (const row of rows.slice(0, 50)) {
          const value = JSON.parse(decryptAead(key, row.nonce, row.ciphertext, this.aad(row)).toString('utf8'));
          items.push({ id: row.id, created_at: new Date(row.created_at_ms).toISOString(),
            user_id: row.user_id, name: value.name, email: value.email, message: value.message });
        }
      } finally { key.fill(0); }
    }
    if (beforeReturn) beforeReturn();
    return { items, next_cursor: rows.length > 50 ? items[items.length - 1].id : null };
  }
}
module.exports = { FeedbackInbox, MAX_MESSAGE_BYTES };
