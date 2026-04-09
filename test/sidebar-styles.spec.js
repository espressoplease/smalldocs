// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

/**
 * Navigate to style mode with a blank document.
 * Returns the page with sidebar visible.
 */
async function gotoStyleMode(page) {
  await page.goto(BASE + '/#mode=style');
  await page.waitForSelector('#right');
  // Wait for app to init
  await page.waitForTimeout(500);
}

/**
 * Load a blank document so changes start from defaults.
 */
async function loadBlank(page) {
  await page.evaluate(() => {
    window.SDocs.loadText('# Test\n\nContent.', 'test.md');
  });
  await page.waitForTimeout(300);
}

/**
 * Get parsed front matter styles from the raw textarea.
 */
async function getStyles(page) {
  return page.evaluate(() => {
    const raw = document.getElementById('raw').value;
    const parsed = window.SDocYaml.parseFrontMatter(raw);
    return parsed.meta.styles || {};
  });
}

/**
 * Change a control value and trigger syncAll.
 */
async function setControl(page, id, value) {
  await page.evaluate(({ id, value }) => {
    const el = document.getElementById(id);
    if (!el) throw new Error('Control not found: ' + id);
    if (el.type === 'color') {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.tagName === 'SELECT') {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, { id, value });
  await page.waitForTimeout(200);
}

/**
 * Set a cascade color value (uses setColorValue which cascades).
 */
async function setColorControl(page, id, value) {
  await page.evaluate(({ id, value }) => {
    if (window.SDocs.setColorValue) {
      window.SDocs.setColorValue(id, value, true);
    } else {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    window.SDocs.syncAll('controls');
  }, { id, value });
  await page.waitForTimeout(200);
}

// ═══════════════════════════════════════════════════
//  GENERAL SETTINGS
// ═══════════════════════════════════════════════════

test.describe('General settings → front matter', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStyleMode(page);
    await loadBlank(page);
  });

  test('font family change updates front matter', async ({ page }) => {
    // Font selects need to match by option value, not bare name
    await page.evaluate(() => {
      const sel = document.getElementById('ctrl-font-family');
      const opt = Array.from(sel.options).find(o => o.textContent === 'Lora');
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await page.waitForTimeout(200);
    const s = await getStyles(page);
    expect(s.fontFamily).toBe('Lora');
  });

  test('base font size change updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-base-size-num', '18');
    const s = await getStyles(page);
    expect(s.baseFontSize).toBe(18);
  });

  test('line height change updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-line-height-num', '1.9');
    const s = await getStyles(page);
    expect(s.lineHeight).toBe(1.9);
  });
});

// ═══════════════════════════════════════════════════
//  COLOR SETTINGS
// ═══════════════════════════════════════════════════

test.describe('Color settings → front matter', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStyleMode(page);
    await loadBlank(page);
  });

  test('background color updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-bg-color', '#ff0000');
    const s = await getStyles(page);
    expect(s.background).toBe('#ff0000');
  });

  test('text color updates front matter', async ({ page }) => {
    await setColorControl(page, 'ctrl-color', '#ff0000');
    const s = await getStyles(page);
    expect(s.color).toBe('#ff0000');
  });

  test('heading color updates front matter', async ({ page }) => {
    await setColorControl(page, 'ctrl-h-color', '#aa0000');
    const s = await getStyles(page);
    expect(s.headers.color).toBe('#aa0000');
  });

  test('h1 color updates front matter', async ({ page }) => {
    await setColorControl(page, 'ctrl-h1-color', '#bb0000');
    const s = await getStyles(page);
    expect(s.h1.color).toBe('#bb0000');
  });

  test('h2 color updates front matter', async ({ page }) => {
    await setColorControl(page, 'ctrl-h2-color', '#cc0000');
    const s = await getStyles(page);
    expect(s.h2.color).toBe('#cc0000');
  });

  test('h3 color updates front matter', async ({ page }) => {
    await setColorControl(page, 'ctrl-h3-color', '#dd0000');
    const s = await getStyles(page);
    expect(s.h3.color).toBe('#dd0000');
  });

  test('h4 color updates front matter', async ({ page }) => {
    await setColorControl(page, 'ctrl-h4-color', '#ee0000');
    const s = await getStyles(page);
    expect(s.h4.color).toBe('#ee0000');
  });

  test('paragraph color updates front matter', async ({ page }) => {
    await setColorControl(page, 'ctrl-p-color', '#440000');
    const s = await getStyles(page);
    expect(s.p.color).toBe('#440000');
  });

  test('list color updates front matter', async ({ page }) => {
    await setColorControl(page, 'ctrl-list-color', '#550000');
    const s = await getStyles(page);
    expect(s.list.color).toBe('#550000');
  });

  test('link color updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-link-color', '#0000ff');
    const s = await getStyles(page);
    expect(s.link.color).toBe('#0000ff');
  });
});

