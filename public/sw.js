// Service worker - stale-while-revalidate + version-gated cache bust
var CACHE_PREFIX = 'sdocs-cache';
var CACHE_NAME = CACHE_PREFIX + '-v3';

var APP_SHELL = [
  '/docs',
  '/public/css/tokens.css',
  '/public/css/layout.css',
  '/public/css/rendered.css',
  '/public/css/panel.css',
  '/public/css/write.css',
  '/public/css/comments.css',
  '/public/css/mobile.css',
  '/public/brotli-wasm-v1.js',
  '/public/brotli_wasm_bg.wasm',
  '/public/sdocs-yaml.js',
  '/public/sdocs-styles.js',
  '/public/sdocs-state.js',
  '/public/sdocs-theme.js',
  '/public/sdocs-controls.js',
  '/public/sdocs-export.js',
  '/public/sdocs-write.js',
  '/public/sdocs-charts.js',
  '/public/sdocs-math.js',
  '/public/sdocs-app.js',
  '/public/sdocs-comments.js',
  '/public/sdocs-comments-ui.js',
  '/public/sdocs-info.js',
  '/public/notifications.json',
  '/public/vendor/marked.min.js',
  '/public/fonts/inter-400.woff2',
  '/public/fonts/inter-500.woff2',
  '/public/fonts/inter-600.woff2',
  '/public/sdoc.md',
  '/public/legal.md',
  '/public/sdocs-chrome.js',
];

// Fetch that bypasses the browser's HTTP cache. Needed because
// static assets are served with Cache-Control: max-age=86400 - without
// this, the SW's "fresh" fetches can still be served from the browser
// cache and match whatever stale copy it already had.
function freshFetch(req) {
  var request = req instanceof Request ? req : new Request(req);
  return fetch(request, { cache: 'reload' });
}

function isNetworkOnlyRoute(url) {
  var pathname = url.pathname;
  return pathname === '/'
    || pathname === '/connect'
    || pathname === '/library'
    || pathname === '/cloud'
    || pathname.indexOf('/cloud/') === 0
    || pathname === '/api/cloud'
    || pathname.indexOf('/api/cloud/') === 0;
}

function responseCanBeCached(response) {
  var cacheControl = response.headers.get('cache-control') || '';
  return !/(?:^|,)\s*(?:private|no-store)\b/i.test(cacheControl);
}

// Pre-cache app shell on install
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(APP_SHELL.map(function (u) {
        return freshFetch(u).then(function (res) { if (res.ok) return cache.put(u, res); });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// Claim clients on activate
self.addEventListener('activate', function (e) {
  e.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        if (name.indexOf(CACHE_PREFIX) === 0 && name !== CACHE_NAME) return caches.delete(name);
      }));
    }),
  ]));
});

// Stale-while-revalidate for same-origin, cache-first for fonts
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);

  if (e.request.method !== 'GET') return;

  // Range requests pass through to the network. The Cache API matches
  // only by URL+method, so caching a partial 206 would return the wrong
  // byte slice to any follow-up request that asked for a different range,
  // which silently breaks video/audio playback. Network handles this.
  if (e.request.headers.get('range')) return;

  // Version-check always hits network
  if (url.pathname === '/version-check') return;

  // Short-link API: always hits network (content is per-document and
  // the server responds with no-store headers anyway, don't shadow it).
  if (url.pathname === '/api/short' || url.pathname.indexOf('/api/short/') === 0) return;

  // Feedback list: always hits network so a just-submitted row shows up
  // on the next load without a second refresh.
  if (url.pathname === '/api/feedback') return;

  // Shape playground is a dev tool that iterates quickly; never cache it.
  if (url.pathname === '/shapes') return;

  // Account-aware pages and Cloud APIs must always reach the server. This
  // keeps authentication checks authoritative after sign-in and sign-out.
  if (url.origin === self.location.origin && isNetworkOnlyRoute(url)) {
    e.respondWith(freshFetch(e.request));
    return;
  }

  // Google Fonts: cache-first (they're immutable)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.match(e.request).then(function (cached) {
        if (cached) return cached;
        return fetch(e.request).then(function (response) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(e.request, clone); });
          return response;
        });
      })
    );
    return;
  }

  // Same-origin: stale-while-revalidate. Match the complete URL, including the
  // app-version query string. A new version must not resolve to an older cached
  // asset. If the network is unavailable, fall back to the precached path so
  // the app shell can still open offline.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(e.request).then(function (cached) {
          var networkFetch = freshFetch(e.request).then(function (response) {
            if (response.ok && responseCanBeCached(response)) {
              cache.put(e.request, response.clone());
            }
            return response;
          }).catch(function () {
            if (cached) return cached;
            return cache.match(e.request, { ignoreSearch: true });
          });

          return cached || networkFetch;
        });
      })
    );
    return;
  }
});

// Version check: if server version differs, purge the cache and tell all
// open clients to reload. We deliberately do NOT pre-cache APP_SHELL here:
// concurrent SW lifecycle (the new SW installing alongside the old, browser
// terminating the old worker mid-Promise.all when the new one calls
// skipWaiting) made the pre-cache unreliable - cache.put could complete for
// some entries and not others, and the reload then served stale CSS while
// the JS was already on the new version. Empty cache + reload means every
// asset comes fresh from the network on the next load; stale-while-revalidate
// repopulates the cache as the user uses the app.
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'check-update' && e.data.version) {
    // r = the client's per-session reload count, forwarded so the server log
    // can spot a tab reload-looping in the wild (a single grep on r).
    // u=1 marks a check fired by an auto-reload-for-update; the server skips
    // counting it so a deploy doesn't log one visit per open tab.
    var qs = '?cohort=' + encodeURIComponent(e.data.cohort || '')
      + '&r=' + encodeURIComponent(e.data.r || 0)
      + '&u=' + encodeURIComponent(e.data.u || 0);
    // lh/ld are the browser's local hour + weekday. Guard on typeof so hour 0
    // (midnight) / weekday 0 (Sunday) aren't dropped by a falsy check.
    if (typeof e.data.lh === 'number') qs += '&lh=' + encodeURIComponent(e.data.lh);
    if (typeof e.data.ld === 'number') qs += '&ld=' + encodeURIComponent(e.data.ld);
    if (e.data.lt) qs += '&lt=' + encodeURIComponent(e.data.lt);
    fetch('/version-check' + qs).then(function (res) {
      return res.json();
    }).then(function (data) {
      if (data.version !== e.data.version) {
        caches.delete(CACHE_NAME).then(function () {
          return self.clients.matchAll({ includeUncontrolled: true });
        }).then(function (clients) {
          // Include the target version so the client loop-guard can tell
          // whether a prior reload actually moved it forward.
          clients.forEach(function (c) { c.postMessage({ type: 'sdocs-reload', version: data.version }); });
        });
      }
    }).catch(function () { /* offline or error → do nothing, keep old code */ });
  }
});
