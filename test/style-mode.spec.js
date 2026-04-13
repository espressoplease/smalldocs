// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

// ── Helpers ──────────────────────────────────────────

/** Navigate to style mode and wait for the right panel to be visible */
async function gotoStyleMode(page) {
  await page.goto(BASE + '/#mode=style');
  await page.waitForSelector('#_sd_right', { state: 'visible' });
}

/** Open a panel section by clicking its header if not already open */
async function openSection(page, bodyId) {
  const body = page.locator('#' + bodyId);
  if (!(await body.evaluate(el => el.classList.contains('open')))) {
    await page.locator(`.panel-header[data-target="${bodyId}"]`).click();
    await expect(body).toHaveClass(/open/);
  }
}

/** Open a sub-section by clicking its sub-header if not already open */
async function openSubSection(page, subId) {
  const body = page.locator('#' + subId);
  if (!(await body.evaluate(el => el.classList.contains('open')))) {
    await page.locator(`.sub-header[data-target="${subId}"]`).click();
    await expect(body).toHaveClass(/open/);
  }
}

/** Read an inline CSS custom property from #_sd_rendered */
async function getCssVar(page, varName) {
  return page.evaluate(v => {
    return document.getElementById('_sd_rendered').style.getPropertyValue(v).trim();
  }, varName);
}

/** Read a control's current .value */
async function getCtrlValue(page, ctrlId) {
  return page.evaluate(id => document.getElementById(id).value, ctrlId);
}

