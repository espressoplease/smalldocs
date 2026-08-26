// @ts-check
// Interaction model for slide thumbnails: the per-slide "present"
// button opens presentation mode; the slide body itself does NOT,
// which is what enables users to select/copy text inside shapes.
const { test, expect } = require('@playwright/test');

async function renderDeck(page, slideBodies) {
  const md = '# Deck\n\n' + slideBodies.map((b) => '```slide\n' + b + '\n```').join('\n\n');
  await page.goto('/docs');
  await page.waitForFunction(() => !!window.SDocs && typeof window.SDocs.render === 'function');
  await page.evaluate((body) => {
    window.SDocs.currentBody = body;
    window.SDocs.render();
  }, md);
  await page.waitForTimeout(200);
}

test.describe('Slide interaction model', () => {
  test('each slide renders a present button', async ({ page }) => {
    await renderDeck(page, [
      'grid 100 56.25\nr 10 10 80 40 | One',
      'grid 100 56.25\nr 10 10 80 40 | Two',
    ]);
    const count = await page.locator('.sdoc-slide-present').count();
    expect(count).toBe(2);
    await expect(page.locator('.sdoc-slide-present').first()).toHaveAttribute('title', 'Present');
  });

  test('an asynchronous error stays with the slide that emitted it', async ({ page }) => {
    await renderDeck(page, [
      'grid 100 56.25\nr 10 10 80 40 | One',
      'grid 100 56.25\nr 10 10 80 40 | Two',
    ]);
    await page.locator('.sdoc-slide').first().evaluate((slide) => {
      slide.dispatchEvent(new CustomEvent('sdoc-slide-error', {
        bubbles: true,
        detail: { source: 'test', message: 'belongs to slide one' },
      }));
    });
    await expect(page.locator('.sdoc-slide').first().locator('.sdoc-slide-errbadge')).toContainText('belongs to slide one');
    await expect(page.locator('.sdoc-slide').nth(1).locator('.sdoc-slide-errbadge')).toHaveCount(0);
  });

  test('presentation clamps at deck boundaries', async ({ page }) => {
    await renderDeck(page, [
      'grid 100 56.25\nr 10 10 80 40 | One',
      'grid 100 56.25\nr 10 10 80 40 | Two',
    ]);
    await page.locator('.sdoc-slide-present').first().click();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.sdoc-present-counter')).toHaveText('1 / 2');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.sdoc-present-counter')).toHaveText('2 / 2');
  });

  test('presentation refresh rebuilds the rail and clamps a shortened deck', async ({ page }) => {
    await renderDeck(page, [
      'grid 100 56.25\nr 10 10 80 40 | One',
      'grid 100 56.25\nr 10 10 80 40 | Two',
      'grid 100 56.25\nr 10 10 80 40 | Three',
    ]);
    await page.locator('.sdoc-slide-present').nth(2).click();
    await page.evaluate(() => {
      window.SDocs.currentBody = '# Short deck\n\n```slide\ngrid 100 56.25\nr 10 10 80 40 | Only\n```';
      window.SDocs.render();
    });
    await expect(page.locator('.sdoc-present-counter')).toHaveText('1 / 1');
    await expect(page.locator('.sdoc-present-thumb')).toHaveCount(1);
    await expect(page.locator('.sdoc-present-stage')).toContainText('Only');
  });

  test('presentation closes when refresh removes every slide', async ({ page }) => {
    await renderDeck(page, ['grid 100 56.25\nr 10 10 80 40 | One']);
    await page.locator('.sdoc-slide-present').evaluate((button) => button.click());
    await page.evaluate(() => {
      window.SDocs.currentBody = '# No deck\n\nPlain text.';
      window.SDocs.render();
    });
    await expect(page.locator('.sdoc-present')).toHaveCount(0);
  });

  test('Space activates a focused presentation control instead of advancing the deck', async ({ page }) => {
    await renderDeck(page, [
      'grid 100 56.25\nr 10 10 80 40 | One',
      'grid 100 56.25\nr 10 10 80 40 | Two',
    ]);
    await page.locator('.sdoc-slide-present').first().click();
    await page.locator('.sdoc-present-close').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.sdoc-present')).toHaveCount(0);
  });

  test('closing presentation restores horizontal and vertical scroll', async ({ page }) => {
    await renderDeck(page, ['grid 100 56.25\nr 10 10 80 40 | One']);
    await page.evaluate(() => {
      document.body.style.width = '220vw';
      document.body.style.minHeight = '220vh';
      window.scrollTo(180, 240);
    });
    await expect.poll(() => page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([180, 240]);
    await page.locator('.sdoc-slide-present').evaluate((button) => button.click());
    await page.locator('.sdoc-present-close').click();
    await expect.poll(() => page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([180, 240]);
  });

  test('clicking the present button opens presentation mode', async ({ page }) => {
    await renderDeck(page, [
      'grid 100 56.25\nr 10 10 80 40 fill=#2563eb color=#fff | Hello world',
    ]);
    await expect(page.locator('.sdoc-present')).toHaveCount(0);
    await page.locator('.sdoc-slide-present').first().click();
    await expect(page.locator('.sdoc-present')).toHaveCount(1);
  });

  test('clicking the slide body (not the button) does NOT open presentation', async ({ page }) => {
    await renderDeck(page, [
      'grid 100 56.25\nr 10 10 80 40 fill=#2563eb color=#fff | Selectable text',
    ]);
    const shapeRect = page.locator('.sdoc-slide .shape-rect').first();
    await shapeRect.click();
    await page.waitForTimeout(150);
    await expect(page.locator('.sdoc-present')).toHaveCount(0);
  });

  test('text inside a shape is user-selectable (pointer-events not disabled)', async ({ page }) => {
    await renderDeck(page, [
      'grid 100 56.25\nr 10 10 80 40 fill=#2563eb color=#fff | Selectable text',
    ]);
    // Simulate a user dragging to select by calling document.getSelection
    // against the shape-md's shadow DOM. If pointer-events were still
    // disabled we wouldn't be able to select in the browser; at minimum
    // the computed style on the stage should not be none.
    const pe = await page.evaluate(() => {
      const stage = document.querySelector('.sdoc-slide .sd-shape-stage');
      return getComputedStyle(stage).pointerEvents;
    });
    expect(pe).not.toBe('none');

    // The shape-rect itself must have pointer-events: auto (the sublayer
    // parent is pointer-events:none so empty areas don't steal clicks from
    // shapes below; rect children opt back in so text selection works).
    const rectPe = await page.evaluate(() => {
      const r = document.querySelector('.sdoc-slide .shape-rect');
      return getComputedStyle(r).pointerEvents;
    });
    expect(rectPe).toBe('auto');
  });

  test('slide wrapper has no role=button / tabindex (it is not the activator anymore)', async ({ page }) => {
    await renderDeck(page, ['grid 100 56.25\nr 10 10 80 40 | x']);
    const attrs = await page.evaluate(() => {
      const s = document.querySelector('.sdoc-slide');
      return { role: s.getAttribute('role'), tabindex: s.getAttribute('tabindex') };
    });
    expect(attrs.role).toBeNull();
    expect(attrs.tabindex).toBeNull();
  });

  test('a text-bearing shape gets a per-element copy button, hidden until hover', async ({ page }) => {
    await renderDeck(page, ['grid 100 56.25\nr 10 10 80 40 fill=#1e40af color=#fff | Copy me']);
    const rect = page.locator('.sdoc-slide .shape-rect').first();
    const btn = rect.locator('.sd-shape-copy-btn');
    await expect(btn).toHaveCount(1);
    // Hidden (display:none) until the shape is hovered.
    expect(await btn.evaluate((b) => getComputedStyle(b).display)).toBe('none');
    await rect.hover();
    await expect.poll(() => btn.evaluate((b) => getComputedStyle(b).display)).not.toBe('none');
  });

  test('copy button contrast class flips with the shape fill luminance', async ({ page }) => {
    await renderDeck(page, [
      'grid 100 56.25\nr 5 5 40 40 fill=#0b1f3a color=#fff | Dark panel',
      'grid 100 56.25\nr 5 5 40 40 fill=#f59e0b color=#111 | Light panel',
    ]);
    const dark = await page.locator('.sdoc-slide').nth(0).locator('.shape-rect .sd-shape-copy-btn').first()
      .evaluate((b) => b.className);
    const light = await page.locator('.sdoc-slide').nth(1).locator('.shape-rect .sd-shape-copy-btn').first()
      .evaluate((b) => b.className);
    expect(dark).toContain('is-dark');   // dark fill -> light icon
    expect(light).toContain('is-light'); // light fill -> dark icon
  });
});
