// @ts-check
const { test, expect } = require('@playwright/test');

async function loadDoc(page, markdown) {
  await page.goto('/new');
  await page.waitForFunction(() => window.SDocs && typeof window.SDocs.loadText === 'function');
  await page.evaluate((source) => {
    window.SDocs.setMode('read', true);
    window.SDocs.loadText(source, 'html-components.md');
  }, markdown);
  await page.waitForSelector('.sdoc-app-frame');
}

function app(source) {
  return '```sdoc-app\n' + source + '\n```';
}

const counterApp = `<!doctype html>
<html><head><title>Counter surface</title></head>
<body><button id="count">0</button><script>
document.getElementById('count').addEventListener('click', function () {
  this.textContent = String(Number(this.textContent) + 1);
});
</script></body></html>`;

test('runs a complete HTML document with JavaScript inline', async ({ page }) => {
  await loadDoc(page, app(counterApp));
  await expect(page.locator('.sdoc-app-title')).toHaveText('Counter surface');
  const component = page.frameLocator('.sdoc-app-frame-inline');
  await expect(component.locator('#count')).toHaveText('0');
  await component.locator('#count').click();
  await expect(component.locator('#count')).toHaveText('1');

  await expect(page.locator('.sdoc-app-frame')).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-forms allow-modals allow-downloads allow-popups'
  );
  await expect(page.locator('#_sd_rendered code.language-sdoc-app')).toHaveCount(0);
});

