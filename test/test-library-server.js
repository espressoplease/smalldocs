// Async test: spin up the library agent in a sandbox, hit its routes,
// assert the wire shape and the CORS headers the UI page depends on.

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const http = require('http');

module.exports = function (h) {
  const { testAsync, assert } = h;

  return async function runLibraryServer() {
    const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-lib-server-'));
    process.env.SDOCS_HOME = SANDBOX;

    for (const k of Object.keys(require.cache)) {
      if (k.includes('library-') || k.includes('sdocs-library-')) delete require.cache[k];
    }
    const store = require('../cli/lib/library-store');
    const libServer = require('../cli/lib/library-server');

    // Seed: one ordinary entry, one whose file actually exists on disk
    // so the open endpoint can produce a URL for it.
    const realFile = path.join(SANDBOX, 'real.md');
    fs.writeFileSync(realFile, '# Real\n\nsome ordinary body content.');
    store.upsertEntry({
      id: 'real', path: realFile, title: 'Real',
      tags: ['demo'], mtime: new Date().toISOString(),
    });
    store.upsertEntry({
      id: 'ghost', path: '/nope/missing.md', title: 'Ghost',
      tags: [], mtime: new Date().toISOString(),
    });

    // Use port 0 - the test will rarely run alongside `sdoc library`
    // but we still don't want a port clash.
    const { server, agentUrl, port } = await libServer.createServer({ port: 0 });

    function req(method, p, body) {
      return new Promise((resolve, reject) => {
        const u = new URL(agentUrl + p);
        const payload = body ? Buffer.from(JSON.stringify(body)) : null;
        const r = http.request({
          method, hostname: u.hostname, port: u.port, path: u.pathname + u.search,
          headers: Object.assign({},
            payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {},
            { 'Origin': 'https://sdocs.dev' }),
        }, res => {
          let raw = '';
          res.on('data', d => raw += d);
          res.on('end', () => {
            let parsed = null;
            try { parsed = JSON.parse(raw); } catch (_) {}
            resolve({ status: res.statusCode, body: parsed, raw, headers: res.headers });
          });
        });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
      });
    }

    await testAsync('library-agent: GET /api/library/data returns entries', async () => {
      const r = await req('GET', '/api/library/data');
      assert.strictEqual(r.status, 200);
      assert.ok(Array.isArray(r.body.entries));
      assert.strictEqual(r.body.entries.length, 2);
    });

    await testAsync('library-agent: data response includes autostart info', async () => {
      const r = await req('GET', '/api/library/data');
      assert.ok(r.body.autostart);
      assert.strictEqual(typeof r.body.autostart.supported, 'boolean');
      assert.strictEqual(typeof r.body.autostart.enabled, 'boolean');
    });

    await testAsync('library-agent: CORS Allow-Origin echoes the allowed origin', async () => {
      const r = await req('GET', '/api/library/data');
      // Request was made with Origin: https://sdocs.dev (allowed),
      // so the response should echo that exact origin (not `*`).
      assert.strictEqual(r.headers['access-control-allow-origin'], 'https://sdocs.dev');
    });

    await testAsync('library-agent: OPTIONS preflight returns 204 with CORS headers', async () => {
      const r = await req('OPTIONS', '/api/library/data');
      assert.strictEqual(r.status, 204);
      assert.ok(/POST/.test(r.headers['access-control-allow-methods'] || ''));
    });

    await testAsync('library-agent: rejects requests from disallowed Origin', async () => {
      const r = await new Promise((resolve, reject) => {
        const u = new URL(agentUrl + '/api/library/data');
        require('http').request({
          method: 'GET',
          hostname: u.hostname, port: u.port, path: u.pathname,
          headers: { 'Origin': 'https://evil.example.com' },
        }, res => {
          let raw = '';
          res.on('data', d => raw += d);
          res.on('end', () => resolve({ status: res.statusCode, body: raw, headers: res.headers }));
        }).on('error', reject).end();
      });
      assert.strictEqual(r.status, 403);
      // No CORS headers when refused, so the browser can't read the body either.
      assert.strictEqual(r.headers['access-control-allow-origin'], undefined);
    });

    await testAsync('library-agent: allows no-Origin (CLI / curl) requests', async () => {
      // Replicate a curl-style call: no Origin header.
      const r = await new Promise((resolve, reject) => {
        const u = new URL(agentUrl + '/api/library/data');
        require('http').get({
          hostname: u.hostname, port: u.port, path: u.pathname,
        }, res => {
          let raw = '';
          res.on('data', d => raw += d);
          res.on('end', () => resolve({ status: res.statusCode, body: raw }));
        }).on('error', reject);
      });
      assert.strictEqual(r.status, 200);
    });

    await testAsync('library-agent: rejects bad Host header (DNS rebinding guard)', async () => {
      const r = await new Promise((resolve, reject) => {
        const u = new URL(agentUrl + '/api/library/data');
        require('http').request({
          method: 'GET',
          hostname: u.hostname, port: u.port, path: u.pathname,
          headers: { 'Host': 'evil.example.com', 'Origin': 'https://sdocs.dev' },
        }, res => {
          let raw = '';
          res.on('data', d => raw += d);
          res.on('end', () => resolve({ status: res.statusCode, body: raw }));
        }).on('error', reject).end();
      });
      assert.strictEqual(r.status, 403);
    });

    await testAsync('library-agent: SDOCS_AGENT_ALLOWED_ORIGINS env var extends the allowlist', async () => {
      const libServer = require('../cli/lib/library-server');
      // Before: random origin not allowed.
      assert.strictEqual(libServer.originAllowed('https://my-staging.example.com'), false);
      process.env.SDOCS_AGENT_ALLOWED_ORIGINS = 'https://my-staging.example.com';
      try {
        assert.strictEqual(libServer.originAllowed('https://my-staging.example.com'), true);
      } finally {
        delete process.env.SDOCS_AGENT_ALLOWED_ORIGINS;
      }
    });

    await testAsync('library-agent: GET /api/library/open returns a sdocs URL', async () => {
      const r = await req('GET', '/api/library/open?id=real');
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.url, 'response must include a url');
      assert.ok(r.body.url.includes('#md='), 'URL must carry encoded markdown in hash');
      assert.strictEqual(r.body.path, realFile);
    });

    await testAsync('library-agent: open returns 410 when source file is gone', async () => {
      const r = await req('GET', '/api/library/open?id=ghost');
      assert.strictEqual(r.status, 410);
    });

    await testAsync('library-agent: open returns 404 for unknown id', async () => {
      const r = await req('GET', '/api/library/open?id=nosuch');
      assert.strictEqual(r.status, 404);
    });

    await testAsync('library-agent: GET /api/library/health is OK', async () => {
      const r = await req('GET', '/api/library/health');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.ok, true);
    });

    await testAsync('library-agent: health response carries the CLI version', async () => {
      const r = await req('GET', '/api/library/health');
      assert.strictEqual(typeof r.body.version, 'string', 'version should be a string');
      // Should look like a semver dotted version.
      assert.ok(/^\d+\.\d+\.\d+/.test(r.body.version), 'version should look like X.Y.Z, got: ' + r.body.version);
    });

    await testAsync('library-agent: data response carries the CLI version', async () => {
      const r = await req('GET', '/api/library/data');
      assert.strictEqual(typeof r.body.version, 'string');
      assert.ok(/^\d+\.\d+\.\d+/.test(r.body.version));
    });

    await testAsync('library-agent: open uses entry.path for rescued entries (snapshot, not original)', async () => {
      // Set up: a rescued entry whose rescuedFrom path does NOT exist on
      // disk, but whose entry.path (rescue copy) does. The open endpoint
      // should still produce a URL by reading the rescue copy.
      const rescueCopy = path.join(SANDBOX, 'rescued-snap.md');
      fs.writeFileSync(rescueCopy, '# Snapshot\n\nrescued body lives here.');
      store.upsertEntry({
        id: 'rescued-1',
        path: rescueCopy,
        rescued: true,
        rescuedFrom: '/totally/gone/original.md',
        title: 'Snapshot',
        tags: [],
        mtime: new Date().toISOString(),
      });
      const r = await req('GET', '/api/library/open?id=rescued-1');
      assert.strictEqual(r.status, 200, 'open should succeed even when rescuedFrom is gone');
      assert.ok(r.body.url && r.body.url.includes('#md='), 'should produce a hashed URL from the snapshot');
      assert.strictEqual(r.body.path, rescueCopy, 'reported path should be the rescue copy');
    });

    await testAsync('library-agent: POST /api/library/star updates the entry', async () => {
      const r = await req('POST', '/api/library/star', { id: 'real', starred: true });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(store.getEntry('real').starred, true);
    });

    await testAsync('library-agent: POST /api/library/reindex updates the index for one file', async () => {
      // Mutate the real file behind the agent's back, then ask for a
      // reindex. The library should pick up the new tags.
      fs.writeFileSync(realFile, '---\ntags:\n  - freshly-added\n---\n# Real\n');
      const r = await req('POST', '/api/library/reindex', { path: realFile });
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.tags.includes('freshly-added'),
                'reindex should reflect the new tag');
    });

    await testAsync('library-agent: POST /api/library/reindex requires a path', async () => {
      const r = await req('POST', '/api/library/reindex', {});
      assert.strictEqual(r.status, 400);
    });

    await testAsync('library-agent: POST /api/library/reindex 404s on missing file', async () => {
      const r = await req('POST', '/api/library/reindex', { path: '/nope/missing.md' });
      assert.strictEqual(r.status, 404);
    });

    await testAsync('library-agent: POST /api/library/bridge-for hands back port + token for a real file', async () => {
      const r = await req('POST', '/api/library/bridge-for', { path: realFile });
      assert.strictEqual(r.status, 200);
      assert.ok(typeof r.body.port === 'number');
      assert.ok(typeof r.body.token === 'string' && r.body.token.length > 0);
      assert.strictEqual(r.body.file, 'real.md');
      // Don't leave the bridge running - it'll idle-timeout on its own
      // but we can also close the port immediately by failing a
      // handshake. For the unit test, just trust the timeout.
    });

    await testAsync('library-agent: POST /api/library/bridge-for 404s on missing file', async () => {
      const r = await req('POST', '/api/library/bridge-for', { path: '/nope/missing.md' });
      assert.strictEqual(r.status, 404);
    });

    // Gate tests (Items B + C): the file-read and bridge-spawn endpoints
    // refuse paths that aren't in the library, paths on the deny list,
    // and symlinks whose realpath escapes the library.
    await testAsync('library-agent: /file refuses a real file that is NOT in the index', async () => {
      const outsider = path.join(SANDBOX, 'outsider.md');
      fs.writeFileSync(outsider, '# not indexed\n');
      // realFile was seeded into the index in setup; outsider was not.
      const r = await req('GET', '/api/library/file?path=' + encodeURIComponent(outsider));
      assert.strictEqual(r.status, 403);
      assert.ok(/index/i.test(r.body.error || ''));
    });

    await testAsync('library-agent: /file accepts a path that IS in the index', async () => {
      const r = await req('GET', '/api/library/file?path=' + encodeURIComponent(realFile));
      assert.strictEqual(r.status, 200);
      assert.ok(typeof r.body.content === 'string');
    });

    await testAsync('library-agent: /file refuses a deny-listed path even if it exists', async () => {
      const denied = path.join(SANDBOX, '.env');
      fs.writeFileSync(denied, 'SECRET=xxx\n');
      const r = await req('GET', '/api/library/file?path=' + encodeURIComponent(denied));
      assert.strictEqual(r.status, 403);
      assert.ok(/deny/i.test(r.body.error || ''));
    });

    await testAsync('library-agent: /file refuses a symlink whose target is not indexed', async () => {
      const secret = path.join(SANDBOX, 'pretend-secret.txt');
      fs.writeFileSync(secret, 'private');
      const link = path.join(SANDBOX, 'safe-looking-link.md');
      try { fs.unlinkSync(link); } catch (_) {}
      fs.symlinkSync(secret, link);
      // The symlink's source path isn't indexed; its realpath is the
      // un-indexed secret. Both refusals are acceptable - gatePath
      // checks the realpath against the index.
      const r = await req('GET', '/api/library/file?path=' + encodeURIComponent(link));
      assert.strictEqual(r.status, 403);
    });

    await testAsync('library-agent: /bridge-for refuses a real file that is NOT in the index', async () => {
      const outsider = path.join(SANDBOX, 'bridge-outsider.md');
      fs.writeFileSync(outsider, '# not indexed\n');
      const r = await req('POST', '/api/library/bridge-for', { path: outsider });
      assert.strictEqual(r.status, 403);
    });

    await testAsync('library-agent: GET /api/library/project-tags requires a path', async () => {
      const r = await req('GET', '/api/library/project-tags');
      assert.strictEqual(r.status, 400);
    });

    await testAsync('library-agent: GET /api/library/project-tags returns tags under the file\'s project', async () => {
      // Seed: two files under SANDBOX that share a fake git root.
      fs.mkdirSync(path.join(SANDBOX, '.git'), { recursive: true });
      const f1 = path.join(SANDBOX, 'one.md');
      const f2 = path.join(SANDBOX, 'two.md');
      fs.writeFileSync(f1, '---\ntags:\n  - shared\n  - one\n---\n# one');
      fs.writeFileSync(f2, '---\ntags:\n  - shared\n  - two\n---\n# two');
      const libIndex = require('../cli/lib/library-index');
      libIndex.indexFile(f1);
      libIndex.indexFile(f2);

      const r = await req('GET', '/api/library/project-tags?path=' + encodeURIComponent(f1));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.root, SANDBOX, 'should resolve project root via .git');
      const tags = (r.body.tags || []).map(t => t.tag);
      assert.ok(tags.includes('shared'));
      assert.ok(tags.includes('one'));
      assert.ok(tags.includes('two'));
    });

    server.close();
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {}
  };
};
