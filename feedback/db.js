/**
 * Feedback database. SQLite storage for user-submitted feedback messages.
 *
 * Schema is deliberately minimal: message text + server-generated timestamp.
 * We don't attach cohort, IP, or any other identifier, matching the privacy
 * posture documented in public/sdoc.md.
 *
 * Usage:
 *   const feedback = require('./feedback/db');
 *   feedback.init();
 *   const id = feedback.insert(message);
 */
const path = require('path');

let db = null;
let insertStmt = null;
let listStmt = null;

function init(dbPath) {
  if (db) db.close();

  const Database = require('better-sqlite3');
  dbPath = dbPath || process.env.FEEDBACK_DB || path.join(__dirname, '..', 'feedback.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      message TEXT NOT NULL
    );
  `);

  insertStmt = db.prepare('INSERT INTO feedback (message) VALUES (?)');
  listStmt = db.prepare('SELECT id, created_at, message FROM feedback ORDER BY id DESC LIMIT ?');
  return db;
}

function list(limit) {
  if (!db) init();
  var n = typeof limit === 'number' && limit > 0 ? Math.min(limit, 500) : 100;
  return listStmt.all(n);
}

function insert(message) {
  if (!db) init();
  if (typeof message !== 'string' || !message.length) {
    throw new Error('message must be a non-empty string');
  }
  const result = insertStmt.run(message);
  return result.lastInsertRowid;
}

function getDB() {
  if (!db) init();
  return db;
}

function close() {
  if (db) { db.close(); db = null; insertStmt = null; listStmt = null; }
}

module.exports = { init, insert, list, getDB, close };
