// @ts-check
const { test, expect } = require('@playwright/test');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

let server;
let origin;

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
  const port = await availablePort();
  origin = 'http://127.0.0.1:' + port;
  server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, {
      PORT: String(port),
      NODE_ENV: 'test',
      ANALYTICS_ENABLED: '0',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Developer test server did not start: ' + output)), 5000);
    server.once('error', reject);
    server.stdout.on('data', chunk => {
      output += chunk.toString();
      if (!output.includes('running at')) return;
      clearTimeout(timer);
      resolve();
    });
    server.stderr.on('data', chunk => { output += chunk.toString(); });
  });
});

test.afterAll(async () => {
  if (server && server.exitCode == null) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
});

test('developer documentation uses one SDK view to navigate Markdown pages', async ({ page }) => {
  await page.goto(origin + '/developers');

  await expect(page.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');
  const frameElement = page.locator('#developer-document iframe.smalldocs-renderer');
  await expect(frameElement).toHaveCount(1);
  const initialFrameSrc = await frameElement.getAttribute('src');
  const documentView = page.frameLocator('#developer-document iframe');
  await expect(documentView.getByRole('heading', { name: 'Renderer SDK' })).toBeVisible();
  await expect(documentView.locator('#_sd_left-toolbar')).toBeHidden();

  await page.getByRole('link', { name: 'Quickstart', exact: true }).click();
  await expect(page).toHaveURL(origin + '/developers/quickstart');
  await expect(page.getByRole('link', { name: 'Quickstart', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(documentView.getByRole('heading', { name: 'Quickstart' })).toBeVisible();
  await expect(documentView.locator('#_sd_rendered pre')).toContainText('import { render }');
  await expect(frameElement).toHaveAttribute('src', initialFrameSrc);
  await expect(page.locator('#markdown-link')).toHaveAttribute('href', '/developers/quickstart.md');

  await page.getByRole('link', { name: 'Lifecycle', exact: true }).click();
  await expect(documentView.getByRole('heading', { name: 'Lifecycle' })).toBeVisible();
  await expect(documentView.locator('#_sd_rendered')).toContainText('view.destroy()');
  await expect(frameElement).toHaveCount(1);

  await page.getByRole('link', { name: 'Slides', exact: true }).click();
  await expect(page).toHaveURL(origin + '/developers/authoring/slides');
  await expect(documentView.getByRole('heading', { name: 'Slides' })).toBeVisible();
  await expect(documentView.locator('#_sd_rendered')).toContainText(
    'Visual explanation is part of normal slide authoring'
  );
  await expect(frameElement).toHaveAttribute('src', initialFrameSrc);

  await page.getByRole('link', { name: 'Custom slide shapes', exact: true }).click();
  await expect(page).toHaveURL(origin + '/developers/authoring/slide-shapes');
  await expect(documentView.getByRole('heading', { name: 'Custom slide shapes' })).toBeVisible();
  await expect(documentView.locator('#_sd_rendered pre').filter({ hasText: 'chev x y w h' }))
    .toContainText('chev x y w h');
  await expect(page.locator('#markdown-link')).toHaveAttribute(
    'href', '/developers/authoring/slide-shapes.md'
  );
  await expect(frameElement).toHaveCount(1);
});
