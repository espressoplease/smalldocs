// sdocs-theme.js — Theme, fonts, and dark mode
(function () {
'use strict';

var S = SDocs;

// ── Google Fonts ──────────────────────────────────

const GOOGLE_FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Source Sans 3',
  'Oswald', 'Raleway', 'Poppins', 'Merriweather', 'Ubuntu',
  'Nunito', 'Playfair Display', 'Roboto Slab', 'PT Sans', 'Lora',
  'Mulish', 'Noto Sans', 'Rubik', 'Dosis',
  'Josefin Sans', 'PT Serif', 'Libre Franklin', 'Crimson Text'
];

const loadedFonts = new Set(['Inter']);

function loadGoogleFont(family) {
  if (loadedFonts.has(family)) return;
  loadedFonts.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;600;700&display=swap`;
  document.head.appendChild(link);
}

function populateFontSelect(sel, includeInherit) {
  if (includeInherit) {
    const opt = document.createElement('option');
    opt.value = 'inherit';
    opt.textContent = '— Same as body —';
    sel.appendChild(opt);
  }
  GOOGLE_FONTS.forEach(f => {
    const opt = document.createElement('option');
    opt.value = `'${f}', sans-serif`;
    opt.textContent = f;
    sel.appendChild(opt);
  });
  [['Georgia, serif','Georgia'],['Times New Roman, serif','Times New Roman'],
   ['system-ui, sans-serif','System UI']].forEach(([v,l]) => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = l;
    sel.appendChild(opt);
  });
}

// ── Dark mode ──────────────────────────────────

const LIGHT_DEFAULTS = {
  bgColor:       '#ffffff',
  colorDefault:  '#1c1917',
  codeBg:        '#f4f1ed',
  codeColor:     '#6b21a8',
  linkColor:     '#2563eb',
  bqBorderColor: '#2563eb',
  bqBg:          '#f7f5f2',
  bqColor:       '#6b6560',
};

const DARK_DEFAULTS = {
  bgColor:       '#2c2a26',
  colorDefault:  '#e7e5e2',
  codeBg:        '#1a1816',
  codeColor:     '#b8a99a',
  linkColor:     '#60a5fa',
  bqBorderColor: '#60a5fa',
  bqBg:          '#252320',
  bqColor:       '#a8a29e',
};

function getThemeDefaults() {
  return document.documentElement.dataset.theme === 'dark' ? DARK_DEFAULTS : LIGHT_DEFAULTS;
}

function getThemeDefaultsFor(theme) {
  return theme === 'dark' ? DARK_DEFAULTS : LIGHT_DEFAULTS;
}

function getColorDefault() {
  return getThemeDefaults().colorDefault;
}

function getPreferredTheme() {
  const stored = localStorage.getItem('sdocs-theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const SUN_ICON = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
const MOON_ICON = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke-width="1.5"/>';

function updateThemeIcon(theme) {
  const icon = document.getElementById('_sd_icon-theme');
  if (icon) icon.innerHTML = theme === 'dark' ? SUN_ICON : MOON_ICON;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  S.activeTheme = theme;
  localStorage.setItem('sdocs-theme', theme);
  updateThemeIcon(theme);
}

// ── Per-theme color save/load ──────────────────────

function saveCurrentThemeColors() {
  var theme = S.activeTheme;
  var colors = S.themeColors[theme];
  // Save all 13 color control values
  SDocStyles.ALL_COLOR_IDS.forEach(function(ctrlId) {
    var el = document.getElementById(ctrlId);
    if (el) colors[ctrlId] = el.value;
  });
}

function loadThemeColors(theme) {
  var colors = S.themeColors[theme];
  var overridden = S.themeOverridden[theme];
  var defaults = getThemeDefaultsFor(theme);

  // Cascade roots: text color and block bg/text
  var cascadeRoots = [
    ['_sd_ctrl-color', defaults.colorDefault],
    ['_sd_ctrl-block-bg', defaults.codeBg],
    ['_sd_ctrl-block-text', defaults.bqColor],
  ];
  cascadeRoots.forEach(function(pair) {
    var id = pair[0], def = pair[1];
    if (overridden.has(id)) {
      S.setColorValue(id, colors[id], true);
    } else {
      S.setColorValue(id, def, false);
    }
  });

  // Then cascade children that are overridden (overrides the parent cascade)
  var cascadeIds = Object.keys(SDocStyles.COLOR_VAR_MAP);
  cascadeIds.forEach(function(ctrlId) {
    if (ctrlId === '_sd_ctrl-color' || ctrlId === '_sd_ctrl-block-bg' || ctrlId === '_sd_ctrl-block-text') return;
    if (overridden.has(ctrlId)) {
      S.setColorValue(ctrlId, colors[ctrlId], true);
    }
  });

  // Standalone colors (not in cascade)
  var standaloneMap = {
    '_sd_ctrl-bg-color':        defaults.bgColor,
    '_sd_ctrl-link-color':      defaults.linkColor,
    '_sd_ctrl-bq-border-color': defaults.bqBorderColor,
  };
  for (var ctrlId in standaloneMap) {
    var el = document.getElementById(ctrlId);
    if (!el) continue;
    if (overridden.has(ctrlId)) {
      el.value = colors[ctrlId];
    } else {
      el.value = standaloneMap[ctrlId];
    }
    var allVals = S.readAllControlValues();
    SDocStyles.controlToCssVars(ctrlId, el.value, allVals)
      .forEach(function(a) { S.setStyleVar(a.cssVar, a.value); });
  }
}

function updateThemeTabs(theme) {
  var lightTab = document.getElementById('_sd_theme-tab-light');
  var darkTab = document.getElementById('_sd_theme-tab-dark');
  if (lightTab) lightTab.classList.toggle('active', theme === 'light');
  if (darkTab) darkTab.classList.toggle('active', theme === 'dark');
}

function switchThemeAndUpdate(theme) {
  if (theme === S.activeTheme) return;
  saveCurrentThemeColors();
  applyTheme(theme);
  loadThemeColors(theme);
  updateThemeTabs(theme);
  S.syncAll('controls');
}

function toggleTheme() {
  var current = S.activeTheme;
  switchThemeAndUpdate(current === 'dark' ? 'light' : 'dark');
}

function updateDefaultColors() {
  const defaults = getThemeDefaults();
  if (!S.overriddenColors) return;
  if (!S.overriddenColors.has('_sd_ctrl-color')) {
    S.setColorValue('_sd_ctrl-color', defaults.colorDefault, false);
  }
  // Update standalone color defaults for reset buttons
  const standaloneMap = {
    '_sd_ctrl-bg-color':        defaults.bgColor,
    '_sd_ctrl-link-color':      defaults.linkColor,
    '_sd_ctrl-code-bg':         defaults.codeBg,
    '_sd_ctrl-code-color':      defaults.codeColor,
    '_sd_ctrl-bq-border-color': defaults.bqBorderColor,
    '_sd_ctrl-bq-bg':           defaults.bqBg,
    '_sd_ctrl-bq-color':        defaults.bqColor,
  };
  for (const [ctrlId, val] of Object.entries(standaloneMap)) {
    if (!S.overriddenColors.has(ctrlId)) {
      const el = document.getElementById(ctrlId);
      if (el) {
        el.value = val;
        const allVals = S.readAllControlValues();
        SDocStyles.controlToCssVars(ctrlId, val, allVals)
          .forEach(a => S.setStyleVar(a.cssVar, a.value));
      }
    }
  }
  S.syncAll('controls');
}

function getStandaloneDefault(ctrlId) {
  const d = getThemeDefaults();
  const map = {
    '_sd_ctrl-bg-color':        d.bgColor,
    '_sd_ctrl-link-color':      d.linkColor,
    '_sd_ctrl-bq-border-color': d.bqBorderColor,
    '_sd_ctrl-block-bg':        d.codeBg,
    '_sd_ctrl-block-text':      d.bqColor,
    '_sd_ctrl-chart-accent':    '#3b82f6',
  };
  return map[ctrlId];
}

// ── Init at load time ──────────────────────────────────

var initTheme = getPreferredTheme();
applyTheme(initTheme);

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
  if (!localStorage.getItem('sdocs-theme')) {
    switchThemeAndUpdate(e.matches ? 'dark' : 'light');
  }
});

populateFontSelect(document.getElementById('_sd_ctrl-font-family'), false);
document.getElementById('_sd_ctrl-font-family').value = "'Inter', sans-serif";
populateFontSelect(document.getElementById('_sd_ctrl-h-font-family'), true);

// ── Register on SDocs for cross-module access ──────────

S.GOOGLE_FONTS = GOOGLE_FONTS;
S.loadGoogleFont = loadGoogleFont;
S.getThemeDefaults = getThemeDefaults;
S.getThemeDefaultsFor = getThemeDefaultsFor;
S.getColorDefault = getColorDefault;
S.getStandaloneDefault = getStandaloneDefault;
S.updateDefaultColors = updateDefaultColors;
S.toggleTheme = toggleTheme;
S.switchThemeAndUpdate = switchThemeAndUpdate;
S.getPreferredTheme = getPreferredTheme;
S.saveCurrentThemeColors = saveCurrentThemeColors;
S.loadThemeColors = loadThemeColors;
S.updateThemeTabs = updateThemeTabs;

})();
