/**
 * HTTP server tests (async, starts server)
 */
const path = require('path');
const http = require('http');

module.exports = function(harness) {
  const { assert, testAsync, get, post } = harness;

  return async function() {
    console.log('\n── HTTP Tests (starting server) ─────────────────\n');

    const { spawn } = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const testDbPath = path.join(os.tmpdir(), 'sdocs-test-analytics-' + process.pid + '.db');
    const testShortLinksDbPath = path.join(os.tmpdir(), 'sdocs-test-short-links-' + process.pid + '.db');
    const testTeamsDbPath = path.join(os.tmpdir(), 'sdocs-test-teams-' + process.pid + '.db');
    const testCloudAuthDbPath = path.join(os.tmpdir(), 'sdocs-test-cloud-auth-' + process.pid + '.db');
    const testCloudDbPath = path.join(os.tmpdir(), 'sdocs-test-cloud-' + process.pid + '.db');
    try { fs.unlinkSync(testDbPath); } catch (_) {}
    try { fs.unlinkSync(testShortLinksDbPath); } catch (_) {}
    try { fs.unlinkSync(testTeamsDbPath); } catch (_) {}
    try { fs.unlinkSync(testCloudAuthDbPath); } catch (_) {}
    try { fs.unlinkSync(testCloudDbPath); } catch (_) {}
    let serverOutput = '';
    const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
      env: {
        ...process.env,
        PORT: '3099',
        ANALYTICS_ENABLED: '1',
        ANALYTICS_DB: testDbPath,
        ANALYTICS_FLUSH_IMMEDIATE: '1',
        SHORT_LINKS_DB: testShortLinksDbPath,
        TEAMS_DB: testTeamsDbPath,
        CLOUD_AUTH_DB: testCloudAuthDbPath,
        CLOUD_AUTH_PEPPER: 'http-test-cloud-auth-pepper-32-bytes',
        CLOUD_AUTH_PUBLIC_ORIGIN: 'http://localhost:3099',
        CLOUD_AUTH_DEV_LOG_CODES: '1',
        CLOUD_DB: testCloudDbPath,
        CLOUD_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
        CLOUD_ENVIRONMENT: 'test',
        CLOUD_IDEMPOTENCY_SECRET: 'http-test-idempotency-secret-32-bytes',
        NODE_ENV: 'test',
      },
      stdio: 'pipe',
    });

    await new Promise((resolve, reject) => {
      let ready = false;
      server.stdout.on('data', d => {
        serverOutput += d.toString();
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

    await testAsync('GET / serves the marketing landing page', async () => {
      const r = await get(BASE + '/');
      assert.ok(r.body.includes('id="install"'),
        'root should contain the landing install section');
      assert.ok(r.body.includes('curl -fsSL https://smalldocs.org/install | sh'),
        'root should show the canonical install command');
    });

    await testAsync('GET /docs serves the app shell rendering sdoc.md', async () => {
      const r = await get(BASE + '/docs');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('text/html'));
      assert.ok(r.body.includes('SDocs'));
      assert.ok(r.body.includes('/public/sdoc.md'),
        '/docs should default to sdoc.md');
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

    await testAsync('GET /install returns the CLI installer script', async () => {
      const r = await get(BASE + '/install');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('shellscript'),
        'expected a shell-script content-type, got ' + r.headers['content-type']);
      assert.ok(r.body.startsWith('#!/bin/sh'), 'installer should start with a sh shebang');
      assert.ok(r.body.includes('.sdocs'), 'installer should install under ~/.sdocs');
    });

    await testAsync('GET /install.sh is not exposed (the canonical URL is /install)', async () => {
      const r = await get(BASE + '/install.sh');
      assert.notStrictEqual(r.status, 200, '/install.sh should not be a live route');
    });

    await testAsync('GET /homepage redirects to the root landing page', async () => {
      const r = await get(BASE + '/homepage');
      assert.strictEqual(r.status, 301);
      assert.strictEqual(r.headers['location'], '/');
    });

    await testAsync('GET /public/homepage/demo-poster.jpg serves the hero poster', async () => {
      const r = await get(BASE + '/public/homepage/demo-poster.jpg');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('image/jpeg'),
        'expected image/jpeg, got ' + r.headers['content-type']);
    });

    // Range support: without this the homepage hero video falls back to
    // "buffer the whole 32MB before playing", which surfaces as a never-
    // ending tab spinner. The browser sends Range: bytes=0- on the first
    // probe and expects a 206 with Content-Range to know the server can seek.
    await testAsync('GET /public/* advertises Accept-Ranges and honours Range', async () => {
      const full = await get(BASE + '/public/homepage/demo-poster.jpg');
      assert.strictEqual(full.headers['accept-ranges'], 'bytes',
        'expected Accept-Ranges: bytes on a regular GET, got ' + full.headers['accept-ranges']);

      const rangeRes = await new Promise((resolve, reject) => {
        const req = http.request(BASE + '/public/homepage/demo-poster.jpg', {
          headers: { Range: 'bytes=0-99' },
        }, res => {
          let body = '';
          let bytes = 0;
          res.on('data', d => { bytes += d.length; body += d.toString('binary'); });
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes }));
        });
        req.on('error', reject);
        req.end();
      });
      assert.strictEqual(rangeRes.status, 206, 'Range request should return 206 Partial Content');
      assert.strictEqual(rangeRes.bytes, 100, 'Range should deliver exactly 100 bytes (0-99)');
      assert.ok(/^bytes 0-99\/\d+$/.test(rangeRes.headers['content-range']),
        'Content-Range should be "bytes 0-99/<total>", got ' + rangeRes.headers['content-range']);
    });

    await testAsync('GET /public/* returns 416 for an unsatisfiable Range', async () => {
      const r = await new Promise((resolve, reject) => {
        const req = http.request(BASE + '/public/homepage/demo-poster.jpg', {
          headers: { Range: 'bytes=999999999-' },
        }, res => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
        });
        req.on('error', reject);
        req.end();
      });
      assert.strictEqual(r.status, 416, 'unsatisfiable Range should return 416');
      assert.ok(/^bytes \*\/\d+$/.test(r.headers['content-range']),
        'Content-Range should be "bytes */<total>", got ' + r.headers['content-range']);
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

    await testAsync('GET /docs HTML references all CSS modules', async () => {
      const r = await get(BASE + '/docs');
      assert.ok(r.body.includes('css/tokens.css'), 'missing tokens.css link');
      assert.ok(r.body.includes('css/layout.css'), 'missing layout.css link');
      assert.ok(r.body.includes('css/rendered.css'), 'missing rendered.css link');
      assert.ok(r.body.includes('css/panel.css'), 'missing panel.css link');
      assert.ok(r.body.includes('css/mobile.css'), 'missing mobile.css link');
    });

    await testAsync('GET /docs HTML references all JS modules in order', async () => {
      const r = await get(BASE + '/docs');
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

    await testAsync('version-check with u=1 (reload re-check) does NOT write a visit row', async () => {
      // A deploy reloads every open tab; each reload re-fires version-check.
      // Those re-checks carry u=1 and must not be counted, or one release would
      // inflate analytics by one visit per open tab.
      const Database = require('better-sqlite3');
      const countRows = () => {
        const db = new Database(testDbPath, { readonly: true });
        try { return db.prepare("SELECT COUNT(*) AS c FROM visits WHERE cohort_week = '2026-W77'").get().c; }
        finally { db.close(); }
      };
      await get(BASE + '/version-check?cohort=2026-W77&u=1');
      assert.strictEqual(countRows(), 0, 'u=1 check must not insert a row');
      // A plain check for the same cohort still counts — proves we skipped only the reload re-check.
      await get(BASE + '/version-check?cohort=2026-W77');
      assert.strictEqual(countRows(), 1, 'a normal check for the same cohort is still counted');
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

    await testAsync('GET /cloud returns the Cloud product page', async () => {
      const r = await get(BASE + '/cloud');
      assert.strictEqual(r.status, 200);
      assert.ok(/text\/html/.test(r.headers['content-type']));
      assert.ok(r.body.includes('SmallDocs Cloud'));
      assert.ok(r.body.includes('£5'));
      assert.ok(r.body.includes('not end-to-end encrypted'));
      assert.ok(!r.body.toLowerCase().includes('trial'));
      assert.ok(r.body.includes('/cloud/checkout?plan=personal'));
      assert.ok(r.body.includes('/cloud/checkout?plan=team'));
      assert.ok(!r.body.includes('href="/docs"'));
    });

    await testAsync('asset-versioning: /cloud is versioned', async () => {
      const v = JSON.parse((await get(BASE + '/version-check')).body).version;
      await assertEveryAssetVersioned('/cloud', v);
    });

    await testAsync('GET /cloud/admin returns the workspace admin sketch', async () => {
      const r = await get(BASE + '/cloud/admin');
      assert.strictEqual(r.status, 200);
      assert.ok(/text\/html/.test(r.headers['content-type']));
      assert.ok(r.body.includes('Agent access'));
      assert.ok(r.body.includes('Invite member'));
    });

    await testAsync('asset-versioning: /cloud/admin is versioned', async () => {
      const v = JSON.parse((await get(BASE + '/version-check')).body).version;
      await assertEveryAssetVersioned('/cloud/admin', v);
    });

    await testAsync('GET /cloud/sign-in returns the Cloud authentication page', async () => {
      const r = await get(BASE + '/cloud/sign-in?return=%2Fcloud%2Faccount');
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.includes('<h1 id="auth-title">Sign in</h1>'));
      assert.ok(r.body.includes('Continue with Google'));
      assert.ok(r.body.includes('Continue with GitHub'));
      assert.ok(r.body.includes('class="provider-icon"'));
      assert.ok(r.body.includes('class="provider-icon provider-icon-github"'));
      assert.ok(r.body.includes('Email me a code'));
      assert.ok(!r.body.includes('Your local files stay on this device'));
      assert.strictEqual(r.headers['cache-control'], 'no-store');
      assert.strictEqual(r.headers['x-frame-options'], 'DENY');
      assert.ok(r.headers['content-security-policy'].includes("default-src 'none'"));
    });

    await testAsync('asset-versioning: /cloud/sign-in is versioned', async () => {
      const v = JSON.parse((await get(BASE + '/version-check')).body).version;
      await assertEveryAssetVersioned('/cloud/sign-in', v);
    });

    await testAsync('Cloud email code request rejects a missing Origin', async () => {
      const r = await post(BASE + '/api/cloud/auth/email/request', { email: 'person@example.com' });
      assert.strictEqual(r.status, 403);
      assert.strictEqual(JSON.parse(r.body).error, 'invalid_origin');
    });

    await testAsync('Cloud email code request and verification create a browser session', async () => {
      const requested = await post(BASE + '/api/cloud/auth/email/request', {
        email: 'person@example.com', return_to: '/cloud/account',
      }, { Origin: BASE });
      assert.strictEqual(requested.status, 202);
      const challenge = JSON.parse(requested.body).challenge_id;
      const codeMatch = new RegExp('\\[cloud-auth-code\\] ' + challenge + ' (\\d{6})').exec(serverOutput);
      assert.ok(codeMatch, 'development delivery should log the code for this challenge');

      const verified = await post(BASE + '/api/cloud/auth/email/verify', {
        challenge_id: challenge,
        code: codeMatch[1],
        return_to: '/cloud/account',
      }, { Origin: BASE });
      assert.strictEqual(verified.status, 200);
      assert.strictEqual(JSON.parse(verified.body).return_to, '/cloud/account');
      assert.ok(verified.headers['set-cookie'][0].startsWith('sdocs_cloud='));
      assert.ok(verified.headers['set-cookie'][0].includes('HttpOnly'));
      assert.ok(verified.headers['set-cookie'][0].includes('SameSite=Lax'));
      const account = await get(BASE + '/cloud/account', { Cookie: verified.headers['set-cookie'][0].split(';')[0] });
      assert.strictEqual(account.status, 200);
      assert.ok(account.body.includes('Your Cloud account'));
      assert.ok(account.body.includes('No Cloud documents yet'));

      const loggedOut = await post(BASE + '/api/cloud/auth/logout', '', {
        Origin: BASE,
        Cookie: verified.headers['set-cookie'][0].split(';')[0],
        'Content-Type': 'application/x-www-form-urlencoded',
      });
      assert.strictEqual(loggedOut.status, 303);
      assert.strictEqual(loggedOut.headers.location, '/cloud/sign-in');
      assert.ok(loggedOut.headers['set-cookie'][0].includes('Max-Age=0'));
      const afterLogout = await get(BASE + '/cloud/account', { Cookie: verified.headers['set-cookie'][0].split(';')[0] });
      assert.strictEqual(afterLogout.status, 303);
    });

    await testAsync('Cloud email verification rejects an external return URL', async () => {
      const requested = await post(BASE + '/api/cloud/auth/email/request', {
        email: 'return@example.com',
      }, { Origin: BASE });
      const challenge = JSON.parse(requested.body).challenge_id;
      const codeMatch = new RegExp('\\[cloud-auth-code\\] ' + challenge + ' (\\d{6})').exec(serverOutput);
      const verified = await post(BASE + '/api/cloud/auth/email/verify', {
        challenge_id: challenge,
        code: codeMatch[1],
        return_to: 'https://evil.example/steal',
      }, { Origin: BASE });
      assert.strictEqual(verified.status, 200);
      assert.strictEqual(JSON.parse(verified.body).return_to, '/cloud/account');
    });

    await testAsync('Cloud account redirects to sign-in without a session', async () => {
      const r = await get(BASE + '/cloud/account');
      assert.strictEqual(r.status, 303);
      assert.ok(r.headers.location.startsWith('/cloud/sign-in?return='));
    });

    let cloudCookie;
    let cloudWorkspace;
    let cloudProject;
    let cloudDocument;

    await testAsync('Cloud API requires an authenticated session', async () => {
      const r = await get(BASE + '/api/cloud/v1/workspaces');
      assert.strictEqual(r.status, 401);
      assert.strictEqual(JSON.parse(r.body).error, 'login_required');
    });

    await testAsync('email authentication activates a personal workspace', async () => {
      const requested = await post(BASE + '/api/cloud/auth/email/request', {
        email: 'cloud-api@example.com',
      }, { Origin: BASE });
      const challenge = JSON.parse(requested.body).challenge_id;
      const codeMatch = new RegExp('\\[cloud-auth-code\\] ' + challenge + ' (\\d{6})').exec(serverOutput);
      const verified = await post(BASE + '/api/cloud/auth/email/verify', {
        challenge_id: challenge, code: codeMatch[1], return_to: '/cloud/account',
      }, { Origin: BASE });
      cloudCookie = verified.headers['set-cookie'][0].split(';')[0];
      const response = await get(BASE + '/api/cloud/v1/workspaces', { Cookie: cloudCookie });
      assert.strictEqual(response.status, 200);
      const parsed = JSON.parse(response.body);
      assert.strictEqual(parsed.workspaces.length, 1);
      assert.strictEqual(parsed.workspaces[0].kind, 'personal');
      cloudWorkspace = parsed.workspaces[0];
    });

    await testAsync('Cloud API lists the activated default project', async () => {
      const response = await get(BASE + '/api/cloud/v1/projects?workspace_id=' + cloudWorkspace.id,
        { Cookie: cloudCookie });
      assert.strictEqual(response.status, 200);
      const parsed = JSON.parse(response.body);
      assert.strictEqual(parsed.projects.length, 1);
      assert.strictEqual(parsed.projects[0].name, 'Documents');
      cloudProject = parsed.projects[0];
    });

    await testAsync('Cloud API creates, reads, lists, tags, and searches an encrypted document', async () => {
      const created = await post(BASE + '/api/cloud/v1/documents', {
        project_id: cloudProject.id,
        filename: 'cluster-plan.md',
        markdown: '---\ntags:\n  - infrastructure\n---\n# Cluster plan\nMove workloads to Kubernetes.',
        idempotency_key: 'http-create-cluster-plan',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(created.status, 201);
      cloudDocument = JSON.parse(created.body).document;
      assert.strictEqual(cloudDocument.title, 'Cluster plan');

      const opened = await get(BASE + '/api/cloud/v1/documents/' + cloudDocument.id,
        { Cookie: cloudCookie });
      assert.ok(JSON.parse(opened.body).document.markdown.includes('Kubernetes'));

      const listed = await get(BASE + '/api/cloud/v1/documents', { Cookie: cloudCookie });
      assert.strictEqual(JSON.parse(listed.body).documents[0].id, cloudDocument.id);

      const tags = await get(BASE + '/api/cloud/v1/tags', { Cookie: cloudCookie });
      assert.deepStrictEqual(JSON.parse(tags.body).tags, [{ tag: 'infrastructure', count: 1 }]);

      const searched = await post(BASE + '/api/cloud/v1/search', { query: 'kubernetes' },
        { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(JSON.parse(searched.body).documents[0].id, cloudDocument.id);
    });

    await testAsync('Cloud API revision writes enforce expected-head conflicts', async () => {
      const saved = await post(BASE + '/api/cloud/v1/documents/' + cloudDocument.id + '/revisions', {
        expected_head_revision_id: cloudDocument.current_revision_id,
        filename: 'cluster-plan.md', markdown: '# Cluster plan\nMigration complete.',
        idempotency_key: 'http-save-cluster-plan-2',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(saved.status, 201);
      const next = JSON.parse(saved.body).document;
      assert.strictEqual(next.revision_number, 2);

      const conflict = await post(BASE + '/api/cloud/v1/documents/' + cloudDocument.id + '/revisions', {
        expected_head_revision_id: cloudDocument.current_revision_id,
        filename: 'cluster-plan.md', markdown: 'Stale overwrite',
        idempotency_key: 'http-stale-cluster-plan',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(conflict.status, 409);
      assert.strictEqual(JSON.parse(conflict.body).current_revision_id, next.current_revision_id);
      cloudDocument = next;
    });

    await testAsync('Cloud email verification is limited by source IP', async () => {
      let response;
      for (let i = 0; i < 25; i++) {
        response = await post(BASE + '/api/cloud/auth/email/verify', {
          challenge_id: 'missing-challenge', code: '000000',
        }, { Origin: BASE, 'X-Forwarded-For': '203.0.113.' + i });
        if (response.status === 429) break;
      }
      assert.strictEqual(response.status, 429);
      assert.strictEqual(JSON.parse(response.body).error, 'rate_limited');
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

    // ── Teams-interest endpoint ──
    // The spawned server writes to testTeamsDbPath; assertions read the same
    // file directly so "stored" / "not stored" is checked at the source of
    // truth, not inferred from status codes.
    const teamsRows = () => {
      const Database = require('better-sqlite3');
      const d = new Database(testTeamsDbPath, { readonly: true });
      const rows = d.prepare('SELECT email, company, message FROM teams_interest ORDER BY id').all();
      d.close();
      return rows;
    };

    await testAsync('POST /api/teams-interest stores a valid submission', async () => {
      const r = await post(BASE + '/api/teams-interest', {
        email: 'lead@example.com', company: 'Acme', message: 'We ship reports weekly.',
      });
      assert.strictEqual(r.status, 201);
      const rows = teamsRows();
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].email, 'lead@example.com');
      assert.strictEqual(rows[0].company, 'Acme');
    });

    await testAsync('POST /api/teams-interest rejects a missing/invalid email', async () => {
      const r1 = await post(BASE + '/api/teams-interest', { company: 'NoMail Ltd' });
      assert.strictEqual(r1.status, 400);
      const r2 = await post(BASE + '/api/teams-interest', { email: 'not-an-email' });
      assert.strictEqual(r2.status, 400);
      assert.strictEqual(teamsRows().length, 1);
    });

    await testAsync('POST /api/teams-interest honeypot gets 201 but stores nothing', async () => {
      const r = await post(BASE + '/api/teams-interest', {
        email: 'bot@example.com', website: 'http://spam.example',
      });
      assert.strictEqual(r.status, 201);
      assert.strictEqual(teamsRows().length, 1);
    });

    await testAsync('POST /api/teams-interest stores email-only submissions with null extras', async () => {
      const r = await post(BASE + '/api/teams-interest', { email: 'solo@example.com' });
      assert.strictEqual(r.status, 201);
      const rows = teamsRows();
      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[1].email, 'solo@example.com');
      assert.strictEqual(rows[1].company, null);
      assert.strictEqual(rows[1].message, null);
    });

    server.kill();
    try { fs.unlinkSync(testDbPath); } catch (_) {}
    try { fs.unlinkSync(testDbPath + '-wal'); } catch (_) {}
    try { fs.unlinkSync(testDbPath + '-shm'); } catch (_) {}
    try { fs.unlinkSync(testShortLinksDbPath); } catch (_) {}
    try { fs.unlinkSync(testShortLinksDbPath + '-wal'); } catch (_) {}
    try { fs.unlinkSync(testShortLinksDbPath + '-shm'); } catch (_) {}
    try { fs.unlinkSync(testTeamsDbPath); } catch (_) {}
    try { fs.unlinkSync(testTeamsDbPath + '-wal'); } catch (_) {}
    try { fs.unlinkSync(testTeamsDbPath + '-shm'); } catch (_) {}
    try { fs.unlinkSync(testCloudAuthDbPath); } catch (_) {}
    try { fs.unlinkSync(testCloudAuthDbPath + '-wal'); } catch (_) {}
    try { fs.unlinkSync(testCloudAuthDbPath + '-shm'); } catch (_) {}
    try { fs.unlinkSync(testCloudDbPath); } catch (_) {}
    try { fs.unlinkSync(testCloudDbPath + '-wal'); } catch (_) {}
    try { fs.unlinkSync(testCloudDbPath + '-shm'); } catch (_) {}
  };
};
