/**
 * HTTP server tests (async, starts server)
 */
const path = require('path');
const http = require('http');

function availableLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

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
    const testCloudBillingDbPath = path.join(os.tmpdir(), 'sdocs-test-cloud-billing-' + process.pid + '.db');
    const testCloudJobsDbPath = path.join(os.tmpdir(), 'sdocs-test-cloud-jobs-' + process.pid + '.db');
    try { fs.unlinkSync(testDbPath); } catch (_) {}
    try { fs.unlinkSync(testShortLinksDbPath); } catch (_) {}
    try { fs.unlinkSync(testTeamsDbPath); } catch (_) {}
    try { fs.unlinkSync(testCloudAuthDbPath); } catch (_) {}
    try { fs.unlinkSync(testCloudDbPath); } catch (_) {}
    try { fs.unlinkSync(testCloudBillingDbPath); } catch (_) {}
    try { fs.unlinkSync(testCloudJobsDbPath); } catch (_) {}
    let serverOutput = '';
    const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '3099',
        ANALYTICS_ENABLED: '1',
        ANALYTICS_DB: testDbPath,
        ANALYTICS_FLUSH_IMMEDIATE: '1',
        SHORT_LINKS_DB: testShortLinksDbPath,
        TEAMS_DB: testTeamsDbPath,
        CLOUD_AUTH_DB: testCloudAuthDbPath,
        CLOUD_PUBLIC_MODE: 'enabled',
        CLOUD_AUTH_PEPPER: 'http-test-cloud-auth-pepper-32-bytes',
        CLOUD_AUTH_PUBLIC_ORIGIN: 'http://localhost:3099',
        CLOUD_AUTH_DEV_LOG_CODES: '1',
        CLOUD_DB: testCloudDbPath,
        CLOUD_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
        CLOUD_ENVIRONMENT: 'test',
        CLOUD_IDEMPOTENCY_SECRET: 'http-test-idempotency-secret-32-bytes',
        CLOUD_BILLING_DB: testCloudBillingDbPath,
        CLOUD_JOBS_DB: testCloudJobsDbPath,
        CLOUD_JOB_POLL_MS: '60000',
        CLOUD_PLAN_LIMITS_JSON: JSON.stringify({
          personal: { maxFileBytes: 10 * 1024 * 1024, revisionRetentionDays: 90,
            search: { maxRequests: 2, windowMs: 60000 } },
          team: { maxFileBytes: 10 * 1024 * 1024, revisionRetentionDays: 90 },
        }),
        CLOUD_WORKSPACE_RESTORE_WINDOW_MS: '60000',
        CLOUD_DOCUMENT_RESTORE_WINDOW_MS: '60000',
        STRIPE_SECRET_KEY: 'sk_test_http',
        STRIPE_WEBHOOK_SECRET: 'whsec_http_test',
        GOOGLE_OAUTH_CLIENT_ID: 'http-test-google-client',
        GOOGLE_OAUTH_CLIENT_SECRET: 'http-test-google-secret',
        GITHUB_OAUTH_CLIENT_ID: '',
        GITHUB_OAUTH_CLIENT_SECRET: '',
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
    const { CURRENT_TERMS_VERSION } = require('../lib/cloud-terms');
    const cloudBilling = require('../lib/cloud-billing').createBillingStore({
      dbPath: testCloudBillingDbPath, planLimits: {},
    });
    function del(url, body, headers) {
      return new Promise((resolve, reject) => {
        const target = new URL(url);
        const payload = Buffer.from(JSON.stringify(body || {}));
        const request = http.request({ method: 'DELETE', hostname: target.hostname,
          port: target.port, path: target.pathname + target.search, agent: false,
          headers: Object.assign({ 'Content-Type': 'application/json',
            'Content-Length': payload.length }, headers || {}) }, response => {
          let responseBody = '';
          response.on('data', chunk => responseBody += chunk);
          response.on('end', () => resolve({ status: response.statusCode,
            body: responseBody, headers: response.headers }));
        });
        request.on('error', reject);
        request.end(payload);
      });
    }
    function patch(url, body, headers) {
      return new Promise((resolve, reject) => {
        const target = new URL(url);
        const payload = Buffer.from(JSON.stringify(body || {}));
        const request = http.request({ method: 'PATCH', hostname: target.hostname,
          port: target.port, path: target.pathname + target.search, agent: false,
          headers: Object.assign({ 'Content-Type': 'application/json',
            'Content-Length': payload.length }, headers || {}) }, response => {
          let responseBody = '';
          response.on('data', chunk => responseBody += chunk);
          response.on('end', () => resolve({ status: response.statusCode,
            body: responseBody, headers: response.headers }));
        });
        request.on('error', reject);
        request.end(payload);
      });
    }
    function postStripeEvent(event) {
      const crypto = require('crypto');
      const raw = Buffer.from(JSON.stringify(event));
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = crypto.createHmac('sha256', 'whsec_http_test')
        .update(Buffer.concat([Buffer.from(timestamp + '.'), raw])).digest('hex');
      return new Promise((resolve, reject) => {
        const request = http.request({ method: 'POST', hostname: 'localhost', port: 3099,
          path: '/api/cloud/billing/stripe/webhook', agent: false,
          headers: { 'Content-Type': 'application/json', 'Content-Length': raw.length,
            'Stripe-Signature': 't=' + timestamp + ',v1=' + signature } }, response => {
          let body = '';
          response.on('data', chunk => body += chunk);
          response.on('end', () => resolve({ status: response.statusCode, body,
            headers: response.headers }));
        });
        request.on('error', reject);
        request.end(raw);
      });
    }
    function acceptCloudTerms(cookie, returnTo) {
      return post(BASE + '/api/cloud/auth/terms/accept', {
        accepted: true,
        terms_version: CURRENT_TERMS_VERSION,
        return_to: returnTo || '/cloud/admin',
      }, { Origin: BASE, Cookie: cookie });
    }

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
      assert.ok(r.body.includes('var cloudAuthenticated = \'false\''),
        'signed-out root should leave Cloud library routing disabled');
      assert.ok(r.body.includes('curl -fsSL https://smalldocs.org/install | sh'),
        'root should show the canonical install command');
      assert.ok(r.body.includes('href="/cloud/sign-in?return=%2Flibrary%3Fscope%3Dcloud"'),
        'Cloud-enabled root should expose the sign-in journey');
      assert.ok(r.body.includes('class="btn-gh nav-cloud" href="/cloud"'),
        'Cloud-enabled root should expose the Cloud product page beside sign-in');
      assert.ok(r.body.includes('class="btn-gh nav-library-wide" href="/library"'),
        'signed-out root should expose the local library on wide screens');
      assert.ok(!r.body.includes('href="/cloud/account" role="menuitem"'),
        'signed-out root should not expose account controls');
      assert.ok(!r.body.includes('action="/api/cloud/auth/logout"'),
        'signed-out root should not expose sign-out');
      assert.ok(!r.body.includes('discord.gg'),
        'root navigation should not expose Discord');
    });

    await testAsync('GET /docs serves the app shell rendering sdoc.md', async () => {
      const r = await get(BASE + '/docs');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('text/html'));
      assert.ok(r.body.includes('SDocs'));
      assert.ok(r.body.includes('/public/sdoc.md'),
        '/docs should default to sdoc.md');
      assert.ok(r.body.includes('<span class="library-btn-label">Local library</span>'));
      assert.ok(r.body.includes('data-cloud-authenticated="false"'));
      assert.ok(r.body.includes('data-cloud-terms-accepted="false"'));
      assert.ok(!r.body.includes('Markdown Library'));
      assert.ok(!r.body.includes('data-sdocs-sign-in-return'));
      assert.ok(!r.body.includes('id="doc-site-menu"'));
      assert.ok(!r.body.includes('__DOCUMENT_NAV_'));
      assert.strictEqual(r.headers.vary, 'Cookie');
    });

    await testAsync('versioned native SDK modules are cross-origin cacheable JavaScript', async () => {
      const r = await get(BASE + '/sdk/0.2.0/smalldocs.js');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('application/javascript'));
      assert.strictEqual(r.headers['access-control-allow-origin'], '*');
      assert.strictEqual(r.headers['cross-origin-resource-policy'], 'cross-origin');
      assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
      assert.ok(r.headers['cache-control'].includes('max-age=31536000'));
      assert.ok(r.headers['cache-control'].includes('immutable'));
      assert.ok(r.body.includes('export async function render'));
      assert.ok(r.body.includes("from './core.js'"));
      const core = await get(BASE + '/sdk/0.2.0/core.js');
      assert.strictEqual(core.status, 200);
      assert.ok(core.body.includes('smalldocs-document'));
      assert.ok(core.body.includes("import('./features/"));
      const runtime = await get(BASE + '/sdk/0.2.0/runtime.js');
      assert.strictEqual(runtime.status, 200);
      assert.ok(runtime.body.includes("POLICY_NAME = 'smalldocs-sdk-0.2.0'"));
      const sanitizer = await get(BASE + '/sdk/0.2.0/vendor/purify.es.mjs');
      assert.strictEqual(sanitizer.status, 200);
      assert.ok(sanitizer.headers['content-type'].includes('application/javascript'));
      assert.ok(sanitizer.headers['cache-control'].includes('immutable'));
      assert.strictEqual(sanitizer.headers['access-control-allow-origin'], '*');
      const css = await get(BASE + '/sdk/0.2.0/smalldocs.css');
      assert.strictEqual(css.status, 200);
      assert.ok(css.headers['content-type'].includes('text/css'));
      assert.ok(css.body.includes('@layer smalldocs'));
      const codeFeature = await get(BASE + '/sdk/0.2.0/features/code.js');
      assert.strictEqual(codeFeature.status, 200);
      assert.ok(codeFeature.body.includes("vendorAsset('sdocs-code-reader.js')"));
      const appsFeature = await get(BASE + '/sdk/0.2.0/features/apps.js');
      assert.strictEqual(appsFeature.status, 200);
      assert.ok(appsFeature.body.includes("vendorAsset('sdocs-html-components.js')"));
      assert.ok(appsFeature.body.includes("vendorAsset('sdocs-app-runner.html')"));
      const appsReader = await get(BASE + '/sdk/0.2.0/vendor/sdocs-html-components.js');
      assert.strictEqual(appsReader.status, 200);
      assert.ok(appsReader.body.includes('window.SDocHtmlComponents'));
      assert.ok(appsReader.headers['cache-control'].includes('immutable'));
      const appsCss = await get(BASE + '/sdk/0.2.0/vendor/sdocs-html-component-reader.css');
      assert.strictEqual(appsCss.status, 200);
      assert.ok(appsCss.body.includes('@layer smalldocs'));
      const appsFrame = await get(BASE + '/sdk/0.2.0/vendor/sdocs-app-runner.html');
      assert.strictEqual(appsFrame.status, 200);
      assert.ok(appsFrame.headers['content-type'].includes('text/html'));
      assert.strictEqual(appsFrame.headers['x-frame-options'], undefined);
      assert.strictEqual(appsFrame.headers['cross-origin-resource-policy'], 'cross-origin');
      assert.ok(appsFrame.body.includes('./sdocs-app-runner.js'));
      const appsRunner = await get(BASE + '/sdk/0.2.0/vendor/sdocs-app-runner.js');
      assert.strictEqual(appsRunner.status, 200);
      assert.ok(appsRunner.body.includes("message.type !== 'sdocs-app-load'"));
      const codeReader = await get(BASE + '/sdk/0.2.0/vendor/sdocs-code-reader.js');
      assert.strictEqual(codeReader.status, 200);
      assert.ok(codeReader.body.includes('window.SDocCodeReader'));
      assert.ok(codeReader.headers['cache-control'].includes('immutable'));
      const slideReader = await get(BASE + '/sdk/0.2.0/vendor/sdocs-slide-reader.js');
      assert.strictEqual(slideReader.status, 200);
      assert.ok(slideReader.body.includes('window.SDocSlideReader'));
      assert.ok(slideReader.headers['cache-control'].includes('immutable'));
      const slideCss = await get(BASE + '/sdk/0.2.0/slide-reader.css');
      assert.strictEqual(slideCss.status, 200);
      assert.ok(slideCss.body.includes("layer(smalldocs)"));
      const codeFocus = await get(BASE + '/sdk/0.2.0/vendor/sdocs-code-focus.js');
      assert.strictEqual(codeFocus.status, 200);
      assert.ok(codeFocus.body.includes('createCodeFocus'));
      const cellsEdit = await get(BASE + '/sdk/0.2.0/vendor/sdocs-cells-edit.js');
      assert.strictEqual(cellsEdit.status, 200);
      assert.ok(cellsEdit.body.includes('SDocCellsEdit'));
      const cellsFocus = await get(BASE + '/sdk/0.2.0/vendor/sdocs-cells-focus.js');
      assert.strictEqual(cellsFocus.status, 200);
      assert.ok(cellsFocus.body.includes('SDocCellsFocus'));
      const codeCss = await get(BASE + '/sdk/0.2.0/code-reader.css');
      assert.strictEqual(codeCss.status, 200);
      assert.ok(codeCss.body.includes("layer(smalldocs)"));
      const mermaidFrame = await get(BASE + '/sdk/0.2.0/mermaid-renderer.html');
      assert.strictEqual(mermaidFrame.status, 200);
      assert.ok(mermaidFrame.headers['content-type'].includes('text/html'));
      assert.ok(mermaidFrame.headers['content-security-policy'].includes('frame-ancestors *'));
      assert.ok(mermaidFrame.body.includes('mermaid@10.9.1'));
      assert.ok(mermaidFrame.body.includes('./vendor/sdocs-mermaid-worker.css'));
      assert.ok(mermaidFrame.body.includes('./mermaid-renderer.js'));
      const mermaidWorker = await get(BASE + '/sdk/0.2.0/mermaid-renderer.js');
      assert.strictEqual(mermaidWorker.status, 200);
      assert.ok(mermaidWorker.body.includes("request.type !== 'render'"));
      const mermaidWorkerCss = await get(BASE + '/sdk/0.2.0/vendor/sdocs-mermaid-worker.css');
      assert.strictEqual(mermaidWorkerCss.status, 200);
      assert.ok(mermaidWorkerCss.body.includes('.edgeLabel foreignObject > div'));
      const previous = await get(BASE + '/sdk/0.1.0/smalldocs.js');
      assert.strictEqual(previous.status, 200);
      const frozen = await get(BASE + '/sdk/0.1.1/smalldocs.js');
      assert.strictEqual(frozen.status, 200);
      assert.ok(!frozen.body.includes("message.type === 'sdocs:focus'"));
      const previousContract = await get(BASE + '/sdk/0.1.2/smalldocs.js');
      assert.strictEqual(previousContract.status, 200);
      assert.ok(previousContract.body.includes("message.type === 'sdocs:focus'"));
      assert.ok(!previousContract.body.includes("message.type === 'sdocs:navigate'"));
    });

    await testAsync('runnable HTML frame assets are isolated and cacheable', async () => {
      const document = await get(BASE + '/new');
      assert.strictEqual(document.status, 200);
      assert.ok(document.headers['content-security-policy'].includes(
        "frame-src 'self' https://www.youtube-nocookie.com"));

      const frame = await get(BASE + '/sdoc-app-runner/runner.html');
      assert.strictEqual(frame.status, 200);
      assert.ok(frame.headers['content-type'].includes('text/html'));
      assert.strictEqual(frame.headers['x-frame-options'], undefined);
      assert.strictEqual(frame.headers['cross-origin-resource-policy'], 'cross-origin');
      assert.ok(frame.body.includes('./sdocs-app-runner.js'));

      const runner = await get(BASE + '/sdoc-app-runner/sdocs-app-runner.js');
      assert.strictEqual(runner.status, 200);
      assert.ok(runner.headers['content-type'].includes('application/javascript'));
      assert.ok(runner.body.includes("parent.postMessage({ type: 'sdocs-app-ready'"));

      const font = await get(BASE + '/sdoc-app-runner/fonts/inter-400.woff2');
      assert.strictEqual(font.status, 200);
      assert.ok(font.headers['content-type'].includes('font/woff2'));
      assert.strictEqual(font.headers['access-control-allow-origin'], '*');
      assert.strictEqual(font.headers['cross-origin-resource-policy'], 'cross-origin');
    });

    await testAsync('GET /developers serves the Markdown-driven SDK documentation shell', async () => {
      const r = await get(BASE + '/developers');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('text/html'));
      assert.ok(r.body.includes('id="developer-document"'));
      assert.ok(r.body.includes('/developers/authoring/slides'));
      assert.ok(r.body.includes('/developers/authoring/slide-shapes'));
      assert.ok(r.body.includes('id="agent-references"'));
      assert.ok(r.body.includes('href="/developers/examples"'));
      assert.ok(r.body.includes('class="topbar-brand">SmallDocs</a>'));
      assert.ok(!r.body.includes('class="topbar-actions"'));
      assert.ok(!r.body.includes('Developer documentation</div>'));
      assert.ok(r.body.includes('rel="alternate" type="text/plain" href="/developers/llms.txt"'));
      assert.ok(r.body.includes('/public/css/tokens.css?v='));
      assert.ok(r.body.includes('/public/css/developers.css?v='));
      assert.ok(r.body.includes('/public/developers.js?v='));
      assert.ok(!r.body.includes('__SDOCS_'));
      assert.strictEqual(r.headers['x-frame-options'], 'DENY');
    });

    await testAsync('GET /developers/example serves the customer SDK example', async () => {
      const r = await get(BASE + '/developers/example');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('text/html'));
      assert.ok(r.body.includes('Meridian Research'));
      assert.ok(r.body.includes('id="analysis-document"'));
      assert.ok(r.body.includes('/public/css/developers-example.css?v='));
      assert.ok(r.body.includes('/public/developers-example.js?v='));
      assert.strictEqual(r.headers['x-frame-options'], 'DENY');

      for (const slug of ['executive-summary', 'briefing', 'charts', 'model']) {
        const markdown = await get(BASE + '/public/developers/example/' + slug + '.md');
        assert.strictEqual(markdown.status, 200, 'example document: ' + slug);
        assert.ok(markdown.body.includes('# Project Meridian'));
      }
    });

    await testAsync('GET /developers/examples serves the SDK configuration gallery', async () => {
      const r = await get(BASE + '/developers/examples');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('text/html'));
      assert.ok(r.body.includes('Northline Intelligence'));
      assert.ok(r.body.includes('id="showcase-document"'));
      assert.ok(r.body.includes('/public/css/developers-example.css?v='));
      assert.ok(r.body.includes('/public/css/developers-showcase.css?v='));
      assert.ok(r.body.includes('/public/developers-showcase.js?v='));
      assert.strictEqual(r.headers['x-frame-options'], 'DENY');

      for (const slug of ['complete-analysis', 'compact-answer', 'long-reference']) {
        const markdown = await get(BASE + '/public/developers/showcase/' + slug + '.md');
        assert.strictEqual(markdown.status, 200, 'showcase document: ' + slug);
        assert.ok(/^# /m.test(markdown.body));
      }
    });

    await testAsync('GET /developers/example/non-collapsible serves the styled SDK example', async () => {
      const r = await get(BASE + '/developers/example/non-collapsible');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('text/html'));
      assert.ok(r.body.includes('Fieldwork'));
      assert.ok(r.body.includes('id="field-report"'));
      assert.ok(r.body.includes('/public/css/developers-style-demo.css?v='));
      assert.ok(r.body.includes('/public/developers-style-demo.js?v='));
      assert.strictEqual(r.headers['x-frame-options'], 'DENY');

      const markdown = await get(BASE + '/public/developers/example/field-report.md');
      assert.strictEqual(markdown.status, 200);
      assert.ok(markdown.body.includes('# Streets that stay useful in the heat'));
      assert.ok(markdown.body.includes('~~~mermaid'));
      assert.ok(markdown.body.includes('~~~javascript'));
    });

    await testAsync('developer Markdown resources expose integration and authoring references', async () => {
      const index = await get(BASE + '/developers/llms.txt');
      assert.strictEqual(index.status, 200);
      assert.ok(index.headers['content-type'].includes('text/plain'));
      assert.ok(index.body.includes('/developers/integration.md'));
      assert.ok(index.body.includes('/developers/authoring/slides.md'));
      assert.ok(index.body.includes('/developers/authoring/slide-shapes.md'));
      assert.ok(index.body.includes('/developers/authoring/apps.md'));

      const guide = await get(BASE + '/developers/integration.md');
      assert.strictEqual(guide.status, 200);
      assert.ok(guide.headers['content-type'].includes('text/plain'));
      assert.ok(guide.body.includes("import { render } from 'https://smalldocs.org/sdk/0.2.0/smalldocs.js'"));
      assert.ok(guide.body.includes('The host does not parse fences'));
      assert.ok(guide.body.includes('smalldocs-renderer'));
      assert.ok(guide.body.includes('/developers/example'));

      const full = await get(BASE + '/developers/llms-full.txt');
      assert.strictEqual(full.status, 200);
      assert.ok(full.body.includes(guide.body.trim()));
      assert.ok(full.body.includes('# Custom slide shapes'));
      assert.ok(full.body.includes('# Computed cells'));

      const authoringSlugs = [
        'markdown', 'code', 'math', 'diagrams', 'charts', 'cells',
        'slides', 'slide-shapes', 'apps', 'video', 'styles',
      ];
      for (const slug of authoringSlugs) {
        const page = await get(BASE + '/developers/authoring/' + slug);
        assert.strictEqual(page.status, 200, 'human authoring route: ' + slug);
        assert.ok(page.body.includes('id="developer-document"'));
        const markdown = await get(BASE + '/developers/authoring/' + slug + '.md');
        assert.strictEqual(markdown.status, 200, 'raw authoring route: ' + slug);
        assert.ok(markdown.headers['content-type'].includes('text/plain'));
        assert.strictEqual(markdown.headers['access-control-allow-origin'], '*');
      }
    });

    await testAsync('well-known catalog publishes renderer and authoring skills', async () => {
      const catalog = await get(BASE + '/.well-known/agent-skills/index.json');
      assert.strictEqual(catalog.status, 200);
      assert.ok(catalog.headers['content-type'].includes('application/json'));
      assert.strictEqual(catalog.headers['access-control-allow-origin'], '*');
      const parsed = JSON.parse(catalog.body);
      assert.strictEqual(parsed.skills.length, 2);
      assert.strictEqual(parsed.skills[0].name, 'smalldocs-renderer');
      assert.deepStrictEqual(parsed.skills[0].files, ['SKILL.md', 'references/api.md']);
      assert.strictEqual(parsed.skills[1].name, 'smalldocs-author');
      assert.ok(parsed.skills[1].files.includes('references/slides.md'));
      assert.ok(parsed.skills[1].files.includes('references/slide-shapes.md'));
      assert.ok(parsed.skills[1].files.includes('references/apps.md'));

      const legacy = await get(BASE + '/.well-known/skills/index.json');
      assert.strictEqual(legacy.status, 200);
      assert.deepStrictEqual(JSON.parse(legacy.body), parsed);

      const skill = await get(BASE + '/.well-known/agent-skills/smalldocs-renderer/SKILL.md');
      assert.strictEqual(skill.status, 200);
      assert.strictEqual(skill.body, fs.readFileSync(path.join(__dirname, '..', '.agents', 'skills',
        'smalldocs-renderer', 'SKILL.md'), 'utf8'));
      assert.ok(skill.body.includes('description: ' + parsed.skills[0].description),
        'catalog description should match the canonical skill front matter');

      const reference = await get(BASE + '/.well-known/agent-skills/smalldocs-renderer/references/api.md');
      assert.strictEqual(reference.status, 200);
      assert.ok(reference.body.includes('## Security'));
      assert.ok(reference.body.includes('direct-DOM SmallDocs reading surface'));

      const authorSkill = await get(BASE + '/.well-known/agent-skills/smalldocs-author/SKILL.md');
      assert.strictEqual(authorSkill.status, 200);
      assert.ok(authorSkill.body.includes('internal status is not a reason'));
      assert.ok(authorSkill.body.includes('references/slide-shapes.md'));
      assert.ok(authorSkill.body.includes('references/apps.md'));

      const slideReference = await get(
        BASE + '/.well-known/agent-skills/smalldocs-author/references/slides.md'
      );
      assert.strictEqual(slideReference.status, 200);
      assert.ok(slideReference.body.includes('Visual explanation is part of normal slide authoring'));

      const standardCatalog = await get(
        BASE + '/agent-skills/standard/.well-known/agent-skills/index.json');
      assert.strictEqual(standardCatalog.status, 200);
      assert.strictEqual(JSON.parse(standardCatalog.body).skills[0].name, 'smalldocs');
      const standardGlobal = await get(
        BASE + '/agent-skills/standard/.well-known/agent-skills/smalldocs/SKILL.md');
      assert.strictEqual(standardGlobal.status, 200);
      assert.strictEqual(standardGlobal.headers['access-control-allow-origin'], '*');
      assert.ok(standardGlobal.body.includes('name: smalldocs'));
      assert.ok(!standardGlobal.body.includes('sdoc cloud status --json'));

      const cloudCatalog = await get(
        BASE + '/agent-skills/cloud/.well-known/agent-skills/index.json');
      assert.strictEqual(cloudCatalog.status, 200);
      assert.strictEqual(JSON.parse(cloudCatalog.body).skills[0].name, 'smalldocs');
      const cloudGlobal = await get(
        BASE + '/agent-skills/cloud/.well-known/agent-skills/smalldocs/SKILL.md');
      assert.strictEqual(cloudGlobal.status, 200);
      assert.ok(cloudGlobal.body.includes('name: smalldocs'));
      assert.ok(cloudGlobal.body.includes('This user has enabled SmallDocs Cloud'));
      assert.ok(cloudGlobal.body.includes('sdoc cloud status --json'));

      const appsReference = await get(
        BASE + '/.well-known/agent-skills/smalldocs-author/references/apps.md'
      );
      assert.strictEqual(appsReference.status, 200);
      assert.ok(appsReference.body.includes('The component starts inline'));
    });

    await testAsync('embed shell allows only its declared customer origin to frame it', async () => {
      const parentOrigin = 'https://customer.example';
      const r = await get(BASE + '/embed?parentOrigin=' + encodeURIComponent(parentOrigin)
        + '&channel=test-channel');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('text/html'));
      assert.ok(r.headers['content-security-policy'].includes('frame-ancestors ' + parentOrigin));
      assert.strictEqual(r.headers['x-frame-options'], undefined);
      assert.strictEqual(r.headers['cross-origin-resource-policy'], 'cross-origin');
      assert.ok(r.body.includes('/public/css/embed.css'));
      assert.ok(r.body.includes('/public/sdocs-embed.js'));
      assert.ok(!r.body.includes('__CLOUD_UI_'));
    });

    await testAsync('embed shell rejects missing or malformed customer origins', async () => {
      const missing = await get(BASE + '/embed?channel=test-channel');
      assert.strictEqual(missing.status, 400);
      const malformed = await get(BASE + '/embed?parentOrigin=javascript%3Aalert(1)&channel=test-channel');
      assert.strictEqual(malformed.status, 400);
    });

    await testAsync('normal document reader does not load embed-only assets', async () => {
      const r = await get(BASE + '/docs');
      assert.strictEqual(r.status, 200);
      assert.ok(!r.body.includes('/public/css/embed.css'));
      assert.ok(!r.body.includes('/public/sdocs-embed.js'));
      assert.ok(!r.body.includes('__EMBED_STYLES__'));
      assert.ok(!r.body.includes('__EMBED_SCRIPT__'));
    });

    await testAsync('ordinary document pages remain unavailable to frames', async () => {
      const r = await get(BASE + '/docs');
      assert.strictEqual(r.headers['x-frame-options'], 'DENY');
      assert.ok(!r.headers['content-security-policy'].includes('frame-ancestors https://customer.example'));
    });

    await testAsync('signed-out Cloud Library explains Cloud before authentication', async () => {
      const r = await get(BASE + '/library?scope=cloud');
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.includes('data-cloud-authenticated="false"'));
      assert.ok(r.body.includes('data-cloud-terms-accepted="false"'));
      assert.ok(r.body.includes('<h1>Cloud Library</h1>'));
      assert.ok(r.body.includes('class="library-sign-in"'));
      assert.ok(r.body.includes('Subscribe to Cloud'));
      assert.ok(r.body.includes('Search and tags'));
      assert.ok(r.body.includes('id="library-menu" hidden'));
    });

    await testAsync('GET /new returns 200 with HTML', async () => {
      const r = await get(BASE + '/new');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('text/html'));
      assert.ok(r.body.includes('SDocs'));
    });

    await testAsync('GET /advanced-spreadsheets serves the product update workbook', async () => {
      const r = await get(BASE + '/advanced-spreadsheets');
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['content-type'].includes('text/html'));
      assert.ok(r.body.includes('/public/advanced-spreadsheets.md'),
        'advanced spreadsheet route should preload its markdown');
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

    await testAsync('GET /home serves the explicit landing page', async () => {
      const r = await get(BASE + '/home');
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.includes('<title>SmallDocs - an office suite for coding agents</title>'));
      assert.ok(r.body.includes("var explicitHomepage = location.pathname === '/home';"));
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

    await testAsync('Cloud document source loads before the app source dispatcher', async () => {
      const body = (await get(BASE + '/docs')).body;
      const source = body.indexOf('/public/sdocs-source.js');
      const cloud = body.indexOf('/public/sdocs-cloud-prototype.js');
      const cloudLab = body.indexOf('/public/sdocs-cloud-ui-lab.js');
      const app = body.indexOf('/public/sdocs-app.js');
      assert.ok(source >= 0 && cloud > source && cloudLab > cloud && app > cloudLab);
      assert.ok(body.includes('/public/css/cloud-ui-lab.css'));
    });

    await testAsync('GET /docs keeps heavy spreadsheet features out of the initial scripts', async () => {
      const r = await get(BASE + '/docs');
      assert.ok(/<script src="\/public\/sdocs-cells-ui\.js\?v=[a-f0-9]+"><\/script>/.test(r.body),
        'cells UI should remain versioned and eager');
      for (const file of ['sdocs-cells-xlsx.js', 'sdocs-cells-focus.js', 'sdocs-cells-edit.js']) {
        assert.ok(!r.body.includes('<script src="/public/' + file),
          file + ' should load only when its feature is requested');
      }
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

    await testAsync('legal and privacy policy routes render the intended documents', async () => {
      const routes = [
        ['/legal', '/public/legal.md'],
        ['/privacy', '/public/privacy.md'],
        ['/acceptable-use', '/public/acceptable-use.md'],
        ['/cancellation', '/public/cancellation.md'],
        ['/service-closure', '/public/service-closure.md'],
        ['/subprocessors', '/public/subprocessors.md'],
      ];
      for (const [route, documentPath] of routes) {
        const response = await get(BASE + route);
        assert.strictEqual(response.status, 200, route);
        assert.ok(response.body.includes(documentPath), route + ' should load ' + documentPath);
      }
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
      assert.ok(r.body.includes('£4'));
      assert.ok(r.body.includes('$5 USD'));
      assert.ok(r.body.includes('£7'));
      assert.ok(r.body.includes('$9 USD'));
      assert.ok(r.body.includes('not end-to-end encrypted'));
      assert.ok(!r.body.toLowerCase().includes('trial'));
      assert.ok(r.body.includes('/cloud/checkout?plan=personal'));
      assert.ok(r.body.includes('/cloud/checkout?plan=team'));
      assert.ok(r.body.includes('data-cloud-authenticated="false"'));
      assert.ok(!r.body.includes('href="/docs"'));
    });

    await testAsync('asset-versioning: /cloud is versioned', async () => {
      const v = JSON.parse((await get(BASE + '/version-check')).body).version;
      await assertEveryAssetVersioned('/cloud', v);
    });

    await testAsync('GET /cloud/admin requires a Cloud session', async () => {
      const r = await get(BASE + '/cloud/admin');
      assert.strictEqual(r.status, 303);
      assert.ok(r.headers.location.startsWith('/cloud/sign-in?return='));
    });

    await testAsync('GET /cloud/sign-in returns the Cloud authentication page', async () => {
      const r = await get(BASE + '/cloud/sign-in?return=%2Fcloud%2Fadmin');
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.includes('<h1 id="auth-title">Sign in</h1>'));
      assert.ok(r.body.includes('<a class="provider-button provider-link" data-provider="google"'));
      assert.ok(r.body.includes('<a hidden class="provider-button provider-link" data-provider="github"'));
      assert.ok(r.body.includes('class="provider-icon"'));
      assert.ok(r.body.includes('class="provider-icon provider-icon-github"'));
      assert.ok(r.body.includes('Email me a code'));
      assert.ok(!r.body.includes('Your local files stay on this device'));
      assert.strictEqual(r.headers['cache-control'], 'no-store');
      assert.strictEqual(r.headers['x-frame-options'], 'DENY');
      assert.ok(r.headers['content-security-policy'].includes("default-src 'none'"));
    });

    await testAsync('staging test login routes do not exist without explicit staging configuration', async () => {
      const page = await get(BASE + '/cloud/test-login');
      assert.strictEqual(page.status, 404);
      const api = await post(BASE + '/api/cloud/auth/test-login', {
        email: 'personal-demo@smalldocs.org', secret: 'not-configured',
      }, { Origin: BASE });
      assert.strictEqual(api.status, 404);
    });

    await testAsync('asset-versioning: /cloud/sign-in is versioned', async () => {
      const v = JSON.parse((await get(BASE + '/version-check')).body).version;
      await assertEveryAssetVersioned('/cloud/sign-in', v);
    });

    let googleOAuthState;
    let googleOAuthCookie;
    await testAsync('configured Google OAuth start redirects with state, nonce, and PKCE', async () => {
      const r = await get(BASE + '/api/cloud/auth/oauth/google?return_to=' +
        encodeURIComponent('/cloud/admin'));
      assert.strictEqual(r.status, 303);
      assert.strictEqual(r.headers['cache-control'], 'no-store');
      assert.strictEqual(r.headers['referrer-policy'], 'no-referrer');
      assert.ok(r.headers['set-cookie'][0].startsWith('sdocs_oauth_google='));
      assert.ok(r.headers['set-cookie'][0].includes('HttpOnly'));
      assert.ok(r.headers['set-cookie'][0].includes('SameSite=Lax'));
      googleOAuthCookie = r.headers['set-cookie'][0].split(';')[0];
      const location = new URL(r.headers.location);
      assert.strictEqual(location.origin, 'https://accounts.google.com');
      assert.strictEqual(location.searchParams.get('client_id'), 'http-test-google-client');
      assert.strictEqual(location.searchParams.get('redirect_uri'),
        BASE + '/api/cloud/auth/oauth/google/callback');
      assert.strictEqual(location.searchParams.get('scope'), 'openid email');
      assert.strictEqual(location.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(location.searchParams.get('code_challenge'));
      assert.ok(location.searchParams.get('nonce'));
      googleOAuthState = location.searchParams.get('state');
      assert.ok(googleOAuthState);
    });

    await testAsync('Google OAuth denial consumes state without contacting the provider', async () => {
      const unbound = await get(BASE + '/api/cloud/auth/oauth/google/callback?error=access_denied&state=' +
        encodeURIComponent(googleOAuthState));
      assert.strictEqual(unbound.status, 303);
      assert.strictEqual(unbound.headers.location, '/cloud/sign-in?error=oauth_failed');
      assert.ok(!unbound.headers['set-cookie']);

      const denied = await get(BASE + '/api/cloud/auth/oauth/google/callback?error=access_denied&state=' +
        encodeURIComponent(googleOAuthState) + '&error_description=' +
        encodeURIComponent('private provider detail'), { Cookie: googleOAuthCookie });
      assert.strictEqual(denied.status, 303);
      assert.strictEqual(denied.headers.location, '/cloud/sign-in?error=oauth_denied');
      assert.ok(!denied.headers.location.includes('private'));
      assert.ok(denied.headers['set-cookie'][0].includes('Max-Age=0'));

      const reused = await get(BASE + '/api/cloud/auth/oauth/google/callback?error=access_denied&state=' +
        encodeURIComponent(googleOAuthState), { Cookie: googleOAuthCookie });
      assert.strictEqual(reused.status, 303);
      assert.strictEqual(reused.headers.location, '/cloud/sign-in?error=oauth_failed');
      assert.ok(reused.headers['set-cookie'][0].includes('Max-Age=0'));
    });

    await testAsync('unconfigured GitHub OAuth start and callback fail closed', async () => {
      const started = await get(BASE + '/api/cloud/auth/oauth/github?return_to=%2Fcloud%2Faccount');
      assert.strictEqual(started.status, 503);
      assert.strictEqual(JSON.parse(started.body).error, 'provider_not_configured');
      assert.ok(!started.headers.location);
      const callback = await get(BASE + '/api/cloud/auth/oauth/github/callback?state=unknown&code=unknown');
      assert.strictEqual(callback.status, 503);
      assert.strictEqual(JSON.parse(callback.body).error, 'provider_not_configured');
      assert.ok(!callback.headers['set-cookie']);
    });

    await testAsync('Cloud email code request rejects a missing Origin', async () => {
      const r = await post(BASE + '/api/cloud/auth/email/request', { email: 'person@example.com' });
      assert.strictEqual(r.status, 403);
      assert.strictEqual(JSON.parse(r.body).error, 'invalid_origin');
    });

    await testAsync('Cloud email sign-in requires and records current Terms before Cloud use', async () => {
      const requested = await post(BASE + '/api/cloud/auth/email/request', {
        email: 'person@example.com', return_to: '/cloud/admin',
      }, { Origin: BASE });
      assert.strictEqual(requested.status, 202);
      const challenge = JSON.parse(requested.body).challenge_id;
      const codeMatch = new RegExp('\\[cloud-auth-code\\] ' + challenge + ' (\\d{6})').exec(serverOutput);
      assert.ok(codeMatch, 'development delivery should log the code for this challenge');

      const verified = await post(BASE + '/api/cloud/auth/email/verify', {
        challenge_id: challenge,
        code: codeMatch[1],
        return_to: '/cloud/admin',
      }, { Origin: BASE });
      assert.strictEqual(verified.status, 200);
      assert.strictEqual(JSON.parse(verified.body).return_to,
        '/cloud/terms?return=%2Fcloud%2Fadmin');
      assert.ok(verified.headers['set-cookie'][0].startsWith('sdocs_cloud='));
      assert.ok(verified.headers['set-cookie'][0].includes('HttpOnly'));
      assert.ok(verified.headers['set-cookie'][0].includes('SameSite=Lax'));
      const cookie = verified.headers['set-cookie'][0].split(';')[0];
      const blockedApi = await get(BASE + '/api/cloud/v1/workspaces', { Cookie: cookie });
      assert.strictEqual(blockedApi.status, 403);
      assert.deepStrictEqual(JSON.parse(blockedApi.body), {
        ok: false,
        error: 'terms_acceptance_required',
        terms_version: CURRENT_TERMS_VERSION,
        terms_url: '/legal',
        acceptance_url: '/cloud/terms',
      });
      const blockedPage = await get(BASE + '/cloud/admin', { Cookie: cookie });
      assert.strictEqual(blockedPage.status, 303);
      assert.strictEqual(blockedPage.headers.location,
        '/cloud/terms?return=%2Fcloud%2Fadmin');
      const blockedAuthorization = await get(BASE + '/cloud/authorize?user_code=ABCD-EFGH', {
        Cookie: cookie,
      });
      assert.strictEqual(blockedAuthorization.status, 303);
      assert.strictEqual(blockedAuthorization.headers.location,
        '/cloud/terms?return=%2Fcloud%2Fauthorize%3Fuser_code%3DABCD-EFGH');
      const blockedInvitationPage = await get(BASE + '/cloud/invite?token=unaccepted-user', {
        Cookie: cookie,
      });
      assert.strictEqual(blockedInvitationPage.status, 303);
      assert.strictEqual(blockedInvitationPage.headers.location,
        '/cloud/terms?return=%2Fcloud%2Finvite%3Ftoken%3Dunaccepted-user');
      const blockedInvitationAccept = await post(
        BASE + '/api/cloud/v1/invitations/unaccepted-user/accept', {},
        { Origin: BASE, Cookie: cookie });
      assert.strictEqual(blockedInvitationAccept.status, 403);
      assert.strictEqual(JSON.parse(blockedInvitationAccept.body).error,
        'terms_acceptance_required');
      const termsPage = await get(BASE + blockedPage.headers.location, { Cookie: cookie });
      assert.strictEqual(termsPage.status, 200);
      assert.ok(termsPage.body.includes('I agree to the'));
      assert.ok(termsPage.body.includes('value="' + CURRENT_TERMS_VERSION + '"'));
      assert.ok(!termsPage.body.includes('I agree to the <a href="/privacy"'),
        'the Privacy Notice must not be presented as consent');

      const invalidAcceptance = await post(BASE + '/api/cloud/auth/terms/accept', {
        accepted: true, terms_version: 'old-version', return_to: '/cloud/admin',
      }, { Origin: BASE, Cookie: cookie });
      assert.strictEqual(invalidAcceptance.status, 400);
      const accepted = await acceptCloudTerms(cookie, '/cloud/admin');
      assert.strictEqual(accepted.status, 200);
      assert.strictEqual(JSON.parse(accepted.body).terms_version, CURRENT_TERMS_VERSION);
      assert.ok(JSON.parse(accepted.body).accepted_at);

      const settings = await get(BASE + '/cloud/admin', { Cookie: cookie });
      assert.strictEqual(settings.status, 200);
      assert.ok(settings.body.includes('Cloud settings'));
      assert.ok(settings.body.includes('Connected machines'));
      assert.ok(settings.body.includes('/public/cloud-admin.js?v='));
      assert.ok(/script-src[^;]*'self'/.test(settings.headers['content-security-policy'] || ''));
      assert.ok(/connect-src[^;]*'self'/.test(settings.headers['content-security-policy'] || ''));

      const loggedOut = await post(BASE + '/api/cloud/auth/logout', '', {
        Origin: BASE,
        Cookie: cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
      });
      assert.strictEqual(loggedOut.status, 303);
      assert.strictEqual(loggedOut.headers.location, '/cloud/sign-in');
      assert.ok(loggedOut.headers['set-cookie'][0].includes('Max-Age=0'));
      const afterLogout = await get(BASE + '/cloud/admin', { Cookie: cookie });
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
      assert.strictEqual(JSON.parse(verified.body).return_to,
        '/cloud/terms?return=%2Fcloud%2Fadmin');
    });

    await testAsync('legacy Cloud account URL redirects to Connected machines', async () => {
      const r = await get(BASE + '/cloud/account');
      assert.strictEqual(r.status, 303);
      assert.strictEqual(r.headers.location, '/cloud/admin?panel=machines');
    });

    let cloudCookie;
    let cloudWorkspace;
    let cloudProject;
    let cloudDocument;
    let cloudTeamWorkspace;
    let cloudTeamProject;
    let cloudTeamDocument;
    let cloudMemberCookie;
    let cloudMemberUser;

    await testAsync('Cloud API requires an authenticated session', async () => {
      const r = await get(BASE + '/api/cloud/v1/workspaces');
      assert.strictEqual(r.status, 401);
      assert.strictEqual(JSON.parse(r.body).error, 'login_required');
    });

    await testAsync('email authentication creates identity without creating an account', async () => {
      const requested = await post(BASE + '/api/cloud/auth/email/request', {
        email: 'cloud-api@example.com',
      }, { Origin: BASE });
      const challenge = JSON.parse(requested.body).challenge_id;
      const codeMatch = new RegExp('\\[cloud-auth-code\\] ' + challenge + ' (\\d{6})').exec(serverOutput);
      const verified = await post(BASE + '/api/cloud/auth/email/verify', {
        challenge_id: challenge, code: codeMatch[1], return_to: '/cloud/admin',
      }, { Origin: BASE });
      cloudCookie = verified.headers['set-cookie'][0].split(';')[0];
      const termsBlocked = await get(BASE + '/api/cloud/v1/workspaces', { Cookie: cloudCookie });
      assert.strictEqual(termsBlocked.status, 403);
      assert.strictEqual((await acceptCloudTerms(cloudCookie, '/cloud/admin')).status, 200);
      const response = await get(BASE + '/api/cloud/v1/workspaces', { Cookie: cloudCookie });
      assert.strictEqual(response.status, 200);
      const parsed = JSON.parse(response.body);
      assert.strictEqual(parsed.workspaces.length, 0);
      const account = await get(BASE + '/api/cloud/v1/account', { Cookie: cloudCookie });
      assert.strictEqual(account.status, 404);
      assert.strictEqual(JSON.parse(account.body).error, 'account_required');

      const homepage = await get(BASE + '/', { Cookie: cloudCookie });
      assert.strictEqual(homepage.status, 200);
      assert.strictEqual(homepage.headers['cache-control'], 'private, no-store');
      assert.strictEqual(homepage.headers.vary, 'Cookie');
      assert.ok(homepage.body.includes('var cloudAuthenticated = \'true\''),
        'signed-in root should route the browser to Cloud Library');
      assert.ok(homepage.body.includes('class="btn-gh nav-cloud" href="/cloud"'),
        'signed-in unpaid users should retain the Cloud purchase route');
      assert.ok(homepage.body.includes('class="btn-gh" href="/library?scope=cloud"'),
        'signed-in users should get Cloud library as a primary action');
      assert.ok(!homepage.body.includes('href="/cloud/sign-in?return='));
      assert.ok(homepage.body.includes('href="/cloud/admin" role="menuitem"'));
      assert.ok(!homepage.body.includes('href="/cloud/account" role="menuitem"'));
      assert.ok(homepage.body.includes('action="/api/cloud/auth/logout"'));
      assert.ok(homepage.body.includes('<path d="M22 19h-6l3 3"/>'),
        'sign-out should use the user-round-arrow-left icon');

      const cloudPage = await get(BASE + '/cloud', { Cookie: cloudCookie });
      assert.strictEqual(cloudPage.headers['cache-control'], 'private, no-store');
      assert.strictEqual(cloudPage.headers.vary, 'Cookie');
      assert.ok(cloudPage.body.includes('data-cloud-authenticated="true"'));
      assert.ok(cloudPage.body.includes('data-cloud-terms-accepted="true"'));

      const connectPage = await get(BASE + '/connect', { Cookie: cloudCookie });
      assert.ok(connectPage.body.includes('data-cloud-authenticated="true"'));
      assert.ok(connectPage.body.includes('data-cloud-terms-accepted="true"'));

      const rescuedPage = await get(BASE + '/library/rescued', { Cookie: cloudCookie });
      assert.ok(rescuedPage.body.includes('data-cloud-authenticated="true"'));
      assert.ok(rescuedPage.body.includes('data-cloud-terms-accepted="true"'));

      const library = await get(BASE + '/library?scope=cloud', { Cookie: cloudCookie });
      assert.strictEqual(library.status, 200);
      assert.strictEqual(library.headers['cache-control'], 'private, no-store');
      assert.strictEqual(library.headers.vary, 'Cookie');
      assert.ok(library.body.includes('<title>SmallDocs - Library</title>'));
      assert.ok(library.body.includes('data-cloud-terms-accepted="true"'));
      assert.ok(library.body.includes('class="brand" href="/" aria-label="SmallDocs home"'));
      assert.ok(library.body.includes('href="/cloud/admin" role="menuitem"'));
      assert.ok(library.body.includes('href="/docs" role="menuitem"'));
      assert.ok(library.body.includes('action="/api/cloud/auth/logout"'));
      assert.ok(!library.body.includes('__LIBRARY_NAV_MENU_'));

      const documentPage = await get(BASE + '/docs', { Cookie: cloudCookie });
      assert.strictEqual(documentPage.headers['cache-control'], 'private, no-store');
      assert.strictEqual(documentPage.headers.vary, 'Cookie');
      assert.ok(documentPage.body.includes('href="/library?scope=cloud"'));
      assert.ok(documentPage.body.includes('data-cloud-authenticated="true"'));
      assert.ok(documentPage.body.includes('data-cloud-terms-accepted="true"'));
      assert.ok(!documentPage.body.includes('id="doc-site-menu"'));
      assert.ok(!documentPage.body.includes('data-sdocs-sign-in-return'));
      assert.ok(!documentPage.body.includes('__DOCUMENT_NAV_'));
    });

    await testAsync('Just me account creation is explicit and idempotent', async () => {
      const created = await post(BASE + '/api/cloud/v1/workspaces', {
        kind: 'personal', name: 'Cloud', project_name: 'Documents',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(created.status, 201);
      const repeated = await post(BASE + '/api/cloud/v1/workspaces', {
        kind: 'personal', name: 'Cloud', project_name: 'Documents',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(repeated.status, 200);
      assert.strictEqual(JSON.parse(repeated.body).workspace.workspaceId,
        JSON.parse(created.body).workspace.workspaceId);
      const listed = JSON.parse((await get(BASE + '/api/cloud/v1/workspaces', {
        Cookie: cloudCookie,
      })).body).workspaces;
      assert.strictEqual(listed.length, 1);
      assert.strictEqual(listed[0].kind, 'personal');
      cloudWorkspace = listed[0];
    });

    await testAsync('authenticated Cloud admin page is private and versioned', async () => {
      const response = await get(BASE + '/cloud/admin', { Cookie: cloudCookie });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers['cache-control'], 'no-store');
      assert.ok(response.body.includes('Billing'));
      assert.ok(!response.body.includes('Agent access'));
      assert.ok(response.body.includes('Connected machines'));
      assert.ok(response.body.includes('Cloud settings'));
      assert.ok(response.body.includes('data-sdocs-site-page="settings"'));
      assert.ok(response.body.includes('/public/css/site-sidebar.css'));
      assert.ok(response.body.includes('/public/sdocs-site-sidebar.js'));
      assert.ok(!response.body.includes('class="header"'));
      assert.ok(!response.body.includes('class="side-label"'));
      assert.ok(response.body.includes('>People</button>'));
      assert.ok(!response.body.includes('data-panel="projects"'));
      const version = JSON.parse((await get(BASE + '/version-check')).body).version;
      const assetUrls = [...response.body.matchAll(/(?:src|href)="(\/public\/[^"?#]+)\?v=([^"&]+)"/g)];
      assert.ok(assetUrls.length > 0);
      assetUrls.forEach((match) => assert.strictEqual(match[2], version));
    });

    await testAsync('Cloud API lists the activated default project', async () => {
      const response = await get(BASE + '/api/cloud/v1/projects?workspace_id=' + cloudWorkspace.id,
        { Cookie: cloudCookie });
      assert.strictEqual(response.status, 200);
      const parsed = JSON.parse(response.body);
      assert.strictEqual(parsed.projects.length, 1);
      assert.strictEqual(parsed.projects[0].name, 'Documents');
      cloudProject = parsed.projects[0];
      const blocked = await post(BASE + '/api/cloud/v1/documents', {
        project_id: cloudProject.id, filename: 'unpaid.md', markdown: '# Unpaid',
        idempotency_key: 'unpaid-document',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(blocked.status, 402);
      assert.strictEqual(JSON.parse(blocked.body).error, 'subscription_required');
      cloudBilling.upsertSubscription({ workspaceId: cloudWorkspace.id,
        plan: 'personal', status: 'active', seatQuantity: 1,
        provider: 'test', providerSubscriptionId: 'personal-http-test' });

      const activeHomepage = await get(BASE + '/', { Cookie: cloudCookie });
      assert.ok(!activeHomepage.body.includes('class="btn-gh nav-cloud" href="/cloud"'),
        'active Cloud users should not get a purchase action');
      assert.ok(activeHomepage.body.includes('class="btn-gh" href="/library?scope=cloud"'),
        'active Cloud users should retain the primary Cloud library action');
    });

    await testAsync('Stripe lifecycle webhooks queue fixed billing notices and deletion work once', async () => {
      const created = Math.floor(Date.now() / 1000);
      const subscription = {
        id: 'sub_http_lifecycle', customer: 'cus_http_lifecycle', created,
        status: 'past_due', cancel_at_period_end: false,
        metadata: { workspace_id: cloudWorkspace.id, plan: 'personal' },
        items: { data: [{ quantity: 1,
          current_period_end: created + 30 * 24 * 60 * 60 }] },
      };
      const event = { id: 'evt_http_payment_failed', type: 'customer.subscription.updated',
        created, data: { object: subscription } };
      assert.strictEqual((await postStripeEvent(event)).status, 200);
      const failed = cloudBilling.getSubscription(cloudWorkspace.id);
      assert.strictEqual(failed.status, 'past_due');
      assert.strictEqual(failed.graceEndsAtMs, created * 1000 + 7 * 24 * 60 * 60 * 1000);
      assert.strictEqual(failed.retentionEndsAtMs,
        created * 1000 + 60 * 24 * 60 * 60 * 1000);

      const Database = require('better-sqlite3');
      let jobs = new Database(testCloudJobsDbPath, { readonly: true });
      const queuedTypes = jobs.prepare(`
        SELECT type, payload_json FROM cloud_jobs
        WHERE type IN ('billing_state_email', 'billing_retention_expire')
        ORDER BY type, available_at_ms
      `).all();
      jobs.close();
      assert.ok(queuedTypes.some((job) => job.type === 'billing_state_email' &&
        JSON.parse(job.payload_json).type === 'payment_failed'));
      assert.ok(queuedTypes.some((job) => job.type === 'billing_state_email' &&
        JSON.parse(job.payload_json).type === 'payment_read_only'));
      assert.ok(queuedTypes.some((job) => job.type === 'billing_state_email' &&
        JSON.parse(job.payload_json).type === 'deletion_warning'));
      assert.ok(queuedTypes.some((job) => job.type === 'billing_retention_expire'));
      assert.strictEqual(JSON.stringify(queuedTypes).includes('cloud-api@example.com'), false);

      assert.strictEqual((await postStripeEvent(event)).status, 200);
      jobs = new Database(testCloudJobsDbPath, { readonly: true });
      const afterDuplicate = jobs.prepare(`
        SELECT COUNT(*) AS count FROM cloud_jobs
        WHERE type IN ('billing_state_email', 'billing_retention_expire')
      `).get().count;
      jobs.close();
      assert.strictEqual(afterDuplicate, queuedTypes.length);

      const recovery = { id: 'evt_http_payment_recovered',
        type: 'customer.subscription.updated', created: created + 1,
        data: { object: Object.assign({}, subscription, { status: 'active' }) } };
      assert.strictEqual((await postStripeEvent(recovery)).status, 200);
      const recovered = cloudBilling.getSubscription(cloudWorkspace.id);
      assert.strictEqual(recovered.status, 'active');
      assert.strictEqual(recovered.retentionEndsAtMs, null);
      jobs = new Database(testCloudJobsDbPath, { readonly: true });
      const recoveryJob = jobs.prepare(`
        SELECT payload_json FROM cloud_jobs WHERE type = 'billing_state_email'
        ORDER BY created_at_ms DESC
      `).all().find((job) => JSON.parse(job.payload_json).type === 'payment_recovered');
      jobs.close();
      assert.ok(recoveryJob);

      const scheduled = { id: 'evt_http_cancellation_scheduled',
        type: 'customer.subscription.updated', created: created + 2,
        data: { object: Object.assign({}, subscription, { status: 'active',
          cancel_at_period_end: true }) } };
      assert.strictEqual((await postStripeEvent(scheduled)).status, 200);
      const canceled = { id: 'evt_http_cancellation_effective',
        type: 'customer.subscription.deleted', created: created + 3,
        data: { object: Object.assign({}, subscription, { status: 'canceled',
          cancel_at_period_end: true, canceled_at: created + 2 }) } };
      assert.strictEqual((await postStripeEvent(canceled)).status, 200);
      jobs = new Database(testCloudJobsDbPath, { readonly: true });
      const cancellationNotices = jobs.prepare(`
        SELECT payload_json FROM cloud_jobs WHERE type = 'billing_state_email'
      `).all().map((job) => JSON.parse(job.payload_json)).filter((payload) =>
        payload.providerSubscriptionId === subscription.id &&
        payload.type === 'cancellation_effective');
      jobs.close();
      assert.strictEqual(cancellationNotices.length, 1);
      cloudBilling.upsertSubscription({ workspaceId: cloudWorkspace.id,
        plan: 'personal', status: 'active', seatQuantity: 1,
        provider: 'test', providerSubscriptionId: 'personal-http-test' });
    });

    await testAsync('Cloud API returns the current account without exposing identities', async () => {
      const response = await get(BASE + '/api/cloud/v1/me', { Cookie: cloudCookie });
      assert.strictEqual(response.status, 200);
      const user = JSON.parse(response.body).user;
      assert.strictEqual(user.email, 'cloud-api@example.com');
      assert.strictEqual(Object.prototype.hasOwnProperty.call(user, 'identities'), false);
    });

    await testAsync('Cloud API requires and stores separate names', async () => {
      const missingLastName = await patch(BASE + '/api/cloud/v1/me', {
        first_name: 'Ada', last_name: '',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(missingLastName.status, 400);
      const response = await patch(BASE + '/api/cloud/v1/me', {
        first_name: '  Ada  ', last_name: '  Lovelace  ',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(JSON.parse(response.body).user.first_name, 'Ada');
      assert.strictEqual(JSON.parse(response.body).user.last_name, 'Lovelace');
      const current = await get(BASE + '/api/cloud/v1/me', { Cookie: cloudCookie });
      assert.strictEqual(Object.hasOwn(JSON.parse(current.body).user, 'display_name'), false);
    });

    await testAsync('Cloud workspace owner can create a team workspace and project', async () => {
      const created = await post(BASE + '/api/cloud/v1/workspaces', {
        kind: 'team', name: 'Test Team', project_name: 'Platform',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(created.status, 201);
      cloudTeamWorkspace = JSON.parse(created.body).workspace;
      cloudTeamProject = { id: cloudTeamWorkspace.projectId };
      assert.deepStrictEqual(cloudTeamWorkspace.inviteDomains, ['example.com']);
      const initialPolicy = await get(BASE + '/api/cloud/v1/account/invite-policy?account_id=' +
        cloudTeamWorkspace.workspaceId, { Cookie: cloudCookie });
      assert.strictEqual(initialPolicy.status, 200);
      assert.deepStrictEqual(JSON.parse(initialPolicy.body).policy.domains, ['example.com']);
      const blocked = await post(BASE + '/api/cloud/v1/workspaces/' + cloudTeamWorkspace.workspaceId + '/projects', {
        name: 'Blocked project',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(blocked.status, 402);
      cloudBilling.upsertSubscription({ workspaceId: cloudTeamWorkspace.workspaceId,
        plan: 'team', status: 'active', seatQuantity: 2,
        provider: 'test', providerSubscriptionId: 'team-http-test' });

      const ambiguous = await get(BASE + '/api/cloud/v1/account', { Cookie: cloudCookie });
      assert.strictEqual(ambiguous.status, 409);
      assert.strictEqual(JSON.parse(ambiguous.body).error, 'account_selection_required');
      assert.strictEqual(JSON.parse(ambiguous.body).accounts.length, 2);

      const document = await post(BASE + '/api/cloud/v1/documents', {
        project_id: cloudTeamProject.id, filename: 'team-plan.md',
        markdown: '# Team plan\nShared with invited members.',
        idempotency_key: 'team-document-for-invitation',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(document.status, 201);
      cloudTeamDocument = JSON.parse(document.body).document;
      const shared = await patch(BASE + '/api/cloud/v1/documents/' + cloudTeamDocument.id + '/permission', {
        mode: 'everyone', member_user_ids: [],
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(shared.status, 200);

      const project = await post(BASE + '/api/cloud/v1/workspaces/' + cloudTeamWorkspace.workspaceId + '/projects', {
        name: 'Webhooks',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(project.status, 201);
      assert.strictEqual(JSON.parse(project.body).project.name, 'Webhooks');
    });

    await testAsync('Cloud account invitation API lists and cancels pending invitations', async () => {
      const accountId = encodeURIComponent(cloudTeamWorkspace.workspaceId);
      const created = await post(BASE + '/api/cloud/v1/account/invitations', {
        account_id: cloudTeamWorkspace.workspaceId, email: 'pending-admin@example.com', role: 'admin',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(created.status, 201);
      const invitation = JSON.parse(created.body).invitation;
      assert.strictEqual(invitation.email, 'pending-admin@example.com');
      assert.strictEqual(invitation.role, 'admin');

      const listed = await get(BASE + '/api/cloud/v1/account/invitations?account_id=' + accountId,
        { Cookie: cloudCookie });
      assert.strictEqual(listed.status, 200);
      assert.ok(JSON.parse(listed.body).invitations.some((item) => item.id === invitation.id));

      const cancelled = await del(BASE + '/api/cloud/v1/account/invitations/' + invitation.id, {
        account_id: cloudTeamWorkspace.workspaceId,
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(cancelled.status, 200);
      const after = await get(BASE + '/api/cloud/v1/account/invitations?account_id=' + accountId,
        { Cookie: cloudCookie });
      assert.strictEqual(JSON.parse(after.body).invitations.some((item) => item.id === invitation.id), false);
    });

    await testAsync('Cloud invitation is email-bound, grants projects, and is single-use', async () => {
      const invited = await post(BASE + '/api/cloud/v1/workspaces/' + cloudTeamWorkspace.workspaceId + '/invitations', {
        email: 'team-member@example.com', role: 'member',
        project_grants: [{ projectId: cloudTeamProject.id, role: 'editor' }],
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(invited.status, 201);
      const acceptUrl = JSON.parse(invited.body).invitation.accept_url;
      const token = new URL(acceptUrl).searchParams.get('token');
      assert.ok(token);

      const requested = await post(BASE + '/api/cloud/auth/email/request', {
        email: 'team-member@example.com',
      }, { Origin: BASE });
      const challenge = JSON.parse(requested.body).challenge_id;
      const codeMatch = new RegExp('\\[cloud-auth-code\\] ' + challenge + ' (\\d{6})').exec(serverOutput);
      const verified = await post(BASE + '/api/cloud/auth/email/verify', {
        challenge_id: challenge, code: codeMatch[1], return_to: '/cloud/admin',
      }, { Origin: BASE });
      cloudMemberCookie = verified.headers['set-cookie'][0].split(';')[0];
      assert.strictEqual((await acceptCloudTerms(cloudMemberCookie, '/cloud/invite')).status, 200);
      cloudMemberUser = JSON.parse((await get(BASE + '/api/cloud/v1/me', {
        Cookie: cloudMemberCookie,
      })).body).user;

      const missingProfile = await post(BASE + '/api/cloud/v1/invitations/' + encodeURIComponent(token) + '/accept', {},
        { Origin: BASE, Cookie: cloudMemberCookie });
      assert.strictEqual(missingProfile.status, 409);
      assert.strictEqual(JSON.parse(missingProfile.body).error, 'profile_required');
      const profile = await patch(BASE + '/api/cloud/v1/me', {
        first_name: 'Team', last_name: 'Member',
      }, { Origin: BASE, Cookie: cloudMemberCookie });
      assert.strictEqual(profile.status, 200);
      cloudMemberUser = JSON.parse(profile.body).user;

      const accepted = await post(BASE + '/api/cloud/v1/invitations/' + encodeURIComponent(token) + '/accept', {},
        { Origin: BASE, Cookie: cloudMemberCookie });
      assert.strictEqual(accepted.status, 200);
      const projects = await get(BASE + '/api/cloud/v1/projects?workspace_id=' + cloudTeamWorkspace.workspaceId,
        { Cookie: cloudMemberCookie });
      assert.strictEqual(JSON.parse(projects.body).projects[0].role, 'editor');
      const document = await get(BASE + '/api/cloud/v1/documents/' + cloudTeamDocument.id,
        { Cookie: cloudMemberCookie });
      assert.strictEqual(document.status, 200);
      assert.ok(JSON.parse(document.body).document.markdown.includes('Shared with invited members.'));

      const reused = await post(BASE + '/api/cloud/v1/invitations/' + encodeURIComponent(token) + '/accept', {},
        { Origin: BASE, Cookie: cloudMemberCookie });
      assert.strictEqual(reused.status, 404);
    });

    await testAsync('Cloud notifications batch documents without granting or inviting access', async () => {
      const secondResponse = await post(BASE + '/api/cloud/v1/documents', {
        project_id: cloudTeamProject.id, filename: 'team-decisions.md',
        markdown: '# Team decisions', idempotency_key: 'team-notification-second-document',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(secondResponse.status, 201);
      const second = JSON.parse(secondResponse.body).document;
      const shared = await patch(BASE + '/api/cloud/v1/documents/' + second.id + '/permission', {
        mode: 'everyone', member_user_ids: [],
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(shared.status, 200);

      const notificationResponse = await post(BASE + '/api/cloud/v1/notifications', {
        document_ids: [cloudTeamDocument.id, second.id],
        recipient_user_ids: [cloudMemberUser.id],
        note: 'Review these together before Monday.',
        idempotency_key: 'http-team-document-notification',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(notificationResponse.status, 202);
      const notification = JSON.parse(notificationResponse.body).notification;
      assert.deepStrictEqual(notification.document_ids, [cloudTeamDocument.id, second.id]);
      assert.deepStrictEqual(notification.recipient_user_ids, [cloudMemberUser.id]);

      const memberDocuments = JSON.parse((await get(BASE +
        '/api/cloud/v1/documents?workspace_id=' + cloudTeamWorkspace.workspaceId +
        '&shared_with_me=1', { Cookie: cloudMemberCookie })).body).documents;
      assert.ok(memberDocuments.some((item) => item.id === cloudTeamDocument.id &&
        item.shared_with_me === true));
      const ownerDocuments = JSON.parse((await get(BASE +
        '/api/cloud/v1/documents?workspace_id=' + cloudTeamWorkspace.workspaceId +
        '&shared_with_me=1', { Cookie: cloudCookie })).body).documents;
      assert.deepStrictEqual(ownerDocuments, []);

      const unknownRecipient = await post(BASE + '/api/cloud/v1/notifications', {
        document_ids: [cloudTeamDocument.id], recipient_user_ids: ['usr_not_a_member'],
        idempotency_key: 'http-notification-unknown-recipient',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(unknownRecipient.status, 400);
      const memberCanNotify = await post(BASE + '/api/cloud/v1/notifications', {
        document_ids: [cloudTeamDocument.id], recipient_user_ids: [JSON.parse((await get(
          BASE + '/api/cloud/v1/me', { Cookie: cloudCookie })).body).user.id],
        note: 'I checked the shared copy.',
        idempotency_key: 'http-notification-by-non-owner',
      }, { Origin: BASE, Cookie: cloudMemberCookie });
      assert.strictEqual(memberCanNotify.status, 202);

      const Database = require('better-sqlite3');
      const cloud = new Database(testCloudDbPath, { readonly: true });
      const storedNote = cloud.prepare(`
        SELECT note_ciphertext, note_nonce FROM cloud_notification_batches WHERE id = ?
      `).get(notification.id);
      cloud.close();
      assert.strictEqual(storedNote.note_ciphertext.includes(
        Buffer.from('Review these together')), false);
      assert.strictEqual(storedNote.note_nonce.length, 12);
      const jobs = new Database(testCloudJobsDbPath, { readonly: true });
      const queued = jobs.prepare(`
        SELECT payload_json FROM cloud_jobs
        WHERE type = 'document_notification_email' AND idempotency_key = ?
      `).get(notification.id + ':' + cloudMemberUser.id);
      jobs.close();
      assert.deepStrictEqual(JSON.parse(queued.payload_json), {
        batchId: notification.id, recipientUserId: cloudMemberUser.id,
      });
    });

    await testAsync('Cloud admins approve domains and members invite matching coworkers', async () => {
      const accountId = cloudTeamWorkspace.workspaceId;
      const publicDomain = await patch(BASE + '/api/cloud/v1/account/invite-policy', {
        account_id: accountId, domains: ['gmail.com'],
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(publicDomain.status, 400);
      assert.strictEqual(JSON.parse(publicDomain.body).error, 'public_email_domain');

      const updated = await patch(BASE + '/api/cloud/v1/account/invite-policy', {
        account_id: accountId, domains: ['acme.example'],
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(updated.status, 200);
      assert.deepStrictEqual(JSON.parse(updated.body).policy.domains, ['acme.example']);

      const policy = await get(BASE + '/api/cloud/v1/account/invite-policy?account_id=' + accountId,
        { Cookie: cloudMemberCookie });
      assert.strictEqual(policy.status, 200);
      assert.deepStrictEqual(JSON.parse(policy.body).policy, {
        domains: ['acme.example'], can_manage: false, can_invite: true,
      });

      const memberCannotChange = await patch(BASE + '/api/cloud/v1/account/invite-policy', {
        account_id: accountId, domains: ['other.example'],
      }, { Origin: BASE, Cookie: cloudMemberCookie });
      assert.strictEqual(memberCannotChange.status, 403);

      const allowed = await post(BASE + '/api/cloud/v1/account/invitations', {
        account_id: accountId, email: 'new-colleague@acme.example',
      }, { Origin: BASE, Cookie: cloudMemberCookie });
      assert.strictEqual(allowed.status, 201);
      assert.strictEqual(JSON.parse(allowed.body).invitation.email, 'new-colleague@acme.example');

      const denied = await post(BASE + '/api/cloud/v1/account/invitations', {
        account_id: accountId, email: 'friend@other.example',
      }, { Origin: BASE, Cookie: cloudMemberCookie });
      assert.strictEqual(denied.status, 403);
      assert.strictEqual(JSON.parse(denied.body).error, 'permission_denied');
    });

    await testAsync('Cloud owner can add another active member as an owner and remains an owner', async () => {
      const promoted = await post(BASE + '/api/cloud/v1/workspaces/' + cloudTeamWorkspace.workspaceId + '/owners', {
        user_id: cloudMemberUser.id,
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(promoted.status, 200);
      const ownership = JSON.parse(promoted.body).ownership;
      assert.strictEqual(ownership.owner_user_id, cloudMemberUser.id);
      const members = await get(BASE + '/api/cloud/v1/workspaces/' + cloudTeamWorkspace.workspaceId + '/members',
        { Cookie: cloudCookie });
      const owners = JSON.parse(members.body).members.filter((member) => member.role === 'owner');
      assert.strictEqual(owners.length, 2);
      assert.ok(owners.some((member) => member.user_id === cloudMemberUser.id));
      const memberView = await get(BASE + '/api/cloud/v1/workspaces/' + cloudTeamWorkspace.workspaceId + '/members',
        { Cookie: cloudMemberCookie });
      assert.strictEqual(memberView.status, 200);
    });

    await testAsync('Cloud admin lists and revokes pending workspace invitations', async () => {
      const created = await post(BASE + '/api/cloud/v1/workspaces/' + cloudTeamWorkspace.workspaceId + '/invitations', {
        email: 'pending-member@example.com', role: 'member', project_grants: [],
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(created.status, 201);
      const invitation = JSON.parse(created.body).invitation;
      const listed = await get(BASE + '/api/cloud/v1/workspaces/' + cloudTeamWorkspace.workspaceId + '/invitations',
        { Cookie: cloudCookie });
      assert.strictEqual(listed.status, 200);
      assert.ok(JSON.parse(listed.body).invitations.some((item) =>
        item.id === invitation.id && item.email === 'pending-member@example.com'));
      const wrongWorkspace = await del(BASE + '/api/cloud/v1/workspaces/' + cloudWorkspace.id +
        '/invitations/' + invitation.id, {}, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(wrongWorkspace.status, 404);
      const revoked = await del(BASE + '/api/cloud/v1/workspaces/' + cloudTeamWorkspace.workspaceId +
        '/invitations/' + invitation.id, {}, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(revoked.status, 200);
      const after = await get(BASE + '/api/cloud/v1/workspaces/' + cloudTeamWorkspace.workspaceId + '/invitations',
        { Cookie: cloudCookie });
      assert.strictEqual(JSON.parse(after.body).invitations.some((item) => item.id === invitation.id), false);
    });

    await testAsync('Cloud member removal revokes workspace access and preserves the final owner', async () => {
      const members = await get(BASE + '/api/cloud/v1/workspaces/' + cloudTeamWorkspace.workspaceId + '/members',
        { Cookie: cloudCookie });
      assert.strictEqual(members.status, 200);
      assert.ok(JSON.parse(members.body).members.some((member) => member.email === 'team-member@example.com'));

      const removed = await del(BASE + '/api/cloud/v1/workspaces/' + cloudTeamWorkspace.workspaceId +
        '/members/' + cloudMemberUser.id, {}, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(removed.status, 200);
      const projects = await get(BASE + '/api/cloud/v1/projects?workspace_id=' + cloudTeamWorkspace.workspaceId,
        { Cookie: cloudMemberCookie });
      assert.strictEqual(projects.status, 404);
      assert.strictEqual(JSON.parse(projects.body).error, 'resource_unavailable');
      const document = await get(BASE + '/api/cloud/v1/documents/' + cloudTeamDocument.id,
        { Cookie: cloudMemberCookie });
      assert.strictEqual(document.status, 404);
      assert.strictEqual(JSON.parse(document.body).error, 'resource_unavailable');

      const owner = JSON.parse((await get(BASE + '/api/cloud/v1/me', { Cookie: cloudCookie })).body).user;
      const finalOwner = await del(BASE + '/api/cloud/v1/workspaces/' + cloudTeamWorkspace.workspaceId +
        '/members/' + owner.id, {}, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(finalOwner.status, 409);
      assert.strictEqual(JSON.parse(finalOwner.body).error, 'final_owner_required');
    });

    await testAsync('Cloud owner soft deletes only Team workspaces and queues durable purge', async () => {
      const document = await post(BASE + '/api/cloud/v1/documents', {
        project_id: cloudTeamProject.id, filename: 'workspace-delete.md',
        markdown: '# Workspace deletion', idempotency_key: 'workspace-delete-http-document',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(document.status, 201);
      const documentId = JSON.parse(document.body).document.id;
      const personalDelete = await del(BASE + '/api/cloud/v1/workspaces/' + cloudWorkspace.id, {},
        { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(personalDelete.status, 409);
      assert.strictEqual(JSON.parse(personalDelete.body).error, 'personal_workspace_cannot_be_deleted');

      const deleted = await del(BASE + '/api/cloud/v1/workspaces/' + cloudTeamWorkspace.workspaceId, {},
        { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(deleted.status, 200);
      const workspace = JSON.parse(deleted.body).workspace;
      assert.strictEqual(Date.parse(workspace.purge_after) - Date.parse(workspace.deleted_at), 60000);
      const workspaces = JSON.parse((await get(BASE + '/api/cloud/v1/workspaces', {
        Cookie: cloudCookie,
      })).body).workspaces;
      assert.strictEqual(workspaces.some((item) => item.id === cloudTeamWorkspace.workspaceId), false);
      const projects = await get(BASE + '/api/cloud/v1/projects?workspace_id=' + cloudTeamWorkspace.workspaceId,
        { Cookie: cloudCookie });
      assert.strictEqual(projects.status, 404);
      const hiddenDocument = await get(BASE + '/api/cloud/v1/documents/' + documentId,
        { Cookie: cloudCookie });
      assert.strictEqual(hiddenDocument.status, 404);

      const recoverable = await get(BASE + '/api/cloud/v1/workspaces/deleted', {
        Cookie: cloudCookie,
      });
      assert.strictEqual(recoverable.status, 200);
      assert.strictEqual(JSON.parse(recoverable.body).workspaces[0].id, cloudTeamWorkspace.workspaceId);
      const restored = await post(BASE + '/api/cloud/v1/workspaces/' +
        cloudTeamWorkspace.workspaceId + '/restore', {}, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(restored.status, 200);
      assert.strictEqual(JSON.parse(restored.body).workspace.id, cloudTeamWorkspace.workspaceId);
      const visibleDocument = await get(BASE + '/api/cloud/v1/documents/' + documentId,
        { Cookie: cloudCookie });
      assert.strictEqual(visibleDocument.status, 200);
      const deletedAgain = await del(BASE + '/api/cloud/v1/workspaces/' +
        cloudTeamWorkspace.workspaceId, {}, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(deletedAgain.status, 200);

      const Database = require('better-sqlite3');
      const jobs = new Database(testCloudJobsDbPath, { readonly: true });
      const job = jobs.prepare(`
        SELECT type, payload_json, state, available_at_ms FROM cloud_jobs
        WHERE type = 'workspace_purge' ORDER BY created_at_ms DESC LIMIT 1
      `).get();
      jobs.close();
      assert.ok(job);
      assert.strictEqual(JSON.parse(job.payload_json).workspaceId, cloudTeamWorkspace.workspaceId);
      assert.strictEqual(job.state, 'queued');
      assert.ok(job.available_at_ms >= Date.parse(workspace.purge_after));
    });

    await testAsync('CLI device authorization requires browser approval and issues Bearer tokens', async () => {
      const issued = await post(BASE + '/api/cloud/v1/cli/device-authorizations', {
        display_name: 'HTTP test machine',
      });
      assert.strictEqual(issued.status, 201);
      const authorization = JSON.parse(issued.body);
      assert.ok(authorization.verification_uri_complete.includes(authorization.user_code));

      const pending = await post(BASE + '/api/cloud/v1/cli/device-authorizations/token', {
        device_code: authorization.device_code,
      });
      assert.strictEqual(pending.status, 428);
      assert.strictEqual(JSON.parse(pending.body).error, 'authorization_pending');

      const page = await get(BASE + '/cloud/authorize?user_code=' + authorization.user_code,
        { Cookie: cloudCookie });
      assert.strictEqual(page.status, 200);
      assert.ok(page.body.includes('Authorize this CLI'));

      const lookup = await get(BASE + '/api/cloud/v1/cli/device-authorizations/lookup?user_code=' + authorization.user_code,
        { Cookie: cloudCookie });
      assert.strictEqual(JSON.parse(lookup.body).authorization.display_name, 'HTTP test machine');

      const approved = await post(BASE + '/api/cloud/v1/cli/device-authorizations/approve', {
        user_code: authorization.user_code,
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(approved.status, 200);

      const token = await post(BASE + '/api/cloud/v1/cli/device-authorizations/token', {
        device_code: authorization.device_code,
      });
      assert.strictEqual(token.status, 200);
      const credential = JSON.parse(token.body);
      const account = await get(BASE + '/api/cloud/v1/me', {
        Authorization: 'Bearer ' + credential.access_token,
      });
      assert.strictEqual(JSON.parse(account.body).user.email, 'cloud-api@example.com');

      const Database = require('better-sqlite3');
      const authDb = new Database(testCloudAuthDbPath);
      authDb.prepare(`
        DELETE FROM cloud_auth_terms_acceptances
        WHERE user_id = ? AND terms_version = ?
      `).run(JSON.parse(account.body).user.id, CURRENT_TERMS_VERSION);
      authDb.close();
      const blockedExistingCredential = await get(BASE + '/api/cloud/v1/me', {
        Authorization: 'Bearer ' + credential.access_token,
      });
      assert.strictEqual(blockedExistingCredential.status, 403);
      assert.strictEqual(JSON.parse(blockedExistingCredential.body).error,
        'terms_acceptance_required');
      const blockedRefresh = await post(BASE + '/api/cloud/v1/cli/token/refresh', {
        refresh_token: credential.refresh_token,
      });
      assert.strictEqual(blockedRefresh.status, 403);
      assert.strictEqual(JSON.parse(blockedRefresh.body).error, 'terms_acceptance_required');
      assert.strictEqual((await acceptCloudTerms(cloudCookie, '/cloud/admin')).status, 200);

      const refreshed = await post(BASE + '/api/cloud/v1/cli/token/refresh', {
        refresh_token: credential.refresh_token,
      });
      assert.strictEqual(refreshed.status, 200);
      const next = JSON.parse(refreshed.body);
      assert.notStrictEqual(next.refresh_token, credential.refresh_token);
      const oldAccess = await get(BASE + '/api/cloud/v1/me', {
        Authorization: 'Bearer ' + credential.access_token,
      });
      assert.strictEqual(oldAccess.status, 401);
      const newAccess = await get(BASE + '/api/cloud/v1/me', {
        Authorization: 'Bearer ' + next.access_token,
      });
      assert.strictEqual(newAccess.status, 200);
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

    await testAsync('Cloud account API hides projects and manages document access and tags', async () => {
      const accountResponse = await get(BASE + '/api/cloud/v1/account', { Cookie: cloudCookie });
      assert.strictEqual(accountResponse.status, 200);
      const account = JSON.parse(accountResponse.body).account;
      assert.strictEqual(account.id, cloudWorkspace.id);
      assert.strictEqual(account.kind, 'personal');
      assert.strictEqual(Object.hasOwn(account, 'project_id'), false);

      const created = await post(BASE + '/api/cloud/v1/account/documents', {
        account_id: account.id, filename: 'account-ui.md', markdown: '# Account UI',
        idempotency_key: 'http-create-account-ui',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(created.status, 201);
      const body = JSON.parse(created.body);
      assert.strictEqual(body.account.id, account.id);
      assert.strictEqual(body.permission.mode, 'custom');
      assert.deepStrictEqual(body.permission.member_user_ids, [body.permission.owner_user_id]);

      const members = await get(BASE + '/api/cloud/v1/account/members?account_id=' + account.id,
        { Cookie: cloudCookie });
      const currentMember = JSON.parse(members.body).members[0];
      assert.strictEqual(currentMember.is_you, true);
      assert.strictEqual(currentMember.name, 'Ada Lovelace');
      assert.strictEqual(currentMember.initials, 'AL');

      const everyone = await patch(BASE + '/api/cloud/v1/documents/' + body.document.id + '/permission', {
        mode: 'everyone', member_user_ids: [],
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(everyone.status, 200);
      assert.strictEqual(JSON.parse(everyone.body).permission.mode, 'everyone');

      const tagged = await patch(BASE + '/api/cloud/v1/documents/' + body.document.id + '/tags', {
        tags: ['planning', 'cloud'], expected_head_revision_id: body.document.current_revision_id,
        idempotency_key: 'http-tag-account-ui',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(tagged.status, 200);
      assert.deepStrictEqual(JSON.parse(tagged.body).document.tags, ['planning', 'cloud']);
      const tags = await get(BASE + '/api/cloud/v1/account/tags?account_id=' + account.id,
        { Cookie: cloudCookie });
      assert.ok(JSON.parse(tags.body).tags.some((item) => item.tag === 'planning'));
      const groups = await get(BASE + '/api/cloud/v1/account/permission-groups?account_id=' + account.id,
        { Cookie: cloudCookie });
      assert.ok(JSON.parse(groups.body).permission_groups.some((group) =>
        group.document_id === body.document.id && group.mode === 'everyone'));
    });

    await testAsync('Cloud enforces the search allowance and reports the consumed request count', async () => {
      const second = await post(BASE + '/api/cloud/v1/search', { query: 'cluster' },
        { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(second.status, 200);
      const exhausted = await post(BASE + '/api/cloud/v1/search', { query: 'cluster' },
        { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(exhausted.status, 429);
      assert.strictEqual(JSON.parse(exhausted.body).error, 'search_limit_reached');
      const billing = await get(BASE + '/api/cloud/v1/workspaces/' + cloudWorkspace.id + '/billing',
        { Cookie: cloudCookie });
      assert.strictEqual(JSON.parse(billing.body).billing.usage.searchRequestsInWindow, 2);
    });

    await testAsync('Cloud rejects Markdown larger than 10 MB before encryption', async () => {
      const oversized = await post(BASE + '/api/cloud/v1/documents', {
        project_id: cloudProject.id, filename: 'oversized.md',
        markdown: 'x'.repeat(10 * 1024 * 1024 + 1), idempotency_key: 'oversized-http-document',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(oversized.status, 413);
      assert.strictEqual(JSON.parse(oversized.body).error, 'file_too_large');
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

    await testAsync('Cloud API target revisions merge stale writers without a conflict', async () => {
      const created = await post(BASE + '/api/cloud/v1/documents', {
        project_id: cloudProject.id,
        filename: 'target-merge.md',
        markdown: '# Merge plan\n\nOwner: Unassigned\n\nStatus: Draft.',
        idempotency_key: 'http-target-base',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(created.status, 201);
      const targetDocument = JSON.parse(created.body).document;
      const targetRevisionId = targetDocument.current_revision_id;
      const remote = await post(BASE + '/api/cloud/v1/documents/' + targetDocument.id + '/revisions', {
        expected_head_revision_id: targetRevisionId,
        filename: 'target-merge.md',
        markdown: '# Merge plan\n\nOwner: Ada\n\nStatus: Draft.',
        idempotency_key: 'http-target-remote',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(remote.status, 201);
      const remoteDocument = JSON.parse(remote.body).document;

      const merged = await post(BASE + '/api/cloud/v1/documents/' + targetDocument.id + '/revisions', {
        target_revision_id: targetRevisionId,
        filename: 'target-merge.md',
        markdown: '# Merge plan\n\nOwner: Unassigned\n\nStatus: Ready.',
        idempotency_key: 'http-target-merge',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(merged.status, 201);
      const mergedDocument = JSON.parse(merged.body).document;
      assert.strictEqual(mergedDocument.target_revision_id, targetRevisionId);
      assert.strictEqual(mergedDocument.merged_from_revision_id,
        remoteDocument.current_revision_id);
      assert.strictEqual(mergedDocument.merge_classification, 'rebased');
      assert.strictEqual(mergedDocument.merge_retry_count, 0);
      assert.ok(mergedDocument.markdown.includes('Owner: Ada'));
      assert.ok(mergedDocument.markdown.includes('Status: Ready.'));
      const head = await get(BASE + '/api/cloud/v1/documents/' + targetDocument.id + '/head',
        { Cookie: cloudCookie });
      assert.strictEqual(head.status, 200);
      assert.deepStrictEqual(JSON.parse(head.body).document, {
        id: targetDocument.id,
        current_revision_id: mergedDocument.current_revision_id,
        revision_number: mergedDocument.revision_number,
        updated_at: mergedDocument.updated_at,
      });

      const tagged = await patch(BASE + '/api/cloud/v1/documents/' + targetDocument.id + '/tags', {
        target_revision_id: targetRevisionId,
        tags: ['collaboration'],
        idempotency_key: 'http-target-tags',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(tagged.status, 200);
      const taggedDocument = JSON.parse(tagged.body).document;
      assert.strictEqual(taggedDocument.target_revision_id, targetRevisionId);
      assert.ok(taggedDocument.markdown.includes('Owner: Ada'));
      assert.ok(taggedDocument.markdown.includes('Status: Ready.'));
      assert.deepStrictEqual(taggedDocument.tags, ['collaboration']);

      const recovered = await post(BASE + '/api/cloud/v1/documents/' + targetDocument.id +
        '/revisions', {
        target_revision_id: 'pruned-http-target',
        target_markdown: taggedDocument.markdown,
        filename: 'target-merge.md',
        markdown: taggedDocument.markdown + '\nRecovered browser edit.\n',
        idempotency_key: 'http-pruned-target-recovery',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(recovered.status, 201);
      const recoveredDocument = JSON.parse(recovered.body).document;
      assert.strictEqual(recoveredDocument.target_recovered, true);
      assert.strictEqual(recoveredDocument.target_revision_id, 'pruned-http-target');
      assert.ok(recoveredDocument.markdown.includes('Owner: Ada'));
      assert.ok(recoveredDocument.markdown.includes('Recovered browser edit.'));

      const ambiguous = await post(BASE + '/api/cloud/v1/documents/' + targetDocument.id +
        '/revisions', {
        expected_head_revision_id: mergedDocument.current_revision_id,
        target_revision_id: targetRevisionId,
        filename: 'cluster-plan.md', markdown: '# Ambiguous',
        idempotency_key: 'http-ambiguous-revision-save',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(ambiguous.status, 400);
      assert.strictEqual(JSON.parse(ambiguous.body).error, 'invalid_request');

      const ambiguousTags = await patch(BASE + '/api/cloud/v1/documents/' + targetDocument.id +
        '/tags', {
        expected_head_revision_id: taggedDocument.current_revision_id,
        target_revision_id: targetRevisionId,
        tags: ['ambiguous'], idempotency_key: 'http-ambiguous-tag-save',
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(ambiguousTags.status, 400);
      assert.strictEqual(JSON.parse(ambiguousTags.body).error, 'invalid_request');
    });

    await testAsync('Cloud document cursors paginate deterministically and are filter-scoped', async () => {
      for (let number = 1; number <= 2; number += 1) {
        const created = await post(BASE + '/api/cloud/v1/documents', {
          project_id: cloudProject.id,
          filename: 'pagination-' + number + '.md',
          markdown: '# Pagination ' + number,
          idempotency_key: 'http-pagination-' + number,
        }, { Origin: BASE, Cookie: cloudCookie });
        assert.strictEqual(created.status, 201);
      }
      const first = await get(BASE + '/api/cloud/v1/documents?project_id=' +
        encodeURIComponent(cloudProject.id) + '&limit=1', { Cookie: cloudCookie });
      const firstBody = JSON.parse(first.body);
      assert.strictEqual(firstBody.documents.length, 1);
      assert.strictEqual(typeof firstBody.next_cursor, 'string');
      const second = await get(BASE + '/api/cloud/v1/documents?project_id=' +
        encodeURIComponent(cloudProject.id) + '&limit=1&cursor=' + encodeURIComponent(firstBody.next_cursor),
      { Cookie: cloudCookie });
      const secondBody = JSON.parse(second.body);
      assert.strictEqual(secondBody.documents.length, 1);
      assert.notStrictEqual(secondBody.documents[0].id, firstBody.documents[0].id);
      const wrongScope = await get(BASE + '/api/cloud/v1/documents?limit=1&cursor=' +
        encodeURIComponent(firstBody.next_cursor), { Cookie: cloudCookie });
      assert.strictEqual(wrongScope.status, 400);
      assert.strictEqual(JSON.parse(wrongScope.body).error, 'invalid_request');
    });

    await testAsync('Cloud API restores an old revision as a new head', async () => {
      const firstHistory = await get(BASE + '/api/cloud/v1/documents/' + cloudDocument.id +
        '/revisions?limit=1',
        { Cookie: cloudCookie });
      const firstHistoryBody = JSON.parse(firstHistory.body);
      assert.strictEqual(firstHistoryBody.revisions.length, 1);
      assert.strictEqual(typeof firstHistoryBody.next_cursor, 'string');
      const nextHistory = await get(BASE + '/api/cloud/v1/documents/' + cloudDocument.id +
        '/revisions?limit=1&cursor=' + encodeURIComponent(firstHistoryBody.next_cursor),
      { Cookie: cloudCookie });
      const revisions = firstHistoryBody.revisions.concat(JSON.parse(nextHistory.body).revisions);
      assert.strictEqual(revisions.length, 2);
      const oldest = revisions.find((revision) => revision.revision_number === 1);
      const restored = await post(BASE + '/api/cloud/v1/documents/' + cloudDocument.id +
        '/revisions/' + oldest.id + '/restore', {
          expected_head_revision_id: cloudDocument.current_revision_id,
          idempotency_key: 'http-restore-cluster-plan',
        }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(restored.status, 201);
      cloudDocument = JSON.parse(restored.body).document;
      assert.strictEqual(cloudDocument.revision_number, 3);
      assert.ok(cloudDocument.markdown.includes('Kubernetes'));
    });

    await testAsync('Cloud document deletion uses the configured recovery window', async () => {
      const created = await post(BASE + '/api/cloud/v1/documents', {
        project_id: cloudProject.id, filename: 'recoverable.md', markdown: '# Recoverable',
        idempotency_key: 'http-create-recoverable',
      }, { Origin: BASE, Cookie: cloudCookie });
      const recoverable = JSON.parse(created.body).document;
      const deleted = await del(BASE + '/api/cloud/v1/documents/' + recoverable.id, {
        expected_head_revision_id: recoverable.current_revision_id,
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(deleted.status, 200);
      const deletion = JSON.parse(deleted.body).document;
      assert.strictEqual(Date.parse(deletion.purge_after) - Date.parse(deletion.deleted_at), 60000);
      const restored = await post(BASE + '/api/cloud/v1/documents/' + recoverable.id + '/restore', {
        expected_head_revision_id: recoverable.current_revision_id,
      }, { Origin: BASE, Cookie: cloudCookie });
      assert.strictEqual(restored.status, 200);
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
      assert.ok(r.body.includes('SmallDocs - Library'),
                '/library should serve the library shell');
      assert.ok(/connect-src[^;]*localhost/.test(r.headers['content-security-policy'] || ''),
                'CSP must allow connect-src to localhost so the page can reach the local agent');
      assert.ok(r.body.includes('href="/library?scope=cloud"'));
      assert.ok(r.body.includes('/public/library/cloud-library-prototype.css'));
      assert.ok(r.body.includes('/public/library/cloud-library-prototype.js'));
      assert.ok(r.body.includes('/public/library/library-mobile.js'));
      assert.ok(!r.body.includes('cloud-demo=1'));
    });

    await testAsync('GET /connect links back to Cloud Library when Cloud is public', async () => {
      const r = await get(BASE + '/connect');
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.includes('class="library-scope connect-library-scope"'));
      assert.ok(r.body.includes('href="/library" aria-current="page"'));
      assert.ok(r.body.includes('href="/library?scope=cloud"'));
      assert.ok(!r.body.includes('__CLOUD_CONNECT_LIBRARY_SWITCHER__'));
    });

    await testAsync('asset-versioning: /library is versioned', async () => {
      const v = JSON.parse((await get(BASE + '/version-check')).body).version;
      await assertEveryAssetVersioned('/library', v);
    });

    await testAsync('asset-versioning: /agent-changes is versioned', async () => {
      const v = JSON.parse((await get(BASE + '/version-check')).body).version;
      await assertEveryAssetVersioned('/agent-changes', v);
    });

    await testAsync('asset-versioning: /advanced-spreadsheets is versioned', async () => {
      const v = JSON.parse((await get(BASE + '/version-check')).body).version;
      await assertEveryAssetVersioned('/advanced-spreadsheets', v);
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

    cloudBilling.close();
    await testAsync('SIGTERM drains and exits without reaching the hard deadline', async () => {
      const stopped = new Promise((resolve) => server.once('exit', resolve));
      server.kill('SIGTERM');
      await Promise.race([
        stopped,
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('server did not exit within two seconds')), 2000)),
      ]);
    });

    await testAsync('hidden Cloud public mode omits UI assets and returns 404 for Cloud routes', async () => {
      const hiddenPort = await availableLoopbackPort();
      const hiddenBase = 'http://localhost:' + hiddenPort;
      const hiddenServer = spawn('node', [path.join(__dirname, '..', 'server.js')], {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          HOST: '127.0.0.1',
          PORT: String(hiddenPort),
          NODE_ENV: 'test',
          CLOUD_MODE: 'off',
          CLOUD_PUBLIC_MODE: 'hidden',
          SHORT_LINKS_DB: testShortLinksDbPath,
          TEAMS_DB: testTeamsDbPath,
          FEEDBACK_DB: testDbPath,
        },
        stdio: 'pipe',
      });
      try {
        await new Promise((resolve, reject) => {
          let ready = false;
          hiddenServer.stdout.on('data', data => {
            if (!ready && data.toString().includes('running at')) {
              ready = true;
              resolve();
            }
          });
          hiddenServer.stderr.on('data', data => {
            if (!ready) reject(new Error('hidden server stderr: ' + data.toString()));
          });
          setTimeout(() => {
            if (!ready) reject(new Error('hidden server did not start in time'));
          }, 3000);
        });

        const docs = await get(hiddenBase + '/docs');
        assert.strictEqual(docs.status, 200);
        assert.ok(!docs.body.includes('/public/css/cloud-prototype.css'));
        assert.ok(!docs.body.includes('/public/css/cloud-ui-lab.css'));
        assert.ok(!docs.body.includes('/public/sdocs-cloud-prototype.js'));
        assert.ok(!docs.body.includes('/public/sdocs-cloud-ui-lab.js'));

        const home = await get(hiddenBase + '/');
        assert.strictEqual(home.status, 200);
        assert.ok(!home.body.includes('href="/cloud/sign-in?return=%2Flibrary%3Fscope%3Dcloud"'));
        assert.ok(!home.body.includes('class="btn-gh nav-cloud" href="/cloud"'));
        assert.ok(home.body.includes('id="site-menu"'));
        assert.ok(home.body.includes('class="btn-gh nav-library-wide" href="/library"'));
        assert.ok(home.body.includes('class="nav-menu-mobile-only" href="/library"'));

        const library = await get(hiddenBase + '/library');
        assert.strictEqual(library.status, 200);
        assert.ok(!library.body.includes('/public/library/cloud-library-prototype.css'));
        assert.ok(!library.body.includes('/public/library/cloud-library-prototype.js'));
        const cloudLibrary = await get(hiddenBase + '/library?scope=cloud');
        assert.strictEqual(cloudLibrary.status, 302);
        assert.strictEqual(cloudLibrary.headers.location, '/library');

        const connect = await get(hiddenBase + '/connect');
        assert.strictEqual(connect.status, 200);
        assert.ok(!connect.body.includes('save to SmallDocs Cloud'));
        assert.ok(!connect.body.includes('<nav class="library-scope connect-library-scope"'));
        assert.ok(!connect.body.includes('href="/library?scope=cloud"'));
        assert.strictEqual((await get(hiddenBase + '/docs?cloud-document=hidden')).status, 404);

        const page = await get(hiddenBase + '/cloud');
        assert.strictEqual(page.status, 404);
        assert.strictEqual(page.headers['cache-control'], 'no-store');
        assert.strictEqual((await get(hiddenBase + '/cloud/sign-in')).status, 404);

        const api = await get(hiddenBase + '/api/cloud/v1/workspaces');
        assert.strictEqual(api.status, 404);
        assert.deepStrictEqual(JSON.parse(api.body), { error: 'not_found' });
        const auth = await post(hiddenBase + '/api/cloud/auth/email/request', {
          email: 'person@example.com',
        });
        assert.strictEqual(auth.status, 404);
        assert.deepStrictEqual(JSON.parse(auth.body), { error: 'not_found' });
      } finally {
        const stopped = new Promise((resolve) => hiddenServer.once('exit', resolve));
        hiddenServer.kill('SIGTERM');
        await Promise.race([
          stopped,
          new Promise((_, reject) => setTimeout(
            () => reject(new Error('hidden server did not exit within two seconds')), 2000)),
        ]);
      }
    });
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
    try { fs.unlinkSync(testCloudBillingDbPath); } catch (_) {}
    try { fs.unlinkSync(testCloudBillingDbPath + '-wal'); } catch (_) {}
    try { fs.unlinkSync(testCloudBillingDbPath + '-shm'); } catch (_) {}
    try { fs.unlinkSync(testCloudJobsDbPath); } catch (_) {}
    try { fs.unlinkSync(testCloudJobsDbPath + '-wal'); } catch (_) {}
    try { fs.unlinkSync(testCloudJobsDbPath + '-shm'); } catch (_) {}
  };
};
