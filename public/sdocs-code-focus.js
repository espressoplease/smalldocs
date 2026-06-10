// sdocs-code-focus.js - fullscreen view for a code block.
//
// Mirrors sdocs-mermaid-focus.js: each code block carries a small expand button
// (added in sdocs-app.js). Clicking it opens a full-screen surface whose
// background IS the code background, with its own toolbar (brand + filename,
// copy, wrap, close). A whole opened source file (`sdoc app.rb`) lands here
// automatically on load.
//
// The view shows a line-number gutter and SOFT-WRAPS long lines by default.
// Those two go together: when a long line wraps, only its first visual row
// carries a number, so the reader can tell a wrapped line is still one logical
// line. The gutter and wrap live only here, not on the inline block.
//
// Each source line is its own row (number cell + code cell, top-aligned), so a
// wrapped line grows downward while its number stays put. Highlight token
// colours come from the broadened `.hljs-*` rules in rendered.css (scoped to
// :is(#_sd_rendered, .sdoc-code-focus)); the code is highlighted in a detached
// element so the overlay is self-sufficient even if the inline block has not
// finished loading highlight.js from the CDN.
(function () {
  'use strict';
  var S = window.SDocs;
  if (!S) return;

  var CSS_ID = 'sdocs-code-focus-css';
  var CSS = [
    '.sdoc-code-focus {',
    '  position: fixed; inset: 0; z-index: 10100;',
    '  background: var(--sdoc-focus-bg, #f4f1ed);',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '  display: grid; grid-template-rows: 40px 1fr;',
    '  font-family: ui-sans-serif, system-ui, sans-serif;',
    '  animation: sdoc-code-fade .15s ease-out;',
    '}',
    '@keyframes sdoc-code-fade { from { opacity: 0 } to { opacity: 1 } }',
    '.sdoc-code-focus-topbar {',
    '  position: relative;',
    '  display: flex; align-items: center; gap: 2px;',
    '  height: 40px; padding: 0 12px;',
    '  background: color-mix(in oklab, var(--sdoc-focus-bg, #f4f1ed) 88%, var(--sdoc-focus-fg, #1c1917) 12%);',
    '  border-bottom: 1px solid color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 14%, transparent);',
    '}',
    '.sdoc-code-focus-brand {',
    '  display: inline-flex; align-items: baseline; min-width: 0;',
    '  color: #3B82F6; font-size: 13px; font-weight: 600;',
    '  margin-right: auto;',
    '}',
    '.sdoc-code-focus-brand-text { display: none; }',
    '.sdoc-code-focus-brand-full { display: inline; }',
    '.sdoc-code-focus-name {',
    '  color: var(--sdoc-focus-fg, #1c1917); font-weight: 500;',
    '  font-family: var(--md-code-font, ui-monospace, monospace);',
    '  font-size: 12px; margin-left: 8px;',
    '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
    '}',
    '.sdoc-code-focus-actions { display: flex; gap: 2px; align-items: center; flex-shrink: 0; }',
    '.sdoc-code-focus-sep {',
    '  width: 1px; height: 16px; flex-shrink: 0;',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 18%, transparent);',
    '}',
    '.sdoc-code-focus-btn {',
    '  all: unset; cursor: pointer;',
    '  display: inline-flex; align-items: center; justify-content: center;',
    '  padding: 6px 8px; border-radius: 4px;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 75%, transparent);',
    '  font-size: 12px; font-family: inherit;',
    '  transition: background .12s, color .12s;',
    '}',
    '.sdoc-code-focus-btn:hover {',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 8%, transparent);',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '}',
    '.sdoc-code-focus-btn.active {',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 12%, transparent);',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '}',
    '.sdoc-code-focus-btn:focus-visible { outline: 1px solid #3B82F6; outline-offset: 1px; }',
    '.sdoc-code-focus-action {',
    '  all: unset; cursor: pointer;',
    '  display: inline-flex; align-items: center; gap: 5px;',
    '  padding: 4px 9px; border-radius: 4px;',
    '  border: 1px solid color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 18%, transparent);',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 75%, transparent);',
    '  font-size: 11.5px; font-weight: 500; font-family: inherit;',
    '  transition: background .12s, color .12s, border-color .12s;',
    '}',
    '.sdoc-code-focus-action:hover {',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 8%, transparent);',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '  border-color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 32%, transparent);',
    '}',
    '.sdoc-code-focus-action svg { flex-shrink: 0; }',
    // Stage: scroll container holding the code column.
    '.sdoc-code-focus-stage { overflow: auto; }',
    // Wrapped (default): a 660px column - same width the block has inline - so a
    // block is the same measure whether inline or expanded. Not wrapped: the
    // column goes full width so long lines scroll horizontally.
    '.sdoc-code-focus-doc {',
    '  margin: 0 auto; padding: 22px 0 64px; box-sizing: border-box;',
    '  font-family: var(--md-code-font, ui-monospace, monospace);',
    '  color: var(--md-code-color, inherit);',
    '  font-size: 13.5px; line-height: 1.65;',
    '  --sdoc-ln-w: 2ch;',
    '}',
    '.sdoc-code-focus-doc.wrapped { max-width: 660px; }',
    '.sdoc-code-focus-doc:not(.wrapped) { max-width: none; padding-left: 22px; padding-right: 22px; }',
    '@media (max-width: 660px) {',
    '  .sdoc-code-focus-doc.wrapped { padding-left: 20px; padding-right: 20px; }',
    '}',
    // One row per logical source line. Number cell stays at the top of the row
    // (align-items: flex-start) so a wrapped line keeps its number aligned to
    // its first visual line.
    '.sdoc-cl-row { display: flex; align-items: flex-start; }',
    '.sdoc-code-focus-doc:not(.wrapped) .sdoc-cl-row { min-width: max-content; }',
    '.sdoc-cl-num {',
    '  flex: 0 0 auto; width: var(--sdoc-ln-w); box-sizing: content-box;',
    '  padding-right: 20px; text-align: right;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 36%, transparent);',
    '  user-select: none; -webkit-user-select: none;',
    '  position: sticky; left: 0; background: var(--sdoc-focus-bg, #f4f1ed);',
    '}',
    '.sdoc-cl-code { white-space: pre; }',
    '.sdoc-code-focus-doc.wrapped .sdoc-cl-code {',
    '  white-space: pre-wrap; word-break: break-word; flex: 1 1 auto; min-width: 0;',
    '}',
    '@media (max-width: 540px) {',
    '  .sdoc-code-focus-brand-full { display: none; }',
    '  .sdoc-code-focus-brand-short { display: inline; }',
    '}',
    'body.sdoc-code-focus-open { overflow: hidden; }'
  ].join('\n');

  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var style = document.createElement('style');
    style.id = CSS_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  if (typeof document !== 'undefined') injectCSS();

  function lucide(paths, size) {
    var s = size || 14;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" '
      + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
      + 'stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }
  var COPY_ICON = lucide('<rect x="9" y="9" width="13" height="13" rx="2"/>'
    + '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', 13);
  var WRAP_ICON = lucide('<path d="M3 6h18"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/>'
    + '<path d="m16 16-2 2 2 2"/><path d="M3 18h7"/>');
  var X_ICON = lucide('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');

  function basename(p) { return String(p || '').split(/[\\/]/).pop(); }
  function isTransparent(c) {
    if (!c) return true;
    c = String(c).replace(/\s+/g, '');
    return c === 'transparent' || c === 'rgba(0,0,0,0)';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
    });
  }

  // Split highlight.js output into per-line HTML, re-balancing spans so a token
  // that spans newlines (multiline string / comment) stays valid on each line:
  // close still-open spans at the line end, re-open them at the next line start.
  function splitHighlightedLines(html) {
    var lines = String(html).split('\n');
    var out = [];
    var open = []; // stack of opening <span ...> tag strings still in effect
    for (var i = 0; i < lines.length; i++) {
      var prefix = open.join('');
      var re = /<span\b[^>]*>|<\/span>/g, m;
      while ((m = re.exec(lines[i]))) {
        if (m[0] === '</span>') open.pop(); else open.push(m[0]);
      }
      out.push(prefix + lines[i] + new Array(open.length + 1).join('</span>'));
    }
    return out;
  }

  // The title in the toolbar: the filename for a whole opened file, the language
  // label for a block inside a prose document, else nothing.
  function titleFor(codeEl) {
    var name = (S.currentMeta && S.currentMeta.file)
      || (S.localMeta && basename(S.localMeta.fullPath));
    if (name && S.wholeFileCodeLang && S.wholeFileCodeLang(S.currentBody)) return name;
    var m = (codeEl && codeEl.className || '').match(/language-([\w+#-]+)/i);
    return m ? m[1] : '';
  }

  var modal = null, docEl = null, linesEl = null, rawText = '', prevFocus = null, keyHandler = null;

  function renderRows(lineParts) {
    if (!linesEl) return;
    var digits = String(lineParts.length).length;
    docEl.style.setProperty('--sdoc-ln-w', digits + 'ch');
    var html = '';
    for (var i = 0; i < lineParts.length; i++) {
      html += '<div class="sdoc-cl-row"><span class="sdoc-cl-num">' + (i + 1)
        + '</span><span class="sdoc-cl-code">' + lineParts[i] + '</span></div>';
    }
    linesEl.innerHTML = html;
  }

  function open(sourcePre) {
    if (modal) close();
    if (!sourcePre) return;
    var srcCode = sourcePre.querySelector('code');
    if (!srcCode) return;
    rawText = srcCode.textContent || '';
    prevFocus = document.activeElement;

    modal = document.createElement('div');
    modal.className = 'sdoc-code-focus';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Code fullscreen view');

    // Forward the code surface vars so the overlay reads like the block, bigger.
    var rendered = document.getElementById('_sd_rendered');
    var cs = rendered ? getComputedStyle(rendered) : null;
    if (cs) {
      var preBg = cs.getPropertyValue('--md-pre-bg').trim();
      if (isTransparent(preBg)) preBg = '';
      var fg = cs.getPropertyValue('--md-color').trim() || cs.color;
      var codeFont = cs.getPropertyValue('--md-code-font').trim();
      var codeColor = cs.getPropertyValue('--md-code-color').trim();
      if (preBg) modal.style.setProperty('--sdoc-focus-bg', preBg);
      if (fg) modal.style.setProperty('--sdoc-focus-fg', fg);
      if (codeFont) modal.style.setProperty('--md-code-font', codeFont);
      if (codeColor) modal.style.setProperty('--md-code-color', codeColor);
    }

    var name = titleFor(srcCode);
    var topbar = document.createElement('div');
    topbar.className = 'sdoc-code-focus-topbar';
    topbar.innerHTML =
      '<span class="sdoc-code-focus-brand">'
      +   '<span class="sdoc-code-focus-brand-text sdoc-code-focus-brand-full">SmallDocs</span>'
      +   '<span class="sdoc-code-focus-brand-text sdoc-code-focus-brand-short">SD</span>'
      +   (name ? '<span class="sdoc-code-focus-name"></span>' : '')
      + '</span>'
      + '<div class="sdoc-code-focus-actions">'
      +   '<button type="button" class="sdoc-code-focus-action" data-act="copy" title="Copy code" aria-label="Copy code">'
      +     COPY_ICON + '<span class="sdoc-code-focus-action-label">Copy</span>'
      +   '</button>'
      +   '<button type="button" class="sdoc-code-focus-btn active" data-act="wrap" title="Toggle soft wrap" aria-label="Toggle soft wrap" aria-pressed="true">' + WRAP_ICON + '</button>'
      +   '<span class="sdoc-code-focus-sep" aria-hidden="true"></span>'
      +   '<button type="button" class="sdoc-code-focus-btn" data-act="close" title="Close (Esc)" aria-label="Close">' + X_ICON + '</button>'
      + '</div>';
    if (name) topbar.querySelector('.sdoc-code-focus-name').textContent = name;

    var stage = document.createElement('div');
    stage.className = 'sdoc-code-focus-stage';
    docEl = document.createElement('div');
    docEl.className = 'sdoc-code-focus-doc wrapped'; // wrap on by default
    linesEl = document.createElement('div');
    linesEl.className = 'sdoc-code-focus-lines';
    docEl.appendChild(linesEl);
    stage.appendChild(docEl);

    // Show plain numbered lines immediately; upgrade to highlighted once ready.
    renderRows(escapeHtml(rawText).split('\n'));

    modal.appendChild(topbar);
    modal.appendChild(stage);
    document.body.appendChild(modal);
    document.body.classList.add('sdoc-code-focus-open');

    highlightThenRender(srcCode.className || '');

    topbar.addEventListener('click', onTopbarClick);
    keyHandler = onKey;
    window.addEventListener('keydown', keyHandler);
    var closeBtn = topbar.querySelector('[data-act="close"]');
    if (closeBtn) closeBtn.focus();
  }

  // Highlight the source in a detached element, then re-render the rows with the
  // coloured HTML. No-ops (keeps the plain rows) if there's no language or the
  // highlighter isn't available.
  function highlightThenRender(className) {
    if (!S.processHighlight || className.indexOf('language-') < 0) return;
    var holder = document.createElement('div');
    var pre = document.createElement('pre');
    var code = document.createElement('code');
    code.className = className;
    code.textContent = rawText;
    pre.appendChild(code); holder.appendChild(pre);
    var token = linesEl;
    Promise.resolve(S.processHighlight(holder)).then(function () {
      if (linesEl !== token) return; // overlay closed/reopened meanwhile
      var hl = code.innerHTML;
      if (hl && hl.indexOf('<span') >= 0) renderRows(splitHighlightedLines(hl));
    });
  }

  function close() {
    if (!modal) return;
    if (keyHandler) window.removeEventListener('keydown', keyHandler);
    keyHandler = null;
    modal.remove();
    modal = null; docEl = null; linesEl = null; rawText = '';
    document.body.classList.remove('sdoc-code-focus-open');
    if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (_) {} }
    prevFocus = null;
  }

  function onTopbarClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.dataset.act;
    if (act === 'close') { close(); return; }
    if (act === 'wrap') {
      if (!docEl) return;
      var on = docEl.classList.toggle('wrapped');
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      return;
    }
    if (act === 'copy' && navigator.clipboard) {
      navigator.clipboard.writeText(rawText).then(function () { flashCopy(btn); });
    }
  }

  function flashCopy(btn) {
    var label = btn.querySelector('.sdoc-code-focus-action-label');
    if (!label) return;
    var prev = label.textContent;
    label.textContent = 'Copied';
    setTimeout(function () { if (label) label.textContent = prev; }, 1500);
  }

  function onKey(e) {
    if (!modal) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  S.codeFocus = { open: open, close: close };
})();
