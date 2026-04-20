/**
 * GitHub stars — fetches the repo's stargazer timestamps from the GitHub API
 * and bucket-counts them into ISO weeks (cumulative). Result is cached in
 * memory for CACHE_MS so we don't hammer the API on every dashboard load.
 *
 * Unauthenticated GitHub API is limited to 60 req/hour per IP. At 100 stars
 * per page that supports up to 6000 stars per refresh, which is plenty.
 */
const https = require('https');
const { getISOWeek } = require('./week');

const REPO = 'espressoplease/SDocs';
const CACHE_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;

var cache = { weekly: [], total: 0, fetchedAt: 0, fetching: false };

function fetchPage(page, acc, done) {
  var opts = {
    hostname: 'api.github.com',
    path: '/repos/' + REPO + '/stargazers?per_page=100&page=' + page,
    headers: {
      'User-Agent': 'sdocs-analytics',
      'Accept': 'application/vnd.github.star+json'
    },
    timeout: REQUEST_TIMEOUT_MS
  };
  var req = https.get(opts, function (res) {
    var chunks = [];
    res.on('data', function (c) { chunks.push(c); });
    res.on('end', function () {
      if (res.statusCode !== 200) { done(new Error('GitHub API ' + res.statusCode)); return; }
      var body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch (e) { done(e); return; }
      if (!Array.isArray(body)) { done(new Error('Unexpected response shape')); return; }
      for (var i = 0; i < body.length; i++) {
        if (body[i] && body[i].starred_at) acc.push(body[i].starred_at);
      }
      if (body.length === 100) { fetchPage(page + 1, acc, done); return; }
      done(null, acc);
    });
  });
  req.on('error', function (e) { done(e); });
  req.on('timeout', function () { req.destroy(new Error('timeout')); });
}

function refresh() {
  if (cache.fetching) return;
  if (Date.now() - cache.fetchedAt < CACHE_MS) return;
  cache.fetching = true;
  fetchPage(1, [], function (err, starredAts) {
    cache.fetching = false;
    if (err) { cache.fetchedAt = Date.now() - CACHE_MS + 60 * 1000; return; }
    starredAts.sort();
    var weekly = {};
    var running = 0;
    var order = [];
    starredAts.forEach(function (s) {
      running++;
      var w = getISOWeek(new Date(s));
      if (!(w in weekly)) order.push(w);
      weekly[w] = running;
    });
    cache.weekly = order.map(function (w) { return { week: w, stars: weekly[w] }; });
    cache.total = running;
    cache.fetchedAt = Date.now();
  });
}

function getWeeklyStars() {
  refresh();
  return cache.weekly;
}

module.exports = { getWeeklyStars };
