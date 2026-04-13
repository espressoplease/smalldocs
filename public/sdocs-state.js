// sdocs-state.js — Shared mutable state namespace
// All modules read/write through window.SDocs
(function () {
'use strict';

window.SDocs = {
  // Document state
  currentBody: '',
  currentMeta: {},

  // Runtime-only metadata (path, fullPath) passed via &local= URL param.
  // Stripped from the URL on load so it isn't in anything the user copies/shares.
  localMeta: {},

  // Per-doc overrides for the file-info card. Set from `styles.fileinfo` in
  // YAML front matter; emitted back via collectStyles so they round-trip.
  fileinfoStyles: {},

  // Per-theme color state
  activeTheme: 'light',
  themeColors: { light: {}, dark: {} },
  themeOverridden: { light: new Set(), dark: new Set() },

  // DOM references
  renderedEl: document.getElementById('rendered'),
  rawEl: document.getElementById('raw'),
  writeEl: null,

  // Mode tracking
  currentMode: 'read',

  // Sync flags
  _syncing: false,
  _isDefaultState: true,
  _hashTimer: null,
  _rawSyncTimer: null,
  _writeSyncTimer: null,

  // Cross-module functions (registered by defining module)
  // Theme: toggleTheme, getThemeDefaults, getColorDefault, getStandaloneDefault,
  //         loadGoogleFont, updateDefaultColors, GOOGLE_FONTS,
  //         switchThemeAndUpdate, saveCurrentThemeColors, loadThemeColors
  // Controls: setColorValue, readAllControlValues, collectStyles,
  //           applyStylesFromMeta, resetAllStyles, STANDALONE_COLOR_IDS
  // App: syncAll, setStatus, setMode, render, loadText
  // Write: enterWriteMode, exitWriteMode
};

// Backwards compat: S.overriddenColors delegates to active theme's set
Object.defineProperty(SDocs, 'overriddenColors', {
  get: function() { return SDocs.themeOverridden[SDocs.activeTheme]; },
  set: function(v) { SDocs.themeOverridden[SDocs.activeTheme] = v; },
  enumerable: true,
  configurable: true,
});

SDocs.contentAreaEl = document.getElementById('content-area');

SDocs.setStyleVar = function(cssVar, value) {
  SDocs.renderedEl.style.setProperty(cssVar, value);
  if (SDocs.writeEl) SDocs.writeEl.style.setProperty(cssVar, value);
  // File-info card is a sibling of #rendered, so it doesn't inherit vars set
  // on #rendered. Mirror the block-cascade vars and the doc text color onto
  // it so the card visually matches the document.
  var ficEl = document.getElementById('sdocs-file-info');
  if (ficEl && (/^--md-(fic-|block-)/.test(cssVar) || cssVar === '--md-color' || cssVar === '--md-p-color')) {
    ficEl.style.setProperty(cssVar, value);
  }
  if (cssVar === '--md-bg') {
    SDocs.contentAreaEl.style.setProperty('background-color', value);
  }
};

})();
