const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
const stubDemo = require('./homepage-video-fixture');
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
  await stubDemo(page);
  await page.goto(f.origin + publicPath);
  await expect(page.locator('#_sd_rendered h1')).toHaveText('A public guide');
  await expect(page.locator('.sdocs-publication-stats')).toBeVisible();
  await expect(page.locator('.sdocs-shared-footer')).toHaveCount(1);
  await expect(page.locator('.sdocs-shared-footer')).toContainText('increase your rate of understanding');
  await expect(page.locator('.sdocs-shared-footer').getByRole('link', { name: 'Learn more about SmallDocs.' })).toHaveAttribute('href', '/home');
  await expect(page.locator('.sdocs-shared-footer-video')).toHaveCount(1);
  await expect(page.locator('.sdocs-shared-footer-video')).toBeVisible();
  await expect(page.locator('#_sd_sidebar_about_panel')).toContainText('complex work with AI agents');
  expect(await page.evaluate(() => window.SDocs.currentBody)).not.toContain('increase your rate of understanding');
  await page.waitForFunction(() => window.SDocs && window.SDocs.currentBody.includes('published introduction'));
  await expect(page.locator('.sdocs-publication-stats')).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.addInitScript(theme => localStorage.setItem('sdocs-theme', theme), theme);
      await page.goto(f.origin + publicPath);
      await expect(page.locator('.sdocs-publication-stats')).toContainText(/page view/);
      const framing = await page.evaluate(() => {
        const reader = document.querySelector('#_sd_rendered'), footer = document.querySelector('.sdocs-shared-footer');
        const video = document.querySelector('.sdocs-shared-footer-video');
        const r = reader.getBoundingClientRect(), f = footer.getBoundingClientRect(), v = video.getBoundingClientRect();
        return { textLeft: r.left + parseFloat(getComputedStyle(reader).paddingLeft),
          footerLeft: f.left + parseFloat(getComputedStyle(footer).paddingLeft),
          videoLeft: v.left, videoWidth: v.width,
          readerWidth: r.width, footerWidth: f.width, border: getComputedStyle(footer).borderTopWidth,
          separatorBorder: getComputedStyle(footer, '::before').borderTopWidth,
          separatorWidth: parseFloat(getComputedStyle(footer, '::before').width),
          textWidth: r.width - parseFloat(getComputedStyle(reader).paddingLeft) - parseFloat(getComputedStyle(reader).paddingRight),
          scroll: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
      });
      expect(framing.footerLeft).toBeCloseTo(framing.textLeft, 0);
      expect(framing.videoLeft).toBeCloseTo(framing.textLeft, 0);
      expect(framing.videoWidth).toBeLessThanOrEqual(360.5);
      expect(framing.footerWidth).toBeCloseTo(framing.readerWidth, 0);
      expect(framing.border).toBe('0px');
      expect(framing.separatorBorder).toBe('1px');
      expect(framing.separatorWidth).toBeCloseTo(framing.textWidth, 0);
      expect(framing.scroll).toBeLessThanOrEqual(framing.innerWidth);
      const preview = page.locator('.sdocs-shared-footer-video');
      await preview.getByRole('button', { name: 'Play the SmallDocs demo', exact: true }).click();
      await expect(preview).toHaveClass(/is-expanded/);
      await preview.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
      await expect.poll(() => page.locator('#intro-video').evaluate(video => !video.paused && !video.muted && video.currentTime > 0)).toBe(true);
      const expanded = await preview.boundingBox();
      expect(expanded.x).toBeCloseTo(framing.textLeft, 0);
      expect(expanded.width).toBeCloseTo(framing.textWidth, 0);
      await expect(preview.locator('.vid-chapter-pill').first()).toBeVisible();
      await preview.getByRole('button', { name: 'Collapse video', exact: true }).click();
      await expect(preview).not.toHaveClass(/is-expanded/);
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


test('private links share the About copy and footer without adding them to the document', async ({ page }) => {
  await stubDemo(page);
  await page.goto(f.origin + '/docs');
  await page.waitForFunction(() => window.SDocs && window.SDocs.shortLink);
  await expect(page.locator('.sdocs-shared-footer-video')).toHaveCount(0);
  const link = await page.evaluate(async () => {
    window.SDocs.loadText('# Private shared guide\n\nOnly the shared document content.');
    window.SDocs._isDefaultState = false;
    return window.SDocs.shortLink.create();
  });
  await page.goto(link.url);
  await page.waitForFunction(() => window.SDocs && window.SDocs.shortLinkId);
  await expect(page.locator('.sdocs-shared-footer')).toHaveCount(1);
  await expect(page.locator('.sdocs-shared-footer')).toBeVisible();
  await expect(page.locator('.sdocs-shared-footer')).toContainText('increase your rate of understanding');
  await expect(page.locator('.sdocs-shared-footer-video')).toHaveCount(1);
  await expect(page.locator('.sdocs-shared-footer-video')).toBeVisible();
  await page.locator('.sdocs-shared-footer-video').getByRole('button', { name: 'Play the SmallDocs demo', exact: true }).click();
  await expect(page.locator('.sdocs-shared-footer-video')).toHaveClass(/is-expanded/);
  await expect.poll(() => page.locator('#intro-video').evaluate(video => !video.paused && !video.muted && video.currentTime > 0)).toBe(true);
  await expect(page.locator('.sdocs-publication-stats')).not.toContainText('page view');
  await expect(page.locator('#_sd_sidebar_about_panel')).toContainText('Use SmallDocs to understand that work.');
  await expect(page.locator('.sdocs-shared-footer a')).toHaveAttribute('href', '/home');
  expect(await page.evaluate(() => window.SDocs.serializeCurrentDocument())).not.toContain('increase your rate of understanding');
  await page.goto(f.origin + '/docs');
  await expect(page.locator('.sdocs-shared-footer')).not.toBeVisible();
  await expect(page.locator('.sdocs-shared-footer-video')).toHaveCount(0);
});
