const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
let f, publicPath;
test.use({ serviceWorkers: 'block' });
test.beforeAll(async () => {
  f = await startFixture({ analytics: true });
  const created = await f.api('bob', '/api/cloud/v1/account/documents', 'POST', { account_id: f.team.workspaceId,
    filename: 'guide.md', markdown: '# A public guide\n\nThis is the published introduction.\n\n## Details\n\nRead this detail.\n', idempotency_key: crypto.randomUUID() });
  expect(created.status).toBe(201);
  const publication = await f.api('bob', '/api/cloud/v1/documents/' + created.data.document.id + '/publication', 'POST', {
    expected_revision_id: created.data.document.current_revision_id, idempotency_key: crypto.randomUUID() });
  expect(publication.status).toBe(200); publicPath = new URL(publication.data.publication.url).pathname;
});
test.afterAll(async () => { if (f) await f.close(); });

test('new homepage and Cloud/local library each send the correct single page-load beacon', async ({ page }) => {
  const visits = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/version-check') visits.push(new URL(request.url())); });
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.bob.sessionToken, url: f.origin }]);
  for (const [route, type] of [['/home-next?src=Email-Launch', 'home'], ['/library?scope=cloud', 'cloud-library'], ['/library', 'library']]) {
    // A local bridge is not part of this tracking test. Hold its bootstrap so
    // it does not navigate to Connect before the page-load recorder executes.
    if (type === 'library') await page.route('**/public/library/library.js*', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
    visits.length = 0;
    await page.goto(f.origin + route);
    await expect.poll(() => visits.filter(url => url.searchParams.get('lt') === type).length).toBe(1);
    expect(visits).toHaveLength(1);
    if (type === 'home') expect(visits[0].searchParams.get('src')).toBe('email-launch');
  }
});

test('weekly visits precede new accounts and Cloud/local library cohort totals stay separate', async ({ page }) => {
  await fetch(f.origin + '/analytics/data');
  const db = new Database(path.join(f.dir, 'analytics.db'));
  db.prepare("INSERT INTO visits(cohort_week,visit_week,load_type) VALUES('2026-W01','2026-W01','cloud-library')").run();
  db.prepare("INSERT INTO visits(cohort_week,visit_week,load_type) VALUES('2026-W02','2026-W02','library')").run(); db.close();
  await page.goto(f.origin + '/analytics');
  await expect(page.locator('#library-cohorts-body .subtable')).toHaveCount(2);
  const headings = await page.locator('.content h1').allTextContents();
  expect(headings.indexOf('Visits by weekly cohort')).toBeLessThan(headings.indexOf('New accounts'));
  const cloud = page.locator('#library-cohorts-body .subtable').filter({ hasText: 'Cloud library' });
  const local = page.locator('#library-cohorts-body .subtable').filter({ hasText: 'Local library' });
  await expect(cloud).toContainText("W01'26"); await expect(cloud.locator('tbody')).not.toContainText("W02'26");
  await expect(local).toContainText("W02'26"); await expect(local.locator('tbody')).not.toContainText("W01'26");
});

test('directory remains readable and linked without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage(); await page.goto(f.origin + '/published');
    await expect(page.getByRole('heading', { name: 'Published pages' })).toBeVisible();
    await expect(page.getByRole('link', { name: /A public guide/ })).toHaveAttribute('href', publicPath);
    expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe(f.origin + '/published');
    await page.getByRole('link', { name: /A public guide/ }).click();
    await expect(page.locator('#_sd_rendered h1')).toContainText('A public guide');
    await expect(page.locator('.sdocs-publication-stats')).toContainText(/page view/);
  } finally { await context.close(); }
});

test('published page counts survive reader hydration and directory layout fits mobile and dark mode', async ({ page }) => {
  await page.goto(f.origin + publicPath);
  await expect(page.locator('#_sd_rendered h1')).toHaveText('A public guide');
  await expect(page.locator('.sdocs-publication-stats')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browse published pages' })).toHaveAttribute('href', '/published');
  await page.waitForFunction(() => window.SDocs && window.SDocs.currentBody.includes('published introduction'));
  await expect(page.locator('.sdocs-publication-stats')).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.addInitScript(theme => localStorage.setItem('sdocs-theme', theme), theme);
      await page.goto(f.origin + '/published');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('link', { name: /A public guide/ })).toBeVisible();
      const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
        background: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(document.body).color }));
      expect(metrics.scroll).toBeLessThanOrEqual(metrics.width); expect(metrics.background).not.toBe(metrics.text);
      if (theme === 'dark') expect(metrics.background).toBe('rgb(44, 42, 38)');
    }
  }
});
