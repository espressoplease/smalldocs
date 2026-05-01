// Service worker — stale-while-revalidate + version-gated cache bust
var CACHE_NAME = 'sdocs-cache';

var APP_SHELL = [
  '/',
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
// static assets are served with Cache-Control: max-age=86400 — without
// this, the SW's "fresh" fetches can still be served from the browser
// cache and match whatever stale copy it already had.
function freshFetch(req) {
  var request = req instanceof Request ? req : new Request(req);
  return fetch(request, { cache: 'reload' });
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
  e.waitUntil(self.clients.claim());
});

// Stale-while-revalidate for same-origin, cache-first for fonts
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);

  if (e.request.method !== 'GET') return;

  // Version-check always hits network
  if (url.pathname === '/version-check') return;

  // Short-link API: always hits network (content is per-document and
  // the server responds with no-store headers anyway, don't shadow it).
  if (url.pathname === '/api/short' || url.pathname.indexOf('/api/short/') === 0) return;

  // Feedback list: always hits network so a just-submitted row shows up
  // on the next load without a second refresh.
  if (url.pathname === '/api/feedback') return;

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

  // Same-origin: stale-while-revalidate
  // Return cached immediately, fetch fresh (bypassing HTTP cache) in the
  // background so the next page load has up-to-date assets. ignoreSearch so
  // `?v=<app-version>` cache-busting query strings on script/css URLs still
  // match the precached path.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(e.request, { ignoreSearch: true }).then(function (cached) {
          var networkFetch = freshFetch(e.request).then(function (response) {
            if (response.ok) {
              cache.put(e.request, response.clone());
            }
            return response;
          }).catch(function () {
            return cached; // offline fallback
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
    var qs = '?cohort=' + encodeURIComponent(e.data.cohort || '');
    fetch('/version-check' + qs).then(function (res) {
      return res.json();
    }).then(function (data) {
      if (data.version !== e.data.version) {
        caches.delete(CACHE_NAME).then(function () {
          return self.clients.matchAll({ includeUncontrolled: true });
        }).then(function (clients) {
          clients.forEach(function (c) { c.postMessage({ type: 'sdocs-reload' }); });
        });
      }
    }).catch(function () { /* offline, ignore */ });
  }
});
