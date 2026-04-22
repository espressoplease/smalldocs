// @ts-check
// Tests for the image-fill attribute (image= / src=) on every shape kind.
// Uses a tiny inline data-URI PNG (red 2x2) so no network fetch is required.
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

test.describe('Image fill on any shape', () => {
  test('rect with image= gets a background-image in CSS', async ({ page }) => {
    await renderSlide(page, `grid 16 9\nr 1 1 8 4 image=${RED_PNG}`);
    const info = await page.evaluate(() => {
      const el = document.querySelector('.sdoc-slide .shape-rect');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        bgImage: cs.backgroundImage,
        bgSize: cs.backgroundSize,
        bgRepeat: cs.backgroundRepeat,
      };
    });
    expect(info).not.toBeNull();
    expect(info.bgImage).toContain('data:image/png');
    expect(info.bgSize).toBe('cover');
    expect(info.bgRepeat).toBe('no-repeat');
  });

  test('i x y w h src=URL is sugar for a rect with background-image', async ({ page }) => {
    await renderSlide(page, `grid 16 9\ni 1 1 8 4 src=${RED_PNG}`);
    const info = await page.evaluate(() => {
      const el = document.querySelector('.sdoc-slide .shape-rect');
      if (!el) return null;
      return { bgImage: getComputedStyle(el).backgroundImage };
    });
    expect(info).not.toBeNull();
    expect(info.bgImage).toContain('data:image/png');
  });

  test('imageFit=contain overrides the default cover', async ({ page }) => {
    await renderSlide(page, `grid 16 9\nr 0 0 8 4 image=${RED_PNG} imageFit=contain`);
    const size = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.sdoc-slide .shape-rect')).backgroundSize
    );
    expect(size).toBe('contain');
  });

  test('circle with image= uses an SVG pattern fill', async ({ page }) => {
    await renderSlide(page, `grid 16 9\nc 8 4.5 3 image=${RED_PNG}`);
    const info = await page.evaluate(() => {
      const circle = document.querySelector('.sdoc-slide circle');
      if (!circle) return null;
      const fill = circle.getAttribute('fill') || '';
      const patId = fill.match(/url\(#([^)]+)\)/);
      const pat = patId ? document.querySelector('pattern#' + patId[1]) : null;
      const img = pat ? pat.querySelector('image') : null;
      return {
        fill,
        patternFound: !!pat,
        imageHref: img ? (img.getAttribute('href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href')) : null,
      };
    });
    expect(info).not.toBeNull();
    expect(info.fill).toMatch(/url\(#/);
    expect(info.patternFound).toBe(true);
    expect(info.imageHref).toContain('data:image/png');
  });

  test('polygon with image= uses an SVG pattern fill', async ({ page }) => {
    await renderSlide(page, `grid 16 9\np 4,1 12,1 8,7 image=${RED_PNG}`);
    const info = await page.evaluate(() => {
      const paths = document.querySelectorAll('.sdoc-slide path');
      // The polygon is the only non-arrowhead path in this deck.
      let patternFound = false;
      for (const p of paths) {
        const fill = p.getAttribute('fill') || '';
        const m = fill.match(/url\(#([^)]+)\)/);
        if (m && document.querySelector('pattern#' + m[1])) { patternFound = true; break; }
      }
      return { patternFound };
    });
    expect(info.patternFound).toBe(true);
  });

  test('rect without image renders normally (no background-image)', async ({ page }) => {
    await renderSlide(page, `grid 16 9\nr 1 1 4 3 fill=#eee`);
    const bgImage = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.sdoc-slide .shape-rect')).backgroundImage
    );
    expect(bgImage).toBe('none');
  });
});