/** Set a range input value and dispatch input event */
async function setRangeValue(page, id, value) {
  await page.evaluate(({ id, value }) => {
    const el = document.getElementById(id);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { id, value: String(value) });
}

/** Set a number input value and dispatch input event */
async function setNumberValue(page, id, value) {
  await page.evaluate(({ id, value }) => {
    const el = document.getElementById(id);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { id, value: String(value) });
}

/** Set a color input value and dispatch input + change events */
async function setColorValue(page, id, hex) {
  await page.evaluate(({ id, hex }) => {
    const el = document.getElementById(id);
    el.value = hex;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id, hex });
}

/** Set a select value and dispatch change event */
async function setSelectValue(page, id, value) {
  await page.evaluate(({ id, value }) => {
    const el = document.getElementById(id);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id, value });
}

/** Click a reset button by id */
async function clickReset(page, resetId) {
  await page.locator('#' + resetId).click();
}

// ═════════════════════════════════════════════════════
//  1. Style mode entry
// ═════════════════════════════════════════════════════

test.describe('Style mode entry', () => {
  test('body has style-mode class', async ({ page }) => {
    await gotoStyleMode(page);
    await expect(page.locator('body')).toHaveClass(/style-mode/);
  });

  test('right panel is visible', async ({ page }) => {
    await gotoStyleMode(page);
    await expect(page.locator('#_sd_right')).toBeVisible();
  });

  test('rendered panel is visible', async ({ page }) => {
    await gotoStyleMode(page);
    await expect(page.locator('#_sd_rendered')).toBeVisible();
  });

  test('General section is open by default', async ({ page }) => {
    await gotoStyleMode(page);
    await expect(page.locator('#_sd_body-general')).toHaveClass(/open/);
  });
});

// ═════════════════════════════════════════════════════
//  2. Range ↔ Number sync
// ═════════════════════════════════════════════════════

const RANGE_NUM_PAIRS = [
  ['_sd_ctrl-base-size-range',    '_sd_ctrl-base-size-num',    '20',  '_sd_body-general', null],
  ['_sd_ctrl-line-height-range',  '_sd_ctrl-line-height-num',  '2.0', '_sd_body-general', null],
  ['_sd_ctrl-h-scale-range',      '_sd_ctrl-h-scale-num',      '1.5', '_sd_body-headers', '_sd_sub-headers-general'],
  ['_sd_ctrl-h-mb-range',         '_sd_ctrl-h-mb-num',         '1.0', '_sd_body-headers', '_sd_sub-headers-general'],
  ['_sd_ctrl-h1-size-range',      '_sd_ctrl-h1-size-num',      '2.5', '_sd_body-headers', '_sd_sub-h1'],
  ['_sd_ctrl-h2-size-range',      '_sd_ctrl-h2-size-num',      '2.0', '_sd_body-headers', '_sd_sub-h2'],
  ['_sd_ctrl-h3-size-range',      '_sd_ctrl-h3-size-num',      '1.5', '_sd_body-headers', '_sd_sub-h3'],
  ['_sd_ctrl-h4-size-range',      '_sd_ctrl-h4-size-num',      '1.5', '_sd_body-headers', '_sd_sub-h4'],
  ['_sd_ctrl-p-lh-range',         '_sd_ctrl-p-lh-num',         '2.0', '_sd_body-paragraph', null],
  ['_sd_ctrl-p-mb-range',         '_sd_ctrl-p-mb-num',         '1.5', '_sd_body-paragraph', null],
  ['_sd_ctrl-bq-bw-range',        '_sd_ctrl-bq-bw-num',        '5',   '_sd_body-blockquote', null],
  ['_sd_ctrl-bq-size-range',      '_sd_ctrl-bq-size-num',      '1.2', '_sd_body-blockquote', null],
  ['_sd_ctrl-list-spacing-range', '_sd_ctrl-list-spacing-num', '0.8', '_sd_body-lists', null],
  ['_sd_ctrl-list-indent-range',  '_sd_ctrl-list-indent-num',  '2.5', '_sd_body-lists', null],
];

test.describe('Range → Number sync', () => {
  for (const [rangeId, numId, testVal, section, subSection] of RANGE_NUM_PAIRS) {
    test(`${rangeId} → ${numId}`, async ({ page }) => {
      await gotoStyleMode(page);
      await openSection(page, section);
      if (subSection) await openSubSection(page, subSection);
      await setRangeValue(page, rangeId, testVal);
      expect(parseFloat(await getCtrlValue(page, numId))).toBe(parseFloat(testVal));
    });
  }
});

test.describe('Number → Range sync', () => {
  for (const [rangeId, numId, testVal, section, subSection] of RANGE_NUM_PAIRS) {
    test(`${numId} → ${rangeId}`, async ({ page }) => {
      await gotoStyleMode(page);
      await openSection(page, section);
      if (subSection) await openSubSection(page, subSection);
      await setNumberValue(page, numId, testVal);
      expect(parseFloat(await getCtrlValue(page, rangeId))).toBe(parseFloat(testVal));
    });
  }
});

// ═════════════════════════════════════════════════════
//  3. CSS variable application — simple (value + suffix)
// ═════════════════════════════════════════════════════

test.describe('CSS variable application — simple', () => {
  test('base-size → --md-base-size (px suffix)', async ({ page }) => {
    await gotoStyleMode(page);
    await setNumberValue(page, '_sd_ctrl-base-size-num', '20');
    expect(await getCssVar(page, '--md-base-size')).toBe('20px');
  });

  test('line-height → --md-line-height (no suffix)', async ({ page }) => {
    await gotoStyleMode(page);
    await setNumberValue(page, '_sd_ctrl-line-height-num', '2.0');
    expect(await getCssVar(page, '--md-line-height')).toBe('2.0');
  });

  test('h1-size → --md-h1-size (em suffix)', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-headers');
    await openSubSection(page, '_sd_sub-h1');
    await setNumberValue(page, '_sd_ctrl-h1-size-num', '3.0');
    expect(await getCssVar(page, '--md-h1-size')).toBe('3.0em');
  });

  test('h-mb → --md-h-margin-bottom (em suffix)', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-headers');
    await openSubSection(page, '_sd_sub-headers-general');
    await setNumberValue(page, '_sd_ctrl-h-mb-num', '1.0');
    expect(await getCssVar(page, '--md-h-margin-bottom')).toBe('1.0em');
  });

  test('p-lh → --md-p-line-height (no suffix)', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-paragraph');
    await setNumberValue(page, '_sd_ctrl-p-lh-num', '2.0');
    expect(await getCssVar(page, '--md-p-line-height')).toBe('2.0');
  });

  test('list-spacing → --md-list-spacing (em suffix)', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-lists');
    await setNumberValue(page, '_sd_ctrl-list-spacing-num', '0.8');
    expect(await getCssVar(page, '--md-list-spacing')).toBe('0.8em');
  });

  test('list-indent → --md-list-indent (em suffix)', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-lists');
    await setNumberValue(page, '_sd_ctrl-list-indent-num', '2.5');
    expect(await getCssVar(page, '--md-list-indent')).toBe('2.5em');
  });

  test('bq-size → --md-bq-size (em suffix)', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-blockquote');
    await setNumberValue(page, '_sd_ctrl-bq-size-num', '1.2');
    expect(await getCssVar(page, '--md-bq-size')).toBe('1.2em');
  });
});

