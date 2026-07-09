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
  dbPath = dbPath || process.env.ANALYTICS_DB || path.join(__dirname, '..', 'analytics.db');
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
      referer TEXT NOT NULL DEFAULT '',
      local_hour INTEGER,
      local_dow INTEGER,
      load_type TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_visits_cohort ON visits(cohort_week, visit_week);
    CREATE INDEX IF NOT EXISTS idx_visits_week ON visits(visit_week);
  `);

  // Add columns if upgrading from older schema
  try { db.exec("ALTER TABLE visits ADD COLUMN device TEXT NOT NULL DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE visits ADD COLUMN browser TEXT NOT NULL DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE visits ADD COLUMN referer TEXT NOT NULL DEFAULT ''"); } catch (e) {}
  // The browser reports its own local hour (0-23) and weekday (0=Sun..6=Sat)
  // at visit time, so "time of day" / "day of week" reflect when the visitor
  // actually used it, not UTC. Nullable — rows before this shipped, and any
  // visit that doesn't report them, leave both NULL and drop out of those two
  // charts. No timezone or offset is stored, only the two small integers.
  try { db.exec("ALTER TABLE visits ADD COLUMN local_hour INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE visits ADD COLUMN local_dow INTEGER"); } catch (e) {}
  // How the page was opened: a /s/ short link, a document link (#md — includes
  // CLI file opens, which carry md=), or the bare app/home. Lets the dashboard
  // compare short-link opens against full-link opens against homepage landings.
  // Empty for rows before this shipped.
  try { db.exec("ALTER TABLE visits ADD COLUMN load_type TEXT NOT NULL DEFAULT ''"); } catch (e) {}
  // Drop legacy ip_hash column. We deliberately stopped storing any per-user
  // identifier — all metrics are now raw page-load counts.
  try { db.exec("ALTER TABLE visits DROP COLUMN ip_hash"); } catch (e) {}

  insertStmt = db.prepare('INSERT INTO visits (cohort_week, visit_week, device, browser, referer, local_hour, local_dow, load_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

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
  if (!ref || ref.length > 2048) return 'direct';
  try {
    var host = new URL(ref).hostname.replace('www.', '');
    if (host === 'smalldocs.org' || host === 'sdocs.dev' || host === 'localhost') return 'direct';
    if (host.includes('google') || host.includes('bing') || host.includes('duckduckgo')) return 'search';
    if (host.includes('github')) return 'github';
    if (host.includes('npmjs')) return 'npm';
    return host;
  } catch (e) { return 'direct'; }
}

// Clamp a reported integer to [min, max]; anything out of range or unparseable
// becomes null so a bad/absent value can't skew a bucket.
function normInt(v, min, max) {
  var n = parseInt(v, 10);
  if (isNaN(n) || n < min || n > max) return null;
  return n;
}

// Constrain load_type to the known set; anything else is stored as '' so a
// junk value can't create a phantom bucket in the dashboard. 'home' is the
// marketing landing page; 'app' is the bare app shell with no document.
function normLoadType(v) {
  return (v === 'short' || v === 'hash' || v === 'app' || v === 'home') ? v : '';
}

function logVisit(cohortWeek, userAgent, referer, localHour, localDow, loadType) {
  if (!db) init();
  var visitWeek = getISOWeek(new Date());
  var ua = parseUA(userAgent);
  var ref = parseReferer(referer);
  var lh = normInt(localHour, 0, 23);
  var ld = normInt(localDow, 0, 6);
  var lt = normLoadType(loadType);
  buffer.push([cohortWeek || '', visitWeek, ua.device, ua.browser, ref, lh, ld, lt]);
  if (process.env.ANALYTICS_FLUSH_IMMEDIATE === '1') flush();
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
