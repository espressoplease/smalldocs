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
      'ctrl-bq-size-num': '1', 'ctrl-bq-color': '#6B6560',
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
      'ctrl-bq-size-num': '1', 'ctrl-bq-color': '#6B6560',
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
      'ctrl-bq-size-num': '1', 'ctrl-bq-color': '#6B6560',
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
};
