// @ts-check
// Tests for the `i` image shape kind. Uses a tiny inline data-URI PNG
// (red 2x2) so no network fetch is required.
const { test, expect } = require('@playwright/test');

// 2x2 solid-red PNG, base64. Small enough to paste anywhere; always loads.
const RED_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAHElEQVQI12P8z8DwnwEJMDExMiJznABBNgYGBjYAIn8FAd4nYWsAAAAASUVORK5CYII=';

async function renderSlide(page, slideBody) {
  const md = '# Deck\n\n```slide\n' + slideBody + '\n```\n';
  await page.goto('/');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function');
  await page.evaluate((body) => {
    window.SDocs.currentBody = body;
    window.SDocs.render();
  }, md);
  await page.waitForTimeout(200);
}

test.describe('Slide image shape (i)', () => {
  test('renders an <img> with the given src and single-token alt', async ({ page }) => {
    // alt= is split on whitespace like every attr; for multi-word alt use | content.
    await renderSlide(page, `grid 16 9\ni 1 1 4 3 src=${RED_PNG} alt=logo`);
    const info = await page.evaluate(() => {
      const img = document.querySelector('.sdoc-slide .shape-img img');
      if (!img) return null;
      return { src: img.src, alt: img.alt, loaded: img.complete && img.naturalWidth > 0 };
    });
    expect(info).not.toBeNull();
    expect(info.src).toContain('data:image/png');
    expect(info.alt).toBe('logo');
    expect(info.loaded).toBe(true);
  });

  test('image fills the shape box; object-fit is contain', async ({ page }) => {
    await renderSlide(page, `grid 16 9\ni 0 0 8 4 src=${RED_PNG}`);
    const metrics = await page.evaluate(() => {
      const host = document.querySelector('.sdoc-slide .shape-img');
      const img = host && host.querySelector('img');
      if (!host || !img) return null;
      return {
        // img inherits host size (100% / 100%)
        fit: getComputedStyle(img).objectFit,
        imgW: img.clientWidth,
        imgH: img.clientHeight,
        hostW: host.clientWidth,
        hostH: host.clientHeight,
      };
    });
    expect(metrics.fit).toBe('contain');
    expect(metrics.imgW).toBe(metrics.hostW);
    expect(metrics.imgH).toBe(metrics.hostH);
  });

  test('| content is used as alt when alt= is not set', async ({ page }) => {
    await renderSlide(page, `grid 16 9\ni 0 0 4 4 src=${RED_PNG} | fallback alt via content`);
    const alt = await page.evaluate(() => {
      const img = document.querySelector('.sdoc-slide .shape-img img');
      return img ? img.alt : null;
    });
    expect(alt).toBe('fallback alt via content');
  });

  test('explicit alt= wins over | content', async ({ page }) => {
    await renderSlide(page, `grid 16 9\ni 0 0 4 4 src=${RED_PNG} alt=Explicit | should be ignored`);
    const alt = await page.evaluate(() => {
      const img = document.querySelector('.sdoc-slide .shape-img img');
      return img ? img.alt : null;
    });
    expect(alt).toBe('Explicit');
  });

  test('i honours layer=bottom / layer=top (stacking still works)', async ({ page }) => {
    await renderSlide(page, [
      'grid 16 9',
      `i 0 0 16 9 src=${RED_PNG} layer=bottom`,
      'r 4 3 8 3 fill=#fff | On top of image',
    ].join('\n'));
    const idx = await page.evaluate(() => {
      const img = document.querySelector('.shape-img');
      const sublayer = img && img.closest('.sd-stage-sublayer');
      if (!sublayer) return -1;
      const parent = sublayer.parentElement;
      return Array.from(parent.querySelectorAll(':scope > .sd-stage-sublayer')).indexOf(sublayer);
    });
    expect(idx).toBe(0); // bottom
  });

  test('i without src renders an empty frame (no <img>, no error badge)', async ({ page }) => {
    await renderSlide(page, `grid 16 9\ni 1 1 4 3`);
    const counts = await page.evaluate(() => ({
      images: document.querySelectorAll('.sdoc-slide .shape-img img').length,
      frames: document.querySelectorAll('.sdoc-slide .shape-img').length,
      errors: document.querySelectorAll('.sdoc-slide-errbadge').length,
    }));
    expect(counts.frames).toBe(1);
    expect(counts.images).toBe(0);
    expect(counts.errors).toBe(0);
  });
});
