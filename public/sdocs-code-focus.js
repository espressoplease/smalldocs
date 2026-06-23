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

  // This file's own ?v= cache-busting query, reused on lazily loaded language
  // definition files so they bust on the same deploy boundary as everything else.
  var SELF_V = (document.currentScript && (document.currentScript.src.split('?')[1] || '')) || '';

  // Map a highlight.js language name (or common alias) to the structural
  // definition file under public/sdocs-code-lang/. Languages absent here fall
  // back to the plain indentation outline (every member kept on collapse).
  var STRUCT_LANG = {
    ruby: 'ruby', rb: 'ruby',
    python: 'python', py: 'python',
    javascript: 'javascript', js: 'javascript', jsx: 'javascript', node: 'javascript',
    typescript: 'typescript', ts: 'typescript', tsx: 'typescript',
    go: 'go', golang: 'go',
    rust: 'rust', rs: 'rust',
    java: 'java',
    elixir: 'elixir', ex: 'elixir', exs: 'elixir',
    csharp: 'csharp', cs: 'csharp', 'c#': 'csharp',
    php: 'php'
  };

  var langCache = {}; // file key -> Promise<defn|null>

  // Lazy-load a language's structural definitions, once per file key. Resolves
  // to the definition object (with a `structural` array of RegExp) or null.
  function loadStructural(lang) {
    var key = STRUCT_LANG[String(lang || '').toLowerCase()];
    if (!key) return Promise.resolve(null);
    var bank = (window.SDocsCodeLang || {});
    if (bank[key]) return Promise.resolve(bank[key]);
    if (langCache[key]) return langCache[key];
    langCache[key] = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = '/public/sdocs-code-lang/' + key + '.js' + (SELF_V ? '?' + SELF_V : '');
      s.onload = function () { resolve((window.SDocsCodeLang || {})[key] || null); };
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
    });
    return langCache[key];
  }

  var CSS_ID = 'sdocs-code-focus-css';
  var CSS = [
    '.sdoc-code-focus {',
    '  position: fixed; inset: 0; z-index: 10100;',
    '  background: var(--sdoc-focus-bg, #f4f1ed);',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    // The comment accent: the colour new notes (and their affordances) take.
    // Defaults to the same amber as the markdown reader, overridden inline from
    // the reader\'s saved colour pref so the whole comment language is one colour.
    '  --sdoc-cc-accent: #ffbb00;',
    '  display: grid; grid-template-rows: 40px auto 1fr;',
    '  font-family: ui-sans-serif, system-ui, sans-serif;',
    '  animation: sdoc-code-fade .15s ease-out;',
    '}',
    '@keyframes sdoc-code-fade { from { opacity: 0 } to { opacity: 1 } }',
    // Three-column grid, the same shape the markdown reader toolbar uses: equal
    // flexible side columns keep the middle cluster centred with no JS. Brand
    // (logo only) sits at the left, the X at the right, controls in the centre.
    '.sdoc-code-focus-topbar {',
    '  position: relative;',
    '  display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr);',
    '  align-items: center; gap: 6px;',
    '  height: 40px; padding: 0 12px;',
    '  background: color-mix(in oklab, var(--sdoc-focus-bg, #f4f1ed) 88%, var(--sdoc-focus-fg, #1c1917) 12%);',
    '  border-bottom: 1px solid color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 14%, transparent);',
    '}',
    '.sdoc-code-focus-brand {',
    '  justify-self: start;',
    '  display: inline-flex; align-items: baseline; min-width: 0;',
    '  color: #3B82F6; font-size: 13px; font-weight: 600;',
    '}',
    '.sdoc-code-focus-brand-text { display: none; }',
    '.sdoc-code-focus-brand-full { display: inline; }',
    '.sdoc-code-focus-center {',
    '  justify-self: center;',
    '  display: inline-flex; align-items: center; gap: 3px;',
    '}',
    '.sdoc-code-focus-actions { justify-self: end; display: flex; gap: 2px; align-items: center; }',
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
    '.sdoc-code-focus-btn .sdoc-icon-fold { display: none; }',
    '.sdoc-code-focus-btn.is-open .sdoc-icon-unfold { display: none; }',
    '.sdoc-code-focus-btn.is-open .sdoc-icon-fold { display: inline-flex; }',
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
    // Comment sub-bar: a second toolbar row under the topbar, present only in
    // comment mode. Slides in like the markdown reader comment toolbar.
    '.sdoc-cc-subbar {',
    '  display: flex; align-items: center; justify-content: center; gap: 10px;',
    '  height: 0; min-height: 0; opacity: 0; overflow: hidden; padding: 0 12px;',
    '  background: var(--sdoc-focus-bg, #f4f1ed); border-bottom: 1px solid transparent;',
    '  transition: height .3s cubic-bezier(.4,0,.2,1), opacity .22s ease, border-color .3s ease;',
    '}',
    '.sdoc-code-focus.sdoc-cc-on .sdoc-cc-subbar {',
    '  height: 36px; opacity: 1;',
    '  border-bottom-color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 12%, transparent);',
    '}',
    '.sdoc-cc-subbar-hint {',
    '  font-size: 11.5px; font-family: ui-sans-serif, system-ui, sans-serif;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 50%, transparent);',
    '}',
    // File-info card at the top of the listing: filename + paths, each copyable.
    // Mirrors the markdown reader file-info card (#_sd_sdocs-file-info) exactly:
    // same 12.5px ui font, muted labels, baseline rows with 1px separators, a
    // bottom hairline, and a plain (not bold) value.
    '.sdoc-cf-fileinfo {',
    '  font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12.5px;',
    '  max-width: 660px; margin: 0 auto; padding: 4px 0 24px;',
    '  display: flex; flex-direction: column; gap: 2px;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 40%, transparent);',
    '}',
    '.sdoc-code-focus-doc:not(.wrapped) .sdoc-cf-fileinfo { max-width: none; }',
    // A single hairline under the whole block (the markdown table shows only this
    // one: its per-row borders reference an undefined var and never render).
    '.sdoc-cf-firows {',
    '  display: flex; flex-direction: column;',
    '  border-bottom: 1px solid color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 12%, transparent);',
    '}',
    '.sdoc-cf-firow {',
    '  display: flex; align-items: baseline; gap: 12px; padding: 5px 0; line-height: 1.5;',
    '  cursor: pointer;',
    '}',
    '.sdoc-cf-firow:hover .sdoc-cf-ficopy { color: var(--sdoc-focus-fg, #1c1917); }',
    '.sdoc-cf-filabel {',
    '  flex-shrink: 0; min-width: 58px; font-weight: 500;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 40%, transparent);',
    '}',
    '.sdoc-cf-fival {',
    '  flex: 1; min-width: 0; color: var(--sdoc-focus-fg, #1c1917);',
    '  overflow-wrap: anywhere; word-break: break-word;',
    '}',
    '.sdoc-cf-ficopy {',
    '  all: unset; cursor: pointer; flex-shrink: 0;',
    '  display: inline-flex; align-items: center; justify-content: center;',
    '  width: 20px; height: 20px; border-radius: 4px;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 40%, transparent);',
    '  transition: background .12s, color .12s;',
    '}',
    '.sdoc-cf-ficopy:hover {',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 10%, transparent);',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '}',
    '.sdoc-cf-ficopy svg { display: block; pointer-events: none; }',
    // Summary-view toggle: a standalone disclosure above the code that folds the
    // whole file to its outline (or unfolds it), the same action as the toolbar
    // fold-all button. It speaks the chevron language the rows use - the chevron
    // sits in a 15px column so it lines up under the row fold chevrons / numbers,
    // points right when the file is collapsed to its summary, down when expanded.
    '.sdoc-cf-summary {',
    '  all: unset; cursor: pointer; box-sizing: border-box;',
    '  display: inline-flex; align-items: center; gap: 5px;',
    '  margin: 2px 0 8px; padding: 3px 8px 3px 0; border-radius: 4px;',
    '  font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px; font-weight: 500;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 60%, transparent);',
    '  transition: color .12s, background .12s;',
    '}',
    '.sdoc-cf-summary:hover {',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 6%, transparent);',
    '}',
    // Selected = the file is collapsed to its summary (chevron right). Mirrors
    // the top-menu toggles\' active state: the neutral tint + full-strength text,
    // so the button reads as "on" exactly when the summary is what you\'re seeing.
    '.sdoc-cf-summary:not(.is-open) {',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 12%, transparent);',
    '}',
    '.sdoc-cf-summary:not(.is-open) .sdoc-cf-summary-chev { color: var(--sdoc-focus-fg, #1c1917); }',
    '.sdoc-cf-summary:not(.is-open):hover {',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 16%, transparent);',
    '}',
    '.sdoc-cf-summary:focus-visible { outline: 1px solid #3B82F6; outline-offset: 1px; }',
    '.sdoc-cf-summary-chev {',
    '  flex: 0 0 auto; width: 15px;',
    '  display: inline-flex; align-items: center; justify-content: center;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 50%, transparent);',
    '  transition: transform .15s;',
    '}',
    '.sdoc-cf-summary.is-open .sdoc-cf-summary-chev { transform: rotate(90deg); }',
    '.sdoc-cf-summary-chev svg { display: block; }',
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
    // Full gutter width = fold chevron (15px) + number cell (--sdoc-ln-w plus its
    // 4+16px padding). The "+" add affordance is absolutely positioned, so it adds
    // nothing here. Desktop balances the row with this much padding on the right so
    // the code column re-centres on the page with the numbers hanging in the left
    // margin; tying it to --sdoc-ln-w keeps the balance exact when a long file
    // widens the number cell to 3ch / 4ch.
    '  --sdoc-cf-gutter-w: calc(35px + var(--sdoc-ln-w));',
    '}',
    '.sdoc-code-focus-doc.wrapped { max-width: 660px; }',
    '.sdoc-code-focus-doc:not(.wrapped) { max-width: none; padding-left: 22px; padding-right: 22px; }',
    '@media (max-width: 660px) {',
    '  .sdoc-code-focus-doc.wrapped { padding-left: 20px; padding-right: 20px; }',
    '}',
    // One row per logical source line. The gutter (fold chevron + number) stays
    // at the top of the row (align-items: flex-start) so a wrapped line keeps
    // its number aligned to its first visual line, and is sticky so it survives
    // horizontal scroll in no-wrap mode.
    '.sdoc-cl-row { display: flex; align-items: flex-start; }',
    '.sdoc-code-focus-doc:not(.wrapped) .sdoc-cl-row { min-width: max-content; }',
    '.sdoc-cl-gutter {',
    '  position: sticky; left: 0; flex: 0 0 auto;',
    // Stretch to the whole row height (a soft-wrapped row is several lines tall)
    // so the gutter background fills the number margin top-to-bottom; align-items
    // keeps the number / chevron pinned to the first line. Without the stretch the
    // gutter is one line tall and a row highlight (method select / comment tint)
    // shows through the margin on the wrapped continuation lines.
    '  align-self: stretch; display: inline-flex; align-items: flex-start;',
    '  background: var(--sdoc-focus-bg, #f4f1ed);',
    '  user-select: none; -webkit-user-select: none;',
    '}',
    // Fold control: a chevron on lines that open a deeper block. Hidden until
    // you hover the code, except a collapsed line keeps its chevron visible so
    // you can see what is folded. Rotated down when open, right when collapsed.
    '.sdoc-cl-fold {',
    '  all: unset; box-sizing: border-box;',
    '  width: 15px; flex: 0 0 auto;',
    '  display: inline-flex; align-items: center; justify-content: center;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 45%, transparent);',
    '  cursor: pointer; opacity: 0; transition: opacity .12s, transform .15s, color .12s;',
    '}',
    '.sdoc-cl-fold svg { display: block; }',
    'button.sdoc-cl-fold { transform: rotate(90deg); }',
    '.sdoc-cl-row.collapsed button.sdoc-cl-fold { transform: rotate(0deg); }',
    '.sdoc-code-focus-lines:hover button.sdoc-cl-fold,',
    '.sdoc-cl-row.collapsed button.sdoc-cl-fold { opacity: 1; }',
    'button.sdoc-cl-fold:hover { color: var(--sdoc-focus-fg, #1c1917); }',
    // Copy-section button on a header line, after its code. Mirrors the markdown
    // heading copy-btn exactly: a bare inline icon, permanently visible at rest,
    // full strength on hover (opacity only, no background pill), a tick on success.
    // No padding/radius so it sits at the line\'s height like any inline glyph.
    '.sdoc-cl-copy {',
    '  all: unset; cursor: pointer; vertical-align: middle; line-height: 1;',
    '  display: inline-flex; align-items: center; margin-left: 10px;',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '  opacity: .55; transition: opacity .12s;',
    '}',
    '.sdoc-cl-copy:hover { opacity: 1; }',
    '.sdoc-cl-copy svg { display: block; width: 12px; height: 12px; }',
    // Copy-with-comments on a header whose section carries a note (added in
    // comment mode). Same bare-icon model as the plain copy button and the same
    // grey foreground colour - it reads as the commented twin sitting beside it,
    // not a differently-coloured control. margin-left 4px matches the prose
    // header copy-with-comments companion.
    '.sdoc-cl-copyc {',
    '  all: unset; cursor: pointer; vertical-align: middle; line-height: 1;',
    '  display: inline-flex; align-items: center; gap: 3px; margin-left: 4px;',
    '  font-size: 11.5px; font-weight: 500;',
    '  font-family: ui-sans-serif, system-ui, sans-serif;',
    '  color: var(--sdoc-focus-fg, #1c1917); opacity: .55; transition: opacity .12s;',
    '}',
    '.sdoc-cl-copyc:hover { opacity: 1; }',
    '.sdoc-cl-copyc svg { display: block; width: 12px; height: 12px; }',
    '.sdoc-cl-num {',
    '  flex: 0 0 auto; width: var(--sdoc-ln-w); box-sizing: content-box;',
    '  padding-right: 16px; padding-left: 4px; text-align: right;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 36%, transparent);',
    '}',
    // A collapsed leaf block (a method) marks its hidden body with an ellipsis,
    // the same cue the markdown section collapse uses. A collapsed container (a
    // class) shows its outline instead, so it gets no ellipsis.
    '.sdoc-cl-row.collapsed:not(.fold-container) .sdoc-cl-code::after {',
    '  content: " \\2026"; opacity: 0.55; font-style: normal;',
    '}',
    // A run of non-structural members inside a collapsed container (comments,
    // stray statements) collapses to a single ellipsis row: the gutter keeps its
    // width so the dots line up under the code column, the real code is dropped.
    '.sdoc-cl-row.fold-gap > .sdoc-cl-code { display: none; }',
    '.sdoc-cl-row.fold-gap .sdoc-cl-fold,',
    '.sdoc-cl-row.fold-gap .sdoc-cl-num { visibility: hidden; }',
    '.sdoc-cl-row.fold-gap::after {',
    '  content: "\\2026"; opacity: 0.5;',
    '  padding-left: var(--sdoc-gap-indent, 0);',
    '}',
    '.sdoc-cl-code { white-space: pre; }',
    '.sdoc-code-focus-doc.wrapped .sdoc-cl-code {',
    '  white-space: pre-wrap; word-break: break-word; flex: 1 1 auto; min-width: 0;',
    // padding-left + equal negative text-indent = a hanging indent: the line\'s
    // own leading whitespace lands the first visual line where it always was,
    // while every wrapped continuation starts at --cl-ind instead of column 0.
    // Keeps a wrapped comment (and its tint) aligned under its own text.
    '  padding-left: var(--cl-ind, 0); text-indent: calc(-1 * var(--cl-ind, 0));',
    '}',
    // Desktop only: keep the code measure at 660px (the markdown reader width) but
    // widen the doc by a gutter-width on each side and pad the row by the same on
    // the right. The line-number gutter then hangs in the left margin while the
    // code column (and the file-info card, which already centres at 660px) sits
    // centred on the page - a slightly wider, properly centred listing. Mobile and
    // the narrow wrapped layout below keep the gutter inside the column unchanged.
    '@media (min-width: 768px) {',
    '  .sdoc-code-focus-doc.wrapped { max-width: calc(660px + 2 * var(--sdoc-cf-gutter-w)); }',
    '  .sdoc-code-focus-doc.wrapped .sdoc-cl-row { padding-right: var(--sdoc-cf-gutter-w); }',
    '  .sdoc-code-focus-doc.wrapped .sdoc-cf-summary {',
    '    margin-left: var(--sdoc-cf-gutter-w); margin-right: var(--sdoc-cf-gutter-w);',
    '  }',
    '}',
    '@media (max-width: 540px) {',
    '  .sdoc-code-focus-brand-full { display: none; }',
    '  .sdoc-code-focus-brand-short { display: inline; }',
    '}',
    'body.sdoc-code-focus-open { overflow: hidden; }',

    // ── Comment mode ──────────────────────────────────────────────────────
    // Toolbar comment toggle: a dot marks it when the file already has notes;
    // the active state tints it like the wrap toggle.
    // The active state uses the shared .sdoc-code-focus-btn.active (the same
    // neutral tint the wrap toggle uses), so the two toggles read identically.
    '.sdoc-code-focus-btn[data-act="comment"] { position: relative; }',
    // Match the prose comment-button dot (.btn-with-dot .info-dot): 6px, sat in
    // the corner at 2px/2px with a ring in the toolbar colour so it reads off the
    // glyph rather than crowding it.
    '.sdoc-code-focus-btn[data-act="comment"].has-notes::after {',
    '  content: ""; position: absolute; top: 2px; right: 2px;',
    '  width: 6px; height: 6px; border-radius: 50%; background: var(--sdoc-cc-accent, #ffbb00);',
    '  box-shadow: 0 0 0 1px color-mix(in oklab, var(--sdoc-focus-bg, #f4f1ed) 88%, var(--sdoc-focus-fg, #1c1917) 12%);',
    '}',
    // Author + colour prefs, mirroring the markdown reader\'s "Commenting as:"
    // cluster (.sdoc-comment-prefs). New notes take this name and colour, and the
    // colour drives --sdoc-cc-accent so every add affordance reads in it.
    '.sdoc-cc-prefs { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; }',
    '.sdoc-cc-prefs-label {',
    '  font-size: 11.5px; white-space: nowrap;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 50%, transparent);',
    '}',
    '.sdoc-cc-pref-author {',
    '  font: inherit; font-size: 11.5px; color: var(--sdoc-focus-fg, #1c1917);',
    '  background: transparent; border-radius: 4px; padding: 2px 6px;',
    '  width: 74px; height: 22px; box-sizing: border-box; outline: none;',
    '  border: 1px solid color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 18%, transparent);',
    '}',
    '.sdoc-cc-pref-author:focus { border-color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 34%, transparent); }',
    '.sdoc-cc-pref-color {',
    '  width: 22px; height: 22px; padding: 0; border-radius: 4px;',
    '  background: transparent; cursor: pointer; flex-shrink: 0;',
    '  border: 1px solid color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 18%, transparent);',
    '}',
    '.sdoc-cc-pref-color::-webkit-color-swatch-wrapper { padding: 2px; }',
    '.sdoc-cc-pref-color::-webkit-color-swatch { border: none; border-radius: 2px; }',
    '.sdoc-cc-pref-color::-moz-color-swatch { border: none; border-radius: 2px; }',
    // A thin divider between the prefs and the granularity control.
    '.sdoc-cc-subbar-div {',
    '  width: 1px; height: 18px; flex-shrink: 0;',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 14%, transparent);',
    '}',
    // Granularity segmented control + note counter, shown only in comment mode.
    '.sdoc-cc-grain {',
    '  display: inline-flex; align-items: center; border-radius: 6px;',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 8%, transparent);',
    '  padding: 2px; gap: 2px; margin-right: 2px;',
    '}',
    '.sdoc-cc-grain button {',
    '  all: unset; cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 500;',
    '  padding: 3px 9px; border-radius: 4px;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 62%, transparent);',
    '  transition: background .12s, color .12s;',
    '}',
    '.sdoc-cc-grain button:hover { color: var(--sdoc-focus-fg, #1c1917); }',
    '.sdoc-cc-grain button.active {',
    '  background: var(--sdoc-focus-bg, #f4f1ed); color: #3B82F6;',
    '  box-shadow: 0 1px 2px rgba(0,0,0,.08);',
    '}',
    '.sdoc-cc-nav { display: inline-flex; align-items: center; gap: 1px; margin-right: 2px; }',
    '.sdoc-cc-count {',
    '  font-size: 11.5px; font-weight: 500; min-width: 44px; text-align: center;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 62%, transparent);',
    '}',
    // Each row owns a "+" in a reserved strip at the gutter\'s left, shown only
    // in comment mode (line grain) on row hover. Per-row rather than one moving
    // element: it is rebuilt with its row and reads its own line, so nothing can
    // chase the pointer or land on a neighbour. Hidden in method grain, where
    // the tall tab takes over.
    '.sdoc-code-focus.sdoc-cc-on .sdoc-cl-gutter { padding-left: 20px; }',
    // The same vocabulary as the markdown reader\'s gutter add button
    // (.sdoc-gutter-add): a quiet tab tucked into the margin, panel-tone at rest,
    // the speech-bubble icon, that warms to the comment accent on hover. The
    // asymmetric rounding (heavier on the outer edge) reads as tucked in.
    '.sdoc-cc-add {',
    '  all: unset; box-sizing: border-box; cursor: pointer;',
    '  position: absolute; left: 0; top: 0; width: 18px; height: 1.65em;',
    '  display: none; align-items: center; justify-content: center;',
    '  border-radius: 6px 3px 3px 6px;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 50%, transparent);',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 6%, var(--sdoc-focus-bg, #f4f1ed));',
    '  opacity: 0; transition: opacity .12s, background .12s, color .12s;',
    '}',
    '.sdoc-code-focus.sdoc-cc-on .sdoc-cl-row .sdoc-cc-add { display: inline-flex; }',
    '.sdoc-code-focus.sdoc-cc-on .sdoc-cl-row:hover .sdoc-cc-add { opacity: 1; }',
    '.sdoc-cc-add:hover {',
    '  background: color-mix(in oklab, var(--sdoc-cc-accent, #ffbb00) 38%, var(--sdoc-focus-bg, #f4f1ed));',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '}',
    '.sdoc-code-focus.sdoc-cc-grain-method .sdoc-cc-add { display: none; }',
    '.sdoc-cc-add svg { display: block; width: 14px; height: 14px; }',
    // Method grain: a tall "+" tab spanning the whole method, mirroring the
    // markdown block gutter button. Positioned over the method line range.
    '.sdoc-code-focus-lines { position: relative; }',
    '.sdoc-cc-madd {',
    '  all: unset; box-sizing: border-box; cursor: pointer;',
    '  position: absolute; left: 0; width: 20px; z-index: 2;',
    '  display: none; flex-direction: column; align-items: center;',
    '  padding-top: 5px;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 50%, transparent);',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 6%, var(--sdoc-focus-bg, #f4f1ed));',
    '  border-radius: 8px 3px 3px 8px;',
    '  opacity: 0; transition: opacity .12s, background .12s, color .12s;',
    '}',
    '.sdoc-cc-madd.show { display: flex; opacity: 1; }',
    '.sdoc-cc-madd:hover {',
    '  background: color-mix(in oklab, var(--sdoc-cc-accent, #ffbb00) 38%, var(--sdoc-focus-bg, #f4f1ed));',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '}',
    '.sdoc-cc-madd svg { display: block; width: 14px; height: 14px; }',
    // A method that carries a comment keeps a persistent stripe down its whole
    // height in the comment\'s colour: an inset left bar on each row in the method
    // range, which stacks into one continuous line. --sdoc-cc-marker is set per
    // row from the comment\'s colour (renderThreads), defaulting to the accent.
    '.sdoc-cl-row.sdoc-cc-method-marked { box-shadow: inset 2px 0 var(--sdoc-cc-marker, var(--sdoc-cc-accent, #ffbb00)); }',
    // A commented line is tinted in the comment colour, the code analogue of the
    // markdown reader\'s .sdoc-anchor highlight: a translucent wash of the colour
    // over the code cell so the annotated line reads the same way an annotated
    // span does in prose.
    '.sdoc-cl-row.sdoc-cc-has-comment .sdoc-cl-code {',
    '  background: color-mix(in oklab, var(--sdoc-cc-marker, var(--sdoc-cc-accent, #ffbb00)) 18%, transparent);',
    '  border-radius: 2px;',
    '}',
    // Method highlight while hovering / composing / navigating a method comment,
    // tinted in the accent so the preview matches the colour the note will take.
    '.sdoc-cl-row.sdoc-cc-mhl {',
    '  background: color-mix(in oklab, var(--sdoc-cc-accent, #ffbb00) 16%, transparent);',
    '  box-shadow: inset 2px 0 var(--sdoc-cc-accent, #ffbb00);',
    '}',
    // Thread rows: a comment card sitting in its own row beneath the anchor.
    '.sdoc-cc-thread {',
    '  display: block; padding: 4px 16px 6px;',
    '  padding-left: calc(var(--sdoc-ln-w) + 40px);',
    '}',
    '.sdoc-code-focus.sdoc-cc-on .sdoc-cc-thread { padding-left: calc(var(--sdoc-ln-w) + 60px); }',
    // Comment card: mirrors the markdown comment card (.sdoc-card) - a tinted box
    // in the per-comment colour with the author and body inline, action icons in
    // the top-right corner. Tint = colour 22% over the surface, border = 50%.
    '.sdoc-cc-card {',
    '  --sdoc-cc-color: #ffbb00; position: relative; display: block; max-width: 60ch;',
    '  font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12.5px; line-height: 1.4;',
    '  color: var(--sdoc-focus-fg, #1c1917); cursor: pointer;',
    '  background: color-mix(in oklab, var(--sdoc-cc-color) 22%, var(--sdoc-focus-bg, #f4f1ed));',
    '  border: 1px solid color-mix(in oklab, var(--sdoc-cc-color) 50%, transparent);',
    '  border-radius: 5px; padding: 3px 26px 3px 8px;',
    '}',
    '.sdoc-cc-card.sdoc-cc-card-edit { cursor: default; }',
    '.sdoc-cc-card-author { font-weight: 600; color: var(--sdoc-focus-fg, #1c1917); }',
    '.sdoc-cc-card-author::after {',
    '  content: ":"; margin-right: 4px;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 45%, transparent);',
    '}',
    '.sdoc-cc-card-body { display: inline; white-space: pre-wrap; word-break: break-word; }',
    '.sdoc-cc-card-actions { position: absolute; top: 2px; right: 4px; display: inline-flex; gap: 1px; }',
    // Delete (view) / save + cancel (edit) sit in the top-right of the card.
    // Same treatment as the markdown sidecar card\'s .sdoc-icon-btn: a solid
    // muted tone (the overlay analogue of var(--text-2)), always visible, picking
    // up the card tint on hover. Icons render at 14px to match the markdown
    // composer rather than looking smaller and lighter.
    '.sdoc-cc-iconbtn {',
    '  all: unset; cursor: pointer; padding: 2px; border-radius: 4px;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 58%, transparent);',
    '  display: inline-flex; transition: background .12s, color .12s;',
    '}',
    '.sdoc-cc-iconbtn:hover {',
    '  background: color-mix(in oklab, var(--sdoc-cc-color) 42%, var(--sdoc-focus-bg, #f4f1ed));',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '}',
    '.sdoc-cc-iconbtn svg { display: block; width: 14px; height: 14px; }',
    // Composer: transparent textarea on the same tint, save / cancel top-right.
    '.sdoc-cc-card-edit { padding: 4px 48px 4px 8px; }',
    '.sdoc-cc-input {',
    '  display: block; width: 100%; box-sizing: border-box; resize: none; overflow: hidden;',
    '  font: inherit; line-height: 1.5; min-height: 1.4em;',
    '  border: none; background: transparent; outline: none;',
    '  color: var(--sdoc-focus-fg, #1c1917); padding: 0;',
    '}',
    '.sdoc-cc-input::placeholder { color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 40%, transparent); }',
    '.sdoc-cc-card-edit-actions { position: absolute; top: 3px; right: 4px; display: inline-flex; gap: 1px; }',
    '.sdoc-cc-flash { animation: sdoc-cc-pulse .9s ease-out; }',
    '@keyframes sdoc-cc-pulse {',
    '  0% { box-shadow: 0 0 0 3px color-mix(in oklab, #3B82F6 45%, transparent); }',
    '  100% { box-shadow: 0 0 0 0 transparent; }',
    '}',
    // Orphaned comments whose anchor line is gone, parked at the foot.
    '.sdoc-cc-orphans { padding: 16px; margin-top: 12px;',
    '  border-top: 1px solid color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 12%, transparent); }',
    '.sdoc-cc-orphans-head {',
    '  font-family: ui-sans-serif, system-ui, sans-serif; font-size: 11px;',
    '  text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 45%, transparent);',
    '}',
    '.sdoc-cc-orphans .sdoc-cc-thread { padding-left: 0; }'
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
  // Same tray-with-down-arrow glyph the markdown reader\'s export button uses
  // (#_sd_btn-export in index.html), so "download" reads the same everywhere.
  var DOWNLOAD_ICON = lucide('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>'
    + '<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>');
  var WRAP_ICON = lucide('<path d="M3 6h18"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/>'
    + '<path d="m16 16-2 2 2 2"/><path d="M3 18h7"/>');
  var X_ICON = lucide('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');
  var CHEVRON = lucide('<polyline points="9 18 15 12 9 6"/>', 12);
  // Same speech-bubble-with-dots as the main toolbar comment button
  // (#_sd_btn-comment in index.html), so the icon reads the same everywhere.
  var COMMENT_ICON = lucide('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'
    + '<path d="M8 10h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/>');
  var TRASH_ICON = lucide('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 13);
  var CHECK_ICON = lucide('<path d="M20 6 9 17l-5-5"/>', 13);
  // The comment composer's save / cancel reuse the markdown composer's exact
  // tick and cross (sdocs-comments-ui.js TICK_SVG / X_SVG): a heavier 2.5 stroke,
  // so the two composers read identically rather than the code one looking
  // thinner. Kept separate from CHECK_ICON / X_ICON, which stay at the lighter
  // 2-stroke used by the topbar and copy-feedback affordances.
  var TICK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
  var X_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  // Two icons, switched by the button's .is-open class: outward arrows mean
  // "expand all" (shown when something is collapsed), inward arrows mean
  // "collapse all" (shown when everything is open). This is the same fold
  // glyph the markdown section fold button uses in the main toolbar, so the
  // icon language stays consistent across the site. Both the toolbar button
  // and the master gutter control reuse it via foldIcons(size).
  function foldIcons(size) {
    var s = size || 14;
    return '<svg class="sdoc-icon-unfold" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-6"/><path d="M12 8V2"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/><path d="m15 19-3 3-3-3"/><path d="m15 5-3-3-3 3"/></svg>'
      + '<svg class="sdoc-icon-fold" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-6"/><path d="M12 8V2"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/><path d="m15 19-3-3-3 3"/><path d="m15 5-3 3-3-3"/></svg>';
  }
  var FOLDALL_ICONS = foldIcons(14);

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
  var folds = null;       // per-line { header:bool, end:int } from indentation
  var parents = null;     // immediate enclosing header index per line (or -1)
  var collapsed = null;   // Set of collapsed header line indices
  var srcLines = null;    // raw source lines, for structural-keyword matching
  var structuralRe = null; // array of RegExp for the current language, or null
  var openToken = null;   // identity of the current open(); guards async races

  // Whether code files open collapsed-to-outline or fully expanded. Set by the
  // toolbar's fold-all button and remembered across files (and reloads), kept
  // deliberately separate from the markdown section fold state.
  var FOLD_PREF_KEY = 'sdocs:codeFoldAll';
  function prefCollapsed() {
    try { return localStorage.getItem(FOLD_PREF_KEY) === '1'; } catch (_) { return false; }
  }
  function savePref(on) {
    try { localStorage.setItem(FOLD_PREF_KEY, on ? '1' : '0'); } catch (_) {}
  }

  // ── Comments ───────────────────────────────────────────────────────────────
  // The reader can annotate the open file. Comments anchor to a source line or a
  // whole method and persist in localStorage keyed by the file - there is no
  // document round-trip here (an opened code file is not a saved SmallDocs doc),
  // so they ride alongside it in the browser like the fold preference does. The
  // pure model lives in sdocs-code-comments.js; this layer owns storage and DOM.
  var CC = window.SDocsCodeComments;
  var GRAIN_KEY = 'sdocs:codeCommentGrain'; // 'line' | 'method', remembered
  var comments = [];        // current file's comment list (model objects)
  var commenting = false;   // comment mode on/off
  var grain = 'line';       // current granularity
  var storeKey = null;      // localStorage key for the current file
  var navId = null;         // id of the comment the nav cursor last landed on
  var currentLang = '';     // language label, for the copy-with-comments fence

  function prefGrain() {
    try { var g = localStorage.getItem(GRAIN_KEY); return g === 'method' ? 'method' : 'line'; }
    catch (_) { return 'line'; }
  }
  function saveGrain(g) { try { localStorage.setItem(GRAIN_KEY, g); } catch (_) {} }

  // A stable identity for the open file: its path when opened from disk, else a
  // short hash of the source so re-opening the same content finds its comments.
  function hashStr(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function fileKey() {
    var path = S.localMeta && S.localMeta.fullPath;
    if (path) return 'path:' + path;
    return 'hash:' + hashStr(rawText || '');
  }
  function loadComments() {
    storeKey = 'sdocs:codeComments:' + fileKey();
    try { comments = CC ? CC.parse(localStorage.getItem(storeKey)) : []; }
    catch (_) { comments = []; }
  }
  function saveComments() {
    if (!storeKey || !CC) return;
    try {
      if (comments.length) localStorage.setItem(storeKey, CC.serialize(comments));
      else localStorage.removeItem(storeKey);
    } catch (_) {}
  }

  // Does this line carry a language keyword that should survive the outline?
  // Null means no definitions are loaded - the caller keeps every member then.
  function isStructural(text) {
    if (!structuralRe) return false;
    for (var i = 0; i < structuralRe.length; i++) {
      if (structuralRe[i].test(text)) return true;
    }
    return false;
  }

  // Leading-indent width of a line, or -1 for a blank line. Tabs count as 4.
  function indentWidth(line) {
    if (!line.trim()) return -1;
    var w = 0;
    for (var k = 0; k < line.length; k++) {
      var ch = line.charAt(k);
      if (ch === ' ') w += 1;
      else if (ch === '\t') w += 4;
      else break;
    }
    return w;
  }

  // A line that closes a block: Ruby's `end`, or a run of closing brackets.
  function isCloser(line) {
    var t = line.trim();
    return t === 'end' || /^[)\]}][)\]};,]*$/.test(t);
  }

  // A line is a fold header when the next non-blank line is more indented. Its
  // range runs to the last more-indented line, then PULLS IN the closing line
  // (end / } / )) at the header's own indent plus one trailing blank, so the
  // block's closer and a little breathing room fold and unfold with it.
  // Language-agnostic: classes, functions, methods, and any nested block fall
  // out of indentation.
  function computeFolds(lines) {
    var n = lines.length;
    var ind = new Array(n);
    for (var i = 0; i < n; i++) ind[i] = indentWidth(lines[i]);
    var out = new Array(n);
    for (i = 0; i < n; i++) out[i] = { header: false, end: i, container: false };
    for (i = 0; i < n; i++) {
      if (ind[i] < 0) continue;
      var j = i + 1;
      while (j < n && ind[j] < 0) j++;
      if (j < n && ind[j] > ind[i]) {
        var base = ind[i], last = i, k = j;
        while (k < n && (ind[k] < 0 || ind[k] > base)) {
          if (ind[k] >= 0) last = k;
          k++;
        }
        if (last > i) {
          var m = last + 1;
          if (m < n && ind[m] === base && isCloser(lines[m])) { last = m; m++; }
          if (m < n && ind[m] < 0) last = m;   // one trailing blank line
          out[i].header = true;
          out[i].end = last;
        }
      }
    }
    // A "container" holds nested blocks (a class / module). When collapsed it
    // folds only its nested bodies and keeps its own single-line members
    // visible, so the result reads as an outline. A leaf block (a method) folds
    // its whole body.
    for (i = 0; i < n; i++) {
      if (!out[i].header) continue;
      for (var d = i + 1; d <= out[i].end; d++) {
        if (out[d].header) { out[i].container = true; break; }
      }
    }
    return out;
  }

  // Re-decide which headers are containers now that a language is known. The
  // indentation pass calls anything with a nested block a container; that pulls
  // a method's `if` / `for` in too. The real question is whether a block holds a
  // DEFINITION (a method, a nested class) versus just control flow - and that is
  // exactly what the structural keywords mark. So: a container is a header with a
  // direct child header that is structural; everything else folds as a leaf.
  function recomputeContainers() {
    if (!structuralRe || !folds) return;
    for (var i = 0; i < folds.length; i++) {
      if (!folds[i].header) { folds[i].container = false; continue; }
      var c = false;
      for (var d = i + 1; d <= folds[i].end; d++) {
        if (folds[d].header && parents[d] === i && isStructural(srcLines[d])) { c = true; break; }
      }
      folds[i].container = c;
    }
  }

  // Immediate enclosing header for each line (or -1). A leaf hides only when ITS
  // header is collapsed, so a method can open while its class stays collapsed.
  function computeParents(f) {
    var n = f.length, parent = new Array(n), stack = [];
    for (var i = 0; i < n; i++) {
      while (stack.length && f[stack[stack.length - 1]].end < i) stack.pop();
      parent[i] = stack.length ? stack[stack.length - 1] : -1;
      if (f[i].header) stack.push(i);
    }
    return parent;
  }

  // Hierarchical, like the markdown heading collapse: headers stay visible as
  // the outline. What folds depends on the collapsed line's kind:
  //   - a leaf block (a method) hides its whole body, marked by an ellipsis on
  //     the method's own row.
  //   - a container (a class / module), when a language is known, keeps only its
  //     structural members - method signatures, `private`, constants - and drops
  //     the rest (comments, stray statements) into a single ellipsis row, so the
  //     class reads as a minimum-structure outline. Blank lines fold silently so
  //     the dots only ever stand in for real hidden content. With no language
  //     definitions loaded, every member is kept (the plain indentation outline).
  function refreshFold() {
    if (!linesEl || !folds) return;
    // Source rows only: comment threads (.sdoc-cc-thread) are interleaved as
    // extra rows in comment mode, so index by the real code rows, not children.
    var rows = linesEl.querySelectorAll(':scope > .sdoc-cl-row');
    var inGap = false; // a run of dropped members already shows its ellipsis
    for (var i = 0; i < rows.length; i++) {
      var f = folds[i], p = parents[i], row = rows[i];
      var hidden = false, gap = false, blank = !srcLines[i].trim();
      if (p >= 0 && collapsed.has(p)) {
        if (!folds[p].container) {
          hidden = true;                       // leaf method: hide the whole body
        } else if (structuralRe && !(f.header || isStructural(srcLines[i]) || isCloser(srcLines[i]))) {
          // container: drop non-structural members, but keep signatures, language
          // keywords, and the block's own closer (`end` / `}`) so it reads shut.
          hidden = true;
          gap = !blank;                        // only dots for real content
        }
      }
      var showGap = false;
      if (gap) { if (!inGap) { showGap = true; inGap = true; } }
      else if (!(hidden && blank)) { inGap = false; } // a blank bridges the run
      row.style.display = (hidden && !showGap) ? 'none' : '';
      row.classList.toggle('fold-gap', showGap);
      // Sit the ellipsis at the indent of what it replaces, so it lines up under
      // the members around it instead of jumping to the left margin.
      if (showGap) {
        var gi = indentWidth(srcLines[i]);
        row.style.setProperty('--sdoc-gap-indent', (gi > 0 ? gi : 0) + 'ch');
      }
      var isC = f.header && collapsed.has(i);
      row.classList.toggle('collapsed', isC);
      row.classList.toggle('fold-container', !!f.container);
      var btn = row.querySelector('button.sdoc-cl-fold');
      if (btn) btn.setAttribute('aria-expanded', isC ? 'false' : 'true');
    }
    syncThreadVisibility();
    hideMethodTab(); // row offsets changed; it re-shows on the next hover
  }

  // Toggling a header applies to every header nested under it, mirroring the
  // markdown section toggle: collapsing a class collapses its methods (expand
  // the class to open them all), while a single method can still be opened or
  // closed on its own.
  function onFoldClick(e) {
    var btn = e.target.closest('button.sdoc-cl-fold');
    if (!btn) return;
    var h = parseInt(btn.getAttribute('data-h'), 10);
    var collapse = !collapsed.has(h);
    for (var d = h; d <= folds[h].end; d++) {
      if (!folds[d].header) continue;
      if (collapse) collapsed.add(d); else collapsed.delete(d);
    }
    refreshFold();
    syncFoldAllBtn();
  }

  function allHeaderIndices() {
    var s = [];
    for (var i = 0; folds && i < folds.length; i++) if (folds[i].header) s.push(i);
    return s;
  }

  // The source lines of the section a header owns: the header through its fold
  // end (a container pulls in everything nested; a leaf just its own body),
  // trailing blank lines trimmed.
  function sectionText(h) {
    if (!folds || !folds[h]) return '';
    var end = folds[h].end;
    return srcLines.slice(h, end + 1).join('\n').replace(/\s+$/, '');
  }

  function onCopyClick(e) {
    var cBtn = e.target.closest('.sdoc-cl-copyc');
    if (cBtn) {
      e.stopPropagation();
      var ch = parseInt(cBtn.getAttribute('data-copyc-h'), 10);
      if (!isNaN(ch)) copySectionWithComments(ch, cBtn);
      return;
    }
    var btn = e.target.closest('.sdoc-cl-copy');
    if (!btn) return;
    e.stopPropagation();
    var h = parseInt(btn.getAttribute('data-copy-h'), 10);
    if (isNaN(h) || !navigator.clipboard) return;
    navigator.clipboard.writeText(sectionText(h) + '\n').then(function () {
      var prev = btn.innerHTML;
      btn.innerHTML = CHECK_ICON;
      setTimeout(function () { if (btn) btn.innerHTML = prev; }, 1200);
    });
  }

  // Copy a section's source plus only the notes that fall inside it. Mirrors the
  // markdown per-heading "copy section with comments". Notes resolve against the
  // section slice, so line numbers in the output are relative to the snippet.
  function copySectionWithComments(h, btn) {
    if (!CC || !folds || !folds[h] || !navigator.clipboard) return;
    var end = folds[h].end;
    var sectionLines = srcLines.slice(h, end + 1);
    var within = comments.filter(function (c) {
      var ln = CC.resolveLine(c, srcLines);
      return ln >= h && ln <= end;
    });
    // The fence holds just this section, but the notes should cite the file's
    // real line numbers, so offset the printed numbers by the section start (h).
    var text = CC.serializeAnnotations(within, sectionLines, { fileName: fileNameForCopy(), lang: currentLang, lineOffset: h });
    navigator.clipboard.writeText(text).then(function () {
      if (!btn) return;
      var lab = btn.querySelector('span');
      if (!lab) return;
      var prev = lab.textContent;
      lab.textContent = 'Copied';
      setTimeout(function () { if (lab) lab.textContent = prev; }, 1200);
    });
  }

  // Collapse every block to the outline, or open everything. The button's two
  // states map onto these; individual chevrons still work on top afterwards.
  function setAllCollapsed(on) {
    collapsed = new Set(on ? allHeaderIndices() : []);
    refreshFold();
    syncFoldAllBtn();
  }

  // Toggle the whole file between outline and fully expanded, then remember the
  // new default. Shared by the toolbar button and the gutter master chevron.
  function toggleAll() {
    var nextCollapsed = !collapsed || collapsed.size === 0;
    setAllCollapsed(nextCollapsed);
    savePref(nextCollapsed);
  }

  // Keep the fold-all icon button in step: the inward-arrows ("collapse all")
  // glyph shows while everything is open, the outward-arrows ("expand all") glyph
  // once anything is folded. The label drives only the tooltip / aria-label now;
  // the button carries no visible text.
  function syncFoldAllBtn() {
    if (!modal) return;
    var allOpen = !collapsed || collapsed.size === 0;
    var label = allOpen ? 'Collapse all' : 'Expand all';
    var btn = modal.querySelector('[data-act="foldall"]');
    if (btn) {
      btn.classList.toggle('is-open', allOpen);
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
    }
    // The summary disclosure: chevron down (is-open) when the file is fully
    // expanded, right when collapsed to its outline. Its tooltip mirrors the
    // toolbar button's action.
    var sumBtn = modal.querySelector('.sdoc-cf-summary');
    if (sumBtn) {
      sumBtn.classList.toggle('is-open', allOpen);
      sumBtn.setAttribute('aria-label', label);
      sumBtn.setAttribute('title', label);
    }
  }

  function renderRows(lineParts) {
    if (!linesEl) return;
    var digits = String(lineParts.length).length;
    docEl.style.setProperty('--sdoc-ln-w', digits + 'ch');
    var html = '';
    for (var i = 0; i < lineParts.length; i++) {
      var f = folds && folds[i];
      var fold = (f && f.header)
        ? '<button class="sdoc-cl-fold" type="button" tabindex="-1" data-h="' + i + '" aria-label="Fold or unfold" aria-expanded="true">' + CHEVRON + '</button>'
        : '<span class="sdoc-cl-fold"></span>';
      // A header row carries a copy-section button, like the markdown heading
      // copy: a container (class) copies itself + everything nested; a leaf
      // (method) copies just itself. The fold range gives exactly that span.
      var copy = (f && f.header)
        ? '<button class="sdoc-cl-copy" type="button" tabindex="-1" data-copy-h="' + i + '" aria-label="Copy section" title="Copy this section">' + COPY_ICON + '</button>'
        : '';
      // Hanging indent for soft-wrapped lines: a wrapped line's continuation
      // should line up under where the line's content starts, not jump back to
      // the code-column left edge. Carry the line's own indentation width as a
      // CSS var the wrapped-mode rule turns into padding-left + negative
      // text-indent. (--cl-ind from the SOURCE line, so it is right whether the
      // part is plain or syntax-highlighted HTML.)
      var iw = srcLines ? indentWidth(srcLines[i]) : -1;
      var indStyle = iw > 0 ? ' style="--cl-ind:' + iw + 'ch"' : '';
      html += '<div class="sdoc-cl-row" data-ln="' + i + '">'
        + '<span class="sdoc-cl-gutter">'
        + '<button class="sdoc-cc-add" type="button" tabindex="-1" data-ln="' + i + '" aria-label="Add a comment" title="Add a comment">' + COMMENT_ICON + '</button>'
        + fold
        + '<span class="sdoc-cl-num">' + (i + 1) + '</span></span>'
        + '<span class="sdoc-cl-code"' + indStyle + '>' + lineParts[i] + copy + '</span></div>';
    }
    // A row rebuild (the one-shot highlight upgrade) wipes the listing. Preserve
    // an open composer across it so a note half-typed in the first second isn't
    // lost when highlighting lands.
    var openComp = captureComposer();
    linesEl.innerHTML = html;
    refreshFold();
    renderThreads(); // re-attach comment markers + threads after a rebuild
    if (openComp && openComp.spec) {
      openComposer(openComp.spec);
      var ta = linesEl.querySelector('.sdoc-cc-composer .sdoc-cc-input');
      if (ta) { ta.value = openComp.text; autoGrow(ta); }
    } else {
      replaceAddAffordance();
    }
  }

  function captureComposer() {
    if (!linesEl) return null;
    var c = linesEl.querySelector('.sdoc-cc-composer');
    if (!c) return null;
    var ta = c.querySelector('.sdoc-cc-input');
    var spec;
    try { spec = JSON.parse(c.dataset.spec || '{}'); } catch (_) { return null; }
    return { spec: spec, text: ta ? ta.value : '' };
  }

  function open(sourcePre) {
    if (modal) close();
    if (!sourcePre) return;
    var srcCode = sourcePre.querySelector('code');
    if (!srcCode) return;
    rawText = srcCode.textContent || '';
    srcLines = rawText.split('\n');
    folds = computeFolds(srcLines);
    parents = computeParents(folds);
    collapsed = new Set(prefCollapsed() ? allHeaderIndices() : []);
    structuralRe = null;
    openToken = {};
    prevFocus = document.activeElement;
    commenting = false;
    grain = prefGrain();
    navId = null;
    loadComments();

    // Load this language's structural keywords so a collapsed class folds to its
    // signatures. Async and best-effort: until it lands (or if absent) the
    // outline keeps every member. The token guards against a close/reopen race.
    var langMatch = (srcCode.className || '').match(/language-([\w+#-]+)/i);
    currentLang = langMatch ? langMatch[1] : '';
    if (langMatch) {
      var myToken = openToken;
      loadStructural(langMatch[1]).then(function (defn) {
        if (openToken !== myToken || !defn) return;
        structuralRe = defn.structural || null;
        recomputeContainers();
        refreshFold();
      });
    }

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
    // Brand (logo only) at the left, controls centred in the auto middle column,
    // the close X at the right. The filename moved to a file-info card below.
    topbar.innerHTML =
      '<span class="sdoc-code-focus-brand">'
      +   '<span class="sdoc-code-focus-brand-text sdoc-code-focus-brand-full">SmallDocs</span>'
      +   '<span class="sdoc-code-focus-brand-text sdoc-code-focus-brand-short">SD</span>'
      + '</span>'
      + '<div class="sdoc-code-focus-center">'
      +   '<button type="button" class="sdoc-code-focus-btn active" data-act="wrap" title="Toggle soft wrap" aria-label="Toggle soft wrap" aria-pressed="true">' + WRAP_ICON + '</button>'
      +   '<button type="button" class="sdoc-code-focus-btn" data-act="foldall" title="Collapse all" aria-label="Collapse all">' + FOLDALL_ICONS + '</button>'
      +   '<button type="button" class="sdoc-code-focus-btn" data-act="copy" title="Copy code" aria-label="Copy code">' + COPY_ICON + '</button>'
      +   '<button type="button" class="sdoc-code-focus-btn" data-act="download" title="Download file" aria-label="Download file">' + DOWNLOAD_ICON + '</button>'
      +   '<button type="button" class="sdoc-code-focus-btn" data-act="comment" title="Comment mode" aria-label="Comment mode" aria-pressed="false">' + COMMENT_ICON + '</button>'
      + '</div>'
      + '<div class="sdoc-code-focus-actions">'
      +   '<button type="button" class="sdoc-code-focus-btn" data-act="close" title="Close (Esc)" aria-label="Close">' + X_ICON + '</button>'
      + '</div>';

    // Comment sub-bar: holds the granularity toggle and note navigation; slides
    // in under the topbar only in comment mode.
    var subbar = document.createElement('div');
    subbar.className = 'sdoc-cc-subbar';
    subbar.innerHTML =
      '<span class="sdoc-cc-prefs">'
      +   '<span class="sdoc-cc-prefs-label">Commenting as</span>'
      +   '<input type="text" class="sdoc-cc-pref-author" aria-label="Your name" maxlength="32" spellcheck="false" />'
      +   '<input type="color" class="sdoc-cc-pref-color" aria-label="Comment colour" />'
      + '</span>'
      + '<span class="sdoc-cc-subbar-div" aria-hidden="true"></span>'
      + '<span class="sdoc-cc-grain" role="group" aria-label="Comment granularity">'
      +   '<button type="button" data-grain="line" class="active" title="Comment on individual lines">Lines</button>'
      +   '<button type="button" data-grain="method" title="Comment on whole methods">Methods</button>'
      + '</span>'
      + '<span class="sdoc-cc-nav" style="display:none">'
      +   '<button type="button" class="sdoc-code-focus-btn" data-act="cc-prev" title="Previous note" aria-label="Previous note">' + lucide('<polyline points="15 18 9 12 15 6"/>', 13) + '</button>'
      +   '<span class="sdoc-cc-count"></span>'
      +   '<button type="button" class="sdoc-code-focus-btn" data-act="cc-next" title="Next note" aria-label="Next note">' + lucide('<polyline points="9 18 15 12 9 6"/>', 13) + '</button>'
      + '</span>'
      + '<span class="sdoc-cc-subbar-hint">Hover a line and click the comment icon to add a note</span>'
      + '<button type="button" class="sdoc-code-focus-action sdoc-cc-copyc" data-act="cc-copy" title="Copy the code with its comments" aria-label="Copy with comments" style="display:none">'
      +   COPY_ICON + '<span class="sdoc-code-focus-action-label">with comments</span>'
      + '</button>';

    var stage = document.createElement('div');
    stage.className = 'sdoc-code-focus-stage';
    docEl = document.createElement('div');
    docEl.className = 'sdoc-code-focus-doc wrapped'; // wrap on by default
    linesEl = document.createElement('div');
    linesEl.className = 'sdoc-code-focus-lines';
    linesEl.addEventListener('click', onFoldClick);
    linesEl.addEventListener('click', onCopyClick);
    linesEl.addEventListener('click', onCommentClick);
    linesEl.addEventListener('mouseover', onLinesHover);
    linesEl.addEventListener('keydown', onComposerKey);
    methodTab = document.createElement('button');
    methodTab.type = 'button';
    methodTab.className = 'sdoc-cc-madd';
    methodTab.setAttribute('aria-label', 'Comment on this method');
    methodTab.setAttribute('title', 'Comment on this method');
    methodTab.innerHTML = COMMENT_ICON;
    var fileInfo = buildFileInfo(name);
    if (fileInfo) { fileInfo.addEventListener('click', onFileInfoClick); docEl.appendChild(fileInfo); }
    var summary = buildSummaryToggle();
    if (summary) docEl.appendChild(summary);
    docEl.appendChild(linesEl);
    stage.appendChild(docEl);

    // Show plain numbered lines immediately; upgrade to highlighted once ready.
    renderRows(escapeHtml(rawText).split('\n'));

    modal.appendChild(topbar);
    modal.appendChild(subbar);
    modal.appendChild(stage);
    document.body.appendChild(modal);
    document.body.classList.add('sdoc-code-focus-open');
    syncFoldAllBtn();
    setGrain(grain);          // sync the granularity control to the saved choice
    wireCommentPrefs();       // fill the author/colour inputs and apply the accent
    updateCommentChrome();

    highlightThenRender(srcCode.className || '');

    topbar.addEventListener('click', onTopbarClick);
    subbar.addEventListener('click', onTopbarClick);
    keyHandler = onKey;
    window.addEventListener('keydown', keyHandler);
    var closeBtn = topbar.querySelector('[data-act="close"]');
    if (closeBtn) closeBtn.focus();
  }

  // File-info card at the top of the listing: filename + paths, each copyable.
  // Built only for a real file view (an opened file), not an inline code block.
  function buildFileInfo() {
    var fullPath = S.localMeta && S.localMeta.fullPath;
    var relPath = S.localMeta && S.localMeta.path;
    var fileName = (S.currentMeta && S.currentMeta.file) || (fullPath ? basename(fullPath) : '');
    if (!fileName && !fullPath) return null;
    if (!fileName) fileName = basename(fullPath);
    var rows = fiRow('Filename', fileName);
    if (fullPath) rows += fiRow('Abs. path', fullPath);
    if (relPath && relPath !== fullPath) rows += fiRow('Rel. path', relPath);
    var card = document.createElement('div');
    card.className = 'sdoc-cf-fileinfo';
    card.innerHTML = '<div class="sdoc-cf-firows">' + rows + '</div>';
    return card;
  }
  // A standalone "> Summary view" disclosure above the listing. Same action as
  // the toolbar fold-all button (toggleAll), in the chevron language the rows
  // use, so a developer can fold the file to its outline right where the code
  // starts. Only built when the file actually has foldable structure.
  function buildSummaryToggle() {
    if (!folds || !allHeaderIndices().length) return null;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sdoc-cf-summary';
    btn.innerHTML =
      '<span class="sdoc-cf-summary-chev">' + CHEVRON + '</span>'
      + '<span class="sdoc-cf-summary-label">Summary</span>';
    btn.addEventListener('click', function () { toggleAll(); });
    return btn;
  }

  function fiRow(label, value) {
    var low = label.toLowerCase();
    return '<div class="sdoc-cf-firow">'
      + '<span class="sdoc-cf-filabel">' + escapeHtml(label) + '</span>'
      + '<span class="sdoc-cf-fival">' + escapeHtml(value) + '</span>'
      + '<button type="button" class="sdoc-cf-ficopy" title="Copy ' + escapeHtml(low) + '" aria-label="Copy ' + escapeHtml(low) + '">' + COPY_ICON + '</button>'
      + '</div>';
  }
  function onFileInfoClick(e) {
    var row = e.target.closest('.sdoc-cf-firow');
    if (!row) return;
    var val = row.querySelector('.sdoc-cf-fival');
    if (!val || !navigator.clipboard) return;
    navigator.clipboard.writeText(val.textContent).then(function () {
      var btn = row.querySelector('.sdoc-cf-ficopy');
      if (!btn) return;
      var prev = btn.innerHTML;
      btn.innerHTML = CHECK_ICON;
      setTimeout(function () { if (btn) btn.innerHTML = prev; }, 1200);
    });
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
    modal = null; docEl = null; linesEl = null; rawText = ''; folds = null; parents = null; collapsed = null;
    srcLines = null; structuralRe = null; openToken = null;
    comments = []; commenting = false; storeKey = null; navId = null; methodTab = null; hoverLn = -1;
    document.body.classList.remove('sdoc-code-focus-open');
    if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (_) {} }
    prevFocus = null;
  }

  function onTopbarClick(e) {
    var grainBtn = e.target.closest('[data-grain]');
    if (grainBtn) { setGrain(grainBtn.getAttribute('data-grain')); return; }
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.dataset.act;
    if (act === 'close') { close(); return; }
    if (act === 'foldall') { toggleAll(); return; }
    if (act === 'comment') { setCommenting(!commenting); return; }
    if (act === 'cc-prev') { navComment(-1); return; }
    if (act === 'cc-next') { navComment(1); return; }
    if (act === 'cc-copy') { copyWithComments(btn); return; }
    if (act === 'wrap') {
      if (!docEl) return;
      var on = docEl.classList.toggle('wrapped');
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      return;
    }
    if (act === 'download') { downloadFile(); return; }
    if (act === 'copy' && navigator.clipboard) {
      navigator.clipboard.writeText(rawText).then(function () { flashCopy(btn); });
    }
  }

  // Icon-only copy button: swap the clipboard glyph for a tick briefly, the same
  // success feedback the per-line copy buttons use.
  function flashCopy(btn) {
    if (!btn) return;
    var prev = btn.innerHTML;
    btn.innerHTML = CHECK_ICON;
    setTimeout(function () { if (btn) btn.innerHTML = prev; }, 1200);
  }

  // Download the opened file's exact source under its own name (token_bucket.py
  // saves as token_bucket.py). Pure client-side Blob; nothing is uploaded.
  function downloadFile() {
    if (!rawText) return;
    try {
      var blob = new Blob([rawText], { type: 'text/plain;charset=utf-8' });
      var href = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = href;
      a.download = fileNameForCopy();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(href); }, 0);
    } catch (_) {}
  }

  function onKey(e) {
    if (!modal) return;
    // A composer swallows Escape to cancel itself first; only close the overlay
    // when nothing finer is listening.
    if (e.key === 'Escape') {
      if (cancelComposer()) { e.preventDefault(); return; }
      e.preventDefault(); close();
    }
  }

  // ── Comment interactions ────────────────────────────────────────────────────

  // The enclosing METHOD for a source line: the nearest header that holds code
  // but not nested definitions (a leaf block - a method/function), walking up
  // from the line. Returns { header, end } or null when the line sits in no
  // method (top-level statements, or inside a bare class body). A leaf header
  // line is its own method.
  function methodFor(i) {
    if (!folds || !folds[i]) return null;
    var idx = (folds[i].header && !folds[i].container) ? i : -1;
    if (idx < 0) {
      var p = parents[i];
      while (p >= 0) {
        if (folds[p].header && !folds[p].container) { idx = p; break; }
        p = parents[p];
      }
    }
    if (idx < 0) return null;
    return { header: idx, end: folds[idx].end };
  }

  function trimmed(i) { return (srcLines[i] || '').trim(); }

  // Author + colour preferences for new notes, mirroring the markdown reader's
  // comment prefs. Remembered across files so a reader's notes carry a consistent
  // name and colour. The colour also drives the overlay's --sdoc-cc-accent so the
  // add affordances read in the same colour the saved note will take.
  var CC_PREFS_KEY = 'sdocs:codeCommentPrefs';
  function readCommentPrefs() {
    try {
      var raw = localStorage.getItem(CC_PREFS_KEY);
      var v = raw ? JSON.parse(raw) : {};
      var color = (CC && CC.sanitizeColor) ? CC.sanitizeColor(v.color) : (v.color || '#ffbb00');
      return { author: (v.author || 'user'), color: color };
    } catch (_) { return { author: 'user', color: '#ffbb00' }; }
  }
  function writeCommentPrefs(p) {
    try { localStorage.setItem(CC_PREFS_KEY, JSON.stringify(p)); } catch (_) {}
  }
  function commentAuthor() { return readCommentPrefs().author; }

  // Push the current pref colour onto the overlay as --sdoc-cc-accent, so every
  // add affordance (the line + tab, the method tab, the hover highlight) reads in
  // it without each piece needing its own copy.
  function applyAccent() {
    if (modal) modal.style.setProperty('--sdoc-cc-accent', readCommentPrefs().color);
  }

  // Fill the sub-bar's author/colour inputs from the saved prefs and keep them in
  // sync as the reader edits them. The colour input retints the overlay live.
  function wireCommentPrefs() {
    if (!modal) return;
    var prefs = readCommentPrefs();
    var nameI = modal.querySelector('.sdoc-cc-pref-author');
    var colorI = modal.querySelector('.sdoc-cc-pref-color');
    if (nameI) {
      nameI.value = prefs.author;
      nameI.addEventListener('input', function () {
        writeCommentPrefs({ author: nameI.value || 'user', color: colorI ? colorI.value : prefs.color });
      });
    }
    if (colorI) {
      colorI.value = prefs.color;
      colorI.addEventListener('input', function () {
        writeCommentPrefs({ author: nameI ? (nameI.value || 'user') : 'user', color: colorI.value });
        applyAccent();
      });
    }
    applyAccent();
  }

  // Group comments by their resolved source line. Orphans (anchor lost) collect
  // under key -1 and render at the foot of the listing.
  function commentsByLine() {
    var map = {};
    comments.forEach(function (c) {
      var ln = CC ? CC.resolveLine(c, srcLines) : c.line;
      (map[ln] = map[ln] || []).push(c);
    });
    return map;
  }

  // Rebuild every marker and thread from the model. Idempotent: clears its own
  // prior DOM first, so it is safe to call after any row rebuild or mutation.
  function renderThreads() {
    if (!linesEl) return;
    var old = linesEl.querySelectorAll('.sdoc-cc-thread, .sdoc-cc-orphans, .sdoc-cl-copyc');
    for (var k = 0; k < old.length; k++) old[k].remove();
    var marked = linesEl.querySelectorAll('.sdoc-cc-has-comment, .sdoc-cc-method-marked');
    for (var j = 0; j < marked.length; j++) {
      marked[j].classList.remove('sdoc-cc-has-comment', 'sdoc-cc-method-marked');
      marked[j].style.removeProperty('--sdoc-cc-marker');
    }
    if (!commenting) { updateCommentChrome(); return; }

    var byLine = commentsByLine();
    Object.keys(byLine).forEach(function (key) {
      var ln = parseInt(key, 10);
      var list = byLine[key];
      if (ln < 0) return; // orphans handled below
      var row = linesEl.querySelector('.sdoc-cl-row[data-ln="' + ln + '"]');
      if (!row) return;
      // The line tint takes the colour of the note that sits on it.
      var lineColor = (list[0] && list[0].color) || readCommentPrefs().color;
      row.classList.add('sdoc-cc-has-comment');
      row.style.setProperty('--sdoc-cc-marker', lineColor);
      // A method comment paints a persistent stripe down the whole method in its
      // own colour, so its reach is visible the way a markdown block comment's is.
      var methodC = list.filter(function (c) { return c.kind === 'method'; })[0];
      if (methodC) {
        var m = methodFor(ln);
        if (m) for (var r = m.header; r <= m.end; r++) {
          var rr = linesEl.querySelector('.sdoc-cl-row[data-ln="' + r + '"]');
          if (rr) { rr.classList.add('sdoc-cc-method-marked'); rr.style.setProperty('--sdoc-cc-marker', methodC.color || lineColor); }
        }
      }
      var anchor = row;
      list.forEach(function (c) {
        var thread = buildCard(c, ln);
        anchor.insertAdjacentElement('afterend', thread);
        anchor = thread;
      });
    });

    // Orphaned comments: their anchor line is gone. Keep them reachable at the
    // bottom rather than dropping them silently.
    var orphans = (byLine[-1] || []);
    if (orphans.length) {
      var box = document.createElement('div');
      box.className = 'sdoc-cc-orphans';
      var head = document.createElement('div');
      head.className = 'sdoc-cc-orphans-head';
      head.textContent = 'Comments whose lines are gone';
      box.appendChild(head);
      orphans.forEach(function (c) { box.appendChild(buildCard(c, -1)); });
      linesEl.appendChild(box);
    }
    addSectionCommentCopies();
    syncThreadVisibility();
    updateCommentChrome();
  }

  // Give every fold header whose section contains a note a "with comments" copy
  // button, after its plain section copy. A note inside a method thus lights up
  // both the method header and its enclosing class - the parents - mirroring the
  // markdown per-heading copy-with-comments.
  function addSectionCommentCopies() {
    if (!folds) return;
    var lines = comments.map(function (c) { return CC ? CC.resolveLine(c, srcLines) : c.line; })
      .filter(function (ln) { return ln >= 0; });
    if (!lines.length) return;
    for (var h = 0; h < folds.length; h++) {
      if (!folds[h].header) continue;
      var end = folds[h].end, has = false;
      for (var i = 0; i < lines.length; i++) { if (lines[i] >= h && lines[i] <= end) { has = true; break; } }
      if (!has) continue;
      var codeEl = linesEl.querySelector('.sdoc-cl-row[data-ln="' + h + '"] .sdoc-cl-code');
      if (!codeEl || codeEl.querySelector('.sdoc-cl-copyc')) continue;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sdoc-cl-copyc';
      btn.tabIndex = -1;
      btn.setAttribute('data-copyc-h', h);
      btn.setAttribute('title', 'Copy this section with its comments');
      btn.setAttribute('aria-label', 'Copy section with comments');
      btn.innerHTML = COPY_ICON + '<span>with comments</span>';
      codeEl.appendChild(btn);
    }
  }

  // Hide a thread when its anchor line is folded away, so notes travel with the
  // code they sit on. Orphan threads (no live anchor) always show.
  function syncThreadVisibility() {
    if (!linesEl) return;
    var threads = linesEl.querySelectorAll('.sdoc-cc-thread[data-ln]');
    for (var i = 0; i < threads.length; i++) {
      var ln = threads[i].getAttribute('data-ln');
      var row = linesEl.querySelector('.sdoc-cl-row[data-ln="' + ln + '"]');
      threads[i].style.display = (row && row.style.display === 'none') ? 'none' : '';
    }
  }

  // A saved comment, rendered as a card in its own row beneath the anchor line.
  function buildCard(c, ln) {
    var row = document.createElement('div');
    row.className = 'sdoc-cc-thread';
    if (ln >= 0) row.setAttribute('data-ln', ln);
    row.setAttribute('data-c', c.id);
    if (c.kind === 'method') row.classList.add('sdoc-cc-thread-method');
    if (c.color) row.style.setProperty('--sdoc-cc-color', c.color);

    var card = document.createElement('div');
    card.className = 'sdoc-cc-card';
    card.innerHTML =
      '<span class="sdoc-cc-card-author">' + escapeHtml(c.author || 'user') + '</span>'
      + '<span class="sdoc-cc-card-body"></span>'
      + '<span class="sdoc-cc-card-actions">'
      +   '<button type="button" class="sdoc-cc-iconbtn" data-cc="delete" title="Delete" aria-label="Delete comment">' + TRASH_ICON + '</button>'
      + '</span>';
    card.querySelector('.sdoc-cc-card-body').textContent = c.text || '';
    row.appendChild(card);
    return row;
  }

  // Open an inline composer beneath an anchor. spec: { kind, line, endLine?,
  // anchorText, editId? }. When editId is set the composer pre-fills and replaces
  // an existing card on save instead of adding a new comment.
  function openComposer(spec) {
    cancelComposer();
    var anchorRow = linesEl.querySelector('.sdoc-cl-row[data-ln="' + spec.line + '"]');
    if (!anchorRow) return;

    var row = document.createElement('div');
    row.className = 'sdoc-cc-thread sdoc-cc-composer';
    row.setAttribute('data-ln', spec.line);
    if (spec.kind === 'method') row.classList.add('sdoc-cc-thread-method');

    var card = document.createElement('div');
    card.className = 'sdoc-cc-card sdoc-cc-card-edit';
    card.innerHTML =
      '<textarea class="sdoc-cc-input" rows="1" placeholder="Add a comment..."></textarea>'
      + '<div class="sdoc-cc-card-edit-actions">'
      +   '<button type="button" class="sdoc-cc-iconbtn" data-cc="save" title="Save (Cmd/Ctrl+Enter)" aria-label="Save">' + TICK_SVG + '</button>'
      +   '<button type="button" class="sdoc-cc-iconbtn" data-cc="cancel" title="Cancel (Esc)" aria-label="Cancel">' + X_SVG + '</button>'
      + '</div>';
    row.appendChild(card);

    // For an edit, drop the composer where the existing card sits; otherwise
    // place it right under the anchor line (or under any cards already there).
    var after = anchorRow;
    if (spec.editId) {
      var existing = linesEl.querySelector('.sdoc-cc-thread[data-c="' + spec.editId + '"]');
      if (existing) { existing.replaceWith(row); after = null; }
    }
    if (after) {
      var next = anchorRow.nextElementSibling;
      while (next && next.classList.contains('sdoc-cc-thread') && !next.classList.contains('sdoc-cc-composer')) {
        after = next; next = next.nextElementSibling;
      }
      after.insertAdjacentElement('afterend', row);
    }

    var ta = card.querySelector('.sdoc-cc-input');
    if (spec.editId) {
      var prev = comments.filter(function (c) { return c.id === spec.editId; })[0];
      if (prev) ta.value = prev.text || '';
    }
    autoGrow(ta);
    ta.addEventListener('input', function () { autoGrow(ta); });
    row.dataset.spec = JSON.stringify(spec);
    if (spec.kind === 'method') highlightMethod(spec.line, spec.endLine);
    ta.focus();
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight, 22) + 'px';
  }

  // Remove an open composer, if any. Returns true when it removed one (so the
  // Escape handler knows it consumed the key).
  function cancelComposer() {
    if (!linesEl) return false;
    var c = linesEl.querySelector('.sdoc-cc-composer');
    if (!c) return false;
    c.remove();
    clearMethodHighlight();
    return true;
  }

  function saveComposer(composerRow) {
    var spec;
    try { spec = JSON.parse(composerRow.dataset.spec || '{}'); } catch (_) { spec = {}; }
    var ta = composerRow.querySelector('.sdoc-cc-input');
    var text = (ta && ta.value || '').trim();
    if (!text) { if (ta) ta.focus(); return; }
    if (spec.editId) {
      comments = CC.updateComment(comments, spec.editId, { text: text });
    } else {
      var prefs = readCommentPrefs();
      var res = CC.addComment(comments, {
        kind: spec.kind, line: spec.line, endLine: spec.endLine, anchorText: spec.anchorText
      }, { text: text, author: prefs.author, color: prefs.color });
      comments = res.list;
      navId = res.id;
    }
    saveComments();
    clearMethodHighlight();
    renderThreads();
  }

  // Highlight a method's whole line range (header..end) while it is being
  // hovered, composed, or navigated to.
  function highlightMethod(header, end) {
    clearMethodHighlight();
    if (header == null) return;
    if (end == null) end = header;
    for (var i = header; i <= end; i++) {
      var row = linesEl.querySelector('.sdoc-cl-row[data-ln="' + i + '"]');
      if (row) row.classList.add('sdoc-cc-mhl');
    }
  }
  function clearMethodHighlight() {
    if (!linesEl) return;
    var hl = linesEl.querySelectorAll('.sdoc-cc-mhl');
    for (var i = 0; i < hl.length; i++) hl[i].classList.remove('sdoc-cc-mhl');
  }

  // Move the single "+" add button into the hovered row's gutter (comment mode
  // only). In method grain, also light up the whole enclosing method.
  // Line grain: each row owns its own "+" (rendered into the gutter), shown on
  // hover via CSS - no moving element to chase. This handler only drives the
  // method grain: light up the enclosing method and stretch the tall tab over it.
  function onLinesHover(e) {
    if (!commenting || grain !== 'method') return;
    if (methodTab && methodTab.contains(e.target)) return;
    var row = e.target.closest('.sdoc-cl-row');
    if (!row || !linesEl.contains(row) || row.style.display === 'none') return;
    var ln = parseInt(row.getAttribute('data-ln'), 10);
    if (isNaN(ln)) return;
    hoverLn = ln;
    var m = methodFor(ln);
    if (m) { highlightMethod(m.header, m.end); placeMethodTab(m.header, m.end); }
    else { clearMethodHighlight(); hideMethodTab(); }
  }

  // After a row rebuild the tall method tab is detached. Re-stretch it over the
  // last-hovered method so it is not briefly missing under the pointer.
  function replaceAddAffordance() {
    if (!commenting || grain !== 'method' || hoverLn < 0) return;
    var m = methodFor(hoverLn);
    if (m) placeMethodTab(m.header, m.end);
  }
  // Position the tall method "+" tab over a method's whole line range, so the
  // affordance spans the method's height like the markdown block gutter button.
  function placeMethodTab(header, end) {
    if (!methodTab || !linesEl) return;
    var hRow = linesEl.querySelector('.sdoc-cl-row[data-ln="' + header + '"]');
    var eRow = linesEl.querySelector('.sdoc-cl-row[data-ln="' + end + '"]');
    if (!hRow) { hideMethodTab(); return; }
    if (!eRow || eRow.style.display === 'none') eRow = hRow;
    if (methodTab.parentNode !== linesEl) linesEl.appendChild(methodTab);
    var top = hRow.offsetTop;
    var bottom = eRow.offsetTop + eRow.offsetHeight;
    methodTab.style.top = top + 'px';
    methodTab.style.height = Math.max(bottom - top, 18) + 'px';
    methodTab.setAttribute('data-ln', header);
    methodTab.classList.add('show');
  }
  function hideMethodTab() {
    if (methodTab) methodTab.classList.remove('show');
  }

  var methodTab = null; // method grain: a tall "+" tab over the method range
  var hoverLn = -1;     // last row the pointer was over, to re-stretch the tab
                        // after a row rebuild (the one-shot highlight upgrade)

  function onCommentClick(e) {
    if (!commenting) return;
    var madd = e.target.closest('.sdoc-cc-madd');
    if (madd) {
      e.stopPropagation();
      var hl = parseInt(madd.getAttribute('data-ln'), 10);
      var mm = methodFor(hl);
      if (mm) openComposer({ kind: 'method', line: mm.header, endLine: mm.end, anchorText: trimmed(mm.header) });
      return;
    }
    var btn = e.target.closest('[data-cc]');
    var add = e.target.closest('.sdoc-cc-add');
    if (add) {
      e.stopPropagation();
      // Read the target from the row the + currently sits in, not a cached
      // attribute: a row rebuild can move the button between hover and click.
      var addRow = add.closest('.sdoc-cl-row');
      var ln = addRow ? parseInt(addRow.getAttribute('data-ln'), 10)
                      : parseInt(add.getAttribute('data-ln'), 10);
      if (isNaN(ln)) return;
      if (grain === 'method') {
        var m = methodFor(ln);
        if (m) { openComposer({ kind: 'method', line: m.header, endLine: m.end, anchorText: trimmed(m.header) }); return; }
      }
      openComposer({ kind: 'line', line: ln, anchorText: trimmed(ln) });
      return;
    }
    if (!btn) {
      // Click the card body (anywhere but an action button) to edit it, the same
      // affordance as the markdown card. The open composer's card is excluded.
      var card = e.target.closest('.sdoc-cc-card');
      if (!card || card.classList.contains('sdoc-cc-card-edit')) return;
      var tRow = card.closest('.sdoc-cc-thread');
      var cid = tRow && tRow.getAttribute('data-c');
      if (cid) { e.stopPropagation(); startEdit(cid); }
      return;
    }
    e.stopPropagation();
    var act = btn.getAttribute('data-cc');
    if (act === 'save') { saveComposer(btn.closest('.sdoc-cc-composer')); return; }
    if (act === 'cancel') { cancelComposer(); return; }
    var threadRow = btn.closest('.sdoc-cc-thread');
    var id = threadRow && threadRow.getAttribute('data-c');
    if (!id) return;
    if (act === 'delete') {
      comments = CC.removeComment(comments, id);
      saveComments();
      renderThreads();
    }
  }

  // Open the composer pre-filled over an existing note, replacing its card.
  function startEdit(id) {
    var c = comments.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    var ln = CC ? CC.resolveLine(c, srcLines) : c.line;
    if (ln < 0) return;
    openComposer({ kind: c.kind, line: ln, endLine: c.endLine, anchorText: c.anchorText, editId: id });
  }

  function onComposerKey(e) {
    if (!commenting) return;
    if (e.key !== 'Enter') return;
    var composer = e.target.closest && e.target.closest('.sdoc-cc-composer');
    if (!composer) return;
    if (e.metaKey || e.ctrlKey) { e.preventDefault(); saveComposer(composer); }
  }

  // Enter / leave comment mode. Folding, wrap, copy all keep working underneath.
  function setCommenting(on) {
    commenting = on;
    if (modal) modal.classList.toggle('sdoc-cc-on', on);
    var btn = modal && modal.querySelector('[data-act="comment"]');
    if (btn) { btn.classList.toggle('active', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    if (!on) { cancelComposer(); clearMethodHighlight(); hideMethodTab(); }
    renderThreads();
  }

  function setGrain(g) {
    grain = g === 'method' ? 'method' : 'line';
    saveGrain(grain);
    clearMethodHighlight();
    hideMethodTab();
    if (modal) modal.classList.toggle('sdoc-cc-grain-method', grain === 'method');
    var seg = modal && modal.querySelector('.sdoc-cc-grain');
    if (seg) {
      seg.querySelectorAll('[data-grain]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-grain') === grain);
      });
    }
  }

  // Jump the nav cursor to the next/previous comment (in source order), open its
  // method/line into view, and flash it. delta of 0 re-focuses the current one.
  function navComment(delta) {
    if (!comments.length) return;
    var ordered = comments.slice().sort(function (a, b) {
      var la = CC.resolveLine(a, srcLines), lb = CC.resolveLine(b, srcLines);
      return la - lb;
    });
    var idx = 0;
    for (var i = 0; i < ordered.length; i++) if (ordered[i].id === navId) { idx = i; break; }
    idx = (idx + delta + ordered.length) % ordered.length;
    var c = ordered[idx];
    navId = c.id;
    var ln = CC.resolveLine(c, srcLines);
    if (ln >= 0) {
      // Open any collapsed ancestor so the line is visible.
      revealLine(ln);
      var thread = linesEl.querySelector('.sdoc-cc-thread[data-c="' + c.id + '"]');
      var target = thread || linesEl.querySelector('.sdoc-cl-row[data-ln="' + ln + '"]');
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        flashThread(c.id);
        if (c.kind === 'method') highlightMethod(ln, c.endLine);
      }
    }
    updateCommentChrome();
  }

  // Expand any collapsed header that hides `ln`, so navigation can land on it.
  function revealLine(ln) {
    if (!collapsed || !collapsed.size) return;
    var changed = false;
    collapsed.forEach(function (h) {
      if (h < ln && folds[h] && folds[h].end >= ln) { collapsed.delete(h); changed = true; }
    });
    if (changed) { refreshFold(); syncFoldAllBtn(); }
  }

  function flashThread(id) {
    var el = linesEl.querySelector('.sdoc-cc-thread[data-c="' + id + '"] .sdoc-cc-card');
    if (!el) return;
    el.classList.remove('sdoc-cc-flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('sdoc-cc-flash');
  }

  // Keep the toolbar comment cluster in step: count, nav enablement, and the
  // little dot that marks the toggle when the file already carries notes.
  function updateCommentChrome() {
    if (!modal) return;
    var count = comments.length;
    var toggle = modal.querySelector('[data-act="comment"]');
    if (toggle) toggle.classList.toggle('has-notes', count > 0);
    // In the sub-bar: the note nav appears once there are notes; the "how to add"
    // hint shows until then. The grain toggle is always present in the sub-bar
    // (the sub-bar itself only shows in comment mode).
    var nav = modal.querySelector('.sdoc-cc-nav');
    if (nav) {
      nav.style.display = count > 0 ? '' : 'none';
      var label = nav.querySelector('.sdoc-cc-count');
      if (label) label.textContent = count === 1 ? '1 note' : count + ' notes';
    }
    var hint = modal.querySelector('.sdoc-cc-subbar-hint');
    if (hint) hint.style.display = count > 0 ? 'none' : '';
    var copyc = modal.querySelector('.sdoc-cc-copyc');
    if (copyc) copyc.style.display = count > 0 ? '' : 'none';
  }

  // Copy the whole source plus its notes as one annotated block (see the model's
  // serializeAnnotations). The code analogue of the markdown copy-with-comments.
  function fileNameForCopy() {
    var fullPath = S.localMeta && S.localMeta.fullPath;
    return (S.currentMeta && S.currentMeta.file) || (fullPath ? basename(fullPath) : '') || 'code';
  }
  function copyWithComments(btn) {
    if (!CC || !navigator.clipboard) return;
    var text = CC.serializeAnnotations(comments, srcLines, { fileName: fileNameForCopy(), lang: currentLang });
    navigator.clipboard.writeText(text).then(function () {
      var label = btn && btn.querySelector('.sdoc-code-focus-action-label');
      if (!label) return;
      var prev = label.textContent;
      label.textContent = 'Copied';
      setTimeout(function () { if (label) label.textContent = prev; }, 1500);
    });
  }

  S.codeFocus = { open: open, close: close };
})();
