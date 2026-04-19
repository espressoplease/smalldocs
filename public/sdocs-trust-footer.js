// Footer "Open source" badge: reads the latest independent-check result from
// GitHub and shows how fresh it is. Fetched from raw.githubusercontent.com
// (not sdocs.dev), so a compromised server cannot forge a green state.
//
// Looks for a `[data-trust-status]` element and replaces its contents with
// the literal prefix "Open source: " followed by a link to /trust whose text
// is one of:
//   ✓ verified 12m ago
//   ⚠ check 3h ago
//   ⚠ pending
//   ✗ mismatch
// Falls back silently on any fetch / CORS / parse error, leaving whatever
// static HTML was there.
(function () {
  var URL_CHECK = 'https://raw.githubusercontent.com/espressoplease/SDocs/trust-manifests/checks/latest.json';
  var CACHE_KEY = 'sdocs.trust.lastCheck.v1';
  var CACHE_TTL_MS = 5 * 60 * 1000;        // 5 min: keep repeat loads off GitHub
  var STALE_CHECK_MS = 2 * 60 * 60 * 1000; // 2 h: mark the check itself as stale

  var el = document.querySelector('[data-trust-status]');
  if (!el) return;

  function humanAge(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60)   return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60)   return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 48)   return h + 'h ago';
    var d = Math.floor(h / 24);
    return d + 'd ago';
  }

  function render(result) {
    if (!result) return;                  // leave static fallback in place
    var checkedAt = result.checkedAt ? Date.parse(result.checkedAt) : NaN;
    var age = Number.isFinite(checkedAt) ? Date.now() - checkedAt : NaN;
    var stale = Number.isFinite(age) && age > STALE_CHECK_MS;

    var glyph, label;
    if (result.result === 'ok' && !stale) {
      glyph = '\u2713'; label = 'verified ' + humanAge(age);
    } else if (result.result === 'ok' && stale) {
      glyph = '\u26A0'; label = 'check ' + humanAge(age);
    } else if (result.result === 'pending') {
      glyph = '\u26A0'; label = 'pending';
    } else if (result.result === 'mismatch') {
      glyph = '\u2717'; label = 'mismatch';
    } else {
      glyph = '\u26A0'; label = 'check failed';
    }

    // Reuse existing <a> (so inline styles on the static fallback survive)
    // and ensure the span reads: "Open source: " <a>status</a>
    var a = el.querySelector('a') || document.createElement('a');
    a.href = '/trust';
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = glyph + ' ' + label;
    a.title = 'commit ' + (result.commit ? result.commit.slice(0, 7) : '?') +
              (Number.isFinite(checkedAt) ? ' - checked ' + new Date(checkedAt).toISOString() : '') +
              '\nSource: ' + URL_CHECK;
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(document.createTextNode('Open source: '));
    el.appendChild(a);
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.fetchedAt || Date.now() - obj.fetchedAt > CACHE_TTL_MS) return null;
      return obj.data;
    } catch (_) { return null; }
  }

  function writeCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), data: data })); }
    catch (_) { /* private mode, quota, etc. */ }
  }

  var cached = readCache();
  if (cached) render(cached);

  fetch(URL_CHECK, { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) { writeCache(data); render(data); })
    .catch(function () { /* leave static fallback */ });
})();