// ═════════════════════════════════════════════════════
//  4. CSS variable application — special patterns
// ═════════════════════════════════════════════════════

test.describe('CSS variable application — special', () => {
  test('p-mb template → "0 0 {v}em"', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-paragraph');
    await setNumberValue(page, '_sd_ctrl-p-mb-num', '1.5');
    expect(await getCssVar(page, '--md-p-margin')).toBe('0 0 1.5em');
  });

  test('code-bg dual var → sets both --md-code-bg and --md-pre-bg', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await openSubSection(page, '_sd_sub-colors-code');
    await setColorValue(page, '_sd_ctrl-code-bg', '#aabbcc');
    expect(await getCssVar(page, '--md-code-bg')).toBe('#aabbcc');
    expect(await getCssVar(page, '--md-pre-bg')).toBe('#aabbcc');
  });

  test('bq-border compound → combines color + width', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await openSubSection(page, '_sd_sub-colors-bq');
    await setColorValue(page, '_sd_ctrl-bq-border-color', '#ff0000');
    await setNumberValue(page, '_sd_ctrl-bq-bw-num', '5');
    const val = await getCssVar(page, '--md-bq-border');
    expect(val).toBe('5px solid #ff0000');
  });

  test('font-family select → --md-font-family', async ({ page }) => {
    await gotoStyleMode(page);
    await setSelectValue(page, '_sd_ctrl-font-family', "'Roboto', sans-serif");
    const val = await getCssVar(page, '--md-font-family');
    expect(val).toBe("'Roboto', sans-serif");
  });

  test('link-decoration select → --md-link-decoration', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-links');
    await setSelectValue(page, '_sd_ctrl-link-decoration', 'none');
    expect(await getCssVar(page, '--md-link-decoration')).toBe('none');
  });
});

// ═════════════════════════════════════════════════════
//  5. Color cascade — propagation
// ═════════════════════════════════════════════════════

test.describe('Color cascade — propagation', () => {
  test('ctrl-color → flows to h-color and p-color', async ({ page }) => {
    await gotoStyleMode(page);
    await setColorValue(page, '_sd_ctrl-color', '#ff0000');
    expect(await getCssVar(page, '--md-h-color')).toBe('#ff0000');
    expect(await getCssVar(page, '--md-p-color')).toBe('#ff0000');
  });

  test('ctrl-h-color → flows to h1-h4', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await openSubSection(page, '_sd_sub-colors-headings');
    await setColorValue(page, '_sd_ctrl-h-color', '#00ff00');
    expect(await getCssVar(page, '--md-h1-color')).toBe('#00ff00');
    expect(await getCssVar(page, '--md-h2-color')).toBe('#00ff00');
    expect(await getCssVar(page, '--md-h3-color')).toBe('#00ff00');
    expect(await getCssVar(page, '--md-h4-color')).toBe('#00ff00');
  });

  test('ctrl-p-color → flows to list-color', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await setColorValue(page, '_sd_ctrl-p-color', '#0000ff');
    expect(await getCssVar(page, '--md-list-color')).toBe('#0000ff');
  });

  test('full chain: ctrl-color → h-color → h1-color', async ({ page }) => {
    await gotoStyleMode(page);
    await setColorValue(page, '_sd_ctrl-color', '#abcdef');
    expect(await getCssVar(page, '--md-h1-color')).toBe('#abcdef');
    expect(await getCssVar(page, '--md-list-color')).toBe('#abcdef');
  });

  test('ctrl-color cascades to control input values', async ({ page }) => {
    await gotoStyleMode(page);
    await setColorValue(page, '_sd_ctrl-color', '#112233');
    expect(await getCtrlValue(page, '_sd_ctrl-h-color')).toBe('#112233');
    expect(await getCtrlValue(page, '_sd_ctrl-p-color')).toBe('#112233');
    expect(await getCtrlValue(page, '_sd_ctrl-h1-color')).toBe('#112233');
  });
});

