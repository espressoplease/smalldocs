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
    /* Bottom tab strip (Excel / Sheets): present only for a multi-tab workbook, */
    /* which adds a fourth grid row under the stage.                             */
    '.sdoc-cells-focus.has-tabs { grid-template-rows: 40px 31px 1fr auto; }',
    '.sdoc-cells-focus-tabs {',
    '  display: flex; align-items: stretch; height: 34px; gap: 1px;',
    '  padding: 0 6px; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin;',
    '  background: color-mix(in oklab, var(--sdoc-focus-bg, #fff) 92%, var(--sdoc-focus-fg, #1c1917) 8%);',
    '  border-top: 1px solid color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 14%, transparent);',
    '}',
    '.sdoc-cells-focus-tab {',
    '  all: unset; cursor: pointer; display: inline-flex; align-items: center;',
    '  padding: 0 14px; font-size: 12.5px; white-space: nowrap; flex-shrink: 0;',
    '  color: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 60%, var(--sdoc-focus-bg, #fff) 40%);',
    '  border-top: 2px solid transparent;',
    '}',
    '.sdoc-cells-focus-tab:hover {',
    '  color: var(--sdoc-focus-fg, #1c1917);',
    '  background: color-mix(in oklab, var(--sdoc-focus-fg, #1c1917) 5%, transparent);',
    '}',
    '.sdoc-cells-focus-tab.is-active {',
    '  color: var(--sdoc-focus-fg, #1c1917); font-weight: 600;',
    '  background: var(--sdoc-focus-bg, #fff);',
    '  border-top-color: #1e8e3e;',
    '}',
    '.sdoc-cells-focus-tab:focus-visible { outline: 1px solid #3B82F6; outline-offset: -2px; }',
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
                editApi: null, entries: null, activeIndex: -1, edited: null };

  function findEntry(model) {
    if (!state.entries) return null;
    for (var i = 0; i < state.entries.length; i++) {
      if (state.entries[i].model === model) return state.entries[i];
    }
    return null;
  }

  // Each tab whose model was edited gets its inline grid repainted (and its
  // "edited" pill shown) when the overlay closes - edits mutate the shared
  // model objects, so the inline grids just need to re-render.
  function repaintEdited() {
    if (!state.edited) return;
    state.edited.forEach(function (m) {
      var entry = findEntry(m);
      if (!entry || !entry.wrapper) return;
      if (S.onCellsEdited) { try { S.onCellsEdited(m, entry.wrapper); } catch (_) {} }
      if (entry.wrapper._cellsRepaint) { try { entry.wrapper._cellsRepaint(); } catch (_) {} }
    });
  }

  function close() {
    if (!state.modal) return;
    if (state.editApi) { try { state.editApi.detach(); } catch (_) {} }
    if (state.keyHandler) window.removeEventListener('keydown', state.keyHandler);
    state.keyHandler = null;
    state.modal.remove();
    state.modal = null;
    document.body.classList.remove('sdoc-cells-focus-open');
    repaintEdited();
    state.editApi = null; state.entries = null; state.edited = null; state.activeIndex = -1;
    if (state.prevFocus && state.prevFocus.focus) { try { state.prevFocus.focus(); } catch (_) {} }
    state.prevFocus = null;
  }

  // The tab list for `model`: every tab of its workbook (so the strip can
  // switch between them), or a single anonymous entry for a standalone grid.
  function entriesFor(model, inlineWrapper) {
    var wb = S.cellsWorkbook;
    if (wb && wb.length) {
      for (var i = 0; i < wb.length; i++) {
        if (wb[i].model === model) return wb.slice();
      }
    }
    return [{ name: '', model: model, wrapper: inlineWrapper }];
  }

  function open(model, inlineWrapper) {
    if (!model || model.empty || !S.buildCellsGrid) return;
    if (state.modal) close();
    state.prevFocus = document.activeElement;
    state.edited = [];

    var entries = entriesFor(model, inlineWrapper);
    state.entries = entries;
    var activeIndex = 0;
    for (var ei = 0; ei < entries.length; ei++) { if (entries[ei].model === model) { activeIndex = ei; break; } }
    var tabbed = entries.length > 1;

    var modal = document.createElement('div');
    modal.className = 'sdoc-cells-focus' + (tabbed ? ' has-tabs' : '');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Sheet fullscreen view');
    forwardVars(modal);

    // ── Topbar skeleton: brand + filename + (per-sheet) actions + close ──
    var topbar = document.createElement('div');
    topbar.className = 'sdoc-cells-focus-topbar';
    var brand = document.createElement('span');
    brand.className = 'sdoc-cells-focus-brand';
    brand.innerHTML = '<span class="sdoc-cells-focus-brand-full">SmallDocs</span>' +
      '<span class="sdoc-cells-focus-brand-tiny">SD</span>' +
      '<span class="sdoc-cells-focus-brand-suf">Sheet</span>';
    topbar.appendChild(brand);
    var fileSpan = document.createElement('span');
    fileSpan.className = 'sdoc-cells-focus-file';
    topbar.appendChild(fileSpan);
    // The close button is pinned as the last topbar child; the per-sheet copy
    // actions are inserted just before it (and replaced when the tab changes).
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sdoc-cells-focus-close';
    closeBtn.title = 'Close (Esc)';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = X_ICON;
    closeBtn.addEventListener('click', close);
    topbar.appendChild(closeBtn);

    // ── Name box / selection stats / value bar (static; reads the active grid) ──
    var bar = document.createElement('div');
    bar.className = 'sdoc-cells-focus-bar';
    var nameBox = document.createElement('div');
    nameBox.className = 'sdoc-cells-focus-name';
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

    var stage = document.createElement('div');
    stage.className = 'sdoc-cells-focus-stage';

    // ── Tab strip (only when the workbook has more than one tab) ──
    var tabButtons = [];
    var tabStrip = null;
    if (tabbed) {
      tabStrip = document.createElement('div');
      tabStrip.className = 'sdoc-cells-focus-tabs';
      tabStrip.setAttribute('role', 'tablist');
      entries.forEach(function (entry, i) {
        var tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'sdoc-cells-focus-tab';
        tab.setAttribute('role', 'tab');
        tab.textContent = entry.name || ('Sheet' + (i + 1));   // textContent - untrusted name
        tab.addEventListener('click', function () { mountSheet(i); });
        tabStrip.appendChild(tab);
        tabButtons.push(tab);
      });
    }

    // The active grid + its actions, swapped by mountSheet.
    var activeWrap = null, activeModel = null, activeActions = null;

    function focusGrid() {
      var g = activeWrap && activeWrap.querySelector('.sdoc-cells-grid');
      if (g) { try { g.focus({ preventScroll: true }); } catch (_) {} }
    }
    // Keep the name box, stats, and value field in sync with the active grid's
    // selection. Skipped while the formula bar itself is focused.
    function syncSelection(d) {
      if (!activeWrap) return;
      if (!d || d.empty) { nameBox.textContent = ''; valueBox.value = ''; stats.textContent = ''; return; }
      var vm = activeWrap._cellsModel || activeModel;   // effective (sorted) view
      var addr = CELLS.colName(d.c0) + (d.r0 + 1);
      nameBox.textContent = d.single ? addr : addr + ':' + CELLS.colName(d.c1) + (d.r1 + 1);
      var cell = vm.cells[d.r0] && vm.cells[d.r0][d.c0];
      if (document.activeElement !== valueBox) valueBox.value = cell ? cell.raw : '';
      stats.textContent = S.formatCellsStats
        ? S.formatCellsStats(vm, d, activeWrap._cellsFxView) : '';
    }
    valueBox.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (state.editApi) state.editApi.setActiveRaw(valueBox.value, true);
        focusGrid();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        syncSelection(activeWrap && activeWrap._cellsSelection);
        focusGrid();
      }
      e.stopPropagation();
    });

    // Build (or rebuild) the active sheet into the stage: a fresh grid, its copy
    // controls + formula toggle, selection wiring, and the editor. Cross-tab
    // refs resolve because buildGrid's paint computes against the whole workbook
    // (S.cellsWorkbookFx) when there is no precomputed slice.
    function mountSheet(index) {
      if (index < 0 || index >= entries.length) return;
      if (state.editApi) { try { state.editApi.detach(); } catch (_) {} state.editApi = null; }
      var entry = entries[index];
      var m = entry.model;

      while (stage.firstChild) stage.removeChild(stage.firstChild);
      var gridWrap = S.buildCellsGrid(m, { fullscreen: true });
      stage.appendChild(gridWrap);
      activeWrap = gridWrap; activeModel = m;
      state.activeIndex = index;
      fileSpan.textContent = m.source || '';

      // Copy controls (+ a raw "formulas" button when the sheet has formulas)
      // and the =fx formula-view toggle, rebuilt for this sheet and swapped in.
      var hasFormulas = (m.cells || []).some(function (row) {
        return (row || []).some(function (cl) {
          return cl && cl.raw && cl.raw.charAt(0) === '=' && cl.raw.length > 1;
        });
      });
      var actions = S.buildCellsCopyControls
        ? S.buildCellsCopyControls(gridWrap, m, { rawButton: hasFormulas }).box
        : document.createElement('div');
      actions.classList.add('sdoc-cells-focus-actions');
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
      if (activeActions) topbar.removeChild(activeActions);
      topbar.insertBefore(actions, closeBtn);
      activeActions = actions;

      gridWrap.addEventListener('cells-selection', function (e) { syncSelection(e.detail); });
      if (S.cellsEdit && S.cellsEdit.attach) {
        state.editApi = S.cellsEdit.attach(gridWrap, {
          valueInput: valueBox,
          onChange: function () {
            if (state.edited.indexOf(m) === -1) state.edited.push(m);
            syncSelection(gridWrap._cellsSelection);
          },
        });
      }

      tabButtons.forEach(function (t, i) {
        t.classList.toggle('is-active', i === index);
        t.setAttribute('aria-selected', i === index ? 'true' : 'false');
      });

      var gridEl = gridWrap.querySelector('.sdoc-cells-grid');
      if (gridEl) { try { gridEl.focus(); } catch (_) {} }
    }

    modal.appendChild(topbar);
    modal.appendChild(bar);
    modal.appendChild(stage);
    if (tabStrip) modal.appendChild(tabStrip);
    document.body.appendChild(modal);
    document.body.classList.add('sdoc-cells-focus-open');
    state.modal = modal;

    state.keyHandler = function (e) { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    window.addEventListener('keydown', state.keyHandler);

    mountSheet(activeIndex);
  }

  S.cellsFocus = { open: open, close: close };
})();
