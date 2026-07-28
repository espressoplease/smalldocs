// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

/**
 * In-document anchor links.
 *
 * The whole document travels in the URL hash (#md=<brotli+base64url>). A plain
 * in-page link (`[see below](#setup)`) used to replace that hash with the bare
 * fragment; hashchange then re-ran loadFromHash, which found no md= param and
 * reset the page to DEFAULT_MD. Clicking a table-of-contents entry destroyed
 * the document.
 *
 * sdocs-app.js now intercepts clicks on a[href^="#"] inside #rendered: it
 * scrolls itself and rewrites the URL through buildSectionUrl, so md= survives
 * and the address bar stays shareable. A backstop in loadFromHash treats any
 * bare fragment (no `=`) as a scroll request rather than a document load.
 */

const DOC = [
  '# Anchor test',
  '',
  '- [Go to setup](#setup)',
  '- [Go to usage](#usage)',
  '- [GitHub-shaped link](#step-1--deploy)',
  '- [Nowhere](#does-not-exist)',
  '',
  '## Setup',
  '',
  'Setup body.',
  '',
  Array(40).fill('Filler paragraph.').join('\n\n'),
  '',
  '## Usage',
  '',
  'Usage body.',
  '',
  '## Step 1 - Deploy',
  '',
  'Deploy body.',
  '',
  Array(40).fill('Trailing filler.').join('\n\n'),
].join('\n');

// Load a real document and wait for it to be encoded into the URL hash, so the
// page is in the same state a `sdoc file.md` open produces.
async function openDoc(page) {
  await page.goto(BASE + '/docs');
  await page.waitForFunction(() => window.SDocs && typeof window.SDocs.loadText === 'function');
  await page.evaluate((md) => {
    window.SDocs._isDefaultState = false;
    window.SDocs.loadText(md);
    window.SDocs.syncAll();
  }, DOC);
  await page.waitForFunction(() => location.hash.indexOf('md=') !== -1, null, { timeout: 5000 });
}

const bodyText = (page) => page.evaluate(() => window.SDocs.currentBody);

test.describe('In-document anchor links', () => {
  test('clicking an in-page link keeps the document and the md= hash', async ({ page }) => {
    await openDoc(page);
    const before = await bodyText(page);

    await page.click('a[href="#setup"]');
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => ({
      hash: location.hash,
      body: window.SDocs.currentBody,
      isDefault: window.SDocs._isDefaultState,
    }));
    expect(after.body).toBe(before);
    expect(after.isDefault).toBe(false);
    expect(after.hash).toContain('md=');
    expect(after.hash).toContain('sec=setup');
  });

  test('the rewritten URL reopens the document at that section in a fresh load', async ({ page }) => {
    await openDoc(page);
    await page.click('a[href="#usage"]');
    await page.waitForTimeout(400);
    const url = page.url();
    expect(url).toContain('md=');
    expect(url).toContain('sec=usage');

    await page.goto(url);
    await page.waitForFunction(() => window.SDocs && window.SDocs.currentBody.indexOf('Anchor test') !== -1);
    await page.waitForTimeout(800);

    // Document intact, and the target heading is in view rather than the top.
    expect(await bodyText(page)).toContain('Usage body.');
    const scrolled = await page.evaluate(() =>
      document.getElementById('_sd_content-area').scrollTop);
    expect(scrolled).toBeGreaterThan(0);
  });

  test('a link into a collapsed section expands it', async ({ page }) => {
    await openDoc(page);

    // Collapse every section, then click through to one of them.
    const collapsed = await page.evaluate(() => {
      document.querySelectorAll('.md-section-body.open').forEach(b => b.classList.remove('open'));
      document.querySelectorAll('.section-toggle.open').forEach(t => t.classList.remove('open'));
      return document.querySelectorAll('.md-section-body.open').length;
    });
    expect(collapsed).toBe(0);

    await page.click('a[href="#usage"]');
    await page.waitForTimeout(400);

    const open = await page.evaluate(() => {
      const h = document.getElementById('usage');
      const sec = h && h.closest('.md-section');
      const body = sec && sec.querySelector(':scope > .md-section-body');
      return !!(body && body.classList.contains('open'));
    });
    expect(open).toBe(true);
  });

  test('a GitHub-shaped fragment resolves to our slug', async ({ page }) => {
    await openDoc(page);
    await page.click('a[href="#step-1--deploy"]');
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => ({ hash: location.hash, body: window.SDocs.currentBody }));
    expect(after.hash).toContain('md=');
    expect(after.hash).toContain('sec=step-1-deploy');
    expect(after.body).toContain('Deploy body.');
  });

  test('an unresolvable anchor does not destroy the document', async ({ page }) => {
    await openDoc(page);
    const before = await bodyText(page);

    await page.click('a[href="#does-not-exist"]');
    await page.waitForTimeout(600);

    const after = await page.evaluate(() => ({
      body: window.SDocs.currentBody,
      isDefault: window.SDocs._isDefaultState,
    }));
    expect(after.body).toBe(before);
    expect(after.isDefault).toBe(false);
  });

  test('Back and Forward across several in-page links keep the document', async ({ page }) => {
    await openDoc(page);
    const before = await bodyText(page);

    // Push real history entries the way a browser would for a bare fragment,
    // then walk back and forth over them.
    await page.evaluate(() => {
      history.pushState(null, '', '#setup');
      history.pushState(null, '', '#usage');
    });
    await page.goBack();
    await page.waitForTimeout(300);
    await page.goBack();
    await page.waitForTimeout(300);
    await page.goForward();
    await page.waitForTimeout(300);

    expect(await bodyText(page)).toBe(before);
  });

  test('Ctrl-click is left to the browser', async ({ page }) => {
    await openDoc(page);
    const before = await page.evaluate(() => location.hash);

    await page.click('a[href="#setup"]', { modifiers: ['ControlOrMeta'] });
    await page.waitForTimeout(300);

    // Our handler bailed out, so it did not rewrite the URL with sec=.
    const after = await page.evaluate(() => location.hash);
    expect(after).not.toContain('sec=setup');
    expect(after).toBe(before);
  });

  test('--section entry (sec=) still scrolls to the heading', async ({ page }) => {
    await openDoc(page);
    const url = page.url().split('#')[0] + '#' + (await page.evaluate(() => {
      const p = new URLSearchParams(location.hash.slice(1));
      p.set('sec', 'usage');
      return p.toString();
    }));

    await page.goto(url);
    await page.waitForFunction(() => window.SDocs && window.SDocs.currentBody.indexOf('Usage body.') !== -1);
    await page.waitForTimeout(800);

    const scrolled = await page.evaluate(() =>
      document.getElementById('_sd_content-area').scrollTop);
    expect(scrolled).toBeGreaterThan(0);
  });
});
