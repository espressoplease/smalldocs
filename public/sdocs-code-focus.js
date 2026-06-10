// sdocs-code-focus.js - fullscreen view for a code block.
//
// Mirrors sdocs-mermaid-focus.js: each code block carries a small expand button
// (added in sdocs-app.js). Clicking it clones the block's <pre> into a
// full-screen surface whose background IS the code background, with its own
// toolbar (brand + filename, copy, wrap, close). A whole opened source file
// (`sdoc app.rb`) lands here automatically on load.
//
// The token colours come from the broadened `.hljs-*` rules in rendered.css
// (scoped to :is(#_sd_rendered, .sdoc-code-focus)); this module only forwards a
// few base vars so the cloned code reads with the same font/colour, then runs
// the highlighter on the clone so the overlay is self-sufficient regardless of
// whether the inline block had finished highlighting.
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
    // Stage: a scroll container holding a centered, readable code column.
    '.sdoc-code-focus-stage { overflow: auto; }',
    // Match the inline code width (~660px) so a block is the same width whether
    // it sits in the document or is expanded - popping out strips the document
    // chrome, not the code measure. Narrow screens add padding back so code
    // never touches the edge.
    '.sdoc-code-focus-doc {',
    '  max-width: 660px; margin: 0 auto; padding: 22px 0 64px;',
    '  box-sizing: border-box;',
    '}',
    '.sdoc-code-focus-doc pre {',
    '  margin: 0; background: transparent; border: 0; padding: 0;',
    '  overflow: visible; white-space: pre;',
    '}',
    '.sdoc-code-focus-doc pre code {',
    '  font-family: var(--md-code-font, ui-monospace, monospace);',
    '  color: var(--md-code-color, inherit);',
    '  font-size: 13.5px; line-height: 1.65; white-space: inherit;',
    '}',
    '.sdoc-code-focus-doc pre.wrapped, .sdoc-code-focus-doc pre.wrapped code {',
    '  white-space: pre-wrap; word-break: break-word;',
    '}',
    // Below the column width, restore horizontal padding so code keeps a
    // margin from the screen edge.
    '@media (max-width: 660px) {',
    '  .sdoc-code-focus-doc { padding-left: 20px; padding-right: 20px; }',
    '}',
    '@media (max-width: 540px) {',
    '  .sdoc-code-focus-brand-full { display: none; }',
    '  .sdoc-code-focus-brand-short { display: inline; }',
    '  .sdoc-code-focus-doc { padding-left: 18px; padding-right: 18px; padding-bottom: 48px; }',
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

  function basename(p) {
    return String(p || '').split(/[\\/]/).pop();
  }
  function isTransparent(c) {
    if (!c) return true;
    c = String(c).replace(/\s+/g, '');
    return c === 'transparent' || c === 'rgba(0,0,0,0)';
  }

  // The title shown in the toolbar: the filename for a whole opened file, the
  // language label for a block inside a prose document, else nothing.
  function titleFor(codeEl) {
    var name = (S.currentMeta && S.currentMeta.file)
      || (S.localMeta && basename(S.localMeta.fullPath));
    if (name && S.wholeFileCodeLang && S.wholeFileCodeLang(S.currentBody)) return name;
    var m = (codeEl && codeEl.className || '').match(/language-([\w+#-]+)/i);
    return m ? m[1] : '';
  }

  var modal = null, stageEl = null, preEl = null, prevFocus = null, keyHandler = null;

  function open(sourcePre) {
    if (modal) close();
    if (!sourcePre) return;
    var srcCode = sourcePre.querySelector('code');
    if (!srcCode) return;
    prevFocus = document.activeElement;

    modal = document.createElement('div');
    modal.className = 'sdoc-code-focus';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Code fullscreen view');

    // Forward the code surface vars so the overlay reads like the block, just
    // bigger. The .hljs token colours come from rendered.css (which declares
    // --hl-* on .sdoc-code-focus too), so only the base font/colour/bg here.
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
      +   '<button type="button" class="sdoc-code-focus-btn" data-act="wrap" title="Toggle soft wrap" aria-label="Toggle soft wrap">' + WRAP_ICON + '</button>'
      +   '<span class="sdoc-code-focus-sep" aria-hidden="true"></span>'
      +   '<button type="button" class="sdoc-code-focus-btn" data-act="close" title="Close (Esc)" aria-label="Close">' + X_ICON + '</button>'
      + '</div>';
    if (name) topbar.querySelector('.sdoc-code-focus-name').textContent = name;

    stageEl = document.createElement('div');
    stageEl.className = 'sdoc-code-focus-stage';
    var doc = document.createElement('div');
    doc.className = 'sdoc-code-focus-doc';
    preEl = sourcePre.cloneNode(true);
    // The clone may carry inline copy/wrap/expand buttons - strip them.
    preEl.className = preEl.className.replace(/\bwrapped\b/, '').trim();
    doc.appendChild(preEl);
    stageEl.appendChild(doc);

    modal.appendChild(topbar);
    modal.appendChild(stageEl);
    document.body.appendChild(modal);
    document.body.classList.add('sdoc-code-focus-open');

    // Make the overlay self-sufficient: if the clone isn't highlighted yet
    // (inline highlight may still be loading from the CDN), highlight it here.
    var clonedCode = preEl.querySelector('code');
    if (clonedCode && !clonedCode.dataset.hlDone && S.processHighlight) {
      S.processHighlight(doc);
    }

    topbar.addEventListener('click', onTopbarClick);
    keyHandler = onKey;
    window.addEventListener('keydown', keyHandler);

    var closeBtn = topbar.querySelector('[data-act="close"]');
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    if (!modal) return;
    if (keyHandler) window.removeEventListener('keydown', keyHandler);
    keyHandler = null;
    modal.remove();
    modal = null; stageEl = null; preEl = null;
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
      if (!preEl) return;
      var on = preEl.classList.toggle('wrapped');
      btn.classList.toggle('active', on);
      return;
    }
    if (act === 'copy') {
      var code = preEl && preEl.querySelector('code');
      var text = code ? code.textContent : '';
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () { flashCopy(btn); });
      }
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
