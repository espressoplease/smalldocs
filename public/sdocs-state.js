// sdocs-state.js — Shared mutable state namespace
// All modules read/write through window.SDocs
(function () {
'use strict';

window.SDocs = {
  // Document state
  currentBody: '',
  currentMeta: {},

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
  if (cssVar === '--md-bg') {
    SDocs.contentAreaEl.style.setProperty('background-color', value);
  }
};

})();
