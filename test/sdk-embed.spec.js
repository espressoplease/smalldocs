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
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
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

  const fixture = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'sdk-customer', 'index.html'),
    'utf8'
  ).replaceAll('__SDOCS_ORIGIN__', sdocsOrigin);
  customerServer = http.createServer((req, res) => {
    if (req.url !== '/') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fixture);
  });
  await new Promise((resolve, reject) => {
    customerServer.once('error', reject);
    customerServer.listen(0, '127.0.0.1', resolve);
  });
  const address = customerServer.address();
  customerOrigin = 'http://127.0.0.1:' + address.port;
});

test.afterAll(async () => {
  if (customerServer) await new Promise(resolve => customerServer.close(resolve));
  if (sdocsServer && sdocsServer.exitCode == null) {
    sdocsServer.kill('SIGTERM');
    await new Promise(resolve => sdocsServer.once('exit', resolve));
  }
});

test('an independent customer renders and updates a full SmallDocs document', async ({ page }) => {
  await page.goto(sdocsOrigin + '/embed?parentOrigin=' + encodeURIComponent(customerOrigin)
    + '&channel=cache-prime');
  await page.goto(sdocsOrigin + '/sdk/0.1.1/smalldocs.js');
  await page.goto(customerOrigin);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('body')).not.toHaveAttribute('data-error', /.+/);

  const frameElement = page.locator('#report iframe.smalldocs-renderer');
  await expect(frameElement).toHaveCount(1);
  await expect(frameElement).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-downloads allow-modals'
  );
  await expect(frameElement).toHaveAttribute('src', new RegExp(
    '^' + sdocsOrigin.replaceAll('.', '\\.')
      + '/embed\\?parentOrigin=' + encodeURIComponent(customerOrigin)
  ));

  const documentFrame = page.frameLocator('#report iframe');
  await expect(documentFrame.locator('html')).toHaveCSS('overflow-y', 'clip');
  await expect(documentFrame.locator('body')).toHaveCSS('overflow-y', 'clip');
  await expect(documentFrame.locator('#_sd_rendered h1')).toHaveText('Agent research');
  await expect(documentFrame.locator('#_sd_rendered table')).toContainText('Support requests');
  const collapsedHeight = await frameElement.evaluate(element => parseInt(element.style.height, 10));
  await documentFrame.getByRole('heading', { name: 'Working model' }).click();
  await expect(documentFrame.locator('#_sd_rendered .sdoc-cells')).toBeVisible();
  await expect(documentFrame.locator('#_sd_rendered .sdoc-cells')).toContainText('125');
  await expect.poll(() => frameElement.evaluate(element => parseInt(element.style.height, 10)))
    .toBeGreaterThan(collapsedHeight);
  await expect(documentFrame.locator('html')).toHaveCSS('overflow-y', 'clip');
  await expect(documentFrame.locator('#_sd_left-toolbar')).toBeHidden();
  await expect(documentFrame.locator('#_sd_right')).toBeHidden();
  await expect(documentFrame.getByRole('button', { name: 'Unsafe input' })).not.toHaveAttribute('onclick');
  expect(await page.evaluate(() => window.customerDocumentWasCompromised)).toBeUndefined();

  const height = await frameElement.evaluate(element => parseInt(element.style.height, 10));
  expect(height).toBeGreaterThan(200);
  await expect(page.locator('#customer-title')).toHaveCSS('color', 'rgb(157, 23, 77)');
  await expect(documentFrame.locator('#_sd_rendered h1')).not.toHaveCSS('color', 'rgb(157, 23, 77)');

  await page.evaluate(() => window.updateSdkDocument());
  await expect(page.locator('body')).toHaveAttribute('data-updated', 'true');
  await expect(documentFrame.locator('#_sd_rendered h1')).toHaveText('Updated analysis');
  await expect(documentFrame.locator('#_sd_rendered .sdoc-cells')).toHaveCount(0);

  await page.evaluate((origin) => {
    const frame = document.querySelector('#report iframe');
    frame.contentWindow.postMessage({
      type: 'sdocs:render',
      channel: 'forged-channel',
      generation: 999,
      markdown: '# Forged document',
    }, origin);
  }, sdocsOrigin);
  await page.waitForTimeout(100);
  await expect(documentFrame.locator('#_sd_rendered h1')).toHaveText('Updated analysis');

  await page.evaluate(() => window.destroySdkDocument());
  await expect(page.locator('body')).toHaveAttribute('data-destroyed', 'true');
  await expect(frameElement).toHaveCount(0);
});
