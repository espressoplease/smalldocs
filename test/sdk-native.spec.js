// @ts-check
const { test, expect } = require('@playwright/test');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let customerServer;
let customerOrigin;
let sdocsServer;
let sdocsOrigin;

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function contentType(filename) {
  if (filename.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filename.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filename.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

async function downloadBytes(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test.beforeAll(async () => {
  const sdocsPort = await availablePort();
  sdocsOrigin = 'http://127.0.0.1:' + sdocsPort;
  sdocsServer = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, {
      HOST: '127.0.0.1',
      PORT: String(sdocsPort),
      NODE_ENV: 'test',
      ANALYTICS_ENABLED: '0',
      CLOUD_PUBLIC_MODE: 'hidden',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('SmallDocs test server did not start: ' + output)), 5000);
    sdocsServer.once('error', reject);
    sdocsServer.stdout.on('data', chunk => {
      output += chunk.toString();
      if (!output.includes('running at')) return;
      clearTimeout(timer);
      resolve();
    });
    sdocsServer.stderr.on('data', chunk => { output += chunk.toString(); });
  });

  const fixtureRoot = path.join(__dirname, 'fixtures', 'sdk-native');
  customerServer = http.createServer((req, res) => {
    const requested = decodeURIComponent((req.url || '/').split('?')[0]);
    if (requested === '/plain') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`<!doctype html>
<html><body><div id="report"></div><script type="module">
import { render } from '${sdocsOrigin}/sdk/0.2.0/smalldocs.js';
window.view = await render('#report', '# Plain report\\n\\nThis document uses ordinary Markdown only.');
document.body.dataset.ready = 'true';
</script></body></html>`);
      return;
    }
    if (requested === '/prose') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      const proseMarkdown = [
        '| Name | Notes |',
        '|---|---|',
        '| Ada | Hello, world |',
        '| Grace | Said "yes" |',
        '',
        '> First paragraph.',
        '>',
        '> Second paragraph.',
      ].join('\n');
      res.end(`<!doctype html><html><head><style>
#left .sdoc-reader{--md-table-header-bg:#dbeafe;--md-bq-bg:#fef3c7}
#left .table-copy-btn{border-radius:11px;background:rgb(236,253,245)}
</style></head><body>
<div id="outside"><table><tbody><tr><td>Host table</td></tr></tbody></table><blockquote class="sdoc-copyable-quote">Host quote<button class="quote-copy-btn">Host</button></blockquote></div>
<div id="left"></div><div id="right"></div>
<script>
window.sdocsCopiedText='';window.sdocsCopiedPng=null;
window.ClipboardItem=function(parts){this.parts=parts};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
  writeText:async value=>{window.sdocsCopiedText=String(value)},
  write:async items=>{window.sdocsCopiedPng=items[0].parts['image/png']}
}});
</script>
<script type="module">import { render } from '${sdocsOrigin}/sdk/0.2.0/smalldocs.js';
const [leftView,rightView]=await Promise.all([
  render('#left',${JSON.stringify(proseMarkdown)}),
  render('#right',${JSON.stringify(proseMarkdown)},{controls:{copy:false}})
]);
window.updateProse=()=>leftView.update('| Updated | Value |\\n|---|---|\\n| Yes | 2 |\\n\\n> Updated quote');
window.destroyProse=()=>leftView.destroy();
window.proseViews={leftView,rightView};
document.body.dataset.ready='true';</script></body></html>`);
      return;
    }
    if (requested === '/reader-options') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      const readerMarkdown = `# Reader options

Introductory paragraph with a [reference](https://example.com).

Costs stay near ~5 dollars and ~10 cents. This is ~~withdrawn~~.

## Evidence

- First item
- Second item

### Details

Nested detail.

## Evidence

Second section.`;
      res.end(`<!doctype html><html><head><style>
#closed .sdoc-reader {
  --sdocs-font-family: Georgia, serif;
  --sdocs-font-size: 18px;
  --sdocs-line-height: 1.9;
  --sdocs-heading-font-family: "Courier New", monospace;
  --sdocs-heading-scale: 1.1;
  --sdocs-paragraph-spacing: 23px;
  --sdocs-list-indent: 37px;
  --sdocs-link-decoration: none;
}
</style></head><body>
<h2 id="host-heading">Host heading</h2>
<div id="closed"></div><div id="open"></div><div id="static"></div>
<script>
window.sdocsCopiedText='';
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
  writeText:async value=>{window.sdocsCopiedText=String(value)}
}});
</script>
<script type="module">import { render } from '${sdocsOrigin}/sdk/0.2.0/smalldocs.js';
const markdown=${JSON.stringify(readerMarkdown)};
const changedMarkdown='# Changed document\\n\\n## New section\\n\\nNew content.';
const [closedView,openView,staticView]=await Promise.all([
  render('#closed',markdown,{navigation:true,sections:{collapsible:true,defaultOpen:false}}),
  render('#open',markdown,{navigation:false,sections:{collapsible:true,defaultOpen:true},controls:{copy:false}}),
  render('#static',markdown,{navigation:false,sections:{collapsible:false},controls:{copy:false}})
]);
window.readerViews={closedView,openView,staticView};
window.updateClosed=()=>closedView.update(markdown);
window.updateOpen=()=>openView.update(markdown);
window.changeOpen=()=>openView.update(changedMarkdown);
document.body.dataset.ready='true';</script></body></html>`);
      return;
    }
    if (requested === '/cells-isolation') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      const left = `---\ncells-tabs: tabbed\n---\n# Left\n\n~~~cells plan/Inputs\nMetric,Value\nUnits,12\nRate,25\n~~~\n\n~~~cells plan/Summary\nformat: B=$\nMetric,Value\nRevenue,=Inputs!B2*Inputs!B3\n~~~`;
      const right = `# Right\n\n~~~cells plan/Inputs\nMetric,Value\nUnits,4\nRate,10\n~~~\n\n~~~cells plan/Summary\nMetric,Value\nRevenue,=Inputs!B2*Inputs!B3\n~~~`;
      const update = `# Left updated\n\n~~~cells\nMetric,Value\nUnits,9\n~~~`;
      res.end(`<!doctype html><html><head><style>#left{--sdocs-text-color:#123456;--sdocs-background:#fef3c7}#right .sdoc-cells-cell{color:#7c2d12;background:#dbeafe}</style></head><body><div id="outside" class="sdoc-cells-cell">Host content</div><button id="outside-fx" class="sdoc-cells-fx-toggle">Host button</button><div id="future-sdk" class="smalldocs-sdk-view" data-smalldocs-sdk-version="9.9.9"><div class="sdoc-cells-cell">Future SDK content</div></div><div id="left"></div><div id="right"></div>
<script>window.sdocsCopiedText='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.sdocsCopiedText=String(value)}}});window.sdocsActiveResizeObservers=0;const NativeResizeObserver=window.ResizeObserver;window.ResizeObserver=class{constructor(callback){this.inner=new NativeResizeObserver(callback);this.active=true;window.sdocsActiveResizeObservers+=1}observe(target){this.inner.observe(target)}unobserve(target){this.inner.unobserve(target)}disconnect(){if(this.active){this.active=false;window.sdocsActiveResizeObservers-=1}this.inner.disconnect()}};</script>
<script type="module">import { render } from '${sdocsOrigin}/sdk/0.2.0/smalldocs.js';
const [leftView, rightView] = await Promise.all([
  render('#left', ${JSON.stringify(left)}), render('#right', ${JSON.stringify(right)})
]);
window.updateLeft = () => leftView.update(${JSON.stringify(update)});
window.oversizeRight = () => rightView.update('# Oversized\\n\\n~~~cells\\n' + 'x'.repeat(256 * 1024 + 1) + '\\n~~~');
window.destroyLeft = () => leftView.destroy();
window.destroyRight = () => rightView.destroy();
document.body.dataset.ready = 'true';</script></body></html>`);
      return;
    }
    if (requested === '/cells-disabled') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      const disabledMarkdown = '# No fullscreen\n\n~~~cells\nMetric,Value\nUnits,9\n~~~';
      res.end(`<!doctype html><html><body><div id="report"></div><script type="module">
import { render } from '${sdocsOrigin}/sdk/0.2.0/smalldocs.js';
window.disabledView = await render('#report', ${JSON.stringify(disabledMarkdown)}, { controls: { fullscreen: false } });
document.body.dataset.ready = 'true';</script></body></html>`);
      return;
    }
    if (requested === '/cells-download-only') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      const downloadOnlyMarkdown = '# Download only\n\n~~~cells report.csv\nMetric,Value\nUnits,9\n~~~';
      res.end(`<!doctype html><html><body><div id="report"></div><script type="module">
import { render } from '${sdocsOrigin}/sdk/0.2.0/smalldocs.js';
window.downloadOnlyView = await render('#report', ${JSON.stringify(downloadOnlyMarkdown)}, {
  controls: { copy: false, download: true, fullscreen: true }
});
document.body.dataset.ready = 'true';</script></body></html>`);
      return;
    }
    if (requested === '/trusted-types') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': `default-src 'self'; script-src 'self' ${sdocsOrigin} https://cdn.jsdelivr.net; style-src ${sdocsOrigin} https://cdn.jsdelivr.net 'unsafe-inline'; font-src https://cdn.jsdelivr.net; frame-src ${sdocsOrigin}; img-src https: data: blob:; trusted-types smalldocs-sdk-0.2.0 dompurify; require-trusted-types-for 'script'`,
      });
      res.end('<!doctype html><html><body><div id="report"></div><script type="module" src="/trusted-types.js"></script></body></html>');
      return;
    }
    if (requested === '/trusted-types.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      const trustedMarkdown = `# Trusted rich document

<button id="probe" onclick="window.compromised=true">Safe</button><script>window.compromised=true</script>

Inline math: $\\frac{x^2}{y+1}$

| Trusted | Table |
|---|---|
| Safe | 42 |

> Trusted quote

~~~javascript
export function trustedCode() {
  return 42;
}
~~~

~~~mermaid
flowchart LR
  A[Input] --> B[Result]
~~~

~~~cells trusted/Summary
Metric,Value
Result,=20+22
~~~

~~~~slide
grid 16 9 bg=#ffffff
r 0.8 0.8 6.6 2.2 fill=#eef2ff color=#111827 |
  Nested math: $z^2$
r 0.8 3.5 14.4 4.5 fill=#ffffff stroke=#cbd5e1 |
  ~~~mermaid
  flowchart LR
    C[Question] --> D[Answer]
  ~~~
~~~~`;
      res.end(`import { render } from '${sdocsOrigin}/sdk/0.2.0/smalldocs.js';
await render('#report', ${JSON.stringify(trustedMarkdown)});
document.body.dataset.ready = 'true';`);
      return;
    }
    if (requested === '/host-globals') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`<!doctype html><html><body><div id="report"></div>
<script>window.DOMPurify={sanitize:value=>value,setConfig:()=>{}};window.marked={parse:value=>value};</script>
<script type="module">import { render } from '${sdocsOrigin}/sdk/0.2.0/smalldocs.js';
await render('#report', '# Private runtime\\n\\n<button id="probe" onclick="window.compromised=true">Safe</button><script>window.compromised=true<\\/script>');
document.body.dataset.ready = 'true';</script></body></html>`);
      return;
    }
    const match = /^\/(editorial-report|operations-console|board-brief)(\/.*)?$/.exec(requested);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    const relative = !match[2] || match[2] === '/' ? 'index.html' : match[2].slice(1);
    const filename = path.resolve(fixtureRoot, match[1], relative);
    if (!filename.startsWith(path.resolve(fixtureRoot, match[1]) + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    fs.readFile(filename, 'utf8', (error, source) => {
      if (error) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType(filename), 'Cache-Control': 'no-store' });
      res.end(source.replaceAll('__SDOCS_ORIGIN__', sdocsOrigin));
    });
  });
  await new Promise((resolve, reject) => {
    customerServer.once('error', reject);
    customerServer.listen(0, '127.0.0.1', resolve);
  });
  customerOrigin = 'http://127.0.0.1:' + customerServer.address().port;
});

test.afterAll(async () => {
  if (customerServer) await new Promise(resolve => customerServer.close(resolve));
  if (sdocsServer && sdocsServer.exitCode == null) {
    sdocsServer.kill('SIGTERM');
    await new Promise(resolve => sdocsServer.once('exit', resolve));
  }
});

test('plain Markdown does not request rich feature modules or CDN dependencies', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto(customerOrigin + '/plain');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.smalldocs-document')).toContainText('ordinary Markdown only');
  expect(requests.some(url => url.includes('/sdk/0.2.0/features/'))).toBe(false);
  expect(requests.some(url => url.startsWith('https://cdn.jsdelivr.net/'))).toBe(false);
});

test('canonical tables and blockquotes render in a clean customer page', async ({ page }) => {
  await page.goto(customerOrigin + '/prose');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#left .md-table-scroll')).toHaveCount(1);
  await expect(page.locator('#left .md-table-toolbar')).toHaveCount(1);
  await expect(page.locator('#left .table-copy-btn')).toHaveCount(2);
  await expect(page.locator('#left .table-copy-csv-btn')).toHaveAttribute('aria-label', 'Copy table as CSV');
  await expect(page.locator('#left .table-copy-png-btn')).toHaveAttribute('aria-label', 'Copy table as PNG');
  await expect(page.locator('#left blockquote.sdoc-copyable-quote .quote-copy-btn')).toHaveCount(1);
  await expect(page.locator('#left th').first()).toHaveCSS('background-color', 'rgb(219, 234, 254)');
  await expect(page.locator('#left blockquote')).toHaveCSS('background-color', 'rgb(254, 243, 199)');
  await expect(page.locator('#left .table-copy-csv-btn')).toHaveCSS('border-radius', '11px');
  await expect(page.locator('#left .table-copy-csv-btn')).toHaveCSS('background-color', 'rgb(236, 253, 245)');

  await expect(page.locator('#right .md-table-scroll')).toHaveCount(1);
  await expect(page.locator('#right .md-table-toolbar')).toHaveCount(0);
  await expect(page.locator('#right .quote-copy-btn')).toHaveCount(0);
  await expect(page.locator('#outside .md-table-scroll')).toHaveCount(0);
  await expect(page.locator('#outside .quote-copy-btn')).toHaveCSS('position', 'static');
});

test('canonical prose copy actions preserve text and produce a rendered PNG', async ({ page }) => {
  await page.goto(customerOrigin + '/prose');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  await page.locator('#left .table-copy-csv-btn').click();
  await expect.poll(() => page.evaluate(() => window.sdocsCopiedText)).toBe(
    'Name,Notes\nAda,"Hello, world"\nGrace,"Said ""yes"""'
  );
  await expect(page.locator('#left .table-copy-csv-btn polyline')).toHaveCount(1);

  await page.locator('#left .quote-copy-btn').click();
  await expect.poll(() => page.evaluate(() => window.sdocsCopiedText))
    .toBe('First paragraph.\n\nSecond paragraph.');
  await expect(page.locator('#left .quote-copy-btn polyline')).toHaveCount(1);

  await page.locator('#left .table-copy-png-btn').click();
  await expect.poll(() => page.evaluate(() => ({
    type: window.sdocsCopiedPng && window.sdocsCopiedPng.type,
    size: window.sdocsCopiedPng && window.sdocsCopiedPng.size,
  }))).toEqual({ type: 'image/png', size: expect.any(Number) });
  expect(await page.evaluate(() => window.sdocsCopiedPng.size)).toBeGreaterThan(0);
});

test('canonical prose lifecycle replaces and destroys only its own instance', async ({ page }) => {
  await page.goto(customerOrigin + '/prose');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => window.updateProse());
  await expect(page.locator('#left table')).toContainText('Updated');
  await expect(page.locator('#left .md-table-scroll')).toHaveCount(1);
  await expect(page.locator('#left .md-table-toolbar')).toHaveCount(1);
  await expect(page.locator('#right table')).toContainText('Ada');
  await expect(page.locator('#right .md-table-scroll')).toHaveCount(1);
  await page.evaluate(() => window.destroyProse());
  await expect(page.locator('#left .smalldocs-sdk-view')).toHaveCount(0);
  await expect(page.locator('#right .smalldocs-sdk-view')).toHaveCount(1);
});

test('reader behavior options stay instance-owned and preserve open sections on update', async ({ page }) => {
  await page.goto(customerOrigin + '/reader-options');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  await expect(page.locator('#closed .smalldocs-navigation')).toBeVisible();
  await expect(page.locator('#open .smalldocs-navigation')).toBeHidden();
  await expect(page.locator('#static .smalldocs-navigation')).toBeHidden();

  await expect(page.locator('#closed .md-section-body').first()).not.toHaveClass(/\bopen\b/);
  await expect(page.locator('#open .md-section-body')).toHaveCount(3);
  await expect(page.locator('#open .md-section-body:not(.open)')).toHaveCount(0);
  await expect(page.locator('#static .md-section')).toHaveCount(0);
  await expect(page.locator('#static .section-toggle')).toHaveCount(0);
  await expect(page.locator('#static')).toContainText('Nested detail.');

  await page.locator('#closed .smalldocs-navigation a', { hasText: 'Details' }).click();
  const openState = await page.locator('#closed h3', { hasText: 'Details' }).evaluate((heading) => {
    const own = heading.closest('.md-section');
    const parent = own && own.parentElement && own.parentElement.closest('.md-section');
    return {
      own: own && own.querySelector(':scope > .md-section-body').classList.contains('open'),
      parent: parent && parent.querySelector(':scope > .md-section-body').classList.contains('open'),
    };
  });
  expect(openState).toEqual({ own: true, parent: true });

  await page.evaluate(() => window.updateClosed());
  await expect(page.locator('#closed h3', { hasText: 'Details' })).toBeVisible();
  const updatedState = await page.locator('#closed h3', { hasText: 'Details' }).evaluate((heading) => {
    const own = heading.closest('.md-section');
    const parent = own && own.parentElement && own.parentElement.closest('.md-section');
    return {
      own: own && own.querySelector(':scope > .md-section-body').classList.contains('open'),
      parent: parent && parent.querySelector(':scope > .md-section-body').classList.contains('open'),
    };
  });
  expect(updatedState).toEqual({ own: true, parent: true });
  await expect(page.locator('#open .md-section-body:not(.open)')).toHaveCount(0);

  await page.locator('#open h2').first().click();
  await expect(page.locator('#open .md-section-body').first()).not.toHaveClass(/\bopen\b/);
  await page.evaluate(() => window.updateOpen());
  await expect(page.locator('#open .md-section-body').first()).not.toHaveClass(/\bopen\b/);
  await expect(page.locator('#closed h3', { hasText: 'Details' })).toBeVisible();

  await page.evaluate(() => window.changeOpen());
  await expect(page.locator('#open h2', { hasText: 'New section' })).toBeVisible();
  await expect(page.locator('#open .md-section-body').first()).toHaveClass(/\bopen\b/);
  await page.evaluate(() => window.updateOpen());
  await expect(page.locator('#open h2').first()).toBeVisible();
  await expect(page.locator('#open .md-section-body:not(.open)')).toHaveCount(0);
});

test('reader typography, heading IDs and copy controls follow the public contract', async ({ page }) => {
  await page.goto(customerOrigin + '/reader-options');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  const closed = page.locator('#closed .sdoc-reader');
  await expect(closed).toHaveCSS('font-family', /Georgia/);
  await expect(closed).toHaveCSS('font-size', '18px');
  await expect(closed).toHaveCSS('line-height', '34.2px');
  await expect(page.locator('#closed h2').first()).toHaveCSS('font-family', /Courier New/);
  await expect(page.locator('#closed p').first()).toHaveCSS('margin-bottom', '23px');
  await expect(page.locator('#closed ul')).toHaveCSS('padding-left', '37px');
  await expect(page.locator('#closed a[href="https://example.com"]')).toHaveCSS('text-decoration-line', 'none');
  await expect(page.locator('#closed del')).toHaveText('withdrawn');
  await expect(page.locator('#closed p').nth(1)).toContainText('~5 dollars and ~10 cents');
  await expect(page.locator('#closed p').nth(1).locator('del')).toHaveCount(1);
  await expect(page.locator('#host-heading')).not.toHaveCSS('font-family', /Courier New/);

  const closedIds = await page.locator('#closed h2').evaluateAll((headings) => headings.map((heading) => heading.id));
  const openIds = await page.locator('#open h2').evaluateAll((headings) => headings.map((heading) => heading.id));
  expect(closedIds[0]).toMatch(/--evidence$/);
  expect(closedIds[1]).toMatch(/--evidence-1$/);
  expect(openIds[0]).not.toBe(closedIds[0]);

  await expect(page.locator('#closed .header-anchor')).toHaveCount(4);
  await expect(page.locator('#closed .header-copy-btn')).toHaveCount(4);
  await expect(page.locator('#open .header-anchor, #open .header-copy-btn')).toHaveCount(0);
  await expect(page.locator('#static .header-anchor, #static .header-copy-btn')).toHaveCount(0);

  await page.locator('#closed h2').first().locator('.header-copy-btn').click();
  await expect.poll(() => page.evaluate(() => window.sdocsCopiedText)).toBe(
    '## Evidence\n\n- First item\n- Second item\n\n### Details\n\nNested detail.'
  );
  await page.locator('#closed h2').first().locator('.header-anchor').click();
  await expect.poll(() => page.evaluate(() => window.sdocsCopiedText)).toMatch(/#sdocs-[a-z0-9]+--evidence$/);
});

test('canonical spreadsheet instances keep workbook state and lifecycle isolated', async ({ page }) => {
  await page.goto(customerOrigin + '/cells-isolation');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.sdoc-cells-grid')).toHaveCount(4);
  await expect(page.locator('.smalldocs-cells-table')).toHaveCount(0);
  await expect(page.locator('#smalldocs-sdk-cells-styles')).toHaveCount(1);
  await expect(page.locator('#left .sdoc-cells-cell').first()).toHaveCSS('color', 'rgb(18, 52, 86)');
  await expect(page.locator('#left .sdoc-cells-cell').first()).toHaveCSS('background-color', 'rgb(254, 243, 199)');
  await expect(page.locator('#right .sdoc-cells-cell').first()).toHaveCSS('color', 'rgb(124, 45, 18)');
  await expect(page.locator('#right .sdoc-cells-cell').first()).toHaveCSS('background-color', 'rgb(219, 234, 254)');
  await expect(page.locator('#outside')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('#outside')).toHaveCSS('display', 'block');
  await expect(page.locator('#outside-fx')).toHaveCSS('display', 'inline-block');
  await expect(page.locator('#left .smalldocs-sdk-view')).toHaveAttribute('data-smalldocs-sdk-version', '0.2.0');
  await expect(page.locator('#right .smalldocs-sdk-view')).toHaveAttribute('data-smalldocs-sdk-version', '0.2.0');
  await expect(page.locator('#future-sdk .sdoc-cells-cell')).toHaveCSS('display', 'block');
  await expect(page.locator('#future-sdk .sdoc-cells-cell')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const initialObservers = await page.evaluate(() => window.sdocsActiveResizeObservers);
  expect(initialObservers).toBeGreaterThan(0);

  const resizeHandle = page.locator('#left .sdoc-cells-resize').first();
  await resizeHandle.hover();
  await page.mouse.down();
  await expect(page.locator('body')).not.toHaveClass(/sdoc-cells-resizing/);
  await expect(page.locator('#left .smalldocs-sdk-view')).toHaveClass(/sdoc-cells-resizing/);
  await page.mouse.up();

  await page.locator('#left').getByRole('tab', { name: 'Summary' }).click();
  await expect(page.locator('#left .sdoc-cells:visible .sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('$300.00');
  await expect(page.locator('#right .sdoc-cells').nth(1).locator('.sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('40');

  await page.evaluate(() => window.updateLeft());
  await expect(page.locator('#left h1')).toHaveText('Left updated');
  await expect(page.locator('#left .sdoc-cells-grid')).toHaveCount(1);
  await expect(page.locator('#right .sdoc-cells-grid')).toHaveCount(2);
  await expect(page.locator('#right .sdoc-cells').nth(1).locator('.sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('40');
  const afterUpdateObservers = await page.evaluate(() => window.sdocsActiveResizeObservers);
  expect(afterUpdateObservers).toBeLessThan(initialObservers);

  await page.evaluate(() => window.destroyLeft());
  await expect(page.locator('#left .smalldocs-document')).toHaveCount(0);
  await expect(page.locator('#right .sdoc-cells-grid')).toHaveCount(2);
  expect(await page.evaluate(() => window.sdocsActiveResizeObservers)).toBeLessThan(afterUpdateObservers);

  await page.evaluate(() => window.oversizeRight());
  await expect(page.locator('#right .sdoc-cells-error')).toContainText('Cells source exceeds 256 KB cap');
});

test('canonical spreadsheet fullscreen loads on demand and keeps edit lifecycle instance-owned', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto(customerOrigin + '/cells-isolation');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  expect(requests.some(url => url.includes('sdocs-cells-edit.js'))).toBe(false);
  expect(requests.some(url => url.includes('sdocs-cells-focus.js'))).toBe(false);

  await page.locator('#left .sdoc-cells:visible').getByRole('button', { name: 'Open fullscreen' }).click();
  const focus = page.locator('.sdoc-cells-focus');
  await expect(focus).toBeVisible();
  await expect(focus).toHaveAttribute('data-smalldocs-sdk-version', '0.2.0');
  await expect(focus).toHaveAttribute('role', 'dialog');
  await expect(focus.locator('.sdoc-cells-focus-topbar')).toBeVisible();
  await expect(focus.locator('.sdoc-cells-focus-topbar')).toHaveCSS('display', 'flex');
  await expect(focus.locator('.sdoc-cells-focus-tab')).toHaveText(['Inputs', 'Summary']);
  expect(requests.some(url => url.includes('sdocs-cells-edit.js'))).toBe(true);
  expect(requests.some(url => url.includes('sdocs-cells-focus.js'))).toBe(true);

  // A second reader supersedes the first through the shared overlay lease,
  // while retaining its own workbook and editor instance.
  await page.evaluate(() => document.querySelector('#right .sdoc-cells-expand').click());
  await expect(page.locator('.sdoc-cells-focus')).toHaveCount(1);
  await expect(focus.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('4');
  await focus.locator('.sdoc-cells-focus-close').click();

  await page.locator('#left .sdoc-cells:visible').getByRole('button', { name: 'Open fullscreen' }).click();
  await focus.getByRole('tab', { name: 'Summary' }).click();
  await expect(focus.getByRole('button', { name: 'Show formulas' })).toBeVisible();
  await focus.getByRole('button', { name: 'Show formulas' }).click();
  await expect(focus.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]')).toContainText('=Inputs!B2*Inputs!B3');
  await focus.locator('.sdoc-cells-fx-toggle').filter({ hasText: '=fx' }).click();

  const cell = focus.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]');
  await cell.dblclick();
  await page.locator('.sdoc-cells-editor').fill('999');
  await page.locator('.sdoc-cells-editor').press('Escape');
  await expect(cell).toHaveText('$300.00');

  await cell.click();
  await focus.locator('.sdoc-cells-focus-value').fill('=6*7');
  await focus.locator('.sdoc-cells-focus-value').press('Enter');
  await expect(cell).toHaveText('$42.00');
  await focus.locator('.sdoc-cells-focus-close').click();
  await page.locator('#left').getByRole('tab', { name: 'Summary' }).click();
  await expect(page.locator('#left .sdoc-cells:visible .sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('$42.00');

  await page.locator('#left .sdoc-cells:visible').getByRole('button', { name: 'Open fullscreen' }).click();
  await focus.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').dblclick();
  await page.locator('.sdoc-cells-editor').fill('777');
  await page.evaluate(() => window.updateLeft());
  await expect(focus).toHaveCount(0);
  await expect(page.locator('#left .sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('9');
  await expect(page.locator('#right .sdoc-cells-grid')).toHaveCount(2);

  await page.locator('#right .sdoc-cells').first().getByRole('button', { name: 'Open fullscreen' }).click();
  await focus.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]').dblclick();
  await page.locator('.sdoc-cells-editor').fill('888');
  await page.evaluate(() => window.destroyRight());
  await expect(focus).toHaveCount(0);
  await expect(page.locator('#right .smalldocs-document')).toHaveCount(0);
  await expect(page.locator('#left .sdoc-cells-grid')).toHaveCount(1);
});

test('disabled spreadsheet fullscreen never loads focus or editor assets', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto(customerOrigin + '/cells-disabled');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.sdoc-cells-grid')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Open fullscreen' })).toHaveCount(0);
  expect(requests.some(url => url.includes('sdocs-cells-edit.js'))).toBe(false);
  expect(requests.some(url => url.includes('sdocs-cells-focus.js'))).toBe(false);
});

test('fullscreen spreadsheet download remains available when copy is disabled', async ({ page }) => {
  await page.goto(customerOrigin + '/cells-download-only');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Open fullscreen' }).click();
  const focus = page.locator('.sdoc-cells-focus');
  await expect(focus).toBeVisible();
  await expect(focus.getByRole('button', { name: 'Download as Excel (.xlsx)' })).toBeVisible();
  await expect(focus.getByRole('button', { name: /Copy/ })).toHaveCount(0);
});

test('canonical spreadsheet selection, keyboard, copy and drag lifecycle stay instance-owned', async ({ page }) => {
  await page.goto(customerOrigin + '/cells-isolation');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  const leftSheet = page.locator('#left .sdoc-cells:visible');
  const leftGrid = leftSheet.locator('.sdoc-cells-grid');
  const start = leftGrid.locator('.sdoc-cells-cell[data-r="1"][data-c="0"]');
  const end = leftGrid.locator('.sdoc-cells-cell[data-r="2"][data-c="1"]');
  await start.hover();
  await page.mouse.down();
  await end.hover();
  await page.mouse.up();
  await expect(leftSheet.locator('.sdoc-cells-ref')).toContainText('A2:B3');
  await expect(leftSheet.locator('.sdoc-cells-stats')).toContainText('Sum 37');
  await expect(leftSheet.locator('.sdoc-cells-stats')).toContainText('Count 4');
  await expect(leftGrid.locator('.sdoc-cells-cell.in-range')).toHaveCount(4);

  await leftSheet.locator('.sdoc-cells-copy-sel').click();
  await expect.poll(() => page.evaluate(() => window.sdocsCopiedText)).toBe('Units,12\nRate,25');

  await page.locator('#outside').click();
  await expect(leftGrid.locator('.sdoc-cells-cell.in-range, .sdoc-cells-cell.is-active')).toHaveCount(0);
  await expect(leftSheet.locator('.sdoc-cells-ref')).not.toContainText(/A\d/);

  const wholeCopy = leftSheet.getByRole('button', { name: 'Copy whole sheet as CSV' });
  await wholeCopy.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(leftGrid).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(leftSheet.locator('.sdoc-cells-ref')).toContainText('B2');
  await expect(leftGrid.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveAttribute('aria-selected', 'true');

  const rightGrid = page.locator('#right .sdoc-cells-grid').first();
  await start.hover();
  await page.mouse.down();
  await page.evaluate(() => document.querySelector('#right .sdoc-cells-grid').focus());
  await expect(rightGrid.locator('.sdoc-cells-cell[data-r="0"][data-c="0"]')).toHaveClass(/is-active/);
  await page.evaluate(() => window.updateLeft());
  await page.mouse.move(2, 2);
  await page.mouse.up();
  await expect(page.locator('#left h1')).toHaveText('Left updated');
  await expect(rightGrid.locator('.sdoc-cells-cell[data-r="0"][data-c="0"]')).toHaveClass(/is-active/);

  const rightDragStart = rightGrid.locator('.sdoc-cells-cell[data-r="1"][data-c="0"]');
  await rightDragStart.hover();
  await page.mouse.down();
  await page.evaluate(() => window.destroyRight());
  await page.mouse.move(3, 3);
  await page.mouse.up();
  await expect(page.locator('#right .smalldocs-document')).toHaveCount(0);
  const remainingCell = page.locator('#left .sdoc-cells-cell[data-r="1"][data-c="1"]');
  await remainingCell.click();
  await expect(remainingCell).toHaveClass(/is-active/);
});

test('private sanitizer ignores host globals and works with Trusted Types enforcement', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(customerOrigin + '/host-globals');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[id$="probe"]')).not.toHaveAttribute('onclick');
  expect(await page.evaluate(() => window.compromised)).toBeUndefined();

  await page.goto(customerOrigin + '/trusted-types');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.smalldocs-document')).toContainText('Trusted rich document');
  await expect(page.locator('[id$="probe"]')).not.toHaveAttribute('onclick');
  await expect(page.locator('.md-table-toolbar .table-copy-btn')).toHaveCount(2);
  await expect(page.locator('blockquote.sdoc-copyable-quote .quote-copy-btn')).toHaveCount(1);
  await expect(page.locator('.katex')).toHaveCount(2);
  await expect(page.locator('.katex .mfrac')).toHaveCount(1);
  expect(await page.locator('.katex [style]').count()).toBeGreaterThan(0);
  expect(await page.locator('.katex .mfrac').evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  })).toBe(true);
  await expect(page.locator('.smalldocs-mermaid-stage > svg')).toHaveCount(2);
  await expect(page.locator('.sdoc-cells-grid')).toHaveCount(1);
  await expect(page.locator('.sdoc-cells-cell[data-r="1"][data-c="1"]')).toHaveText('42');
  await page.getByRole('button', { name: 'Open fullscreen' }).click();
  await expect(page.locator('.sdoc-cells-focus')).toBeVisible();
  await expect(page.locator('.sdoc-cells-focus-topbar')).toBeVisible();
  await page.locator('.sdoc-cells-focus-close').click();
  expect(pageErrors).toEqual([]);
  await expect(page.locator('.sdoc-slide')).toHaveCount(1);
  await expect(page.locator('.sdoc-mermaid-error')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open code in fullscreen' }).click();
  await expect(page.getByRole('dialog', { name: 'Code fullscreen view' })).toBeVisible();
  await expect(page.locator('.sdoc-code-focus [data-act="comment"]')).toHaveCount(0);
  await expect(page.locator('.sdoc-code-focus-lines')).toContainText('trustedCode');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open slide 1 in presentation mode' }).click();
  await expect(page.getByRole('dialog', { name: 'Slide presentation' })).toBeVisible();
  await expect(page.locator('.sdoc-present-thumb')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sdoc-present')).toHaveCount(0);
  expect(await page.evaluate(() => window.compromised)).toBeUndefined();
});

test('SDK code blocks use the canonical production controls and fullscreen viewer', async ({ page }) => {
  const markdown = `# Code parity

~~~javascript
export function calculateForecast(revenue, margin) {
  const result = revenue * margin;
  return { result, explanation: 'A deliberately long source line that exercises the canonical overflow and wrapping control.' };
}
~~~`;

  await page.goto(customerOrigin + '/plain');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(source => window.view.update(source), markdown);
  await expect(page.locator('.pre-wrapper .pre-tools')).toHaveCount(1);
  await expect(page.locator('.smalldocs-code-tools, .smalldocs-code-download')).toHaveCount(0);

  const sdkInline = await page.locator('.pre-wrapper').evaluate(wrapper => {
    const pre = wrapper.querySelector(':scope > pre');
    const button = wrapper.querySelector('.pre-tools button');
    const preStyle = getComputedStyle(pre);
    const buttonStyle = getComputedStyle(button);
    return {
      buttons: Array.from(wrapper.querySelectorAll('.pre-tools > button')).map(node => node.className),
      pre: {
        background: preStyle.backgroundColor,
        color: preStyle.color,
        paddingTop: preStyle.paddingTop,
        borderRadius: preStyle.borderRadius,
      },
      button: {
        color: buttonStyle.color,
        padding: buttonStyle.padding,
        borderRadius: buttonStyle.borderRadius,
      },
    };
  });
  expect(sdkInline.buttons).toEqual(['wrap-btn', 'copy-btn', 'expand-btn']);

  await page.getByRole('button', { name: 'Open code in fullscreen' }).click();
  await expect(page.getByRole('dialog', { name: 'Code fullscreen view' })).toBeVisible();
  const sdkActions = await page.locator('.sdoc-code-focus-topbar [data-act]').evaluateAll(nodes => nodes.map(node => node.dataset.act));
  expect(sdkActions).toEqual(['wrap', 'foldall', 'copy', 'download', 'theme', 'close']);
  await expect(page.locator('.sdoc-cl-num').first()).toHaveText('1');
  await expect(page.locator('.sdoc-cl-fold')).not.toHaveCount(0);
  await expect(page.locator('.sdoc-code-focus .hljs-keyword').first()).toBeVisible();
  const sdkFocusColours = await page.locator('.sdoc-code-focus').evaluate(focus => {
    const code = focus.querySelector('.sdoc-cl-code');
    const keyword = focus.querySelector('.hljs-keyword');
    return {
      code: getComputedStyle(code).color,
      keyword: getComputedStyle(keyword).color,
    };
  });
  expect(sdkFocusColours.keyword).not.toBe(sdkFocusColours.code);
  await page.keyboard.press('Escape');

  await page.goto(sdocsOrigin + '/docs');
  await page.waitForFunction(() => window.SDocs && window.SDocs.codeFocus && window.SDocs.render);
  await page.evaluate(source => {
    window.SDocs.resetAllStyles();
    window.SDocs.currentBody = source;
    window.SDocs.currentMeta = {};
    window.SDocs.render();
  }, markdown);
  await expect(page.locator('#_sd_rendered .pre-wrapper .hljs-keyword').first()).toBeVisible();
  const productionInline = await page.locator('#_sd_rendered .pre-wrapper').evaluate(wrapper => {
    const pre = wrapper.querySelector(':scope > pre');
    const button = wrapper.querySelector('.pre-tools button');
    const preStyle = getComputedStyle(pre);
    const buttonStyle = getComputedStyle(button);
    return {
      buttons: Array.from(wrapper.querySelectorAll('.pre-tools > button')).map(node => node.className),
      pre: {
        background: preStyle.backgroundColor,
        color: preStyle.color,
        paddingTop: preStyle.paddingTop,
        borderRadius: preStyle.borderRadius,
      },
      button: {
        color: buttonStyle.color,
        padding: buttonStyle.padding,
        borderRadius: buttonStyle.borderRadius,
      },
    };
  });
  expect(productionInline).toEqual(sdkInline);

  await page.getByRole('button', { name: 'Open code in fullscreen' }).click();
  await expect(page.getByRole('dialog', { name: 'Code fullscreen view' })).toBeVisible();
  const productionActions = await page.locator('.sdoc-code-focus-topbar [data-act]').evaluateAll(nodes => nodes.map(node => node.dataset.act));
  expect(productionActions.filter(action => action !== 'comment')).toEqual(sdkActions);
});

test('a superseded slow rich update cannot mutate the next document', async ({ page }) => {
  test.setTimeout(30000);
  let intercepted = 0;
  await page.route('**/features/mermaid.js', async route => {
    intercepted += 1;
    await new Promise(resolve => setTimeout(resolve, 2000));
    await route.continue();
  });
  await page.goto(customerOrigin + '/plain');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => {
    window.slowUpdate = window.view.update(`# Slow

~~~mermaid
flowchart LR
 A --> B
~~~`)
      .then(() => 'resolved', error => error.name);
    setTimeout(() => {
      window.fastUpdate = window.view.update(`# Current

The newer document wins.`)
        .then(() => 'resolved', error => error.name);
    }, 10);
  });
  await expect.poll(() => intercepted).toBe(1);
  await expect.poll(() => page.evaluate(() => window.fastUpdate)).toBe('resolved');
  await expect.poll(() => page.evaluate(() => window.slowUpdate)).toBe('AbortError');
  await expect(page.locator('.smalldocs-document h1')).toHaveText('Current');
  await expect(page.locator('.smalldocs-document')).toContainText('The newer document wins.');
  await expect(page.locator('.smalldocs-mermaid')).toHaveCount(0);
  expect(await page.evaluate(() => window.view.features)).toEqual([]);
});

test('sanitized IDs cannot impersonate SDK assets or browser globals', async ({ page }) => {
  await page.goto(customerOrigin + '/plain');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => window.view.update(`# Clobber check

<div id="Chart"></div><div id="smalldocs-sdk-katex-css"></div>

$x^2$

~~~chart
{"type":"bar","labels":["A"],"values":[1]}
~~~`));
  await expect(page.locator('[id="user-content-Chart"]')).toHaveCount(1);
  await expect(page.locator('[id="user-content-smalldocs-sdk-katex-css"]')).toHaveCount(1);
  await expect(page.locator('.katex')).toHaveCount(1);
  await expect(page.locator('.smalldocs-chart canvas')).toHaveCount(1);

  await page.evaluate(() => window.view.update(`# Video check

~~~video
https://www.youtube.com/watch?v=dQw4w9WgXcQ
title: Product walkthrough
start: 75
~~~`));
  const video = page.locator('.sdoc-video iframe');
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?.*start=75/);
  await expect(video).toHaveAttribute('title', 'Product walkthrough');
});

test('editorial customer controls styles, collapse behavior and sanitisation', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto(customerOrigin + '/editorial-report/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  await expect(page.locator('.smalldocs-document')).toHaveCount(1);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('#smalldocs-sdk-styles')).toHaveCount(1);
  await expect(page.locator('.smalldocs-navigation')).toContainText('Evidence');
  await expect(page.locator('.md-section-body').first()).not.toHaveClass(/\bopen\b/);
  await page.locator('.section-toggle').first().click();
  await expect(page.locator('.md-section-body').first()).toHaveClass(/\bopen\b/);

  await expect(page.locator('#report .smalldocs-document h1')).toHaveCSS('color', 'rgb(119, 29, 41)');
  await expect(page.locator('#report .smalldocs-document')).toHaveCSS('font-family', /Georgia/);
  expect(await page.evaluate(() => JSON.stringify(window.hostProbeBefore) === JSON.stringify(window.hostProbeAfter))).toBe(true);

  await page.evaluate(() => window.renderUnsafeFixture());
  await expect(page.locator('#report h1')).toHaveText('Sanitisation check');
  expect(await page.evaluate(() => window.hostCompromised)).toBeUndefined();
  await expect(page.locator('#report script, #report iframe, #report style')).toHaveCount(0);
  await expect(page.locator('[id$="unsafe-button"]')).not.toHaveAttribute('onclick');
  await expect(page.locator('[id$="unsafe-link"]')).not.toHaveAttribute('href', /^javascript:/);

  await page.evaluate(() => window.restoreEditorialDocument());
  await page.locator('#report h2', { hasText: 'Model' }).click();
  await page.getByRole('button', { name: 'Open code in fullscreen' }).click();
  const codeDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download file' }).click();
  const codeFile = await codeDownload;
  expect(codeFile.suggestedFilename()).toBe('code.txt');
  expect((await downloadBytes(codeFile)).toString('utf8')).toContain('expectedValue');
});

test('operations customer keeps two rich documents isolated', async ({ page }) => {
  await page.goto(customerOrigin + '/operations-console/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  await expect(page.locator('.smalldocs-document')).toHaveCount(2);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('#smalldocs-sdk-styles')).toHaveCount(1);
  const ids = await page.locator('.smalldocs-document').evaluateAll(elements => elements.map(element => element.dataset.smalldocsInstance));
  expect(new Set(ids).size).toBe(2);
  const headingIds = await page.locator('.smalldocs-document h1').evaluateAll(elements => elements.map(element => element.id));
  expect(new Set(headingIds).size).toBe(2);

  await expect(page.locator('#capacity-report canvas')).toHaveCount(1);
  await expect(page.locator('#risk-report .smalldocs-mermaid-stage > svg')).toHaveCount(1);
  await expect(page.locator('#risk-report .katex')).not.toHaveCount(0);

  const chartDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download chart PNG' }).first().click();
  const chartPng = await chartDownload;
  const chartBytes = await downloadBytes(chartPng);
  expect(chartPng.suggestedFilename()).toMatch(/\.png$/);
  expect(chartBytes.subarray(1, 4).toString('ascii')).toBe('PNG');

  const diagramDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download diagram SVG' }).click();
  const diagramSvg = await diagramDownload;
  expect(diagramSvg.suggestedFilename()).toMatch(/\.svg$/);
  expect((await downloadBytes(diagramSvg)).toString('utf8')).toContain('<svg');

  await page.getByRole('tab', { name: 'Summary' }).click();
  await expect(page.locator('#capacity-report .sdoc-cells-pane-body > .sdoc-cells:visible')).toContainText('$3,000');
  await expect(page.locator('#capacity-report .sdoc-cells-pane-body > .sdoc-cells:visible')).toContainText('$2,550');

  const xlsxDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download workbook (.xlsx)' }).first().click();
  const xlsx = await xlsxDownload;
  const xlsxBytes = await downloadBytes(xlsx);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  expect(xlsxBytes.subarray(0, 2).toString('ascii')).toBe('PK');

  await expect(page.locator('#capacity-report .sdoc-cells-expand')).toHaveCount(2);

  await page.evaluate(() => window.updateCapacityDocument());
  await expect(page.locator('#capacity-report h1')).toHaveText('Summary');
  await expect(page.locator('#capacity-report')).toContainText('Available reserve');
  await expect(page.locator('#risk-report .smalldocs-mermaid-stage > svg')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.stringify(window.hostProbeBefore) === JSON.stringify(window.hostProbeAfter))).toBe(true);

  await page.evaluate(() => window.destroyCapacityDocument());
  await expect(page.locator('#capacity-report .smalldocs-document')).toHaveCount(0);
  await expect(page.locator('#risk-report .smalldocs-document')).toHaveCount(1);
});

test('board customer presents custom slides and exports deck files', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto(customerOrigin + '/board-brief/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  await expect(page.locator('.sdoc-slide')).toHaveCount(3);
  await expect(page.locator('.sdoc-slide-error')).toHaveCount(0);
  await expect(page.locator('#briefing-report .smalldocs-document h1')).toHaveCSS('text-transform', 'uppercase');
  expect(await page.evaluate(() => JSON.stringify(window.hostProbeBefore) === JSON.stringify(window.hostProbeAfter))).toBe(true);

  await page.getByRole('button', { name: 'Open slide 1 in presentation mode' }).click();
  await expect(page.getByRole('dialog', { name: 'Slide presentation' })).toBeVisible();
  await expect(page.locator('.sdoc-present-rail .sdoc-present-thumb')).toHaveCount(3);
  await expect(page.locator('.sdoc-present-counter')).toHaveText('1 / 3');
  await expect(page.getByRole('button', { name: 'Comment on slides' })).toHaveCount(0);
  await expect(page.locator('.sdoc-present-stage .sd-shape-copy-btn:not(.is-light):not(.is-dark)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.locator('.sdoc-present-exp-panel')).toHaveClass(/open/);
  await expect(page.locator('.sdoc-present-exp-panel')).toHaveCSS('width', '260px');
  await expect(page.locator('.sdoc-present-exp-panel')).toHaveCSS('font-size', '13px');
  await expect(page.locator('.sdoc-present-exp-btn').first()).toHaveCSS('font-size', '13px');
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('button', { name: 'Next slide' }).click();
  await expect(page.locator('.sdoc-present-counter')).toHaveText('2 / 3');
  await page.evaluate(() => window.updateBoardDocument());
  await expect(page.locator('.sdoc-present')).toHaveCount(0);
  await page.evaluate(() => window.restoreBoardDocument());
  await expect(page.locator('.sdoc-slide')).toHaveCount(3);
  await page.getByRole('button', { name: 'Open slide 1 in presentation mode' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sdoc-present')).toHaveCount(0);

  const pdfDownload = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: 'Download slides as PDF' }).click();
  const pdf = await pdfDownload;
  const pdfBytes = await downloadBytes(pdf);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  expect(pdfBytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(pdfBytes.length).toBeGreaterThan(1000);

  const pptxDownload = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: 'Download slides as PowerPoint' }).click();
  const pptx = await pptxDownload;
  const pptxBytes = await downloadBytes(pptx);
  expect(pptx.suggestedFilename()).toMatch(/\.pptx$/);
  expect(pptxBytes.subarray(0, 2).toString('ascii')).toBe('PK');
  expect(pptxBytes.length).toBeGreaterThan(1000);
});

test('slide shapes use SDK-owned icons and nested rich renderers', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto(customerOrigin + '/board-brief/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  await page.evaluate(() => {
    window.SDocShapes = { parse() { throw new Error('ambient shapes used'); } };
    window.SDocStyles = { resolveStyleRef() { throw new Error('ambient styles used'); } };
    window.SDocIcons = {};
    return window.boardView.update(`# Nested slide

~~~~slide
grid 16 9 bg=#f8fafc
icon 0.7 0.7 1.2 1.2 name=workflow color=#1646d8
r 2.2 0.6 4.0 2.2 fill=#eef2ff color=#101828 align=left |
  $x^2 + y^2$
r 0.7 3.2 7.0 4.8 fill=#ffffff stroke=#cbd5e1 |
  ~~~chart
  {"type":"bar","labels":["A","B"],"values":[2,5]}
  ~~~
r 8.3 3.2 7.0 4.8 fill=#ffffff stroke=#cbd5e1 |
  ~~~mermaid
  flowchart LR
    A[Input] --> B[Result]
  ~~~
~~~~`);
  });
  await expect(page.locator('.sdoc-slide .katex')).toHaveCount(1, { timeout: 30000 });
  await expect(page.locator('.sdoc-slide canvas')).toHaveCount(1);
  await expect(page.locator('.sdoc-slide .smalldocs-mermaid-stage > svg')).toHaveCount(1);
  await expect(page.locator('.sdoc-slide .shape-svg svg')).not.toHaveCount(0);
  const sdkAssetRequests = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
  expect(sdkAssetRequests.some(url => url.includes('/sdk/0.2.0/vendor/sdocs-icons-data.js'))).toBe(true);
  expect(sdkAssetRequests.some(url => new URL(url).pathname === '/public/sdocs-icons-data.js')).toBe(false);

  await page.evaluate(() => {
    const renderer = window.SDocShapeRender;
    const original = renderer.setRuntime;
    window.exportRuntimeResets = 0;
    renderer.setRuntime = function (runtime) {
      window.exportRuntimeResets += 1;
      return original.call(renderer, runtime);
    };
  });
  const pdfDownload = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: 'Download slides as PDF' }).click();
  await pdfDownload;
  expect(await page.evaluate(() => window.exportRuntimeResets)).toBeGreaterThan(0);
});

test('shape render sessions isolate runtimes, cleanup and SVG resources', async ({ page }) => {
  await page.goto(customerOrigin + '/board-brief/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  const state = await page.evaluate(async () => {
    const renderer = window.SDocShapeRender;
    const shapes = window.SDocShapes;
    const host = document.createElement('div');
    const mountA = document.createElement('div');
    const mountB = document.createElement('div');
    host.append(mountA, mountB);
    document.body.appendChild(host);

    let resolveA;
    let resolveB;
    let cleanupA = 0;
    let cleanupB = 0;
    let signalA;
    let signalB;
    const runtime = (id, bind) => ({
      shapes,
      styles: window.SDocStyles,
      icons: null,
      parseMarkdown(content) {
        return '<pre><code class="language-mermaid">' + id + ':' + content + '</code></pre>';
      },
      sanitizeHTML(html) { return html; },
      setKnownHTML(element, html) { element.innerHTML = html; },
      processMermaid(root, options, signal) {
        if (id === 'A') signalA = signal;
        else signalB = signal;
        return new Promise(resolve => bind(() => resolve(() => {
          if (id === 'A') cleanupA += 1;
          else cleanupB += 1;
        })));
      },
    });
    const runtimeA = runtime('A', resolve => { resolveA = resolve; });
    const runtimeB = runtime('B', resolve => { resolveB = resolve; });
    const dslA = 'grid 16 9\na 1 1 4 1 stroke=#ef4444\nr 1 2 5 3 | alpha';
    const dslB = 'grid 16 9\na 1 1 4 1 stroke=#2563eb\nr 1 2 5 3 | beta';
    const resultA = renderer.renderShapes(dslA, mountA, { runtime: runtimeA, resourcePrefix: 'deck-a' });
    const resultB = renderer.renderShapes(dslB, mountB, { runtime: runtimeB, resourcePrefix: 'deck-b' });
    const markerA = mountA.querySelector('marker').id;
    const markerB = mountB.querySelector('marker').id;
    const arrowA = mountA.querySelector('[marker-end]').getAttribute('marker-end');
    const arrowB = mountB.querySelector('[marker-end]').getAttribute('marker-end');

    resultA.destroy();
    resolveB();
    resolveA();
    await Promise.all([resultA.ready, resultB.ready]);
    const afterPending = { cleanupA, cleanupB, signalA: signalA.aborted, signalB: signalB.aborted };
    resultB.destroy();
    const afterDestroy = { cleanupA, cleanupB, signalA: signalA.aborted, signalB: signalB.aborted };
    host.remove();
    return { markerA, markerB, arrowA, arrowB, afterPending, afterDestroy };
  });

  expect(state.markerA).toBe('deck-a-arrowhead');
  expect(state.markerB).toBe('deck-b-arrowhead');
  expect(state.arrowA).toBe('url(#deck-a-arrowhead)');
  expect(state.arrowB).toBe('url(#deck-b-arrowhead)');
  expect(state.afterPending).toEqual({ cleanupA: 1, cleanupB: 0, signalA: true, signalB: false });
  expect(state.afterDestroy).toEqual({ cleanupA: 1, cleanupB: 1, signalA: true, signalB: true });
});

test('SDK and production share the canonical inline slide contract', async ({ page }) => {
  const markdown = `# Shared slide

~~~slide
grid 16 9 bg=#f8fafc
r 1 1 14 7 fill=#ffffff stroke=#cbd5e1 |
  # One component

  The app and SDK mount this surface.
~~~`;

  async function readContract() {
    return page.locator('.sdoc-slide').first().evaluate((slide) => {
      const button = slide.querySelector('.sdoc-slide-present');
      const wrap = slide.querySelector('.sd-slide-wrap');
      const stage = slide.querySelector('.sd-shape-stage');
      const buttonStyle = getComputedStyle(button);
      const slideStyle = getComputedStyle(slide);
      return {
        slideClasses: Array.from(slide.classList).sort(),
        buttonClass: button.className,
        buttonLabel: button.getAttribute('aria-label'),
        buttonTitle: button.title,
        buttonWidth: buttonStyle.width,
        buttonHeight: buttonStyle.height,
        buttonPosition: buttonStyle.position,
        borderRadius: slideStyle.borderRadius,
        overflow: slideStyle.overflow,
        wrapClass: wrap.className,
        stageClass: stage.className,
        shapeCount: stage.querySelectorAll('[data-shape-idx]').length,
      };
    });
  }

  await page.goto(customerOrigin + '/plain');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.evaluate((source) => window.view.update(source), markdown);
  await expect(page.locator('.sdoc-slide')).toHaveCount(1);
  const sdkContract = await readContract();

  await page.goto(sdocsOrigin + '/docs');
  await page.waitForFunction(() => window.SDocs && typeof window.SDocs.loadText === 'function');
  await page.evaluate((source) => window.SDocs.loadText(source, 'shared-slide.md'), markdown);
  await expect(page.locator('.sdoc-slide')).toHaveCount(1);
  const productionContract = await readContract();

  expect(sdkContract).toEqual(productionContract);
});
