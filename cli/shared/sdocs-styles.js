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
  '_sd_ctrl-color':       '--md-color',
  '_sd_ctrl-h-color':     '--md-h-color',
  '_sd_ctrl-h1-color':    '--md-h1-color',
  '_sd_ctrl-h2-color':    '--md-h2-color',
  '_sd_ctrl-h3-color':    '--md-h3-color',
  '_sd_ctrl-h4-color':    '--md-h4-color',
  '_sd_ctrl-p-color':     '--md-p-color',
  '_sd_ctrl-list-color':  '--md-list-color',
  // Block cascade
  '_sd_ctrl-block-bg':    '--md-block-bg',
  '_sd_ctrl-block-text':  '--md-block-text',
  '_sd_ctrl-code-bg':     ['--md-code-bg', '--md-pre-bg'],
  '_sd_ctrl-code-color':  '--md-code-color',
  '_sd_ctrl-bq-bg':       '--md-bq-bg',
  '_sd_ctrl-bq-color':    '--md-bq-color',
  '_sd_ctrl-chart-bg':    '--md-chart-bg',
  '_sd_ctrl-chart-text':  '--md-chart-text',
};

// Cascade tree: parent → direct children
const COLOR_CASCADE = {
  '_sd_ctrl-color':      ['_sd_ctrl-h-color', '_sd_ctrl-p-color'],
  '_sd_ctrl-h-color':    ['_sd_ctrl-h1-color', '_sd_ctrl-h2-color', '_sd_ctrl-h3-color', '_sd_ctrl-h4-color'],
  '_sd_ctrl-p-color':    ['_sd_ctrl-list-color'],
  '_sd_ctrl-block-bg':   ['_sd_ctrl-code-bg', '_sd_ctrl-bq-bg', '_sd_ctrl-chart-bg'],
  '_sd_ctrl-block-text': ['_sd_ctrl-code-color', '_sd_ctrl-bq-color', '_sd_ctrl-chart-text'],
};

// Control ID → { cssVar, suffix?, compound? }
// Maps every non-color control to its CSS variable and optional unit suffix
const CTRL_CSS_MAP = {
  '_sd_ctrl-bg-color':         { cssVar: '--md-bg' },
  '_sd_ctrl-font-family':      { cssVar: '--md-font-family' },
  '_sd_ctrl-base-size-num':    { cssVar: '--md-base-size', suffix: 'px' },
  '_sd_ctrl-line-height-num':  { cssVar: '--md-line-height' },
  '_sd_ctrl-h-font-family':    { cssVar: '--md-h-font-family' },
  '_sd_ctrl-h-scale-num':      { cssVar: '--md-h-scale' },
  '_sd_ctrl-h-mb-num':         { cssVar: '--md-h-margin-bottom', suffix: 'em' },
  '_sd_ctrl-h1-size-num':      { cssVar: '--md-h1-size', suffix: 'em' },
  '_sd_ctrl-h1-weight':        { cssVar: '--md-h1-weight' },
  '_sd_ctrl-h2-size-num':      { cssVar: '--md-h2-size', suffix: 'em' },
  '_sd_ctrl-h2-weight':        { cssVar: '--md-h2-weight' },
  '_sd_ctrl-h3-size-num':      { cssVar: '--md-h3-size', suffix: 'em' },
  '_sd_ctrl-h3-weight':        { cssVar: '--md-h3-weight' },
  '_sd_ctrl-h4-size-num':      { cssVar: '--md-h4-size', suffix: 'em' },
  '_sd_ctrl-h4-weight':        { cssVar: '--md-h4-weight' },
  '_sd_ctrl-p-lh-num':         { cssVar: '--md-p-line-height' },
  '_sd_ctrl-p-mb-num':         { cssVar: '--md-p-margin', template: '0 0 {v}em' },
  '_sd_ctrl-link-color':       { cssVar: '--md-link-color' },
  '_sd_ctrl-link-decoration':  { cssVar: '--md-link-decoration' },
  '_sd_ctrl-code-font':        { cssVar: '--md-code-font' },
  '_sd_ctrl-bq-border-color':  { cssVar: '--md-bq-border', compound: 'bq-border' },
  '_sd_ctrl-bq-bw-num':        { cssVar: '--md-bq-border', compound: 'bq-border' },
  '_sd_ctrl-bq-size-num':      { cssVar: '--md-bq-size', suffix: 'em' },
  '_sd_ctrl-list-spacing-num': { cssVar: '--md-list-spacing', suffix: 'em' },
  '_sd_ctrl-list-indent-num':  { cssVar: '--md-list-indent', suffix: 'em' },
  '_sd_ctrl-chart-accent':     { cssVar: '--md-chart-accent' },
  '_sd_ctrl-chart-palette':    { cssVar: '--md-chart-palette' },
  '_sd_ctrl-table-border':     { cssVar: '--md-table-border' },
  '_sd_ctrl-table-header-bg':  { cssVar: '--md-table-header-bg' },
  '_sd_ctrl-table-even-bg':    { cssVar: '--md-table-even-bg' },
  '_sd_ctrl-table-odd-bg':     { cssVar: '--md-table-odd-bg' },
  '_sd_ctrl-table-text':       { cssVar: '--md-table-text' },
};

