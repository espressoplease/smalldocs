/**
 * Maintainer-interest database. SQLite storage for email addresses submitted
 * from the document-page maintainer banner.
 *
 * The banner asks for one thing: a reply address for people who want to help
 * maintain the GitHub project. This table stores only that address and the
 * server timestamp. It is never exposed through a public endpoint.
 *
 * Usage:
 *   const maintainers = require('./maintainers/db');
 *   maintainers.init();
 *   const id = maintainers.insert({ email });
 */
const path = require('path');

let db = null;
let insertStmt = null;
let listStmt = null;

function init(dbPath) {
  if (db) db.close();

  const Database = require('better-sqlite3');
  dbPath = dbPath || process.env.MAINTAINER_DB || path.join(__dirname, '..', 'maintainer_interest.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS maintainer_interest (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      email TEXT NOT NULL
    );
  `);

  insertStmt = db.prepare('INSERT INTO maintainer_interest (email) VALUES (?)');
  listStmt = db.prepare('SELECT id, created_at, email FROM maintainer_interest ORDER BY id DESC LIMIT ?');
  return db;
}

function insert(entry) {
  if (!db) init();
  const email = entry && typeof entry.email === 'string' ? entry.email.trim() : '';
  if (!email.length) throw new Error('email must be a non-empty string');
  const result = insertStmt.run(email);
  return result.lastInsertRowid;
}

function list(limit) {
  if (!db) init();
  const n = typeof limit === 'number' && limit > 0 ? Math.min(limit, 500) : 100;
  return listStmt.all(n);
}

function getDB() {
  if (!db) init();
  return db;
}

function close() {
  if (db) { db.close(); db = null; insertStmt = null; listStmt = null; }
}

module.exports = { init, insert, list, getDB, close };
