// sdocs-cells-select.js - cell + range selection and keyboard navigation
// for inline ```cells grids.
//
// Click a cell to select it (no text caret). Click-drag, shift-click, or
// shift-arrow to select a rectangular range. The selection shows a green
// box / fill, an accent outline around the range, and lights up every
// column letter and row number it spans. Arrow keys move; Cmd/Ctrl+Arrow
// jumps to the far edge; Shift+(Cmd/Ctrl)Arrow extends to it. Tabbing into
// a grid selects A1.
//
// A selection is an anchor cell + a focus cell; the range is the rectangle
// between them (anchor==focus is a single cell). Wired per grid from
// sdocs-cells-ui.js buildGrid() via S.wireCellsSelection, so the fullscreen
// view inherits it. State is per grid and ephemeral - a re-render rebuilds
// the grid and starts fresh.
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var S = window.SDocs;
  if (!S) return;

  // One drag is active across the whole page at a time. Tracking it at module
  // level (rather than a window listener per grid) keeps re-renders from
  // leaking listeners - there are exactly two document listeners total.
  var drag = null; // { grid, onTo(r, c) }
  if (typeof document !== 'undefined') {
    document.addEventListener('mousemove', function (e) {
      if (!drag) return;
      drag.x = e.clientX; drag.y = e.clientY;        // tracked for edge auto-scroll
      var cell = e.target.closest ? e.target.closest('.sdoc-cells-cell') : null;
      if (cell && drag.grid.contains(cell)) drag.onTo(+cell.dataset.r, +cell.dataset.c);
    });
    document.addEventListener('mouseup', function () { drag = null; });
  }

  function wire(wrapper, grid, scroll, rows, cols) {
    if (!grid || rows < 1 || cols < 1) return;
    grid.tabIndex = 0;
    var anchor = { r: -1, c: -1 };
    var focus = { r: -1, c: -1 };

    function clamp(v, n) { return Math.max(0, Math.min(n - 1, v)); }
    function cellAt(r, c) {
      return grid.querySelector('.sdoc-cells-cell[data-r="' + r + '"][data-c="' + c + '"]');
    }

    function clear() {
      var prev = grid.querySelectorAll('.is-active, .in-range, .is-active-col, .is-active-row');
      for (var i = 0; i < prev.length; i++) {
        prev[i].classList.remove('is-active', 'in-range', 'is-active-col', 'is-active-row');
        prev[i].style.boxShadow = '';
        prev[i].removeAttribute('aria-selected');
      }
    }

    function ensureVisible(cell) {
      var cr = cell.getBoundingClientRect();
      var sr = scroll.getBoundingClientRect();
      var rh = grid.querySelector('.sdoc-cells-rowhead');
      var gutter = rh ? rh.getBoundingClientRect().width : 0;
      if (cr.right > sr.right) scroll.scrollLeft += (cr.right - sr.right) + 2;
      else if (cr.left < sr.left + gutter) scroll.scrollLeft -= (sr.left + gutter - cr.left) + 2;
    }

    var ACCENT = 'var(--sdoc-cells-accent)';

    function apply(doScroll) {
      if (anchor.r < 0) return;
      clear();
      var r0 = Math.min(anchor.r, focus.r), r1 = Math.max(anchor.r, focus.r);
      var c0 = Math.min(anchor.c, focus.c), c1 = Math.max(anchor.c, focus.c);
      var single = (r0 === r1 && c0 === c1);

      for (var r = r0; r <= r1; r++) {
        for (var c = c0; c <= c1; c++) {
          var cell = cellAt(r, c);
          if (!cell) continue;
          if (single) {
            cell.classList.add('is-active');         // box via CSS
          } else {
            cell.classList.add('in-range');          // faint fill via CSS
            // Outline: 2px accent on whichever range edges this cell is on.
            var parts = [];
            if (r === r0) parts.push('inset 0 2px 0 0 ' + ACCENT);
            if (r === r1) parts.push('inset 0 -2px 0 0 ' + ACCENT);
            if (c === c0) parts.push('inset 2px 0 0 0 ' + ACCENT);
            if (c === c1) parts.push('inset -2px 0 0 0 ' + ACCENT);
            if (parts.length) cell.style.boxShadow = parts.join(', ');
          }
        }
      }
      cellAt(r0, c0) && cellAt(focus.r, focus.c) &&
        cellAt(focus.r, focus.c).setAttribute('aria-selected', 'true');

      for (var cc = c0; cc <= c1; cc++) {
        var col = grid.querySelector('.sdoc-cells-colhead[data-c="' + cc + '"]');
        if (col) col.classList.add('is-active-col');
      }
      for (var rr = r0; rr <= r1; rr++) {
        var row = grid.querySelector('.sdoc-cells-rowhead[data-r="' + rr + '"]');
        if (row) row.classList.add('is-active-row');
      }
      if (doScroll) {
        var f = cellAt(focus.r, focus.c);
        if (f) ensureVisible(f);
      }

      // Publish the selection so the toolbar can update its address label and
      // dynamic copy button.
      wrapper._cellsSelection = { r0: r0, c0: c0, r1: r1, c1: c1, single: single };
      emit(wrapper._cellsSelection);
    }

    function emit(detail) {
      try {
        wrapper.dispatchEvent(new CustomEvent('cells-selection', { detail: detail }));
      } catch (_) {}
    }

    function clearSelection() {
      anchor.r = anchor.c = focus.r = focus.c = -1;
      clear();
      wrapper._cellsSelection = null;
      emit({ empty: true });
    }
    grid._clearSelection = clearSelection;   // the resort calls this

    // Move the whole selection to a single cell (anchor == focus).
    function moveTo(r, c, doScroll) {
      anchor.r = focus.r = clamp(r, rows);
      anchor.c = focus.c = clamp(c, cols);
      apply(doScroll);
    }
    // Extend the range: keep the anchor, move the focus.
    function extendTo(r, c, doScroll) {
      focus.r = clamp(r, rows);
      focus.c = clamp(c, cols);
      apply(doScroll);
    }
    // Select a whole column / row (clicking its header).
    function selectColumn(c) {
      anchor.r = 0; anchor.c = clamp(c, cols);
      focus.r = rows - 1; focus.c = anchor.c;
      apply(false);
    }
    function selectRow(r) {
      anchor.r = clamp(r, rows); anchor.c = 0;
      focus.r = anchor.r; focus.c = cols - 1;
      apply(false);
    }

    // While a drag holds the pointer near the left/right edge of a
    // horizontally-scrollable grid, scroll that way each frame and extend the
    // range to the cell newly revealed at the edge - so a selection can sweep
    // past the visible columns. Self-terminates when the drag ends. No
    // vertical case: inline grids do not scroll vertically.
    function autoScrollTick() {
      if (!drag || drag.grid !== grid) return;
      var vp = scroll.getBoundingClientRect();
      var rh = grid.querySelector('.sdoc-cells-rowhead');
      var gutter = rh ? rh.getBoundingClientRect().width : 0;
      var EDGE = 28, STEP = 18;
      var maxLeft = scroll.scrollWidth - scroll.clientWidth;
      var dir = 0;
      if (drag.x > vp.right - EDGE && scroll.scrollLeft < maxLeft) dir = 1;
      else if (drag.x < vp.left + gutter + EDGE && scroll.scrollLeft > 0) dir = -1;
      if (dir !== 0) {
        scroll.scrollLeft += dir * STEP;
        // Sample the cell now at the edge (pointer clamped inside the viewport,
        // past the frozen row-number gutter) and extend the range to it.
        var sx = Math.max(vp.left + gutter + 1, Math.min(vp.right - 1, drag.x));
        var el = document.elementFromPoint(sx, drag.y);
        var cell = el && el.closest ? el.closest('.sdoc-cells-cell') : null;
        if (cell && grid.contains(cell)) extendTo(+cell.dataset.r, +cell.dataset.c, false);
      }
      requestAnimationFrame(autoScrollTick);
    }

    grid.addEventListener('mousedown', function (e) {
      var t = e.target;
      if (t.closest && t.closest('.sdoc-cells-sort, .sdoc-cells-resize')) return;   // caret / resize handle
      var cell = t.closest ? t.closest('.sdoc-cells-cell') : null;
      if (cell && grid.contains(cell)) {
        e.preventDefault();                          // suppress the text caret
        var r = +cell.dataset.r, c = +cell.dataset.c;
        if (e.shiftKey && anchor.r >= 0) extendTo(r, c, false);  // shift-click extends
        else moveTo(r, c, false);
        // Begin a drag: moves extend the range; the edge auto-scroll loop runs
        // until mouseup clears `drag`.
        drag = { grid: grid, x: e.clientX, y: e.clientY, onTo: function (rr, cc) {
          if (rr !== focus.r || cc !== focus.c) extendTo(rr, cc, false);
        } };
        grid.focus({ preventScroll: true });
        requestAnimationFrame(autoScrollTick);
        return;
      }
      // Header click selects a whole column / row.
      var col = t.closest ? t.closest('.sdoc-cells-colhead') : null;
      if (col && grid.contains(col)) { e.preventDefault(); selectColumn(+col.dataset.c); grid.focus({ preventScroll: true }); return; }
      var row = t.closest ? t.closest('.sdoc-cells-rowhead') : null;
      if (row && grid.contains(row)) { e.preventDefault(); selectRow(+row.dataset.r); grid.focus({ preventScroll: true }); return; }
    });

    grid.addEventListener('focus', function () {
      if (anchor.r < 0) moveTo(0, 0, false);
    });

    grid.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); clearSelection(); return; }
      if (anchor.r < 0) return;
      var jump = e.metaKey || e.ctrlKey;             // far edge
      var extend = e.shiftKey;                        // grow the range
      var r = focus.r, c = focus.c, handled = true;
      switch (e.key) {
        case 'ArrowUp':    r = jump ? 0 : r - 1; break;
        case 'ArrowDown':  r = jump ? rows - 1 : r + 1; break;
        case 'ArrowLeft':  c = jump ? 0 : c - 1; break;
        case 'ArrowRight': c = jump ? cols - 1 : c + 1; break;
        default: handled = false;
      }
      if (!handled) return;
      e.preventDefault();                            // no page scroll / back-nav
      if (extend) extendTo(r, c, true);
      else moveTo(r, c, true);
    });
  }

  S.wireCellsSelection = wire;
})();