// Range ↔ Number input pairs
const RANGE_NUM_PAIRS = [
  ['_sd_ctrl-base-size-range',    '_sd_ctrl-base-size-num'],
  ['_sd_ctrl-line-height-range',  '_sd_ctrl-line-height-num'],
  ['_sd_ctrl-h-scale-range',      '_sd_ctrl-h-scale-num'],
  ['_sd_ctrl-h-mb-range',         '_sd_ctrl-h-mb-num'],
  ['_sd_ctrl-h1-size-range',      '_sd_ctrl-h1-size-num'],
  ['_sd_ctrl-h2-size-range',      '_sd_ctrl-h2-size-num'],
  ['_sd_ctrl-h3-size-range',      '_sd_ctrl-h3-size-num'],
  ['_sd_ctrl-h4-size-range',      '_sd_ctrl-h4-size-num'],
  ['_sd_ctrl-p-lh-range',         '_sd_ctrl-p-lh-num'],
  ['_sd_ctrl-p-mb-range',         '_sd_ctrl-p-mb-num'],
  ['_sd_ctrl-bq-bw-range',        '_sd_ctrl-bq-bw-num'],
  ['_sd_ctrl-bq-size-range',      '_sd_ctrl-bq-size-num'],
  ['_sd_ctrl-list-spacing-range', '_sd_ctrl-list-spacing-num'],
  ['_sd_ctrl-list-indent-range',  '_sd_ctrl-list-indent-num'],
];

// ═══════════════════════════════════════════════════════
//  HSL COLOR UTILITIES
// ═══════════════════════════════════════════════════════

function hexToHsl(hex) {
  if (!hex || hex.charAt(0) !== '#') return null;
  var r = parseInt(hex.slice(1, 3), 16) / 255;
  var g = parseInt(hex.slice(3, 5), 16) / 255;
  var b = parseInt(hex.slice(5, 7), 16) / 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  var c = (1 - Math.abs(2 * l - 1)) * s;
  var x = c * (1 - Math.abs((h / 60) % 2 - 1));
  var m = l - c / 2;
  var r, g, b;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  var toH = function(v) { var h = Math.round((v + m) * 255).toString(16); return h.length < 2 ? '0' + h : h; };
  return '#' + toH(r) + toH(g) + toH(b);
}

/**
 * invertLightness(hex)
 * Inverts a color's lightness for the opposite theme.
 * Light colors (L>50) become dark, dark colors become light.
 * Keeps hue and saturation, mirrors lightness around 50%.
 * Slightly biased: dark bgs get very dark (L≈10-20), light text gets bright (L≈80-90).
 */
