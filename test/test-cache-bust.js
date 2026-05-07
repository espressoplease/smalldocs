/**
 * Two-server cache-bust test.
 *
 * Bug class: returning users get the new HTML but their browser HTTP cache
 * serves stale CSS/JS at unchanged URLs. The defence is that the server
 * rewrites every <link> / <script> URL under /public/ to carry
 * ?v=APP_VERSION, where APP_VERSION is a hash of the public/ tree computed
 * at startup.
 *
 * What this verifies end-to-end:
 *   1. Start a server with the current public/ tree, capture v1.
 *   2. Stop it, write a new file under public/ (simulating a deploy).
 *   3. Start a fresh server, capture v2.
 *   4. v2 != v1, the served HTML carries ?v=v2 throughout, and HTML produced
 *      by server B has no /public/ asset URLs still tagged with v1.
 *
 * Why a second server: APP_VERSION is computed once at startup. The bug is
 * the kind that only shows up across deploys, not within a single process.
 * Restarting against modified public/ contents is the smallest faithful
 * reproduction of "the next deploy."
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');

module.exports = function (harness) {
  const { assert, testAsync, get } = harness;

  return async function () {
    console.log('\n── Cache-bust tests (two-server) ────────────────\n');

    const PORT = 3097;
    const BASE = 'http://localhost:' + PORT;
    // Non-dotfile name: walkPublic() skips entries starting with `.`, so a
    // dotfile would not bump APP_VERSION and the test would silently pass
    // by missing v1 != v2. Removed in finally so a crashed run leaves at
    // most one stale file.
    const tmpFile = path.join(__dirname, '..', 'public', '_test-cache-bust-' + process.pid + '.tmp');

    // Use isolated DBs so we don't tread on real data even if the test
    // ran against the production sqlite paths.
    const isolatedEnv = {
      ...process.env,
      PORT: String(PORT),
      ANALYTICS_ENABLED: '0',
      ANALYTICS_DB: path.join(os.tmpdir(), 'sdocs-cb-an-' + process.pid + '.db'),
      SHORT_LINKS_DB: path.join(os.tmpdir(), 'sdocs-cb-sl-' + process.pid + '.db'),
    };

    function startServer() {
      return new Promise((resolve, reject) => {
        const s = spawn('node', [path.join(__dirname, '..', 'server.js')], {
          env: isolatedEnv,
          stdio: 'pipe',
        });
        let ready = false;
        let stderrBuf = '';
        s.stdout.on('data', d => {
          if (!ready && d.toString().includes('running at')) {
            ready = true;
            resolve(s);
          }
        });
        s.stderr.on('data', d => { stderrBuf += d.toString(); });
        const timeout = setTimeout(() => {
          if (!ready) reject(new Error('Server did not start. stderr:\n' + stderrBuf));
        }, 8000);
        s.on('exit', (code) => { if (!ready) { clearTimeout(timeout); reject(new Error('Server exited (' + code + ') before ready. stderr:\n' + stderrBuf)); } });
      });
    }

    function stopServer(s) {
      return new Promise(resolve => {
        if (!s) { resolve(); return; }
        s.once('exit', () => resolve());
        s.kill();
        setTimeout(() => { try { s.kill('SIGKILL'); } catch (_) {} resolve(); }, 1500).unref();
      });
    }

    let serverA = null, serverB = null;
    let v1 = null, v2 = null;
    let html1 = null, html2 = null;

    try {
      // ── Round 1: current public/ tree ──
      serverA = await startServer();
      v1 = JSON.parse((await get(BASE + '/version-check')).body).version;
      html1 = (await get(BASE + '/')).body;
      await stopServer(serverA);
      serverA = null;

      // ── Mutate public/ between deploys ──
      // Adding a new file is the most realistic simulation: it triggers the
      // walkPublic+hash chain the real deploy uses. Removing the file in
      // finally-cleanup means the test is idempotent across runs.
      fs.writeFileSync(tmpFile, 'cache-bust-test-' + Date.now());

      // ── Round 2: with the mutated tree ──
      serverB = await startServer();
      v2 = JSON.parse((await get(BASE + '/version-check')).body).version;
      html2 = (await get(BASE + '/')).body;

      await testAsync('APP_VERSION changes when public/ contents change', async () => {
        assert.ok(/^[a-f0-9]{10}$/.test(v1), 'v1 should be 10 hex: ' + v1);
        assert.ok(/^[a-f0-9]{10}$/.test(v2), 'v2 should be 10 hex: ' + v2);
        assert.notStrictEqual(v1, v2, 'expected v1 != v2 after public/ mutation');
      });

      await testAsync('asset URLs in / reflect the running APP_VERSION', async () => {
        // Round-1 HTML must reference v1, never v2.
        assert.ok(html1.indexOf('?v=' + v1) !== -1, 'html1 should contain ?v=' + v1);
        assert.ok(html1.indexOf('?v=' + v2) === -1, 'html1 should NOT contain ?v=' + v2);
        // Round-2 HTML must reference v2, never v1.
        assert.ok(html2.indexOf('?v=' + v2) !== -1, 'html2 should contain ?v=' + v2);
        assert.ok(html2.indexOf('?v=' + v1) === -1, 'html2 should NOT contain ?v=' + v1);
      });

      await testAsync('every /public/ asset URL on / carries the running version', async () => {
        // Walk every <script src="/public/..."> and <link rel="stylesheet"
        // href="/public/...">; each must end with ?v=v2 in html2.
        const scriptRe = /<script\b[^>]*?\s+src=["'](\/public\/[^"']+)["']/gi;
        const linkRe = /<link\b([^>]*)>/gi;
        let m;
        const refs = [];
        while ((m = scriptRe.exec(html2)) !== null) refs.push(m[1]);
        while ((m = linkRe.exec(html2)) !== null) {
          if (!/\srel=["']stylesheet["']/i.test(m[1])) continue;
          const hm = m[1].match(/\shref=["'](\/public\/[^"']+)["']/i);
          if (hm) refs.push(hm[1]);
        }
        assert.ok(refs.length > 0, 'expected /public/ assets in html2');
        for (const url of refs) {
          assert.ok(url.endsWith('?v=' + v2),
            'url should end with ?v=' + v2 + ', got: ' + url);
        }
      });

      await testAsync('non-index HTML (/feedback, /trust) also picks up v2', async () => {
        const fb = (await get(BASE + '/feedback')).body;
        const tr = (await get(BASE + '/trust')).body;
        // Both reference sdocs-trust-footer.js. Both must carry ?v=v2.
        assert.ok(fb.indexOf('/public/sdocs-trust-footer.js?v=' + v2) !== -1,
          '/feedback should reference sdocs-trust-footer.js?v=' + v2);
        assert.ok(tr.indexOf('/public/sdocs-trust-footer.js?v=' + v2) !== -1,
          '/trust should reference sdocs-trust-footer.js?v=' + v2);
        // And no straggler at v1.
        assert.ok(fb.indexOf('?v=' + v1) === -1, '/feedback should not still carry ?v=' + v1);
        assert.ok(tr.indexOf('?v=' + v1) === -1, '/trust should not still carry ?v=' + v1);
      });
    } finally {
      await stopServer(serverA);
      await stopServer(serverB);
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      try { fs.unlinkSync(isolatedEnv.ANALYTICS_DB); } catch (_) {}
      try { fs.unlinkSync(isolatedEnv.SHORT_LINKS_DB); } catch (_) {}
      try { fs.unlinkSync(isolatedEnv.SHORT_LINKS_DB + '-wal'); } catch (_) {}
      try { fs.unlinkSync(isolatedEnv.SHORT_LINKS_DB + '-shm'); } catch (_) {}
    }
  };
};
