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
    fs.writeFileSync(realFile, '# Real\n\nsome content with #demo');
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

    await testAsync('library-agent: CORS Allow-Origin is set on data response', async () => {
      const r = await req('GET', '/api/library/data');
      assert.strictEqual(r.headers['access-control-allow-origin'], '*');
    });

    await testAsync('library-agent: OPTIONS preflight returns 204 with CORS headers', async () => {
      const r = await req('OPTIONS', '/api/library/data');
      assert.strictEqual(r.status, 204);
      assert.ok(/POST/.test(r.headers['access-control-allow-methods'] || ''));
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

    await testAsync('library-agent: POST /api/library/star updates the entry', async () => {
      const r = await req('POST', '/api/library/star', { id: 'real', starred: true });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(store.getEntry('real').starred, true);
    });

    server.close();
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {}
  };
};