// ═══════════════════════════════════════════════════
//  BLOCK COLOR SETTINGS
// ═══════════════════════════════════════════════════

test.describe('Block color settings → front matter', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStyleMode(page);
    await loadBlank(page);
  });

  test('block background updates front matter', async ({ page }) => {
    await setColorControl(page, 'ctrl-block-bg', '#1a1a2e');
    const s = await getStyles(page);
    expect(s.blocks).toBeTruthy();
    expect(s.blocks.background).toBe('#1a1a2e');
  });

  test('block text updates front matter', async ({ page }) => {
    await setColorControl(page, 'ctrl-block-text', '#c8c3bc');
    const s = await getStyles(page);
    expect(s.blocks).toBeTruthy();
    expect(s.blocks.color).toBe('#c8c3bc');
  });

  test('code background override updates front matter', async ({ page }) => {
    await setColorControl(page, 'ctrl-code-bg', '#282c34');
    const s = await getStyles(page);
    expect(s.code.background).toBe('#282c34');
  });

  test('code text override updates front matter', async ({ page }) => {
    await setColorControl(page, 'ctrl-code-color', '#abb2bf');
    const s = await getStyles(page);
    expect(s.code.color).toBe('#abb2bf');
  });

  test('blockquote background override updates front matter', async ({ page }) => {
    await setColorControl(page, 'ctrl-bq-bg', '#eee8e0');
    const s = await getStyles(page);
    expect(s.blockquote.background).toBe('#eee8e0');
  });

  test('blockquote text override updates front matter', async ({ page }) => {
    await setColorControl(page, 'ctrl-bq-color', '#555555');
    const s = await getStyles(page);
    expect(s.blockquote.color).toBe('#555555');
  });

  test('blockquote border color updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-bq-border-color', '#e11d48');
    const s = await getStyles(page);
    expect(s.blockquote.borderColor).toBe('#e11d48');
  });

  test('chart background override updates front matter', async ({ page }) => {
    await setColorControl(page, 'ctrl-chart-bg', '#0e4a1a');
    const s = await getStyles(page);
    expect(s.chart).toBeTruthy();
    expect(s.chart.background).toBe('#0e4a1a');
  });

  test('chart text override updates front matter', async ({ page }) => {
    await setColorControl(page, 'ctrl-chart-text', '#c8f0d8');
    const s = await getStyles(page);
    expect(s.chart).toBeTruthy();
    expect(s.chart.textColor).toBe('#c8f0d8');
  });

  test('chart accent updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-chart-accent', '#e11d48');
    const s = await getStyles(page);
    expect(s.chart).toBeTruthy();
    expect(s.chart.accent).toBe('#e11d48');
  });

  test('chart palette updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-chart-palette', 'warm');
    const s = await getStyles(page);
    expect(s.chart).toBeTruthy();
    expect(s.chart.palette).toBe('warm');
  });
});

// ═══════════════════════════════════════════════════
//  HEADER SETTINGS
// ═══════════════════════════════════════════════════

