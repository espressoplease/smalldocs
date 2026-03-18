// Service worker — cache-first offline support for SDocs
var CACHE_VERSION = 'sdocs-v2';

var APP_SHELL = [
  '/',
  '/public/css/tokens.css',
  '/public/css/layout.css',
  '/public/css/rendered.css',
  '/public/css/panel.css',
  '/public/css/write.css',
  '/public/css/mobile.css',
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
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// Delete old caches on activate
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE_VERSION; })
             .map(function (n) { return caches.delete(n); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Cache-first fetch handler
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);

  // Skip non-GET requests
  if (e.request.method !== 'GET') return;

  // Skip version-check — always goes to network
  if (url.pathname === '/version-check') return;

  // Google Fonts: cache-first with network fallback
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.match(e.request).then(function (cached) {
        if (cached) return cached;
        return fetch(e.request).then(function (response) {
          var clone = response.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put(e.request, clone); });
          return response;
        });
      })
    );
    return;
  }

  // Same-origin: cache-first, fallback to network (and cache the response)
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then(function (cached) {
        if (cached) return cached;
        return fetch(e.request).then(function (response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(CACHE_VERSION).then(function (cache) { cache.put(e.request, clone); });
          }
          return response;
        });
      })
    );
    return;
  }
});

// Check for updates after page load
self.addEventListener('message', function (e) {
  if (e.data === 'check-update') {
    fetch('/version-check?v=' + CACHE_VERSION).then(function (res) {
      return res.json();
    }).then(function (data) {
      if (data.version && data.version !== CACHE_VERSION) {
        self.registration.update();
      }
    }).catch(function () { /* offline — ignore */ });
  }
});
