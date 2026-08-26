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
  await expect(page.getByRole('link', { name: 'SmallDocs', exact: true })).toHaveAttribute('href', '/');
  await expect(page.locator('.topbar-actions')).toHaveCount(0);
  await expect(page.getByText('Developer documentation', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Example gallery', exact: true }))
    .toHaveAttribute('href', '/developers/examples');
  await expect(page.getByRole('link', { name: 'Render in your app', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(await page.locator('#agent-references').evaluate(element => element.open)).toBe(false);
  await expect(page.getByRole('link', { name: 'Slides', exact: true })).toBeHidden();
  await expect(page.locator('.docs-header')).toHaveCount(0);
  await expect(page.locator('.document-meta')).toHaveCount(0);
  await expect(page.locator('#developer-document')).toHaveCSS('border-top-width', '0px');
  await expect(page.locator('#developer-document')).toHaveCSS('border-radius', '0px');
  expect(await page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
  await expect(page.locator('#developer-document iframe.smalldocs-renderer')).toHaveCount(0);
  const documentView = page.locator('#developer-renderer');
  await expect(documentView.locator('.smalldocs-document')).toHaveCount(1);
  const instanceId = await documentView.locator('.smalldocs-document').getAttribute('data-smalldocs-instance');
  await expect(documentView.getByRole('heading', { name: 'Put agent analysis inside your application' })).toBeVisible();
  await expect(documentView).toContainText('Hand this to your coding agent');
  await expect(documentView).toContainText('renders into the host DOM');
  await expect(page.locator('.loading-message')).toBeHidden();
  await expect(page.locator('#developer-document')).toHaveAttribute('aria-busy', 'false');
  await expect(documentView.locator('.smalldocs-navigation')).toBeHidden();

  await documentView.getByRole('link', {
    name: 'Teach the analysis agent to author SmallDocs Markdown',
    exact: true,
  }).click();
  await expect(page).toHaveURL(origin + '/developers/agents');
  await expect(page.getByRole('link', { name: 'Author with an agent', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(documentView.getByRole('heading', { name: 'Teach your agent to write SmallDocs' })).toBeVisible();
  await expect(documentView).toContainText('smalldocs-author');
  await expect(documentView.locator('.smalldocs-document')).toHaveAttribute('data-smalldocs-instance', instanceId);

  await page.getByText('Authoring reference', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'Slides', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Slides', exact: true }).click();
  await expect(page).toHaveURL(origin + '/developers/authoring/slides');
  await expect(documentView.getByRole('heading', { name: 'Slides' })).toBeVisible();
  await expect(documentView).toContainText(
    'Visual explanation is part of normal slide authoring'
  );
  await expect(documentView.locator('.smalldocs-document')).toHaveAttribute('data-smalldocs-instance', instanceId);

  await expect(page.locator('.nav-children .nav-nested')).toHaveText('Custom shapes');
  await page.getByRole('link', { name: 'Custom shapes', exact: true }).click();
  await expect(page).toHaveURL(origin + '/developers/authoring/slide-shapes');
  await expect(documentView.getByRole('heading', { name: 'Custom slide shapes' })).toBeVisible();
  await expect(documentView.locator('pre').filter({ hasText: 'chev x y w h' }))
    .toContainText('chev x y w h');
  await expect(documentView.locator('.smalldocs-document')).toHaveCount(1);
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
        y: sidebar.getBoundingClientRect().y,
        width: sidebar.getBoundingClientRect().width,
        background: style(sidebar).backgroundColor,
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
    };
  });

  expect(developer.toolbar.height).toBe(standard.toolbar.height);
  expect(developer.toolbar.background).toBe(standard.toolbar.background);
  expect(developer.toolbar.border).toBe(standard.toolbar.border);
  expect(developer.toolbar.padding).toBe(standard.toolbar.padding);
  expect(developer.sidebar.width).toBe(standard.sidebar.width);
  expect(developer.sidebar.background).toBe(standard.sidebar.background);
  expect(developer.toolbar.x).toBe(0);
  expect(developer.sidebar.y).toBe(developer.toolbar.height);
  await reader.close();
});

test('customer example swaps a multi-format analysis through one SDK view', async ({ page }) => {
  await page.goto(origin + '/developers/example');

  await expect(page.getByRole('heading', { name: 'European market entry' })).toBeVisible();
  await expect(page.getByText('This example shows four agent-produced Markdown documents rendered inside an application.')).toBeVisible();
  await expect(page.locator('#analysis-document iframe.smalldocs-renderer')).toHaveCount(0);
  const documentView = page.locator('#analysis-document');
  await expect(documentView.locator('.smalldocs-document')).toHaveCount(1);
  const instanceId = await documentView.locator('.smalldocs-document').getAttribute('data-smalldocs-instance');
  await expect(documentView.getByRole('heading', { name: 'Project Meridian: executive summary' })).toBeVisible();
  await expect(page.locator('.analysis-surface')).toHaveAttribute('aria-busy', 'false');

  await page.getByRole('button', { name: 'Briefing slides' }).click();
  await expect(documentView.getByRole('heading', { name: 'Project Meridian: briefing' })).toBeVisible();
  await expect(documentView.locator('.sdoc-slide')).toHaveCount(4);
  await expect(documentView.locator('.sdoc-slide-error')).toHaveCount(0);
  await expect(documentView.locator('.smalldocs-document')).toHaveAttribute('data-smalldocs-instance', instanceId);
  const presentButton = documentView.getByRole('button', { name: 'Open slide 1 in presentation mode' });
  await presentButton.scrollIntoViewIfNeeded();
  const returnScrollY = await page.evaluate(() => window.scrollY);
  await presentButton.click();
  await expect(page.getByRole('dialog', { name: 'Slide presentation' })).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('overflow-y', 'hidden');
  await page.getByRole('button', { name: 'Exit presentation (Esc)' }).click();
  await expect(page.locator('.smalldocs-overlay')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(returnScrollY);

  await page.getByRole('button', { name: 'Financial model' }).click();
  await expect(documentView.getByRole('heading', { name: 'Project Meridian: pilot model' })).toBeVisible();
  await expect(documentView.locator('.sdoc-cells')).toHaveCount(1);
  await expect(documentView.locator('.sdoc-cells')).toContainText('Cumulative contribution');
  await expect(documentView.locator('.smalldocs-document')).toHaveAttribute('data-smalldocs-instance', instanceId);

  await page.getByRole('button', { name: 'Market charts' }).click();
  await expect(documentView.getByRole('heading', { name: 'Project Meridian: market evidence' })).toBeVisible();
  await expect(documentView.locator('.sdoc-chart')).toHaveCount(2);
  await expect(documentView.locator('.smalldocs-document')).toHaveAttribute('data-smalldocs-instance', instanceId);
  expect(await page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
});

test('styled SDK example keeps every document section open and accepts host typography', async ({ page }) => {
  await page.goto(origin + '/developers/example/non-collapsible');

  await expect(page.locator('body')).toHaveAttribute('data-demo-ready', 'true');
  const report = page.locator('#field-report');
  await expect(report.getByRole('heading', { name: 'Streets that stay useful in the heat' })).toBeVisible();
  await expect(report.getByRole('heading', { name: 'What the evidence says' })).toBeVisible();
  await expect(report.getByRole('heading', { name: 'Recommendation' })).toBeVisible();
  await expect(report.locator('.section-toggle')).toHaveCount(0);
  await expect(report.locator('.md-section')).toHaveCount(0);
  await expect(report.locator('.smalldocs-navigation')).toBeVisible();
  await expect(report.locator('.smalldocs-document')).toHaveCSS('font-family', /Georgia/);
  await expect(report.getByRole('heading', { name: 'What the evidence says' })).toHaveCSS('border-top-width', '3px');
  await expect(report.locator('blockquote')).toContainText('fund three connected cool corridors');
  await expect(report.locator('table')).toContainText('Continuous shaded route');
  await expect(report.getByRole('button', { name: 'Open code in fullscreen' })).toBeVisible();
  expect(await page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
});

test('SDK gallery shows all features and recreates views for configuration changes', async ({ page }) => {
  await page.goto(origin + '/developers/examples');

  await expect(page.locator('body')).toHaveAttribute('data-demo-ready', 'true');
  await expect(page.getByRole('heading', { name: 'Investment decision room' })).toBeVisible();
  await expect(page.getByText('The top bar and this menu belong to the customer application.')).toBeVisible();
  const documentView = page.locator('#showcase-document');
  await expect(documentView.getByRole('heading', { name: 'Northline: investment decision' })).toBeVisible();
  await expect(documentView.locator('.smalldocs-navigation')).toBeVisible();
  await expect(documentView.locator('.sdoc-mermaid')).toHaveCount(1);
  const mermaidWidth = await documentView.locator('svg.sdoc-mermaid-svg').evaluate(element =>
    element.getBoundingClientRect().width
  );
  expect(mermaidWidth).toBeGreaterThan(300);
  await expect(documentView.locator('.sdoc-chart')).toHaveCount(1);
  await expect(documentView.locator('.sdoc-cells')).toHaveCount(2);
  await expect(documentView.locator('.sdoc-cells-pane-tabs')).toHaveCount(1);
  await expect(documentView.locator('.sdoc-slide')).toHaveCount(3);
  await expect(documentView.locator('.sdoc-video')).toHaveCount(1);
  await expect(documentView.locator('.katex')).not.toHaveCount(0);
  await expect(documentView.locator('pre code')).not.toHaveCount(0);
  const completeInstance = await documentView.locator('.smalldocs-document').getAttribute('data-smalldocs-instance');

  await page.getByRole('button', { name: /Editorial report/ }).click();
  await expect(documentView.getByRole('heading', { name: 'Streets that stay useful in the heat' })).toBeVisible();
  await expect(documentView.locator('.section-toggle')).toHaveCount(0);
  await expect(documentView.locator('.smalldocs-document')).toHaveCSS('font-family', /Georgia/);
  const editorialControlColor = await documentView.locator('.pre-wrapper .copy-btn').evaluate(element =>
    getComputedStyle(element).color
  );
  await documentView.getByRole('button', { name: 'Open diagram in fullscreen' }).click();
  const fullscreenDiagramColors = await page.locator('.sdoc-mermaid-focus-action').evaluateAll(elements =>
    elements.map(element => getComputedStyle(element).color)
  );
  expect(fullscreenDiagramColors).toEqual([
    editorialControlColor,
    editorialControlColor,
    editorialControlColor,
  ]);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const editorialInstance = await documentView.locator('.smalldocs-document').getAttribute('data-smalldocs-instance');
  expect(editorialInstance).not.toBe(completeInstance);

  await page.getByRole('button', { name: /Compact answer/ }).click();
  await expect(documentView.getByRole('heading', { name: 'Shift risk summary' })).toBeVisible();
  await expect(documentView.locator('.smalldocs-navigation')).toBeHidden();
  await expect(documentView.locator('.section-toggle')).toHaveCount(0);
  await expect(documentView.getByRole('button', { name: /Copy/ })).toHaveCount(0);
  await expect(documentView.getByRole('button', { name: 'Open diagram in fullscreen' })).toBeVisible();
  await expect(page.locator('#showcase-config')).toContainText('"download": false');

  await page.getByRole('button', { name: /Long reference/ }).click();
  await expect(documentView.getByRole('heading', { name: 'Launch operations reference' })).toBeVisible();
  await expect(documentView.locator('.smalldocs-navigation')).toBeVisible();
  await expect(documentView.locator('.md-section-body:not(.open)')).not.toHaveCount(0);
  await expect(documentView.locator('code.language-future-control')).toContainText('threshold: pending');
  expect(await page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
});

test('SDK gallery keeps configuration switching usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/developers/examples');

  await expect(page.locator('body')).toHaveAttribute('data-demo-ready', 'true');
  await expect(page.locator('.showcase-sidebar')).toBeHidden();
  await expect(page.getByLabel('Example')).toBeVisible();
  await page.getByLabel('Example').selectOption('compact');
  await expect(page.getByRole('heading', { name: 'Shift risk summary' })).toBeVisible();
  await expect(page.locator('#showcase-document .smalldocs-navigation')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open diagram in fullscreen' })).toBeVisible();
  expect(await page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
});

test('developer documentation uses a mobile menu without containing the document in a card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/developers');

  const sidebar = page.locator('#developer-sidebar');
  await expect(page.locator('#developer-renderer').getByRole('heading', { name: 'Put agent analysis inside your application' })).toBeVisible();
  await expect(sidebar).not.toHaveClass(/open/);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(sidebar).toHaveClass(/open/);
  await expect(page.getByRole('link', { name: 'Render in your app', exact: true })).toBeVisible();
  await expect(page.locator('#developer-document')).toHaveCSS('border-radius', '0px');
  expect(await page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
});
