// sdocs-styles.js — Pure data tables + logic for SDocs style system
// Shared by app.js (browser) and test/run.js (Node)
(function (exports) {
'use strict';

// ═══════════════════════════════════════════════════════
//  DATA TABLES
// ═══════════════════════════════════════════════════════

const COLOR_DEFAULT = '#1c1917';

// Control ID → CSS variable name (color controls only)
const COLOR_VAR_MAP = {
  'ctrl-color':      '--md-color',
  'ctrl-h-color':    '--md-h-color',
  'ctrl-h1-color':   '--md-h1-color',
  'ctrl-h2-color':   '--md-h2-color',
  'ctrl-h3-color':   '--md-h3-color',
  'ctrl-h4-color':   '--md-h4-color',
  'ctrl-p-color':    '--md-p-color',
  'ctrl-list-color': '--md-list-color',
};

// Cascade tree: parent → direct children
const COLOR_CASCADE = {
  'ctrl-color':   ['ctrl-h-color', 'ctrl-p-color'],
  'ctrl-h-color': ['ctrl-h1-color', 'ctrl-h2-color', 'ctrl-h3-color', 'ctrl-h4-color'],
  'ctrl-p-color': ['ctrl-list-color'],
};

// Control ID → { cssVar, suffix?, compound? }
// Maps every non-color control to its CSS variable and optional unit suffix
const CTRL_CSS_MAP = {
  'ctrl-font-family':      { cssVar: '--md-font-family' },
  'ctrl-base-size-num':    { cssVar: '--md-base-size', suffix: 'px' },
  'ctrl-line-height-num':  { cssVar: '--md-line-height' },
  'ctrl-h-font-family':    { cssVar: '--md-h-font-family' },
  'ctrl-h-scale-num':      { cssVar: '--md-h-scale' },
  'ctrl-h-mb-num':         { cssVar: '--md-h-margin-bottom', suffix: 'em' },
  'ctrl-h1-size-num':      { cssVar: '--md-h1-size', suffix: 'em' },
  'ctrl-h1-weight':        { cssVar: '--md-h1-weight' },
  'ctrl-h2-size-num':      { cssVar: '--md-h2-size', suffix: 'em' },
  'ctrl-h2-weight':        { cssVar: '--md-h2-weight' },
  'ctrl-h3-size-num':      { cssVar: '--md-h3-size', suffix: 'em' },
  'ctrl-h3-weight':        { cssVar: '--md-h3-weight' },
  'ctrl-h4-size-num':      { cssVar: '--md-h4-size', suffix: 'em' },
  'ctrl-h4-weight':        { cssVar: '--md-h4-weight' },
  'ctrl-p-lh-num':         { cssVar: '--md-p-line-height' },
  'ctrl-p-mb-num':         { cssVar: '--md-p-margin', template: '0 0 {v}em' },
  'ctrl-link-color':       { cssVar: '--md-link-color' },
  'ctrl-link-decoration':  { cssVar: '--md-link-decoration' },
  'ctrl-code-font':        { cssVar: '--md-code-font' },
  'ctrl-code-bg':          { cssVar: ['--md-code-bg', '--md-pre-bg'] },
  'ctrl-code-color':       { cssVar: '--md-code-color' },
  'ctrl-bq-border-color':  { cssVar: '--md-bq-border', compound: 'bq-border' },
  'ctrl-bq-bw-num':        { cssVar: '--md-bq-border', compound: 'bq-border' },
  'ctrl-bq-size-num':      { cssVar: '--md-bq-size', suffix: 'em' },
  'ctrl-bq-color':         { cssVar: '--md-bq-color' },
  'ctrl-list-spacing-num': { cssVar: '--md-list-spacing', suffix: 'em' },
  'ctrl-list-indent-num':  { cssVar: '--md-list-indent', suffix: 'em' },
};

// Range ↔ Number input pairs
const RANGE_NUM_PAIRS = [
  ['ctrl-base-size-range',    'ctrl-base-size-num'],
  ['ctrl-line-height-range',  'ctrl-line-height-num'],
  ['ctrl-h-scale-range',      'ctrl-h-scale-num'],
  ['ctrl-h-mb-range',         'ctrl-h-mb-num'],
  ['ctrl-h1-size-range',      'ctrl-h1-size-num'],
  ['ctrl-h2-size-range',      'ctrl-h2-size-num'],
  ['ctrl-h3-size-range',      'ctrl-h3-size-num'],
  ['ctrl-h4-size-range',      'ctrl-h4-size-num'],
  ['ctrl-p-lh-range',         'ctrl-p-lh-num'],
  ['ctrl-p-mb-range',         'ctrl-p-mb-num'],
  ['ctrl-bq-bw-range',        'ctrl-bq-bw-num'],
  ['ctrl-bq-size-range',      'ctrl-bq-size-num'],
  ['ctrl-list-spacing-range', 'ctrl-list-spacing-num'],
  ['ctrl-list-indent-range',  'ctrl-list-indent-num'],
];

// ═══════════════════════════════════════════════════════
//  PURE FUNCTIONS
// ═══════════════════════════════════════════════════════

/**
 * controlToCssVars(ctrlId, value, allValues)
 * Returns [{ cssVar, value }] — the CSS property assignments for a control change.
 */
function controlToCssVars(ctrlId, value, allValues) {
  // Color controls go through the cascade system, not CTRL_CSS_MAP
  if (COLOR_VAR_MAP[ctrlId]) {
    return [{ cssVar: COLOR_VAR_MAP[ctrlId], value: value }];
  }

  const entry = CTRL_CSS_MAP[ctrlId];
  if (!entry) return [];

  // Compound: bq-border combines color + width
  if (entry.compound === 'bq-border') {
    const col = allValues['ctrl-bq-border-color'] || '#2563EB';
    const w = allValues['ctrl-bq-bw-num'] || '3';
    return [{ cssVar: '--md-bq-border', value: `${w}px solid ${col}` }];
  }

  // Template: p-margin uses "0 0 {v}em"
  if (entry.template) {
    const formatted = entry.template.replace('{v}', value);
    return [{ cssVar: entry.cssVar, value: formatted }];
  }

  // Array of CSS vars (e.g. code-bg sets both --md-code-bg and --md-pre-bg)
  if (Array.isArray(entry.cssVar)) {
    return entry.cssVar.map(cv => ({ cssVar: cv, value: value + (entry.suffix || '') }));
  }

  // Simple: value + optional suffix
  return [{ cssVar: entry.cssVar, value: value + (entry.suffix || '') }];
}

/**
 * cascadeColor(ctrlId, value, overridden)
 * Returns { ctrlId: value } — all controls that should be updated.
 * Propagates to non-overridden children recursively.
 */
function cascadeColor(ctrlId, value, overridden) {
  const updates = {};
  updates[ctrlId] = value;
  for (const childId of (COLOR_CASCADE[ctrlId] || [])) {
    if (!overridden.has(childId)) {
      const childUpdates = cascadeColor(childId, value, overridden);
      Object.assign(updates, childUpdates);
    }
  }
  return updates;
}

/**
 * collectStyles(values, overriddenColors)
 * Takes a plain { controlId: value } object + the overridden set.
 * Returns the styles object for YAML serialization.
 */
function collectStyles(values, overriddenColors) {
  const gv = id => values[id] || '';
  const gn = id => parseFloat(values[id]) || 0;

  const styles = {
    fontFamily:   gv('ctrl-font-family').replace(/['"]/g, '').split(',')[0].trim(),
    baseFontSize: gn('ctrl-base-size-num'),
    lineHeight:   gn('ctrl-line-height-num'),
    headers: {
      scale:        gn('ctrl-h-scale-num'),
      marginBottom: gn('ctrl-h-mb-num'),
    },
    h1: { fontSize: gn('ctrl-h1-size-num'), fontWeight: parseInt(gv('ctrl-h1-weight')) || 0 },
    h2: { fontSize: gn('ctrl-h2-size-num'), fontWeight: parseInt(gv('ctrl-h2-weight')) || 0 },
    h3: { fontSize: gn('ctrl-h3-size-num'), fontWeight: parseInt(gv('ctrl-h3-weight')) || 0 },
    h4: { fontSize: gn('ctrl-h4-size-num'), fontWeight: parseInt(gv('ctrl-h4-weight')) || 0 },
    p: {
      lineHeight:   gn('ctrl-p-lh-num'),
      marginBottom: gn('ctrl-p-mb-num'),
    },
    link: { color: gv('ctrl-link-color'), decoration: gv('ctrl-link-decoration') },
    code: {
      font:       gv('ctrl-code-font').replace(/['"]/g, '').split(',')[0].trim(),
      background: gv('ctrl-code-bg'),
      color:      gv('ctrl-code-color'),
    },
    blockquote: {
      borderColor: gv('ctrl-bq-border-color'),
      borderWidth: gn('ctrl-bq-bw-num'),
      fontSize:    gn('ctrl-bq-size-num'),
      color:       gv('ctrl-bq-color'),
    },
  };

  // Only emit cascade colors that were explicitly overridden
  if (overriddenColors.has('ctrl-color'))      styles.color = gv('ctrl-color');
  if (overriddenColors.has('ctrl-h-color'))    styles.headers.color = gv('ctrl-h-color');
  if (overriddenColors.has('ctrl-h1-color'))   styles.h1.color = gv('ctrl-h1-color');
  if (overriddenColors.has('ctrl-h2-color'))   styles.h2.color = gv('ctrl-h2-color');
  if (overriddenColors.has('ctrl-h3-color'))   styles.h3.color = gv('ctrl-h3-color');
  if (overriddenColors.has('ctrl-h4-color'))   styles.h4.color = gv('ctrl-h4-color');
  if (overriddenColors.has('ctrl-p-color'))    styles.p.color = gv('ctrl-p-color');
  if (overriddenColors.has('ctrl-list-color')) styles.list = { color: gv('ctrl-list-color') };

  return styles;
}

/**
 * stylesToControls(styles)
 * Inverse of collectStyles. Takes a styles object (from YAML front matter).
 * Returns { controls: { controlId: value }, overriddenColors: Set }.
 */
function stylesToControls(styles) {
  if (!styles) return { controls: {}, overriddenColors: new Set() };

  const controls = {};
  const overridden = new Set();

  if (styles.fontFamily)   controls['ctrl-font-family'] = styles.fontFamily;
  if (styles.baseFontSize) controls['ctrl-base-size-num'] = styles.baseFontSize;
  if (styles.lineHeight)   controls['ctrl-line-height-num'] = styles.lineHeight;

  if (styles.color) {
    controls['ctrl-color'] = styles.color;
    overridden.add('ctrl-color');
  }

  const h = styles.headers || {};
  if (h.scale)        controls['ctrl-h-scale-num'] = h.scale;
  if (h.marginBottom) controls['ctrl-h-mb-num'] = h.marginBottom;
  if (h.color) {
    controls['ctrl-h-color'] = h.color;
    overridden.add('ctrl-h-color');
  }

  ['h1', 'h2', 'h3', 'h4'].forEach(t => {
    const hs = styles[t] || {};
    if (hs.fontSize)   controls[`ctrl-${t}-size-num`] = hs.fontSize;
    if (hs.fontWeight) controls[`ctrl-${t}-weight`] = String(hs.fontWeight);
    if (hs.color) {
      controls[`ctrl-${t}-color`] = hs.color;
      overridden.add(`ctrl-${t}-color`);
    }
  });

  const p = styles.p || {};
  if (p.lineHeight)   controls['ctrl-p-lh-num'] = p.lineHeight;
  if (p.marginBottom) controls['ctrl-p-mb-num'] = p.marginBottom;
  if (p.color) {
    controls['ctrl-p-color'] = p.color;
    overridden.add('ctrl-p-color');
  }

  const lk = styles.link || {};
  if (lk.color)      controls['ctrl-link-color'] = lk.color;
  if (lk.decoration) controls['ctrl-link-decoration'] = lk.decoration;

  const cd = styles.code || {};
  if (cd.font)       controls['ctrl-code-font'] = cd.font;
  if (cd.background) controls['ctrl-code-bg'] = cd.background;
  if (cd.color)      controls['ctrl-code-color'] = cd.color;

  const bq = styles.blockquote || {};
  if (bq.borderColor) controls['ctrl-bq-border-color'] = bq.borderColor;
  if (bq.borderWidth) controls['ctrl-bq-bw-num'] = bq.borderWidth;
  if (bq.fontSize)    controls['ctrl-bq-size-num'] = bq.fontSize;
  if (bq.color)       controls['ctrl-bq-color'] = bq.color;

  const ll = styles.list || {};
  if (ll.color) {
    controls['ctrl-list-color'] = ll.color;
    overridden.add('ctrl-list-color');
  }

  return { controls, overriddenColors: overridden };
}

// ═══════════════════════════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════════════════════════
exports.COLOR_DEFAULT   = COLOR_DEFAULT;
exports.COLOR_VAR_MAP   = COLOR_VAR_MAP;
exports.COLOR_CASCADE   = COLOR_CASCADE;
exports.CTRL_CSS_MAP    = CTRL_CSS_MAP;
exports.RANGE_NUM_PAIRS = RANGE_NUM_PAIRS;

exports.controlToCssVars  = controlToCssVars;
exports.cascadeColor      = cascadeColor;
exports.collectStyles     = collectStyles;
exports.stylesToControls  = stylesToControls;

// UMD tail: in Node (tests) this writes to module.exports; in the browser
// it creates window.SDocStyles.  We use this pattern instead of ES modules
// because index.html is a single-file inline-script app with no build step.
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocStyles = {}));
