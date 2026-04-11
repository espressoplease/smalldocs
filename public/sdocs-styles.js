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
  'ctrl-color':       '--md-color',
  'ctrl-h-color':     '--md-h-color',
  'ctrl-h1-color':    '--md-h1-color',
  'ctrl-h2-color':    '--md-h2-color',
  'ctrl-h3-color':    '--md-h3-color',
  'ctrl-h4-color':    '--md-h4-color',
  'ctrl-p-color':     '--md-p-color',
  'ctrl-list-color':  '--md-list-color',
  // Block cascade
  'ctrl-block-bg':    '--md-block-bg',
  'ctrl-block-text':  '--md-block-text',
  'ctrl-code-bg':     ['--md-code-bg', '--md-pre-bg'],
  'ctrl-code-color':  '--md-code-color',
  'ctrl-bq-bg':       '--md-bq-bg',
  'ctrl-bq-color':    '--md-bq-color',
  'ctrl-chart-bg':    '--md-chart-bg',
  'ctrl-chart-text':  '--md-chart-text',
};

// Cascade tree: parent → direct children
const COLOR_CASCADE = {
  'ctrl-color':      ['ctrl-h-color', 'ctrl-p-color'],
  'ctrl-h-color':    ['ctrl-h1-color', 'ctrl-h2-color', 'ctrl-h3-color', 'ctrl-h4-color'],
  'ctrl-p-color':    ['ctrl-list-color'],
  'ctrl-block-bg':   ['ctrl-code-bg', 'ctrl-bq-bg', 'ctrl-chart-bg'],
  'ctrl-block-text': ['ctrl-code-color', 'ctrl-bq-color', 'ctrl-chart-text'],
};

// Control ID → { cssVar, suffix?, compound? }
// Maps every non-color control to its CSS variable and optional unit suffix
const CTRL_CSS_MAP = {
  'ctrl-bg-color':         { cssVar: '--md-bg' },
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
  'ctrl-bq-border-color':  { cssVar: '--md-bq-border', compound: 'bq-border' },
  'ctrl-bq-bw-num':        { cssVar: '--md-bq-border', compound: 'bq-border' },
  'ctrl-bq-size-num':      { cssVar: '--md-bq-size', suffix: 'em' },
  'ctrl-list-spacing-num': { cssVar: '--md-list-spacing', suffix: 'em' },
  'ctrl-list-indent-num':  { cssVar: '--md-list-indent', suffix: 'em' },
  'ctrl-chart-accent':     { cssVar: '--md-chart-accent' },
  'ctrl-chart-palette':    { cssVar: '--md-chart-palette' },
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
      fontFamily:   gv('ctrl-h-font-family').replace(/['"]/g, '').split(',')[0].trim(),
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
    },
    blockquote: {
      borderColor: gv('ctrl-bq-border-color'),
      borderWidth: gn('ctrl-bq-bw-num'),
      fontSize:    gn('ctrl-bq-size-num'),
    },
  };

  styles.list = {
    spacing: gn('ctrl-list-spacing-num'),
    indent:  gn('ctrl-list-indent-num'),
  };

  // Only emit colors that were explicitly overridden
  if (overriddenColors.has('ctrl-bg-color'))   styles.background = gv('ctrl-bg-color');
  if (overriddenColors.has('ctrl-color'))      styles.color = gv('ctrl-color');
  if (overriddenColors.has('ctrl-h-color'))    styles.headers.color = gv('ctrl-h-color');
  if (overriddenColors.has('ctrl-h1-color'))   styles.h1.color = gv('ctrl-h1-color');
  if (overriddenColors.has('ctrl-h2-color'))   styles.h2.color = gv('ctrl-h2-color');
  if (overriddenColors.has('ctrl-h3-color'))   styles.h3.color = gv('ctrl-h3-color');
  if (overriddenColors.has('ctrl-h4-color'))   styles.h4.color = gv('ctrl-h4-color');
  if (overriddenColors.has('ctrl-p-color'))    styles.p.color = gv('ctrl-p-color');
  if (overriddenColors.has('ctrl-list-color')) styles.list.color = gv('ctrl-list-color');

  // Block cascade colors
  if (overriddenColors.has('ctrl-block-bg') || overriddenColors.has('ctrl-block-text')) {
    styles.blocks = {};
    if (overriddenColors.has('ctrl-block-bg'))   styles.blocks.background = gv('ctrl-block-bg');
    if (overriddenColors.has('ctrl-block-text')) styles.blocks.color = gv('ctrl-block-text');
  }
  if (overriddenColors.has('ctrl-code-bg'))    styles.code.background = gv('ctrl-code-bg');
  if (overriddenColors.has('ctrl-code-color')) styles.code.color = gv('ctrl-code-color');
  if (overriddenColors.has('ctrl-bq-bg'))      styles.blockquote.background = gv('ctrl-bq-bg');
  if (overriddenColors.has('ctrl-bq-color'))   styles.blockquote.color = gv('ctrl-bq-color');

  // Chart styles
  var chartObj = {};
  if (overriddenColors.has('ctrl-chart-accent')) chartObj.accent = gv('ctrl-chart-accent');
  if (gv('ctrl-chart-palette') && gv('ctrl-chart-palette') !== 'monochrome') chartObj.palette = gv('ctrl-chart-palette');
  if (overriddenColors.has('ctrl-chart-bg'))    chartObj.background = gv('ctrl-chart-bg');
  if (overriddenColors.has('ctrl-chart-text'))  chartObj.textColor = gv('ctrl-chart-text');
  if (Object.keys(chartObj).length) styles.chart = chartObj;

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

  if (styles.background) {
    controls['ctrl-bg-color'] = styles.background;
    overridden.add('ctrl-bg-color');
  }
  if (styles.color) {
    controls['ctrl-color'] = styles.color;
    overridden.add('ctrl-color');
  }

  const h = styles.headers || {};
  if (h.fontFamily)   controls['ctrl-h-font-family'] = h.fontFamily;
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

  // Blocks cascade parent
  const bl = styles.blocks || {};
  if (bl.background) { controls['ctrl-block-bg'] = bl.background; overridden.add('ctrl-block-bg'); }
  if (bl.color)      { controls['ctrl-block-text'] = bl.color; overridden.add('ctrl-block-text'); }

  const cd = styles.code || {};
  if (cd.font)       controls['ctrl-code-font'] = cd.font;
  if (cd.background) { controls['ctrl-code-bg'] = cd.background; overridden.add('ctrl-code-bg'); }
  if (cd.color)      { controls['ctrl-code-color'] = cd.color; overridden.add('ctrl-code-color'); }

  const bq = styles.blockquote || {};
  if (bq.borderColor) controls['ctrl-bq-border-color'] = bq.borderColor;
  if (bq.borderWidth) controls['ctrl-bq-bw-num'] = bq.borderWidth;
  if (bq.background)  { controls['ctrl-bq-bg'] = bq.background; overridden.add('ctrl-bq-bg'); }
  if (bq.fontSize)    controls['ctrl-bq-size-num'] = bq.fontSize;
  if (bq.color)       { controls['ctrl-bq-color'] = bq.color; overridden.add('ctrl-bq-color'); }

  const ll = styles.list || {};
  if (ll.spacing) controls['ctrl-list-spacing-num'] = ll.spacing;
  if (ll.indent)  controls['ctrl-list-indent-num'] = ll.indent;
  if (ll.color) {
    controls['ctrl-list-color'] = ll.color;
    overridden.add('ctrl-list-color');
  }

  const ch = styles.chart || {};
  if (ch.accent)     { controls['ctrl-chart-accent'] = ch.accent; overridden.add('ctrl-chart-accent'); }
  if (ch.palette)    controls['ctrl-chart-palette'] = ch.palette;
  if (ch.background) { controls['ctrl-chart-bg'] = ch.background; overridden.add('ctrl-chart-bg'); }
  if (ch.textColor)  { controls['ctrl-chart-text'] = ch.textColor; overridden.add('ctrl-chart-text'); }

  return { controls, overriddenColors: overridden };
}

