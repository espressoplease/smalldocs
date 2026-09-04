// sdocs-cells-select.js - cell and range selection for cells grids.
//
// The selection implementation is shared by the SmallDocs application and
// browser SDK. create() owns every grid and document listener it registers, so
// separate readers cannot clear or drag each other's selections. wire() returns
// an idempotent cleanup for one grid; destroy() cleans the whole instance.
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (root) {
    root.SDocCellsSelection = api;
    if (root.SDocs) api.installProduction(root);
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function create(options) {
    options = options || {};
    var window = options.window;
    var document = options.document || (window && window.document);
    if (!window || !document) throw new Error('Cells selection requires window and document');
    var requestFrame = options.requestAnimationFrame || window.requestAnimationFrame;
    var cancelFrame = options.cancelAnimationFrame || window.cancelAnimationFrame;
    var records = [];
    var drag = null;
    var autoFrame = null;
    var destroyed = false;

    function closest(target, selector) {
      return target && typeof target.closest === 'function' ? target.closest(selector) : null;
    }

    function removeRecord(record) {
      var index = records.indexOf(record);
      if (index >= 0) records.splice(index, 1);
    }

    function stopDrag(record) {
      if (record && (!drag || drag.record !== record)) return;
      drag = null;
      if (autoFrame != null && typeof cancelFrame === 'function') cancelFrame.call(window, autoFrame);
      autoFrame = null;
    }

    function scheduleAutoScroll() {
      if (destroyed || !drag || autoFrame != null || typeof requestFrame !== 'function') return;
      autoFrame = requestFrame.call(window, autoScrollTick);
    }

    function autoScrollTick() {
      autoFrame = null;
      if (destroyed || !drag) return;
      var record = drag.record;
      if (!record || record.cleaned) { stopDrag(); return; }
      var grid = record.grid;
      var scroll = record.scroll;
      var vp = scroll.getBoundingClientRect();
      var rh = grid.querySelector('.sdoc-cells-rowhead');
      var gutter = rh ? rh.getBoundingClientRect().width : 0;
      var EDGE = 28;
      var STEP = 18;
      var maxLeft = scroll.scrollWidth - scroll.clientWidth;
      var dir = 0;
      if (drag.x > vp.right - EDGE && scroll.scrollLeft < maxLeft) dir = 1;
      else if (drag.x < vp.left + gutter + EDGE && scroll.scrollLeft > 0) dir = -1;
      if (dir !== 0) {
        scroll.scrollLeft += dir * STEP;
        var sx = Math.max(vp.left + gutter + 1, Math.min(vp.right - 1, drag.x));
        var el = document.elementFromPoint(sx, drag.y);
        var cell = closest(el, '.sdoc-cells-cell');
        if (cell && grid.contains(cell)) record.extendTo(+cell.dataset.r, +cell.dataset.c, false);
      }
      scheduleAutoScroll();
    }

    function onDocumentMove(event) {
      if (!drag) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      var cell = closest(event.target, '.sdoc-cells-cell');
      if (cell && drag.record.grid.contains(cell)) drag.onTo(+cell.dataset.r, +cell.dataset.c);
    }

    function onDocumentUp() { stopDrag(); }

    function onDocumentDown(event) {
      records.slice().forEach(function (record) {
        if (record.cleaned || record.wrapper.classList.contains('sdoc-cells-fs')) return;
        if (!record.wrapper.contains(event.target)) record.clearSelection();
      });
    }

    document.addEventListener('mousemove', onDocumentMove);
    document.addEventListener('mouseup', onDocumentUp);
    document.addEventListener('mousedown', onDocumentDown);

    function wire(wrapper, grid, scroll, rows, cols) {
      if (destroyed || !grid || rows < 1 || cols < 1) return function () {};
      if (grid._cellsSelectionCleanup) grid._cellsSelectionCleanup();
      grid.tabIndex = 0;
      var anchor = { r: -1, c: -1 };
      var focus = { r: -1, c: -1 };
      var record = { wrapper: wrapper, grid: grid, scroll: scroll, cleaned: false };
      records.push(record);

      function maxRows() { return (wrapper._cellsExtent && wrapper._cellsExtent.rows) || rows; }
      function maxCols() { return (wrapper._cellsExtent && wrapper._cellsExtent.cols) || cols; }
      function clamp(value, count) { return Math.max(0, Math.min(count - 1, value)); }
      function cellAt(r, c) {
        return grid.querySelector('.sdoc-cells-cell[data-r="' + r + '"][data-c="' + c + '"]');
      }

      function clearPaint() {
        var previous = grid.querySelectorAll('.is-active, .in-range, .is-active-col, .is-active-row');
        for (var i = 0; i < previous.length; i++) {
          previous[i].classList.remove('is-active', 'in-range', 'is-active-col', 'is-active-row');
          previous[i].style.boxShadow = '';
          previous[i].removeAttribute('aria-selected');
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

      function emit(detail) {
        try { wrapper.dispatchEvent(new window.CustomEvent('cells-selection', { detail: detail })); }
        catch (_) {}
      }

      function apply(doScroll) {
        if (record.cleaned || anchor.r < 0) return;
        clearPaint();
        var r0 = Math.min(anchor.r, focus.r);
        var r1 = Math.max(anchor.r, focus.r);
        var c0 = Math.min(anchor.c, focus.c);
        var c1 = Math.max(anchor.c, focus.c);
        var single = r0 === r1 && c0 === c1;
        var ACCENT = 'var(--sdoc-cells-accent)';
        for (var r = r0; r <= r1; r++) {
          for (var c = c0; c <= c1; c++) {
            var cell = cellAt(r, c);
            if (!cell) continue;
            if (single) cell.classList.add('is-active');
            else {
              cell.classList.add('in-range');
              var parts = [];
              if (r === r0) parts.push('inset 0 2px 0 0 ' + ACCENT);
              if (r === r1) parts.push('inset 0 -2px 0 0 ' + ACCENT);
              if (c === c0) parts.push('inset 2px 0 0 0 ' + ACCENT);
              if (c === c1) parts.push('inset -2px 0 0 0 ' + ACCENT);
              if (parts.length) cell.style.boxShadow = parts.join(', ');
            }
          }
        }
        var focusCell = cellAt(focus.r, focus.c);
        if (cellAt(r0, c0) && focusCell) focusCell.setAttribute('aria-selected', 'true');
        for (var cc = c0; cc <= c1; cc++) {
          var col = grid.querySelector('.sdoc-cells-colhead[data-c="' + cc + '"]');
          if (col) col.classList.add('is-active-col');
        }
        for (var rr = r0; rr <= r1; rr++) {
          var row = grid.querySelector('.sdoc-cells-rowhead[data-r="' + rr + '"]');
          if (row) row.classList.add('is-active-row');
        }
        if (doScroll && focusCell) ensureVisible(focusCell);
        wrapper._cellsSelection = { r0: r0, c0: c0, r1: r1, c1: c1, single: single };
        emit(wrapper._cellsSelection);
      }

      function clearSelection() {
        if (record.cleaned) return;
        anchor.r = anchor.c = focus.r = focus.c = -1;
        clearPaint();
        wrapper._cellsSelection = null;
        emit({ empty: true });
      }

      function moveTo(r, c, doScroll) {
        anchor.r = focus.r = clamp(r, maxRows());
        anchor.c = focus.c = clamp(c, maxCols());
        apply(doScroll);
      }

      function extendTo(r, c, doScroll) {
        focus.r = clamp(r, maxRows());
        focus.c = clamp(c, maxCols());
        apply(doScroll);
      }

      record.clearSelection = clearSelection;
      record.extendTo = extendTo;
      grid._clearSelection = clearSelection;
      grid._moveTo = moveTo;
      grid._extendTo = extendTo;
      grid._selectionRect = function () {
        if (anchor.r < 0) return null;
        return {
          r0: Math.min(anchor.r, focus.r), c0: Math.min(anchor.c, focus.c),
          r1: Math.max(anchor.r, focus.r), c1: Math.max(anchor.c, focus.c),
        };
      };

      function selectColumn(c) {
        anchor.r = 0;
        anchor.c = clamp(c, maxCols());
        focus.r = maxRows() - 1;
        focus.c = anchor.c;
        apply(false);
      }

      function selectRow(r) {
        anchor.r = clamp(r, maxRows());
        anchor.c = 0;
        focus.r = anchor.r;
        focus.c = maxCols() - 1;
        apply(false);
      }

      function onMouseDown(event) {
        var target = event.target;
        if (closest(target, '.sdoc-cells-sort, .sdoc-cells-resize')) return;
        var cell = closest(target, '.sdoc-cells-cell');
        if (cell && grid.contains(cell)) {
          event.preventDefault();
          var r = +cell.dataset.r;
          var c = +cell.dataset.c;
          if (event.shiftKey && anchor.r >= 0) extendTo(r, c, false);
          else moveTo(r, c, false);
          drag = {
            record: record,
            x: event.clientX,
            y: event.clientY,
            onTo: function (nextR, nextC) {
              if (nextR !== focus.r || nextC !== focus.c) extendTo(nextR, nextC, false);
            },
          };
          grid.focus({ preventScroll: true });
          scheduleAutoScroll();
          return;
        }
        var col = closest(target, '.sdoc-cells-colhead');
        if (col && grid.contains(col)) {
          event.preventDefault();
          selectColumn(+col.dataset.c);
          grid.focus({ preventScroll: true });
          return;
        }
        var row = closest(target, '.sdoc-cells-rowhead');
        if (row && grid.contains(row)) {
          event.preventDefault();
          selectRow(+row.dataset.r);
          grid.focus({ preventScroll: true });
        }
      }

      function onFocus() { if (anchor.r < 0) moveTo(0, 0, false); }

      function onKeyDown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          clearSelection();
          return;
        }
        if (anchor.r < 0) return;
        var jump = event.metaKey || event.ctrlKey;
        var extend = event.shiftKey;
        var r = focus.r;
        var c = focus.c;
        var handled = true;
        switch (event.key) {
          case 'ArrowUp': r = jump ? 0 : r - 1; break;
          case 'ArrowDown': r = jump ? maxRows() - 1 : r + 1; break;
          case 'ArrowLeft': c = jump ? 0 : c - 1; break;
          case 'ArrowRight': c = jump ? maxCols() - 1 : c + 1; break;
          default: handled = false;
        }
        if (!handled) return;
        event.preventDefault();
        if (extend) extendTo(r, c, true);
        else moveTo(r, c, true);
      }

      grid.addEventListener('mousedown', onMouseDown);
      grid.addEventListener('focus', onFocus);
      grid.addEventListener('keydown', onKeyDown);

      function cleanup() {
        if (record.cleaned) return;
        record.cleaned = true;
        stopDrag(record);
        grid.removeEventListener('mousedown', onMouseDown);
        grid.removeEventListener('focus', onFocus);
        grid.removeEventListener('keydown', onKeyDown);
        if (grid._clearSelection === clearSelection) delete grid._clearSelection;
        if (grid._moveTo === moveTo) delete grid._moveTo;
        if (grid._extendTo === extendTo) delete grid._extendTo;
        if (grid._cellsSelectionCleanup === cleanup) delete grid._cellsSelectionCleanup;
        delete grid._selectionRect;
        removeRecord(record);
      }

      grid._cellsSelectionCleanup = cleanup;
      return cleanup;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      stopDrag();
      records.slice().forEach(function (record) {
        if (record.grid._cellsSelectionCleanup) record.grid._cellsSelectionCleanup();
      });
      document.removeEventListener('mousemove', onDocumentMove);
      document.removeEventListener('mouseup', onDocumentUp);
      document.removeEventListener('mousedown', onDocumentDown);
    }

    return { wire: wire, destroy: destroy };
  }

  function installProduction(root) {
    var S = root.SDocs;
    if (S.__cellsSelectionInstance) return S.__cellsSelectionInstance;
    var instance = create({ window: root, document: root.document });
    S.__cellsSelectionInstance = instance;
    S.wireCellsSelection = instance.wire;
    if (S.__cellsUiInstance && S.__cellsUiInstance.setSelection) S.__cellsUiInstance.setSelection(instance);
    return instance;
  }

  return { create: create, installProduction: installProduction };
});
