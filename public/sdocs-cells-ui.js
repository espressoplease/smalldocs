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

  // Build the inline grid DOM from a model. Returns the wrapper element.
  // Caps rows/cols to keep the inline preview bounded; a note reports any
  // truncation so a clipped sheet never silently reads as complete. The
  // fullscreen view (later) renders the same model without the inline cap.
  function buildGrid(model) {
    var cols = Math.min(model.cols, MAX_COLS);
    var maxRows = Math.max(1, Math.floor(MAX_CELLS / Math.max(1, cols)));
    var rows = Math.min(model.rows, maxRows);
    var truncated = cols < model.cols || rows < model.rows;

    var wrapper = document.createElement('div');
    wrapper.className = 'sdoc-cells';

    // The grid scrolls horizontally inside this inner box; the wrapper
    // itself stays put, so the truncation note (and a future toolbar / the
    // fullscreen button) pin to the visible area instead of scrolling off
    // with the cells.
    var scroll = document.createElement('div');
    scroll.className = 'sdoc-cells-scroll';

    var grid = document.createElement('div');
    grid.className = 'sdoc-cells-grid';
    grid.setAttribute('role', 'grid');
    // Row-number gutter + N content columns. Content columns size to their
    // text within a sensible min/max so the grid reads like a sheet.
    grid.style.gridTemplateColumns =
      'min-content repeat(' + cols + ', minmax(48px, max-content))';

    var corner = document.createElement('div');
    corner.className = 'sdoc-cells-corner';
    grid.appendChild(corner);
    for (var c = 0; c < cols; c++) {
      var ch = document.createElement('div');
      ch.className = 'sdoc-cells-colhead';
      ch.textContent = CELLS.colName(c);
      grid.appendChild(ch);
    }

    for (var r = 0; r < rows; r++) {
      var rh = document.createElement('div');
      rh.className = 'sdoc-cells-rowhead';
      rh.textContent = String(r + 1);
      grid.appendChild(rh);
      var line = model.cells[r];
      for (var c2 = 0; c2 < cols; c2++) {
        var cell = line[c2];
        var el = document.createElement('div');
        var typeCls = cell.type === 'number' ? ' is-number'
          : cell.type === 'empty' ? ' is-empty' : ' is-text';
        el.className = 'sdoc-cells-cell' + typeCls;
        el.setAttribute('role', 'gridcell');
        el.dataset.r = String(r);
        el.dataset.c = String(c2);
        // Display only: a literal <br> becomes a newline (CSS white-space
        // pre-wrap then renders it as a line break). Still plain text - set
        // via textContent, so no markup is ever parsed. The model's raw is
        // untouched; this is a render-time convenience for hand-typed <br>.
        el.textContent = cell.raw.replace(/<br\s*\/?>/gi, '\n');
        grid.appendChild(el);
      }
    }

    scroll.appendChild(grid);
    wrapper.appendChild(scroll);

    // Watch for a space-reserving scrollbar; toggles .has-xscroll so the
    // closing line under the last row is drawn only when needed.
    if (overflowRO) overflowRO.observe(scroll);

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
      if (model.empty) { renderError(target, 'Empty cells block'); continue; }
      var wrapper = buildGrid(model);
      // Stash the source so the exporter can re-parse the model to a clean
      // table without reading geometry back out of the rendered grid.
      wrapper.dataset.cellsSrc = rawSrc;
      target.parentNode.replaceChild(wrapper, target);
    }
  }

  S.processCells = processCells;
  // Exposed for the fullscreen view + editor to reuse the same renderer.
  S.buildCellsGrid = buildGrid;
})();
