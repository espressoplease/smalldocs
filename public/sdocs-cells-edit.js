// sdocs-cells-edit.js - in-cell editing for the fullscreen cells view.
//
// Client-only, ephemeral editing. Attached from the fullscreen focus view to
// its grid; the inline grid stays read-only. Edits mutate the grid's source
// model (wrapper._cellsSource) and trigger its repaint (wrapper._cellsRepaint),
// which re-derives the sort + formula recalc, so typing a value or a =formula
// updates the sheet live. Nothing is persisted to the document here - the
// focus view repaints the inline grid (shared model object) on close.
// Undo/redo, range-clear, and TSV/CSV paste are included.
//
// Coordinates: the selection reports DISPLAY rows/cols (the painted grid, which
// is padded past the data in fullscreen). A display row maps to a source row
// via wrapper._cellsRowOrder when a sort is active; columns map directly.
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var S = window.SDocs;
  if (!S) return;
  var CELLS = window.SDocCells;
  if (!CELLS) return;

  var UNDO_CAP = 200;

  function emptyCell() { return { raw: '', value: '', type: 'empty' }; }

  // Snapshot / restore for undo: only raw matters; value/type recompute.
  function snapshot(model) {
    return model.cells.map(function (row) {
      return row.map(function (c) { return c.raw; });
    });
  }
  function restore(model, snap) {
    model.cells = snap.map(function (row) {
      return row.map(function (raw) { return CELLS.classify(raw); });
    });
    recomputeDims(model);
  }
  function recomputeDims(model) {
    model.rows = model.cells.length;
    var maxc = 0;
    for (var i = 0; i < model.cells.length; i++) maxc = Math.max(maxc, model.cells[i].length);
    model.cols = maxc;
  }

  // Ensure cell [r][c] exists (growing rows / padding the row) and set it.
  function setRaw(model, r, c, raw) {
    while (model.cells.length <= r) model.cells.push([]);
    var row = model.cells[r];
    while (row.length <= c) row.push(emptyCell());
    row[c] = CELLS.classify(raw);
    recomputeDims(model);
  }
  function rawAt(model, r, c) {
    var row = model.cells[r];
    var cell = row && row[c];
    return cell ? cell.raw : '';
  }

  // Attach editing to a fullscreen grid wrapper. opts.onChange() fires after a
  // committed edit; opts.valueInput is the formula bar (kept in sync).
  function attach(wrapper, opts) {
    opts = opts || {};
    var grid = wrapper.querySelector('.sdoc-cells-grid');
    if (!grid) return null;
    var model = wrapper._cellsSource;
    if (!model) return null;
    var undo = [], redo = [];
    var editing = null;   // { input, r, c } in DISPLAY coords while open

    function extent() { return wrapper._cellsExtent || { rows: model.rows, cols: model.cols }; }
    function dispToModelRow(r) {
      var order = wrapper._cellsRowOrder;
      return (order && r < order.length) ? order[r] : r;
    }
    function cellAt(r, c) {
      return grid.querySelector('.sdoc-cells-cell[data-r="' + r + '"][data-c="' + c + '"]');
    }
    function active() {
      var s = wrapper._cellsSelection;
      if (s && !s.empty) return { r: s.r0, c: s.c0 };
      return { r: 0, c: 0 };
    }
    function pushUndo() {
      undo.push(snapshot(model));
      if (undo.length > UNDO_CAP) undo.shift();
      redo.length = 0;
    }
    function repaint() { if (wrapper._cellsRepaint) wrapper._cellsRepaint(); }
    function reselect(r, c) { if (grid._moveTo) grid._moveTo(r, c, true); }
    function changed() { if (opts.onChange) opts.onChange(); }

    // ── In-cell editor ──────────────────────────────────────
    function begin(r, c, initial) {
      if (editing) commit(true);
      var cell = cellAt(r, c);
      if (!cell) return;
      var rect = cell.getBoundingClientRect();
      var cs = getComputedStyle(cell);
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'sdoc-cells-editor';
      input.value = initial != null ? initial : rawAt(model, dispToModelRow(r), c);
      input.style.left = rect.left + 'px';
      input.style.top = rect.top + 'px';
      input.style.width = Math.max(rect.width, 60) + 'px';
      input.style.height = rect.height + 'px';
      input.style.font = cs.font;
      input.style.textAlign = cs.justifyContent === 'flex-end' ? 'right' : 'left';
      document.body.appendChild(input);
      editing = { input: input, r: r, c: c };
      input.focus();
      if (initial != null) {
        var v = input.value; input.value = ''; input.value = v;   // caret to end
      } else {
        input.select();
      }
      input.addEventListener('keydown', onEditorKey);
      input.addEventListener('blur', function () { if (editing && editing.input === input) commit(true, 'blur'); });
      if (opts.valueInput) opts.valueInput.value = input.value;
      input.addEventListener('input', function () {
        if (opts.valueInput) opts.valueInput.value = input.value;
      });
    }

    function teardown() {
      if (!editing) return;
      var inp = editing.input;
      editing = null;                     // clear first so blur handler is a no-op
      if (inp && inp.parentNode) inp.parentNode.removeChild(inp);
    }

    // Commit the open editor. `move` is 'down'|'right'|'up'|'left'|'blur'|false.
    function commit(write, move) {
      if (!editing) return false;
      var r = editing.r, c = editing.c, val = editing.input.value;
      var mr = dispToModelRow(r);
      var did = false;
      if (write && val !== rawAt(model, mr, c)) {
        pushUndo();
        setRaw(model, mr, c, val);
        did = true;
      }
      teardown();
      if (did) { repaint(); changed(); }
      var ext = extent();
      if (move === 'down') reselect(Math.min(r + 1, ext.rows - 1), c);
      else if (move === 'up') reselect(Math.max(r - 1, 0), c);
      else if (move === 'right') reselect(r, Math.min(c + 1, ext.cols - 1));
      else if (move === 'left') reselect(r, Math.max(c - 1, 0));
      else if (move !== 'blur') reselect(r, c);
      if (move !== 'blur') grid.focus({ preventScroll: true });
      return did;
    }

    function onEditorKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(true, e.shiftKey ? 'up' : 'down'); }
      else if (e.key === 'Tab') { e.preventDefault(); commit(true, e.shiftKey ? 'left' : 'right'); }
      else if (e.key === 'Escape') {
        e.preventDefault();
        var a = editing; teardown();
        if (a) reselect(a.r, a.c);
        grid.focus({ preventScroll: true });
      }
      // arrows move the caret inside the text (Sheets only exits on Enter/Tab).
      e.stopPropagation();   // do not let the grid's nav handler also fire
    }

    // ── Grid-level keys (not editing) ───────────────────────
    function clearRange() {
      var rect = grid._selectionRect && grid._selectionRect();
      if (!rect) return;
      var touched = false;
      pushUndo();
      for (var r = rect.r0; r <= rect.r1; r++) {
        var mr = dispToModelRow(r);
        for (var c = rect.c0; c <= rect.c1; c++) {
          if (rawAt(model, mr, c) !== '') { setRaw(model, mr, c, ''); touched = true; }
        }
      }
      if (touched) { repaint(); changed(); if (grid._moveTo) grid._moveTo(rect.r0, rect.c0, false); }
      else undo.pop();
    }

    function doUndo() {
      if (!undo.length) return;
      redo.push(snapshot(model));
      restore(model, undo.pop());
      repaint(); changed();
    }
    function doRedo() {
      if (!redo.length) return;
      undo.push(snapshot(model));
      restore(model, redo.pop());
      repaint(); changed();
    }

    function onGridKey(e) {
      if (editing) return;
      var mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) doRedo(); else doUndo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); doRedo(); return; }
      if (mod) return;                          // leave copy etc. alone
      if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        var a = active();
        begin(a.r, a.c, e.key === 'Enter' ? rawAt(model, dispToModelRow(a.r), a.c) : undefined);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); clearRange(); return; }
      // A printable character starts an edit, replacing the cell content.
      if (e.key.length === 1 && !e.altKey) {
        var b = active();
        begin(b.r, b.c, e.key);
        e.preventDefault();
      }
    }

    function onDblClick(e) {
      var cell = e.target.closest && e.target.closest('.sdoc-cells-cell');
      if (!cell || !grid.contains(cell)) return;
      e.preventDefault();
      begin(+cell.dataset.r, +cell.dataset.c);
    }

    // ── Paste (TSV/CSV) ─────────────────────────────────────
    function parseClip(text) {
      text = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
      var lines = text.split('\n');
      var tab = text.indexOf('\t') !== -1;
      return lines.map(function (ln) {
        if (tab) return ln.split('\t');
        var parsed = CELLS.parseCsv(ln);
        var row = parsed.cells[0] || [];
        return row.map(function (cell) { return cell.raw; });
      });
    }
    function onPaste(e) {
      if (editing) return;
      // Only when the grid (or a cell in it) has focus, so we don't hijack
      // pastes elsewhere on the page.
      if (!grid.contains(document.activeElement) && document.activeElement !== grid) return;
      var text = e.clipboardData && e.clipboardData.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      var rows = parseClip(text);
      if (!rows.length) return;
      var a = active();
      pushUndo();
      var touched = false;
      for (var i = 0; i < rows.length; i++) {
        var mr = dispToModelRow(a.r + i);
        for (var j = 0; j < rows[i].length; j++) {
          setRaw(model, mr, a.c + j, rows[i][j]); touched = true;
        }
      }
      if (touched) { repaint(); changed(); if (grid._moveTo) grid._moveTo(a.r, a.c, false); }
      else undo.pop();
    }

    grid.addEventListener('keydown', onGridKey);
    grid.addEventListener('dblclick', onDblClick);
    document.addEventListener('paste', onPaste);

    var api = {
      begin: function () { var a = active(); begin(a.r, a.c); },
      commitOpen: function () { if (editing) commit(true, false); },
      undo: doUndo, redo: doRedo,
      canUndo: function () { return undo.length > 0; },
      detach: function () {
        if (editing) commit(true);
        grid.removeEventListener('keydown', onGridKey);
        grid.removeEventListener('dblclick', onDblClick);
        document.removeEventListener('paste', onPaste);
      },
      // Commit a value to the active cell from the external formula bar.
      setActiveRaw: function (raw, move) {
        var a = active();
        var mr = dispToModelRow(a.r);
        var ext = extent();
        if (raw === rawAt(model, mr, a.c)) {
          if (move) reselect(Math.min(a.r + 1, ext.rows - 1), a.c);
          return;
        }
        pushUndo();
        setRaw(model, mr, a.c, raw);
        repaint(); changed();
        if (move) reselect(Math.min(a.r + 1, ext.rows - 1), a.c); else reselect(a.r, a.c);
      },
    };
    wrapper._cellsEditApi = api;
    return api;
  }

  S.cellsEdit = { attach: attach, setRaw: setRaw };
})();