// ═════════════════════════════════════════════════════
//  6. Color cascade — override blocking
// ═════════════════════════════════════════════════════

test.describe('Color cascade — override blocking', () => {
  test('overridden child blocks parent cascade', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await openSubSection(page, '_sd_sub-colors-headings');
    // Override h-color first
    await setColorValue(page, '_sd_ctrl-h-color', '#00ff00');
    // Now change ctrl-color — h-color should stay overridden
    await setColorValue(page, '_sd_ctrl-color', '#ff0000');
    expect(await getCssVar(page, '--md-h-color')).toBe('#00ff00');
    // But p-color (not overridden) should get the new value
    expect(await getCssVar(page, '--md-p-color')).toBe('#ff0000');
  });

  test('overridden h1 blocks h-color cascade', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await openSubSection(page, '_sd_sub-colors-headings');
    await setColorValue(page, '_sd_ctrl-h1-color', '#aaaaaa');
    await setColorValue(page, '_sd_ctrl-h-color', '#bbbbbb');
    expect(await getCssVar(page, '--md-h1-color')).toBe('#aaaaaa');
    expect(await getCssVar(page, '--md-h2-color')).toBe('#bbbbbb');
  });

  test('siblings still receive cascade when one is overridden', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await openSubSection(page, '_sd_sub-colors-headings');
    await setColorValue(page, '_sd_ctrl-h2-color', '#222222');
    await setColorValue(page, '_sd_ctrl-h-color', '#999999');
    // h2 overridden, h1/h3/h4 should get cascade
    expect(await getCssVar(page, '--md-h2-color')).toBe('#222222');
    expect(await getCssVar(page, '--md-h1-color')).toBe('#999999');
    expect(await getCssVar(page, '--md-h3-color')).toBe('#999999');
    expect(await getCssVar(page, '--md-h4-color')).toBe('#999999');
  });

  test('overridden list-color blocks p-color cascade', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await setColorValue(page, '_sd_ctrl-list-color', '#333333');
    await setColorValue(page, '_sd_ctrl-p-color', '#444444');
    expect(await getCssVar(page, '--md-list-color')).toBe('#333333');
  });
});

// ═════════════════════════════════════════════════════
//  7. Reset buttons — cascade colors
// ═════════════════════════════════════════════════════

