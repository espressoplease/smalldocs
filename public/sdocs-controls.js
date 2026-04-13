// sdocs-controls.js — CSS variable management and control wiring
(function () {
'use strict';

var S = SDocs;

// ── CSS var updates ──────────────────────────────────

function applyControlToCss(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var v = el.value;

  if (id === '_sd_ctrl-font-family' || id === '_sd_ctrl-h-font-family') {
    var name = v.replace(/['"]/g,'').split(',')[0].trim();
    if (S.GOOGLE_FONTS.includes(name)) S.loadGoogleFont(name);
  }

  var allVals = readAllControlValues();
  SDocStyles.controlToCssVars(id, v, allVals)
    .forEach(function(a) { S.setStyleVar(a.cssVar, a.value); });
  S.syncAll('controls');
}

function readAllControlValues() {
  var vals = {};
  Object.keys(SDocStyles.CTRL_CSS_MAP).forEach(function(id) {
    var el = document.getElementById(id);
    if (el) vals[id] = el.value;
  });
  Object.keys(SDocStyles.COLOR_VAR_MAP).forEach(function(id) {
    var el = document.getElementById(id);
    if (el) vals[id] = el.value;
  });
  return vals;
}

function syncRangeAndNumber(rangeId, numId) {
  var r = document.getElementById(rangeId);
  var n = document.getElementById(numId);
  r.addEventListener('input', function() { n.value = r.value; applyControlToCss(numId); });
  n.addEventListener('input', function() { r.value = n.value; applyControlToCss(numId); });
}

SDocStyles.RANGE_NUM_PAIRS.forEach(function(pair) { syncRangeAndNumber(pair[0], pair[1]); });

var STANDALONE_COLOR_IDS = new Set(SDocStyles.STANDALONE_COLOR_IDS);

[
  '_sd_ctrl-font-family','_sd_ctrl-h-font-family',
  '_sd_ctrl-h1-weight','_sd_ctrl-h2-weight','_sd_ctrl-h3-weight','_sd_ctrl-h4-weight',
  '_sd_ctrl-bg-color','_sd_ctrl-link-color','_sd_ctrl-link-decoration',
  '_sd_ctrl-code-font',
  '_sd_ctrl-bq-border-color',
  '_sd_ctrl-chart-accent','_sd_ctrl-chart-palette',
].forEach(function(id) {
  var handler = function() { if (STANDALONE_COLOR_IDS.has(id)) S.overriddenColors.add(id); applyControlToCss(id); S.syncAll('controls'); };
  document.getElementById(id).addEventListener('input',  handler);
  document.getElementById(id).addEventListener('change', handler);
});

// ── Color cascade ──────────────────────────────────

var COLOR_VAR = SDocStyles.COLOR_VAR_MAP;
var COLOR_CHILDREN = SDocStyles.COLOR_CASCADE;

function setColorValue(ctrlId, value, userAction) {
  if (userAction) S.overriddenColors.add(ctrlId);
  var varName = COLOR_VAR[ctrlId];
  if (Array.isArray(varName)) {
    varName.forEach(function(v) { S.setStyleVar(v, value); });
  } else {
    S.setStyleVar(varName, value);
  }
  var ctrl = document.getElementById(ctrlId);
  if (ctrl) ctrl.value = value;
  var children = COLOR_CHILDREN[ctrlId] || [];
  for (var i = 0; i < children.length; i++) {
    if (!S.overriddenColors.has(children[i])) {
      setColorValue(children[i], value, false);
    }
  }
  // Refresh charts when block/chart colors change
  if (S.refreshChartColors && (ctrlId === '_sd_ctrl-chart-bg' || ctrlId === '_sd_ctrl-chart-text' ||
      ctrlId === '_sd_ctrl-block-bg' || ctrlId === '_sd_ctrl-block-text')) {
    S.refreshChartColors();
  }
}

function findParent(ctrlId) {
  for (var pid in COLOR_CHILDREN) {
    if (COLOR_CHILDREN[pid].indexOf(ctrlId) !== -1) return pid;
  }
  return null;
}

function resetColorValue(ctrlId) {
  S.overriddenColors.delete(ctrlId);
  var parent = findParent(ctrlId);
  var value;
  if (!parent) {
    // Cascade root: use theme default
    value = ctrlId === '_sd_ctrl-color' ? S.getColorDefault() : S.getStandaloneDefault(ctrlId);
  } else {
    var parentEl = document.getElementById(parent);
    value = parentEl ? parentEl.value : S.getColorDefault();
  }
  setColorValue(ctrlId, value, false);
}

Object.keys(COLOR_VAR).forEach(function(ctrlId) {
  var el = document.getElementById(ctrlId);
  if (!el) return;
  var handler = function() { setColorValue(ctrlId, el.value, true); S.syncAll('controls'); };
  el.addEventListener('input',  handler);
  el.addEventListener('change', handler);
});

// Cascade color reset buttons
document.getElementById('_sd_reset-color').addEventListener('click', function() { S.overriddenColors.delete('_sd_ctrl-color'); setColorValue('_sd_ctrl-color', S.getColorDefault(), false); S.syncAll('controls'); });
['_sd_ctrl-h-color','_sd_ctrl-h1-color','_sd_ctrl-h2-color','_sd_ctrl-h3-color','_sd_ctrl-h4-color','_sd_ctrl-p-color','_sd_ctrl-list-color'].forEach(function(ctrlId) {
  var btn = document.getElementById(ctrlId.replace('_sd_ctrl-', '_sd_reset-'));
  if (btn) btn.addEventListener('click', function() { resetColorValue(ctrlId); S.syncAll('controls'); });
});

// Block cascade resets
['_sd_ctrl-block-bg','_sd_ctrl-block-text','_sd_ctrl-code-bg','_sd_ctrl-code-color','_sd_ctrl-bq-bg','_sd_ctrl-bq-color','_sd_ctrl-chart-bg','_sd_ctrl-chart-text'].forEach(function(ctrlId) {
  var btnId = ctrlId.replace('_sd_ctrl-', '_sd_reset-');
  var btn = document.getElementById(btnId);
  if (btn) btn.addEventListener('click', function() { resetColorValue(ctrlId); S.syncAll('controls'); });
});

['_sd_ctrl-bg-color','_sd_ctrl-link-color','_sd_ctrl-bq-border-color','_sd_ctrl-chart-accent'].forEach(function(ctrlId) {
  var btnId = ctrlId.replace('_sd_ctrl-', '_sd_reset-');
  document.getElementById(btnId).addEventListener('click', function() {
    var defaultVal = S.getStandaloneDefault(ctrlId);
    var el = document.getElementById(ctrlId);
    S.overriddenColors.delete(ctrlId);
    el.value = defaultVal;
    var assignments = SDocStyles.controlToCssVars(ctrlId, defaultVal, readAllControlValues());
    assignments.forEach(function(a) { S.setStyleVar(a.cssVar, a.value); });
    S.syncAll('controls');
  });
});

// ── Apply styles from meta → controls ──────────────────

function setControlValue(id, val) {
  if (val === undefined || val === null) return;
  var el = document.getElementById(id);
  if (!el) return;
  el.value = val;
  var rangeId = id.replace(/-num$/, '-range');
  var rng = document.getElementById(rangeId);
  if (rng) rng.value = val;
  applyControlToCss(id);
}

function applyStylesFromMeta(s) {
  if (!s) return;
  // Suppress syncAll during batch updates to avoid capturing partial state
  var wasSyncing = S._syncing;
  S._syncing = true;

  var result = SDocStyles.stylesToControls(s);
  var controls = result.controls;

  // Font family selects need special handling to match bare names against <option> values
  [['fontFamily', '_sd_ctrl-font-family'], ['headers.fontFamily', '_sd_ctrl-h-font-family']].forEach(function(pair) {
    var styleKey = pair[0], ctrlId = pair[1];
    var fontName = styleKey === 'fontFamily' ? s.fontFamily : (s.headers || {}).fontFamily;
    if (fontName) {
      var sel = document.getElementById(ctrlId);
      var match = [].slice.call(sel.options).find(function(o) {
        return o.value.replace(/['"]/g,'').split(',')[0].trim() === fontName ||
               o.textContent === fontName;
      });
      if (match) { sel.value = match.value; applyControlToCss(ctrlId); }
    }
  });

  Object.keys(controls).forEach(function(id) {
    if (id === '_sd_ctrl-font-family' || id === '_sd_ctrl-h-font-family') return;
    if (SDocStyles.COLOR_VAR_MAP[id]) return;
    setControlValue(id, controls[id]);
  });

  // Top-level colors = light theme. dark: block = explicit dark overrides.
  var lightOverridden = S.themeOverridden.light;
  var lightColors = S.themeColors.light;
  var newOverridden = result.overriddenColors;

  lightOverridden.clear();
  S.themeOverridden.dark.clear();

  newOverridden.forEach(function(id) {
    lightOverridden.add(id);
    lightColors[id] = controls[id];
  });

  // Also store standalone colors from legacy format into light theme
  var legacyStandalone = [];
  if (s.background) legacyStandalone.push(['_sd_ctrl-bg-color', s.background]);
  if (s.link && s.link.color) legacyStandalone.push(['_sd_ctrl-link-color', s.link.color]);
  if (s.code) {
    if (s.code.background) legacyStandalone.push(['_sd_ctrl-code-bg', s.code.background]);
    if (s.code.color) legacyStandalone.push(['_sd_ctrl-code-color', s.code.color]);
  }
  if (s.blocks) {
    if (s.blocks.background) legacyStandalone.push(['_sd_ctrl-block-bg', s.blocks.background]);
    if (s.blocks.color) legacyStandalone.push(['_sd_ctrl-block-text', s.blocks.color]);
  }
  if (s.blockquote) {
    if (s.blockquote.borderColor) legacyStandalone.push(['_sd_ctrl-bq-border-color', s.blockquote.borderColor]);
    if (s.blockquote.background) legacyStandalone.push(['_sd_ctrl-bq-bg', s.blockquote.background]);
    if (s.blockquote.color) legacyStandalone.push(['_sd_ctrl-bq-color', s.blockquote.color]);
  }
  if (s.chart) {
    if (s.chart.background) legacyStandalone.push(['_sd_ctrl-chart-bg', s.chart.background]);
    if (s.chart.textColor) legacyStandalone.push(['_sd_ctrl-chart-text', s.chart.textColor]);
  }

  // File-info card overrides (no UI controls — driven entirely by YAML).
  S.fileinfoStyles = {};
  var ficEl = document.getElementById('_sd_sdocs-file-info');
  if (s.fileinfo) {
    if (s.fileinfo.background) {
      S.fileinfoStyles.background = s.fileinfo.background;
      S.setStyleVar('--md-fic-bg', s.fileinfo.background);
    }
    if (s.fileinfo.color) {
      S.fileinfoStyles.color = s.fileinfo.color;
      S.setStyleVar('--md-fic-text', s.fileinfo.color);
      // Also override --md-p-color locally on the card (not on #_sd_rendered)
      // so .fic-value picks it up without affecting body p text.
      if (ficEl) ficEl.style.setProperty('--md-p-color', s.fileinfo.color);
    }
  }
  legacyStandalone.forEach(function(pair) {
    lightOverridden.add(pair[0]);
    lightColors[pair[0]] = pair[1];
  });

  // Auto-generate dark theme from light colors via lightness inversion
  var darkOverridden = S.themeOverridden.dark;
  var darkColors = S.themeColors.dark;

  // Parse explicit dark: overrides from YAML and persist for serialization
  var explicitDark = s.dark ? SDocStyles.parseDarkBlock(s.dark) : {};
  S._explicitDarkOverrides = s.dark || null;

  // For every light color, auto-generate dark unless explicitly overridden
  lightOverridden.forEach(function(id) {
    if (explicitDark[id]) {
      darkOverridden.add(id);
      darkColors[id] = explicitDark[id];
    } else {
      darkOverridden.add(id);
      darkColors[id] = SDocStyles.invertLightness(lightColors[id]);
    }
  });

  // Also apply any dark: colors that weren't in light (e.g. dark-only overrides)
  Object.keys(explicitDark).forEach(function(id) {
    if (!darkOverridden.has(id)) {
      darkOverridden.add(id);
      darkColors[id] = explicitDark[id];
    }
  });

  // Now apply the active theme's colors
  S._syncing = wasSyncing;
  S.loadThemeColors(S.activeTheme);
}

function collectStyles() {
  S.saveCurrentThemeColors();
  // Always emit top-level colors (light) via the simple collector
  var styles = SDocStyles.collectStyles(readAllControlValues(), S.overriddenColors);

  // Emit dark: block for any explicitly set dark overrides
  // (don't emit auto-inverted values — those are generated on load)
  if (S._explicitDarkOverrides && Object.keys(S._explicitDarkOverrides).length > 0) {
    var darkBlock = SDocStyles.parseDarkBlock(S._explicitDarkOverrides);
    // parseDarkBlock expects the YAML format, but _explicitDarkOverrides IS the YAML dark: object
    styles.dark = S._explicitDarkOverrides;
  }

  // File-info card overrides (no UI controls; round-trip from YAML)
  if (S.fileinfoStyles && Object.keys(S.fileinfoStyles).length > 0) {
    styles.fileinfo = Object.assign({}, S.fileinfoStyles);
  }

  return styles;
}

// ── Reset all styles ──────────────────────────────────

function resetAllStyles() {
  // Clear both theme states
  S.themeOverridden.light.clear();
  S.themeOverridden.dark.clear();
  S.themeColors.light = {};
  S.themeColors.dark = {};
  // Clear sdocs-file-info overrides and the CSS vars they set
  S.fileinfoStyles = {};
  S.setStyleVar('--md-fic-bg', '');
  S.setStyleVar('--md-fic-text', '');
  var ficResetEl = document.getElementById('_sd_sdocs-file-info');
  if (ficResetEl) ficResetEl.style.removeProperty('--md-p-color');

  setColorValue('_sd_ctrl-color', S.getColorDefault(), false);
  // Reset block cascade roots to theme defaults
  setColorValue('_sd_ctrl-block-bg', S.getStandaloneDefault('_sd_ctrl-block-bg') || '#f4f1ed', false);
  setColorValue('_sd_ctrl-block-text', S.getStandaloneDefault('_sd_ctrl-block-text') || '#6b6560', false);
  // Set standalone color controls to theme-appropriate defaults
  STANDALONE_COLOR_IDS.forEach(function(ctrlId) {
    var el = document.getElementById(ctrlId);
    if (el) el.value = S.getStandaloneDefault(ctrlId);
  });
  document.querySelectorAll('#_sd_right input, #_sd_right select').forEach(function(el) {
    if (STANDALONE_COLOR_IDS.has(el.id)) return; // already set above
    if (el.type === 'range' || el.type === 'number') el.value = el.defaultValue;
    else if (el.tagName === 'SELECT') el.selectedIndex = [].slice.call(el.options).findIndex(function(o) { return o.defaultSelected; });
    else if (el.type === 'color') el.value = el.defaultValue;
  });
  ['_sd_ctrl-bg-color','_sd_ctrl-font-family','_sd_ctrl-base-size-num','_sd_ctrl-line-height-num',
   '_sd_ctrl-h-font-family','_sd_ctrl-h-scale-num','_sd_ctrl-h-mb-num',
   '_sd_ctrl-h1-size-num','_sd_ctrl-h1-weight','_sd_ctrl-h2-size-num','_sd_ctrl-h2-weight',
   '_sd_ctrl-h3-size-num','_sd_ctrl-h3-weight','_sd_ctrl-h4-size-num','_sd_ctrl-h4-weight',
   '_sd_ctrl-p-lh-num','_sd_ctrl-p-mb-num',
   '_sd_ctrl-link-color','_sd_ctrl-link-decoration',
   '_sd_ctrl-code-font',
   '_sd_ctrl-bq-border-color','_sd_ctrl-bq-bw-num','_sd_ctrl-bq-size-num',
   '_sd_ctrl-list-spacing-num','_sd_ctrl-list-indent-num',
   '_sd_ctrl-chart-accent','_sd_ctrl-chart-palette',
  ].forEach(function(id) { applyControlToCss(id); });
}

// ── Init: set colors to theme-appropriate defaults ──────

if (document.documentElement.dataset.theme === 'dark') {
  STANDALONE_COLOR_IDS.forEach(function(ctrlId) {
    var el = document.getElementById(ctrlId);
    if (el) el.value = S.getStandaloneDefault(ctrlId);
  });
}

setColorValue('_sd_ctrl-color', S.getColorDefault(), false);

// ── Register on SDocs for cross-module access ──────────

S.setColorValue = setColorValue;
S.readAllControlValues = readAllControlValues;
S.collectStyles = collectStyles;
S.applyStylesFromMeta = applyStylesFromMeta;
S.resetAllStyles = resetAllStyles;
S.STANDALONE_COLOR_IDS = STANDALONE_COLOR_IDS;

})();
