// sdocs-cells-ui.js - browser renderer for ```cells fenced blocks.
//
// ONE rendering technique, dialled up. buildGrid() turns a cell model
// (from window.SDocCells) into a CSS-grid of cell elements: a corner, a
// row of column letters, a column of row numbers, and the data cells.
// This same function is what the fullscreen view and the future editor
// reuse - "inline", "fullscreen", and "editable" are the same drawing in
// a different container with a different flag, never a different renderer.
//
// Why CSS grid and not a <table>: a table can only render every row at
// once, so the day a sheet gets large you are forced into a second
// technique and a seam appears. A grid of cells positioned from the model
// scales to a windowed (virtualized) draw without changing the model or
// this component's contract.
//
// Security: cell text is set via textContent only. There is no innerHTML
// path for user content, so a ```cells block cannot inject markup. Plain
// text in, plain text painted.
//
// Runs after marked + DOMPurify, hooked from sdocs-app.js render() the same
// way charts / mermaid / forms are.
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var S = window.SDocs;
  if (!S) return;
  var CELLS = window.SDocCells;
  if (!CELLS) return; // model must load first; fall through quietly otherwise

  // A space-reserving (always-on) scrollbar leaves the last row open above
  // its strip; an overlay scrollbar (or none) does not. We close the last
  // row with a CSS line ONLY in the reserving case (.has-xscroll), else the
  // line would double the wrapper border. offsetHeight - clientHeight is the
  // reserved scrollbar height: >0 means the strip exists. One shared
  // observer; it unobserves scrollers once they detach so re-renders don't
  // leak (removal fires a 0-size entry, which is where we drop them).
  var overflowRO = (typeof ResizeObserver !== 'undefined')
    ? new ResizeObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var el = entries[i].target;
          if (!el.isConnected) { overflowRO.unobserve(el); continue; }
          var wrap = el.closest('.sdoc-cells');
          if (wrap) wrap.classList.toggle('has-xscroll', (el.offsetHeight - el.clientHeight) > 0);
        }
      })
    : null;

  // Caps - the DoS surface for a fenced block fed by untrusted document text.
  var SOURCE_BYTE_CAP = 256 * 1024; // per-block source size
  var DOC_BLOCK_CAP = 50;           // per-document ```cells block count
  var MAX_COLS = 200;               // widest grid we paint inline
  var MAX_CELLS = 5000;             // total painted cells (rows * cols)
  var MAX_COLS_FULL = 1000;         // fullscreen: room for the whole sheet
  var MAX_CELLS_FULL = 60000;       // fullscreen cap (true virtualization is later)

  // ── Top toolbar ─────────────────────────────────────────
  // A permanent white bar above the grid (white so only the axis stays
  // green). Left: the current selection address. Right: a copy button that
  // copies the whole sheet as CSV, plus a dynamic button that copies the
  // selected range (label "selection") or single cell (label "cell"), shown
  // only while something is selected. Styling mirrors the comments
  // "copy with comments" button.
  // Copy / tick glyphs sized to order (stroke-width 2, matching the code-block
  // copy button). tickIcon mirrors the icon's size so the confirmation swap
  // doesn't resize the button.
  function copyIcon(size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  }
  function tickIcon(size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  }
  // Fullscreen "expand" glyph - the same lucide icon the Mermaid focus button
  // uses (sdocs-mermaid-focus.js).
  var EXPAND_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

  function rawRows(cells) {
    return cells.map(function (row) {
      return row.map(function (cell) { return cell.raw; });
    });
  }

  // Show a tick, then revert to the copy icon after a delay. Always reverts to
  // the copy glyph (a fixed value, not whatever is showing) and clears any
  // pending revert first - otherwise a second click while the tick is up would
  // capture the tick as the "original" and leave it stuck on a tick.
  function flashTick(btn) {
    var svg = btn.querySelector('svg');
    if (!svg) return;
    var size = svg.getAttribute('width') || '13';
    if (btn._tickTimer) clearTimeout(btn._tickTimer);
    svg.outerHTML = tickIcon(size);
    btn._tickTimer = setTimeout(function () {
      var cur = btn.querySelector('svg');
      if (cur) cur.outerHTML = copyIcon(size);
      btn._tickTimer = null;
    }, 1500);
  }

  function copyText(text, btn) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flashTick(btn); }).catch(function () {});
      return;
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); flashTick(btn); } catch (_) {}
    document.body.removeChild(ta);
  }

  // Labelled ghost button (the dynamic selection / cell copy).
  function copyButton(extraClass, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sdoc-cells-copy ' + extraClass;
    b.innerHTML = copyIcon(13) + '<span class="sdoc-cells-copy-label">' + label + '</span>';
    return b;
  }

  // Copy controls shared by the inline toolbar and the fullscreen overlay so
  // they behave identically: a borderless icon that copies the WHOLE sheet,
  // and a dynamic ghost button that copies the current cell / selection. `src`
  // is the element that carries the selection (the grid wrapper) - it holds
  // _cellsSelection and fires `cells-selection`. Returns { box, selBtn, allBtn }.
  function buildCopyControls(src, model) {
    var box = document.createElement('div');
    box.className = 'sdoc-cells-bar-actions';

    var selBtn = copyButton('sdoc-cells-copy-sel', 'selection');
    selBtn.style.display = 'none';
    selBtn.title = 'Copy selection as CSV';
    selBtn.addEventListener('click', function () {
      var s = src._cellsSelection;
      if (!s || s.empty) return;
      var m = src._cellsModel || model;             // the effective (sorted) view
      var sub = [];
      for (var r = s.r0; r <= s.r1; r++) {
        var line = m.cells[r];
        var out = [];
        for (var c = s.c0; c <= s.c1; c++) out.push((line && line[c]) ? line[c].raw : '');
        sub.push(out);                              // padded cells copy as empty
      }
      copyText(CELLS.serializeCsv(sub), selBtn);
    });

    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'sdoc-cells-copy-icon sdoc-cells-copy-all';
    allBtn.title = 'Copy whole sheet as CSV';
    allBtn.setAttribute('aria-label', 'Copy whole sheet as CSV');
    allBtn.innerHTML = copyIcon(14);
    allBtn.addEventListener('click', function () {
      copyText(CELLS.serializeCsv(rawRows((src._cellsModel || model).cells)), allBtn);
    });

    box.appendChild(selBtn);
    box.appendChild(allBtn);

    src.addEventListener('cells-selection', function (e) {
      var s = e.detail;
      if (!s || s.empty) { selBtn.style.display = 'none'; return; }
      selBtn.querySelector('.sdoc-cells-copy-label').textContent = s.single ? 'cell' : 'selection';
      selBtn.style.display = '';
    });

    return { box: box, selBtn: selBtn, allBtn: allBtn };
  }

  function buildBar(wrapper, model) {
    var source = model.source || '';
    var bar = document.createElement('div');
    bar.className = 'sdoc-cells-bar';

    var ref = document.createElement('div');
    ref.className = 'sdoc-cells-ref';
    // Left label: the selection address and/or the source filename, e.g.
    // "report.csv", "B3", or "B3 · report.csv".
    function setRef(addr) {
      var parts = [];
      if (addr) parts.push(addr);
      if (source) parts.push(source);
      ref.textContent = parts.join('  ·  ');
    }
    setRef('');
    bar.appendChild(ref);

    var controls = buildCopyControls(wrapper, model);

    // Fullscreen expand (inline only - the overlay is already fullscreen).
    var expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'sdoc-cells-copy-icon sdoc-cells-expand';
    expandBtn.title = 'Open fullscreen';
    expandBtn.setAttribute('aria-label', 'Open fullscreen');
    expandBtn.innerHTML = EXPAND_SVG;
    expandBtn.addEventListener('click', function () {
      if (S.cellsFocus) S.cellsFocus.open(model, wrapper);
    });
    controls.box.appendChild(expandBtn);

    bar.appendChild(controls.box);

    // The address label is inline-only; the overlay has a dedicated name box.
    wrapper.addEventListener('cells-selection', function (e) {
      var s = e.detail;
      if (!s || s.empty) { setRef(''); return; }
      var a = CELLS.colName(s.c0) + (s.r0 + 1);
      setRef(s.single ? a : a + ':' + CELLS.colName(s.c1) + (s.r1 + 1));
    });

    return bar;
  }

  // Build the inline grid DOM from a model. Returns the wrapper element.
  // Caps rows/cols to keep the inline preview bounded; a note reports any
  // truncation so a clipped sheet never silently reads as complete. The
  // fullscreen view (later) renders the same model without the inline cap.
  function buildGrid(model, opts) {
    opts = opts || {};
    var fullscreen = !!opts.fullscreen;
    var colCap = fullscreen ? MAX_COLS_FULL : MAX_COLS;
    var cellCap = fullscreen ? MAX_CELLS_FULL : MAX_CELLS;
    var cols = Math.min(model.cols, colCap);
    var maxRows = Math.max(1, Math.floor(cellCap / Math.max(1, cols)));
    var rows = Math.min(model.rows, maxRows);
    var truncated = cols < model.cols || rows < model.rows;

    // Fullscreen pads the grid past the data with empty cells so it fills the
    // canvas and scrolls, like a real spreadsheet. Sized to the viewport with
    // sensible floors; inline never pads (renderCols/Rows == cols/rows).
    var renderCols = cols, renderRows = rows;
    if (fullscreen) {
      var vw = (typeof window !== 'undefined' && window.innerWidth) || 1280;
      var vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
      renderCols = Math.min(colCap, Math.max(cols, 26, Math.ceil(vw / 64)));
      renderRows = Math.min(Math.max(1, Math.floor(cellCap / Math.max(1, renderCols))),
                            Math.max(rows, 50, Math.ceil(vh / 22)));
    }

    var wrapper = document.createElement('div');
    wrapper.className = 'sdoc-cells' + (fullscreen ? ' sdoc-cells-fs' : '');

    var scroll = document.createElement('div');
    scroll.className = 'sdoc-cells-scroll';

    var grid = document.createElement('div');
    grid.className = 'sdoc-cells-grid';
    grid.setAttribute('role', 'grid');

    // Per-column explicit widths (set by dragging a header's resize handle).
    // Persist across re-sorts. Undefined = auto (content-sized).
    var colWidths = [];
    function applyTemplate() {
      var parts = ['min-content'];
      for (var c = 0; c < renderCols; c++) {
        parts.push(colWidths[c] != null
          ? colWidths[c] + 'px'
          : 'minmax(var(--sdoc-cells-col-min, 64px), max-content)');
      }
      grid.style.gridTemplateColumns = parts.join(' ');
    }
    applyTemplate();

    var EMPTY_CELL = { raw: '', value: '', type: 'empty' };
    var hasHeader = CELLS.looksLikeHeader(model);
    var sort = opts.sort || null;   // { col, dir } - a view reorder

    // (Re)paint the grid body from the effective (possibly sorted) model.
    // wrapper._cellsModel always holds that effective model, so the toolbar,
    // copy, stats, and value bar reflect what is on screen after a sort.
    function paint() {
      var vm = model;
      var order = null;
      if (sort) {
        order = CELLS.sortRows(model, sort.col, sort.dir, hasHeader);
        vm = { rows: model.rows, cols: model.cols, formats: model.formats,
               source: model.source, cells: order.map(function (ri) { return model.cells[ri]; }) };
      }
      wrapper._cellsModel = vm;
      // Maps a painted (display) row index to its row in the source model. Null
      // when unsorted (identity). The editor uses this to write the right cell.
      wrapper._cellsRowOrder = order;
      // Resolve any =formula cells once for this paint. fx[r][c] carries the
      // computed result (or an error code) so a formula cell shows its value
      // while its raw keeps the formula for copy / export.
      var FX = window.SDocCellsFormula;
      var fx = FX ? FX.recalc(vm) : null;
      wrapper._cellsFx = fx;
      while (grid.firstChild) grid.removeChild(grid.firstChild);

      var corner = document.createElement('div');
      corner.className = 'sdoc-cells-corner';
      grid.appendChild(corner);
      for (var c = 0; c < renderCols; c++) {
        var ch = document.createElement('div');
        ch.className = 'sdoc-cells-colhead' + (sort && sort.col === c ? ' is-sorted' : '');
        ch.dataset.c = String(c);
        var label = document.createElement('span');
        label.className = 'sdoc-cells-colhead-label';
        label.textContent = CELLS.colName(c);
        ch.appendChild(label);
        if (c < cols) {                                  // sort only real columns
          var caret = document.createElement('span');
          caret.className = 'sdoc-cells-sort';
          caret.dataset.c = String(c);
          caret.textContent = (sort && sort.col === c) ? (sort.dir === 'asc' ? '↑' : '↓') : '↕';
          ch.appendChild(caret);
        }
        var handle = document.createElement('span');   // drag to resize this column
        handle.className = 'sdoc-cells-resize';
        handle.dataset.c = String(c);
        ch.appendChild(handle);
        grid.appendChild(ch);
      }

      for (var r = 0; r < renderRows; r++) {
        var rh = document.createElement('div');
        rh.className = 'sdoc-cells-rowhead';
        rh.dataset.r = String(r);
        rh.textContent = String(r + 1);
        grid.appendChild(rh);
        var line = vm.cells[r];
        for (var c2 = 0; c2 < renderCols; c2++) {
          var cell = (line && line[c2]) || EMPTY_CELL;   // pad past the data
          var el = document.createElement('div');
          var fmt = vm.formats && vm.formats[c2];
          // A formula cell (raw starts with '=') shows its computed result and
          // behaves like a number for alignment / formatting; its raw is kept.
          var fxCell = (fx && FX.isFormula(cell.raw)) ? fx[r][c2] : null;

          var typeCls;
          if (fxCell) {
            if (fxCell.kind === 'error') typeCls = ' is-text is-formula-error';
            else typeCls = ' is-number is-formula' + (fxCell.value < 0 ? ' is-negative' : '');
          } else {
            typeCls = cell.type === 'number' ? ' is-number'
              : cell.type === 'empty' ? ' is-empty' : ' is-text';
            if (cell.type === 'number' && cell.value < 0) typeCls += ' is-negative';
          }
          if (hasHeader && r === 0) typeCls += ' is-header';   // detected header row
          el.className = 'sdoc-cells-cell' + typeCls;
          el.setAttribute('role', 'gridcell');
          el.dataset.r = String(r);
          el.dataset.c = String(c2);
          // Display only - the model's raw is untouched, so copy / export emit
          // the original. Numbers use the column's format; text keeps its
          // content with a literal <br> as a line break (plain text only).
          if (fxCell) {
            if (fxCell.kind === 'error') {
              el.textContent = fxCell.code;
            } else {
              var fcell = { value: fxCell.value, raw: String(fxCell.value), type: 'number' };
              el.textContent = fmt ? CELLS.formatValue(fcell, fmt) : CELLS.formatNumber(fcell.raw);
            }
            el.title = cell.raw;                              // hover shows the formula
          } else if (cell.type === 'number') {
            el.textContent = fmt ? CELLS.formatValue(cell, fmt) : CELLS.formatNumber(cell.raw);
          } else {
            el.textContent = cell.raw.replace(/<br\s*\/?>/gi, '\n');
          }
          grid.appendChild(el);
        }
      }
    }
    paint();

    // Click a column-header sort caret: cycle asc -> desc -> off, repaint, and
    // clear the (now-stale) selection.
    grid.addEventListener('click', function (e) {
      var caret = e.target.closest ? e.target.closest('.sdoc-cells-sort') : null;
      if (!caret || !grid.contains(caret)) return;
      e.stopPropagation();
      var c = +caret.dataset.c;
      if (!sort || sort.col !== c) sort = { col: c, dir: 'asc' };
      else if (sort.dir === 'asc') sort = { col: c, dir: 'desc' };
      else sort = null;
      paint();
      if (grid._clearSelection) grid._clearSelection();
    });

    // Drag a column header's resize handle to set an explicit width.
    grid.addEventListener('mousedown', function (e) {
      var handle = e.target.closest ? e.target.closest('.sdoc-cells-resize') : null;
      if (!handle || !grid.contains(handle)) return;
      e.preventDefault(); e.stopPropagation();
      var c = +handle.dataset.c;
      var head = grid.querySelector('.sdoc-cells-colhead[data-c="' + c + '"]');
      var startX = e.clientX, startW = head.getBoundingClientRect().width;
      function onMove(ev) { colWidths[c] = Math.max(40, Math.round(startW + (ev.clientX - startX))); applyTemplate(); }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('sdoc-cells-resizing');
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.classList.add('sdoc-cells-resizing');
    });

    scroll.appendChild(grid);
    // Hooks for the fullscreen editor: the mutable source model, a repaint
    // trigger (re-derives sort + recalc), and the rendered extent so it knows
    // how far the padded blank area reaches.
    wrapper._cellsSource = model;
    wrapper._cellsRepaint = paint;
    wrapper._cellsExtent = { rows: renderRows, cols: renderCols };
    // Toolbar reads wrapper._cellsModel (set by paint) so copy follows a sort.
    if (!fullscreen) wrapper.appendChild(buildBar(wrapper, model));
    wrapper.appendChild(scroll);

    // Watch for a space-reserving scrollbar; toggles .has-xscroll so the
    // closing line under the last row is drawn only when needed.
    if (overflowRO) overflowRO.observe(scroll);

    // Click-to-select + keyboard navigation (sdocs-cells-select.js). Late
    // binding so load order between the two modules does not matter. Bounds use
    // the rendered extent so you can navigate into the padded empty area.
    if (S.wireCellsSelection) S.wireCellsSelection(wrapper, grid, scroll, renderRows, renderCols);

    if (truncated) {
      var note = document.createElement('div');
      note.className = 'sdoc-cells-note';
      note.textContent = 'Showing ' + rows + ' × ' + cols +
        ' of ' + model.rows + ' × ' + model.cols + ' cells';
      wrapper.appendChild(note);
    }
    return wrapper;
  }

  function renderError(target, message) {
    var wrapper = document.createElement('div');
    wrapper.className = 'sdoc-cells sdoc-cells-error';
    var pre = document.createElement('pre');
    pre.className = 'sdoc-cells-error-msg';
    pre.textContent = String(message || 'Could not render cells');
    wrapper.appendChild(pre);
    target.parentNode.replaceChild(wrapper, target);
    return wrapper;
  }

  // Neutral message (e.g. a loading placeholder), not an error.
  function renderNotice(target, message) {
    var wrapper = document.createElement('div');
    wrapper.className = 'sdoc-cells sdoc-cells-msg';
    var body = document.createElement('div');
    body.className = 'sdoc-cells-msg-body';
    body.textContent = String(message || '');
    wrapper.appendChild(body);
    target.parentNode.replaceChild(wrapper, target);
    return wrapper;
  }

  // Build the grid for a model and swap it in for `target`. `src` is stashed
  // so the exporter can re-parse the model to a clean table.
  function mountGrid(target, model, src) {
    var wrapper = buildGrid(model);
    wrapper.dataset.cellsSrc = src;
    target.parentNode.replaceChild(wrapper, target);
    return wrapper;
  }

  // A {{file.csv}} reference reached the browser unbaked (live `sdoc file.md`).
  // If a bridge is connected, ask it to read the file and paint the grid -
  // display only; the document keeps its {{ref}} so the save loop is untouched.
  // Without a bridge (e.g. a raw file dropped in), explain how to load it.
  function resolveReference(target, ref) {
    var filePath = String(ref).replace(/:([A-Za-z]+\d+(?::[A-Za-z]+\d+)?)$/, '');
    var bridge = S.bridge;
    if (!bridge || typeof bridge.readFile !== 'function') {
      renderError(target, 'References ' + ref +
        ' - open this document with the sdoc CLI to load the data.');
      return;
    }
    var notice = renderNotice(target, 'Loading ' + filePath + '…');
    bridge.readFile(filePath).then(function (csv) {
      var base = filePath.replace(/^.*[\\/]/, '');
      var baked = 'sdoc-cells: source=' + base + '\n' + String(csv).replace(/\s+$/, '');
      var model = CELLS.parseCells(baked);
      if (model.error) { renderError(notice, model.error); return; }
      if (model.empty) { renderError(notice, 'Empty file ' + base); return; }
      mountGrid(notice, model, baked);
    }).catch(function (e) {
      renderError(notice, 'Could not load ' + filePath + ' - ' + ((e && e.message) || 'read failed'));
    });
  }

  // Walk every code.language-cells block in container, parse it, and replace
  // the <pre> (or its .pre-wrapper) with the rendered grid.
  function processCells(container) {
    var scope = container || document.getElementById('_sd_rendered');
    if (!scope) return;
    var nodes = scope.querySelectorAll('code.language-cells');
    var capped = Array.prototype.slice.call(nodes, 0, DOC_BLOCK_CAP);
    for (var i = 0; i < capped.length; i++) {
      var codeEl = capped[i];
      var pre = codeEl.closest('pre');
      if (!pre) continue;
      var target = pre.closest('.pre-wrapper') || pre;
      var rawSrc = codeEl.textContent || '';
      if (rawSrc.length > SOURCE_BYTE_CAP) {
        renderError(target, 'Cells source exceeds ' + (SOURCE_BYTE_CAP / 1024) + ' KB cap');
        continue;
      }
      var model;
      try { model = CELLS.parseCells(rawSrc); }
      catch (e) { renderError(target, (e && e.message) || 'Parse error'); continue; }
      if (model.unresolved) { resolveReference(target, model.unresolved); continue; }
      if (model.error) { renderError(target, model.error); continue; }
      if (model.empty) { renderError(target, 'Empty cells block'); continue; }
      mountGrid(target, model, rawSrc);
    }
  }

  // Short numeric display for stats - round to a few decimals, drop trailing
  // zeros. (Thousands separators come with the number-formatting step.)
  function fmtStatNum(n) {
    if (n == null) return '';
    return String(Math.round(n * 100) / 100);
  }

  // A "Sum · Avg · Count" line for a selected range (Excel/Sheets status bar).
  // Empty for nothing / a single cell (the value bar already shows that one).
  function formatStats(model, sel) {
    if (!sel || sel.empty) return '';
    if (sel.single || (sel.r0 === sel.r1 && sel.c0 === sel.c1)) return '';
    var st = CELLS.selectionStats(model, sel.r0, sel.c0, sel.r1, sel.c1);
    if (st.count === 0) return '';
    var parts = [];
    if (st.numericCount > 0) {
      parts.push('Sum ' + fmtStatNum(st.sum));
      parts.push('Avg ' + fmtStatNum(st.avg));
      if (st.numericCount > 1) {
        parts.push('Min ' + fmtStatNum(st.min));
        parts.push('Max ' + fmtStatNum(st.max));
      }
    }
    parts.push('Count ' + st.count);
    return parts.join('   ·   ');
  }
  S.formatCellsStats = formatStats;

  S.processCells = processCells;
  // Exposed for the fullscreen view + editor to reuse the same renderer.
  S.buildCellsGrid = buildGrid;
  S.buildCellsCopyControls = buildCopyControls;
})();