test.describe('Header settings → front matter', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStyleMode(page);
    await loadBlank(page);
  });

  test('header font family updates front matter', async ({ page }) => {
    await page.evaluate(() => {
      const sel = document.getElementById('ctrl-h-font-family');
      const opt = Array.from(sel.options).find(o => o.textContent === 'Playfair Display');
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await page.waitForTimeout(200);
    const s = await getStyles(page);
    expect(s.headers.fontFamily).toBe('Playfair Display');
  });

  test('header scale updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-h-scale-num', '1.3');
    const s = await getStyles(page);
    expect(s.headers.scale).toBe(1.3);
  });

  test('header margin bottom updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-h-mb-num', '0.8');
    const s = await getStyles(page);
    expect(s.headers.marginBottom).toBe(0.8);
  });

  test('h1 font size updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-h1-size-num', '2.5');
    const s = await getStyles(page);
    expect(s.h1.fontSize).toBe(2.5);
  });

  test('h1 font weight updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-h1-weight', '800');
    const s = await getStyles(page);
    expect(s.h1.fontWeight).toBe(800);
  });

  test('h2 font size updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-h2-size-num', '1.8');
    const s = await getStyles(page);
    expect(s.h2.fontSize).toBe(1.8);
  });

  test('h3 font size updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-h3-size-num', '1.4');
    const s = await getStyles(page);
    expect(s.h3.fontSize).toBe(1.4);
  });

  test('h4 font size updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-h4-size-num', '1.1');
    const s = await getStyles(page);
    expect(s.h4.fontSize).toBe(1.1);
  });
});

// ═══════════════════════════════════════════════════
//  PARAGRAPH SETTINGS
// ═══════════════════════════════════════════════════

test.describe('Paragraph settings → front matter', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStyleMode(page);
    await loadBlank(page);
  });

  test('paragraph line height updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-p-lh-num', '2.0');
    const s = await getStyles(page);
    expect(s.p.lineHeight).toBe(2);
  });

  test('paragraph margin bottom updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-p-mb-num', '1.5');
    const s = await getStyles(page);
    expect(s.p.marginBottom).toBe(1.5);
  });
});

// ═══════════════════════════════════════════════════
//  LINK SETTINGS
// ═══════════════════════════════════════════════════

test.describe('Link settings → front matter', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStyleMode(page);
    await loadBlank(page);
  });

  test('link decoration updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-link-decoration', 'none');
    const s = await getStyles(page);
    expect(s.link.decoration).toBe('none');
  });
});

// ═══════════════════════════════════════════════════
//  CODE SETTINGS
// ═══════════════════════════════════════════════════

test.describe('Code settings → front matter', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStyleMode(page);
    await loadBlank(page);
  });

  test('code font updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-code-font', "'Fira Mono', monospace");
    const s = await getStyles(page);
    expect(s.code.font).toBe('Fira Mono');
  });
});

// ═══════════════════════════════════════════════════
//  BLOCKQUOTE SETTINGS
// ═══════════════════════════════════════════════════

test.describe('Blockquote settings → front matter', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStyleMode(page);
    await loadBlank(page);
  });

  test('blockquote border width updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-bq-bw-num', '5');
    const s = await getStyles(page);
    expect(s.blockquote.borderWidth).toBe(5);
  });

  test('blockquote font size updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-bq-size-num', '0.9');
    const s = await getStyles(page);
    expect(s.blockquote.fontSize).toBe(0.9);
  });
});

// ═══════════════════════════════════════════════════
//  LIST SETTINGS
// ═══════════════════════════════════════════════════

test.describe('List settings → front matter', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStyleMode(page);
    await loadBlank(page);
  });

  test('list spacing updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-list-spacing-num', '0.6');
    const s = await getStyles(page);
    expect(s.list.spacing).toBe(0.6);
  });

  test('list indent updates front matter', async ({ page }) => {
    await setControl(page, 'ctrl-list-indent-num', '2.0');
    const s = await getStyles(page);
    expect(s.list.indent).toBe(2);
  });
});

// ═══════════════════════════════════════════════════
//  URL HASH UPDATE
// ═══════════════════════════════════════════════════

test.describe('Sidebar changes update URL hash', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStyleMode(page);
    await loadBlank(page);
  });

  test('changing background color adds md= to hash', async ({ page }) => {
    const hashBefore = await page.evaluate(() => window.location.hash);
    await setControl(page, 'ctrl-bg-color', '#ff0000');
    await page.waitForTimeout(1000); // hash update is debounced
    const hashAfter = await page.evaluate(() => window.location.hash);
    expect(hashAfter).toContain('md=');
  });

  test('changing font size adds md= to hash', async ({ page }) => {
    await setControl(page, 'ctrl-base-size-num', '20');
    await page.waitForTimeout(1000);
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toContain('md=');
  });
});
