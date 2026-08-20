const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function(harness) {
  const { assert, test } = harness;

  console.log('\n── Service Worker Tests ────────────────────────\n');

  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  const context = {
    URL,
    Request,
    Promise,
    fetch: function() {},
    caches: {
      delete: function() {},
      keys: function() { return Promise.resolve([]); },
      open: function() { return Promise.resolve({}); },
    },
    self: {
      addEventListener: function() {},
      clients: { claim: function() { return Promise.resolve(); } },
      location: { origin: 'https://smalldocs.org' },
      skipWaiting: function() { return Promise.resolve(); },
    },
  };
  vm.runInNewContext(source, context, { filename: 'public/sw.js' });

  test('service worker sends account-aware pages and Cloud APIs to the network', () => {
    [
      'https://smalldocs.org/',
      'https://smalldocs.org/connect?return=%2Flibrary',
      'https://smalldocs.org/library?scope=cloud',
      'https://smalldocs.org/cloud/account',
      'https://smalldocs.org/cloud/admin',
      'https://smalldocs.org/api/cloud/v1/me',
      'https://smalldocs.org/api/cloud/v1/documents/doc-1',
    ].forEach((url) => assert.strictEqual(context.isNetworkOnlyRoute(new URL(url)), true, url));
    assert.strictEqual(context.isNetworkOnlyRoute(new URL('https://smalldocs.org/docs')), false);
    assert.strictEqual(context.isNetworkOnlyRoute(new URL('https://smalldocs.org/public/tokens.css')), false);
  });

  test('service worker refuses private and no-store responses', () => {
    function response(cacheControl) {
      return { headers: { get: () => cacheControl } };
    }
    assert.strictEqual(context.responseCanBeCached(response('private, no-store')), false);
    assert.strictEqual(context.responseCanBeCached(response('no-store')), false);
    assert.strictEqual(context.responseCanBeCached(response('public, max-age=86400')), true);
    assert.strictEqual(context.responseCanBeCached(response('no-cache')), true);
  });

  test('service worker cache version changes and removes older cache generations', () => {
    assert.strictEqual(context.CACHE_NAME, 'sdocs-cache-v3');
    assert.ok(source.includes("name.indexOf(CACHE_PREFIX) === 0 && name !== CACHE_NAME"));
  });

  test('versioned assets require an exact cache match before the offline fallback', () => {
    assert.ok(source.includes('return cache.match(e.request).then(function (cached)'));
    assert.ok(source.includes('return cache.match(e.request, { ignoreSearch: true });'));
  });
};
