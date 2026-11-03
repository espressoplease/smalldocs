// Sheet comments use source coordinates, independently of sorting and scratch edits.
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (root && root.SDocs) root.SDocs.cellsComments = api.create(root);
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function rawRows(model) {
    return ((model && model.cells) || []).map(function (row) {
      return row.map(function (cell) { return String(cell && cell.raw || ''); });
    });
  }
  function rowText(row) { return JSON.stringify(row || []); }
  function sourceKey(source) { return String(source || '').replace(/\r\n/g, '\n').replace(/\n+$/, ''); }
  function indices(comment) {
    if (Array.isArray(comment.cells_rows) && comment.cells_rows.length) return comment.cells_rows.slice();
    var range = comment.range || {}, rows = [];
    for (var r = range.start_row; r <= range.end_row; r++) rows.push(r);
    return rows;
  }
  function validRange(comment, sheet) {
    var range = comment.range || {}, model = sheet && sheet.model;
    if (!model) return false;
    var keys = ['start_row', 'start_col', 'end_row', 'end_col'];
    if (!keys.every(function (key) { return Number.isInteger(range[key]) && range[key] >= 0; })) return false;
    if (range.start_row > range.end_row || range.start_col > range.end_col ||
        range.end_row >= model.rows || range.end_col >= model.cols) return false;
    return !comment.cells_rows || (Array.isArray(comment.cells_rows) && comment.cells_rows.length &&
      comment.cells_rows.every(function (row) { return Number.isInteger(row) && row >= 0 && row < model.rows; }));
  }
  var sourceModels = new WeakMap();
  function resolveTarget(comment, sheets, options) {
    if (!comment || !comment.range) return { status: 'orphaned' };
    if (comment.anchor_status === 'orphaned' || comment.anchor_status === 'ambiguous') {
      return { status: comment.anchor_status };
    }
    options = options || {};
    var cells = typeof module !== 'undefined' && module.exports
      ? require('./sdocs-cells') : window.SDocCells;
    if (cells && comment.sheet_source) {
      var cached = sourceModels.get(comment);
      if (!cached || cached.source !== comment.sheet_source) {
        cached = { source: comment.sheet_source, model: cells.parseCells(comment.sheet_source) };
        sourceModels.set(comment, cached);
      }
      var originalModel = cached.model;
      if (originalModel.error || !validRange(comment, { model: originalModel })) return { status: 'orphaned' };
    }
    var original = /^cells:(\d+)$/.exec(comment.block || '');
    if (original && comment.document_hash && comment.document_hash === options.document_hash && sheets[+original[1]]) {
      if (!validRange(comment, sheets[+original[1]])) return { status: 'orphaned' };
      return { status: 'attached', sheet: sheets[+original[1]], rows: indices(comment),
        columns: Array.from({ length: comment.range.end_col - comment.range.start_col + 1 }, function (_, i) { return comment.range.start_col + i; }) };
    }
    var exact = sheets.filter(function (sheet) {
      return sourceKey(sheet.source) === sourceKey(comment.sheet_source) && (!comment.sheet_name || sheet.name === comment.sheet_name);
    });
    var candidates = exact.length ? exact : sheets.filter(function (sheet) {
      return comment.sheet_name && sheet.name === comment.sheet_name;
    });
    if (candidates.length !== 1) return { status: candidates.length > 1 ? 'ambiguous' : 'orphaned' };
    var sheet = candidates[0], rows = rawRows(sheet.model);
    // Saved coordinates belong to the old sheet when its source changed.
    // Hints below can recover them after rows or columns were removed.
    if (exact.length && !validRange(comment, sheet)) return { status: 'orphaned' };
    if (!exact.length && (!Number.isInteger(comment.range.start_row) || !Number.isInteger(comment.range.end_row) ||
        !Number.isInteger(comment.range.start_col) || !Number.isInteger(comment.range.end_col))) return { status: 'orphaned' };
    var sourceRows = exact.length ? indices(comment) : (Array.isArray(comment.cells_rows) ? comment.cells_rows : (comment.row_texts || []));
    var columns = [];
    if (exact.length) for (var c = comment.range.start_col; c <= comment.range.end_col; c++) columns.push(c);
    else columns = comment.column_texts || [];
    if (exact.length) return { status: 'attached', sheet: sheet, rows: sourceRows, columns: columns };
    var mappedRows = [], mappedColumns = [], ambiguous = false;
    (comment.row_texts || []).forEach(function (hint) {
      var hits = [];
      rows.forEach(function (row, index) { if (rowText(row) === hint) hits.push(index); });
      if (hits.length > 1) ambiguous = true;
      if (hits.length === 1) mappedRows.push(hits[0]);
    });
    (comment.column_texts || []).forEach(function (hint) {
      var hits = [];
      (rows[0] || []).forEach(function (value, index) { if (value === hint) hits.push(index); });
      if (hits.length > 1) ambiguous = true;
      if (hits.length === 1) mappedColumns.push(hits[0]);
    });
    if (ambiguous || new Set(mappedRows).size !== mappedRows.length || new Set(mappedColumns).size !== mappedColumns.length) {
      return { status: 'ambiguous' };
    }
    if (mappedRows.length !== sourceRows.length || mappedColumns.length !== columns.length) return { status: 'orphaned' };
    return { status: 'attached', sheet: sheet, rows: mappedRows, columns: mappedColumns };
  }

  function create(window) {
    var document = window.document, S = window.SDocs, draft = null;
    var ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/></svg>';
    function active() { return document.body.classList.contains('comment-mode'); }
    function ui() { return S.commentsUi; }
    function sheets() {
      return (S.cellsWorkbook || []).map(function (entry, index) {
        return { name: entry.name || entry.model.name || '', source: entry.rawSrc || entry.source || '',
          model: entry.model, wrapper: entry.wrapper, index: index };
      });
    }
    function sheetFor(model, wrapper) {
      var entry = sheets().filter(function (item) { return item.model === model; })[0];
      return entry || (wrapper && wrapper._cellsCommentSheet) || null;
    }
    function colName(c) { return window.SDocCells.colName(c); }
    function address(rows, columns) {
      var sorted = rows.slice().sort(function (a, b) { return a - b; });
      var contiguous = sorted.every(function (row, i) { return !i || row === sorted[i - 1] + 1; });
      var first = columns[0], last = columns[columns.length - 1];
      if (contiguous) {
        var start = colName(first) + (sorted[0] + 1), end = colName(last) + (sorted[sorted.length - 1] + 1);
        return start === end ? start : start + ':' + end;
      }
      return sorted.map(function (row) {
        var start = colName(first) + (row + 1), end = colName(last) + (row + 1);
        return start === end ? start : start + ':' + end;
      }).join(', ');
    }
    function comments() {
      return window.SDocComments.getComments(S.currentMeta || {}).filter(function (c) { return c.kind === 'cells'; });
    }
    function resolve(comment, entries) {
      return resolveTarget(comment, entries || sheets(), {
        document_hash: window.SDocComments.documentFingerprint(S.currentBody),
      });
    }
    function rowOrder(wrapper, row) {
      return wrapper._cellsRowOrder ? wrapper._cellsRowOrder[row] : row;
    }
    function anchorFor(wrapper, model) {
      var sel = wrapper._cellsSelection, sheet = sheetFor(model, wrapper);
      if (!sel || sel.empty || !sheet) return null;
      var snapshot = wrapper._cellsCommentSnapshot;
      if (!snapshot || snapshot.source !== sheet.source) {
        var original = window.SDocCells.parseCells(sheet.source);
        snapshot = { source: sheet.source, rows: rawRows(original), cols: original.cols };
        wrapper._cellsCommentSnapshot = snapshot;
      }
      var sourceRows = [], columns = [], data = snapshot.rows;
      for (var r = sel.r0; r <= sel.r1; r++) {
        var source = rowOrder(wrapper, r);
        if (typeof source !== 'number' || !data[source]) return null;
        sourceRows.push(source);
      }
      for (var c = sel.c0; c <= sel.c1; c++) {
        if (c >= snapshot.cols) return null;
        columns.push(c);
      }
      return {
        block: 'cells:' + sheet.index, sheet_name: sheet.name, sheet_source: sheet.source,
        document_hash: window.SDocComments.documentFingerprint(S.currentBody),
        range: { start_row: Math.min.apply(Math, sourceRows), start_col: sel.c0,
          end_row: Math.max.apply(Math, sourceRows), end_col: sel.c1 },
        cells_rows: sourceRows, row_texts: sourceRows.map(function (row) { return rowText(data[row]); }),
        column_texts: columns.map(function (column) { return (data[0] || [])[column] || ''; }),
        cell_values: sourceRows.map(function (row) { return columns.map(function (column) { return data[row][column] || ''; }); }),
      };
    }
    function listFor(wrapper) {
      var list = wrapper.querySelector(':scope > .sdoc-cells-comment-list');
      if (!list) {
        list = document.createElement('div'); list.className = 'sdoc-cells-comment-list';
        wrapper.appendChild(list);
      }
      return list;
    }
    function paintGrid(wrapper, model) {
      if (!active() || !wrapper || !wrapper.querySelector) return;
      wrapper.querySelectorAll('.sdoc-cells-commented').forEach(function (cell) {
        cell.classList.remove('sdoc-cells-commented'); cell.style.removeProperty('--sdoc-cell-comment-color');
      });
      var sheet = sheetFor(model || wrapper._cellsSource, wrapper);
      if (!sheet) return;
      comments().forEach(function (comment) {
        var target = resolve(comment);
        if (target.status !== 'attached' || target.sheet.index !== sheet.index) return;
        target.rows.forEach(function (sourceRow) {
          var displayRow = wrapper._cellsRowOrder ? wrapper._cellsRowOrder.indexOf(sourceRow) : sourceRow;
          if (displayRow < 0) return;
          target.columns.forEach(function (column) {
            var cell = wrapper.querySelector('.sdoc-cells-cell[data-r="' + displayRow + '"][data-c="' + column + '"]');
            if (!cell) return;
            cell.classList.add('sdoc-cells-commented');
            cell.style.setProperty('--sdoc-cell-comment-color', comment.color || '#ffbb00');
          });
        });
      });
    }
    function renderWrapper(wrapper) {
      if (!active() || !ui() || !ui().makeCardElement || !wrapper.isConnected) return;
      if (draft && draft.wrapper === wrapper && draft.card.isConnected || wrapper.querySelector('.sdoc-card-edit')) return;
      var model = wrapper._cellsSource, sheet = sheetFor(model, wrapper);
      if (!sheet) return;
      wrapper._cellsCommentSheet = sheet;
      var list = listFor(wrapper); list.textContent = '';
      comments().forEach(function (comment) {
        var target = resolve(comment);
        if (target.status !== 'attached' || target.sheet.index !== sheet.index) return;
        var label = (sheet.name ? sheet.name + ' ' : '') + address(target.rows, target.columns);
        var card = ui().makeCardElement(comment, { shape: 'sidecar', mode: 'view', targetLabel: label });
        card.classList.add('sdoc-cells-comment-card'); list.appendChild(card);
      });
      paintGrid(wrapper, model);
      wrapper.querySelectorAll('.sdoc-cells-comment-add').forEach(function (button) {
        button.hidden = !wrapper._cellsSelection;
      });
    }
    function render() {
      if (!active()) { clear(); return; }
      document.querySelectorAll('.sdoc-cells-comment-orphan').forEach(function (card) { card.remove(); });
      document.querySelectorAll('.sdoc-cells').forEach(renderWrapper);
      document.querySelectorAll('.sdoc-cells-comment-add').forEach(function (button) {
        if (button._cellsCommentSync) button._cellsCommentSync();
      });
      var all = sheets();
      comments().forEach(function (comment) {
        var target = resolve(comment, all);
        if (target.status === 'attached' || !S.renderedEl || !ui() || !ui().makeCardElement) return;
        var card = ui().makeCardElement(comment, { shape: 'sidecar', mode: 'view', orphaned: true,
          anchorStatus: target.status, targetLabel: comment.sheet_name || 'Sheet' });
        card.classList.add('sdoc-cells-comment-orphan'); S.renderedEl.appendChild(card);
      });
    }
    function clearDraft() {
      if (draft && draft.card) draft.card.remove();
      draft = null;
    }
    function openComposer(wrapper, model) {
      var anchor = anchorFor(wrapper, model);
      if (!anchor || !ui() || !ui().makeCardElement || !window.SDocComments.addCellsComment) return;
      clearDraft();
      var prefs = ui().readPrefs();
      var columns = [];
      for (var c = anchor.range.start_col; c <= anchor.range.end_col; c++) columns.push(c);
      var label = (anchor.sheet_name ? anchor.sheet_name + ' ' : '') + address(anchor.cells_rows, columns) + ' in saved sheet';
      var composer = ui().makeCardElement({ color: prefs.color, author: prefs.author }, {
        shape: 'sidecar', mode: 'compose', targetLabel: label,
        onSave: function (text) {
          var result = window.SDocComments.addCellsComment(S.currentMeta || {}, anchor, {
            text: text, author: prefs.author, color: prefs.color, at: new Date().toISOString(),
          });
          S.currentMeta = result.meta; clearDraft();
          if (S.syncAll) S.syncAll('comment');
          render();
        },
        onCancel: function () { clearDraft(); renderWrapper(wrapper); },
      });
      composer.classList.add('sdoc-cells-comment-card');
      listFor(wrapper).appendChild(composer); draft = { wrapper: wrapper, card: composer };
      composer.addEventListener('keydown', function (event) { event.stopPropagation(); });
      composer.scrollIntoView({ block: 'nearest' });
    }
    function bindControls(wrapper, model, actions) {
      var button = document.createElement('button'); button.type = 'button';
      button.className = 'sdoc-cells-copy-icon sdoc-cells-comment-add';
      button.setAttribute('aria-label', 'Comment on selected cells'); button.title = 'Comment on selected cells';
      button.innerHTML = ICON;
      function sync() {
        var selection = wrapper._cellsSelection;
        button.hidden = !selection || !!selection.empty;
        button.disabled = !anchorFor(wrapper, model);
        button.title = button.disabled ? 'Choose cells from the saved sheet' : 'Comment on selected cells';
      }
      button._cellsCommentSync = sync;
      function click(event) {
        event.preventDefault(); event.stopPropagation();
        if (!active() && S.setMode) S.setMode('comment');
        openComposer(wrapper, model);
      }
      button.addEventListener('click', click);
      wrapper.addEventListener('cells-selection', sync);
      actions.insertBefore(button, actions.firstChild); sync();
      return function () { wrapper.removeEventListener('cells-selection', sync); button.remove(); };
    }
    function bindGrid(wrapper, model, inlineWrapper) {
      var sheet = sheetFor(model, wrapper) || (inlineWrapper && inlineWrapper._cellsCommentSheet);
      if (sheet) wrapper._cellsCommentSheet = sheet;
      paintGrid(wrapper, model);
    }
    function clear() {
      clearDraft();
      document.querySelectorAll('.sdoc-cells-comment-list, .sdoc-cells-comment-orphan').forEach(function (item) { item.remove(); });
      document.querySelectorAll('.sdoc-cells-commented').forEach(function (cell) {
        cell.classList.remove('sdoc-cells-commented'); cell.style.removeProperty('--sdoc-cell-comment-color');
      });
      document.querySelectorAll('.sdoc-cells-comment-add').forEach(function (button) {
        if (button._cellsCommentSync) button._cellsCommentSync();
      });
    }
    function reveal(id) {
      if (!S.renderedEl || !window.SDocComments.isValidId(id)) return;
      var card = S.renderedEl.querySelector('.sdoc-cells-comment-card[data-c="' + id + '"]');
      var wrapper = card && card.closest('.sdoc-cells');
      if (wrapper && wrapper._cellsReveal) wrapper._cellsReveal();
    }
    return { bindControls: bindControls, bindGrid: bindGrid, paintGrid: paintGrid, render: render,
      reveal: reveal,
      clear: clear, hasDraft: function () {
        return !!(draft && draft.card && draft.card.isConnected) ||
          !!document.querySelector('.sdoc-cells-focus .sdoc-card-edit');
      },
      resolveTarget: resolveTarget, _anchorFor: anchorFor };
  }
  return { create: create, resolveTarget: resolveTarget, rawRows: rawRows, rowText: rowText };
});