test.describe('Reset buttons — cascade colors', () => {
  test('reset-h-color resumes cascade from ctrl-color', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await openSubSection(page, '_sd_sub-colors-headings');
    // Set root color
    await setColorValue(page, '_sd_ctrl-color', '#ff0000');
    // Override h-color
    await setColorValue(page, '_sd_ctrl-h-color', '#00ff00');
    expect(await getCssVar(page, '--md-h-color')).toBe('#00ff00');
    // Reset h-color — should resume getting ctrl-color's cascade
    await clickReset(page, '_sd_reset-h-color');
    // After reset, the default color is applied (light theme default #1c1917)
    const defaultColor = await page.evaluate(() => SDocs.getColorDefault());
    expect(await getCssVar(page, '--md-h-color')).toBe(defaultColor);
  });

  test('reset-h1-color resumes cascade from h-color', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await openSubSection(page, '_sd_sub-colors-headings');
    await setColorValue(page, '_sd_ctrl-h-color', '#aabbcc');
    await setColorValue(page, '_sd_ctrl-h1-color', '#112233');
    expect(await getCssVar(page, '--md-h1-color')).toBe('#112233');
    await clickReset(page, '_sd_reset-h1-color');
    // After reset, since h-color was overridden, the default color applies
    const defaultColor = await page.evaluate(() => SDocs.getColorDefault());
    expect(await getCssVar(page, '--md-h1-color')).toBe(defaultColor);
  });

  test('reset ctrl-color re-cascades to all children', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await setColorValue(page, '_sd_ctrl-color', '#ff0000');
    expect(await getCssVar(page, '--md-h1-color')).toBe('#ff0000');
    await clickReset(page, '_sd_reset-color');
    const defaultColor = await page.evaluate(() => SDocs.getColorDefault());
    expect(await getCssVar(page, '--md-color')).toBe(defaultColor);
    expect(await getCssVar(page, '--md-h-color')).toBe(defaultColor);
    expect(await getCssVar(page, '--md-h1-color')).toBe(defaultColor);
    expect(await getCssVar(page, '--md-p-color')).toBe(defaultColor);
  });

  test('reset-p-color resumes cascade from ctrl-color', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await setColorValue(page, '_sd_ctrl-color', '#aabb00');
    await setColorValue(page, '_sd_ctrl-p-color', '#ccdd00');
    expect(await getCssVar(page, '--md-p-color')).toBe('#ccdd00');
    await clickReset(page, '_sd_reset-p-color');
    const defaultColor = await page.evaluate(() => SDocs.getColorDefault());
    expect(await getCssVar(page, '--md-p-color')).toBe(defaultColor);
  });
});

// ═════════════════════════════════════════════════════
//  8. Reset buttons — standalone colors
// ═════════════════════════════════════════════════════

test.describe('Reset buttons — standalone colors', () => {
  test('reset-link-color resets to light theme default', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await setColorValue(page, '_sd_ctrl-link-color', '#ff0000');
    await clickReset(page, '_sd_reset-link-color');
    const def = await page.evaluate(() => SDocs.getStandaloneDefault('_sd_ctrl-link-color'));
    expect(await getCtrlValue(page, '_sd_ctrl-link-color')).toBe(def);
  });

  test('reset-code-bg resets to theme default', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await openSubSection(page, '_sd_sub-colors-code');
    await setColorValue(page, '_sd_ctrl-code-bg', '#000000');
    await clickReset(page, '_sd_reset-code-bg');
    const def = await page.evaluate(() => SDocs.getStandaloneDefault('_sd_ctrl-code-bg'));
    expect(await getCtrlValue(page, '_sd_ctrl-code-bg')).toBe(def);
  });

  test('reset-code-color resets to theme default', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await openSubSection(page, '_sd_sub-colors-code');
    await setColorValue(page, '_sd_ctrl-code-color', '#000000');
    await clickReset(page, '_sd_reset-code-color');
    const def = await page.evaluate(() => SDocs.getStandaloneDefault('_sd_ctrl-code-color'));
    expect(await getCtrlValue(page, '_sd_ctrl-code-color')).toBe(def);
  });

  test('reset-bq-border-color resets to theme default', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await openSubSection(page, '_sd_sub-colors-bq');
    await setColorValue(page, '_sd_ctrl-bq-border-color', '#000000');
    await clickReset(page, '_sd_reset-bq-border-color');
    const def = await page.evaluate(() => SDocs.getStandaloneDefault('_sd_ctrl-bq-border-color'));
    expect(await getCtrlValue(page, '_sd_ctrl-bq-border-color')).toBe(def);
  });

  test('reset-bq-color resets to theme default', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await openSubSection(page, '_sd_sub-colors-bq');
    await setColorValue(page, '_sd_ctrl-bq-color', '#000000');
    await clickReset(page, '_sd_reset-bq-color');
    const def = await page.evaluate(() => SDocs.getStandaloneDefault('_sd_ctrl-bq-color'));
    expect(await getCtrlValue(page, '_sd_ctrl-bq-color')).toBe(def);
  });
});

