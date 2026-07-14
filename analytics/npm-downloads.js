/**
 * npm downloads — fetches daily download counts for the sdocs-dev package from
 * the public npm download-counts API and buckets them into ISO weeks. Result is
 * cached in memory for CACHE_MS so we don't hit the API on every dashboard load.
 *
 * The endpoint (https://api.npmjs.org/downloads/range/last-year/sdocs-dev) is
 * unauthenticated and returns one { day, downloads } entry per day for the last
 * year. We sum each day into its ISO week so the chart shares the dashboard's
 * weekly x-axis. Weeks are downloads-that-week, not a running total. A failed
 * fetch leaves the last good data in place and the chart stays empty on a cold
 * start rather than breaking the dashboard read.
 */
const https = require('https');
const { getISOWeek } = require('./week');

const PKG = 'sdocs-dev';
const CACHE_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;
const MAX_BYTES = 2 * 1024 * 1024;

var cache = { weekly: [], fetchedAt: 0, fetching: false };

function fetchDownloads(done) {
  var opts = {
    hostname: 'api.npmjs.org',
    path: '/downloads/range/last-year/' + PKG,
    headers: { 'User-Agent': 'sdocs-analytics', 'Accept': 'application/json' },
    timeout: REQUEST_TIMEOUT_MS
  };
  var req = https.get(opts, function (res) {
    var body = '';
    res.setEncoding('utf8');
    res.on('data', function (c) {
      body += c;
      if (body.length > MAX_BYTES) { req.destroy(new Error('response too large')); }
    });
    res.on('end', function () {
      if (res.statusCode !== 200) { done(new Error('npm downloads API ' + res.statusCode)); return; }
      var parsed;
      try { parsed = JSON.parse(body); }
      catch (e) { done(e); return; }
      if (!parsed || !Array.isArray(parsed.downloads)) { done(new Error('Unexpected response shape')); return; }
      done(null, parsed.downloads);
    });
  });
  req.on('error', function (e) { done(e); });
  req.on('timeout', function () { req.destroy(new Error('timeout')); });
}

function refresh() {
  if (cache.fetching) return;
  if (Date.now() - cache.fetchedAt < CACHE_MS) return;
  cache.fetching = true;
  fetchDownloads(function (err, days) {
    cache.fetching = false;
    if (err) { cache.fetchedAt = Date.now() - CACHE_MS + 60 * 1000; return; }
    var weekly = {};
    days.forEach(function (r) {
      if (!r || !r.day) return;
      var p = r.day.split('-').map(Number);
      var week = getISOWeek(new Date(p[0], p[1] - 1, p[2]));
      weekly[week] = (weekly[week] || 0) + (r.downloads || 0);
    });
    // last-year zero-fills every week back a full year, so the series starts
    // with a long flat run of zeros from before the package was published. Drop
    // that leading run so the chart begins at the first real download, the way
    // the stars and volume charts begin at their first data point. Interior and
    // trailing zero weeks (a genuinely quiet week) are kept.
    var series = Object.keys(weekly).sort().map(function (w) { return { week: w, downloads: weekly[w] }; });
    var firstReal = series.findIndex(function (r) { return r.downloads > 0; });
    cache.weekly = firstReal === -1 ? [] : series.slice(firstReal);
    cache.fetchedAt = Date.now();
  });
}

function getWeeklyDownloads() {
  refresh();
  return cache.weekly;
}

module.exports = { getWeeklyDownloads };
