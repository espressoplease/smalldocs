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

    await testAsync('POST /api/short with valid ciphertext returns 201 + id', async () => {
      const r = await post(BASE + '/api/short', { ciphertext: sampleCipher });
      assert.strictEqual(r.status, 201);
      const data = JSON.parse(r.body);
      assert.ok(data.id, 'response should include id');
      assert.ok(/^[A-Za-z0-9_-]+$/.test(data.id), 'id should be base64url chars');
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

    server.kill();
    try { fs.unlinkSync(testDbPath); } catch (_) {}
    try { fs.unlinkSync(testDbPath + '-wal'); } catch (_) {}
    try { fs.unlinkSync(testDbPath + '-shm'); } catch (_) {}
    try { fs.unlinkSync(testShortLinksDbPath); } catch (_) {}
    try { fs.unlinkSync(testShortLinksDbPath + '-wal'); } catch (_) {}
    try { fs.unlinkSync(testShortLinksDbPath + '-shm'); } catch (_) {}
  };
};