// ═════════════════════════════════════════════════════
//  9. Factory reset
// ═════════════════════════════════════════════════════

test.describe('Factory reset', () => {
  test('resets range/number controls to defaults', async ({ page }) => {
    await gotoStyleMode(page);
    await setNumberValue(page, '_sd_ctrl-base-size-num', '24');
    await setNumberValue(page, '_sd_ctrl-line-height-num', '2.5');
    await page.locator('#_sd_factory-reset-styles').click();
    // defaultValue for base-size is 16, line-height is 1.75
    expect(await getCtrlValue(page, '_sd_ctrl-base-size-num')).toBe('16');
    expect(await getCtrlValue(page, '_sd_ctrl-line-height-num')).toBe('1.75');
    expect(await getCssVar(page, '--md-base-size')).toBe('16px');
  });

  test('clears color overrides', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await openSubSection(page, '_sd_sub-colors-headings');
    await setColorValue(page, '_sd_ctrl-color', '#ff0000');
    await setColorValue(page, '_sd_ctrl-h-color', '#00ff00');
    await page.locator('#_sd_factory-reset-styles').click();
    const defaultColor = await page.evaluate(() => SDocs.getColorDefault());
    expect(await getCssVar(page, '--md-color')).toBe(defaultColor);
    expect(await getCssVar(page, '--md-h-color')).toBe(defaultColor);
    // overriddenColors should be empty
    const overrideCount = await page.evaluate(() => SDocs.overriddenColors.size);
    expect(overrideCount).toBe(0);
  });

  test('resets standalone colors to theme defaults', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-colors');
    await setColorValue(page, '_sd_ctrl-link-color', '#ff0000');
    await page.locator('#_sd_factory-reset-styles').click();
    const def = await page.evaluate(() => SDocs.getStandaloneDefault('_sd_ctrl-link-color'));
    expect(await getCtrlValue(page, '_sd_ctrl-link-color')).toBe(def);
  });
});

// ═════════════════════════════════════════════════════
//  10. Style persistence across mode roundtrip
// ═════════════════════════════════════════════════════

test.describe('Style persistence', () => {
  test('survives style → read → style roundtrip', async ({ page }) => {
    await gotoStyleMode(page);
    await setNumberValue(page, '_sd_ctrl-base-size-num', '22');
    // Switch to read mode and back
    await page.evaluate(() => SDocs.setMode('read'));
    await page.evaluate(() => SDocs.setMode('style'));
    await page.waitForSelector('#_sd_right', { state: 'visible' });
    expect(await getCtrlValue(page, '_sd_ctrl-base-size-num')).toBe('22');
    expect(await getCssVar(page, '--md-base-size')).toBe('22px');
  });

  test('changed style appears in raw YAML', async ({ page }) => {
    await gotoStyleMode(page);
    await setNumberValue(page, '_sd_ctrl-base-size-num', '22');
    // Wait for syncAll debounce
    await page.waitForTimeout(500);
    const raw = await page.evaluate(() => document.getElementById('_sd_raw').value);
    expect(raw).toContain('baseFontSize: 22');
  });
});

// ═════════════════════════════════════════════════════
//  11. Panel collapsing
// ═════════════════════════════════════════════════════

test.describe('Panel collapsing', () => {
  test('clicking panel-header toggles open class', async ({ page }) => {
    await gotoStyleMode(page);
    // body-general starts open, click to close
    const header = page.locator('.panel-header[data-target="_sd_body-general"]');
    await header.click();
    await expect(page.locator('#_sd_body-general')).not.toHaveClass(/open/);
    await expect(header).not.toHaveClass(/open/);
    // Click again to open
    await header.click();
    await expect(page.locator('#_sd_body-general')).toHaveClass(/open/);
    await expect(header).toHaveClass(/open/);
  });

  test('clicking sub-header toggles sub-section', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-headers');
    const subHeader = page.locator('.sub-header[data-target="_sd_sub-headers-general"]');
    // Open
    await subHeader.click();
    await expect(page.locator('#_sd_sub-headers-general')).toHaveClass(/open/);
    // Close
    await subHeader.click();
    await expect(page.locator('#_sd_sub-headers-general')).not.toHaveClass(/open/);
  });
});

