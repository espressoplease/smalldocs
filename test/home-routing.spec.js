const { test, expect } = require('@playwright/test');
const zlib = require('zlib');

test.use({ serviceWorkers: 'block' });

test('root stays on the homepage for a signed-out browser without a Local Library connection', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('http://localhost:3000/');
  await expect(page.locator('#install')).toBeVisible();
});

test('root opens Local Library when this browser has connected it', async ({ page, context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('sdocs.connect', JSON.stringify({ connected: true }));
  });
  await page.goto('/');
  await page.waitForURL('**/library');
  await expect(page).toHaveURL('http://localhost:3000/library');
});

test('an explicit homepage anchor stays on the homepage for a connected browser', async ({ page, context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('sdocs.connect', JSON.stringify({ connected: true }));
  });
  await page.goto('/#install');
  await expect(page).toHaveURL('http://localhost:3000/#install');
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
