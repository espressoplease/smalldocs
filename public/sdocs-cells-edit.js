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
    var editorPointer = null;   // point-mode session for the open in-cell editor

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

    // ── Formula point mode ──────────────────────────────────
    // While a formula is being typed, arrow keys point at grid cells and write
    // their reference into the text (the Sheets/Excel "point" interaction):
    //   =SUM(  [arrows]          -> =SUM(B3      a single ref that follows the pointer
    //   =SUM(  [arrows][shift+arrows] -> =SUM(B2:B3   shift extends it to a range
    //   =SUM(B2  [type :][arrows]     -> =SUM(B2:B3   ":" locks the start, arrows move the end
    //   =B3  [type +][arrows]         -> =B3+B2       any operator re-arms pointing
    // Typing anything else keeps the written ref and ends the session. The
    // pointed cells are highlighted on the grid while the session is live.
    var REF_COLOR = '#8b5cf6';                      // violet: distinct from the selection accent
    var TRIGGER_RE = /[=(,:+\-*/^%<>&]$/;           // caret sits in a "ref slot" after one of these

    function refText(c, r) { return CELLS.colName(c) + (r + 1); }
    function clampN(v, n) { return Math.max(0, Math.min(n - 1, v)); }

    function makePointer(input, originCell) {
      var sess = null;   // { start, len, ar, ac, fr, fc, endOnly }

      function clearHighlight() {
        var prev = grid.querySelectorAll('.is-ref-point');
        for (var i = 0; i < prev.length; i++) {
          prev[i].classList.remove('is-ref-point');
          prev[i].style.boxShadow = '';
        }
      }
      function paintHighlight() {
        clearHighlight();
        if (!sess) return;
        var r0 = Math.min(sess.ar, sess.fr), r1 = Math.max(sess.ar, sess.fr);
        var c0 = Math.min(sess.ac, sess.fc), c1 = Math.max(sess.ac, sess.fc);
        for (var r = r0; r <= r1; r++) {
          for (var c = c0; c <= c1; c++) {
            var cell = cellAt(r, c);
            if (!cell) continue;
            cell.classList.add('is-ref-point');
            var parts = [];
            if (r === r0) parts.push('inset 0 2px 0 0 ' + REF_COLOR);
            if (r === r1) parts.push('inset 0 -2px 0 0 ' + REF_COLOR);
            if (c === c0) parts.push('inset 2px 0 0 0 ' + REF_COLOR);
            if (c === c1) parts.push('inset -2px 0 0 0 ' + REF_COLOR);
            cell.style.boxShadow = parts.join(', ');
          }
        }
      }

      function refStr() {
        if (sess.endOnly) return refText(sess.fc, sess.fr);
        if (sess.ar === sess.fr && sess.ac === sess.fc) return refText(sess.fc, sess.fr);
        var r0 = Math.min(sess.ar, sess.fr), r1 = Math.max(sess.ar, sess.fr);
        var c0 = Math.min(sess.ac, sess.fc), c1 = Math.max(sess.ac, sess.fc);
        return refText(c0, r0) + ':' + refText(c1, r1);
      }

      function writeRef() {
        var txt = refStr();
        var v = input.value;
        input.value = v.slice(0, sess.start) + txt + v.slice(sess.start + sess.len);
        sess.len = txt.length;
        var caret = sess.start + txt.length;
        try { input.setSelectionRange(caret, caret); } catch (_) {}
        // Keep mirrors (the formula bar) in sync with the programmatic change.
        try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
        paintHighlight();
      }

      // Returns true when the keydown was consumed by point mode.
      function handleKey(e) {
        var dirs = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
        var d = dirs[e.key];
        if (d) {
          var v = input.value;
          if (v.charAt(0) !== '=') return false;
          if (!sess) {
            // Only start when the caret sits at the end of the text, right
            // after a trigger character ("=", "(", ",", ":" or an operator).
            var caret = input.selectionStart;
            if (caret !== v.length || input.selectionEnd !== caret) return false;
            if (!TRIGGER_RE.test(v)) return false;
            var o = originCell();
            var startR = o.r, startC = o.c, endOnly = false;
            // ":" right after a written ref -> range-end mode: the start is
            // locked in the text, the pointer continues from that ref.
            var mColon = /([A-Za-z]+)([0-9]+):$/.exec(v);
            if (v.charAt(v.length - 1) === ':' && mColon) {
              endOnly = true;
              startC = CELLS.colIndex(mColon[1].toUpperCase());
              startR = parseInt(mColon[2], 10) - 1;
            }
            sess = { start: caret, len: 0, ar: startR, ac: startC, fr: startR, fc: startC, endOnly: endOnly };
          }
          var ext = extent();
          sess.fr = clampN(sess.fr + d[0], ext.rows);
          sess.fc = clampN(sess.fc + d[1], ext.cols);
          if (!e.shiftKey && !sess.endOnly) { sess.ar = sess.fr; sess.ac = sess.fc; }
          e.preventDefault();
          e.stopPropagation();
          writeRef();
          return true;
        }
        // Any other (non-modifier) key ends the session; the written ref stays
        // and the keystroke proceeds normally - so ")" or "+" after pointing
        // lands right after the ref, and Enter commits the whole formula.
        if (sess && e.key !== 'Shift' && e.key !== 'Meta' && e.key !== 'Control' && e.key !== 'Alt') end();
        return false;
      }

      function end() { sess = null; clearHighlight(); }
      return { handleKey: handleKey, end: end };
    }

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
      editorPointer = makePointer(input, function () { return { r: editing.r, c: editing.c }; });
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
      if (editorPointer) { editorPointer.end(); editorPointer = null; }
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
      // Formula point mode gets first look at every key: arrows in a ref slot
      // write cell references instead of moving the caret.
      if (editorPointer && editorPointer.handleKey(e)) return;
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

    // ── Copy / paste ─────────────────────────────────────────
    // Copying a selection (Cmd/Ctrl+C with the grid focused) writes its raw
    // values - formulas included - as TSV, and remembers the snapshot. Pasting
    // that same text back is formula-aware: each pasted formula's references
    // shift by how far the cell moved (=B2*C2 pasted one row down -> =B3*C3),
    // and a single copied cell fills the whole target selection. Any other
    // clipboard text pastes as plain TSV/CSV values.
    var internalCopy = null;   // { text, raws, modelRows, c0 } from the last in-grid copy

    function gridHasFocus() {
      return grid.contains(document.activeElement) || document.activeElement === grid;
    }

    function onCopy(e) {
      if (editing) return;                       // native copy inside the editor input
      if (!gridHasFocus()) return;
      var rect = grid._selectionRect && grid._selectionRect();
      if (!rect) return;
      e.preventDefault();
      var raws = [], modelRows = [], lines = [];
      for (var r = rect.r0; r <= rect.r1; r++) {
        var mr = dispToModelRow(r);
        modelRows.push(mr);
        var row = [];
        for (var c = rect.c0; c <= rect.c1; c++) row.push(rawAt(model, mr, c));
        raws.push(row);
        lines.push(row.join('\t'));
      }
      var text = lines.join('\n');
      try { e.clipboardData.setData('text/plain', text); } catch (_) {}
      internalCopy = { text: text, raws: raws, modelRows: modelRows, c0: rect.c0 };
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
      if (!gridHasFocus()) return;
      var text = e.clipboardData && e.clipboardData.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      var a = active();
      var FX = window.SDocCellsFormula;
      var touched = false, r, c;

      // Formula-aware paste: the clipboard holds what we last copied in-grid.
      if (FX && internalCopy && internalCopy.text === text) {
        var srcRows = internalCopy.raws.length;
        var srcCols = internalCopy.raws[0].length;
        var sel = grid._selectionRect && grid._selectionRect();
        // A 1x1 copy fills the whole selection; a block lands at the anchor.
        var t = (srcRows === 1 && srcCols === 1 && sel)
          ? sel
          : { r0: a.r, c0: a.c, r1: a.r + srcRows - 1, c1: a.c + srcCols - 1 };
        pushUndo();
        for (r = t.r0; r <= t.r1; r++) {
          for (c = t.c0; c <= t.c1; c++) {
            var si = (r - t.r0) % srcRows, sj = (c - t.c0) % srcCols;
            var raw = internalCopy.raws[si][sj];
            if (FX.isFormula(raw)) {
              raw = FX.shiftFormula(raw,
                dispToModelRow(r) - internalCopy.modelRows[si],
                c - (internalCopy.c0 + sj));
            }
            setRaw(model, dispToModelRow(r), c, raw);
            touched = true;
          }
        }
        if (touched) {
          repaint(); changed();
          if (grid._moveTo) grid._moveTo(t.r0, t.c0, false);
          if (grid._extendTo) grid._extendTo(t.r1, t.c1, false);
        } else undo.pop();
        return;
      }

      // Plain TSV/CSV paste (external clipboard content).
      var rows = parseClip(text);
      if (!rows.length) return;
      pushUndo();
      for (var i = 0; i < rows.length; i++) {
        var mr = dispToModelRow(a.r + i);
        for (var j = 0; j < rows[i].length; j++) {
          setRaw(model, mr, a.c + j, rows[i][j]); touched = true;
        }
      }
      if (touched) { repaint(); changed(); if (grid._moveTo) grid._moveTo(a.r, a.c, false); }
      else undo.pop();
    }

    // ── Fill handle (drag to fill) ───────────────────────────
    // A small square on the selection's bottom-right corner. Dragging it over
    // neighbouring cells fills them from the selection: formulas shift their
    // relative references (=B2*C2 -> =B3*C3), plain values repeat, and a run
    // of 2+ numbers along the fill axis continues as a linear series (1, 2 ->
    // 3, 4). One axis at a time, like Sheets - whichever the pointer favours.
    var fillHandle = document.createElement('span');
    fillHandle.className = 'sdoc-cells-fill-handle';
    var fillDrag = null;   // { src: rect, dir: 'v'|'h'|null, to: index } while dragging

    function removeFillHandle() {
      if (fillHandle.parentNode) fillHandle.parentNode.removeChild(fillHandle);
    }
    function placeFillHandle() {
      var rect = grid._selectionRect && grid._selectionRect();
      if (!rect) { removeFillHandle(); return; }
      var corner = cellAt(rect.r1, rect.c1);
      if (!corner) { removeFillHandle(); return; }
      corner.appendChild(fillHandle);
    }
    function onSelectionChange() { placeFillHandle(); }

    function clearFillPreview() {
      var prev = grid.querySelectorAll('.is-fill-preview');
      for (var i = 0; i < prev.length; i++) prev[i].classList.remove('is-fill-preview');
    }

    // The rectangle a fill drag would write, or null when still inside the source.
    function fillTarget() {
      if (!fillDrag || fillDrag.dir == null) return null;
      var s = fillDrag.src;
      if (fillDrag.dir === 'v') {
        if (fillDrag.to > s.r1) return { r0: s.r1 + 1, r1: fillDrag.to, c0: s.c0, c1: s.c1 };
        if (fillDrag.to < s.r0) return { r0: fillDrag.to, r1: s.r0 - 1, c0: s.c0, c1: s.c1 };
      } else {
        if (fillDrag.to > s.c1) return { r0: s.r0, r1: s.r1, c0: s.c1 + 1, c1: fillDrag.to };
        if (fillDrag.to < s.c0) return { r0: s.r0, r1: s.r1, c0: fillDrag.to, c1: s.c0 - 1 };
      }
      return null;
    }
    function paintFillPreview() {
      clearFillPreview();
      var t = fillTarget();
      if (!t) return;
      for (var r = t.r0; r <= t.r1; r++) {
        for (var c = t.c0; c <= t.c1; c++) {
          var cell = cellAt(r, c);
          if (cell) cell.classList.add('is-fill-preview');
        }
      }
    }
    function onFillMove(e) {
      if (!fillDrag) return;
      var el = document.elementFromPoint(e.clientX, e.clientY);
      var cell = el && el.closest ? el.closest('.sdoc-cells-cell') : null;
      if (!cell || !grid.contains(cell)) return;
      var r = +cell.dataset.r, c = +cell.dataset.c;
      var s = fillDrag.src;
      // Whichever axis the pointer has left the source rect on (further wins).
      var dv = r > s.r1 ? r - s.r1 : (r < s.r0 ? s.r0 - r : 0);
      var dh = c > s.c1 ? c - s.c1 : (c < s.c0 ? s.c0 - c : 0);
      if (dv === 0 && dh === 0) { fillDrag.dir = null; clearFillPreview(); return; }
      if (dv >= dh) { fillDrag.dir = 'v'; fillDrag.to = r; }
      else { fillDrag.dir = 'h'; fillDrag.to = c; }
      paintFillPreview();
    }

    // All-numeric source values along the fill axis continue arithmetically.
    function seriesStep(vals) {
      if (vals.length < 2) return null;
      var step = vals[1] - vals[0];
      for (var i = 2; i < vals.length; i++) {
        if (Math.abs((vals[i] - vals[i - 1]) - step) > 1e-9) return null;
      }
      return step;
    }
    // Numeric values of the source cells along the fill axis for one fill
    // line (a column for vertical fill, a row for horizontal), or null.
    function axisValues(s, dir, lineIndex) {
      var vals = [], k, cl;
      if (dir === 'v') {
        for (k = s.r0; k <= s.r1; k++) {
          cl = model.cells[dispToModelRow(k)] && model.cells[dispToModelRow(k)][lineIndex];
          if (!cl || cl.type !== 'number') return null;
          vals.push(cl.value);
        }
      } else {
        for (k = s.c0; k <= s.c1; k++) {
          cl = model.cells[dispToModelRow(lineIndex)] && model.cells[dispToModelRow(lineIndex)][k];
          if (!cl || cl.type !== 'number') return null;
          vals.push(cl.value);
        }
      }
      return vals;
    }

    function commitFill() {
      var t = fillTarget();
      if (!t) return;
      var s = fillDrag.src, dir = fillDrag.dir;
      var FX = window.SDocCellsFormula;
      var srcRows = s.r1 - s.r0 + 1, srcCols = s.c1 - s.c0 + 1;
      pushUndo();
      for (var r = t.r0; r <= t.r1; r++) {
        for (var c = t.c0; c <= t.c1; c++) {
          // The source cell this target tiles from.
          var sR, sC, dist;
          if (dir === 'v') {
            sC = c;
            dist = r > s.r1 ? r - s.r1 : -(s.r0 - r);
            sR = dist > 0 ? s.r0 + ((dist - 1) % srcRows) : s.r1 - ((-dist - 1) % srcRows);
          } else {
            sR = r;
            dist = c > s.c1 ? c - s.c1 : -(s.c0 - c);
            sC = dist > 0 ? s.c0 + ((dist - 1) % srcCols) : s.c1 - ((-dist - 1) % srcCols);
          }
          var srcModelR = dispToModelRow(sR);
          var raw = rawAt(model, srcModelR, sC);
          if (FX && FX.isFormula(raw)) {
            raw = FX.shiftFormula(raw, dispToModelRow(r) - srcModelR, c - sC);
          } else {
            var vals = axisValues(s, dir, dir === 'v' ? c : r);
            var step = vals ? seriesStep(vals) : null;
            if (step !== null) {
              var base = dist > 0 ? vals[vals.length - 1] : vals[0];
              raw = String(base + step * dist);
            }
          }
          setRaw(model, dispToModelRow(r), c, raw);
        }
      }
      repaint(); changed();
      // Select source + filled area together, like Sheets.
      if (grid._moveTo) grid._moveTo(Math.min(s.r0, t.r0), Math.min(s.c0, t.c0), false);
      if (grid._extendTo) grid._extendTo(Math.max(s.r1, t.r1), Math.max(s.c1, t.c1), false);
    }

    function onFillUp() {
      document.removeEventListener('mousemove', onFillMove);
      document.removeEventListener('mouseup', onFillUp);
      clearFillPreview();
      if (fillDrag && fillDrag.dir != null) commitFill();
      fillDrag = null;
    }
    fillHandle.addEventListener('mousedown', function (e) {
      e.preventDefault(); e.stopPropagation();
      var rect = grid._selectionRect && grid._selectionRect();
      if (!rect) return;
      fillDrag = { src: rect, dir: null, to: 0 };
      document.addEventListener('mousemove', onFillMove);
      document.addEventListener('mouseup', onFillUp);
    });

    wrapper.addEventListener('cells-selection', onSelectionChange);

    grid.addEventListener('keydown', onGridKey);
    grid.addEventListener('dblclick', onDblClick);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);

    // The formula bar gets its own point-mode session: arrows there write refs
    // relative to the active cell. Other keys (Enter / Escape) are handled by
    // the bar's own listener in the focus view.
    var barPointer = null, onBarKey = null, onBarBlur = null;
    if (opts.valueInput) {
      barPointer = makePointer(opts.valueInput, function () { return active(); });
      onBarKey = function (e) { barPointer.handleKey(e); };
      onBarBlur = function () { barPointer.end(); };
      opts.valueInput.addEventListener('keydown', onBarKey);
      opts.valueInput.addEventListener('blur', onBarBlur);
    }

    var api = {
      begin: function () { var a = active(); begin(a.r, a.c); },
      commitOpen: function () { if (editing) commit(true, false); },
      undo: doUndo, redo: doRedo,
      canUndo: function () { return undo.length > 0; },
      detach: function () {
        if (editing) commit(true);
        removeFillHandle();
        wrapper.removeEventListener('cells-selection', onSelectionChange);
        grid.removeEventListener('keydown', onGridKey);
        grid.removeEventListener('dblclick', onDblClick);
        document.removeEventListener('copy', onCopy);
        document.removeEventListener('paste', onPaste);
        if (opts.valueInput && onBarKey) {
          barPointer.end();
          opts.valueInput.removeEventListener('keydown', onBarKey);
          opts.valueInput.removeEventListener('blur', onBarBlur);
        }
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
