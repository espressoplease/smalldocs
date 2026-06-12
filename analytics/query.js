/**
 * Analytics queries — reads raw visit counts from the visits table.
 *
 * No unique-user math: every metric is COUNT(*) of page-load visits.
 * The cohort table answers "how much activity did the W-N cohort
 * generate in week W-M", not "how many people". Same person revisiting
 * 50 times = 50 visits.
 *
 * Legacy merge: the project moved from sdocs.dev to smalldocs.org in
 * June 2026 and each deployment keeps its own SQLite files. When
 * ANALYTICS_LEGACY_DB (and optionally ANALYTICS_LEGACY_SHORT_LINKS_DB)
 * point at the old deployment's files, every count below is the sum of
 * both databases, so the dashboard shows the project's full history.
 * Both apps run on the same box as the same user, so this is a direct
 * read-only file open, not an HTTP fetch. A missing or unreadable
 * legacy file degrades to current-site-only data.
 */
const fs = require('fs');
const { getDB } = require('./db');
const shortLinks = require('../short-links/db');
const githubStars = require('./github-stars');

// All visit-table reads for one database handle. `sources` is returned
// un-truncated here; the top-10 cut happens after any merge so the
// combined ranking is exact.
function readVisitPayload(db) {
  var weeks = db.prepare(
    "SELECT DISTINCT visit_week FROM visits ORDER BY visit_week"
  ).all().map(function (r) { return r.visit_week; });

  // Cohort "size" = visits the cohort generated in its birth week.
  // Defined this way so the diagonal of the table is always the baseline
  // each later week is compared against.
  var sizeRows = db.prepare(
    "SELECT cohort_week, COUNT(*) as cohort_size FROM visits WHERE cohort_week != '' AND cohort_week = visit_week GROUP BY cohort_week ORDER BY cohort_week"
  ).all();

  var cellRows = db.prepare(
    "SELECT cohort_week, visit_week, COUNT(*) as visits FROM visits WHERE cohort_week != '' GROUP BY cohort_week, visit_week ORDER BY cohort_week, visit_week"
  ).all();

  var cohortMap = {};
  sizeRows.forEach(function (r) {
    cohortMap[r.cohort_week] = { cohort_week: r.cohort_week, cohort_size: r.cohort_size, visits: {} };
  });
  // Cohorts with zero birth-week visits (e.g. cohort set in browser but server
  // only saw later weeks): include them so they still show up in the table.
  cellRows.forEach(function (r) {
    if (!cohortMap[r.cohort_week]) {
      cohortMap[r.cohort_week] = { cohort_week: r.cohort_week, cohort_size: 0, visits: {} };
    }
    cohortMap[r.cohort_week].visits[r.visit_week] = r.visits;
  });

  var cohorts = Object.keys(cohortMap).sort().map(function (k) { return cohortMap[k]; });

  // Unattributed visits (no cohort reported — opt-out / private browsing)
  var unattributed = {};
  db.prepare(
    "SELECT visit_week, COUNT(*) as visits FROM visits WHERE cohort_week = '' GROUP BY visit_week ORDER BY visit_week"
  ).all().forEach(function (r) { unattributed[r.visit_week] = r.visits; });

  var devices = db.prepare(
    "SELECT device, COUNT(*) as count FROM visits WHERE device != '' GROUP BY device ORDER BY count DESC"
  ).all();

  var browsers = db.prepare(
    "SELECT browser, COUNT(*) as count FROM visits WHERE browser != '' GROUP BY browser ORDER BY count DESC"
  ).all();

  var sources = db.prepare(
    "SELECT referer, COUNT(*) as count FROM visits WHERE referer != '' GROUP BY referer ORDER BY count DESC"
  ).all();

  var volume = db.prepare(
    "SELECT visit_week, COUNT(*) as visits FROM visits GROUP BY visit_week ORDER BY visit_week"
  ).all();

  return { weeks: weeks, cohorts: cohorts, unattributed: unattributed,
           devices: devices, browsers: browsers, sources: sources, volume: volume };
}

// Sum two keyed count lists ([{key, count}]) into one, sorted by count desc.
function sumCounts(a, b, key, valKey) {
  var map = {};
  (a || []).concat(b || []).forEach(function (r) {
    map[r[key]] = (map[r[key]] || 0) + r[valKey];
  });
  return Object.keys(map).map(function (k) {
    var row = {}; row[key] = k; row[valKey] = map[k]; return row;
  }).sort(function (x, y) { return y[valKey] - x[valKey]; });
}

