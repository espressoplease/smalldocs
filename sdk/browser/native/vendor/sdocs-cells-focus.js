// sdocs-cells-focus.js - fullscreen "focus" overlay for an inline ```cells
// sheet, opened by the expand button in the sheet's toolbar.
//
// Light, themed surface (mirrors sdocs-mermaid-focus.js): a fixed layer over
// everything, dressed in the document's colours, with a slim topbar, a
// spreadsheet name box / value bar, and the SAME grid (buildGrid in
// fullscreen mode) dropped in - vertical + horizontal scroll, frozen headers,
// the full (uncapped) data, and the selection + copy you already have. Esc or
// the close button exits.
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (root) {
    root.SDocCellsFocus = api;
    api.installProduction(root);
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';


  function create(options) {
  options = options || {};
  var window = options.window;
  var document = options.document || (window && window.document);
  var CELLS = options.cells;
  var FORMULA = options.formula || null;
  var controller = options.controller || null;
  var editor = options.editor || null;
  var buildGrid = options.buildGrid;
  var buildCopyControls = options.buildCopyControls;
  var formatStats = options.formatStats;
  var setKnownHTML = options.setKnownHTML || function (target, html) { target.innerHTML = html; };
  var controls = options.controls || {};
  var destroyed = false;
  if (!window || !document) throw new Error('Cells focus requires window and document');
  if (!CELLS || typeof buildGrid !== 'function') throw new Error('Cells focus requires cells and buildGrid');

  function enabled(name) { return controls[name] !== false; }
  function active() { return !destroyed && (!options.isActive || options.isActive()); }
  function embedMode() { return options.isEmbedMode ? !!options.isEmbedMode() : !!options.embedMode; }

  function lucide(paths, size) {
    var sz = size || 14;
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + paths + '</svg>';
  }
  var X_ICON = lucide('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');
  var DL_ICON = lucide('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>');

  // The overlay lives outside #_sd_rendered, so forward the document's theme
  // tokens onto it (mirrors sdocs-mermaid-focus.js).
  function forwardVars(modal) {
    var rendered = typeof options.themeSource === 'function'
      ? options.themeSource() : options.themeSource;
    if (!rendered) rendered = document.getElementById('_sd_rendered');
    if (!rendered) return;
    var cs = window.getComputedStyle(rendered);
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

  var state = { modal: null, lease: null, editApi: null, entries: null,
                activeIndex: -1, edited: null, activeWrap: null, closing: false };

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
      if (options.onEdited) { try { options.onEdited(m, entry.wrapper); } catch (_) {} }
      if (entry.wrapper._cellsRepaint) { try { entry.wrapper._cellsRepaint(); } catch (_) {} }
    });
  }

  function beforeClose(reason) {
    if (state.closing) return;
    state.closing = true;
    var commit = reason === 'user';
    if (state.editApi) { try { state.editApi.detach(commit); } catch (_) {} }
    if (state.activeWrap && state.activeWrap._cellsRelease) {
      try { state.activeWrap._cellsRelease(); } catch (_) {}
    }
    if (commit) repaintEdited();
    state.editApi = null;
    state.activeWrap = null;
  }

  function afterClose() {
    document.body.classList.remove('sdoc-cells-focus-open');
    if (options.syncEmbedFocus) options.syncEmbedFocus();
    state.modal = null; state.lease = null; state.entries = null;
    state.edited = null; state.activeIndex = -1; state.closing = false;
  }

  function close(reason) {
    if (!state.lease) return false;
    return state.lease.close(reason || 'user');
  }

  // The tab list for `model`: every tab of its OWN workbook (so the strip
  // switches only between sibling sheets, never another workbook's), or a
  // single anonymous entry for a standalone grid.
  function entriesFor(model, inlineWrapper) {
    var wb = controller && typeof controller.entriesFor === 'function'
      ? controller.entriesFor(model) : [];
    if (wb && wb.length) return wb;
    return [{ name: '', model: model, wrapper: inlineWrapper }];
  }

  function open(model, inlineWrapper) {
    if (!active() || !model || model.empty) return null;
    if (state.lease) close('superseded');
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
    if (options.sdkVersion) modal.setAttribute('data-smalldocs-sdk-version', String(options.sdkVersion));
    forwardVars(modal);

    // ── Topbar skeleton: brand + filename + (per-sheet) actions + close ──
    var topbar = document.createElement('div');
    topbar.className = 'sdoc-cells-focus-topbar';
    var brand = document.createElement('span');
    brand.className = 'sdoc-cells-focus-brand';
    setKnownHTML(brand, '<span class="sdoc-cells-focus-brand-full">SmallDocs</span>' +
      '<span class="sdoc-cells-focus-brand-tiny">SD</span>' +
      '<span class="sdoc-cells-focus-brand-suf">Sheet</span>');
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
    setKnownHTML(closeBtn, X_ICON);
    closeBtn.addEventListener('click', function () { close('user'); });

    // Download the WHOLE workbook (every sheet of this group) as one .xlsx with
    // its cross-sheet formulas intact. Shown only for a real multi-sheet
    // workbook; the per-sheet download stays on each grid's own toolbar.
    if (tabbed && enabled('download')) {
      var wbBtn = document.createElement('button');
      wbBtn.type = 'button';
      wbBtn.className = 'sdoc-cells-fx-toggle sdoc-cells-focus-dl';
      wbBtn.title = 'Download workbook (.xlsx)';
      wbBtn.setAttribute('aria-label', 'Download workbook (.xlsx)');
      setKnownHTML(wbBtn, DL_ICON + '<span class="sdoc-cells-focus-dl-label">Workbook</span>');
      wbBtn.addEventListener('click', function () {
        if (!active() || !state.modal || wbBtn.disabled) return;
        wbBtn.disabled = true;
        wbBtn.setAttribute('aria-busy', 'true');
        var ready = options.loadFeature
          ? options.loadFeature('xlsx')
          : Promise.resolve(window.SDocCellsXlsx);
        ready.then(function (XL) {
        if (!active() || !state.modal || !wbBtn.isConnected) return;
        var FXm = FORMULA;
        // Use each sheet's effective (possibly edited) source model, in tab
        // order; recompute so cached values match the formulas Excel reopens.
        var book = entries.map(function (e) {
          var m = (e.wrapper && e.wrapper._cellsSource) || e.model;
          return { name: e.name, model: m };
        });
        var grids = FXm ? FXm.recalcWorkbook(book) : [];
        var bytes = XL.buildXlsxWorkbook(book, grids);
        var blob = new window.Blob([bytes],
          { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        var wid = (entries[0] && entries[0].workbook) || '';
        var srcBase = (entries[0] && entries[0].model && entries[0].model.source) || 'workbook';
        var base = String(wid || srcBase).replace(/\.[^.]*$/, '').replace(/[^a-z0-9_-]/gi, '_') || 'workbook';
        if (options.downloadBlob) options.downloadBlob(blob, base + '.xlsx');
        else {
          var a = document.createElement('a');
          a.href = window.URL.createObjectURL(blob);
          a.download = base + '.xlsx';
          a.click();
          window.setTimeout(function () { window.URL.revokeObjectURL(a.href); }, 1000);
        }
        }).catch(function (err) {
          if (!active() || !state.modal || !wbBtn.isConnected) return;
          wbBtn.title = 'Could not load Excel export. Try again.';
          if (options.onError) options.onError(err);
          else if (window.console && window.console.error) window.console.error(err);
        }).then(function () {
          if (active() && state.modal && wbBtn.isConnected) {
            wbBtn.disabled = false;
            wbBtn.removeAttribute('aria-busy');
          }
        });
      });
      topbar.appendChild(wbBtn);
    }

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
    function syncSelection(d, forceValue) {
      if (!activeWrap) return;
      if (!d || d.empty) { nameBox.textContent = ''; valueBox.value = ''; stats.textContent = ''; return; }
      var vm = activeWrap._cellsModel || activeModel;   // effective (sorted) view
      var addr = CELLS.colName(d.c0) + (d.r0 + 1);
      nameBox.textContent = d.single ? addr : addr + ':' + CELLS.colName(d.c1) + (d.r1 + 1);
      var cell = vm.cells[d.r0] && vm.cells[d.r0][d.c0];
      if (forceValue || document.activeElement !== valueBox) valueBox.value = cell ? cell.raw : '';
      stats.textContent = formatStats
        ? formatStats(vm, d, activeWrap._cellsFxView) : '';
    }
    valueBox.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (state.editApi) state.editApi.setActiveRaw(valueBox.value, true);
        focusGrid();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        syncSelection(activeWrap && activeWrap._cellsSelection, true);
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
      if (state.editApi) { try { state.editApi.detach(true); } catch (_) {} state.editApi = null; }
      if (activeWrap && activeWrap._cellsRelease) { try { activeWrap._cellsRelease(); } catch (_) {} }
      var entry = entries[index];
      var m = entry.model;

      while (stage.firstChild) stage.removeChild(stage.firstChild);
      var gridWrap = buildGrid(m, { fullscreen: true });
      stage.appendChild(gridWrap);
      activeWrap = gridWrap; activeModel = m;
      state.activeWrap = gridWrap;
      state.activeIndex = index;
      fileSpan.textContent = m.source || '';

      // Copy controls (+ a raw "formulas" button when the sheet has formulas)
      // and the =fx formula-view toggle, rebuilt for this sheet and swapped in.
      var hasFormulas = (m.cells || []).some(function (row) {
        return (row || []).some(function (cl) {
          return cl && cl.raw && cl.raw.charAt(0) === '=' && cl.raw.length > 1;
        });
      });
      var actions = enabled('copy') && buildCopyControls
        ? buildCopyControls(gridWrap, m, { rawButton: hasFormulas }).box
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
      if (editor && editor.attach) {
        state.editApi = editor.attach(gridWrap, {
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
      if (gridEl && !embedMode()) { try { gridEl.focus(); } catch (_) {} }
    }

    modal.appendChild(topbar);
    modal.appendChild(bar);
    modal.appendChild(stage);
    if (tabStrip) modal.appendChild(tabStrip);
    document.body.classList.add('sdoc-cells-focus-open');
    state.modal = modal;
    var leaseOptions = {
      surface: modal,
      returnFocus: inlineWrapper && inlineWrapper.querySelector
        ? inlineWrapper.querySelector('.sdoc-cells-expand') : document.activeElement,
      beforeClose: beforeClose,
      onClose: afterClose,
      restoreFocus: !embedMode(),
    };
    state.lease = options.openOverlayLease
      ? options.openOverlayLease(options.owner || state, leaseOptions)
      : openLocalLease(leaseOptions);
    if (options.syncEmbedFocus) options.syncEmbedFocus();
    mountSheet(activeIndex);
    return modal;
  }

  function openLocalLease(leaseOptions) {
    var surface = leaseOptions.surface;
    var returnFocus = leaseOptions.returnFocus;
    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      lease.close('user');
    }
    document.body.appendChild(surface);
    window.addEventListener('keydown', onKey);
    var closed = false;
    var lease = {
      close: function (reason) {
        if (closed) return false;
        closed = true;
        window.removeEventListener('keydown', onKey);
        if (leaseOptions.beforeClose) leaseOptions.beforeClose(reason);
        surface.remove();
        if (leaseOptions.onClose) leaseOptions.onClose(reason);
        if (reason === 'user' && leaseOptions.restoreFocus !== false && returnFocus && returnFocus.isConnected) {
          try { returnFocus.focus(); } catch (_) {}
        }
        return true;
      },
    };
    return lease;
  }

  function destroy(reason) {
    if (destroyed) return;
    if (state.lease) close(reason === 'update' ? 'update' : 'destroy');
    destroyed = true;
    if (editor && editor.destroy) editor.destroy();
  }

  return { open: open, close: close, destroy: destroy };
  }

  function installProduction(root) {
    var S = root.SDocs;
    if (!S || !root.SDocCells || !root.SDocCellsUI || !root.SDocCellsEdit) return null;
    if (S.__cellsFocusInstance) return S.__cellsFocusInstance;
    var ui = S.__cellsUiInstance || root.SDocCellsUI.installProduction(root);
    var edit = S.__cellsEditInstance || root.SDocCellsEdit.installProduction(root);
    var instance = create({
      window: root,
      document: root.document,
      cells: root.SDocCells,
      formula: root.SDocCellsFormula,
      controller: ui.controller,
      editor: edit,
      buildGrid: ui.buildGrid,
      buildCopyControls: ui.buildCopyControls,
      formatStats: ui.formatStats,
      themeSource: function () { return root.document.getElementById('_sd_rendered'); },
      isEmbedMode: function () { return !!S.embedMode; },
      syncEmbedFocus: function () { if (S.syncEmbedFocus) S.syncEmbedFocus(); },
      onEdited: function (model, wrapper) {
        if (S.onCellsEdited) S.onCellsEdited(model, wrapper);
      },
      loadFeature: function (name) { return S.loadCellsFeature(name); },
      onError: function (error) {
        if (root.console && root.console.error) root.console.error(error);
      },
    });
    S.__cellsFocusInstance = instance;
    S.cellsFocus = instance;
    return instance;
  }

  return { create: create, installProduction: installProduction };
});
