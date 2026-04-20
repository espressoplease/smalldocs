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
