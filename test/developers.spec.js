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

  await expect(page.locator('.docs-topbar')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open SmallDocs', exact: true })).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: 'Sample docs', exact: true })).toHaveAttribute('href', '/#learn');
  await expect(page.getByRole('link', { name: 'Working example', exact: true }))
    .toHaveAttribute('href', '/developers/example');
  await expect(page.getByRole('link', { name: 'Render in your app', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(await page.locator('#agent-references').evaluate(element => element.open)).toBe(false);
  await expect(page.getByRole('link', { name: 'Slides', exact: true })).toBeHidden();
  await expect(page.locator('.docs-header')).toHaveCount(0);
  await expect(page.locator('.document-meta')).toHaveCount(0);
  await expect(page.locator('#developer-document')).toHaveCSS('border-top-width', '0px');
  await expect(page.locator('#developer-document')).toHaveCSS('border-radius', '0px');
  expect(await page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
  const frameElement = page.locator('#developer-document iframe.smalldocs-renderer');
  await expect(frameElement).toHaveCount(1);
  const initialFrameSrc = await frameElement.getAttribute('src');
  const documentView = page.frameLocator('#developer-document iframe');
  await expect(documentView.getByRole('heading', { name: 'Put agent analysis inside your application' })).toBeVisible();
  await expect(documentView.locator('#_sd_rendered')).toContainText('Quick start with your coding agent');
  await expect(documentView.locator('#_sd_rendered')).toContainText('temporarily covers the browser viewport');
  await expect(page.locator('.loading-message')).toBeHidden();
  await expect(page.locator('#developer-document')).toHaveAttribute('aria-busy', 'false');
  await expect(documentView.locator('#_sd_left-toolbar')).toBeHidden();

  await page.getByRole('link', { name: 'Author with an agent', exact: true }).click();
  await expect(page).toHaveURL(origin + '/developers/agents');
  await expect(page.getByRole('link', { name: 'Author with an agent', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(documentView.getByRole('heading', { name: 'Teach your agent to write SmallDocs' })).toBeVisible();
  await expect(documentView.locator('#_sd_rendered')).toContainText('smalldocs-author');
  await expect(frameElement).toHaveAttribute('src', initialFrameSrc);

  await page.getByText('Authoring reference', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'Slides', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Slides', exact: true }).click();
  await expect(page).toHaveURL(origin + '/developers/authoring/slides');
  await expect(documentView.getByRole('heading', { name: 'Slides' })).toBeVisible();
  await expect(documentView.locator('#_sd_rendered')).toContainText(
    'Visual explanation is part of normal slide authoring'
  );
  await expect(frameElement).toHaveAttribute('src', initialFrameSrc);

  await expect(page.locator('.nav-children .nav-nested')).toHaveText('Custom shapes');
  await page.getByRole('link', { name: 'Custom shapes', exact: true }).click();
  await expect(page).toHaveURL(origin + '/developers/authoring/slide-shapes');
  await expect(documentView.getByRole('heading', { name: 'Custom slide shapes' })).toBeVisible();
  await expect(documentView.locator('#_sd_rendered pre').filter({ hasText: 'chev x y w h' }))
    .toContainText('chev x y w h');
  await expect(frameElement).toHaveCount(1);
});

test('developer chrome reuses the reader toolbar and side-panel design', async ({ page, context }) => {
  await page.goto(origin + '/developers');
  const reader = await context.newPage();
  await reader.goto(origin + '/docs');
  await reader.evaluate(() => document.body.classList.add('style-mode'));
  await reader.waitForTimeout(400);

  const developer = await page.evaluate(() => {
    const toolbar = document.querySelector('.docs-topbar');
    const sidebar = document.querySelector('.docs-sidebar');
    const sidebarHeader = document.querySelector('.docs-sidebar-header');
    const style = element => getComputedStyle(element);
    return {
      toolbar: {
        height: toolbar.getBoundingClientRect().height,
        x: toolbar.getBoundingClientRect().x,
        background: style(toolbar).backgroundColor,
        border: style(toolbar).borderBottomColor,
        padding: style(toolbar).padding,
      },
      sidebar: {
        width: sidebar.getBoundingClientRect().width,
        background: style(sidebar).backgroundColor,
      },
      sidebarHeader: {
        height: sidebarHeader.getBoundingClientRect().height,
        background: style(sidebarHeader).backgroundColor,
        color: style(sidebarHeader).color,
        font: style(sidebarHeader).font,
      },
    };
  });
  const standard = await reader.evaluate(() => {
    const toolbar = document.querySelector('#_sd_left-toolbar');
    const sidebar = document.querySelector('#_sd_right');
    const sidebarHeader = document.querySelector('#_sd_right-header');
    const style = element => getComputedStyle(element);
    return {
      toolbar: {
        height: toolbar.getBoundingClientRect().height,
        background: style(toolbar).backgroundColor,
        border: style(toolbar).borderBottomColor,
        padding: style(toolbar).padding,
      },
      sidebar: {
        width: sidebar.getBoundingClientRect().width,
        background: style(sidebar).backgroundColor,
      },
      sidebarHeader: {
        height: sidebarHeader.getBoundingClientRect().height,
        background: style(sidebarHeader).backgroundColor,
        color: style(sidebarHeader).color,
        font: style(sidebarHeader).font,
      },
    };
  });

  expect(developer.toolbar.height).toBe(standard.toolbar.height);
  expect(developer.toolbar.background).toBe(standard.toolbar.background);
  expect(developer.toolbar.border).toBe(standard.toolbar.border);
  expect(developer.toolbar.padding).toBe(standard.toolbar.padding);
  expect(developer.sidebar).toEqual(standard.sidebar);
  expect(developer.sidebarHeader).toEqual(standard.sidebarHeader);
  expect(developer.toolbar.x).toBe(developer.sidebar.width);
  await reader.close();
});

test('customer example swaps a multi-format analysis through one SDK view', async ({ page }) => {
  await page.goto(origin + '/developers/example');

  await expect(page.getByRole('heading', { name: 'European market entry' })).toBeVisible();
  await expect(page.getByText('This example shows four agent-produced Markdown documents rendered inside an application.')).toBeVisible();
  const frameElement = page.locator('#analysis-document iframe.smalldocs-renderer');
  await expect(frameElement).toHaveCount(1);
  const initialFrameSrc = await frameElement.getAttribute('src');
  const documentView = page.frameLocator('#analysis-document iframe');
  await expect(documentView.getByRole('heading', { name: 'Project Meridian: executive summary' })).toBeVisible();
  await expect(page.locator('.analysis-surface')).toHaveAttribute('aria-busy', 'false');

  await page.getByRole('button', { name: 'Briefing slides' }).click();
  await expect(documentView.getByRole('heading', { name: 'Project Meridian: briefing' })).toBeVisible();
  await expect(documentView.locator('.sdoc-slide')).toHaveCount(4);
  await expect(documentView.locator('.sdoc-slide-error')).toHaveCount(0);
  await expect(frameElement).toHaveAttribute('src', initialFrameSrc);
  const presentButton = documentView.getByRole('button', { name: 'Open slide 2 in presentation mode' });
  await presentButton.scrollIntoViewIfNeeded();
  const returnScrollY = await page.evaluate(() => window.scrollY);
  await presentButton.click();
  await expect(frameElement).toHaveCSS('position', 'fixed');
  await expect(page.locator('html')).toHaveCSS('overflow-y', 'hidden');
  await documentView.getByRole('button', { name: 'Exit presentation (Esc)' }).click();
  await expect(frameElement).toHaveCSS('position', 'static');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(returnScrollY);

  await page.getByRole('button', { name: 'Financial model' }).click();
  await expect(documentView.getByRole('heading', { name: 'Project Meridian: pilot model' })).toBeVisible();
  await expect(documentView.locator('.sdoc-cells')).toHaveCount(1);
  await expect(documentView.locator('.sdoc-cells')).toContainText('Cumulative contribution');
  await expect(frameElement).toHaveAttribute('src', initialFrameSrc);

  await page.getByRole('button', { name: 'Market charts' }).click();
  await expect(documentView.getByRole('heading', { name: 'Project Meridian: market evidence' })).toBeVisible();
  await expect(documentView.locator('.sdoc-chart')).toHaveCount(2);
  await expect(frameElement).toHaveAttribute('src', initialFrameSrc);
  expect(await page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
});

test('developer documentation uses a mobile menu without containing the document in a card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/developers');

  const sidebar = page.locator('#developer-sidebar');
  await expect(page.frameLocator('#developer-document iframe').getByRole('heading', { name: 'Put agent analysis inside your application' })).toBeVisible();
  await expect(sidebar).not.toHaveClass(/open/);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(sidebar).toHaveClass(/open/);
  await expect(page.getByRole('link', { name: 'Render in your app', exact: true })).toBeVisible();
  await expect(page.locator('#developer-document')).toHaveCSS('border-radius', '0px');
  expect(await page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
});
