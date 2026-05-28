// sdocs-contrast.js - WCAG contrast analysis for custom-styled documents.
//
// Why this exists: an agent that hand-picks colours can easily produce an
// unreadable pair - dark text on a dark background, a navy heading on a near
// black page - without noticing, especially when it tuned the colours while
// viewing one theme. This module resolves the effective palette for BOTH the
// light and dark themes (mirroring how the browser applies front-matter
// styles) and grades every text-on-background pair against WCAG ratios, so
// `sdoc color-analysis` can warn before the document ships.
//
// Pure: no I/O, no third-party deps. Shared between the CLI and tests (and
// available to the browser via window.SDocContrast).
(function (exports) {
  'use strict';

  var SDocStyles = (typeof module !== 'undefined' && module.exports)
    ? require('./sdocs-styles.js')
    : (typeof window !== 'undefined' ? window.SDocStyles : null);

  // Light-theme defaults for colours the document didn't override. Mirrors
  // the LIGHT_DEFAULTS / DARK_DEFAULTS tables in sdocs-theme.js. Headings
  // default to the body text colour (the colour cascade root).
  var LIGHT_DEFAULTS = {
    bg: '#ffffff', text: '#1c1917', link: '#2563eb',
    blockBg: '#f4f1ed', blockText: '#6b6560',
    codeBg: '#f4f1ed', codeText: '#6b21a8',
    bqBg: '#f7f5f2', bqText: '#6b6560'
  };
  var DARK_DEFAULTS = {
    bg: '#2c2a26', text: '#e7e5e2', link: '#60a5fa',
    blockBg: '#1a1816', blockText: '#a8a29e',
    codeBg: '#1a1816', codeText: '#b8a99a',
    bqBg: '#252320', bqText: '#a8a29e'
  };

  // ── WCAG maths ────────────────────────────────────────
  function hexToRgb(hex) {
    if (typeof hex !== 'string') return null;
    var h = hex.trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  function channelLin(c) {
    var s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(hex) {
    var rgb = hexToRgb(hex);
    if (!rgb) return null;
    return 0.2126 * channelLin(rgb.r) + 0.7152 * channelLin(rgb.g) + 0.0722 * channelLin(rgb.b);
  }

  // WCAG contrast ratio, 1..21. Returns null for unparseable input.
  function contrastRatio(a, b) {
    var la = relativeLuminance(a), lb = relativeLuminance(b);
    if (la == null || lb == null) return null;
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  // Fail line. Calibrated against human review rather than the strict
  // WCAG-AA body bar (4.5:1): pairs in the ~3.2-4.4 range read fine on a
  // normal screen, while everything that actually caused unreadable docs
  // sat well below 3:1. Set as a single constant so it's easy to retune.
  // (WCAG bands are still reported via `level` for anyone who wants them.)
  var MIN_CONTRAST = 3.0;

  // Grade a ratio against MIN_CONTRAST. `large` is kept for callers that
  // want to annotate heading vs body, but the pass/fail line is uniform.
  //   level: 'fail' | 'aa-large' | 'aa' | 'aaa' (informational WCAG bands)
  //   ok:    ratio meets the fail line
  function grade(ratio, large) {
    var level;
    if (ratio == null) level = 'unknown';
    else if (ratio >= 7) level = 'aaa';
    else if (ratio >= 4.5) level = 'aa';
    else if (ratio >= 3) level = 'aa-large';
    else level = 'fail';
    return {
      ratio: ratio == null ? null : Math.round(ratio * 100) / 100,
      level: level,
      need: MIN_CONTRAST,
      ok: ratio != null && ratio >= MIN_CONTRAST
    };
  }

  // ── Palette resolution ────────────────────────────────
  // Resolve a single colour for both themes. `explicit` is the front-matter
  // value (or null/undefined). The dark value mirrors applyStylesFromMeta:
  // an explicit dark override wins, else an explicit light value is inverted,
  // else the theme default applies.
  function resolve(explicit, ctrlId, darkBlock, lightDefault, darkDefault) {
    var light = explicit || lightDefault;
    var dark;
    if (darkBlock && darkBlock[ctrlId]) dark = darkBlock[ctrlId];
    else if (explicit && SDocStyles && SDocStyles.invertLightness) {
      dark = SDocStyles.invertLightness(explicit, SDocStyles.colorControlRole
        ? SDocStyles.colorControlRole(ctrlId) : undefined);
    } else dark = darkDefault;
    return { light: light, dark: dark };
  }

  // Resolve the full set of text-on-background pairs for a parsed `styles`
  // object. Returns { light: [pairs], dark: [pairs] } where each pair is
  // { label, surface, fg, bg, large }.
  function resolvePairs(styles) {
    styles = styles || {};
    var darkBlock = (SDocStyles && SDocStyles.parseDarkBlock) ? SDocStyles.parseDarkBlock(styles.dark) : {};
    var headers = styles.headers || {};
    var h = function (n) { return styles['h' + n] || {}; };

    // Page background and the colours that sit on it.
    var bg        = resolve(styles.background, '_sd_ctrl-bg-color', darkBlock, LIGHT_DEFAULTS.bg, DARK_DEFAULTS.bg);
    var body      = resolve(styles.color, '_sd_ctrl-color', darkBlock, LIGHT_DEFAULTS.text, DARK_DEFAULTS.text);
    var headingFallback = headers.color || styles.color;
    function heading(n) {
      var explicit = h(n).color || headers.color;
      var id = '_sd_ctrl-h' + n + '-color';
      var lightDef = headingFallback || LIGHT_DEFAULTS.text;
      var darkDef = body.dark;
      return resolve(explicit, id, darkBlock, lightDef, darkDef);
    }
    var h1 = heading(1), h2 = heading(2), h3 = heading(3), h4 = heading(4);
    var link = resolve((styles.link || {}).color, '_sd_ctrl-link-color', darkBlock, LIGHT_DEFAULTS.link, DARK_DEFAULTS.link);

    var blocks = styles.blocks || {};
    var bqBg = resolve((styles.blockquote || {}).background || blocks.background, '_sd_ctrl-bq-bg', darkBlock, LIGHT_DEFAULTS.bqBg, DARK_DEFAULTS.bqBg);
    var bqText = resolve((styles.blockquote || {}).color || blocks.color, '_sd_ctrl-bq-color', darkBlock, LIGHT_DEFAULTS.bqText, DARK_DEFAULTS.bqText);
    var codeBg = resolve((styles.code || {}).background || blocks.background, '_sd_ctrl-code-bg', darkBlock, LIGHT_DEFAULTS.codeBg, DARK_DEFAULTS.codeBg);
    var codeText = resolve((styles.code || {}).color || blocks.color, '_sd_ctrl-code-color', darkBlock, LIGHT_DEFAULTS.codeText, DARK_DEFAULTS.codeText);

    function build(theme) {
      var pick = function (c) { return c[theme]; };
      return [
        { label: 'body text', surface: 'page',       fg: pick(body), bg: pick(bg), large: false },
        { label: 'h1',        surface: 'page',       fg: pick(h1),   bg: pick(bg), large: true },
        { label: 'h2',        surface: 'page',       fg: pick(h2),   bg: pick(bg), large: true },
        { label: 'h3',        surface: 'page',       fg: pick(h3),   bg: pick(bg), large: true },
        { label: 'h4',        surface: 'page',       fg: pick(h4),   bg: pick(bg), large: true },
        { label: 'link',      surface: 'page',       fg: pick(link), bg: pick(bg), large: false },
        { label: 'blockquote text', surface: 'blockquote', fg: pick(bqText),   bg: pick(bqBg),   large: false },
        { label: 'code text',       surface: 'code block', fg: pick(codeText), bg: pick(codeBg), large: false }
      ];
    }
    return { light: build('light'), dark: build('dark') };
  }

  // Full analysis for a parsed styles object: grades every pair in both
  // themes. `hasCustomStyles` is false when the document set no colours, in
  // which case the built-in defaults are known-good and nothing is flagged.
  function analyzeStyles(styles) {
    var hasColors = styles && hasCustomColors(styles);
    var pairs = resolvePairs(styles);
    function gradeList(list) {
      return list.map(function (p) {
        var g = grade(contrastRatio(p.fg, p.bg), p.large);
        return {
          label: p.label, surface: p.surface, fg: p.fg, bg: p.bg, large: p.large,
          ratio: g.ratio, level: g.level, need: g.need, ok: g.ok
        };
      });
    }
    var light = gradeList(pairs.light);
    var dark = gradeList(pairs.dark);
    var fails = light.concat(dark).filter(function (p) { return !p.ok; });
    return { hasCustomColors: !!hasColors, light: light, dark: dark, fails: fails };
  }

  function hasCustomColors(styles) {
    if (!styles) return false;
    var keys = ['background', 'color', 'link', 'blocks', 'blockquote', 'code', 'headers', 'h1', 'h2', 'h3', 'h4', 'dark'];
    for (var i = 0; i < keys.length; i++) {
      var v = styles[keys[i]];
      if (v == null) continue;
      if (typeof v === 'string') return true;            // background / color
      if (typeof v === 'object') {
        if (v.color || v.background || v.borderColor) return true;
      }
    }
    return false;
  }

  exports.hexToRgb = hexToRgb;
  exports.relativeLuminance = relativeLuminance;
  exports.contrastRatio = contrastRatio;
  exports.grade = grade;
  exports.MIN_CONTRAST = MIN_CONTRAST;
  exports.resolvePairs = resolvePairs;
  exports.analyzeStyles = analyzeStyles;
  exports.hasCustomColors = hasCustomColors;
  exports.LIGHT_DEFAULTS = LIGHT_DEFAULTS;
  exports.DARK_DEFAULTS = DARK_DEFAULTS;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocContrast = {}));
