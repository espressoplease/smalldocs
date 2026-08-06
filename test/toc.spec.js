// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

/**
 * Contents (TOC) panel.
 *
 * The panel is built from the rendered document's h1-h4 headings, toggled
 * from the left toolbar, remembered in localStorage, and its fold state is
 * mirrored two-way with the document's collapsible sections. It only earns
 * its place on documents with at least 3 headings.
 */

const FILLER = Array(30).fill('Lorem ipsum dolor sit amet, consectetur adipiscing elit.').join('\n\n');

const DOC = [
  '# Title',
  'intro',
  '## Alpha',
  FILLER,
  '### Alpha One',
  FILLER,
  '## Beta',
  FILLER,
].join('\n\n');

async function openDoc(page, md) {
  await page.goto(BASE + '/docs');
  await page.waitForFunction(() => window.SDocs && typeof window.SDocs.loadText === 'function');
  await page.evaluate((text) => {
    window.SDocs._isDefaultState = false;
    window.SDocs.loadText(text);
  }, md);
}

test('button and panel are absent under 3 headings', async ({ page }) => {
  await openDoc(page, '# Only\n\nbody\n\n## Two\n\nbody');
  await expect(page.locator('#_sd_btn-toc')).toBeHidden();
  await expect(page.locator('#_sd_toc')).not.toHaveClass(/open/);
});

test('panel builds a nested h1-h4 list and defaults closed', async ({ page }) => {
  await openDoc(page, DOC);
  await expect(page.locator('#_sd_btn-toc')).toBeVisible();
  await expect(page.locator('#_sd_toc')).not.toHaveClass(/open/);

  const slugs = await page.$$eval('#_sd_toc-list .toc-item', els => els.map(e => e.getAttribute('data-slug')));
  expect(slugs).toEqual(['title', 'alpha', 'alpha-one', 'beta']);
  // alpha-one nests inside alpha's sub-list
  expect(await page.locator('.toc-item[data-slug="alpha"] > .toc-sub > .toc-item[data-slug="alpha-one"]').count()).toBe(1);
  // h1 has children but never a chevron; alpha folds
  expect(await page.locator('.toc-item[data-slug="title"] > .toc-row > .toc-chevron').count()).toBe(0);
  expect(await page.locator('.toc-item[data-slug="alpha"] > .toc-row > .toc-chevron').count()).toBe(1);
});

test('toggle opens the panel and the state survives a reload via localStorage', async ({ page }) => {
  await openDoc(page, DOC);
  await page.click('#_sd_btn-toc');
  await expect(page.locator('#_sd_toc')).toHaveClass(/open/);
  expect(await page.evaluate(() => localStorage.getItem('sdocs-toc-open'))).toBe('1');

  // A re-render (new document load) keeps the remembered state.
  await page.evaluate((text) => window.SDocs.loadText(text), DOC);
  await expect(page.locator('#_sd_toc')).toHaveClass(/open/);

  await page.click('#_sd_btn-toc');
  await expect(page.locator('#_sd_toc')).not.toHaveClass(/open/);
  expect(await page.evaluate(() => localStorage.getItem('sdocs-toc-open'))).toBe('0');
});

test('folding is mirrored two-way with the document sections', async ({ page }) => {
  await openDoc(page, DOC);
  await page.click('#_sd_btn-toc');
  const alphaItem = page.locator('.toc-item[data-slug="alpha"]');
  // Sections start collapsed, so the mirrored panel starts folded.
  await expect(alphaItem).toHaveClass(/toc-collapsed/);
  await expect(page.locator('.toc-item[data-slug="alpha-one"]')).toBeHidden();

  // Expand in the document -> panel follows.
  await page.evaluate(() => document.getElementById('alpha').click());
  await expect(alphaItem).not.toHaveClass(/toc-collapsed/);
  await expect(page.locator('.toc-item[data-slug="alpha-one"]')).toBeVisible();

  // Collapse from the panel chevron -> document follows.
  await alphaItem.locator('> .toc-row > .toc-chevron').click();
  await expect(alphaItem).toHaveClass(/toc-collapsed/);
  const docOpen = await page.evaluate(() => {
    const body = document.getElementById('alpha').closest('.md-section').querySelector(':scope > .md-section-body');
    return body.classList.contains('open');
  });
  expect(docOpen).toBe(false);
});

test('clicking an entry expands a collapsed section and scrolls to it', async ({ page }) => {
  await openDoc(page, DOC);
  await page.click('#_sd_btn-toc');
  // Collapse everything, then navigate to the nested heading.
  await page.evaluate(() => {
    document.querySelectorAll('#_sd_rendered .md-section-body').forEach(b => b.classList.remove('open'));
  });
  await page.locator('.toc-item[data-slug="alpha"] > .toc-row > .toc-chevron').click(); // reopen alpha so alpha-one is clickable
  await page.locator('.toc-item[data-slug="alpha-one"] .toc-link').click();

  await expect.poll(() => page.evaluate(() => {
    const body = document.getElementById('alpha-one').closest('.md-section').querySelector(':scope > .md-section-body');
    return body.classList.contains('open');
  })).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    document.getElementById('_sd_content-area').scrollTop)).toBeGreaterThan(0);
});

test('scrollspy highlights the section in view', async ({ page }) => {
  await openDoc(page, DOC);
  await page.click('#_sd_btn-toc');
  await page.evaluate(() => {
    // Expand everything so the document is tall enough to scroll.
    document.querySelectorAll('#_sd_rendered .md-section-body').forEach(b => b.classList.add('open'));
    const area = document.getElementById('_sd_content-area');
    area.scrollTop = document.getElementById('beta').offsetTop;
  });
  await expect(page.locator('.toc-item[data-slug="beta"] .toc-link')).toHaveClass(/active/);
});

test('panel hides outside read and comment modes', async ({ page }) => {
  await openDoc(page, DOC);
  await page.click('#_sd_btn-toc');
  await expect(page.locator('#_sd_toc')).toBeVisible();
  await page.evaluate(() => window.SDocs.setMode('raw'));
  await expect(page.locator('#_sd_toc')).toBeHidden();
  await page.evaluate(() => window.SDocs.setMode('read'));
  await expect(page.locator('#_sd_toc')).toBeVisible();
});
