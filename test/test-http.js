/**
 * HTTP server tests (async, starts server)
 */
const path = require('path');

module.exports = function(harness) {
  const { assert, testAsync, get, post } = harness;

  return async function() {
    console.log('\n── HTTP Tests (starting server) ─────────────────\n');

    const { spawn } = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const testDbPath = path.join(os.tmpdir(), 'sdocs-test-analytics-' + process.pid + '.db');
    const testShortLinksDbPath = path.join(os.tmpdir(), 'sdocs-test-short-links-' + process.pid + '.db');
    try { fs.unlinkSync(testDbPath); } catch (_) {}
    try { fs.unlinkSync(testShortLinksDbPath); } catch (_) {}
    const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
      env: {
        ...process.env,
        PORT: '3099',
        ANALYTICS_ENABLED: '1',
        ANALYTICS_DB: testDbPath,
        ANALYTICS_FLUSH_IMMEDIATE: '1',
        SHORT_LINKS_DB: testShortLinksDbPath,
      },
      stdio: 'pipe',
    });

    await new Promise((resolve, reject) => {
      let ready = false;
      server.stdout.on('data', d => {
        if (!ready && d.toString().includes('running at')) {
          ready = true;
          resolve();
        }
      });
      server.stderr.on('data', d => console.error('server stderr:', d.toString()));
      setTimeout(() => { if (!ready) reject(new Error('Server did not start in time')); }, 3000);
    });

    const BASE = 'http://localhost:3099';

    await testAsync('GET / returns 200', async () => {
      const r = await get(BASE + '/');
      assert.strictEqual(r.status, 200);
    });

    await testAsync('GET / returns HTML content-type', async () => {
      const r = await get(BASE + '/');
      assert.ok(r.headers['content-type'].includes('text/html'));
    });

    await testAsync('GET / body contains SDocs markup', async () => {
      const r = await get(BASE + '/');
      assert.ok(r.body.includes('SDocs'));
    });

    await testAsync('GET /new returns 200 with HTML', async () => {
      const r = await get(BASE + '/new');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('text/html'));
      assert.ok(r.body.includes('SDocs'));
    });

    await testAsync('GET /nonexistent returns 404', async () => {
      const r = await get(BASE + '/nonexistent-path-xyz');
      assert.strictEqual(r.status, 404);
    });

    await testAsync('GET /public/index.html returns 200', async () => {
      const r = await get(BASE + '/public/index.html');
      assert.strictEqual(r.status, 200);
    });

    await testAsync('Path traversal returns 404 or 403', async () => {
      const r = await get(BASE + '/public/../../package.json');
      assert.ok(r.status === 404 || r.status === 403);
    });

    await testAsync('GET /public/css/tokens.css returns 200 with CSS content-type', async () => {
      const r = await get(BASE + '/public/css/tokens.css');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('text/css'));
    });

    await testAsync('GET /public/sdocs-yaml.js returns 200 with JS content-type', async () => {
      const r = await get(BASE + '/public/sdocs-yaml.js');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('javascript'));
    });

    await testAsync('GET /install.sh returns the CLI installer script', async () => {
      const r = await get(BASE + '/install.sh');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('shellscript'),
        'expected a shell-script content-type, got ' + r.headers['content-type']);
      assert.ok(r.body.startsWith('#!/bin/sh'), 'install.sh should start with a sh shebang');
      assert.ok(r.body.includes('.sdocs'), 'install.sh should install under ~/.sdocs');
    });

    await testAsync('GET /public/images/*.webp returns 200 with image/webp + cacheable', async () => {
      const r = await get(BASE + '/public/images/example_sdoc_pdf.webp');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('image/webp'),
        'expected image/webp, got ' + r.headers['content-type']);
      assert.ok(/max-age=\d+/.test(r.headers['cache-control'] || ''),
        'expected cacheable Cache-Control, got ' + r.headers['cache-control']);
    });

    await testAsync('GET /public/images/*.png returns 200 with image/png + cacheable', async () => {
      const r = await get(BASE + '/public/images/test.png');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('image/png'),
        'expected image/png, got ' + r.headers['content-type']);
      assert.ok(/max-age=\d+/.test(r.headers['cache-control'] || ''),
        'expected cacheable Cache-Control, got ' + r.headers['cache-control']);
    });

    await testAsync('GET / HTML references all CSS modules', async () => {
      const r = await get(BASE + '/');
      assert.ok(r.body.includes('css/tokens.css'), 'missing tokens.css link');
      assert.ok(r.body.includes('css/layout.css'), 'missing layout.css link');
      assert.ok(r.body.includes('css/rendered.css'), 'missing rendered.css link');
      assert.ok(r.body.includes('css/panel.css'), 'missing panel.css link');
      assert.ok(r.body.includes('css/mobile.css'), 'missing mobile.css link');
    });

    await testAsync('GET / HTML references all JS modules in order', async () => {
      const r = await get(BASE + '/');
      const yamlIdx = r.body.indexOf('sdocs-yaml.js');
      const stateIdx = r.body.indexOf('sdocs-state.js');
      const appIdx = r.body.indexOf('sdocs-app.js');
      assert.ok(yamlIdx > 0, 'missing sdocs-yaml.js');
      assert.ok(stateIdx > yamlIdx, 'sdocs-state.js should come after sdocs-yaml.js');
      assert.ok(appIdx > stateIdx, 'sdocs-app.js should come after sdocs-state.js');
    });

    await testAsync('GET /analytics returns 200 with HTML', async () => {
      const r = await get(BASE + '/analytics');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('text/html'));
    });

    await testAsync('GET /analytics/data returns 200 with JSON', async () => {
      const r = await get(BASE + '/analytics/data');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('application/json'));
      const data = JSON.parse(r.body);
      assert.ok(Array.isArray(data.weeks), 'should have weeks array');
      assert.ok(Array.isArray(data.cohorts), 'should have cohorts array');
    });

    await testAsync('GET /version-check?cohort=2026-W15 returns 200', async () => {
      const r = await get(BASE + '/version-check?cohort=2026-W15');
      assert.strictEqual(r.status, 200);
      const data = JSON.parse(r.body);
      assert.ok(data.version, 'should have version');
    });

    await testAsync('version-check writes a row with the reported cohort and no ip_hash', async () => {
      await get(BASE + '/version-check?cohort=2026-W99');
      const Database = require('better-sqlite3');
      const db = new Database(testDbPath, { readonly: true });
      try {
        const row = db.prepare("SELECT * FROM visits WHERE cohort_week = '2026-W99' ORDER BY id DESC LIMIT 1").get();
        assert.ok(row, 'expected a visits row for cohort 2026-W99');
        assert.strictEqual(row.cohort_week, '2026-W99');
        assert.ok(row.visit_week, 'visit_week should be set');
        assert.ok(!('ip_hash' in row), 'visits row must not carry an ip_hash column');
      } finally {
        db.close();
      }
    });

    // ── Short-link endpoints ──────────────────────────

    let createdId;
    const sampleCipher = 'AAAA-_abcdef0123456789';  // valid base64url, opaque to server

    await testAsync('POST /api/short with valid ciphertext returns 201 + long id', async () => {
      const r = await post(BASE + '/api/short', { ciphertext: sampleCipher });
      assert.strictEqual(r.status, 201);
      const data = JSON.parse(r.body);
      assert.ok(data.id, 'response should include id');
      assert.ok(/^[A-Za-z0-9_-]+$/.test(data.id), 'id should be base64url chars');
      assert.strictEqual(data.id.length, 22, 'new short links should mint a 22-char id, got: ' + data.id);
      createdId = data.id;
    });

    await testAsync('POST /api/short missing ciphertext returns 400', async () => {
      const r = await post(BASE + '/api/short', { notRight: 'x' });
      assert.strictEqual(r.status, 400);
    });

    await testAsync('POST /api/short with invalid ciphertext chars returns 400', async () => {
      const r = await post(BASE + '/api/short', { ciphertext: 'has spaces!' });
      assert.strictEqual(r.status, 400);
    });

    await testAsync('POST /api/short with oversized body returns 413', async () => {
      // Produce a ~300KB base64url string
      const big = 'A'.repeat(300 * 1024);
      const r = await post(BASE + '/api/short', { ciphertext: big });
      assert.strictEqual(r.status, 413);
    });

    await testAsync('POST /api/short with invalid JSON returns 400', async () => {
      const r = await post(BASE + '/api/short', '{not json', { 'Content-Type': 'application/json' });
      assert.strictEqual(r.status, 400);
    });

    await testAsync('GET /api/short/:id returns stored ciphertext', async () => {
      const r = await get(BASE + '/api/short/' + createdId);
      assert.strictEqual(r.status, 200);
      const data = JSON.parse(r.body);
      assert.strictEqual(data.ciphertext, sampleCipher);
    });

    await testAsync('GET /api/short/:id sends no-store cache header', async () => {
      const r = await get(BASE + '/api/short/' + createdId);
      assert.ok(
        r.headers['cache-control'] && r.headers['cache-control'].includes('no-store'),
        'cache-control should include no-store'
      );
    });

    await testAsync('GET /api/short/:id for unknown id returns 404', async () => {
      const r = await get(BASE + '/api/short/definitely-not-real');
      assert.strictEqual(r.status, 404);
    });

    await testAsync('GET /s/:id serves index.html (client-side render)', async () => {
      const r = await get(BASE + '/s/' + createdId);
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('text/html'));
      assert.ok(r.body.includes('sdocs-app.js'), 'should serve the SDocs index');
    });

    // ── Asset cache-busting ──────────────────────────
    // Returning users with a stale browser HTTP cache will get the new HTML
    // and refetch local assets only if their URLs differ. Every <link> /
    // <script> referencing /public/ must therefore carry ?v=APP_VERSION on
    // every HTML route the server serves. Regression of this rule is what
    // produced the "two icons next to each other" bug in May 2026.
    function extractPublicAssetUrls(body) {
      const urls = [];
      const scriptRe = /<script\b[^>]*?\s+src=["']([^"']+)["']/gi;
      let m;
      while ((m = scriptRe.exec(body)) !== null) {
        if (m[1].startsWith('/public/')) urls.push({ kind: 'script', url: m[1] });
      }
      const linkRe = /<link\b([^>]*)>/gi;
      while ((m = linkRe.exec(body)) !== null) {
        const attrs = m[1];
        if (!/\srel=["']stylesheet["']/i.test(attrs)) continue;
        const hrefM = attrs.match(/\shref=["']([^"']+)["']/i);
        if (hrefM && hrefM[1].startsWith('/public/')) urls.push({ kind: 'link', url: hrefM[1] });
      }
      return urls;
    }

    async function assertEveryAssetVersioned(path, expectedVersion) {
      const r = await get(BASE + path);
      assert.strictEqual(r.status, 200, path + ' should be 200');
      const refs = extractPublicAssetUrls(r.body);
      assert.ok(refs.length > 0, path + ' should reference at least one /public/ asset');
      for (const ref of refs) {
        const re = /\?v=([a-f0-9]{10})\b/;
        const match = ref.url.match(re);
        assert.ok(match, path + ': ' + ref.kind + ' ' + ref.url + ' missing ?v=<10-hex>');
        assert.strictEqual(match[1], expectedVersion,
          path + ': ' + ref.url + ' has ?v=' + match[1] + ', expected ' + expectedVersion);
      }
    }

    await testAsync('asset-versioning: /version-check returns the running APP_VERSION', async () => {
      const r = await get(BASE + '/version-check');
      const v = JSON.parse(r.body).version;
      assert.ok(/^[a-f0-9]{10}$/.test(v), 'version should be 10 hex chars: ' + v);
    });

    await testAsync('asset-versioning: every /public/ <script>/<link> on / is versioned', async () => {
      const v = JSON.parse((await get(BASE + '/version-check')).body).version;
      await assertEveryAssetVersioned('/', v);
    });

    await testAsync('asset-versioning: /new is versioned', async () => {
      const v = JSON.parse((await get(BASE + '/version-check')).body).version;
      await assertEveryAssetVersioned('/new', v);
    });

    await testAsync('asset-versioning: /legal is versioned', async () => {
      const v = JSON.parse((await get(BASE + '/version-check')).body).version;
      await assertEveryAssetVersioned('/legal', v);
    });

    await testAsync('asset-versioning: /feedback is versioned', async () => {
      const v = JSON.parse((await get(BASE + '/version-check')).body).version;
      await assertEveryAssetVersioned('/feedback', v);
    });

    await testAsync('asset-versioning: /trust is versioned', async () => {
      const v = JSON.parse((await get(BASE + '/version-check')).body).version;
      await assertEveryAssetVersioned('/trust', v);
    });

    await testAsync('GET /library returns the library shell', async () => {
      const r = await get(BASE + '/library');
      assert.strictEqual(r.status, 200);
      assert.ok(/text\/html/.test(r.headers['content-type']));
      assert.ok(r.body.includes('SDocs - Library'),
                '/library should serve the library shell');
      assert.ok(/connect-src[^;]*localhost/.test(r.headers['content-security-policy'] || ''),
                'CSP must allow connect-src to localhost so the page can reach the local agent');
    });

    await testAsync('asset-versioning: /library is versioned', async () => {
      const v = JSON.parse((await get(BASE + '/version-check')).body).version;
      await assertEveryAssetVersioned('/library', v);
    });

    await testAsync('asset-versioning: /agent-changes is versioned', async () => {
      const v = JSON.parse((await get(BASE + '/version-check')).body).version;
      await assertEveryAssetVersioned('/agent-changes', v);
    });

    await testAsync('/agent-changes serves the index shell with the changelog md path', async () => {
      const r = await get(BASE + '/agent-changes');
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.includes('/public/agent-changes.md'),
                '/agent-changes should preload the agent-changes markdown');
    });

    await testAsync('asset-versioning: /analytics is versioned', async () => {
      const v = JSON.parse((await get(BASE + '/version-check')).body).version;
      await assertEveryAssetVersioned('/analytics', v);
    });

    await testAsync('asset-versioning: cross-origin scripts are not rewritten', async () => {
      const r = await get(BASE + '/');
      // Index loads no cross-origin scripts at top-level <script>; /trust does
      // not either. But Chart.js and similar are loaded dynamically via DOM
      // injection and never appear in static HTML, so this is a smoke check
      // that we don't accidentally append ?v= to a cross-origin URL that
      // does appear (e.g. font CDN <link>). No https:// URL in the body
      // should carry ?v=<our-hash>.
      const v = JSON.parse((await get(BASE + '/version-check')).body).version;
      const pat = new RegExp('https?://[^"\']+\\?v=' + v);
      assert.ok(!pat.test(r.body), 'cross-origin URL was rewritten with our APP_VERSION');
    });

    await testAsync('asset-versioning: rewriter is idempotent on already-versioned URLs', async () => {
      // Sanity: the rewriter runs once per request; fetching twice produces
      // identical bodies (same APP_VERSION in this process). The assert lives
      // here so a future change that double-stamps `?v=hash?v=hash` is caught.
      const a = (await get(BASE + '/')).body;
      const b = (await get(BASE + '/')).body;
      // /__CSP_NONCE__/ is randomized per request, so strip nonces before compare.
      const stripNonce = s => s.replace(/nonce="[^"]+"/g, 'nonce="X"');
      assert.strictEqual(stripNonce(a).length, stripNonce(b).length);
      // Detect actual double-stamping: ?v=<hash>?v=<hash> rather than the
      // string literal "?v=?v=" which would never appear even on a regression.
      assert.ok(!/\?v=[a-f0-9]+\?v=/.test(a), 'rewriter double-stamped a URL');
    });

    server.kill();
    try { fs.unlinkSync(testDbPath); } catch (_) {}
    try { fs.unlinkSync(testDbPath + '-wal'); } catch (_) {}
    try { fs.unlinkSync(testDbPath + '-shm'); } catch (_) {}
    try { fs.unlinkSync(testShortLinksDbPath); } catch (_) {}
    try { fs.unlinkSync(testShortLinksDbPath + '-wal'); } catch (_) {}
    try { fs.unlinkSync(testShortLinksDbPath + '-shm'); } catch (_) {}
  };
};
