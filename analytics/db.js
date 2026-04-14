/**
 * Analytics database — SQLite storage for cohort visit counts.
 * Visits are buffered in memory and flushed to SQLite every 15 minutes.
 *
 * Counts page-load visits, not unique users. There is no per-user identifier;
 * a power user revisiting 50 times shows up as 50 visits. The only signal
 * tying visits together is the cohort_week the browser reports from its
 * own localStorage.
 *
 * Usage:
 *   const analytics = require('./analytics/db');
 *   analytics.logVisit(cohortWeek, userAgent, referer);
 */
const path = require('path');
const { getISOWeek } = require('./week');

let db = null;
let insertStmt = null;
let buffer = [];
let flushTimer = null;

const FLUSH_INTERVAL = 15 * 60 * 1000; // 15 minutes

function init(dbPath) {
  if (db) db.close();
  if (flushTimer) clearInterval(flushTimer);
  buffer = [];

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
      device TEXT NOT NULL DEFAULT '',
      browser TEXT NOT NULL DEFAULT '',
      referer TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_visits_cohort ON visits(cohort_week, visit_week);
    CREATE INDEX IF NOT EXISTS idx_visits_week ON visits(visit_week);
  `);

  // Add columns if upgrading from older schema
  try { db.exec("ALTER TABLE visits ADD COLUMN device TEXT NOT NULL DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE visits ADD COLUMN browser TEXT NOT NULL DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE visits ADD COLUMN referer TEXT NOT NULL DEFAULT ''"); } catch (e) {}
  // Drop legacy ip_hash column. We deliberately stopped storing any per-user
  // identifier — all metrics are now raw page-load counts.
  try { db.exec("ALTER TABLE visits DROP COLUMN ip_hash"); } catch (e) {}

  insertStmt = db.prepare('INSERT INTO visits (cohort_week, visit_week, device, browser, referer) VALUES (?, ?, ?, ?, ?)');

  flushTimer = setInterval(flush, FLUSH_INTERVAL);
  if (flushTimer.unref) flushTimer.unref();

  return db;
}

function parseUA(ua) {
  if (!ua) return { device: 'unknown', browser: 'unknown' };
  var device = 'desktop';
  if (/Mobile|Android.*Mobile|iPhone|iPod/.test(ua)) device = 'mobile';
  else if (/iPad|Android(?!.*Mobile)|Tablet/.test(ua)) device = 'tablet';

  var browser = 'other';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';

  return { device: device, browser: browser };
}

function parseReferer(ref) {
  if (!ref) return 'direct';
  try {
    var host = new URL(ref).hostname.replace('www.', '');
    if (host === 'sdocs.dev' || host === 'localhost') return 'direct';
    if (host.includes('google') || host.includes('bing') || host.includes('duckduckgo')) return 'search';
    if (host.includes('github')) return 'github';
    if (host.includes('npmjs')) return 'npm';
    return host;
  } catch (e) { return 'direct'; }
}

function logVisit(cohortWeek, userAgent, referer) {
  if (!db) init();
  var visitWeek = getISOWeek(new Date());
  var ua = parseUA(userAgent);
  var ref = parseReferer(referer);
  buffer.push([cohortWeek || '', visitWeek, ua.device, ua.browser, ref]);
}

function flush() {
  if (!buffer.length) return;
  if (!db) init();
  var batch = buffer;
  buffer = [];
  var txn = db.transaction(function () {
    for (var i = 0; i < batch.length; i++) {
      insertStmt.run.apply(insertStmt, batch[i]);
    }
  });
  txn();
}

function getDB() {
  if (!db) init();
  return db;
}

function bufferSize() {
  return buffer.length;
}

function close() {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  flush();
  if (db) { db.close(); db = null; insertStmt = null; }
}

module.exports = { init, logVisit, flush, getDB, close, bufferSize };
