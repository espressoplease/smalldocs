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
    /* minmax(0, 1fr) column: a row whose content is wider than the viewport */
    /* scrolls inside itself instead of blowing the overlay out sideways.    */
    '  display: grid; grid-template-rows: 40px 31px 1fr; grid-template-columns: minmax(0, 1fr);',
    '  font-family: var(--md-font-family, ui-sans-serif, system-ui, sans-serif);',
    '  animation: sdoc-cells-focus-fade .15s ease-out;',
    '}',
    '@keyframes sdoc-cells-focus-fade { from { opacity: 0 } to { opacity: 1 } }',
    '.sdoc-cells-focus-topbar {',
    '  display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px;',
    '  background: color-mix(in oklab, var(--sdoc-focus-bg, #fff) 92%, var(--sdoc-focus-fg, #1c1917) 8%);',
    '  border-bottom: 1px solid color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 14%, transparent);',
    '}',
    '.sdoc-cells-focus-brand { display: inline-flex; align-items: baseline; color: #3B82F6; font-size: 13px; font-weight: 600; flex-shrink: 0; }',
    '.sdoc-cells-focus-brand-suf { color: var(--sdoc-focus-fg, #1c1917); font-weight: 400; margin-left: 4px; }',
    /* Brand variants: "SmallDocs" on desktop, "SD" on narrow screens - same */
    /* treatment as the main topbar brand.                                    */
    '.sdoc-cells-focus-brand-tiny { display: none; }',
    '.sdoc-cells-focus-file { font-size: 12px; color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 58%, var(--sdoc-focus-bg, #fff) 42%); }',
    /* Actions scroll horizontally when they overflow (hidden scrollbars, the */
    /* standard toolbar pattern); each child keeps its natural width.         */
    '.sdoc-cells-focus-actions {',
    '  margin-left: auto; display: flex; align-items: center; gap: 6px; min-width: 0;',
    '  overflow-x: auto; overflow-y: hidden; scrollbar-width: none;',
    '}',
    '.sdoc-cells-focus-actions::-webkit-scrollbar { display: none; }',
    '.sdoc-cells-focus-actions > * { flex-shrink: 0; }',
    /* Close: a 28x28 square icon button, matching the other overlays. It is */
    /* a direct child of the topbar (not the scrollable actions group) so it */
    /* can never be scrolled or pushed off-screen.                           */
    '.sdoc-cells-focus-close {',
    '  all: unset; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;',
    '  width: 28px; height: 28px; border-radius: 4px; flex-shrink: 0;',
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
    /* Formula view toggle: a small "=fx" ghost button; accent when active. */
    '.sdoc-cells-fx-toggle {',
    '  all: unset; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;',
    '  height: 28px; padding: 0 8px; border-radius: 4px;',
    '  font-size: 12px; font-weight: 600; font-style: italic; font-family: ui-serif, Georgia, serif;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 75%, transparent);',
    '  transition: background .12s, color .12s;',
    '}',
    '.sdoc-cells-fx-toggle:hover { background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 8%, transparent); color: var(--sdoc-focus-fg, #1c1917); }',
    '.sdoc-cells-fx-toggle.is-on { background: rgba(139, 92, 246, 0.15); color: #7c4fe0; }',
    '.sdoc-cells-fx-toggle:focus-visible { outline: 1px solid #3B82F6; outline-offset: 1px; }',
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
    /* Selection stats (Sum / Avg / Min / Max / Count): a quiet segment right */
    /* of the name box. :empty collapses it (single cell / no selection) so   */
    /* the formula bar gets the full width back.                              */
    '.sdoc-cells-focus-stats {',
    '  flex-shrink: 0; display: flex; align-items: center; padding: 0 12px;',
    '  font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 60%, var(--sdoc-focus-bg, #fff) 40%);',
    '  background: color-mix(in oklab, var(--sdoc-focus-bg, #fff) 95%, var(--sdoc-focus-fg, #1c1917) 5%);',
    '  border-right: 1px solid color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 14%, transparent);',
    '}',
    '.sdoc-cells-focus-stats:empty { display: none; }',
    /* The value field is an <input> (the formula bar): strip native chrome so */
    /* it reads as a flat bar, with a faint accent underline when focused.     */
    '.sdoc-cells-focus-value {',
    '  flex: 1; min-width: 0; padding: 0 12px;',
    '  background: transparent; border: none; outline: none;',
    '  border-bottom: 1.5px solid transparent;',
    '  font: inherit; color: var(--sdoc-focus-fg, #1c1917);',
    '  white-space: pre; overflow: hidden; text-overflow: ellipsis;',
    '}',
    '.sdoc-cells-focus-value:focus { border-bottom-color: #3B82F6; }',
    '.sdoc-cells-focus-stage { min-height: 0; overflow: hidden; }',
    /* The grid wrapper fills the stage and scrolls both axes; no border / */
    /* radius / hug-width here - the overlay is the frame. */
    '.sdoc-cells-focus-stage .sdoc-cells-fs {',
    '  width: 100%; height: 100%; max-width: none; margin: 0; border: none; border-radius: 0;',
    '  display: flex; flex-direction: column;',
    '}',
    '.sdoc-cells-focus-stage .sdoc-cells-fs .sdoc-cells-scroll { flex: 1; min-height: 0; overflow: auto; }',
    'body.sdoc-cells-focus-open { overflow: hidden; }',
    /* Narrow screens: abbreviate the brand, drop the filename, tighten the   */
    /* padding. The actions group scrolls; the close button stays pinned.     */
    '@media (max-width: 560px) {',
    '  .sdoc-cells-focus-topbar { gap: 6px; padding: 0 8px; }',
    '  .sdoc-cells-focus-brand-full { display: none; }',
    '  .sdoc-cells-focus-brand-tiny { display: inline; }',
    '  .sdoc-cells-focus-file { display: none; }',
    /* The name box shrinks and the stats segment scrolls in place, so the   */
    /* formula bar keeps some width instead of being pushed off-screen.      */
    '  .sdoc-cells-focus-name { width: auto; min-width: 56px; padding: 0 8px; }',
    '  .sdoc-cells-focus-stats {',
    '    flex-shrink: 1; min-width: 0; overflow-x: auto; scrollbar-width: none;',
    '  }',
    '  .sdoc-cells-focus-stats::-webkit-scrollbar { display: none; }',
    '}',
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

  var state = { modal: null, prevFocus: null, keyHandler: null,
                editApi: null, dirty: false, inlineWrapper: null, model: null };

  function close() {
    if (!state.modal) return;
    if (state.editApi) { try { state.editApi.detach(); } catch (_) {} }
    if (state.keyHandler) window.removeEventListener('keydown', state.keyHandler);
    state.keyHandler = null;
    state.modal.remove();
    state.modal = null;
    document.body.classList.remove('sdoc-cells-focus-open');
    // Edits mutate the shared model object, so the inline grid only needs a
    // repaint to reflect them; the app can persist if it wants to. Mark the
    // wrapper edited BEFORE repainting so the repaint recomputes this sheet
    // (the once-per-document workbook results no longer match the edited model).
    if (state.dirty && S.onCellsEdited) { try { S.onCellsEdited(state.model, state.inlineWrapper); } catch (_) {} }
    if (state.dirty && state.inlineWrapper && state.inlineWrapper._cellsRepaint) {
      try { state.inlineWrapper._cellsRepaint(); } catch (_) {}
    }
    state.editApi = null; state.dirty = false; state.inlineWrapper = null; state.model = null;
    if (state.prevFocus && state.prevFocus.focus) { try { state.prevFocus.focus(); } catch (_) {} }
    state.prevFocus = null;
  }

  function open(model, inlineWrapper) {
    if (!model || model.empty || !S.buildCellsGrid) return;
    if (state.modal) close();
    state.prevFocus = document.activeElement;
    state.model = model;
    state.inlineWrapper = inlineWrapper || null;
    state.dirty = false;

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
    brand.innerHTML = '<span class="sdoc-cells-focus-brand-full">SmallDocs</span>' +
      '<span class="sdoc-cells-focus-brand-tiny">SD</span>' +
      '<span class="sdoc-cells-focus-brand-suf">Sheet</span>';
    topbar.appendChild(brand);
    if (model.source) {
      var file = document.createElement('span');
      file.className = 'sdoc-cells-focus-file';
      file.textContent = model.source;          // plain text - no markup
      topbar.appendChild(file);
    }
    // Same copy behaviour as inline (buttons copy computed values), plus a
    // "formulas" button to copy the raw data when the sheet holds formulas.
    var hasFormulas = (model.cells || []).some(function (row) {
      return (row || []).some(function (cl) {
        return cl && cl.raw && cl.raw.charAt(0) === '=' && cl.raw.length > 1;
      });
    });
    var actions = S.buildCellsCopyControls
      ? S.buildCellsCopyControls(gridWrap, model, { rawButton: hasFormulas }).box
      : document.createElement('div');
    // The box comes from the shared copy-controls builder with its own class;
    // this one adds the focus-topbar layout (scrollable, pinned-close layout).
    actions.classList.add('sdoc-cells-focus-actions');
    // Formula view toggle - only when the sheet actually contains formulas.
    // On: every formula cell shows its "=..." source (and stays editable in
    // place); off: computed values. The selection survives the repaint.
    if (hasFormulas) {
      var fxBtn = document.createElement('button');
      fxBtn.type = 'button';
      fxBtn.className = 'sdoc-cells-fx-toggle';
      fxBtn.title = 'Show formulas';
      fxBtn.setAttribute('aria-label', 'Show formulas');
      fxBtn.textContent = '=fx';
      fxBtn.addEventListener('click', function () {
        gridWrap._cellsShowFormulas = !gridWrap._cellsShowFormulas;
        fxBtn.classList.toggle('is-on', !!gridWrap._cellsShowFormulas);
        fxBtn.title = gridWrap._cellsShowFormulas ? 'Show values' : 'Show formulas';
        var gridEl2 = gridWrap.querySelector('.sdoc-cells-grid');
        var rect = gridEl2 && gridEl2._selectionRect ? gridEl2._selectionRect() : null;
        if (gridWrap._cellsRepaint) gridWrap._cellsRepaint();
        if (rect && gridEl2 && gridEl2._moveTo) {
          gridEl2._moveTo(rect.r0, rect.c0, false);
          gridEl2._extendTo(rect.r1, rect.c1, false);
        }
      });
      actions.appendChild(fxBtn);
    }
    topbar.appendChild(actions);
    // The close button lives outside the scrollable actions group, pinned as
    // the topbar's last child, so it stays reachable on any screen width.
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sdoc-cells-focus-close';
    closeBtn.title = 'Close (Esc)';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = X_ICON;
    closeBtn.addEventListener('click', close);
    topbar.appendChild(closeBtn);

    // ── Name box / selection stats / value bar ──
    var bar = document.createElement('div');
    bar.className = 'sdoc-cells-focus-bar';
    var nameBox = document.createElement('div');
    nameBox.className = 'sdoc-cells-focus-name';
    // Sum / Avg / Min / Max / Count of the selection, right of the address.
    var stats = document.createElement('div');
    stats.className = 'sdoc-cells-focus-stats';
    var valueBox = document.createElement('input');
    valueBox.type = 'text';
    valueBox.spellcheck = false;
    valueBox.className = 'sdoc-cells-focus-value';
    valueBox.setAttribute('aria-label', 'Cell value / formula');
    bar.appendChild(nameBox);
    bar.appendChild(stats);
    bar.appendChild(valueBox);

    function focusGrid() {
      var g = gridWrap.querySelector('.sdoc-cells-grid');
      if (g) { try { g.focus({ preventScroll: true }); } catch (_) {} }
    }
    // Formula bar: Enter commits to the active cell and steps down; Esc reverts
    // the field to the selected cell's raw and returns focus to the grid.
    valueBox.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (state.editApi) state.editApi.setActiveRaw(valueBox.value, true);
        focusGrid();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        syncSelection(gridWrap._cellsSelection);
        focusGrid();
      }
      e.stopPropagation();
    });

    // Keep the name box, stats segment, and value field in sync with selection.
    // Skipped while the formula bar itself is focused, so typing there is not
    // clobbered by a programmatic reselect.
    function syncSelection(d) {
      if (!d || d.empty) { nameBox.textContent = ''; valueBox.value = ''; stats.textContent = ''; return; }
      var vm = gridWrap._cellsModel || model;       // effective (sorted) view
      var addr = CELLS.colName(d.c0) + (d.r0 + 1);
      nameBox.textContent = d.single ? addr : addr + ':' + CELLS.colName(d.c1) + (d.r1 + 1);
      var cell = vm.cells[d.r0] && vm.cells[d.r0][d.c0];
      if (document.activeElement !== valueBox) valueBox.value = cell ? cell.raw : '';
      // The display-aligned formula results let computed cells count toward
      // Sum / Avg / Min / Max instead of reading as text.
      stats.textContent = S.formatCellsStats
        ? S.formatCellsStats(vm, d, gridWrap._cellsFxView) : '';
    }
    gridWrap.addEventListener('cells-selection', function (e) { syncSelection(e.detail); });

    // Client-only editing: type into the sheet, =formulas, undo/redo, paste.
    // Edits mutate the shared model object; the inline grid is repainted on
    // close so they appear there too.
    if (S.cellsEdit && S.cellsEdit.attach) {
      state.editApi = S.cellsEdit.attach(gridWrap, {
        valueInput: valueBox,
        onChange: function () { state.dirty = true; syncSelection(gridWrap._cellsSelection); },
      });
    }

    modal.appendChild(topbar);
    modal.appendChild(bar);
    modal.appendChild(stage);
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
