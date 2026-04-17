/**
 * Short links database. SQLite storage for encrypted document blobs.
 *
 * Stores opaque ciphertext (AES-GCM encrypted + compressed markdown) keyed
 * by a short random base64url ID. The server never sees plaintext: the
 * encryption key lives in the URL fragment and is handled client-side only.
 *
 * Rows are deleted after ID_TTL_DAYS of no access. last_accessed_at is
 * touched on every successful fetch, so actively-used links never expire.
 *
 * Usage:
 *   const shortLinks = require('./short-links/db');
 *   const id = shortLinks.insert(ciphertext);   // returns "kT9xQ2pN"
 *   const ct = shortLinks.fetch(id);            // returns ciphertext or null
 */
const path = require('path');
const crypto = require('crypto');

const ID_LENGTH = 8;                    // chars; each picks 6 bits from a 64-char alphabet = 48 bits of entropy
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const TTL_DAYS = 365;
const MAX_INSERT_RETRIES = 5;           // on ID collision, try again

let db = null;
let insertStmt = null;
let fetchStmt = null;
let touchStmt = null;
let cleanupStmt = null;

function init(dbPath) {
  if (db) db.close();

  const Database = require('better-sqlite3');
  dbPath = dbPath || process.env.SHORT_LINKS_DB || path.join(__dirname, '..', 'short_links.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS short_links (
      id TEXT PRIMARY KEY,
      ciphertext TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_accessed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_short_last_accessed ON short_links(last_accessed_at);
  `);

  insertStmt = db.prepare('INSERT INTO short_links (id, ciphertext) VALUES (?, ?)');
  fetchStmt = db.prepare('SELECT ciphertext FROM short_links WHERE id = ?');
  touchStmt = db.prepare("UPDATE short_links SET last_accessed_at = datetime('now') WHERE id = ?");
  cleanupStmt = db.prepare(
    "DELETE FROM short_links WHERE last_accessed_at < datetime('now', '-' || ? || ' days')"
  );

  return db;
}

function generateId() {
  const bytes = crypto.randomBytes(ID_LENGTH);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += ID_CHARS[bytes[i] & 63];
  return out;
}

function insert(ciphertext) {
  if (!db) init();
  if (typeof ciphertext !== 'string' || !ciphertext.length) {
    throw new Error('ciphertext must be a non-empty string');
  }
  for (let i = 0; i < MAX_INSERT_RETRIES; i++) {
    const id = generateId();
    try {
      insertStmt.run(id, ciphertext);
      return id;
    } catch (e) {
      // UNIQUE constraint failed; retry with a new ID
      if (e && e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') continue;
      throw e;
    }
  }
  throw new Error('could not generate a unique short-link id');
}

function fetch(id) {
  if (!db) init();
  const row = fetchStmt.get(id);
  if (!row) return null;
  try { touchStmt.run(id); } catch (_) { /* best-effort */ }
  return row.ciphertext;
}

function cleanupExpired(ttlDays) {
  if (!db) init();
  const days = typeof ttlDays === 'number' ? ttlDays : TTL_DAYS;
  const result = cleanupStmt.run(String(days));
  return result.changes;
}

function getDB() {
  if (!db) init();
  return db;
}

function close() {
  if (db) { db.close(); db = null; insertStmt = null; fetchStmt = null; touchStmt = null; cleanupStmt = null; }
}

module.exports = { init, insert, fetch, cleanupExpired, getDB, close };
