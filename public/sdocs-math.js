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
      function maybeDone() { if (cssDone && jsDone) resolve(window.katex); }

      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = KATEX_CSS;
      link.onload = function () { cssDone = true; maybeDone(); };
      link.onerror = function () { reject(new Error('katex css load failed')); };
      document.head.appendChild(link);

      var script = document.createElement('script');
      script.src = KATEX_JS;
      script.async = true;
      script.onload = function () { jsDone = true; maybeDone(); };
      script.onerror = function () { reject(new Error('katex js load failed')); };
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
            var i = src.indexOf('$$');
            return i < 0 ? undefined : i;
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
})();
