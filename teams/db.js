/**
 * Teams-interest database. SQLite storage for "register interest" form
 * submissions from the homepage Teams section.
 *
 * Unlike feedback.db this deliberately stores contact details (that is the
 * point of the form: the visitor asks to be contacted). It is never exposed
 * through a public endpoint; read it over ssh:
 *
 *   node -e "const D=require('better-sqlite3');
 *            const d=new D('teams_interest.db',{readonly:true});
 *            console.table(d.prepare('select * from teams_interest').all())"
 *
 * Usage:
 *   const teams = require('./teams/db');
 *   teams.init();
 *   const id = teams.insert({ email, company, message });
 */
const path = require('path');

let db = null;
let insertStmt = null;
let listStmt = null;

function init(dbPath) {
  if (db) db.close();

  const Database = require('better-sqlite3');
  dbPath = dbPath || process.env.TEAMS_DB || path.join(__dirname, '..', 'teams_interest.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS teams_interest (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      email TEXT NOT NULL,
      company TEXT,
      message TEXT
    );
  `);

  insertStmt = db.prepare('INSERT INTO teams_interest (email, company, message) VALUES (?, ?, ?)');
  listStmt = db.prepare('SELECT id, created_at, email, company, message FROM teams_interest ORDER BY id DESC LIMIT ?');
  return db;
}

function insert(entry) {
  if (!db) init();
  const email = entry && typeof entry.email === 'string' ? entry.email.trim() : '';
  if (!email.length) throw new Error('email must be a non-empty string');
  const company = typeof entry.company === 'string' && entry.company.trim().length ? entry.company.trim() : null;
  const message = typeof entry.message === 'string' && entry.message.trim().length ? entry.message.trim() : null;
  const result = insertStmt.run(email, company, message);
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
