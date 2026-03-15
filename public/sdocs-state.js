// sdocs-state.js — Shared mutable state namespace
// All modules read/write through window.SDocs
(function () {
'use strict';

window.SDocs = {
  // Document state
  currentBody: '',
  currentMeta: {},

  // Color override tracking
  overriddenColors: new Set(),

  // DOM references
  renderedEl: document.getElementById('rendered'),
  rawEl: document.getElementById('raw'),

  // Mode tracking
  currentMode: 'read',

  // Sync flags
  _syncing: false,
  _isDefaultState: true,
  _hashTimer: null,
  _rawSyncTimer: null,

  // Cross-module functions (registered by defining module)
  // Theme: toggleTheme, getThemeDefaults, getColorDefault, getStandaloneDefault,
  //         loadGoogleFont, updateDefaultColors, GOOGLE_FONTS
  // Controls: setColorValue, readAllControlValues, collectStyles,
  //           applyStylesFromMeta, resetAllStyles, STANDALONE_COLOR_IDS
  // App: syncAll, setStatus, setMode, render, loadText
};

})();