test('bare components inherit the SmallDocs design contract', async ({ page }) => {
  const source = '<!doctype html><html><head><title>Inherited design</title></head><body><h1>Heading</h1><p>Body text</p><button>Action</button></body></html>';
  await loadDoc(page, app(source));
  const component = page.frameLocator('.sdoc-app-frame');
  await expect(component.locator('#sdocs-component-defaults')).toHaveCount(1);
  await expect(component.locator('body')).toHaveCSS('margin', '0px');
  await expect(component.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(component.locator('body')).toHaveCSS('color', 'rgb(28, 25, 23)');
  await expect(component.locator('body')).toHaveCSS('font-family', /Inter/);
  await expect(component.locator('h1')).toHaveCSS('font-weight', '700');
  await expect(component.locator('button')).toHaveCSS('font-family', /Inter/);
  expect(await component.locator('body').evaluate((body) => parseFloat(getComputedStyle(body).paddingLeft))).toBeGreaterThan(0);
  await expect.poll(() => component.locator('body').evaluate(async () => {
    await document.fonts.ready;
    return Array.from(document.fonts).some((face) => face.family === 'Inter' && face.status === 'loaded');
  })).toBe(true);
});

test('component CSS overrides inherited defaults', async ({ page }) => {
  const source = `<!doctype html><html><head><title>Custom design</title><style>
:root { --sdoc-app-background: #112233; --sdoc-app-color: #f7f7f7; }
body { padding: 7px; font-family: Georgia, serif; }
</style></head><body>Custom</body></html>`;
  await loadDoc(page, app(source));
  const body = page.frameLocator('.sdoc-app-frame').locator('body');
  await expect(body).toHaveCSS('background-color', 'rgb(17, 34, 51)');
  await expect(body).toHaveCSS('color', 'rgb(247, 247, 247)');
  await expect(body).toHaveCSS('padding', '7px');
  await expect(body).toHaveCSS('font-family', /Georgia/);
});

test('component design follows document style changes', async ({ page }) => {
  const source = '<!doctype html><html><head><title>Live design</title></head><body><h1>Heading</h1><a href="#">Link</a></body></html>';
  await loadDoc(page, app(source));
  await page.locator('#_sd_rendered').evaluate((root) => {
    root.style.setProperty('--md-bg', '#18212f');
    root.style.setProperty('--md-color', '#eef2f7');
    root.style.setProperty('--md-link-color', '#f59e0b');
    root.style.setProperty('--md-font-family', 'Georgia, serif');
    root.style.setProperty('--md-h-scale', '1.25');
  });
  const component = page.frameLocator('.sdoc-app-frame');
  await expect(component.locator('body')).toHaveCSS('background-color', 'rgb(24, 33, 47)');
  await expect(component.locator('body')).toHaveCSS('color', 'rgb(238, 242, 247)');
  await expect(component.locator('body')).toHaveCSS('font-family', /Georgia/);
  await expect(component.locator('a')).toHaveCSS('color', 'rgb(245, 158, 11)');
  await expect(component.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(component.locator('h1')).toHaveCSS('font-size', '42px');

  await page.locator('#_sd_rendered').evaluate((root) => {
    root.style.setProperty('--md-bg', 'hsl(0 0% 96%)');
  });
  await expect(component.locator('html')).toHaveCSS('color-scheme', 'light');
  await page.locator('#_sd_rendered').evaluate((root) => {
    root.style.setProperty('--md-bg', 'oklch(20% 0 0)');
  });
  await expect(component.locator('html')).toHaveCSS('color-scheme', 'dark');
});

test('ordinary html fences remain readable source', async ({ page }) => {
  await page.goto('/new');
  await page.waitForFunction(() => window.SDocs && typeof window.SDocs.loadText === 'function');
  await page.evaluate((source) => window.SDocs.loadText(source, 'ordinary-html.md'),
    '```html\n<button onclick="window.ran=true">Source only</button>\n```');
  await expect(page.locator('code.language-html')).toContainText('Source only');
  await expect(page.locator('.sdoc-app-frame')).toHaveCount(0);
  expect(await page.evaluate(() => window.ran)).toBeUndefined();
});

test('component cannot reach the SmallDocs parent document', async ({ page }) => {
  const source = `<!doctype html><html><head><title>Isolated app</title></head><body>
<output id="result">checking</output><script>
try {
  parent.document.body.dataset.componentCompromised = 'yes';
  document.getElementById('result').textContent = 'parent reached';
} catch (error) {
  document.getElementById('result').textContent = 'isolated';
}
</script></body></html>`;
  await loadDoc(page, app(source));
  await expect(page.frameLocator('.sdoc-app-frame').locator('#result')).toHaveText('isolated');
  expect(await page.locator('body').getAttribute('data-component-compromised')).toBeNull();
});

test('fullscreen keeps the live component state and restores it inline', async ({ page }) => {
  await loadDoc(page, app(counterApp));
  const inline = page.frameLocator('.sdoc-app-frame-inline');
  await inline.locator('#count').click();
  await inline.locator('#count').click();
  await expect(inline.locator('#count')).toHaveText('2');

  await page.getByRole('button', { name: 'Open Counter surface in fullscreen' }).click();
  await expect(page.locator('.sdoc-app-focus')).toBeVisible();
  await expect(page.frameLocator('.sdoc-app-frame-fullscreen').locator('#count')).toHaveText('2');
  await page.frameLocator('.sdoc-app-frame-fullscreen').locator('#count').click();
  await page.getByRole('button', { name: 'Close fullscreen' }).click();

  await expect(page.locator('.sdoc-app-focus')).toHaveCount(0);
  await expect(page.frameLocator('.sdoc-app-frame-inline').locator('#count')).toHaveText('3');
});

test('fullscreen gallery moves between multiple components', async ({ page }) => {
  const first = '<!doctype html><html><head><title>First app</title></head><body><h1>Alpha</h1></body></html>';
  const second = '<!doctype html><html><head><title>Second app</title></head><body><h1>Beta</h1></body></html>';
  await loadDoc(page, app(first) + '\n\n' + app(second));
  await page.getByRole('button', { name: 'Open First app in fullscreen' }).click();
  await expect(page.locator('.sdoc-app-focus-counter')).toHaveText('1 / 2');
  await expect(page.frameLocator('.sdoc-app-frame-fullscreen').locator('h1')).toHaveText('Alpha');

  await page.getByRole('button', { name: 'Next component' }).click();
  await expect(page.locator('.sdoc-app-focus-counter')).toHaveText('2 / 2');
  await expect(page.locator('.sdoc-app-focus-title')).toHaveText('Second app');
  await expect(page.frameLocator('.sdoc-app-frame-fullscreen').locator('h1')).toHaveText('Beta');

  await page.getByRole('button', { name: 'Previous component' }).click();
  await expect(page.frameLocator('.sdoc-app-frame-fullscreen').locator('h1')).toHaveText('Alpha');
});

test('component owns inline height and fullscreen ignores size reports', async ({ page }) => {
  const tall = '<!doctype html><html><head><title>Tall app</title></head><body style="margin:0;height:1400px">Tall</body></html>';
  await loadDoc(page, app(tall));
  await expect.poll(async () => page.locator('.sdoc-app-frame-inline').evaluate((frame) => frame.getBoundingClientRect().height)).toBe(1400);
  await page.getByRole('button', { name: 'Open Tall app in fullscreen' }).click();
  const fullscreenHeight = await page.locator('.sdoc-app-frame-fullscreen').evaluate((frame) => frame.getBoundingClientRect().height);
  const viewportHeight = page.viewportSize().height;
  expect(fullscreenHeight).toBe(viewportHeight - 66);
  await expect(page.locator('.sdoc-app-frame-fullscreen:popover-open')).toHaveCount(1);
});

test('component responsive CSS can change its inline height', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  const responsive = '<!doctype html><html><head><title>Responsive app</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;padding:0}.surface{height:220px}@media(max-width:500px){.surface{height:360px}}</style></head><body><main class="surface">Responsive</main></body></html>';
  await loadDoc(page, app(responsive));
  await expect.poll(async () => page.locator('.sdoc-app-frame-inline').evaluate((frame) => frame.getBoundingClientRect().height)).toBe(220);
  await page.setViewportSize({ width: 420, height: 800 });
  await expect.poll(async () => page.locator('.sdoc-app-frame-inline').evaluate((frame) => frame.getBoundingClientRect().height)).toBe(360);
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect.poll(async () => page.locator('.sdoc-app-frame-inline').evaluate((frame) => frame.getBoundingClientRect().height)).toBe(220);
});

test('rerender removes fullscreen and old component browsing contexts', async ({ page }) => {
  await loadDoc(page, app(counterApp));
  await page.getByRole('button', { name: 'Open Counter surface in fullscreen' }).click();
  await page.evaluate(() => {
    window.SDocs.currentBody = '# Replacement\n\nThe component is gone.';
    window.SDocs.render();
  });
  await expect(page.locator('.sdoc-app-focus')).toHaveCount(0);
  await expect(page.locator('.sdoc-app-frame')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Replacement' })).toBeVisible();
});

test('runnable HTML gallery presents three live demos and concise prompts', async ({ page }) => {
  await page.goto('/runnable-html');
  await expect(page.getByRole('heading', { name: 'Runnable HTML', exact: true })).toBeVisible();
  await expect(page.locator('.sdoc-app-frame-inline')).toHaveCount(3);
  await expect(page.locator('.sdoc-app-title')).toHaveText([
    'Interactive valuation surface',
    'Live backlog simulator',
    'Interactive dependency map'
  ]);
  await expect(page.getByText('Try this prompt:', { exact: true })).toHaveCount(3);
  await expect(page.getByText('How an agent should decide', { exact: true })).toHaveCount(0);
});

test('runnable HTML gallery updates its financial model and keeps state fullscreen', async ({ page }) => {
  await page.goto('/runnable-html');
  const component = page.frameLocator('.sdoc-app-frame-inline').nth(0);
  await expect(component.locator('canvas#surface')).toBeVisible();
  await expect(component.locator('#growthOut')).toHaveText('9%');
  const initialValue = await component.locator('#valueOut').innerText();
  await component.locator('#growth').fill('16');
  await expect(component.locator('#growthOut')).toHaveText('16%');
  await expect(component.locator('#valueOut')).not.toHaveText(initialValue);

  await page.getByRole('button', { name: 'Open Interactive valuation surface in fullscreen' }).click();
  await expect(page.locator('.sdoc-app-focus')).toBeVisible();
  await expect(page.frameLocator('.sdoc-app-frame-fullscreen').locator('#growthOut')).toHaveText('16%');
  await page.getByRole('button', { name: 'Close fullscreen' }).click();
});

test('runnable HTML gallery runs and pauses its queue simulation', async ({ page }) => {
  await page.goto('/runnable-html');
  const component = page.frameLocator('.sdoc-app-frame-inline').nth(1);
  await expect(component.locator('#backlog')).toHaveText('18 jobs');
  await component.locator('#toggle').click();
  await expect(component.locator('#toggle')).toHaveText('Pause');
  await expect.poll(async () => component.locator('#time').innerText()).not.toBe('0 min');
  await expect.poll(async () => component.locator('#backlog').innerText()).not.toBe('18 jobs');
  await component.locator('#toggle').click();
  await expect(component.locator('#toggle')).toHaveText('Run');
  await component.locator('#arrival').fill('8');
  await component.locator('#capacity').fill('22');
  await expect(component.locator('#state')).toHaveText('Clearing');

  const pausedTime = await component.locator('#time').innerText();
  await page.getByRole('button', { name: 'Open Live backlog simulator in fullscreen' }).click();
  await expect(page.frameLocator('.sdoc-app-frame-fullscreen').locator('#time')).toHaveText(pausedTime);
  await page.getByRole('button', { name: 'Close fullscreen' }).click();
});

test('runnable HTML gallery traces upstream and downstream dependencies', async ({ page }) => {
  await page.goto('/runnable-html');
  const component = page.frameLocator('.sdoc-app-frame-inline').nth(2);
  await expect(component.locator('#selection')).toHaveText('Orders');
  await expect(component.locator('#upstream')).toContainText('Orders DB');
  await expect(component.locator('#downstream')).toContainText('Web app');
  await component.getByRole('button', { name: 'Select Event queue' }).press('Enter');
  await expect(component.locator('#selection')).toHaveText('Event queue');
  await expect(component.locator('#upstream')).toHaveText('None');
  await expect(component.locator('#downstream')).toContainText('Notifications');
  await expect(component.locator('#critical')).toContainText('Web app');

  await page.getByRole('button', { name: 'Open Interactive dependency map in fullscreen' }).click();
  await expect(page.frameLocator('.sdoc-app-frame-fullscreen').locator('#selection')).toHaveText('Event queue');
  await page.getByRole('button', { name: 'Close fullscreen' }).click();
});

test('runnable HTML gallery keeps all three demos usable at narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 860 });
  await page.goto('/runnable-html');
  const component = page.frameLocator('.sdoc-app-frame-inline').nth(0);
  const boxes = await component.locator('.stage, .controls').evaluateAll((elements) =>
    elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }));
  expect(boxes).toHaveLength(2);
  expect(boxes[1].top).toBeGreaterThanOrEqual(boxes[0].bottom);
  expect(boxes[0].left).toBeGreaterThanOrEqual(0);
  expect(boxes[1].right).toBeLessThanOrEqual(420);
  await expect(component.locator('#discount')).toBeVisible();
  await expect(component.locator('#valueOut')).toBeVisible();

  const queue = page.frameLocator('.sdoc-app-frame-inline').nth(1);
  await expect(queue.locator('#toggle')).toBeVisible();
  await expect(queue.locator('#history')).toBeVisible();

  const dependencies = page.frameLocator('.sdoc-app-frame-inline').nth(2);
  await expect(dependencies.locator('[aria-label="Select Web app"]')).toBeVisible();
  await expect(dependencies.locator('#critical')).toBeVisible();
});