// ═════════════════════════════════════════════════════
//  12. Font loading
// ═════════════════════════════════════════════════════

test.describe('Font loading', () => {
  test('selecting a Google Font injects a <link> tag', async ({ page }) => {
    await gotoStyleMode(page);
    await setSelectValue(page, '_sd_ctrl-font-family', "'Roboto', sans-serif");
    const linkExists = await page.evaluate(() => {
      return !!document.querySelector('link[href*="Roboto"]');
    });
    expect(linkExists).toBe(true);
  });
});

// ═════════════════════════════════════════════════════
//  13. collectStyles roundtrip
// ═════════════════════════════════════════════════════

test.describe('collectStyles roundtrip', () => {
  test('collect → apply produces same CSS vars', async ({ page }) => {
    await gotoStyleMode(page);
    // Change a few controls
    await setNumberValue(page, '_sd_ctrl-base-size-num', '20');
    await openSection(page, '_sd_body-paragraph');
    await setNumberValue(page, '_sd_ctrl-p-mb-num', '1.5');
    // Collect, then apply
    const sameState = await page.evaluate(() => {
      const styles = SDocs.collectStyles();
      const before = {
        baseSize: document.getElementById('_sd_rendered').style.getPropertyValue('--md-base-size'),
        pMargin: document.getElementById('_sd_rendered').style.getPropertyValue('--md-p-margin'),
      };
      SDocs.applyStylesFromMeta(styles);
      const after = {
        baseSize: document.getElementById('_sd_rendered').style.getPropertyValue('--md-base-size'),
        pMargin: document.getElementById('_sd_rendered').style.getPropertyValue('--md-p-margin'),
      };
      return before.baseSize === after.baseSize && before.pMargin === after.pMargin;
    });
    expect(sameState).toBe(true);
  });

  test('only overridden cascade colors appear in collected styles', async ({ page }) => {
    await gotoStyleMode(page);
    // Override h-color but not h1-color
    await openSection(page, '_sd_body-colors');
    await openSubSection(page, '_sd_sub-colors-headings');
    await setColorValue(page, '_sd_ctrl-h-color', '#abcdef');
    const styles = await page.evaluate(() => SDocs.collectStyles());
    // Colors go into the light: theme block (since overriddenColors is non-empty)
    expect(styles.light.headers.color).toBe('#abcdef');
    // h1 should NOT have a color since it wasn't explicitly overridden
    expect(styles.light.h1).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════
//  14. Header font weight selects
// ═════════════════════════════════════════════════════

test.describe('Header font weight', () => {
  test('h1-weight select → --md-h1-weight', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-headers');
    await openSubSection(page, '_sd_sub-h1');
    await setSelectValue(page, '_sd_ctrl-h1-weight', '400');
    expect(await getCssVar(page, '--md-h1-weight')).toBe('400');
  });

  test('h2-weight select → --md-h2-weight', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-headers');
    await openSubSection(page, '_sd_sub-h2');
    await setSelectValue(page, '_sd_ctrl-h2-weight', '400');
    expect(await getCssVar(page, '--md-h2-weight')).toBe('400');
  });
});

// ═════════════════════════════════════════════════════
//  15. h-scale → --md-h-scale
// ═════════════════════════════════════════════════════

test.describe('Header scale', () => {
  test('h-scale → --md-h-scale (no suffix)', async ({ page }) => {
    await gotoStyleMode(page);
    await openSection(page, '_sd_body-headers');
    await openSubSection(page, '_sd_sub-headers-general');
    await setNumberValue(page, '_sd_ctrl-h-scale-num', '1.5');
    expect(await getCssVar(page, '--md-h-scale')).toBe('1.5');
  });
});
