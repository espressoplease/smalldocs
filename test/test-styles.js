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
      'ctrl-font-family': "'Inter', sans-serif", 'ctrl-base-size-num': '16',
      'ctrl-line-height-num': '1.75', 'ctrl-h-scale-num': '1', 'ctrl-h-mb-num': '0.4',
      'ctrl-h1-size-num': '2.1', 'ctrl-h1-weight': '700',
      'ctrl-h2-size-num': '1.55', 'ctrl-h2-weight': '600',
      'ctrl-h3-size-num': '1.2', 'ctrl-h3-weight': '600',
      'ctrl-h4-size-num': '1.0', 'ctrl-h4-weight': '600',
      'ctrl-p-lh-num': '1.75', 'ctrl-p-mb-num': '1.1',
      'ctrl-link-color': '#2563EB', 'ctrl-link-decoration': 'underline',
      'ctrl-code-font': "'JetBrains Mono', monospace", 'ctrl-code-bg': '#F4F1ED',
      'ctrl-code-color': '#6B21A8',
      'ctrl-bq-border-color': '#2563EB', 'ctrl-bq-bw-num': '3',
      'ctrl-bq-bg': '#F7F5F2', 'ctrl-bq-size-num': '1', 'ctrl-bq-color': '#6B6560',
      'ctrl-color': '#1c1917', 'ctrl-h-color': '#1c1917',
      'ctrl-h1-color': '#1c1917', 'ctrl-h2-color': '#1c1917',
      'ctrl-h3-color': '#1c1917', 'ctrl-h4-color': '#1c1917',
      'ctrl-p-color': '#1c1917', 'ctrl-list-color': '#1c1917',
    };
    const styles = S.collectStyles(values, new Set());
    assert.strictEqual(styles.color, undefined);
    assert.strictEqual(styles.headers.color, undefined);
    assert.strictEqual(styles.h1.color, undefined);
    assert.strictEqual(styles.p.color, undefined);
  });

  test('collectStyles: overridden colors emitted', () => {
    const values = {
      'ctrl-font-family': "'Inter', sans-serif", 'ctrl-base-size-num': '16',
      'ctrl-line-height-num': '1.75', 'ctrl-h-scale-num': '1', 'ctrl-h-mb-num': '0.4',
      'ctrl-h1-size-num': '2.1', 'ctrl-h1-weight': '700',
      'ctrl-h2-size-num': '1.55', 'ctrl-h2-weight': '600',
      'ctrl-h3-size-num': '1.2', 'ctrl-h3-weight': '600',
      'ctrl-h4-size-num': '1.0', 'ctrl-h4-weight': '600',
      'ctrl-p-lh-num': '1.75', 'ctrl-p-mb-num': '1.1',
      'ctrl-link-color': '#2563EB', 'ctrl-link-decoration': 'underline',
      'ctrl-code-font': "'JetBrains Mono', monospace", 'ctrl-code-bg': '#F4F1ED',
      'ctrl-code-color': '#6B21A8',
      'ctrl-bq-border-color': '#2563EB', 'ctrl-bq-bw-num': '3',
      'ctrl-bq-bg': '#F7F5F2', 'ctrl-bq-size-num': '1', 'ctrl-bq-color': '#6B6560',
      'ctrl-color': '#ff0000', 'ctrl-h1-color': '#0000ff',
    };
    const overridden = new Set(['ctrl-color', 'ctrl-h1-color']);
    const styles = S.collectStyles(values, overridden);
    assert.strictEqual(styles.color, '#ff0000');
    assert.strictEqual(styles.h1.color, '#0000ff');
    assert.strictEqual(styles.h2.color, undefined);
  });

  test('every non-color setting roundtrips through collectStyles → stylesToControls', () => {
    const values = {
      'ctrl-font-family': "'Lora', serif",
      'ctrl-base-size-num': '18',
      'ctrl-line-height-num': '1.8',
      'ctrl-h-font-family': "'Playfair Display', serif",
      'ctrl-h-scale-num': '1.2',
      'ctrl-h-mb-num': '0.6',
      'ctrl-h1-size-num': '2.5', 'ctrl-h1-weight': '800',
      'ctrl-h2-size-num': '1.8', 'ctrl-h2-weight': '700',
      'ctrl-h3-size-num': '1.4', 'ctrl-h3-weight': '600',
      'ctrl-h4-size-num': '1.1', 'ctrl-h4-weight': '500',
      'ctrl-p-lh-num': '1.9',
      'ctrl-p-mb-num': '1.3',
      'ctrl-link-color': '#e11d48',
      'ctrl-link-decoration': 'none',
      'ctrl-code-font': "'Fira Code', monospace",
      'ctrl-code-bg': '#282c34',
      'ctrl-code-color': '#abb2bf',
      'ctrl-bq-border-color': '#e11d48',
      'ctrl-bq-bw-num': '5',
      'ctrl-bq-bg': '#eee8e0',
      'ctrl-bq-size-num': '0.95',
      'ctrl-bq-color': '#555555',
      'ctrl-list-spacing-num': '0.5',
      'ctrl-list-indent-num': '1.5',
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
    assert.strictEqual(styles.code.background, '#282c34');
    assert.strictEqual(styles.code.color, '#abb2bf');
    assert.strictEqual(styles.blockquote.borderColor, '#e11d48');
    assert.strictEqual(styles.blockquote.borderWidth, 5);
    assert.strictEqual(styles.blockquote.background, '#eee8e0');
    assert.strictEqual(styles.blockquote.fontSize, 0.95);
    assert.strictEqual(styles.blockquote.color, '#555555');
    assert.strictEqual(styles.list.spacing, 0.5);
    assert.strictEqual(styles.list.indent, 1.5);

    const { controls } = S.stylesToControls(styles);
    assert.strictEqual(controls['ctrl-font-family'], 'Lora');
    assert.strictEqual(controls['ctrl-base-size-num'], 18);
    assert.strictEqual(controls['ctrl-line-height-num'], 1.8);
    assert.strictEqual(controls['ctrl-h-font-family'], 'Playfair Display');
    assert.strictEqual(controls['ctrl-h-scale-num'], 1.2);
    assert.strictEqual(controls['ctrl-h-mb-num'], 0.6);
    assert.strictEqual(controls['ctrl-h1-size-num'], 2.5);
    assert.strictEqual(controls['ctrl-h1-weight'], '800');
    assert.strictEqual(controls['ctrl-h2-size-num'], 1.8);
    assert.strictEqual(controls['ctrl-h2-weight'], '700');
    assert.strictEqual(controls['ctrl-h3-size-num'], 1.4);
    assert.strictEqual(controls['ctrl-h3-weight'], '600');
    assert.strictEqual(controls['ctrl-h4-size-num'], 1.1);
    assert.strictEqual(controls['ctrl-h4-weight'], '500');
    assert.strictEqual(controls['ctrl-p-lh-num'], 1.9);
    assert.strictEqual(controls['ctrl-p-mb-num'], 1.3);
    assert.strictEqual(controls['ctrl-link-color'], '#e11d48');
    assert.strictEqual(controls['ctrl-link-decoration'], 'none');
    assert.strictEqual(controls['ctrl-code-font'], 'Fira Code');
    assert.strictEqual(controls['ctrl-code-bg'], '#282c34');
    assert.strictEqual(controls['ctrl-code-color'], '#abb2bf');
    assert.strictEqual(controls['ctrl-bq-border-color'], '#e11d48');
    assert.strictEqual(controls['ctrl-bq-bw-num'], 5);
    assert.strictEqual(controls['ctrl-bq-bg'], '#eee8e0');
    assert.strictEqual(controls['ctrl-bq-size-num'], 0.95);
    assert.strictEqual(controls['ctrl-bq-color'], '#555555');
    assert.strictEqual(controls['ctrl-list-spacing-num'], 0.5);
    assert.strictEqual(controls['ctrl-list-indent-num'], 1.5);
  });

  test('every cascade color roundtrips through collectStyles → stylesToControls', () => {
    const values = {
      'ctrl-font-family': "'Inter', sans-serif", 'ctrl-base-size-num': '16',
      'ctrl-line-height-num': '1.75', 'ctrl-h-font-family': 'inherit',
      'ctrl-h-scale-num': '1', 'ctrl-h-mb-num': '0.4',
      'ctrl-h1-size-num': '2.1', 'ctrl-h1-weight': '700',
      'ctrl-h2-size-num': '1.55', 'ctrl-h2-weight': '600',
      'ctrl-h3-size-num': '1.2', 'ctrl-h3-weight': '600',
      'ctrl-h4-size-num': '1.0', 'ctrl-h4-weight': '600',
      'ctrl-p-lh-num': '1.75', 'ctrl-p-mb-num': '1.1',
      'ctrl-link-color': '#2563EB', 'ctrl-link-decoration': 'underline',
      'ctrl-code-font': "'JetBrains Mono', monospace", 'ctrl-code-bg': '#F4F1ED',
      'ctrl-code-color': '#6B21A8',
      'ctrl-bq-border-color': '#2563EB', 'ctrl-bq-bw-num': '3',
      'ctrl-bq-bg': '#F7F5F2', 'ctrl-bq-size-num': '1', 'ctrl-bq-color': '#6B6560',
      'ctrl-list-spacing-num': '0.3', 'ctrl-list-indent-num': '1.6',
      'ctrl-color': '#111111',
      'ctrl-h-color': '#222222',
      'ctrl-h1-color': '#aa0000',
      'ctrl-h2-color': '#bb0000',
      'ctrl-h3-color': '#cc0000',
      'ctrl-h4-color': '#dd0000',
      'ctrl-p-color': '#333333',
      'ctrl-list-color': '#444444',
    };
    const allOverridden = new Set([
      'ctrl-color', 'ctrl-h-color',
      'ctrl-h1-color', 'ctrl-h2-color', 'ctrl-h3-color', 'ctrl-h4-color',
      'ctrl-p-color', 'ctrl-list-color',
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
    assert.strictEqual(controls['ctrl-color'], '#111111');
    assert.strictEqual(controls['ctrl-h-color'], '#222222');
    assert.strictEqual(controls['ctrl-h1-color'], '#aa0000');
    assert.strictEqual(controls['ctrl-h2-color'], '#bb0000');
    assert.strictEqual(controls['ctrl-h3-color'], '#cc0000');
    assert.strictEqual(controls['ctrl-h4-color'], '#dd0000');
    assert.strictEqual(controls['ctrl-p-color'], '#333333');
    assert.strictEqual(controls['ctrl-list-color'], '#444444');

    for (const id of allOverridden) {
      assert.ok(overriddenColors.has(id), `${id} should be in overriddenColors`);
    }
  });

  test('controlToCssVars: base-size adds px suffix', () => {
    const result = S.controlToCssVars('ctrl-base-size-num', '18', {});
    assert.deepStrictEqual(result, [{ cssVar: '--md-base-size', value: '18px' }]);
  });

  test('controlToCssVars: bq-border combines color + width', () => {
    const allVals = { 'ctrl-bq-border-color': '#ff0000', 'ctrl-bq-bw-num': '4' };
    const result = S.controlToCssVars('ctrl-bq-border-color', '#ff0000', allVals);
    assert.deepStrictEqual(result, [{ cssVar: '--md-bq-border', value: '4px solid #ff0000' }]);
  });

  test('controlToCssVars: code-bg sets both code-bg and pre-bg', () => {
    const result = S.controlToCssVars('ctrl-code-bg', '#f0f0f0', {});
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].cssVar, '--md-code-bg');
    assert.strictEqual(result[1].cssVar, '--md-pre-bg');
  });

  test('controlToCssVars: p-margin uses template', () => {
    const result = S.controlToCssVars('ctrl-p-mb-num', '1.5', {});
    assert.deepStrictEqual(result, [{ cssVar: '--md-p-margin', value: '0 0 1.5em' }]);
  });

  test('cascadeColor: propagates to non-overridden children', () => {
    const overridden = new Set();
    const updates = S.cascadeColor('ctrl-color', '#ff0000', overridden);
    assert.strictEqual(updates['ctrl-color'], '#ff0000');
    assert.strictEqual(updates['ctrl-h-color'], '#ff0000');
    assert.strictEqual(updates['ctrl-h1-color'], '#ff0000');
    assert.strictEqual(updates['ctrl-p-color'], '#ff0000');
    assert.strictEqual(updates['ctrl-list-color'], '#ff0000');
  });

  test('cascadeColor: stops at overridden children', () => {
    const overridden = new Set(['ctrl-h1-color']);
    const updates = S.cascadeColor('ctrl-color', '#ff0000', overridden);
    assert.strictEqual(updates['ctrl-h2-color'], '#ff0000');
    assert.strictEqual(updates['ctrl-h1-color'], undefined);
  });

  test('stylesToControls: maps all style keys to control IDs', () => {
    const styles = { fontFamily: 'Lora', baseFontSize: 17, color: '#ff0000',
      h1: { fontSize: 2.3, color: '#0000ff', fontWeight: 700 } };
    const { controls, overriddenColors } = S.stylesToControls(styles);
    assert.strictEqual(controls['ctrl-font-family'], 'Lora');
    assert.strictEqual(controls['ctrl-base-size-num'], 17);
    assert.ok(overriddenColors.has('ctrl-color'));
    assert.ok(overriddenColors.has('ctrl-h1-color'));
    assert.ok(!overriddenColors.has('ctrl-h2-color'));
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
    const result = S.controlToCssVars('ctrl-color', '#ff0000', {});
    assert.deepStrictEqual(result, [{ cssVar: '--md-color', value: '#ff0000' }]);
  });

  test('controlToCssVars: bg-color maps to --md-bg', () => {
    const result = S.controlToCssVars('ctrl-bg-color', '#ffffff', {});
    assert.deepStrictEqual(result, [{ cssVar: '--md-bg', value: '#ffffff' }]);
  });

  test('controlToCssVars: em suffix for heading sizes', () => {
    const result = S.controlToCssVars('ctrl-h1-size-num', '2.5', {});
    assert.deepStrictEqual(result, [{ cssVar: '--md-h1-size', value: '2.5em' }]);
  });

  test('cascadeColor: h-color propagates to h1-h4 but not p-color', () => {
    const updates = S.cascadeColor('ctrl-h-color', '#00ff00', new Set());
    assert.strictEqual(updates['ctrl-h1-color'], '#00ff00');
    assert.strictEqual(updates['ctrl-h4-color'], '#00ff00');
    assert.strictEqual(updates['ctrl-p-color'], undefined);
  });

  test('cascadeColor: p-color propagates to list-color', () => {
    const updates = S.cascadeColor('ctrl-p-color', '#333', new Set());
    assert.strictEqual(updates['ctrl-list-color'], '#333');
    assert.strictEqual(updates['ctrl-h1-color'], undefined);
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
    assert.strictEqual(S.STANDALONE_COLOR_IDS.length, 7);
    assert.ok(Array.isArray(S.ALL_COLOR_IDS));
    assert.strictEqual(S.ALL_COLOR_IDS.length, 15);
  });

  test('parseThemeColorBlock: extracts colors from theme block', () => {
    const block = {
      background: '#ffffff',
      color: '#1a1a2e',
      h1: { color: '#c0392b' },
      link: { color: '#2563eb' },
      code: { background: '#f0f0f0', color: '#333' },
      blockquote: { borderColor: '#aaa', background: '#eee', color: '#666' },
    };
    const result = S.parseThemeColorBlock(block);
    assert.strictEqual(result.colors['ctrl-bg-color'], '#ffffff');
    assert.strictEqual(result.colors['ctrl-color'], '#1a1a2e');
    assert.strictEqual(result.colors['ctrl-h1-color'], '#c0392b');
    assert.strictEqual(result.colors['ctrl-link-color'], '#2563eb');
    assert.strictEqual(result.colors['ctrl-code-bg'], '#f0f0f0');
    assert.strictEqual(result.colors['ctrl-code-color'], '#333');
    assert.strictEqual(result.colors['ctrl-bq-border-color'], '#aaa');
    assert.strictEqual(result.colors['ctrl-bq-bg'], '#eee');
    assert.strictEqual(result.colors['ctrl-bq-color'], '#666');
    assert.ok(result.overridden.has('ctrl-bg-color'));
    assert.ok(result.overridden.has('ctrl-color'));
    assert.ok(result.overridden.has('ctrl-h1-color'));
    assert.ok(result.overridden.has('ctrl-link-color'));
    assert.ok(result.overridden.has('ctrl-bq-bg'));
    assert.strictEqual(result.overridden.size, 9);
  });

  test('parseThemeColorBlock: null/undefined returns empty', () => {
    const r1 = S.parseThemeColorBlock(null);
    assert.deepStrictEqual(r1.colors, {});
    assert.strictEqual(r1.overridden.size, 0);
    const r2 = S.parseThemeColorBlock(undefined);
    assert.deepStrictEqual(r2.colors, {});
  });

  test('parseThemeColorBlock: all cascade colors extracted', () => {
    const block = {
      color: '#111',
      headers: { color: '#222' },
      h1: { color: '#a00' }, h2: { color: '#b00' },
      h3: { color: '#c00' }, h4: { color: '#d00' },
      p: { color: '#333' },
      list: { color: '#444' },
    };
    const result = S.parseThemeColorBlock(block);
    assert.strictEqual(result.colors['ctrl-color'], '#111');
    assert.strictEqual(result.colors['ctrl-h-color'], '#222');
    assert.strictEqual(result.colors['ctrl-h1-color'], '#a00');
    assert.strictEqual(result.colors['ctrl-h2-color'], '#b00');
    assert.strictEqual(result.colors['ctrl-h3-color'], '#c00');
    assert.strictEqual(result.colors['ctrl-h4-color'], '#d00');
    assert.strictEqual(result.colors['ctrl-p-color'], '#333');
    assert.strictEqual(result.colors['ctrl-list-color'], '#444');
    assert.strictEqual(result.overridden.size, 8);
  });

  test('collectThemeColors: builds theme block from overridden colors', () => {
    const colors = {
      'ctrl-bg-color': '#ffffff',
      'ctrl-color': '#111',
      'ctrl-h1-color': '#a00',
      'ctrl-link-color': '#2563eb',
      'ctrl-code-bg': '#f0f0f0',
    };
    const overridden = new Set(['ctrl-bg-color', 'ctrl-color', 'ctrl-h1-color', 'ctrl-link-color', 'ctrl-code-bg']);
    const block = S.collectThemeColors(colors, overridden);
    assert.strictEqual(block.background, '#ffffff');
    assert.strictEqual(block.color, '#111');
    assert.strictEqual(block.h1.color, '#a00');
    assert.strictEqual(block.link.color, '#2563eb');
    assert.strictEqual(block.code.background, '#f0f0f0');
    // Non-overridden colors should not appear
    assert.strictEqual(block.h2, undefined);
    assert.strictEqual(block.blockquote, undefined);
  });

  test('collectThemeColors: empty overridden returns empty block', () => {
    const block = S.collectThemeColors({}, new Set());
    assert.deepStrictEqual(block, {});
  });

  test('collectStylesDual: produces light/dark blocks with shared non-color props', () => {
    const values = {
      'ctrl-font-family': "'Lora', sans-serif", 'ctrl-base-size-num': '17',
      'ctrl-line-height-num': '1.75', 'ctrl-h-font-family': 'inherit',
      'ctrl-h-scale-num': '1', 'ctrl-h-mb-num': '0.4',
      'ctrl-h1-size-num': '2.1', 'ctrl-h1-weight': '700',
      'ctrl-h2-size-num': '1.55', 'ctrl-h2-weight': '600',
      'ctrl-h3-size-num': '1.2', 'ctrl-h3-weight': '600',
      'ctrl-h4-size-num': '1.0', 'ctrl-h4-weight': '600',
      'ctrl-p-lh-num': '1.75', 'ctrl-p-mb-num': '1.1',
      'ctrl-link-decoration': 'underline',
      'ctrl-code-font': "'JetBrains Mono', monospace",
      'ctrl-bq-bw-num': '3', 'ctrl-bq-size-num': '1',
      'ctrl-list-spacing-num': '0.3', 'ctrl-list-indent-num': '1.6',
    };
    const lightOverridden = new Set(['ctrl-color', 'ctrl-h1-color']);
    const darkOverridden = new Set(['ctrl-color']);
    const lightColors = { 'ctrl-color': '#1a1a2e', 'ctrl-h1-color': '#c0392b' };
    const darkColors = { 'ctrl-color': '#e7e5e2' };

    const styles = S.collectStylesDual(values, lightOverridden, darkOverridden, lightColors, darkColors);

    // Shared properties at top level
    assert.strictEqual(styles.fontFamily, 'Lora');
    assert.strictEqual(styles.baseFontSize, 17);

    // Light block
    assert.ok(styles.light);
    assert.strictEqual(styles.light.color, '#1a1a2e');
    assert.strictEqual(styles.light.h1.color, '#c0392b');

    // Dark block
    assert.ok(styles.dark);
    assert.strictEqual(styles.dark.color, '#e7e5e2');

    // No top-level color (it's in light/dark blocks now)
    assert.strictEqual(styles.color, undefined);
  });

  test('stylesToControls: detects light/dark theme blocks', () => {
    const styles = {
      fontFamily: 'Lora',
      baseFontSize: 17,
      light: { color: '#1a1a2e', h1: { color: '#c0392b' } },
      dark: { color: '#e7e5e2' },
    };
    const result = S.stylesToControls(styles);
    assert.strictEqual(result.hasThemeColors, true);
    assert.strictEqual(result.controls['ctrl-font-family'], 'Lora');
    assert.strictEqual(result.lightColors['ctrl-color'], '#1a1a2e');
    assert.strictEqual(result.lightColors['ctrl-h1-color'], '#c0392b');
    assert.ok(result.lightOverridden.has('ctrl-color'));
    assert.ok(result.lightOverridden.has('ctrl-h1-color'));
    assert.strictEqual(result.darkColors['ctrl-color'], '#e7e5e2');
    assert.ok(result.darkOverridden.has('ctrl-color'));
  });

  test('stylesToControls: legacy format (no light/dark) backwards compat', () => {
    const styles = { fontFamily: 'Inter', color: '#ff0000', h1: { color: '#0000ff' } };
    const result = S.stylesToControls(styles);
    assert.strictEqual(result.hasThemeColors, false);
    assert.ok(result.overriddenColors.has('ctrl-color'));
    assert.ok(result.overriddenColors.has('ctrl-h1-color'));
    assert.strictEqual(result.controls['ctrl-color'], '#ff0000');
  });

  test('parseThemeColorBlock → collectThemeColors roundtrip', () => {
    const block = {
      background: '#ffffff',
      color: '#1a1a2e',
      headers: { color: '#2c3e50' },
      h1: { color: '#c0392b' },
      p: { color: '#333' },
      link: { color: '#2563eb' },
      code: { background: '#f0f0f0', color: '#6b21a8' },
      blockquote: { borderColor: '#2563eb', background: '#f0ebe4', color: '#666' },
    };
    const parsed = S.parseThemeColorBlock(block);
    const rebuilt = S.collectThemeColors(parsed.colors, parsed.overridden);
    assert.strictEqual(rebuilt.background, block.background);
    assert.strictEqual(rebuilt.color, block.color);
    assert.strictEqual(rebuilt.headers.color, block.headers.color);
    assert.strictEqual(rebuilt.h1.color, block.h1.color);
    assert.strictEqual(rebuilt.p.color, block.p.color);
    assert.strictEqual(rebuilt.link.color, block.link.color);
    assert.strictEqual(rebuilt.code.background, block.code.background);
    assert.strictEqual(rebuilt.code.color, block.code.color);
    assert.strictEqual(rebuilt.blockquote.borderColor, block.blockquote.borderColor);
    assert.strictEqual(rebuilt.blockquote.background, block.blockquote.background);
    assert.strictEqual(rebuilt.blockquote.color, block.blockquote.color);
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

  test('stripStyleDefaults: preserves light/dark blocks untouched', () => {
    const styles = {
      fontFamily: 'Inter',  // default — stripped
      baseFontSize: 16,     // default — stripped
      light: { background: '#ffffff', color: '#1c1917' },
      dark: { background: '#2c2a26', color: '#e7e5e2' },
    };
    const result = S.stripStyleDefaults(styles);
    assert.deepStrictEqual(result.light, styles.light);
    assert.deepStrictEqual(result.dark, styles.dark);
    assert.strictEqual(result.fontFamily, undefined);
    assert.strictEqual(result.baseFontSize, undefined);
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
      'ctrl-font-family': "'Lora', serif",
      'ctrl-base-size-num': '18',
      'ctrl-line-height-num': '1.8',
      'ctrl-h-font-family': "'Playfair Display', serif",
      'ctrl-h-scale-num': '1.2',
      'ctrl-h-mb-num': '0.6',
      'ctrl-h1-size-num': '2.5', 'ctrl-h1-weight': '800',
      'ctrl-h2-size-num': '1.55', 'ctrl-h2-weight': '600', // h2 all default
      'ctrl-h3-size-num': '1.2', 'ctrl-h3-weight': '600',  // h3 all default
      'ctrl-h4-size-num': '1.0', 'ctrl-h4-weight': '600',  // h4 all default
      'ctrl-p-lh-num': '1.75', 'ctrl-p-mb-num': '1.1',     // p all default
      'ctrl-link-color': '#e11d48', 'ctrl-link-decoration': 'none',
      'ctrl-code-font': "'JetBrains Mono', monospace",      // default
      'ctrl-code-bg': '#282c34', 'ctrl-code-color': '#abb2bf',
      'ctrl-bq-border-color': '#e11d48', 'ctrl-bq-bw-num': '3', // bw default
      'ctrl-bq-bg': '#eee8e0', 'ctrl-bq-size-num': '1',    // size default
      'ctrl-bq-color': '#555555',
      'ctrl-list-spacing-num': '0.3', 'ctrl-list-indent-num': '1.6', // default
    };
    const original = S.collectStyles(values, new Set());
    const stripped = S.stripStyleDefaults(original);
    const { controls } = S.stylesToControls(stripped);

    // Non-default values must be present
    assert.strictEqual(controls['ctrl-font-family'], 'Lora');
    assert.strictEqual(controls['ctrl-base-size-num'], 18);
    assert.strictEqual(controls['ctrl-line-height-num'], 1.8);
    assert.strictEqual(controls['ctrl-h-font-family'], 'Playfair Display');
    assert.strictEqual(controls['ctrl-h-scale-num'], 1.2);
    assert.strictEqual(controls['ctrl-h-mb-num'], 0.6);
    assert.strictEqual(controls['ctrl-h1-size-num'], 2.5);
    assert.strictEqual(controls['ctrl-h1-weight'], '800');
    assert.strictEqual(controls['ctrl-link-decoration'], 'none');

    // Default values must NOT be in controls (browser fills them from HTML defaults)
    assert.strictEqual(controls['ctrl-h2-size-num'], undefined);
    assert.strictEqual(controls['ctrl-h2-weight'], undefined);
    assert.strictEqual(controls['ctrl-p-lh-num'], undefined);
    assert.strictEqual(controls['ctrl-list-spacing-num'], undefined);
  });

  test('stripStyleDefaults + light/dark: full collect → strip → parse roundtrip', () => {
    const values = {
      'ctrl-font-family': "'Inter', sans-serif", 'ctrl-base-size-num': '16',
      'ctrl-line-height-num': '1.75', 'ctrl-h-font-family': 'inherit',
      'ctrl-h-scale-num': '1', 'ctrl-h-mb-num': '0.4',
      'ctrl-h1-size-num': '2.1', 'ctrl-h1-weight': '700',
      'ctrl-h2-size-num': '1.55', 'ctrl-h2-weight': '600',
      'ctrl-h3-size-num': '1.2', 'ctrl-h3-weight': '600',
      'ctrl-h4-size-num': '1.0', 'ctrl-h4-weight': '600',
      'ctrl-p-lh-num': '1.75', 'ctrl-p-mb-num': '1.1',
      'ctrl-link-decoration': 'underline',
      'ctrl-code-font': "'JetBrains Mono', monospace",
      'ctrl-bq-bw-num': '3', 'ctrl-bq-size-num': '1',
      'ctrl-list-spacing-num': '0.3', 'ctrl-list-indent-num': '1.6',
    };
    const lightOverridden = new Set(['ctrl-color', 'ctrl-bg-color']);
    const darkOverridden = new Set(['ctrl-color', 'ctrl-bg-color']);
    const lightColors = { 'ctrl-color': '#1c1917', 'ctrl-bg-color': '#ffffff' };
    const darkColors = { 'ctrl-color': '#e7e5e2', 'ctrl-bg-color': '#2c2a26' };

    const styles = S.collectStylesDual(values, lightOverridden, darkOverridden, lightColors, darkColors);
    const stripped = S.stripStyleDefaults(styles);

    // All non-color top-level styles were default — should be stripped
    assert.strictEqual(stripped.fontFamily, undefined);
    assert.strictEqual(stripped.baseFontSize, undefined);
    assert.strictEqual(stripped.h1, undefined);

    // light/dark blocks must survive
    assert.ok(stripped.light);
    assert.strictEqual(stripped.light.color, '#1c1917');
    assert.strictEqual(stripped.light.background, '#ffffff');
    assert.ok(stripped.dark);
    assert.strictEqual(stripped.dark.color, '#e7e5e2');

    // Parse back — theme blocks should be detected
    const result = S.stylesToControls(stripped);
    assert.strictEqual(result.hasThemeColors, true);
    assert.strictEqual(result.lightColors['ctrl-color'], '#1c1917');
    assert.strictEqual(result.darkColors['ctrl-color'], '#e7e5e2');
  });
};
