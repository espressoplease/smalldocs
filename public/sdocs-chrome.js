/**
 * sdocs-chrome.js — tint the app chrome (top toolbar, side panel, borders)
 * to match the document's colors, but ONLY when the document specifies
 * custom colors. If nothing is customised, the chrome keeps its default look
 * exactly as defined in css/tokens.css.
 *
 * The tint is applied by setting the same CSS variables css/tokens.css uses
 * (--bg, --bg-panel, etc.) as inline styles on the :root element — using
 * CSS color-mix() so the browser blends the doc background with the theme's
 * chrome base at apply time. On docs without a custom background, all inline
 * overrides are removed so the tokens.css defaults shine through.
 */

// ── Pure helpers (UMD — shared with Node tests) ───────────────────────
(function (exports) {
  // Parse "rgb(r, g, b)" / "rgba(r, g, b, a)" → {r,g,b}, 0-255
  function parseRgb(str) {
    var m = str && str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
  }

  // Relative luminance 0-1 (Rec. 709 approximation)
  function luminance(rgb) {
    return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  }

  exports.parseRgb = parseRgb;
  exports.luminance = luminance;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocChrome = {}));

// ── DOM-driven tint application (browser only) ────────────────────────
(function () {
  if (typeof window === 'undefined' || !window.document) return;

  var S = window.SDocs = window.SDocs || {};
  var H = window.SDocChrome;

  var BASES = {
    light: {
      bg:            '#F7F5F2',
      bgSurface:     '#F1EDE8',
      bgPanel:       '#EDE8E2',
      bgPanelDeep:   '#E7E2DB',
      bgInput:       '#FFFFFF',
      bgHover:       '#E8E3DD',
      bgActive:      '#E2DDD6',
      border:        '#D4CFC9',
      borderSubtle:  '#DDD9D3',
      borderStrong:  '#C5BFB8',
      text:          '#1C1917',
      text2:         '#57534E',
      text3:         '#A8A29E'
    },
    dark: {
      bg:            '#1C1A17',
      bgSurface:     '#252320',
      bgPanel:       '#211F1D',
      bgPanelDeep:   '#1A1816',
      bgInput:       '#2C2926',
      bgHover:       '#32302C',
      bgActive:      '#3A3733',
      border:        '#3D3935',
      borderSubtle:  '#332F2B',
      borderStrong:  '#4A453F',
      text:          '#E7E5E2',
      text2:         '#A8A29E',
      text3:         '#6B6560'
    }
  };

  // How strongly the doc bg bleeds into each chrome surface.
  // Tuned subtle — chrome should feel related to the doc, not become it.
  var MIX = {
    bg:           32,
    bgSurface:    38,
    bgPanel:      40,
    bgPanelDeep:  38,
    bgInput:      55,
    bgHover:      38,
    bgActive:     42,
    border:       45,
    borderSubtle: 38,
    borderStrong: 50,
    text:         22,
    text2:        35,
    text3:        55
  };

  var VAR_NAMES = {
    bg:           '--bg',
    bgSurface:    '--bg-surface',
    bgPanel:      '--bg-panel',
    bgPanelDeep:  '--bg-panel-deep',
    bgInput:      '--bg-input',
    bgHover:      '--bg-hover',
    bgActive:     '--bg-active',
    border:       '--border',
    borderSubtle: '--border-subtle',
    borderStrong: '--border-strong',
    text:         '--text',
    text2:        '--text-2',
    text3:        '--text-3'
  };

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function hasCustomDocBg(theme) {
    var overridden = S.themeOverridden && S.themeOverridden[theme];
    return !!(overridden && overridden.has && overridden.has('_sd_ctrl-bg-color'));
  }

  function readDocBg() {
    var el = document.getElementById('_sd_rendered');
    if (!el) return null;
    var bg = getComputedStyle(el).backgroundColor;
    // "rgba(0, 0, 0, 0)" or empty = not resolved; bail out
    if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return null;
    return bg;
  }

  // Read a CSS var from #_sd_rendered, resolving var() references by
  // applying it to a temporary probe element. Falls back to doc text color.
  var _probe = null;
  function readDocVar(varName) {
    var rendered = document.getElementById('_sd_rendered');
    if (!rendered) return null;
    if (!_probe) {
      _probe = document.createElement('span');
      _probe.style.display = 'none';
    }
    _probe.style.color = 'var(' + varName + ')';
    rendered.appendChild(_probe);
    var resolved = getComputedStyle(_probe).color;
    rendered.removeChild(_probe);
    return resolved;
  }

  function apply() {
    var root = document.documentElement.style;
    var activeTheme = currentTheme();

    if (!hasCustomDocBg(activeTheme)) {
      // Clear any previous overrides so tokens.css defaults show through
      Object.keys(VAR_NAMES).forEach(function (k) { root.removeProperty(VAR_NAMES[k]); });
      return;
    }

    var docBg = readDocBg();
    if (!docBg) return;

    // Pick chrome base palette by the doc's luminance, not the active theme.
    // Otherwise a dark doc bg under light theme mixes dark grey text into a
    // dark-tinted bg — unreadable.
    var rgb = H.parseRgb(docBg);
    var chromeKey = (rgb && H.luminance(rgb) < 0.5) ? 'dark' : 'light';
    var base = BASES[chromeKey];
    // Chrome text + toolbar icons tint from the doc's heading color, not
    // the body text color — headings carry the doc's accent, body text
    // is usually just "near-black" and loses the palette feel.
    var docHeading = readDocVar('--md-h-color') || docBg;

    Object.keys(VAR_NAMES).forEach(function (key) {
      var isTextKey = key === 'text' || key === 'text2' || key === 'text3';
      var tintSource = isTextKey ? docHeading : docBg;
      var pct = MIX[key];
      var val = 'color-mix(in oklch, ' + tintSource + ' ' + pct + '%, ' + base[key] + ' ' + (100 - pct) + '%)';
      root.setProperty(VAR_NAMES[key], val);
    });
  }

  // Debounce — several paths can trigger this in quick succession
  var _raf = null;
  function scheduleApply() {
    if (_raf) return;
    _raf = requestAnimationFrame(function () { _raf = null; apply(); });
  }

  S.applyChromeTint = scheduleApply;
})();
