// sdocs-controls.js — CSS variable management and control wiring
(function () {
'use strict';

var S = SDocs;

// ── CSS var updates ──────────────────────────────────

function applyCtrl(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var v = el.value;

  if (id === 'ctrl-font-family' || id === 'ctrl-h-font-family') {
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

function linkRangeNum(rangeId, numId) {
  var r = document.getElementById(rangeId);
  var n = document.getElementById(numId);
  r.addEventListener('input', function() { n.value = r.value; applyCtrl(numId); });
  n.addEventListener('input', function() { r.value = n.value; applyCtrl(numId); });
}

SDocStyles.RANGE_NUM_PAIRS.forEach(function(pair) { linkRangeNum(pair[0], pair[1]); });

var STANDALONE_COLOR_IDS = new Set(SDocStyles.STANDALONE_COLOR_IDS);

[
  'ctrl-font-family','ctrl-h-font-family',
  'ctrl-h1-weight','ctrl-h2-weight','ctrl-h3-weight','ctrl-h4-weight',
  'ctrl-bg-color','ctrl-link-color','ctrl-link-decoration',
  'ctrl-code-font',
  'ctrl-bq-border-color',
  'ctrl-chart-accent','ctrl-chart-palette',
].forEach(function(id) {
  var handler = function() { if (STANDALONE_COLOR_IDS.has(id)) S.overriddenColors.add(id); applyCtrl(id); };
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
  if (S.refreshChartColors && (ctrlId === 'ctrl-chart-bg' || ctrlId === 'ctrl-chart-text' ||
      ctrlId === 'ctrl-block-bg' || ctrlId === 'ctrl-block-text')) {
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
    value = ctrlId === 'ctrl-color' ? S.getColorDefault() : S.getStandaloneDefault(ctrlId);
  } else {
    var parentEl = document.getElementById(parent);
    value = parentEl ? parentEl.value : S.getColorDefault();
  }
  setColorValue(ctrlId, value, false);
}

Object.keys(COLOR_VAR).forEach(function(ctrlId) {
  var el = document.getElementById(ctrlId);
  if (!el) return;
  el.addEventListener('input',  function() { setColorValue(ctrlId, el.value, true); S.syncAll('controls'); });
  el.addEventListener('change', function() { setColorValue(ctrlId, el.value, true); S.syncAll('controls'); });
});

document.getElementById('reset-color').addEventListener('click',      function() { S.overriddenColors.delete('ctrl-color'); setColorValue('ctrl-color', S.getColorDefault(), false); S.syncAll('controls'); });
document.getElementById('reset-h-color').addEventListener('click',    function() { resetColorValue('ctrl-h-color'); S.syncAll('controls'); });
document.getElementById('reset-h1-color').addEventListener('click',   function() { resetColorValue('ctrl-h1-color'); S.syncAll('controls'); });
document.getElementById('reset-h2-color').addEventListener('click',   function() { resetColorValue('ctrl-h2-color'); S.syncAll('controls'); });
document.getElementById('reset-h3-color').addEventListener('click',   function() { resetColorValue('ctrl-h3-color'); S.syncAll('controls'); });
document.getElementById('reset-h4-color').addEventListener('click',   function() { resetColorValue('ctrl-h4-color'); S.syncAll('controls'); });
document.getElementById('reset-p-color').addEventListener('click',    function() { resetColorValue('ctrl-p-color'); S.syncAll('controls'); });
document.getElementById('reset-list-color').addEventListener('click', function() { resetColorValue('ctrl-list-color'); S.syncAll('controls'); });

// Block cascade resets
['ctrl-block-bg','ctrl-block-text','ctrl-code-bg','ctrl-code-color','ctrl-bq-bg','ctrl-bq-color','ctrl-chart-bg','ctrl-chart-text'].forEach(function(ctrlId) {
  var btnId = 'reset-' + ctrlId.replace('ctrl-', '');
  var btn = document.getElementById(btnId);
  if (btn) btn.addEventListener('click', function() { resetColorValue(ctrlId); S.syncAll('controls'); });
});

['ctrl-bg-color','ctrl-link-color','ctrl-bq-border-color','ctrl-chart-accent'].forEach(function(ctrlId) {
  var btnId = 'reset-' + ctrlId.replace('ctrl-', '');
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

function setCtrl(id, val) {
  if (val === undefined || val === null) return;
  var el = document.getElementById(id);
  if (!el) return;
  el.value = val;
  var rangeId = id.replace(/-num$/, '-range');
  var rng = document.getElementById(rangeId);
  if (rng) rng.value = val;
  applyCtrl(id);
}

function applyStylesFromMeta(s) {
  if (!s) return;
  // Suppress syncAll during batch updates to avoid capturing partial state
  var wasSyncing = S._syncing;
  S._syncing = true;

  var result = SDocStyles.stylesToControls(s);
  var controls = result.controls;

  // Font family selects need special handling to match bare names against <option> values
  [['fontFamily', 'ctrl-font-family'], ['headers.fontFamily', 'ctrl-h-font-family']].forEach(function(pair) {
    var styleKey = pair[0], ctrlId = pair[1];
    var fontName = styleKey === 'fontFamily' ? s.fontFamily : (s.headers || {}).fontFamily;
    if (fontName) {
      var sel = document.getElementById(ctrlId);
      var match = [].slice.call(sel.options).find(function(o) {
        return o.value.replace(/['"]/g,'').split(',')[0].trim() === fontName ||
               o.textContent === fontName;
      });
      if (match) { sel.value = match.value; applyCtrl(ctrlId); }
    }
  });

  Object.keys(controls).forEach(function(id) {
    if (id === 'ctrl-font-family' || id === 'ctrl-h-font-family') return;
    if (SDocStyles.COLOR_VAR_MAP[id]) return;
    setCtrl(id, controls[id]);
  });

  if (result.hasThemeColors) {
    // Per-theme color mode: populate both theme states
    S.themeColors.light = result.lightColors || {};
    S.themeColors.dark = result.darkColors || {};
    S.themeOverridden.light = result.lightOverridden || new Set();
    S.themeOverridden.dark = result.darkOverridden || new Set();

    // Load the active theme's colors into controls
    S._syncing = wasSyncing;
    S.loadThemeColors(S.activeTheme);
    return;
  }

  // Legacy single-theme path: top-level colors go to light theme only,
  // then loadThemeColors applies the correct theme's colors.
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
  if (s.background) legacyStandalone.push(['ctrl-bg-color', s.background]);
  if (s.link && s.link.color) legacyStandalone.push(['ctrl-link-color', s.link.color]);
  if (s.code) {
    if (s.code.background) legacyStandalone.push(['ctrl-code-bg', s.code.background]);
    if (s.code.color) legacyStandalone.push(['ctrl-code-color', s.code.color]);
  }
  if (s.blockquote) {
    if (s.blockquote.borderColor) legacyStandalone.push(['ctrl-bq-border-color', s.blockquote.borderColor]);
    if (s.blockquote.background) legacyStandalone.push(['ctrl-bq-bg', s.blockquote.background]);
    if (s.blockquote.color) legacyStandalone.push(['ctrl-bq-color', s.blockquote.color]);
  }
  legacyStandalone.forEach(function(pair) {
    lightOverridden.add(pair[0]);
    lightColors[pair[0]] = pair[1];
  });

  // Now apply the active theme's colors (light overrides or dark defaults)
  S._syncing = wasSyncing;
  S.loadThemeColors(S.activeTheme);
}

function collectStyles() {
  S.saveCurrentThemeColors();
  var lightHas = S.themeOverridden.light.size > 0;
  var darkHas = S.themeOverridden.dark.size > 0;
  if (lightHas || darkHas) {
    return SDocStyles.collectStylesDual(
      readAllControlValues(),
      S.themeOverridden.light, S.themeOverridden.dark,
      S.themeColors.light, S.themeColors.dark
    );
  }
  return SDocStyles.collectStyles(readAllControlValues(), S.overriddenColors);
}

// ── Reset all styles ──────────────────────────────────

function resetAllStyles() {
  // Clear both theme states
  S.themeOverridden.light.clear();
  S.themeOverridden.dark.clear();
  S.themeColors.light = {};
  S.themeColors.dark = {};

  setColorValue('ctrl-color', S.getColorDefault(), false);
  // Reset block cascade roots to theme defaults
  setColorValue('ctrl-block-bg', S.getStandaloneDefault('ctrl-block-bg') || '#f4f1ed', false);
  setColorValue('ctrl-block-text', S.getStandaloneDefault('ctrl-block-text') || '#6b6560', false);
  // Set standalone color controls to theme-appropriate defaults
  STANDALONE_COLOR_IDS.forEach(function(ctrlId) {
    var el = document.getElementById(ctrlId);
    if (el) el.value = S.getStandaloneDefault(ctrlId);
  });
  document.querySelectorAll('#right input, #right select').forEach(function(el) {
    if (STANDALONE_COLOR_IDS.has(el.id)) return; // already set above
    if (el.type === 'range' || el.type === 'number') el.value = el.defaultValue;
    else if (el.tagName === 'SELECT') el.selectedIndex = [].slice.call(el.options).findIndex(function(o) { return o.defaultSelected; });
    else if (el.type === 'color') el.value = el.defaultValue;
  });
  ['ctrl-bg-color','ctrl-font-family','ctrl-base-size-num','ctrl-line-height-num',
   'ctrl-h-font-family','ctrl-h-scale-num','ctrl-h-mb-num',
   'ctrl-h1-size-num','ctrl-h1-weight','ctrl-h2-size-num','ctrl-h2-weight',
   'ctrl-h3-size-num','ctrl-h3-weight','ctrl-h4-size-num','ctrl-h4-weight',
   'ctrl-p-lh-num','ctrl-p-mb-num',
   'ctrl-link-color','ctrl-link-decoration',
   'ctrl-code-font',
   'ctrl-bq-border-color','ctrl-bq-bw-num','ctrl-bq-size-num',
   'ctrl-list-spacing-num','ctrl-list-indent-num',
   'ctrl-chart-accent','ctrl-chart-palette',
  ].forEach(function(id) { applyCtrl(id); });
}

// ── Init: set colors to theme-appropriate defaults ──────

if (document.documentElement.dataset.theme === 'dark') {
  STANDALONE_COLOR_IDS.forEach(function(ctrlId) {
    var el = document.getElementById(ctrlId);
    if (el) el.value = S.getStandaloneDefault(ctrlId);
  });
}

setColorValue('ctrl-color', S.getColorDefault(), false);

// ── Register on SDocs for cross-module access ──────────

S.setColorValue = setColorValue;
S.readAllControlValues = readAllControlValues;
S.collectStyles = collectStyles;
S.applyStylesFromMeta = applyStylesFromMeta;
S.resetAllStyles = resetAllStyles;
S.STANDALONE_COLOR_IDS = STANDALONE_COLOR_IDS;

})();