/**
 * invertLightness(hex)
 * Generates a dark-theme counterpart for a light-theme color.
 *
 * Strategy: colors that look "right" in light mode get adapted for dark mode.
 *   - Very light colors (L>65): page/block backgrounds → make very dark
 *   - Very dark colors (L<20): already dark, likely intentional → keep as-is
 *   - Dark-ish colors (20<L<45): body text, headings → make light
 *   - Mid-range (45-65): accent colors → moderate shift
 */
function invertLightness(hex) {
  var hsl = hexToHsl(hex);
  if (!hsl) return hex;
  var h = hsl[0], s = hsl[1], l = hsl[2];
  var invL, invS;

  if (l > 80) {
    // Very light background → very dark
    invL = 10 + (100 - l) * 0.3;  // L95→11, L85→14, L80→16
    invS = s * 0.7;
  } else if (l > 65) {
    // Light background/accent → dark
    invL = 12 + (100 - l) * 0.4;  // L70→24, L65→26
    invS = s * 0.75;
  } else if (l < 20) {
    // Already very dark → keep as-is (intentional dark bg like code blocks)
    return hex;
  } else if (l < 40) {
    // Dark text → make light for dark theme readability
    invL = 65 + (40 - l) * 0.7;   // L10→86, L20→79, L35→68
    invS = s * 0.8;
  } else {
    // Mid-range accent → moderate inversion
    invL = 100 - l;
    invS = s * 0.85;
  }

  return hslToHex(h, Math.max(0, invS), Math.max(0, Math.min(100, invL)));
}

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
    var varName = COLOR_VAR_MAP[ctrlId];
    if (Array.isArray(varName)) {
      return varName.map(function(cv) { return { cssVar: cv, value: value }; });
    }
    return [{ cssVar: varName, value: value }];
  }

  const entry = CTRL_CSS_MAP[ctrlId];
  if (!entry) return [];

  // Compound: bq-border combines color + width
  if (entry.compound === 'bq-border') {
    const col = allValues['_sd_ctrl-bq-border-color'] || '#2563EB';
    const w = allValues['_sd_ctrl-bq-bw-num'] || '3';
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
    fontFamily:   gv('_sd_ctrl-font-family').replace(/['"]/g, '').split(',')[0].trim(),
    baseFontSize: gn('_sd_ctrl-base-size-num'),
    lineHeight:   gn('_sd_ctrl-line-height-num'),
    headers: {
      fontFamily:   gv('_sd_ctrl-h-font-family').replace(/['"]/g, '').split(',')[0].trim(),
      scale:        gn('_sd_ctrl-h-scale-num'),
      marginBottom: gn('_sd_ctrl-h-mb-num'),
    },
    h1: { fontSize: gn('_sd_ctrl-h1-size-num'), fontWeight: parseInt(gv('_sd_ctrl-h1-weight')) || 0 },
    h2: { fontSize: gn('_sd_ctrl-h2-size-num'), fontWeight: parseInt(gv('_sd_ctrl-h2-weight')) || 0 },
    h3: { fontSize: gn('_sd_ctrl-h3-size-num'), fontWeight: parseInt(gv('_sd_ctrl-h3-weight')) || 0 },
    h4: { fontSize: gn('_sd_ctrl-h4-size-num'), fontWeight: parseInt(gv('_sd_ctrl-h4-weight')) || 0 },
    p: {
      lineHeight:   gn('_sd_ctrl-p-lh-num'),
      marginBottom: gn('_sd_ctrl-p-mb-num'),
    },
    link: { color: gv('_sd_ctrl-link-color'), decoration: gv('_sd_ctrl-link-decoration') },
    code: {
      font:       gv('_sd_ctrl-code-font').replace(/['"]/g, '').split(',')[0].trim(),
    },
    blockquote: {
      borderColor: gv('_sd_ctrl-bq-border-color'),
      borderWidth: gn('_sd_ctrl-bq-bw-num'),
      fontSize:    gn('_sd_ctrl-bq-size-num'),
    },
  };

  styles.list = {
    spacing: gn('_sd_ctrl-list-spacing-num'),
    indent:  gn('_sd_ctrl-list-indent-num'),
  };

  // Only emit colors that were explicitly overridden
  if (overriddenColors.has('_sd_ctrl-bg-color'))   styles.background = gv('_sd_ctrl-bg-color');
  if (overriddenColors.has('_sd_ctrl-color'))      styles.color = gv('_sd_ctrl-color');
  if (overriddenColors.has('_sd_ctrl-h-color'))    styles.headers.color = gv('_sd_ctrl-h-color');
  if (overriddenColors.has('_sd_ctrl-h1-color'))   styles.h1.color = gv('_sd_ctrl-h1-color');
  if (overriddenColors.has('_sd_ctrl-h2-color'))   styles.h2.color = gv('_sd_ctrl-h2-color');
  if (overriddenColors.has('_sd_ctrl-h3-color'))   styles.h3.color = gv('_sd_ctrl-h3-color');
  if (overriddenColors.has('_sd_ctrl-h4-color'))   styles.h4.color = gv('_sd_ctrl-h4-color');
  if (overriddenColors.has('_sd_ctrl-p-color'))    styles.p.color = gv('_sd_ctrl-p-color');
  if (overriddenColors.has('_sd_ctrl-list-color')) styles.list.color = gv('_sd_ctrl-list-color');

  // Block cascade colors
  if (overriddenColors.has('_sd_ctrl-block-bg') || overriddenColors.has('_sd_ctrl-block-text')) {
    styles.blocks = {};
    if (overriddenColors.has('_sd_ctrl-block-bg'))   styles.blocks.background = gv('_sd_ctrl-block-bg');
    if (overriddenColors.has('_sd_ctrl-block-text')) styles.blocks.color = gv('_sd_ctrl-block-text');
  }
  if (overriddenColors.has('_sd_ctrl-code-bg'))    styles.code.background = gv('_sd_ctrl-code-bg');
  if (overriddenColors.has('_sd_ctrl-code-color')) styles.code.color = gv('_sd_ctrl-code-color');
  if (overriddenColors.has('_sd_ctrl-bq-bg'))      styles.blockquote.background = gv('_sd_ctrl-bq-bg');
  if (overriddenColors.has('_sd_ctrl-bq-color'))   styles.blockquote.color = gv('_sd_ctrl-bq-color');

  // Chart styles
  var chartObj = {};
  if (overriddenColors.has('_sd_ctrl-chart-accent')) chartObj.accent = gv('_sd_ctrl-chart-accent');
  if (gv('_sd_ctrl-chart-palette') && gv('_sd_ctrl-chart-palette') !== 'monochrome') chartObj.palette = gv('_sd_ctrl-chart-palette');
  if (overriddenColors.has('_sd_ctrl-chart-bg'))    chartObj.background = gv('_sd_ctrl-chart-bg');
  if (overriddenColors.has('_sd_ctrl-chart-text'))  chartObj.textColor = gv('_sd_ctrl-chart-text');
  if (Object.keys(chartObj).length) styles.chart = chartObj;

  // Table styles
  var tableObj = {};
  if (overriddenColors.has('_sd_ctrl-table-border'))    tableObj.border = gv('_sd_ctrl-table-border');
  if (overriddenColors.has('_sd_ctrl-table-header-bg')) tableObj.headerBackground = gv('_sd_ctrl-table-header-bg');
  if (overriddenColors.has('_sd_ctrl-table-even-bg'))   tableObj.evenBackground = gv('_sd_ctrl-table-even-bg');
  if (overriddenColors.has('_sd_ctrl-table-odd-bg'))    tableObj.oddBackground = gv('_sd_ctrl-table-odd-bg');
  if (overriddenColors.has('_sd_ctrl-table-text'))      tableObj.color = gv('_sd_ctrl-table-text');
  if (Object.keys(tableObj).length) styles.table = tableObj;

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

  if (styles.fontFamily)   controls['_sd_ctrl-font-family'] = styles.fontFamily;
  if (styles.baseFontSize) controls['_sd_ctrl-base-size-num'] = styles.baseFontSize;
  if (styles.lineHeight)   controls['_sd_ctrl-line-height-num'] = styles.lineHeight;

  if (styles.background) {
    controls['_sd_ctrl-bg-color'] = styles.background;
    overridden.add('_sd_ctrl-bg-color');
  }
  if (styles.color) {
    controls['_sd_ctrl-color'] = styles.color;
    overridden.add('_sd_ctrl-color');
  }

  const h = styles.headers || {};
  if (h.fontFamily)   controls['_sd_ctrl-h-font-family'] = h.fontFamily;
  if (h.scale)        controls['_sd_ctrl-h-scale-num'] = h.scale;
  if (h.marginBottom) controls['_sd_ctrl-h-mb-num'] = h.marginBottom;
  if (h.color) {
    controls['_sd_ctrl-h-color'] = h.color;
    overridden.add('_sd_ctrl-h-color');
  }

  ['h1', 'h2', 'h3', 'h4'].forEach(t => {
    const hs = styles[t] || {};
    if (hs.fontSize)   controls[`_sd_ctrl-${t}-size-num`] = hs.fontSize;
    if (hs.fontWeight) controls[`_sd_ctrl-${t}-weight`] = String(hs.fontWeight);
    if (hs.color) {
      controls[`_sd_ctrl-${t}-color`] = hs.color;
      overridden.add(`_sd_ctrl-${t}-color`);
    }
  });

  const p = styles.p || {};
  if (p.lineHeight)   controls['_sd_ctrl-p-lh-num'] = p.lineHeight;
  if (p.marginBottom) controls['_sd_ctrl-p-mb-num'] = p.marginBottom;
  if (p.color) {
    controls['_sd_ctrl-p-color'] = p.color;
    overridden.add('_sd_ctrl-p-color');
  }

  const lk = styles.link || {};
  if (lk.color)      controls['_sd_ctrl-link-color'] = lk.color;
  if (lk.decoration) controls['_sd_ctrl-link-decoration'] = lk.decoration;

  // Blocks cascade parent
  const bl = styles.blocks || {};
  if (bl.background) { controls['_sd_ctrl-block-bg'] = bl.background; overridden.add('_sd_ctrl-block-bg'); }
  if (bl.color)      { controls['_sd_ctrl-block-text'] = bl.color; overridden.add('_sd_ctrl-block-text'); }

  const cd = styles.code || {};
  if (cd.font)       controls['_sd_ctrl-code-font'] = cd.font;
  if (cd.background) { controls['_sd_ctrl-code-bg'] = cd.background; overridden.add('_sd_ctrl-code-bg'); }
  if (cd.color)      { controls['_sd_ctrl-code-color'] = cd.color; overridden.add('_sd_ctrl-code-color'); }

  const bq = styles.blockquote || {};
  if (bq.borderColor) controls['_sd_ctrl-bq-border-color'] = bq.borderColor;
  if (bq.borderWidth) controls['_sd_ctrl-bq-bw-num'] = bq.borderWidth;
  if (bq.background)  { controls['_sd_ctrl-bq-bg'] = bq.background; overridden.add('_sd_ctrl-bq-bg'); }
  if (bq.fontSize)    controls['_sd_ctrl-bq-size-num'] = bq.fontSize;
  if (bq.color)       { controls['_sd_ctrl-bq-color'] = bq.color; overridden.add('_sd_ctrl-bq-color'); }

  const ll = styles.list || {};
  if (ll.spacing) controls['_sd_ctrl-list-spacing-num'] = ll.spacing;
  if (ll.indent)  controls['_sd_ctrl-list-indent-num'] = ll.indent;
  if (ll.color) {
    controls['_sd_ctrl-list-color'] = ll.color;
    overridden.add('_sd_ctrl-list-color');
  }

  const ch = styles.chart || {};
  if (ch.accent)     { controls['_sd_ctrl-chart-accent'] = ch.accent; overridden.add('_sd_ctrl-chart-accent'); }
  if (ch.palette)    controls['_sd_ctrl-chart-palette'] = ch.palette;
  if (ch.background) { controls['_sd_ctrl-chart-bg'] = ch.background; overridden.add('_sd_ctrl-chart-bg'); }
  if (ch.textColor)  { controls['_sd_ctrl-chart-text'] = ch.textColor; overridden.add('_sd_ctrl-chart-text'); }

  const tb = styles.table || {};
  if (tb.border)           { controls['_sd_ctrl-table-border'] = tb.border; overridden.add('_sd_ctrl-table-border'); }
  if (tb.headerBackground) { controls['_sd_ctrl-table-header-bg'] = tb.headerBackground; overridden.add('_sd_ctrl-table-header-bg'); }
  if (tb.evenBackground)   { controls['_sd_ctrl-table-even-bg'] = tb.evenBackground; overridden.add('_sd_ctrl-table-even-bg'); }
  if (tb.oddBackground)    { controls['_sd_ctrl-table-odd-bg'] = tb.oddBackground; overridden.add('_sd_ctrl-table-odd-bg'); }
  if (tb.color)            { controls['_sd_ctrl-table-text'] = tb.color; overridden.add('_sd_ctrl-table-text'); }

  return { controls, overriddenColors: overridden };
}

// ═══════════════════════════════════════════════════════
//  STANDALONE & ALL COLOR IDS
// ═══════════════════════════════════════════════════════

var STANDALONE_COLOR_IDS = [
  '_sd_ctrl-bg-color','_sd_ctrl-link-color',
  '_sd_ctrl-bq-border-color',
  '_sd_ctrl-chart-accent',
  '_sd_ctrl-table-border','_sd_ctrl-table-header-bg','_sd_ctrl-table-even-bg','_sd_ctrl-table-odd-bg','_sd_ctrl-table-text',
];

var CASCADE_COLOR_IDS = Object.keys(COLOR_VAR_MAP);

var ALL_COLOR_IDS = CASCADE_COLOR_IDS.concat(STANDALONE_COLOR_IDS);

// ═══════════════════════════════════════════════════════
//  PER-THEME FUNCTIONS
// ═══════════════════════════════════════════════════════

/**
 * parseDarkBlock(block)
 * Extracts { ctrlId: colorValue } from a dark: sub-object in YAML front matter.
 */
function parseDarkBlock(block) {
  if (!block) return {};
  var colors = {};

  if (block.background) colors['_sd_ctrl-bg-color'] = block.background;
  if (block.color) colors['_sd_ctrl-color'] = block.color;

  if (block.headers && block.headers.color) colors['_sd_ctrl-h-color'] = block.headers.color;
  ['h1','h2','h3','h4'].forEach(function(t) {
    var obj = block[t];
    if (obj && obj.color) colors['_sd_ctrl-' + t + '-color'] = obj.color;
  });
  if (block.p && block.p.color) colors['_sd_ctrl-p-color'] = block.p.color;
  if (block.list && block.list.color) colors['_sd_ctrl-list-color'] = block.list.color;
  if (block.link && block.link.color) colors['_sd_ctrl-link-color'] = block.link.color;

  if (block.blocks) {
    if (block.blocks.background) colors['_sd_ctrl-block-bg'] = block.blocks.background;
    if (block.blocks.color) colors['_sd_ctrl-block-text'] = block.blocks.color;
  }
  if (block.code) {
    if (block.code.background) colors['_sd_ctrl-code-bg'] = block.code.background;
    if (block.code.color) colors['_sd_ctrl-code-color'] = block.code.color;
  }
  if (block.blockquote) {
    if (block.blockquote.borderColor) colors['_sd_ctrl-bq-border-color'] = block.blockquote.borderColor;
    if (block.blockquote.background) colors['_sd_ctrl-bq-bg'] = block.blockquote.background;
    if (block.blockquote.color) colors['_sd_ctrl-bq-color'] = block.blockquote.color;
  }
  if (block.chart) {
    if (block.chart.background) colors['_sd_ctrl-chart-bg'] = block.chart.background;
    if (block.chart.textColor) colors['_sd_ctrl-chart-text'] = block.chart.textColor;
  }
  if (block.table) {
    if (block.table.border)           colors['_sd_ctrl-table-border'] = block.table.border;
    if (block.table.headerBackground) colors['_sd_ctrl-table-header-bg'] = block.table.headerBackground;
    if (block.table.evenBackground)   colors['_sd_ctrl-table-even-bg'] = block.table.evenBackground;
    if (block.table.oddBackground)    colors['_sd_ctrl-table-odd-bg'] = block.table.oddBackground;
    if (block.table.color)            colors['_sd_ctrl-table-text'] = block.table.color;
  }

  return colors;
}

// ═══════════════════════════════════════════════════════
//  STRIP STYLE DEFAULTS (for shorter URLs)
// ═══════════════════════════════════════════════════════

// Default values matching HTML control defaults in index.html.
// When a style value equals its default, it can be omitted from serialization
// because stylesToControls / the browser already falls back to these defaults.
var STYLE_DEFAULTS = {
  fontFamily: 'Inter',
  baseFontSize: 16,
  lineHeight: 1.75,
  headers: {
    fontFamily: 'inherit',
    scale: 1.0,
    marginBottom: 0.4,
  },
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

function numEq(a, b) {
  var na = typeof a === 'number' ? a : parseFloat(a);
  var nb = typeof b === 'number' ? b : parseFloat(b);
  if (isNaN(na) || isNaN(nb)) return false;
  return Math.abs(na - nb) < 0.001;
}

/**
 * stripStyleDefaults(styles)
 * Returns a new styles object with default-valued properties removed.
 * light/dark color blocks are preserved as-is (they have no static defaults).
 * Empty sub-objects are removed entirely.
 */
function stripStyleDefaults(styles) {
  if (!styles || typeof styles !== 'object') return styles;
  var result = {};
  for (var key in styles) {
    if (!styles.hasOwnProperty(key)) continue;
    var val = styles[key];
    var def = STYLE_DEFAULTS[key];

    // light/dark theme color blocks — always keep
    if (key === 'light' || key === 'dark') {
      result[key] = val;
      continue;
    }

    if (typeof val === 'object' && val !== null) {
      var sub = {};
      var defObj = (typeof def === 'object' && def !== null) ? def : {};
      for (var sk in val) {
        if (!val.hasOwnProperty(sk)) continue;
        var sv = val[sk];
        var sd = defObj[sk];
        if (sd !== undefined && (sv === sd || String(sv) === String(sd) || numEq(sv, sd))) continue;
        sub[sk] = sv;
      }
      if (Object.keys(sub).length > 0) result[key] = sub;
    } else {
      if (def !== undefined && (val === def || String(val) === String(def) || numEq(val, def))) continue;
      result[key] = val;
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════
//  STYLE REFERENCE RESOLVER ($path.to.prop → var(--md-*))
// ═══════════════════════════════════════════════════════

// Maps YAML-schema paths to the CSS custom property that carries their
// live value. Used by the slide shape DSL so an agent can write
// `fill=$h1.color` and have the slide pick up whatever the doc's h1
// color currently is, including dark-mode inversion. The value is
// resolved at CSS-paint time, not parse time — theme changes Just Work.
//
// Keep this list aligned with COLOR_VAR_MAP + CTRL_CSS_MAP above, plus
// a few convenience aliases (e.g. `headers.color` as well as `h.color`).
var STYLE_PATH_TO_VAR = {
  // General
  'background':            '--md-bg',
  'color':                 '--md-color',
  'fontFamily':            '--md-font-family',

  // Headings
  'h.color':               '--md-h-color',
  'headers.color':         '--md-h-color',
  'headers.fontFamily':    '--md-h-font-family',
  'h1.color':              '--md-h1-color',
  'h2.color':              '--md-h2-color',
  'h3.color':              '--md-h3-color',
  'h4.color':              '--md-h4-color',

  // Paragraph / list
  'p.color':               '--md-p-color',
  'list.color':            '--md-list-color',

  // Link
  'link.color':            '--md-link-color',

  // Blocks cascade (code / blockquote / chart parent)
  'blocks.background':     '--md-block-bg',
  'blocks.color':          '--md-block-text',

  // Code
  'code.background':       '--md-code-bg',
  'code.color':            '--md-code-color',
  'code.font':             '--md-code-font',

  // Blockquote
  'blockquote.background': '--md-bq-bg',
  'blockquote.color':      '--md-bq-color',
  'blockquote.borderColor':'--md-bq-border-color',

  // Chart
  'chart.accent':          '--md-chart-accent',
  'chart.background':      '--md-chart-bg',
  'chart.textColor':       '--md-chart-text',

  // Table
  'table.border':           '--md-table-border',
  'table.headerBackground': '--md-table-header-bg',
  'table.evenBackground':   '--md-table-even-bg',
  'table.oddBackground':    '--md-table-odd-bg',
  'table.color':            '--md-table-text',
};

// Given a raw token (typically a shape attribute value), return the
// CSS var() expression to use in its place, or null if not a ref.
// Returns { value, error } so callers can surface unknown refs.
function resolveStyleRef(token) {
  if (typeof token !== 'string' || token.charAt(0) !== '$') return null;
  var key = token.slice(1);
  var cssVar = STYLE_PATH_TO_VAR[key];
  if (cssVar) return { value: 'var(' + cssVar + ')' };
  return { error: 'unknown style reference "$' + key + '"' };
}

// ═══════════════════════════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════════════════════════
exports.COLOR_DEFAULT   = COLOR_DEFAULT;
exports.COLOR_VAR_MAP   = COLOR_VAR_MAP;
exports.COLOR_CASCADE   = COLOR_CASCADE;
exports.CTRL_CSS_MAP    = CTRL_CSS_MAP;
exports.RANGE_NUM_PAIRS = RANGE_NUM_PAIRS;

exports.STANDALONE_COLOR_IDS = STANDALONE_COLOR_IDS;
exports.ALL_COLOR_IDS        = ALL_COLOR_IDS;

exports.hexToHsl              = hexToHsl;
exports.hslToHex              = hslToHex;
exports.controlToCssVars      = controlToCssVars;
exports.cascadeColor          = cascadeColor;
exports.invertLightness       = invertLightness;
exports.collectStyles         = collectStyles;
exports.parseDarkBlock        = parseDarkBlock;
exports.stylesToControls      = stylesToControls;
exports.STYLE_DEFAULTS        = STYLE_DEFAULTS;
exports.stripStyleDefaults    = stripStyleDefaults;
exports.STYLE_PATH_TO_VAR     = STYLE_PATH_TO_VAR;
exports.resolveStyleRef       = resolveStyleRef;

// UMD tail: in Node (tests) this writes to module.exports; in the browser
// it creates window.SDocStyles.  We use this pattern instead of ES modules
// because index.html is a single-file inline-script app with no build step.
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocStyles = {}));
