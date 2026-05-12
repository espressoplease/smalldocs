// sdocs-math.js — LaTeX math rendering via KaTeX.
//
// Pipeline:
//   1. marked extension captures $$...$$ (block) and $...$ (inline) BEFORE
//      other inline rules, so underscores in e.g. U_{env} aren't eaten by
//      italic parsing. It emits <div class="sdocs-math-display" data-tex="...">
//      and <span class="sdocs-math-inline" data-tex="...">.
//   2. DOMPurify keeps these (class + data-* are allowed by default). The
//      KaTeX output has inline styles, so we render AFTER sanitize — if we
//      rendered before, FORBID_ATTR: ['style'] in render() would break it.
//   3. processMath(el) walks the placeholders and calls katex.render into
//      each element's innerHTML. data-tex survives KaTeX rendering (KaTeX
//      only replaces innerHTML), which lets write-mode round-trip back to
//      the original LaTeX in htmlToMarkdown.
//
// KaTeX itself is lazy-loaded from jsdelivr on first encounter, mirroring
// the Chart.js lazy-load pattern in sdocs-charts.js.
(function () {
  'use strict';
  var S = window.SDocs;

  var KATEX_CSS = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
  var KATEX_JS  = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';

  var katexReady = null;

  function loadKatex() {
    if (katexReady) return katexReady;
    katexReady = new Promise(function (resolve, reject) {
      var cssDone = false;
      var jsDone = false;

      // KaTeX's UMD wrapper picks a target in this order:
      //   1. module.exports (Node)
      //   2. define.amd (AMD)
      //   3. exports.katex (CommonJS-ish)
      //   4. window.katex (browser global)
      // HTML's "named access on Window" auto-populates window.exports with
      // any DOM element that has id="exports" (same for "module"). If the
      // rendered doc contains such an element — e.g. a heading "Exports" —
      // step 3 fires and KaTeX assigns exports.katex = katex, leaving
      // window.katex undefined. Shadow both names with local undefined
      // properties for the duration of the script load so step 4 wins.
      var prevExports = window.exports;
      var prevModule = window.module;
      window.exports = undefined;
      window.module = undefined;
      function restoreGlobals() {
        if (prevExports === undefined) delete window.exports; else window.exports = prevExports;
        if (prevModule === undefined) delete window.module; else window.module = prevModule;
      }

      function maybeDone() {
        if (!(cssDone && jsDone)) return;
        restoreGlobals();
        resolve(window.katex);
      }

      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = KATEX_CSS;
      link.onload = function () { cssDone = true; maybeDone(); };
      link.onerror = function () { restoreGlobals(); reject(new Error('katex css load failed')); };
      document.head.appendChild(link);

      var script = document.createElement('script');
      script.src = KATEX_JS;
      script.async = true;
      script.onload = function () { jsDone = true; maybeDone(); };
      script.onerror = function () { restoreGlobals(); reject(new Error('katex js load failed')); };
      document.head.appendChild(script);
    });
    return katexReady;
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Inline $...$ rules (follow KaTeX auto-render conventions):
  //   - opening $ must not be immediately followed by whitespace
  //   - closing $ must not be immediately followed by a digit
  //   - no newlines inside
  //   - \$ is a literal dollar sign, never a delimiter
  // The capturing group is lazy so the shortest valid match wins.
  var INLINE_RE = /^\$(?!\s)((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)/;

  // Block $$...$$ — content may span lines. Require the closing $$ to be
  // followed by newline or end-of-string so we don't swallow inline uses.
  var BLOCK_RE = /^\$\$([\s\S]+?)\$\$(?:\n|$)/;

  // Only treat $$ as a block opener when it sits at the start of a line.
  // Without this check, `start` would return the index of $$ inside an
  // inline code span like `$$...$$`, causing marked to split the paragraph
  // there and gobble everything up to the next $$ as display math.
  // Lookbehind is zero-width, so the match index is the $$ position.
  var BLOCK_START_RE = /(?<=^|\n)\$\$/;

  function registerMarkedExtension() {
    if (typeof marked === 'undefined' || !marked.use) return;
    if (registerMarkedExtension._done) return;
    registerMarkedExtension._done = true;

    marked.use({
      extensions: [
        {
          name: 'sdocsMathBlock',
          level: 'block',
          start: function (src) {
            var m = BLOCK_START_RE.exec(src);
            return m ? m.index : undefined;
          },
          tokenizer: function (src) {
            var m = BLOCK_RE.exec(src);
            if (m) return { type: 'sdocsMathBlock', raw: m[0], tex: m[1].trim() };
          },
          renderer: function (token) {
            return '<div class="sdocs-math-display" data-tex="' + escapeAttr(token.tex) + '"></div>\n';
          },
        },
        {
          name: 'sdocsMathInline',
          level: 'inline',
          start: function (src) {
            var m = src.match(/(?<!\\)\$/);
            return m ? m.index : undefined;
          },
          tokenizer: function (src) {
            var m = INLINE_RE.exec(src);
            if (m) return { type: 'sdocsMathInline', raw: m[0], tex: m[1] };
          },
          renderer: function (token) {
            return '<span class="sdocs-math-inline" data-tex="' + escapeAttr(token.tex) + '"></span>';
          },
        },
      ],
    });
  }

  // Render all math placeholders inside `container`. Returns a promise that
  // resolves after all math has rendered (so callers like PDF export can
  // wait for the DOM to settle before capturing it).
  // DO NOT move this call above DOMPurify.sanitize(): KaTeX output uses inline
  // styles, which render() strips via FORBID_ATTR: ['style'].
  function processMath(container) {
    if (!container) return Promise.resolve();
    var nodes = container.querySelectorAll('.sdocs-math-display, .sdocs-math-inline');
    if (!nodes.length) return Promise.resolve();
    return loadKatex().then(function (katex) {
      if (!katex) return;
      nodes.forEach(function (el) {
        if (el._katexDone) return;
        var tex = el.getAttribute('data-tex') || '';
        var displayMode = el.classList.contains('sdocs-math-display');
        try {
          katex.render(tex, el, {
            displayMode: displayMode,
            throwOnError: false,
            output: 'html',
          });
          el._katexDone = true;
        } catch (_) {
          // throwOnError: false already renders an inline error; this catch
          // covers a deeper KaTeX crash. Leave the placeholder visible.
          el.textContent = tex;
        }
      });
    }).catch(function () {
      // CDN fetch failed — fall back to showing the raw LaTeX so the reader
      // at least sees the source rather than a blank element.
      nodes.forEach(function (el) {
        if (!el.textContent) el.textContent = el.getAttribute('data-tex') || '';
      });
    });
  }

  // Register the marked extension at script load (before any marked.parse call
  // in the app). Safe to call repeatedly — idempotent.
  registerMarkedExtension();

  S.processMath = processMath;
  S.registerMathExtension = registerMarkedExtension;

  // ── PDF / Word export rasterization ──────────────────
  // Mirrors S.getChartImages() and S.getMermaidImages(): one entry per
  // KaTeX-rendered math element with a PNG dataURL the exporter embeds.
  //
  // KaTeX renders to HTML+CSS, not SVG. To convert HTML to a bitmap without
  // an external library, we wrap the math element inside an inline SVG's
  // <foreignObject> and rasterize the SVG via Image -> canvas. The SVG
  // needs the KaTeX stylesheet inlined (external <link> doesn't propagate
  // into a serialized-then-reloaded SVG), with font URLs rewritten to
  // absolute CDN paths so the browser can still fetch them while parsing
  // the inlined CSS.

  var katexCssPromise = null;
  function fetchKatexCss() {
    if (katexCssPromise) return katexCssPromise;
    katexCssPromise = fetch(KATEX_CSS)
      .then(function (r) { return r.text(); })
      .then(function (css) {
        // KaTeX CSS uses relative URLs like url(fonts/KaTeX_Main-Regular.woff2);
        // when the CSS is inlined into an SVG data URL the relative base is
        // gone, so the browser can't resolve them. Rewrite to absolute CDN
        // URLs (jsdelivr serves with permissive CORS so foreignObject
        // rasterization can pull them).
        var base = KATEX_CSS.replace(/[^/]+$/, '');
        return css.replace(/url\(("|')?(?!https?:|data:)([^)'"]+)\1?\)/g, function (_, q, p) {
          return 'url(' + base + p + ')';
        });
      })
      .catch(function () { return ''; });
    return katexCssPromise;
  }

  function rasterizeMathEl(el, dpr) {
    return new Promise(function (resolve) {
      var rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return resolve(null);
      // KaTeX uses tight negative margins internally; descenders on
      // display math (subscripts on \sum bounds, low parens) can sit
      // outside getBoundingClientRect's box. Pad the capture rect so
      // the rasterized PNG includes that overflow.
      var pad = 4;
      var w = Math.ceil(rect.width) + pad * 2;
      var h = Math.ceil(rect.height) + pad * 2;
      var s = dpr || 2;
      var cs = getComputedStyle(el);
      var fontSize = cs.fontSize;
      var color = cs.color;
      fetchKatexCss().then(function (css) {
        var html = new XMLSerializer().serializeToString(el);
        // Wrap in a div that carries the cascade's font-size and color, so
        // the math sits at the surrounding text's metrics rather than
        // KaTeX's default 1em (which is 16px in vacuum). The inner padding
        // mirrors the capture-rect pad above so the math is not flush
        // against the SVG bounds.
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">'
          + '<defs><style>' + css + '</style></defs>'
          + '<foreignObject width="100%" height="100%">'
          + '<div xmlns="http://www.w3.org/1999/xhtml" '
          +      'style="font-size:' + fontSize + ';color:' + color + ';line-height:1.2;padding:' + pad + 'px;box-sizing:border-box;">'
          + html
          + '</div></foreignObject></svg>';
        var b64;
        try { b64 = btoa(unescape(encodeURIComponent(svg))); }
        catch (_) { return resolve(null); }
        var url = 'data:image/svg+xml;base64,' + b64;
        var img = new Image();
        img.onload = function () {
          try {
            var canvas = document.createElement('canvas');
            canvas.width = w * s; canvas.height = h * s;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w * s, h * s);
            resolve({ dataUrl: canvas.toDataURL('image/png'), width: w, height: h, dpr: s });
          } catch (_) { resolve(null); }
        };
        img.onerror = function () { resolve(null); };
        img.src = url;
      });
    });
  }

  S.getMathImages = function () {
    var rendered = document.getElementById('_sd_rendered');
    if (!rendered) return Promise.resolve([]);
    var nodes = rendered.querySelectorAll('.sdocs-math-display, .sdocs-math-inline');
    var jobs = Array.prototype.map.call(nodes, function (el) {
      var kind = el.classList.contains('sdocs-math-display') ? 'display' : 'inline';
      return rasterizeMathEl(el, 2)
        .then(function (res) {
          return {
            el: el,
            kind: kind,
            tex: el.getAttribute('data-tex') || '',
            dataUrl: res ? res.dataUrl : null,
            width: res ? res.width : 0,
            height: res ? res.height : 0,
          };
        })
        .catch(function () {
          return { el: el, kind: kind, tex: el.getAttribute('data-tex') || '', dataUrl: null, width: 0, height: 0 };
        });
    });
    return Promise.all(jobs);
  };
})();
