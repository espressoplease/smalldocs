// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

async function gotoPlayground(page) {
  await page.goto(BASE + '/shapes');
  await page.waitForSelector('#dsl');
  await page.waitForSelector('#stage');
}

async function setDSL(page, src) {
  await page.evaluate((s) => {
    const ta = /** @type {HTMLTextAreaElement} */ (document.getElementById('dsl'));
    ta.value = s;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, src);
}

async function stageBox(page) {
  return page.evaluate(() => {
    const el = document.getElementById('stage');
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height, left: r.left, top: r.top };
  });
}

test.describe('shape playground', () => {
  test('page loads with textarea, stage, and svg overlay', async ({ page }) => {
    await gotoPlayground(page);
    await expect(page.locator('#dsl')).toBeVisible();
    await expect(page.locator('#stage')).toBeVisible();
    await expect(page.locator('#stage .shape-svg')).toBeAttached();
  });

  test('default aspect is 16:9 (empty DSL → default grid)', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, '');
    const box = await stageBox(page);
    const ratio = box.width / box.height;
    // 16:9 = 1.777...
    expect(ratio).toBeGreaterThan(1.77);
    expect(ratio).toBeLessThan(1.78);
  });

  test('grid line in DSL drives stage aspect', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'grid 100 75\nr 0 0 50 50');
    const box = await stageBox(page);
    const ratio = box.width / box.height;
    // 4:3 = 1.333...
    expect(ratio).toBeGreaterThan(1.32);
    expect(ratio).toBeLessThan(1.34);
  });

  test('grid info shown in header reflects DSL', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'grid 160 90\nr 0 0 10 10');
    await expect(page.locator('#grid-info')).toHaveText('grid 160 × 90');
  });

  test('stage preserves aspect ratio under a short viewport', async ({ page }) => {
    // Viewport short enough that max-height would have clamped the old CSS.
    await page.setViewportSize({ width: 800, height: 400 });
    await gotoPlayground(page);
    await setDSL(page, 'grid 400 225\nr 0 0 400 225');
    const box = await stageBox(page);
    const ratio = box.width / box.height;
    // 400/225 = 1.777...
    expect(ratio).toBeGreaterThan(1.77);
    expect(ratio).toBeLessThan(1.78);
    // Full-width rect should still span the full stage
    const rect = await page.locator('#stage .shape-rect').first().boundingBox();
    expect(rect.width).toBeCloseTo(box.width, 0);
    expect(rect.height).toBeCloseTo(box.height, 0);
  });

  test('stage preserves aspect ratio under a tall narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 1400 });
    await gotoPlayground(page);
    await setDSL(page, 'grid 100 75\nr 0 0 100 75');
    const box = await stageBox(page);
    const ratio = box.width / box.height;
    // 100/75 = 1.333...
    expect(ratio).toBeGreaterThan(1.32);
    expect(ratio).toBeLessThan(1.34);
  });

  test('big grid (400 × 225) still maps coords correctly', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'grid 400 225\nr 0 0 400 225');
    const stage = await stageBox(page);
    const rect = await page.locator('#stage .shape-rect').first().boundingBox();
    // Full-width rect should match stage size
    expect(rect.width).toBeCloseTo(stage.width, 0);
    expect(rect.height).toBeCloseTo(stage.height, 0);
  });

  test('invalid grid surfaces error and falls back to default', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'grid 100\nr 0 0 10 10');
    await expect(page.locator('#errors')).toContainText('expected "grid W H"');
    // Still renders shape on default grid
    await expect(page.locator('#stage .shape-rect')).toHaveCount(1);
  });

  test('rectangle filling full canvas matches stage dimensions', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'r 0 0 100 56.25');
    const stage = await stageBox(page);
    const rect = await page.locator('#stage .shape-rect').first().boundingBox();
    expect(rect.width).toBeCloseTo(stage.width, 0);
    expect(rect.height).toBeCloseTo(stage.height, 0);
  });

  test('rectangle at 10,10 30x30 lands at expected proportional position', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'r 10 10 30 30');
    const stage = await stageBox(page);
    const rect = await page.locator('#stage .shape-rect').first().boundingBox();
    // x=10 out of 100 = 10% of stage width
    expect(rect.x - stage.left).toBeCloseTo(stage.width * 0.10, 0);
    // y=10 out of 56.25 ~= 17.78% of stage height
    expect(rect.y - stage.top).toBeCloseTo(stage.height * (10 / 56.25), 0);
    expect(rect.width).toBeCloseTo(stage.width * 0.30, 0);
    expect(rect.height).toBeCloseTo(stage.height * (30 / 56.25), 0);
  });

  test('rectangle has rounded corners by default', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'r 10 10 30 30');
    const radius = await page.locator('#stage .shape-rect').evaluate((el) => {
      return getComputedStyle(el).borderRadius;
    });
    // Should not be 0px
    expect(radius).not.toBe('0px');
    expect(radius).not.toBe('');
  });

  test('rectangle radius attribute overrides default', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'r 10 10 30 30 radius=0');
    const radius = await page.locator('#stage .shape-rect').evaluate((el) => {
      return getComputedStyle(el).borderRadius;
    });
    // `0%` and `0px` both represent zero; check numerically.
    expect(parseFloat(radius)).toBe(0);
  });

  test('circle renders as SVG <circle> with correct coords', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'c 50 28 10');
    const el = page.locator('#stage svg circle');
    await expect(el).toHaveAttribute('cx', '50');
    await expect(el).toHaveAttribute('cy', '28');
    await expect(el).toHaveAttribute('r', '10');
  });

  test('ellipse renders as SVG <ellipse>', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'e 50 28 20 10');
    const el = page.locator('#stage svg ellipse');
    await expect(el).toHaveAttribute('rx', '20');
    await expect(el).toHaveAttribute('ry', '10');
  });

  test('line renders as SVG <line>', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'l 0 28 100 28');
    const el = page.locator('#stage svg line');
    await expect(el).toHaveAttribute('x1', '0');
    await expect(el).toHaveAttribute('x2', '100');
  });

  test('arrow renders as line with marker-end', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'a 10 28 90 28');
    const line = page.locator('#stage svg g line').first();
    await expect(line).toHaveAttribute('marker-end', 'url(#_sd_arrowhead)');
    // Defs with arrowhead marker present
    await expect(page.locator('#stage svg defs marker#_sd_arrowhead')).toBeAttached();
  });

  test('polygon renders as SVG <path> with a d attribute', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'p 10,10 90,10 90,50 10,50');
    const el = page.locator('#stage svg path');
    const d = await el.getAttribute('d');
    expect(d).toBeTruthy();
    expect(d).toMatch(/^M 10 10/);
    expect(d).toContain('L 90 10');
    expect(d).toMatch(/Z$/);
  });

  test('polygon with ~ uses quadratic curve (Q in path)', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'p 10,10 90,10 ~ 90,50 10,50');
    const d = await page.locator('#stage svg path').getAttribute('d');
    expect(d).toContain('Q');
  });

  test('multiple shapes all render and count updates', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'r 0 0 100 10\nc 50 28 8\nl 0 50 100 50');
    await expect(page.locator('#stage .shape-rect')).toHaveCount(1);
    await expect(page.locator('#stage svg circle')).toHaveCount(1);
    await expect(page.locator('#stage svg line')).toHaveCount(1);
    await expect(page.locator('#shape-count')).toHaveText('3 shapes');
  });

  test('invalid DSL line shown in errors, valid shapes still render', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'r 10 10 30 30\nx 1 2 3');
    await expect(page.locator('#stage .shape-rect')).toHaveCount(1);
    await expect(page.locator('#errors .err')).toHaveCount(1);
    await expect(page.locator('#errors')).toContainText('line 2');
    await expect(page.locator('#errors')).toContainText('Unknown shape');
  });

  test('empty DSL clears the stage', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, '');
    await expect(page.locator('#stage .shape-rect')).toHaveCount(0);
    await expect(page.locator('#stage svg circle')).toHaveCount(0);
    await expect(page.locator('#shape-count')).toHaveText('0 shapes');
  });

  test('content after | renders as text inside rectangle', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'r 10 10 80 30 | Hello world');
    await expect(page.locator('#stage .shape-rect')).toContainText('Hello world');
  });

  test('fill attribute applies to rectangle', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'r 10 10 30 30 fill=#ff0000');
    const bg = await page.locator('#stage .shape-rect').evaluate((el) => {
      return getComputedStyle(el).backgroundColor;
    });
    expect(bg).toBe('rgb(255, 0, 0)');
  });

  test('fill attribute applies to circle', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'c 50 28 10 fill=#00ff00');
    const el = page.locator('#stage svg circle');
    await expect(el).toHaveAttribute('fill', '#00ff00');
  });

  // ── Phase 2: reference resolution ────────────────────

  test('arrow @a @b endpoints land at shape centers', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, [
      'r 0 0 20 20 #a',
      'r 80 40 20 20 #b',
      'a @a @b',
    ].join('\n'));
    const line = page.locator('#stage svg g line').first();
    // Center of a = (10, 10); center of b = (90, 50)
    await expect(line).toHaveAttribute('x1', '10');
    await expect(line).toHaveAttribute('y1', '10');
    await expect(line).toHaveAttribute('x2', '90');
    await expect(line).toHaveAttribute('y2', '50');
  });

  test('@a.right anchors arrow start at right edge', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, [
      'r 10 20 20 20 #a',
      'a @a.right 90 30',
    ].join('\n'));
    const line = page.locator('#stage svg g line').first();
    // right edge: x = 10+20 = 30; y = 20 + 20/2 = 30
    await expect(line).toHaveAttribute('x1', '30');
    await expect(line).toHaveAttribute('y1', '30');
  });

  test('circle placed at ref center', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, [
      'r 40 20 20 20 #box',
      'c @box 3',
    ].join('\n'));
    const circle = page.locator('#stage svg circle');
    // box center = (50, 30)
    await expect(circle).toHaveAttribute('cx', '50');
    await expect(circle).toHaveAttribute('cy', '30');
  });

  test('unknown ref id surfaces error, other shapes still render', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, [
      'r 0 0 20 20 #a',
      'a @ghost @a',
    ].join('\n'));
    await expect(page.locator('#stage .shape-rect')).toHaveCount(1);
    await expect(page.locator('#errors')).toContainText('unknown id');
  });

  test('cycle between two refs surfaces error', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, [
      'c @b 5 #a',
      'c @a 5 #b',
    ].join('\n'));
    await expect(page.locator('#errors')).toContainText('cycle');
  });

  test('polygon point can be a ref', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, [
      'r 0 0 20 20 #a',
      'p @a 50,50 90,10',
    ].join('\n'));
    // path d should start at a's center (10, 10)
    const d = await page.locator('#stage svg path').getAttribute('d');
    expect(d).toMatch(/^M 10 10/);
  });

  // ── Phase 3: text in non-rect shapes + auto-fit ─────

  test('circle with content renders a text overlay', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'c 50 28 10 | Hello');
    await expect(page.locator('#stage .shape-text')).toHaveCount(1);
    await expect(page.locator('#stage .shape-text')).toContainText('Hello');
  });

  test('ellipse with content renders a text overlay', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'e 50 28 20 10 | Ellipse');
    await expect(page.locator('#stage .shape-text')).toContainText('Ellipse');
  });

  test('polygon with content renders a text overlay', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'p 10,10 90,10 90,40 10,40 | Polygon');
    await expect(page.locator('#stage .shape-text')).toContainText('Polygon');
  });

  test('line with content does NOT render text (decorative)', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'l 10 10 90 10 | Should not appear');
    await expect(page.locator('#stage .shape-text')).toHaveCount(0);
  });

  test('arrow with content does NOT render text (decorative)', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'a 10 10 90 10 | Should not appear');
    await expect(page.locator('#stage .shape-text')).toHaveCount(0);
  });

  test('auto-fit produces smaller font for same text in smaller shape', async ({ page }) => {
    await gotoPlayground(page);
    // Two shapes, same text, different sizes. Smaller shape must get smaller font.
    await setDSL(page, [
      'grid 100 56.25',
      'r 0 0 50 25 #big   | The quick brown fox jumps over the lazy dog',
      'r 60 0 20 10 #small | The quick brown fox jumps over the lazy dog',
    ].join('\n'));
    await page.waitForTimeout(50);
    const sizes = await page.evaluate(() => {
      const get = id => parseFloat(getComputedStyle(document.querySelector(`[data-id="${id}"]`)).fontSize);
      return { big: get('big'), small: get('small') };
    });
    expect(sizes.small).toBeLessThan(sizes.big);
    expect(sizes.small).toBeGreaterThanOrEqual(8);
  });

  test('auto-fit grows font for short text in large shape', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, [
      'grid 100 56.25',
      'r 0 0 100 56.25 | Hi',
    ].join('\n'));
    await page.waitForTimeout(50);
    const size = await page.locator('#stage .shape-rect').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    // On our default Playwright viewport the stage is ~796px wide; a single
    // "Hi" glyph should comfortably auto-fit well above the 14px baseline.
    expect(size).toBeGreaterThan(30);
  });

  test('auto-fit text stays bounded after viewport resize (cqh-based font)', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, [
      'grid 100 56.25',
      'r 10 10 40 20 | Medium amount of text in a rectangle',
    ].join('\n'));
    await page.waitForTimeout(50);
    // Grab the initial font-size unit and fitted pixel size.
    const initial = await page.locator('#stage .shape-rect').evaluate(el => ({
      inlineFs: el.style.fontSize,
      computedFs: parseFloat(getComputedStyle(el).fontSize),
      scrollW: el.scrollWidth, clientW: el.clientWidth,
      scrollH: el.scrollHeight, clientH: el.clientHeight,
    }));
    // Font should be written in cqh so it tracks stage size.
    expect(initial.inlineFs).toMatch(/cqh$/);
    expect(initial.scrollW).toBeLessThanOrEqual(initial.clientW + 1);
    expect(initial.scrollH).toBeLessThanOrEqual(initial.clientH + 1);

    // Shrink the viewport and verify the text is still bounded.
    await page.setViewportSize({ width: 700, height: 420 });
    await page.waitForTimeout(50);
    const after = await page.locator('#stage .shape-rect').evaluate(el => ({
      computedFs: parseFloat(getComputedStyle(el).fontSize),
      scrollW: el.scrollWidth, clientW: el.clientWidth,
      scrollH: el.scrollHeight, clientH: el.clientHeight,
    }));
    expect(after.computedFs).toBeLessThan(initial.computedFs);  // font shrank with stage
    expect(after.scrollW).toBeLessThanOrEqual(after.clientW + 1);
    expect(after.scrollH).toBeLessThanOrEqual(after.clientH + 1);
  });

  test('default padding keeps text off the rect edges', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'grid 100 56.25\nr 10 10 40 20 | Hello');
    await page.waitForTimeout(50);
    const padding = await page.locator('#stage .shape-rect').evaluate(el => {
      const cs = getComputedStyle(el);
      return { top: parseFloat(cs.paddingTop), left: parseFloat(cs.paddingLeft) };
    });
    // Default is 5% of min(40,20)=20 grid units = 1 grid unit. In stage
    // px (grid 100 wide), 1 unit is ~stageWidth/100 ≈ 7.96px.
    expect(padding.top).toBeGreaterThan(3);
    expect(padding.left).toBeGreaterThan(3);
  });

  test('padding=0 overrides to no padding', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'grid 100 56.25\nr 10 10 40 20 padding=0 | Hello');
    await page.waitForTimeout(50);
    const padding = await page.locator('#stage .shape-rect').evaluate(el => {
      const cs = getComputedStyle(el);
      return { top: parseFloat(cs.paddingTop), left: parseFloat(cs.paddingLeft) };
    });
    expect(padding.top).toBe(0);
    expect(padding.left).toBe(0);
  });

  test('padding=N sets N grid units of padding on all sides', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'grid 100 56.25\nr 10 10 40 20 padding=4 | Hello');
    await page.waitForTimeout(50);
    const info = await page.evaluate(() => {
      const stage = document.getElementById('stage');
      const el = document.querySelector('#stage .shape-rect');
      const cs = getComputedStyle(el);
      return {
        stageWidth: stage.getBoundingClientRect().width,
        stageHeight: stage.getBoundingClientRect().height,
        padTop: parseFloat(cs.paddingTop),
        padBottom: parseFloat(cs.paddingBottom),
        padLeft: parseFloat(cs.paddingLeft),
        padRight: parseFloat(cs.paddingRight),
      };
    });
    // 4 grid units × stage / grid-size
    const expectH = 4 / 100 * info.stageWidth;
    const expectV = 4 / 56.25 * info.stageHeight;
    // Aspect is preserved so horizontal and vertical pixel padding should be equal.
    expect(info.padTop).toBeCloseTo(expectV, 0);
    expect(info.padLeft).toBeCloseTo(expectH, 0);
    expect(info.padTop).toBeCloseTo(info.padLeft, 0);  // visually square
  });

  test('padding applies to circle text overlays too', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'grid 100 56.25\nc 50 28 10 padding=1 | Hi');
    await page.waitForTimeout(50);
    const pad = await page.locator('#stage .shape-text').evaluate(el => parseFloat(getComputedStyle(el).paddingTop));
    expect(pad).toBeGreaterThan(3);
  });

  test('auto-fit text does not overflow its element', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, [
      'grid 100 56.25',
      'r 10 10 40 20 | Quite a bit of text in a medium-sized rectangle',
    ].join('\n'));
    await page.waitForTimeout(50);
    const overflow = await page.locator('#stage .shape-rect').evaluate(el => ({
      scrollW: el.scrollWidth, clientW: el.clientWidth,
      scrollH: el.scrollHeight, clientH: el.clientHeight,
    }));
    expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW + 1);
    expect(overflow.scrollH).toBeLessThanOrEqual(overflow.clientH + 1);
  });

  // ── Markdown rendering inside shapes ────────────────

  test('markdown: # heading in rect renders as <h1>', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'grid 100 56.25\nr 10 10 80 40 | # Big title');
    await expect(page.locator('#stage .shape-rect .shape-md h1')).toContainText('Big title');
  });

  test('markdown: bullets render as <ul>/<li>', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, [
      'grid 100 56.25',
      'r 10 10 80 40 |',
      '  - One',
      '  - Two',
      '  - Three',
    ].join('\n'));
    await expect(page.locator('#stage .shape-rect .shape-md ul li')).toHaveCount(3);
  });

  test('markdown: **bold** and *italic* render as <strong>/<em>', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'grid 100 56.25\nr 10 10 80 30 | **Bold** and *italic*');
    await expect(page.locator('#stage .shape-rect strong')).toContainText('Bold');
    await expect(page.locator('#stage .shape-rect em')).toContainText('italic');
  });

  test('markdown: renders inside circle overlay', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, 'grid 100 56.25\nc 50 28 15 | # Title\n  normal text');
    await expect(page.locator('#stage .shape-text .shape-md h1')).toContainText('Title');
  });

  test('markdown: multi-line content joins with newlines', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, [
      'grid 100 56.25',
      'r 10 10 80 40 |',
      '  ## Heading',
      '  paragraph after',
    ].join('\n'));
    await expect(page.locator('#stage .shape-rect h2')).toContainText('Heading');
    await expect(page.locator('#stage .shape-rect p')).toContainText('paragraph after');
  });

  test('markdown: auto-fit still keeps content bounded', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, [
      'grid 100 56.25',
      'r 10 10 40 25 |',
      '  ## Wins',
      '  - Shipped **X**',
      '  - Launched **Y**',
    ].join('\n'));
    await page.waitForTimeout(80);
    const overflow = await page.locator('#stage .shape-rect').evaluate((el) => ({
      scrollW: el.scrollWidth, clientW: el.clientWidth,
      scrollH: el.scrollHeight, clientH: el.clientHeight,
    }));
    expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW + 1);
    expect(overflow.scrollH).toBeLessThanOrEqual(overflow.clientH + 1);
  });

  test('chain resolution: arrow from shape anchored to another', async ({ page }) => {
    await gotoPlayground(page);
    await setDSL(page, [
      'r 10 10 20 20 #a',
      'c @a 10 #b',
      'a @b @a.topright',
    ].join('\n'));
    const line = page.locator('#stage svg g line').first();
    // b center = a center = (20, 20); a topright = (30, 10)
    await expect(line).toHaveAttribute('x1', '20');
    await expect(line).toHaveAttribute('y1', '20');
    await expect(line).toHaveAttribute('x2', '30');
    await expect(line).toHaveAttribute('y2', '10');
  });
});
