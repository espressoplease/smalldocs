const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block', colorScheme: 'light' });
let f, document;
test.beforeEach(async ({ page }) => {
  f = await startFixture({ singlePlan: true });
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.bob.sessionToken, url: f.origin }]);
  const result = await f.api('bob', '/api/cloud/v1/account/documents', 'POST', {
    account_id: f.team.workspaceId, filename: 'theme-check.md', markdown: '# Shared theme\n\nDocument content stays the same.', idempotency_key: 'theme-check',
  });
  expect(result.status).toBe(201); document = result.data.document;
});
test.afterEach(async () => { if (f) await f.close(); });
const libraryUrl = () => f.origin + '/library?scope=cloud&workspace=' + f.team.workspaceId;
async function openDocument(page) {
  await page.goto(f.origin + '/docs?cloud-document=' + document.id);
  await expect(page.locator('#_sd_rendered h1')).toHaveText('Shared theme');
}

for (const [saved, system] of [['dark', 'light'], ['light', 'dark']]) {
  test('saved ' + saved + ' theme wins over ' + system + ' OS before library scripts load', async ({ page }) => {
    await page.emulateMedia({ colorScheme: system });
    await page.addInitScript(theme => localStorage.setItem('sdocs-theme', theme), saved);
    let resume;
    await page.route('**/public/library/library.js*', async route => {
      await new Promise(resolve => { resume = resolve; }); await route.continue();
    });
    const navigation = page.goto(libraryUrl());
    try {
      await expect.poll(() => typeof resume).toBe('function');
      await expect(page.locator('html')).toHaveAttribute('data-theme', saved);
      await expect(page.locator('body')).toHaveCSS('background-color', saved === 'dark' ? 'rgb(44, 42, 38)' : 'rgb(255, 255, 255)');
    } finally { if (resume) resume(); await navigation; }
    await expect(page.locator('#workspace-button')).toContainText("Joe's engineering");
    await expect(page.locator('#cloud-library-actions > :last-child')).toHaveClass(/library-theme-toggle/);
  });
}

test('document and library choices persist, update open tabs and leave document content intact', async ({ page, context }) => {
  await openDocument(page);
  await page.locator('#_sd_btn-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const documentBackground = await page.locator('#_sd_rendered').evaluate(el => getComputedStyle(el).backgroundColor);
  const library = await context.newPage(); await library.goto(libraryUrl());
  await expect(library.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(library.locator('body')).toHaveCSS('background-color', documentBackground);
  const button = library.locator('.library-theme-toggle');
  await expect(button).toHaveAttribute('aria-label', 'Switch to light mode');
  await button.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => page.evaluate(() => SDocs.activeTheme)).toBe('light');
  await expect(page.locator('#_sd_rendered')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(button).toHaveAttribute('aria-label', 'Switch to dark mode');
  await page.locator('#_sd_btn-theme').click();
  await expect(library.locator('html')).toHaveAttribute('data-theme', 'dark');
  await library.reload(); await expect(library.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => SDocs.currentBody)).toBe('# Shared theme\n\nDocument content stays the same.');
  const saved = await f.api('bob', '/api/cloud/v1/documents/' + document.id);
  expect(saved.data.document.current_revision_id).toBe(document.current_revision_id);
});

test('system appearance is followed until a viewer chooses a theme, including library settings', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await page.goto(libraryUrl());
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('sdocs-theme'))).toBeNull();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('.library-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'dark' }); await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('link', { name: 'Manage members', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(231, 229, 226)');
  await page.locator('.library-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('the library toggle fits on mobile and works when theme storage is unavailable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) { if (key === 'sdocs-theme') throw new Error('Storage unavailable'); return get.call(this, key); };
    Storage.prototype.setItem = function (key, value) { if (key === 'sdocs-theme') throw new Error('Storage unavailable'); return set.call(this, key, value); };
  });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(libraryUrl());
  const bounds = await page.locator('.library-theme-toggle').boundingBox();
  expect(bounds.width).toBe(bounds.height);
  await page.locator('.library-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.library-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('an explicit document link theme remains a view override without rewriting the saved choice', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sdocs-theme', 'light'));
  await page.goto(f.origin + '/docs#theme=dark');
  await page.waitForFunction(() => window.SDocs?._appReady);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('sdocs-theme'))).toBe('light');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