// ═══════════════════════════════════════════════════════
//  STANDALONE & ALL COLOR IDS
// ═══════════════════════════════════════════════════════

var STANDALONE_COLOR_IDS = [
  'ctrl-bg-color','ctrl-link-color',
  'ctrl-bq-border-color',
  'ctrl-chart-accent',
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

  if (block.background) colors['ctrl-bg-color'] = block.background;
  if (block.color) colors['ctrl-color'] = block.color;

  if (block.headers && block.headers.color) colors['ctrl-h-color'] = block.headers.color;
  ['h1','h2','h3','h4'].forEach(function(t) {
    var obj = block[t];
    if (obj && obj.color) colors['ctrl-' + t + '-color'] = obj.color;
  });
  if (block.p && block.p.color) colors['ctrl-p-color'] = block.p.color;
  if (block.list && block.list.color) colors['ctrl-list-color'] = block.list.color;
  if (block.link && block.link.color) colors['ctrl-link-color'] = block.link.color;

  if (block.blocks) {
    if (block.blocks.background) colors['ctrl-block-bg'] = block.blocks.background;
    if (block.blocks.color) colors['ctrl-block-text'] = block.blocks.color;
  }
  if (block.code) {
    if (block.code.background) colors['ctrl-code-bg'] = block.code.background;
    if (block.code.color) colors['ctrl-code-color'] = block.code.color;
  }
  if (block.blockquote) {
    if (block.blockquote.borderColor) colors['ctrl-bq-border-color'] = block.blockquote.borderColor;
    if (block.blockquote.background) colors['ctrl-bq-bg'] = block.blockquote.background;
    if (block.blockquote.color) colors['ctrl-bq-color'] = block.blockquote.color;
  }
  if (block.chart) {
    if (block.chart.background) colors['ctrl-chart-bg'] = block.chart.background;
    if (block.chart.textColor) colors['ctrl-chart-text'] = block.chart.textColor;
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

// UMD tail: in Node (tests) this writes to module.exports; in the browser
// it creates window.SDocStyles.  We use this pattern instead of ES modules
// because index.html is a single-file inline-script app with no build step.
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocStyles = {}));
