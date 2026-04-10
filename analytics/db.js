/**
 * Analytics database — SQLite storage for cohort retention tracking.
 *
 * Usage:
 *   const analytics = require('./analytics/db');
 *   analytics.logVisit(ip, cohortWeek);
 *
 * For tests:
 *   analytics.init(':memory:');
 */
const path = require('path');
const crypto = require('crypto');
const { getISOWeek } = require('./week');

let db = null;
let insertStmt = null;

function init(dbPath) {
  if (db) db.close();
  const Database = require('better-sqlite3');
  dbPath = dbPath || path.join(__dirname, '..', 'analytics.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      cohort_week TEXT NOT NULL DEFAULT '',
      visit_week TEXT NOT NULL,
      ip_hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_visits_cohort ON visits(cohort_week, visit_week);
    CREATE INDEX IF NOT EXISTS idx_visits_week ON visits(visit_week);
  `);

  insertStmt = db.prepare('INSERT INTO visits (cohort_week, visit_week, ip_hash) VALUES (?, ?, ?)');
  return db;
}

function hashIP(ip, salt) {
  return crypto.createHash('sha256').update(ip + salt).digest('hex');
}

function logVisit(ip, cohortWeek) {
  if (!db) init();
  var visitWeek = getISOWeek(new Date());
  var ipHash = hashIP(ip || '', cohortWeek || '');
  insertStmt.run(cohortWeek || '', visitWeek, ipHash);
}

function getDB() {
  if (!db) init();
  return db;
}

function close() {
  if (db) { db.close(); db = null; insertStmt = null; }
}

module.exports = { init, logVisit, getDB, close, hashIP };
