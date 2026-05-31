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

    var actions = document.createElement('div');
    actions.className = 'sdoc-cells-bar-actions';

    // Dynamic: copies the current selection. Hidden until something is picked.
    var selBtn = copyButton('sdoc-cells-copy-sel', 'selection');
    selBtn.style.display = 'none';
    selBtn.title = 'Copy selection as CSV';
    selBtn.addEventListener('click', function () {
      var s = wrapper._cellsSelection;
      if (!s || s.empty) return;
      var sub = [];
      for (var r = s.r0; r <= s.r1; r++) sub.push(model.cells[r].slice(s.c0, s.c1 + 1));
      copyText(CELLS.serializeCsv(rawRows(sub)), selBtn);
    });

    // Always present: a borderless 14px copy icon (matching the code-block
    // copy button) that copies the whole sheet (full data, even if the
    // inline preview was capped) as CSV.
    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'sdoc-cells-copy-icon sdoc-cells-copy-all';
    allBtn.title = 'Copy whole sheet as CSV';
    allBtn.setAttribute('aria-label', 'Copy whole sheet as CSV');
    allBtn.innerHTML = copyIcon(14);
    allBtn.addEventListener('click', function () {
      copyText(CELLS.serializeCsv(rawRows(model.cells)), allBtn);
    });

    // Fullscreen expand - placeholder for now; the focus view is wired later.
    var expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'sdoc-cells-copy-icon sdoc-cells-expand';
    expandBtn.title = 'Open fullscreen';
    expandBtn.setAttribute('aria-label', 'Open fullscreen');
    expandBtn.innerHTML = EXPAND_SVG;

    actions.appendChild(selBtn);
    actions.appendChild(allBtn);
    actions.appendChild(expandBtn);
    bar.appendChild(actions);

    wrapper.addEventListener('cells-selection', function (e) {
      var s = e.detail;
      if (!s || s.empty) {
        setRef('');
        selBtn.style.display = 'none';
        return;
      }
      var a = CELLS.colName(s.c0) + (s.r0 + 1);
      if (s.single) {
        setRef(a);
        selBtn.querySelector('.sdoc-cells-copy-label').textContent = 'cell';
      } else {
        setRef(a + ':' + CELLS.colName(s.c1) + (s.r1 + 1));
        selBtn.querySelector('.sdoc-cells-copy-label').textContent = 'selection';
      }
      selBtn.style.display = '';
    });

    return bar;
  }

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

    // Permanent top toolbar (selection address + copy actions).
    wrapper.appendChild(buildBar(wrapper, model));

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
      ch.dataset.c = String(c);
      ch.textContent = CELLS.colName(c);
      grid.appendChild(ch);
    }

    for (var r = 0; r < rows; r++) {
      var rh = document.createElement('div');
      rh.className = 'sdoc-cells-rowhead';
      rh.dataset.r = String(r);
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

    // Click-to-select + keyboard navigation (sdocs-cells-select.js). Late
    // binding so load order between the two modules does not matter.
    if (S.wireCellsSelection) S.wireCellsSelection(wrapper, grid, scroll, rows, cols);

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

  S.processCells = processCells;
  // Exposed for the fullscreen view + editor to reuse the same renderer.
  S.buildCellsGrid = buildGrid;
})();
