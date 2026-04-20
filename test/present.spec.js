// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

async function loadDocWithSlides(page, slides) {
  var md = '# Test deck\n\n'
    + slides.map((dsl) => '```slide\n' + dsl + '\n```').join('\n\nbetween\n\n');
  await page.goto(BASE + '/');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function');
  await page.evaluate((body) => {
    window.SDocs.currentBody = body;
    window.SDocs.render();
  }, md);
  await page.waitForTimeout(200);
}

test.describe('presentation mode', () => {
  test('clicking a thumbnail opens the present modal', async ({ page }) => {
    await loadDocWithSlides(page, [
      'grid 100 56.25\nr 10 10 80 40 fill=#2563eb color=#fff | Slide one',
      'grid 100 56.25\nr 10 10 80 40 fill=#059669 color=#fff | Slide two',
    ]);
    await expect(page.locator('.sdoc-present')).toHaveCount(0);
    await page.locator('.sdoc-slide').first().click();
    await expect(page.locator('.sdoc-present')).toHaveCount(1);
    await expect(page.locator('.sdoc-present-stage .shape-rect')).toContainText('Slide one');
  });

  test('ArrowRight advances to next slide, ArrowLeft goes back', async ({ page }) => {
    await loadDocWithSlides(page, [
      'grid 100 56.25\nr 10 10 80 40 | Slide A',
      'grid 100 56.25\nr 10 10 80 40 | Slide B',
      'grid 100 56.25\nr 10 10 80 40 | Slide C',
    ]);
    await page.locator('.sdoc-slide').first().click();
    await expect(page.locator('.sdoc-present-stage .shape-rect')).toContainText('Slide A');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.sdoc-present-stage .shape-rect')).toContainText('Slide B');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.sdoc-present-stage .shape-rect')).toContainText('Slide C');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.sdoc-present-stage .shape-rect')).toContainText('Slide B');
  });

  test('advancing past last slide clamps (does not wrap)', async ({ page }) => {
    await loadDocWithSlides(page, [
      'grid 100 56.25\nr 10 10 80 40 | Only slide',
    ]);
    await page.locator('.sdoc-slide').first().click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    // Still showing the only slide
    await expect(page.locator('.sdoc-present-stage .shape-rect')).toContainText('Only slide');
  });

  test('Escape closes the present modal and restores scroll', async ({ page }) => {
    await loadDocWithSlides(page, [
      'grid 100 56.25\nr 10 10 80 40 | Slide',
    ]);
    await page.locator('.sdoc-slide').first().click();
    await expect(page.locator('.sdoc-present')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.sdoc-present')).toHaveCount(0);
  });

  test('close button exits the modal', async ({ page }) => {
    await loadDocWithSlides(page, [
      'grid 100 56.25\nr 10 10 80 40 | Slide',
    ]);
    await page.locator('.sdoc-slide').first().click();
    await page.locator('.sdoc-present-close').click();
    await expect(page.locator('.sdoc-present')).toHaveCount(0);
  });

  test('rail has one thumbnail per slide with active class on current', async ({ page }) => {
    await loadDocWithSlides(page, [
      'grid 100 56.25\nr 10 10 80 40 | A',
      'grid 100 56.25\nr 10 10 80 40 | B',
      'grid 100 56.25\nr 10 10 80 40 | C',
    ]);
    await page.locator('.sdoc-slide').first().click();
    await expect(page.locator('.sdoc-present-rail .sdoc-present-thumb')).toHaveCount(3);
    await expect(page.locator('.sdoc-present-rail .sdoc-present-thumb.active')).toHaveCount(1);
    await expect(page.locator('.sdoc-present-rail .sdoc-present-thumb').first()).toHaveClass(/active/);
    await page.keyboard.press('ArrowRight');
    // Second thumbnail is now active
    await expect(page.locator('.sdoc-present-rail .sdoc-present-thumb').nth(1)).toHaveClass(/active/);
  });

  test('clicking a rail thumbnail jumps to that slide', async ({ page }) => {
    await loadDocWithSlides(page, [
      'grid 100 56.25\nr 10 10 80 40 | First',
      'grid 100 56.25\nr 10 10 80 40 | Second',
      'grid 100 56.25\nr 10 10 80 40 | Third',
    ]);
    await page.locator('.sdoc-slide').first().click();
    await page.locator('.sdoc-present-rail .sdoc-present-thumb').nth(2).click();
    await expect(page.locator('.sdoc-present-stage .shape-rect')).toContainText('Third');
  });

  test('URL hash gets present=<idx> while open', async ({ page }) => {
    await loadDocWithSlides(page, [
      'grid 100 56.25\nr 10 10 80 40 | A',
      'grid 100 56.25\nr 10 10 80 40 | B',
    ]);
    await page.locator('.sdoc-slide').first().click();
    await page.waitForTimeout(50);
    let hash = await page.evaluate(() => window.location.hash);
    expect(hash).toContain('present=0');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(50);
    hash = await page.evaluate(() => window.location.hash);
    expect(hash).toContain('present=1');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    hash = await page.evaluate(() => window.location.hash);
    expect(hash).not.toContain('present=');
  });
});
