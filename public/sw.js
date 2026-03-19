// Service worker — stale-while-revalidate + version-gated cache bust
var CACHE_NAME = 'sdocs-cache';

var APP_SHELL = [
  '/',
  '/public/css/tokens.css',
  '/public/css/layout.css',
  '/public/css/rendered.css',
  '/public/css/panel.css',
  '/public/css/write.css',
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
  '/public/sdocs-app.js',
  '/public/vendor/marked.min.js',
  '/public/fonts/inter-400.woff2',
  '/public/fonts/inter-500.woff2',
  '/public/fonts/inter-600.woff2',
  '/public/default.md',
];

// Pre-cache app shell on install
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
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
  // Return cached immediately, fetch in background to update cache
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(e.request).then(function (cached) {
          var networkFetch = fetch(e.request).then(function (response) {
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

// Version check: if server version differs, purge and re-cache.
// No reload — stale-while-revalidate ensures next navigation gets fresh content.
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'check-update' && e.data.version) {
    fetch('/version-check').then(function (res) {
      return res.json();
    }).then(function (data) {
      if (data.version !== e.data.version) {
        caches.delete(CACHE_NAME).then(function () {
          return caches.open(CACHE_NAME).then(function (cache) {
            return cache.addAll(APP_SHELL);
          });
        });
      }
    }).catch(function () { /* offline — ignore */ });
  }
});
