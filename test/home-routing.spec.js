const { test, expect } = require('@playwright/test');
const zlib = require('zlib');

test.use({ serviceWorkers: 'block' });

test('root stays on the homepage for a signed-out browser without a Local Library connection', async ({ page }) => {
  await page.goto('/');
  expect(new URL(page.url()).pathname).toBe('/');
  await expect(page.locator('#install')).toBeVisible();
});

test('mobile homepage navigation remains sticky without changing positioning mode', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/home');

  const nav = page.locator('#nav');
  await expect(nav).toHaveCSS('position', 'sticky');
  await expect(nav).not.toHaveClass(/scrolled/);

  await page.evaluate(() => window.scrollTo(0, 320));
  await expect(nav).toHaveClass(/scrolled/);
  await expect(nav).toHaveCSS('position', 'sticky');
  expect(Math.round((await nav.boundingBox()).y)).toBe(0);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(nav).not.toHaveClass(/scrolled/);
  await expect(nav).toHaveCSS('position', 'sticky');
  const geometry = await page.evaluate(() => {
    const bar = document.getElementById('nav').getBoundingClientRect();
    const hero = document.querySelector('.hero').getBoundingClientRect();
    return { barTop: Math.round(bar.top), barBottom: Math.round(bar.bottom), heroTop: Math.round(hero.top) };
  });
  expect(geometry.barTop).toBe(0);
  expect(geometry.heroTop).toBeGreaterThanOrEqual(geometry.barBottom);
});

test('independent public page shells avoid mobile viewport minimums', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const surfaces = [
    { url: '/business', header: '.nav', shell: 'body' },
    { url: '/trust', header: '.header', shell: 'body' },
    { url: '/feedback', header: '.header', shell: 'body' },
    { url: '/developers', header: '.docs-topbar', shell: '.docs-main' },
    { url: '/developers/example', header: '.example-topbar', shell: '.example-layout' },
    { url: '/developers/example/non-collapsible', header: '.field-topbar', shell: '.field-layout' },
  ];

  for (const surface of surfaces) {
    await page.goto(surface.url);
    await expect(page.locator(surface.header)).toHaveCSS('position', 'sticky');
    await expect(page.locator(surface.shell)).toHaveCSS('min-height', '0px');
  }

  for (const url of ['/cloud/sign-in', '/cloud/invite']) {
    await page.goto(url);
    await expect(page.locator('body')).toHaveCSS('min-height', '0px');
  }
});

test('root opens Local Library when this browser has connected it', async ({ page, context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('sdocs.connect', JSON.stringify({ connected: true }));
  });
  await page.goto('/');
  await page.waitForURL('**/library');
  expect(new URL(page.url()).pathname).toBe('/library');
});

test('an explicit homepage anchor stays on the homepage for a connected browser', async ({ page, context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('sdocs.connect', JSON.stringify({ connected: true }));
  });
  await page.goto('/#install');
  expect(new URL(page.url()).pathname + new URL(page.url()).hash).toBe('/#install');
  await expect(page.locator('#install')).toBeVisible();
});

test('the explicit home route stays on the homepage for a connected browser', async ({ page, context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('sdocs.connect', JSON.stringify({ connected: true }));
  });
  await page.goto('/home');
  expect(new URL(page.url()).pathname).toBe('/home');
  await expect(page.locator('#install')).toBeVisible();
});

test('a document fragment takes priority over the returning-user library route', async ({ page, context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('sdocs.connect', JSON.stringify({ connected: true }));
  });
  const markdown = '# Root document route\n\nDocument fragments still open the reader.';
  const encoded = zlib.brotliCompressSync(Buffer.from(markdown), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  }).toString('base64url');
  await page.goto('/#md=' + encoded);
  await page.waitForURL(/\/docs#md=/);
  await expect(page.getByRole('heading', { name: 'Root document route' })).toBeVisible();
});
