'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createCompiler, createCompilerClient, startCompilerWorker, assetAllowed } = require('../lib/publication-compiler');

module.exports = function (h) {
  const { assert, test, testAsync } = h;
  test('publication compiler permits renderer assets and fonts but no private APIs, loopback bridge or arbitrary publisher hosts', () => {
    const own = 'http://127.0.0.1:3131';
    assert(assetAllowed(own + '/public/sdocs-app.js?v=abc', own, 'script'));
    assert(assetAllowed('https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js', own, 'script'));
    assert(assetAllowed('https://fonts.googleapis.com/css2?family=Inter', own, 'stylesheet'));
    assert(assetAllowed('https://fonts.gstatic.com/s/inter/v1/a.woff2', own, 'font'));
    for (const value of [own + '/api/cloud/v1/me', own + '/public/../../api/cloud/v1/me',
      'http://localhost:47843/api/library', 'http://169.254.169.254/latest/meta-data',
      'https://publisher.example/image.png', 'https://cdn.jsdelivr.net/npm/arbitrary@latest/index.js',
      'https://user:secret@cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js']) assert(!assetAllowed(value, own, 'script'), value);
  });
  test('publication compiler transport cannot fall back to an unprotected TCP listener', () => {
    assert.throws(() => createCompilerClient({}), /Unix socket/);
    assert.throws(() => createCompilerClient({ socketPath: 'relative.sock' }), /Unix socket/);
  });
  test('publication compiler permits the reader Mermaid security patch and rejects older or unpinned builds', () => {
    const source = fs.readFileSync(path.join(__dirname, '../public/sdocs-mermaid.js'), 'utf8');
    const version = /MERMAID_VERSION\s*=\s*'([^']+)'/.exec(source)[1];
    const own = 'http://127.0.0.1:3131';
    assert.strictEqual(version, '10.9.8');
    assert(assetAllowed('https://cdn.jsdelivr.net/npm/mermaid@' + version + '/dist/mermaid.min.js', own, 'script'));
    for (const stale of ['10.9.1', '10.9.6', 'latest']) {
      assert(!assetAllowed('https://cdn.jsdelivr.net/npm/mermaid@' + stale + '/dist/mermaid.min.js', own, 'script'));
    }
  });
  return async function () {
    await assert.rejects(startCompilerWorker({}), /Unix socket/);
    await testAsync('publication compiler uses fresh contexts, serial jobs, sandboxing and a credential-free browser environment', async () => {
      let active = 0, maxActive = 0, contexts = 0, launches = 0, launchOptions;
      const browser = { isConnected: () => true, async close() {}, async newContext() {
        contexts++; active++; maxActive = Math.max(maxActive, active);
        return { async route() {}, async routeWebSocket() {}, async close() { active--; }, async newPage() {
          return { setDefaultTimeout() {}, async goto() {}, async waitForFunction() {}, async evaluate() {
            await new Promise(resolve => setTimeout(resolve, 5)); return '<div id="_sd_rendered"><p>Public text</p></div>';
          } };
        } };
      } };
      const compiler = createCompiler({ origin: 'http://127.0.0.1:3131', rendererVersion: 'release-test',
        shell: () => '<html></html>', browserType: { async launch(options) { launches++; launchOptions = options; return browser; } } });
      try {
        const results = await Promise.all([compiler.compile({ markdown: 'A' }), compiler.compile({ markdown: 'B' })]);
        assert.strictEqual(results[0].rendererVersion, 'release-test');
        assert.strictEqual(results[1].html, '<div id="_sd_rendered"><p>Public text</p></div>');
        assert.strictEqual(contexts, 2); assert.strictEqual(maxActive, 1); assert.strictEqual(active, 0); assert.strictEqual(launches, 1);
        assert.strictEqual(launchOptions.chromiumSandbox, true);
        assert.deepStrictEqual(Object.keys(launchOptions.env).sort(), ['HOME','LANG','PATH'].concat(process.env.TMPDIR ? ['TMPDIR'] : []).sort());
      } finally { await compiler.close(); }
      await assert.rejects(compiler.compile({}), error => error.code === 'publication_compile_failed');
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-compiler-test-'));
    const socketPath = path.join(dir, 'compiler.sock');
    let worker;
    try {
      await testAsync('publication compiler Unix transport returns root-only HTML and the worker renderer version', async () => {
        const received = [];
        worker = await startCompilerWorker({ socketPath, compiler: { async compile(snapshot) {
          received.push(snapshot); return { html: '<article id="_sd_rendered">Published content</article>', styles: {shape:'.sd-slide-wrap {position:relative}',math:true}, rendererVersion: 'worker-release' };
        }, async close() {} } });
        const client = createCompilerClient({ socketPath, shell: snapshot => '<html><body>' + snapshot.markdown + '</body></html>' });
        const result = await client.compile({ markdown: 'Public source', title: 'A title', url: 'https://example.test/p/title' });
        assert.strictEqual(result.rendererVersion, 'worker-release');
        assert.strictEqual(result.html, '<article id="_sd_rendered">Published content</article>');
        assert.deepStrictEqual(result.styles, {shape:'.sd-slide-wrap {position:relative}',math:true});
        assert.strictEqual(received[0].html, '<html><body>Public source</body></html>');
        assert.strictEqual(received[0].markdown, undefined, 'do not duplicate the public source in transport');
        assert.strictEqual(fs.statSync(socketPath).mode & 0o777, 0o660);
        await client.close();
      });
      await testAsync('publication compiler transport rejects malformed requests without returning source or stack traces', async () => {
        function send(body) { return new Promise((resolve, reject) => {
          const request = http.request({ socketPath, path: '/compile', method: 'POST' }, response => {
            let text = ''; response.on('data', data => { text += data; }); response.on('end', () => resolve({ status: response.statusCode, text }));
          }); request.on('error', reject); request.end(body);
        }); }
        const malformed = await send('private-input-that-is-not-json');
        assert.strictEqual(malformed.status, 400); assert(!malformed.text.includes('private-input'));
        assert.strictEqual((await send(JSON.stringify({ html: 123 }))).status, 400);
      });
      await worker.close(); worker = null;
      await testAsync('publication compiler failure and unavailable worker preserve a structured failure', async () => {
        worker = await startCompilerWorker({ socketPath, compiler: { async compile() { throw new Error('internal source detail'); }, async close() {} } });
        const client = createCompilerClient({ socketPath });
        await assert.rejects(client.compile({ html: '<html></html>' }), error => error.code === 'publication_compile_failed' && !error.message.includes('internal source detail'));
        await worker.close(); worker = null;
        await assert.rejects(client.compile({ html: '<html></html>' }), error => error.code === 'publication_compile_failed');
      });
    } finally { if (worker) await worker.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  };
};
