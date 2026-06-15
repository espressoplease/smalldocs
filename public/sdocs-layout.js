// sdocs-layout.js — colon-fenced layout containers for markdown.
//
// Adds `:::grid`, `:::col`, `:::card`, `:::row` containers that arrange
// ordinary markdown side by side. A container wraps nested markdown — including
// other fenced blocks (charts, cells, slides, mermaid) — so anything that
// renders in a normal document renders inside a column too.
//
//   :::grid cols=3
//   :::card
//   ## Diagrams
//   ```mermaid …```
//   :::
//   :::card
//   ## Sheets
//   ```cells …```
//   :::
//   :::
//
// It registers a marked block extension. The tokenizer recursively lexes the
// container body, so the produced HTML is plain `<div class="sdoc-grid">` /
// `<div class="sdoc-col">` wrappers around fully-parsed children. The DOM
// post-processors (charts/cells/mermaid/slides) walk the whole rendered tree,
// so blocks inside a column are picked up with no extra wiring.
//
// Shared with Node tests via the UMD pattern. In the browser it registers on
// the global `marked`; in Node it exports the pure helpers so the scanner and
// attribute parser can be unit-tested, and `register(marked)` lets a test wire
// the extension onto a required copy of marked.

(function (exports) {
  'use strict';

  // Container names we own. `grid`/`row` are the arranging parents; `col`/`card`
  // are the cells. `card` is a `col` with a visible surface (border + padding).
  var CONTAINER_NAMES = { grid: 1, row: 1, col: 1, card: 1 };
  var PARENT_NAMES = { grid: 1, row: 1 };

  // Parse the attribute tail of an opening line ("cols=3 gap=lg") into a small
  // allowlisted object. Anything not recognised is dropped — values reach the
  // HTML as `data-*` attributes, so they are kept strict on purpose.
  function parseAttrs(tail) {
    var out = {};
    if (!tail) return out;
    var re = /([a-zA-Z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/g;
    var m;
    while ((m = re.exec(tail)) !== null) {
      var k = m[1].toLowerCase();
      var v = m[2].replace(/^["']|["']$/g, '');
      if (k === 'cols' || k === 'span') {
        if (/^\d{1,2}$/.test(v) && +v >= 1 && +v <= 12) out[k] = String(+v);
      } else if (k === 'gap') {
        if (/^(none|xs|sm|md|lg|xl)$/.test(v)) out.gap = v;
      } else if (k === 'align') {
        if (/^(start|center|end|stretch)$/.test(v)) out.align = v;
      }
    }
    return out;
  }

  var OPEN_RE = /^:::+[ \t]*([A-Za-z][\w-]*)[ \t]*([^\n]*)(?:\n|$)/;
  var CLOSE_RE = /^:::+[ \t]*$/;
  var OPEN_LINE_RE = /^:::+[ \t]*[A-Za-z]/;
  var FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})/;

  // Given markdown that begins with a `:::name` opening line, find the matching
  // close and return { name, attrs, inner, raw }. Returns null if `src` does not
  // open a container we own, or if the container is never closed.
  //
  // The scan is line-based and fence-aware: `:::` lines inside a ``` or ~~~ code
  // fence are ignored, so a colon line that is really fenced sample text (or a
  // closing slide/cells fence) never miscounts the container depth.
  function scanContainer(src) {
    var open = OPEN_RE.exec(src);
    if (!open) return null;
    var name = open[1].toLowerCase();
    if (!CONTAINER_NAMES[name]) return null;

    var innerStart = open[0].length;
    var pos = innerStart;
    var depth = 1;
    var fenceChar = null;
    var fenceLen = 0;
    var innerEnd = -1;
    var rawEnd = -1;

    while (pos < src.length) {
      var nl = src.indexOf('\n', pos);
      var lineEnd = nl === -1 ? src.length : nl + 1;
      var line = src.slice(pos, nl === -1 ? src.length : nl);

      if (fenceChar) {
        // Inside a code fence: only a matching closing fence ends it.
        var closeFence = new RegExp('^[ \\t]*\\' + fenceChar + '{' + fenceLen + ',}[ \\t]*$');
        if (closeFence.test(line)) { fenceChar = null; fenceLen = 0; }
      } else {
        var fm = FENCE_OPEN_RE.exec(line);
        if (fm) {
          fenceChar = fm[1].charAt(0);
          fenceLen = fm[1].length;
        } else if (CLOSE_RE.test(line)) {
          depth--;
          if (depth === 0) { innerEnd = pos; rawEnd = lineEnd; break; }
        } else if (OPEN_LINE_RE.test(line)) {
          depth++;
        }
      }
      pos = lineEnd;
    }

    if (depth !== 0 || innerEnd < 0) return null; // unterminated → not our token
    return {
      name: name,
      attrs: parseAttrs(open[2] || ''),
      inner: src.slice(innerStart, innerEnd),
      raw: src.slice(0, rawEnd),
    };
  }

  function attrString(attrs) {
    var s = '';
    if (attrs.cols) s += ' data-cols="' + attrs.cols + '"';
    if (attrs.gap) s += ' data-gap="' + attrs.gap + '"';
    if (attrs.align) s += ' data-align="' + attrs.align + '"';
    if (attrs.span) s += ' data-span="' + attrs.span + '"';
    return s;
  }

  // Register the marked block extension. Idempotent. `markedRef` defaults to the
  // global `marked` in the browser; tests pass their own required copy.
  function register(markedRef) {
    var M = markedRef || (typeof marked !== 'undefined' ? marked : null);
    if (!M || !M.use) return;
    if (register._done) return;
    register._done = true;

    M.use({
      extensions: [
        {
          name: 'sdocsContainer',
          level: 'block',
          start: function (src) {
            var m = /(?:^|\n):::+[ \t]*[A-Za-z]/.exec(src);
            if (!m) return undefined;
            return m.index + (src.charAt(m.index) === '\n' ? 1 : 0);
          },
          tokenizer: function (src) {
            var c = scanContainer(src);
            if (!c) return undefined;
            var token = {
              type: 'sdocsContainer',
              raw: c.raw,
              container: c.name,
              attrs: c.attrs,
              tokens: [],
            };
            // Recursively lex the body so nested containers and fenced blocks
            // become ordinary tokens the renderer can parse.
            this.lexer.blockTokens(c.inner, token.tokens);
            return token;
          },
          renderer: function (token) {
            var inner = this.parser.parse(token.tokens);
            if (PARENT_NAMES[token.container]) {
              return '<div class="sdoc-grid"' + attrString(token.attrs) + '>\n' + inner + '</div>\n';
            }
            var cls = token.container === 'card' ? 'sdoc-col sdoc-card' : 'sdoc-col';
            var span = token.attrs.span ? ' data-span="' + token.attrs.span + '"' : '';
            return '<div class="' + cls + '"' + span + '>\n' + inner + '</div>\n';
          },
        },
      ],
    });
  }

  // One-shot CSS injection so any page that loads this script gets the layout
  // styles without a separate stylesheet wiring step (mirrors the shape
  // renderer's approach). Variables fall back to sensible defaults so the grid
  // styles work even on a page that doesn't define the full token set.
  var CSS_ID = 'sdocs-layout-css';
  var CSS = [
    '.sdoc-grid{display:grid;gap:var(--sdoc-grid-gap,1.25rem);grid-template-columns:repeat(auto-fit,minmax(240px,1fr));align-items:start;margin:1.25rem 0;}',
    '.sdoc-grid[data-cols="1"]{grid-template-columns:1fr;}',
    '.sdoc-grid[data-cols="2"]{grid-template-columns:repeat(2,minmax(0,1fr));}',
    '.sdoc-grid[data-cols="3"]{grid-template-columns:repeat(3,minmax(0,1fr));}',
    '.sdoc-grid[data-cols="4"]{grid-template-columns:repeat(4,minmax(0,1fr));}',
    '.sdoc-grid[data-cols="5"]{grid-template-columns:repeat(5,minmax(0,1fr));}',
    '.sdoc-grid[data-cols="6"]{grid-template-columns:repeat(6,minmax(0,1fr));}',
    '.sdoc-grid[data-gap="none"]{--sdoc-grid-gap:0;}',
    '.sdoc-grid[data-gap="xs"]{--sdoc-grid-gap:.5rem;}',
    '.sdoc-grid[data-gap="sm"]{--sdoc-grid-gap:.75rem;}',
    '.sdoc-grid[data-gap="md"]{--sdoc-grid-gap:1.25rem;}',
    '.sdoc-grid[data-gap="lg"]{--sdoc-grid-gap:2rem;}',
    '.sdoc-grid[data-gap="xl"]{--sdoc-grid-gap:3rem;}',
    '.sdoc-grid[data-align="center"]{align-items:center;}',
    '.sdoc-grid[data-align="end"]{align-items:end;}',
    '.sdoc-grid[data-align="stretch"]{align-items:stretch;}',
    // min-width:0 lets grid children shrink instead of forcing overflow — the
    // same fix wide content (long code lines, sheets) needs everywhere.
    '.sdoc-col{min-width:0;}',
    '.sdoc-col[data-span="2"]{grid-column:span 2;}',
    '.sdoc-col[data-span="3"]{grid-column:span 3;}',
    '.sdoc-col[data-span="4"]{grid-column:span 4;}',
    '.sdoc-col > :first-child{margin-top:0;}',
    '.sdoc-col > :last-child{margin-bottom:0;}',
    '.sdoc-card{border:1px solid var(--md-hr-color,rgba(128,128,128,.25));border-radius:12px;padding:1.25rem 1.35rem;background:var(--md-card-bg,rgba(128,128,128,.04));}',
    // Stack everything on narrow screens regardless of the requested column
    // count, so a 3-up grid never forces a horizontal scroll on a phone.
    '@media (max-width:640px){.sdoc-grid[data-cols]{grid-template-columns:1fr;}}',
  ].join('\n');

  function injectCss(doc) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || d.getElementById(CSS_ID)) return;
    var style = d.createElement('style');
    style.id = CSS_ID;
    style.textContent = CSS;
    (d.head || d.documentElement).appendChild(style);
  }

  // Browser: register the extension and inject CSS as soon as the script runs.
  if (typeof marked !== 'undefined' && marked.use) register(marked);
  if (typeof document !== 'undefined') injectCss();

  exports.parseAttrs = parseAttrs;
  exports.scanContainer = scanContainer;
  exports.attrString = attrString;
  exports.register = register;
  exports.injectCss = injectCss;
  exports.CSS = CSS;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocLayout = {}));
