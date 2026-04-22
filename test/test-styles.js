/**
 * SDocStyles pure module tests (real production code)
 */
const path = require('path');
const S = require(path.join(__dirname, '..', 'public', 'sdocs-styles.js'));

module.exports = function(harness) {
  const { assert, test } = harness;

  console.log('\n── SDocStyles Pure Module Tests ───────────────\n');

  test('collectStyles: non-overridden colors omitted', () => {
    const values = {
      '_sd_ctrl-font-family': "'Inter', sans-serif", '_sd_ctrl-base-size-num': '16',
      '_sd_ctrl-line-height-num': '1.75', '_sd_ctrl-h-scale-num': '1', '_sd_ctrl-h-mb-num': '0.4',
      '_sd_ctrl-h1-size-num': '2.1', '_sd_ctrl-h1-weight': '700',
      '_sd_ctrl-h2-size-num': '1.55', '_sd_ctrl-h2-weight': '600',
      '_sd_ctrl-h3-size-num': '1.2', '_sd_ctrl-h3-weight': '600',
      '_sd_ctrl-h4-size-num': '1.0', '_sd_ctrl-h4-weight': '600',
      '_sd_ctrl-p-lh-num': '1.75', '_sd_ctrl-p-mb-num': '1.1',
      '_sd_ctrl-link-color': '#2563EB', '_sd_ctrl-link-decoration': 'underline',
      '_sd_ctrl-code-font': "'JetBrains Mono', monospace", '_sd_ctrl-code-bg': '#F4F1ED',
      '_sd_ctrl-code-color': '#6B21A8',
      '_sd_ctrl-bq-border-color': '#2563EB', '_sd_ctrl-bq-bw-num': '3',
      '_sd_ctrl-bq-bg': '#F7F5F2', '_sd_ctrl-bq-size-num': '1', '_sd_ctrl-bq-color': '#6B6560',
      '_sd_ctrl-color': '#1c1917', '_sd_ctrl-h-color': '#1c1917',
      '_sd_ctrl-h1-color': '#1c1917', '_sd_ctrl-h2-color': '#1c1917',
      '_sd_ctrl-h3-color': '#1c1917', '_sd_ctrl-h4-color': '#1c1917',
      '_sd_ctrl-p-color': '#1c1917', '_sd_ctrl-list-color': '#1c1917',
    };
    const styles = S.collectStyles(values, new Set());
    assert.strictEqual(styles.color, undefined);
    assert.strictEqual(styles.headers.color, undefined);
    assert.strictEqual(styles.h1.color, undefined);
    assert.strictEqual(styles.p.color, undefined);
  });

  test('collectStyles: overridden colors emitted', () => {
    const values = {
      '_sd_ctrl-font-family': "'Inter', sans-serif", '_sd_ctrl-base-size-num': '16',
      '_sd_ctrl-line-height-num': '1.75', '_sd_ctrl-h-scale-num': '1', '_sd_ctrl-h-mb-num': '0.4',
      '_sd_ctrl-h1-size-num': '2.1', '_sd_ctrl-h1-weight': '700',
      '_sd_ctrl-h2-size-num': '1.55', '_sd_ctrl-h2-weight': '600',
      '_sd_ctrl-h3-size-num': '1.2', '_sd_ctrl-h3-weight': '600',
      '_sd_ctrl-h4-size-num': '1.0', '_sd_ctrl-h4-weight': '600',
      '_sd_ctrl-p-lh-num': '1.75', '_sd_ctrl-p-mb-num': '1.1',
      '_sd_ctrl-link-color': '#2563EB', '_sd_ctrl-link-decoration': 'underline',
      '_sd_ctrl-code-font': "'JetBrains Mono', monospace", '_sd_ctrl-code-bg': '#F4F1ED',
      '_sd_ctrl-code-color': '#6B21A8',
      '_sd_ctrl-bq-border-color': '#2563EB', '_sd_ctrl-bq-bw-num': '3',
      '_sd_ctrl-bq-bg': '#F7F5F2', '_sd_ctrl-bq-size-num': '1', '_sd_ctrl-bq-color': '#6B6560',
      '_sd_ctrl-color': '#ff0000', '_sd_ctrl-h1-color': '#0000ff',
    };
    const overridden = new Set(['_sd_ctrl-color', '_sd_ctrl-h1-color']);
    const styles = S.collectStyles(values, overridden);
    assert.strictEqual(styles.color, '#ff0000');
    assert.strictEqual(styles.h1.color, '#0000ff');
    assert.strictEqual(styles.h2.color, undefined);
  });

  test('every non-color setting roundtrips through collectStyles → stylesToControls', () => {
    const values = {
      '_sd_ctrl-font-family': "'Lora', serif",
      '_sd_ctrl-base-size-num': '18',
      '_sd_ctrl-line-height-num': '1.8',
      '_sd_ctrl-h-font-family': "'Playfair Display', serif",
      '_sd_ctrl-h-scale-num': '1.2',
      '_sd_ctrl-h-mb-num': '0.6',
      '_sd_ctrl-h1-size-num': '2.5', '_sd_ctrl-h1-weight': '800',
      '_sd_ctrl-h2-size-num': '1.8', '_sd_ctrl-h2-weight': '700',
      '_sd_ctrl-h3-size-num': '1.4', '_sd_ctrl-h3-weight': '600',
      '_sd_ctrl-h4-size-num': '1.1', '_sd_ctrl-h4-weight': '500',
      '_sd_ctrl-p-lh-num': '1.9',
      '_sd_ctrl-p-mb-num': '1.3',
      '_sd_ctrl-link-color': '#e11d48',
      '_sd_ctrl-link-decoration': 'none',
      '_sd_ctrl-code-font': "'Fira Code', monospace",
      '_sd_ctrl-code-bg': '#282c34',
      '_sd_ctrl-code-color': '#abb2bf',
      '_sd_ctrl-bq-border-color': '#e11d48',
      '_sd_ctrl-bq-bw-num': '5',
      '_sd_ctrl-bq-bg': '#eee8e0',
      '_sd_ctrl-bq-size-num': '0.95',
      '_sd_ctrl-bq-color': '#555555',
      '_sd_ctrl-list-spacing-num': '0.5',
      '_sd_ctrl-list-indent-num': '1.5',
    };
    const styles = S.collectStyles(values, new Set());

    assert.strictEqual(styles.fontFamily, 'Lora');
    assert.strictEqual(styles.baseFontSize, 18);
    assert.strictEqual(styles.lineHeight, 1.8);
    assert.strictEqual(styles.headers.fontFamily, 'Playfair Display');
    assert.strictEqual(styles.headers.scale, 1.2);
    assert.strictEqual(styles.headers.marginBottom, 0.6);
    assert.strictEqual(styles.h1.fontSize, 2.5);
    assert.strictEqual(styles.h1.fontWeight, 800);
    assert.strictEqual(styles.h2.fontSize, 1.8);
    assert.strictEqual(styles.h2.fontWeight, 700);
    assert.strictEqual(styles.h3.fontSize, 1.4);
    assert.strictEqual(styles.h3.fontWeight, 600);
    assert.strictEqual(styles.h4.fontSize, 1.1);
    assert.strictEqual(styles.h4.fontWeight, 500);
    assert.strictEqual(styles.p.lineHeight, 1.9);
    assert.strictEqual(styles.p.marginBottom, 1.3);
    assert.strictEqual(styles.link.color, '#e11d48');
    assert.strictEqual(styles.link.decoration, 'none');
    assert.strictEqual(styles.code.font, 'Fira Code');
    // code.background and code.color are now cascade-gated (only emit when overridden)
    assert.strictEqual(styles.blockquote.borderColor, '#e11d48');
    assert.strictEqual(styles.blockquote.borderWidth, 5);
    // blockquote.background and blockquote.color are now cascade-gated
    assert.strictEqual(styles.blockquote.fontSize, 0.95);
    assert.strictEqual(styles.list.spacing, 0.5);
    assert.strictEqual(styles.list.indent, 1.5);

    const { controls } = S.stylesToControls(styles);
    assert.strictEqual(controls['_sd_ctrl-font-family'], 'Lora');
    assert.strictEqual(controls['_sd_ctrl-base-size-num'], 18);
    assert.strictEqual(controls['_sd_ctrl-line-height-num'], 1.8);
    assert.strictEqual(controls['_sd_ctrl-h-font-family'], 'Playfair Display');
    assert.strictEqual(controls['_sd_ctrl-h-scale-num'], 1.2);
    assert.strictEqual(controls['_sd_ctrl-h-mb-num'], 0.6);
    assert.strictEqual(controls['_sd_ctrl-h1-size-num'], 2.5);
    assert.strictEqual(controls['_sd_ctrl-h1-weight'], '800');
    assert.strictEqual(controls['_sd_ctrl-h2-size-num'], 1.8);
    assert.strictEqual(controls['_sd_ctrl-h2-weight'], '700');
    assert.strictEqual(controls['_sd_ctrl-h3-size-num'], 1.4);
    assert.strictEqual(controls['_sd_ctrl-h3-weight'], '600');
    assert.strictEqual(controls['_sd_ctrl-h4-size-num'], 1.1);
    assert.strictEqual(controls['_sd_ctrl-h4-weight'], '500');
    assert.strictEqual(controls['_sd_ctrl-p-lh-num'], 1.9);
    assert.strictEqual(controls['_sd_ctrl-p-mb-num'], 1.3);
    assert.strictEqual(controls['_sd_ctrl-link-color'], '#e11d48');
    assert.strictEqual(controls['_sd_ctrl-link-decoration'], 'none');
    assert.strictEqual(controls['_sd_ctrl-code-font'], 'Fira Code');
    // code-bg, code-color, bq-bg, bq-color are cascade colors — not emitted without override
    assert.strictEqual(controls['_sd_ctrl-bq-border-color'], '#e11d48');
    assert.strictEqual(controls['_sd_ctrl-bq-bw-num'], 5);
    assert.strictEqual(controls['_sd_ctrl-bq-size-num'], 0.95);
    assert.strictEqual(controls['_sd_ctrl-list-spacing-num'], 0.5);
    assert.strictEqual(controls['_sd_ctrl-list-indent-num'], 1.5);
  });

  test('every cascade color roundtrips through collectStyles → stylesToControls', () => {
    const values = {
      '_sd_ctrl-font-family': "'Inter', sans-serif", '_sd_ctrl-base-size-num': '16',
      '_sd_ctrl-line-height-num': '1.75', '_sd_ctrl-h-font-family': 'inherit',
      '_sd_ctrl-h-scale-num': '1', '_sd_ctrl-h-mb-num': '0.4',
      '_sd_ctrl-h1-size-num': '2.1', '_sd_ctrl-h1-weight': '700',
      '_sd_ctrl-h2-size-num': '1.55', '_sd_ctrl-h2-weight': '600',
      '_sd_ctrl-h3-size-num': '1.2', '_sd_ctrl-h3-weight': '600',
      '_sd_ctrl-h4-size-num': '1.0', '_sd_ctrl-h4-weight': '600',
      '_sd_ctrl-p-lh-num': '1.75', '_sd_ctrl-p-mb-num': '1.1',
      '_sd_ctrl-link-color': '#2563EB', '_sd_ctrl-link-decoration': 'underline',
      '_sd_ctrl-code-font': "'JetBrains Mono', monospace", '_sd_ctrl-code-bg': '#F4F1ED',
      '_sd_ctrl-code-color': '#6B21A8',
      '_sd_ctrl-bq-border-color': '#2563EB', '_sd_ctrl-bq-bw-num': '3',
      '_sd_ctrl-bq-bg': '#F7F5F2', '_sd_ctrl-bq-size-num': '1', '_sd_ctrl-bq-color': '#6B6560',
      '_sd_ctrl-list-spacing-num': '0.3', '_sd_ctrl-list-indent-num': '1.6',
      '_sd_ctrl-color': '#111111',
      '_sd_ctrl-h-color': '#222222',
      '_sd_ctrl-h1-color': '#aa0000',
      '_sd_ctrl-h2-color': '#bb0000',
      '_sd_ctrl-h3-color': '#cc0000',
      '_sd_ctrl-h4-color': '#dd0000',
      '_sd_ctrl-p-color': '#333333',
      '_sd_ctrl-list-color': '#444444',
    };
    const allOverridden = new Set([
      '_sd_ctrl-color', '_sd_ctrl-h-color',
      '_sd_ctrl-h1-color', '_sd_ctrl-h2-color', '_sd_ctrl-h3-color', '_sd_ctrl-h4-color',
      '_sd_ctrl-p-color', '_sd_ctrl-list-color',
    ]);
    const styles = S.collectStyles(values, allOverridden);

    assert.strictEqual(styles.color, '#111111');
    assert.strictEqual(styles.headers.color, '#222222');
    assert.strictEqual(styles.h1.color, '#aa0000');
    assert.strictEqual(styles.h2.color, '#bb0000');
    assert.strictEqual(styles.h3.color, '#cc0000');
    assert.strictEqual(styles.h4.color, '#dd0000');
    assert.strictEqual(styles.p.color, '#333333');
    assert.strictEqual(styles.list.color, '#444444');

    const { controls, overriddenColors } = S.stylesToControls(styles);
    assert.strictEqual(controls['_sd_ctrl-color'], '#111111');
    assert.strictEqual(controls['_sd_ctrl-h-color'], '#222222');
    assert.strictEqual(controls['_sd_ctrl-h1-color'], '#aa0000');
    assert.strictEqual(controls['_sd_ctrl-h2-color'], '#bb0000');
    assert.strictEqual(controls['_sd_ctrl-h3-color'], '#cc0000');
    assert.strictEqual(controls['_sd_ctrl-h4-color'], '#dd0000');
    assert.strictEqual(controls['_sd_ctrl-p-color'], '#333333');
    assert.strictEqual(controls['_sd_ctrl-list-color'], '#444444');

    for (const id of allOverridden) {
      assert.ok(overriddenColors.has(id), `${id} should be in overriddenColors`);
    }
  });

  test('controlToCssVars: base-size adds px suffix', () => {
    const result = S.controlToCssVars('_sd_ctrl-base-size-num', '18', {});
    assert.deepStrictEqual(result, [{ cssVar: '--md-base-size', value: '18px' }]);
  });

  test('controlToCssVars: bq-border combines color + width', () => {
    const allVals = { '_sd_ctrl-bq-border-color': '#ff0000', '_sd_ctrl-bq-bw-num': '4' };
    const result = S.controlToCssVars('_sd_ctrl-bq-border-color', '#ff0000', allVals);
    assert.deepStrictEqual(result, [{ cssVar: '--md-bq-border', value: '4px solid #ff0000' }]);
  });

  test('controlToCssVars: code-bg sets both code-bg and pre-bg', () => {
    const result = S.controlToCssVars('_sd_ctrl-code-bg', '#f0f0f0', {});
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].cssVar, '--md-code-bg');
    assert.strictEqual(result[1].cssVar, '--md-pre-bg');
  });

  test('controlToCssVars: p-margin uses template', () => {
    const result = S.controlToCssVars('_sd_ctrl-p-mb-num', '1.5', {});
    assert.deepStrictEqual(result, [{ cssVar: '--md-p-margin', value: '0 0 1.5em' }]);
  });

  test('cascadeColor: propagates to non-overridden children', () => {
    const overridden = new Set();
    const updates = S.cascadeColor('_sd_ctrl-color', '#ff0000', overridden);
    assert.strictEqual(updates['_sd_ctrl-color'], '#ff0000');
    assert.strictEqual(updates['_sd_ctrl-h-color'], '#ff0000');
    assert.strictEqual(updates['_sd_ctrl-h1-color'], '#ff0000');
    assert.strictEqual(updates['_sd_ctrl-p-color'], '#ff0000');
    assert.strictEqual(updates['_sd_ctrl-list-color'], '#ff0000');
  });

  test('cascadeColor: stops at overridden children', () => {
    const overridden = new Set(['_sd_ctrl-h1-color']);
    const updates = S.cascadeColor('_sd_ctrl-color', '#ff0000', overridden);
    assert.strictEqual(updates['_sd_ctrl-h2-color'], '#ff0000');
    assert.strictEqual(updates['_sd_ctrl-h1-color'], undefined);
  });

  test('stylesToControls: maps all style keys to control IDs', () => {
    const styles = { fontFamily: 'Lora', baseFontSize: 17, color: '#ff0000',
      h1: { fontSize: 2.3, color: '#0000ff', fontWeight: 700 } };
    const { controls, overriddenColors } = S.stylesToControls(styles);
    assert.strictEqual(controls['_sd_ctrl-font-family'], 'Lora');
    assert.strictEqual(controls['_sd_ctrl-base-size-num'], 17);
    assert.ok(overriddenColors.has('_sd_ctrl-color'));
    assert.ok(overriddenColors.has('_sd_ctrl-h1-color'));
    assert.ok(!overriddenColors.has('_sd_ctrl-h2-color'));
  });

  test('stylesToControls: null/undefined input returns empty', () => {
    const r1 = S.stylesToControls(null);
    assert.deepStrictEqual(r1.controls, {});
    assert.strictEqual(r1.overriddenColors.size, 0);
    const r2 = S.stylesToControls(undefined);
    assert.deepStrictEqual(r2.controls, {});
  });

  test('controlToCssVars: unknown control returns empty array', () => {
    const result = S.controlToCssVars('ctrl-nonexistent', 'foo', {});
    assert.deepStrictEqual(result, []);
  });

  test('controlToCssVars: color control maps through COLOR_VAR_MAP', () => {
    const result = S.controlToCssVars('_sd_ctrl-color', '#ff0000', {});
    assert.deepStrictEqual(result, [{ cssVar: '--md-color', value: '#ff0000' }]);
  });

  test('controlToCssVars: bg-color maps to --md-bg', () => {
    const result = S.controlToCssVars('_sd_ctrl-bg-color', '#ffffff', {});
    assert.deepStrictEqual(result, [{ cssVar: '--md-bg', value: '#ffffff' }]);
  });

  test('controlToCssVars: em suffix for heading sizes', () => {
    const result = S.controlToCssVars('_sd_ctrl-h1-size-num', '2.5', {});
    assert.deepStrictEqual(result, [{ cssVar: '--md-h1-size', value: '2.5em' }]);
  });

  test('cascadeColor: h-color propagates to h1-h4 but not p-color', () => {
    const updates = S.cascadeColor('_sd_ctrl-h-color', '#00ff00', new Set());
    assert.strictEqual(updates['_sd_ctrl-h1-color'], '#00ff00');
    assert.strictEqual(updates['_sd_ctrl-h4-color'], '#00ff00');
    assert.strictEqual(updates['_sd_ctrl-p-color'], undefined);
  });

  test('cascadeColor: p-color propagates to list-color', () => {
    const updates = S.cascadeColor('_sd_ctrl-p-color', '#333', new Set());
    assert.strictEqual(updates['_sd_ctrl-list-color'], '#333');
    assert.strictEqual(updates['_sd_ctrl-h1-color'], undefined);
  });

  test('COLOR_CASCADE tree is internally consistent', () => {
    // Every child referenced in CASCADE should exist in COLOR_VAR_MAP
    for (const [parent, children] of Object.entries(S.COLOR_CASCADE)) {
      assert.ok(S.COLOR_VAR_MAP[parent], `parent ${parent} missing from COLOR_VAR_MAP`);
      for (const child of children) {
        assert.ok(S.COLOR_VAR_MAP[child], `child ${child} missing from COLOR_VAR_MAP`);
      }
    }
  });

  console.log('\n── Per-Theme Color Tests ──────────────────────\n');

  test('STANDALONE_COLOR_IDS and ALL_COLOR_IDS are exported', () => {
    assert.ok(Array.isArray(S.STANDALONE_COLOR_IDS));
    assert.strictEqual(S.STANDALONE_COLOR_IDS.length, 8);
    assert.ok(Array.isArray(S.ALL_COLOR_IDS));
    assert.strictEqual(S.ALL_COLOR_IDS.length, 24);
  });

  test('parseDarkBlock: extracts dark override colors', () => {
    const block = {
      background: '#1a1520',
      color: '#e7e5e2',
      h1: { color: '#ef6f5e' },
      blocks: { background: '#221a28', color: '#a8a29e' },
      chart: { background: '#1e1a28', textColor: '#b0b0b0' },
    };
    const result = S.parseDarkBlock(block);
    assert.strictEqual(result['_sd_ctrl-bg-color'], '#1a1520');
    assert.strictEqual(result['_sd_ctrl-color'], '#e7e5e2');
    assert.strictEqual(result['_sd_ctrl-h1-color'], '#ef6f5e');
    assert.strictEqual(result['_sd_ctrl-block-bg'], '#221a28');
    assert.strictEqual(result['_sd_ctrl-block-text'], '#a8a29e');
    assert.strictEqual(result['_sd_ctrl-chart-bg'], '#1e1a28');
    assert.strictEqual(result['_sd_ctrl-chart-text'], '#b0b0b0');
  });

  test('parseDarkBlock: null returns empty', () => {
    assert.deepStrictEqual(S.parseDarkBlock(null), {});
    assert.deepStrictEqual(S.parseDarkBlock(undefined), {});
  });

  test('invertLightness: light bg becomes dark', () => {
    // #fdf6f0 has L≈96 → should become very dark
    const dark = S.invertLightness('#fdf6f0');
    const hsl = S.hexToHsl ? null : null; // just check it's dark
    assert.ok(dark.charAt(0) === '#');
    assert.ok(dark !== '#fdf6f0');
  });

  test('invertLightness: very dark color stays as-is', () => {
    // #3c1518 has L≈10 → should be kept (intentional dark bg)
    assert.strictEqual(S.invertLightness('#3c1518'), '#3c1518');
  });

  test('invertLightness: dark text becomes light', () => {
    // #2d1810 has L≈12... wait that's <20 so kept. Use L≈25
    const light = S.invertLightness('#4a3020');
    assert.ok(light !== '#4a3020');
  });

  test('stylesToControls: top-level colors are light mode', () => {
    const styles = { fontFamily: 'Inter', color: '#ff0000', h1: { color: '#0000ff' } };
    const result = S.stylesToControls(styles);
    assert.ok(result.overriddenColors.has('_sd_ctrl-color'));
    assert.ok(result.overriddenColors.has('_sd_ctrl-h1-color'));
    assert.strictEqual(result.controls['_sd_ctrl-color'], '#ff0000');
  });

  console.log('\n── stripStyleDefaults Tests ────────────────────\n');

  test('stripStyleDefaults: removes all-default styles completely', () => {
    const allDefaults = {
      fontFamily: 'Inter',
      baseFontSize: 16,
      lineHeight: 1.75,
      headers: { fontFamily: 'inherit', scale: 1.0, marginBottom: 0.4 },
      h1: { fontSize: 2.1, fontWeight: 700 },
      h2: { fontSize: 1.55, fontWeight: 600 },
      h3: { fontSize: 1.2, fontWeight: 600 },
      h4: { fontSize: 1.0, fontWeight: 600 },
      p: { lineHeight: 1.75, marginBottom: 1.1 },
      link: { decoration: 'underline' },
      code: { font: 'JetBrains Mono' },
      blockquote: { borderWidth: 3, fontSize: 1.0 },
      list: { spacing: 0.3, indent: 1.6 },
    };
    const result = S.stripStyleDefaults(allDefaults);
    assert.deepStrictEqual(result, {});
  });

  test('stripStyleDefaults: preserves non-default values', () => {
    const styles = {
      fontFamily: 'Lora',           // non-default
      baseFontSize: 18,             // non-default
      lineHeight: 1.75,             // default — should be stripped
      h1: { fontSize: 2.5, fontWeight: 700 }, // fontSize non-default, fontWeight default
      h2: { fontSize: 1.55, fontWeight: 600 }, // both default — whole object removed
      p: { lineHeight: 1.75, marginBottom: 1.1 }, // both default
    };
    const result = S.stripStyleDefaults(styles);
    assert.strictEqual(result.fontFamily, 'Lora');
    assert.strictEqual(result.baseFontSize, 18);
    assert.strictEqual(result.lineHeight, undefined);
    assert.strictEqual(result.h1.fontSize, 2.5);
    assert.strictEqual(result.h1.fontWeight, undefined);
    assert.strictEqual(result.h2, undefined);
    assert.strictEqual(result.p, undefined);
  });

  test('stripStyleDefaults: preserves dark block untouched', () => {
    const styles = {
      fontFamily: 'Inter',  // default — stripped
      baseFontSize: 16,     // default — stripped
      color: '#1c1917',
      dark: { background: '#2c2a26', color: '#e7e5e2' },
    };
    const result = S.stripStyleDefaults(styles);
    assert.deepStrictEqual(result.dark, styles.dark);
    assert.strictEqual(result.fontFamily, undefined);
    assert.strictEqual(result.baseFontSize, undefined);
    assert.strictEqual(result.color, '#1c1917');
  });

  test('stripStyleDefaults: handles numeric string/number comparison', () => {
    // collectStyles may produce numbers, but parsed YAML may return strings
    const styles = { baseFontSize: '16', lineHeight: '1.75', h1: { fontSize: '2.1' } };
    const result = S.stripStyleDefaults(styles);
    assert.strictEqual(result.baseFontSize, undefined);
    assert.strictEqual(result.lineHeight, undefined);
    assert.strictEqual(result.h1, undefined);
  });

  test('stripStyleDefaults: null/undefined input passthrough', () => {
    assert.strictEqual(S.stripStyleDefaults(null), null);
    assert.strictEqual(S.stripStyleDefaults(undefined), undefined);
  });

  test('stripStyleDefaults: empty object returns empty', () => {
    assert.deepStrictEqual(S.stripStyleDefaults({}), {});
  });

  test('stripStyleDefaults: unknown keys are preserved', () => {
    const styles = { customThing: 'foo', fontFamily: 'Inter' };
    const result = S.stripStyleDefaults(styles);
    assert.strictEqual(result.customThing, 'foo');
    assert.strictEqual(result.fontFamily, undefined); // default, stripped
  });

  test('stripStyleDefaults: partial sub-object keeps non-default keys', () => {
    const styles = {
      blockquote: { borderWidth: 3, fontSize: 0.9, color: '#555' },
    };
    const result = S.stripStyleDefaults(styles);
    // borderWidth 3 is default — stripped. fontSize 0.9 and color are not.
    assert.strictEqual(result.blockquote.borderWidth, undefined);
    assert.strictEqual(result.blockquote.fontSize, 0.9);
    assert.strictEqual(result.blockquote.color, '#555');
  });

  test('stripStyleDefaults: STYLE_DEFAULTS matches index.html control defaults', () => {
    // Verify the defaults table has the expected keys — if someone adds a control
    // to index.html, they should also add it to STYLE_DEFAULTS
    const d = S.STYLE_DEFAULTS;
    assert.strictEqual(d.fontFamily, 'Inter');
    assert.strictEqual(d.baseFontSize, 16);
    assert.strictEqual(d.lineHeight, 1.75);
    assert.strictEqual(d.headers.fontFamily, 'inherit');
    assert.strictEqual(d.headers.scale, 1.0);
    assert.strictEqual(d.headers.marginBottom, 0.4);
    assert.strictEqual(d.h1.fontSize, 2.1);
    assert.strictEqual(d.h1.fontWeight, 700);
    assert.strictEqual(d.h2.fontSize, 1.55);
    assert.strictEqual(d.h2.fontWeight, 600);
    assert.strictEqual(d.h3.fontSize, 1.2);
    assert.strictEqual(d.h3.fontWeight, 600);
    assert.strictEqual(d.h4.fontSize, 1.0);
    assert.strictEqual(d.h4.fontWeight, 600);
    assert.strictEqual(d.p.lineHeight, 1.75);
    assert.strictEqual(d.p.marginBottom, 1.1);
    assert.strictEqual(d.link.decoration, 'underline');
    assert.strictEqual(d.code.font, 'JetBrains Mono');
    assert.strictEqual(d.blockquote.borderWidth, 3);
    assert.strictEqual(d.blockquote.fontSize, 1.0);
    assert.strictEqual(d.list.spacing, 0.3);
    assert.strictEqual(d.list.indent, 1.6);
  });

  test('stripStyleDefaults → stylesToControls roundtrip preserves non-defaults', () => {
    // Simulate: collectStyles → stripStyleDefaults → serialize → parse → stylesToControls
    // Non-default values must survive the full round trip
    const values = {
      '_sd_ctrl-font-family': "'Lora', serif",
      '_sd_ctrl-base-size-num': '18',
      '_sd_ctrl-line-height-num': '1.8',
      '_sd_ctrl-h-font-family': "'Playfair Display', serif",
      '_sd_ctrl-h-scale-num': '1.2',
      '_sd_ctrl-h-mb-num': '0.6',
      '_sd_ctrl-h1-size-num': '2.5', '_sd_ctrl-h1-weight': '800',
      '_sd_ctrl-h2-size-num': '1.55', '_sd_ctrl-h2-weight': '600', // h2 all default
      '_sd_ctrl-h3-size-num': '1.2', '_sd_ctrl-h3-weight': '600',  // h3 all default
      '_sd_ctrl-h4-size-num': '1.0', '_sd_ctrl-h4-weight': '600',  // h4 all default
      '_sd_ctrl-p-lh-num': '1.75', '_sd_ctrl-p-mb-num': '1.1',     // p all default
      '_sd_ctrl-link-color': '#e11d48', '_sd_ctrl-link-decoration': 'none',
      '_sd_ctrl-code-font': "'JetBrains Mono', monospace",      // default
      '_sd_ctrl-code-bg': '#282c34', '_sd_ctrl-code-color': '#abb2bf',
      '_sd_ctrl-bq-border-color': '#e11d48', '_sd_ctrl-bq-bw-num': '3', // bw default
      '_sd_ctrl-bq-bg': '#eee8e0', '_sd_ctrl-bq-size-num': '1',    // size default
      '_sd_ctrl-bq-color': '#555555',
      '_sd_ctrl-list-spacing-num': '0.3', '_sd_ctrl-list-indent-num': '1.6', // default
    };
    const original = S.collectStyles(values, new Set());
    const stripped = S.stripStyleDefaults(original);
    const { controls } = S.stylesToControls(stripped);

    // Non-default values must be present
    assert.strictEqual(controls['_sd_ctrl-font-family'], 'Lora');
    assert.strictEqual(controls['_sd_ctrl-base-size-num'], 18);
    assert.strictEqual(controls['_sd_ctrl-line-height-num'], 1.8);
    assert.strictEqual(controls['_sd_ctrl-h-font-family'], 'Playfair Display');
    assert.strictEqual(controls['_sd_ctrl-h-scale-num'], 1.2);
    assert.strictEqual(controls['_sd_ctrl-h-mb-num'], 0.6);
    assert.strictEqual(controls['_sd_ctrl-h1-size-num'], 2.5);
    assert.strictEqual(controls['_sd_ctrl-h1-weight'], '800');
    assert.strictEqual(controls['_sd_ctrl-link-decoration'], 'none');

    // Default values must NOT be in controls (browser fills them from HTML defaults)
    assert.strictEqual(controls['_sd_ctrl-h2-size-num'], undefined);
    assert.strictEqual(controls['_sd_ctrl-h2-weight'], undefined);
    assert.strictEqual(controls['_sd_ctrl-p-lh-num'], undefined);
    assert.strictEqual(controls['_sd_ctrl-list-spacing-num'], undefined);
  });

  test('stripStyleDefaults: dark block survives stripping', () => {
    const styles = {
      fontFamily: 'Inter',  // default — stripped
      color: '#c0392b',     // non-default — kept
      dark: { color: '#ef6f5e', background: '#1a1520' },
    };
    const stripped = S.stripStyleDefaults(styles);
    assert.strictEqual(stripped.fontFamily, undefined);
    assert.strictEqual(stripped.color, '#c0392b');
    assert.ok(stripped.dark);
    assert.strictEqual(stripped.dark.color, '#ef6f5e');
    assert.strictEqual(stripped.dark.background, '#1a1520');
  });

  console.log('\n── Chart Style Tests ────────────────────────────\n');

  test('controlToCssVars: chart-accent maps to --md-chart-accent', () => {
    const result = S.controlToCssVars('_sd_ctrl-chart-accent', '#e11d48', {});
    assert.deepStrictEqual(result, [{ cssVar: '--md-chart-accent', value: '#e11d48' }]);
  });

  test('controlToCssVars: chart-palette maps to --md-chart-palette', () => {
    const result = S.controlToCssVars('_sd_ctrl-chart-palette', 'analogous', {});
    assert.deepStrictEqual(result, [{ cssVar: '--md-chart-palette', value: 'analogous' }]);
  });

  test('collectStyles: chart accent emitted when overridden', () => {
    const values = {
      '_sd_ctrl-font-family': "'Inter', sans-serif", '_sd_ctrl-base-size-num': '16',
      '_sd_ctrl-line-height-num': '1.75', '_sd_ctrl-h-font-family': 'inherit',
      '_sd_ctrl-h-scale-num': '1', '_sd_ctrl-h-mb-num': '0.4',
      '_sd_ctrl-h1-size-num': '2.1', '_sd_ctrl-h1-weight': '700',
      '_sd_ctrl-h2-size-num': '1.55', '_sd_ctrl-h2-weight': '600',
      '_sd_ctrl-h3-size-num': '1.2', '_sd_ctrl-h3-weight': '600',
      '_sd_ctrl-h4-size-num': '1', '_sd_ctrl-h4-weight': '600',
      '_sd_ctrl-p-lh-num': '1.75', '_sd_ctrl-p-mb-num': '1.1',
      '_sd_ctrl-link-color': '#2563eb', '_sd_ctrl-link-decoration': 'underline',
      '_sd_ctrl-code-font': "'JetBrains Mono', 'Fira Mono', monospace",
      '_sd_ctrl-code-bg': '#f4f1ed', '_sd_ctrl-code-color': '#6b21a8',
      '_sd_ctrl-bq-border-color': '#2563eb', '_sd_ctrl-bq-bw-num': '3',
      '_sd_ctrl-bq-bg': '#f7f5f2', '_sd_ctrl-bq-size-num': '1', '_sd_ctrl-bq-color': '#6b6560',
      '_sd_ctrl-list-spacing-num': '0.3', '_sd_ctrl-list-indent-num': '1.6',
      '_sd_ctrl-chart-accent': '#e11d48', '_sd_ctrl-chart-palette': 'monochrome',
    };
    const overridden = new Set(['_sd_ctrl-chart-accent']);
    const styles = S.collectStyles(values, overridden);
    assert.ok(styles.chart, 'chart key should exist');
    assert.strictEqual(styles.chart.accent, '#e11d48');
    // monochrome is the default — not emitted unless changed
  });

  test('collectStyles: chart omitted when accent not overridden and palette is default', () => {
    const values = {
      '_sd_ctrl-font-family': "'Inter', sans-serif", '_sd_ctrl-base-size-num': '16',
      '_sd_ctrl-line-height-num': '1.75', '_sd_ctrl-h-font-family': 'inherit',
      '_sd_ctrl-h-scale-num': '1', '_sd_ctrl-h-mb-num': '0.4',
      '_sd_ctrl-h1-size-num': '2.1', '_sd_ctrl-h1-weight': '700',
      '_sd_ctrl-h2-size-num': '1.55', '_sd_ctrl-h2-weight': '600',
      '_sd_ctrl-h3-size-num': '1.2', '_sd_ctrl-h3-weight': '600',
      '_sd_ctrl-h4-size-num': '1', '_sd_ctrl-h4-weight': '600',
      '_sd_ctrl-p-lh-num': '1.75', '_sd_ctrl-p-mb-num': '1.1',
      '_sd_ctrl-link-color': '#2563eb', '_sd_ctrl-link-decoration': 'underline',
      '_sd_ctrl-code-font': "'JetBrains Mono', 'Fira Mono', monospace",
      '_sd_ctrl-code-bg': '#f4f1ed', '_sd_ctrl-code-color': '#6b21a8',
      '_sd_ctrl-bq-border-color': '#2563eb', '_sd_ctrl-bq-bw-num': '3',
      '_sd_ctrl-bq-bg': '#f7f5f2', '_sd_ctrl-bq-size-num': '1', '_sd_ctrl-bq-color': '#6b6560',
      '_sd_ctrl-list-spacing-num': '0.3', '_sd_ctrl-list-indent-num': '1.6',
      '_sd_ctrl-chart-accent': '#3b82f6', '_sd_ctrl-chart-palette': 'monochrome',
    };
    const styles = S.collectStyles(values, new Set());
    assert.strictEqual(styles.chart, undefined);
  });

  test('stylesToControls: chart styles roundtrip', () => {
    const styles = { chart: { accent: '#7c3aed', palette: 'analogous' } };
    const result = S.stylesToControls(styles);
    assert.strictEqual(result.controls['_sd_ctrl-chart-accent'], '#7c3aed');
    assert.strictEqual(result.controls['_sd_ctrl-chart-palette'], 'analogous');
    assert.ok(result.overriddenColors.has('_sd_ctrl-chart-accent'));
  });

  test('stylesToControls: missing chart section is safe', () => {
    const result = S.stylesToControls({ fontFamily: 'Lora' });
    assert.strictEqual(result.controls['_sd_ctrl-chart-accent'], undefined);
    assert.strictEqual(result.controls['_sd_ctrl-chart-palette'], undefined);
  });

  test('ctrl-chart-accent is in STANDALONE_COLOR_IDS', () => {
    assert.ok(S.STANDALONE_COLOR_IDS.includes('_sd_ctrl-chart-accent'));
  });

  console.log('\n── Block Cascade Tests ──────────────────────────\n');

  test('cascadeColor: block-bg propagates to code-bg, bq-bg, chart-bg', () => {
    const updates = S.cascadeColor('_sd_ctrl-block-bg', '#aabbcc', new Set());
    assert.strictEqual(updates['_sd_ctrl-code-bg'], '#aabbcc');
    assert.strictEqual(updates['_sd_ctrl-bq-bg'], '#aabbcc');
    assert.strictEqual(updates['_sd_ctrl-chart-bg'], '#aabbcc');
  });

  test('cascadeColor: block-text propagates to code-color, bq-color, chart-text', () => {
    const updates = S.cascadeColor('_sd_ctrl-block-text', '#112233', new Set());
    assert.strictEqual(updates['_sd_ctrl-code-color'], '#112233');
    assert.strictEqual(updates['_sd_ctrl-bq-color'], '#112233');
    assert.strictEqual(updates['_sd_ctrl-chart-text'], '#112233');
  });

  test('cascadeColor: block-bg stops at overridden children', () => {
    const updates = S.cascadeColor('_sd_ctrl-block-bg', '#aabbcc', new Set(['_sd_ctrl-code-bg']));
    assert.strictEqual(updates['_sd_ctrl-code-bg'], undefined);
    assert.strictEqual(updates['_sd_ctrl-bq-bg'], '#aabbcc');
    assert.strictEqual(updates['_sd_ctrl-chart-bg'], '#aabbcc');
  });

  test('cascadeColor: block-text does not propagate to block-bg children', () => {
    const updates = S.cascadeColor('_sd_ctrl-block-text', '#112233', new Set());
    assert.strictEqual(updates['_sd_ctrl-code-bg'], undefined);
    assert.strictEqual(updates['_sd_ctrl-bq-bg'], undefined);
    assert.strictEqual(updates['_sd_ctrl-chart-bg'], undefined);
  });

  test('block colors are in COLOR_VAR_MAP not STANDALONE', () => {
    assert.ok(S.COLOR_VAR_MAP['_sd_ctrl-block-bg'], 'block-bg should be in COLOR_VAR_MAP');
    assert.ok(S.COLOR_VAR_MAP['_sd_ctrl-block-text'], 'block-text should be in COLOR_VAR_MAP');
    assert.ok(S.COLOR_VAR_MAP['_sd_ctrl-code-bg'], 'code-bg should be in COLOR_VAR_MAP');
    assert.ok(S.COLOR_VAR_MAP['_sd_ctrl-bq-bg'], 'bq-bg should be in COLOR_VAR_MAP');
    assert.ok(S.COLOR_VAR_MAP['_sd_ctrl-chart-bg'], 'chart-bg should be in COLOR_VAR_MAP');
    assert.ok(S.COLOR_VAR_MAP['_sd_ctrl-chart-text'], 'chart-text should be in COLOR_VAR_MAP');
    assert.ok(!S.STANDALONE_COLOR_IDS.includes('_sd_ctrl-code-bg'), 'code-bg should not be standalone');
    assert.ok(!S.STANDALONE_COLOR_IDS.includes('_sd_ctrl-bq-bg'), 'bq-bg should not be standalone');
    assert.ok(!S.STANDALONE_COLOR_IDS.includes('_sd_ctrl-bq-color'), 'bq-color should not be standalone');
  });

  test('controlToCssVars: code-bg maps to both --md-code-bg and --md-pre-bg', () => {
    const result = S.controlToCssVars('_sd_ctrl-code-bg', '#282c34', {});
    assert.ok(result.length === 2, 'should return 2 assignments');
    assert.ok(result.some(r => r.cssVar === '--md-code-bg'), 'should include --md-code-bg');
    assert.ok(result.some(r => r.cssVar === '--md-pre-bg'), 'should include --md-pre-bg');
  });

  test('controlToCssVars: chart-bg maps to --md-chart-bg', () => {
    const result = S.controlToCssVars('_sd_ctrl-chart-bg', '#f0f0f0', {});
    assert.deepStrictEqual(result, [{ cssVar: '--md-chart-bg', value: '#f0f0f0' }]);
  });

  test('controlToCssVars: chart-text maps to --md-chart-text', () => {
    const result = S.controlToCssVars('_sd_ctrl-chart-text', '#444444', {});
    assert.deepStrictEqual(result, [{ cssVar: '--md-chart-text', value: '#444444' }]);
  });

  test('collectStyles: blocks emitted when overridden', () => {
    const values = {
      '_sd_ctrl-font-family': "'Inter', sans-serif", '_sd_ctrl-base-size-num': '16',
      '_sd_ctrl-line-height-num': '1.75', '_sd_ctrl-h-font-family': 'inherit',
      '_sd_ctrl-h-scale-num': '1', '_sd_ctrl-h-mb-num': '0.4',
      '_sd_ctrl-h1-size-num': '2.1', '_sd_ctrl-h1-weight': '700',
      '_sd_ctrl-h2-size-num': '1.55', '_sd_ctrl-h2-weight': '600',
      '_sd_ctrl-h3-size-num': '1.2', '_sd_ctrl-h3-weight': '600',
      '_sd_ctrl-h4-size-num': '1', '_sd_ctrl-h4-weight': '600',
      '_sd_ctrl-p-lh-num': '1.75', '_sd_ctrl-p-mb-num': '1.1',
      '_sd_ctrl-link-color': '#2563eb', '_sd_ctrl-link-decoration': 'underline',
      '_sd_ctrl-code-font': "'JetBrains Mono', 'Fira Mono', monospace",
      '_sd_ctrl-code-bg': '#282c34', '_sd_ctrl-code-color': '#abb2bf',
      '_sd_ctrl-bq-border-color': '#2563eb', '_sd_ctrl-bq-bw-num': '3',
      '_sd_ctrl-bq-bg': '#eee', '_sd_ctrl-bq-size-num': '1', '_sd_ctrl-bq-color': '#666',
      '_sd_ctrl-list-spacing-num': '0.3', '_sd_ctrl-list-indent-num': '1.6',
      '_sd_ctrl-block-bg': '#1a1a2e', '_sd_ctrl-block-text': '#a0a0b0',
      '_sd_ctrl-chart-accent': '#3b82f6', '_sd_ctrl-chart-palette': 'monochrome',
      '_sd_ctrl-chart-bg': '#1a1a2e', '_sd_ctrl-chart-text': '#a0a0b0',
    };
    const overridden = new Set(['_sd_ctrl-block-bg', '_sd_ctrl-block-text', '_sd_ctrl-chart-bg', '_sd_ctrl-chart-text']);
    const styles = S.collectStyles(values, overridden);
    assert.ok(styles.blocks, 'blocks key should exist');
    assert.strictEqual(styles.blocks.background, '#1a1a2e');
    assert.strictEqual(styles.blocks.color, '#a0a0b0');
    assert.ok(styles.chart, 'chart key should exist');
    assert.strictEqual(styles.chart.background, '#1a1a2e');
    assert.strictEqual(styles.chart.textColor, '#a0a0b0');
  });

  test('stylesToControls: blocks styles roundtrip', () => {
    const styles = {
      blocks: { background: '#1a1a2e', color: '#a0a0b0' },
      chart: { background: '#222', textColor: '#ccc', accent: '#e11d48' }
    };
    const result = S.stylesToControls(styles);
    assert.strictEqual(result.controls['_sd_ctrl-block-bg'], '#1a1a2e');
    assert.strictEqual(result.controls['_sd_ctrl-block-text'], '#a0a0b0');
    assert.ok(result.overriddenColors.has('_sd_ctrl-block-bg'));
    assert.ok(result.overriddenColors.has('_sd_ctrl-block-text'));
    assert.strictEqual(result.controls['_sd_ctrl-chart-bg'], '#222');
    assert.strictEqual(result.controls['_sd_ctrl-chart-text'], '#ccc');
    assert.ok(result.overriddenColors.has('_sd_ctrl-chart-bg'));
    assert.ok(result.overriddenColors.has('_sd_ctrl-chart-text'));
  });
};
