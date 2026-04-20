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

  test('default aspect is 16:9', async ({ page }) => {
    await gotoPlayground(page);
    const box = await stageBox(page);
    const ratio = box.width / box.height;
    // 16:9 = 1.777...
    expect(ratio).toBeGreaterThan(1.77);
    expect(ratio).toBeLessThan(1.78);
  });

  test('aspect selector switches to 4:3', async ({ page }) => {
    await gotoPlayground(page);
    await page.selectOption('#aspect', '4:3');
    const box = await stageBox(page);
    const ratio = box.width / box.height;
    // 4:3 = 1.333...
    expect(ratio).toBeGreaterThan(1.32);
    expect(ratio).toBeLessThan(1.34);
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
});
