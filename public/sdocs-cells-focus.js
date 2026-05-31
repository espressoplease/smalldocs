// sdocs-cells-focus.js - fullscreen "focus" overlay for an inline ```cells
// sheet, opened by the expand button in the sheet's toolbar.
//
// Light, themed surface (mirrors sdocs-mermaid-focus.js): a fixed layer over
// everything, dressed in the document's colours, with a slim topbar, a
// spreadsheet name box / value bar, and the SAME grid (buildGrid in
// fullscreen mode) dropped in - vertical + horizontal scroll, frozen headers,
// the full (uncapped) data, and the selection + copy you already have. Esc or
// the close button exits.
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var S = window.SDocs;
  if (!S) return;
  var CELLS = window.SDocCells;

  var CSS_ID = 'sdocs-cells-focus-css';
  var CSS = [
    '.sdoc-cells-focus {',
    '  position: fixed; inset: 0; z-index: 10100;',
    '  background: var(--sdoc-focus-bg, #ffffff);',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '  display: grid; grid-template-rows: 40px 31px 1fr 26px;',
    '  font-family: var(--md-font-family, ui-sans-serif, system-ui, sans-serif);',
    '  animation: sdoc-cells-focus-fade .15s ease-out;',
    '}',
    '@keyframes sdoc-cells-focus-fade { from { opacity: 0 } to { opacity: 1 } }',
    '.sdoc-cells-focus-topbar {',
    '  display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px;',
    '  background: color-mix(in oklab, var(--sdoc-focus-bg, #fff) 92%, var(--sdoc-focus-fg, #1c1917) 8%);',
    '  border-bottom: 1px solid color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 14%, transparent);',
    '}',
    '.sdoc-cells-focus-brand { display: inline-flex; align-items: baseline; color: #3B82F6; font-size: 13px; font-weight: 600; }',
    '.sdoc-cells-focus-brand-suf { color: var(--sdoc-focus-fg, #1c1917); font-weight: 400; margin-left: 4px; }',
    '.sdoc-cells-focus-file { font-size: 12px; color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 58%, var(--sdoc-focus-bg, #fff) 42%); }',
    '.sdoc-cells-focus-actions { margin-left: auto; display: flex; align-items: center; gap: 6px; }',
    /* Close: a 28x28 square icon button, matching the other overlays. */
    '.sdoc-cells-focus-close {',
    '  all: unset; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;',
    '  width: 28px; height: 28px; border-radius: 4px;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 75%, transparent);',
    '  transition: background .12s, color .12s;',
    '}',
    '.sdoc-cells-focus-close:hover { background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 8%, transparent); color: var(--sdoc-focus-fg, #1c1917); }',
    '.sdoc-cells-focus-close:focus-visible { outline: 1px solid #3B82F6; outline-offset: 1px; }',
    /* The copy buttons are reused from the inline toolbar; inside the overlay */
    /* they adopt the same resting + hover chrome as the close, so close /     */
    /* copy / copy-selection share one consistent expanded-menu treatment.     */
    '.sdoc-cells-focus .sdoc-cells-copy,',
    '.sdoc-cells-focus .sdoc-cells-copy-icon {',
    '  opacity: 1; background: transparent;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 75%, transparent);',
    '}',
    '.sdoc-cells-focus .sdoc-cells-copy { border-color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 18%, transparent); }',
    '.sdoc-cells-focus .sdoc-cells-copy:hover,',
    '.sdoc-cells-focus .sdoc-cells-copy-icon:hover {',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 8%, transparent);',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '}',
    '.sdoc-cells-focus .sdoc-cells-copy:hover { border-color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 32%, transparent); }',
    /* Name box + value/formula bar - the classic spreadsheet header. */
    '.sdoc-cells-focus-bar {',
    '  display: flex; align-items: stretch; height: 31px; font-size: 13px;',
    '  background: var(--sdoc-focus-bg, #fff);',
    '  border-bottom: 1px solid color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 14%, transparent);',
    '}',
    '.sdoc-cells-focus-name {',
    '  width: 92px; flex-shrink: 0; display: flex; align-items: center; padding: 0 10px;',
    '  border-right: 1px solid color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 14%, transparent);',
    '  font-variant-numeric: tabular-nums; font-weight: 500;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 75%, var(--sdoc-focus-bg, #fff) 25%);',
    '}',
    '.sdoc-cells-focus-value {',
    '  flex: 1; display: flex; align-items: center; padding: 0 12px;',
    '  white-space: pre; overflow: hidden; text-overflow: ellipsis;',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '}',
    '.sdoc-cells-focus-stage { min-height: 0; overflow: hidden; }',
    /* Status footer: Sum / Avg / Count of the selection, like Excel/Sheets. */
    '.sdoc-cells-focus-status {',
    '  display: flex; align-items: center; justify-content: flex-end;',
    '  height: 26px; padding: 0 14px; font-size: 12px; font-variant-numeric: tabular-nums;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 60%, var(--sdoc-focus-bg, #fff) 40%);',
    '  border-top: 1px solid color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 14%, transparent);',
    '  background: color-mix(in oklab, var(--sdoc-focus-bg, #fff) 92%, var(--sdoc-focus-fg, #1c1917) 8%);',
    '}',
    /* The grid wrapper fills the stage and scrolls both axes; no border / */
    /* radius / hug-width here - the overlay is the frame. */
    '.sdoc-cells-focus-stage .sdoc-cells-fs {',
    '  width: 100%; height: 100%; max-width: none; margin: 0; border: none; border-radius: 0;',
    '  display: flex; flex-direction: column;',
    '}',
    '.sdoc-cells-focus-stage .sdoc-cells-fs .sdoc-cells-scroll { flex: 1; min-height: 0; overflow: auto; }',
    'body.sdoc-cells-focus-open { overflow: hidden; }',
  ].join('\n');

  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID; s.textContent = CSS;
    document.head.appendChild(s);
  }
  if (typeof document !== 'undefined') injectCSS();

  function lucide(paths, size) {
    var sz = size || 14;
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + paths + '</svg>';
  }
  var X_ICON = lucide('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');

  // The overlay lives outside #_sd_rendered, so forward the document's theme
  // tokens onto it (mirrors sdocs-mermaid-focus.js).
  function forwardVars(modal) {
    var rendered = document.getElementById('_sd_rendered');
    if (!rendered) return;
    var cs = getComputedStyle(rendered);
    var bg = (cs.getPropertyValue('--md-bg') || '').trim() || cs.backgroundColor;
    var fg = (cs.getPropertyValue('--md-color') || '').trim() || cs.color;
    if (bg) modal.style.setProperty('--sdoc-focus-bg', bg);
    if (fg) modal.style.setProperty('--sdoc-focus-fg', fg);
    // The grid sizes its font as 0.9em - inherit the document's font-size (not
    // <body>'s) so the cells render at the same size as inline.
    if (cs.fontSize) modal.style.fontSize = cs.fontSize;
    ['--md-bg', '--md-color', '--md-block-bg', '--md-block-text', '--md-font-family',
     '--md-table-border', '--border', '--text-2', '--text', '--bg-hover',
     '--border-strong', '--md-copy-btn-hover']
      .forEach(function (v) {
        var val = (cs.getPropertyValue(v) || '').trim();
        if (val) modal.style.setProperty(v, val);
      });
  }

  var state = { modal: null, prevFocus: null, keyHandler: null };

  function close() {
    if (!state.modal) return;
    if (state.keyHandler) window.removeEventListener('keydown', state.keyHandler);
    state.keyHandler = null;
    state.modal.remove();
    state.modal = null;
    document.body.classList.remove('sdoc-cells-focus-open');
    if (state.prevFocus && state.prevFocus.focus) { try { state.prevFocus.focus(); } catch (_) {} }
    state.prevFocus = null;
  }

  function open(model) {
    if (!model || model.empty || !S.buildCellsGrid) return;
    if (state.modal) close();
    state.prevFocus = document.activeElement;

    var modal = document.createElement('div');
    modal.className = 'sdoc-cells-focus';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Sheet fullscreen view');
    forwardVars(modal);

    // ── Stage: the full grid (built first so the topbar's copy controls can
    // listen to its selection) ──
    var stage = document.createElement('div');
    stage.className = 'sdoc-cells-focus-stage';
    var gridWrap = S.buildCellsGrid(model, { fullscreen: true });
    stage.appendChild(gridWrap);

    // ── Topbar: brand + filename + copy controls + close ──
    var topbar = document.createElement('div');
    topbar.className = 'sdoc-cells-focus-topbar';
    var brand = document.createElement('span');
    brand.className = 'sdoc-cells-focus-brand';
    brand.innerHTML = 'SmallDocs<span class="sdoc-cells-focus-brand-suf">Sheet</span>';
    topbar.appendChild(brand);
    if (model.source) {
      var file = document.createElement('span');
      file.className = 'sdoc-cells-focus-file';
      file.textContent = model.source;          // plain text - no markup
      topbar.appendChild(file);
    }
    // Same copy behaviour as inline: whole-sheet icon + dynamic cell/selection.
    var actions = S.buildCellsCopyControls
      ? S.buildCellsCopyControls(gridWrap, model).box
      : document.createElement('div');
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sdoc-cells-focus-close';
    closeBtn.title = 'Close (Esc)';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = X_ICON;
    closeBtn.addEventListener('click', close);
    actions.appendChild(closeBtn);
    topbar.appendChild(actions);

    // ── Name box / value bar ──
    var bar = document.createElement('div');
    bar.className = 'sdoc-cells-focus-bar';
    var nameBox = document.createElement('div');
    nameBox.className = 'sdoc-cells-focus-name';
    var valueBox = document.createElement('div');
    valueBox.className = 'sdoc-cells-focus-value';
    bar.appendChild(nameBox);
    bar.appendChild(valueBox);

    // Status footer: Sum / Avg / Count of the selection.
    var status = document.createElement('div');
    status.className = 'sdoc-cells-focus-status';

    // Keep the name box, value field, and status footer in sync with selection.
    gridWrap.addEventListener('cells-selection', function (e) {
      var d = e.detail;
      if (!d || d.empty) { nameBox.textContent = ''; valueBox.textContent = ''; status.textContent = ''; return; }
      var vm = gridWrap._cellsModel || model;       // effective (sorted) view
      var addr = CELLS.colName(d.c0) + (d.r0 + 1);
      nameBox.textContent = d.single ? addr : addr + ':' + CELLS.colName(d.c1) + (d.r1 + 1);
      var cell = vm.cells[d.r0] && vm.cells[d.r0][d.c0];
      valueBox.textContent = cell ? cell.raw : '';
      status.textContent = S.formatCellsStats ? S.formatCellsStats(vm, d) : '';
    });

    modal.appendChild(topbar);
    modal.appendChild(bar);
    modal.appendChild(stage);
    modal.appendChild(status);
    document.body.appendChild(modal);
    document.body.classList.add('sdoc-cells-focus-open');
    state.modal = modal;

    state.keyHandler = function (e) { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    window.addEventListener('keydown', state.keyHandler);

    // Focus the grid so arrows work straight away (its focus handler selects A1).
    var gridEl = gridWrap.querySelector('.sdoc-cells-grid');
    if (gridEl) { try { gridEl.focus(); } catch (_) {} }
  }

  S.cellsFocus = { open: open, close: close };
})();