// Sum two {week: count} objects.
function sumWeekObjects(a, b) {
  var out = {};
  [a || {}, b || {}].forEach(function (obj) {
    Object.keys(obj).forEach(function (w) { out[w] = (out[w] || 0) + obj[w]; });
  });
  return out;
}

function mergeVisitPayloads(a, b) {
  var weeks = Array.from(new Set((a.weeks || []).concat(b.weeks || []))).sort();

  var cohortMap = {};
  (a.cohorts || []).concat(b.cohorts || []).forEach(function (c) {
    var m = cohortMap[c.cohort_week];
    if (!m) {
      m = cohortMap[c.cohort_week] = { cohort_week: c.cohort_week, cohort_size: 0, visits: {} };
    }
    m.cohort_size += c.cohort_size;
    Object.keys(c.visits).forEach(function (w) {
      m.visits[w] = (m.visits[w] || 0) + c.visits[w];
    });
  });
  var cohorts = Object.keys(cohortMap).sort().map(function (k) { return cohortMap[k]; });

  var volumeMap = {};
  (a.volume || []).concat(b.volume || []).forEach(function (r) {
    volumeMap[r.visit_week] = (volumeMap[r.visit_week] || 0) + r.visits;
  });
  var volume = Object.keys(volumeMap).sort().map(function (w) {
    return { visit_week: w, visits: volumeMap[w] };
  });

  return {
    weeks: weeks,
    cohorts: cohorts,
    unattributed: sumWeekObjects(a.unattributed, b.unattributed),
    devices: sumCounts(a.devices, b.devices, 'device', 'count'),
    browsers: sumCounts(a.browsers, b.browsers, 'browser', 'count'),
    sources: sumCounts(a.sources, b.sources, 'referer', 'count'),
    volume: volume,
  };
}

function readLegacyVisitPayload(dbPath) {
  var Database = require('better-sqlite3');
  var db = new Database(dbPath, { readonly: true });
  try { return readVisitPayload(db); } finally { db.close(); }
}

// Same weekly bucketing as short-links/db.js getWeeklyCreationCounts, run
// against the legacy short_links.db.
function readLegacyShortLinkCounts(dbPath) {
  var Database = require('better-sqlite3');
  var { getISOWeek } = require('./week');
  var db = new Database(dbPath, { readonly: true });
  try {
    var counts = {};
    db.prepare('SELECT created_at FROM short_links').all().forEach(function (r) {
      var p = r.created_at.slice(0, 10).split('-').map(Number);
      var week = getISOWeek(new Date(p[0], p[1] - 1, p[2]));
      counts[week] = (counts[week] || 0) + 1;
    });
    return Object.keys(counts).sort().map(function (w) { return { week: w, count: counts[w] }; });
  } finally { db.close(); }
}

function getRetentionData() {
  var payload = readVisitPayload(getDB());

  var legacyDbPath = process.env.ANALYTICS_LEGACY_DB;
  if (legacyDbPath && fs.existsSync(legacyDbPath)) {
    try {
      payload = mergeVisitPayloads(payload, readLegacyVisitPayload(legacyDbPath));
    } catch (e) {
      console.log('[analytics] legacy db unreadable, serving current-site data only: ' + e.message);
    }
  }

  var shortLinkWeekly = [];
  try { shortLinkWeekly = shortLinks.getWeeklyCreationCounts(); } catch (e) { /* short_links DB missing */ }
  var legacyLinksPath = process.env.ANALYTICS_LEGACY_SHORT_LINKS_DB;
  if (legacyLinksPath && fs.existsSync(legacyLinksPath)) {
    try {
      shortLinkWeekly = sumCounts(shortLinkWeekly, readLegacyShortLinkCounts(legacyLinksPath), 'week', 'count')
        .sort(function (x, y) { return x.week < y.week ? -1 : 1; });
    } catch (e) {
      console.log('[analytics] legacy short-links db unreadable: ' + e.message);
    }
  }

  // Stars come from the GitHub API for the one consolidated repo; the legacy
  // deployment tracked the same repo, so there is nothing to sum.
  var stars = [];
  try { stars = githubStars.getWeeklyStars(); } catch (e) { /* network unavailable */ }

  return {
    generated: new Date().toISOString(),
    weeks: payload.weeks,
    cohorts: payload.cohorts,
    unattributed: payload.unattributed,
    devices: payload.devices,
    browsers: payload.browsers,
    sources: payload.sources.slice(0, 10),
    volume: payload.volume,
    shortLinks: shortLinkWeekly,
    stars: stars
  };
}

module.exports = { getRetentionData, readVisitPayload, mergeVisitPayloads };
