// cells-verify.js - headless evaluation of a document's ```cells tabs.
//
// `sdoc cells verify <file.md>` parses every ```cells block, names the tabs
// exactly as the browser does, recalculates them together as one workbook
// (so cross-tab references like Sales!A1 resolve), and prints the COMPUTED
// values. It is the agent's feedback loop: write formulas, run this, read the
// numbers back - no browser, same engine the page runs (cli/shared/), so what
// it prints is what ships.
//
// Output:
//   default   CSV per tab, each under a "# sheet: <name>" banner. Human view;
//             a data row could itself start with "# sheet:", so this form is
//             documented as not machine-round-trippable - agents use --json.
//   --json    { ok, sheets:[{name, values:[[...]]}], errors:[{sheet,cell,code}] }
//   --sheet N only that tab (case-insensitive). Absent name -> exit 2.
//
// Exit: 0 = no cell errors in the emitted tabs; 1 = at least one cell error
// (#REF!/#CIRC!/#DIV0!/...); 2 = bad usage (no file, --sheet names no tab).

const path = require('path');
const io = require('./io');
const CELLS = require('../shared/sdocs-cells.js');
const FX = require('../shared/sdocs-cells-formula.js');

// Scan ```cells (or ~~~cells) fenced blocks, capturing the fence info string
// as the tab name and the block body. Approximate vs marked (no nested-fence
// awareness) but matches how agents author docs. The closing fence must be the
// same run of fence characters (backreference) at a line start.
function scanCellsBlocks(md) {
  var re = /(?:^|\n)(```+|~~~+)cells[ \t]*([^\n]*)\n([\s\S]*?)\n\1[ \t]*(?=\n|$)/g;
  var blocks = [];
  var m;
  while ((m = re.exec(md))) {
    blocks.push({ info: (m[2] || '').replace(/"/g, ''), body: m[3] });
  }
  return blocks;
}

// Parse + name + group every block into workbooks, mirroring the renderer.
// Each block's fence info is split into a workbook id and a sheet name (the
// first "/" separates them); a baked `workbook=` / `name=` directive is the
// fallback. Blocks bucket by workbook id in first-seen order; within each
// workbook a fence/directive name wins, else auto Sheet1/Sheet2..., and both
// the auto counter and duplicate detection reset per workbook. recalcWorkbook
// later resolves references only within one workbook, so a Sheet!A1 into
// another workbook reads #REF! - the same isolation the browser enforces.
function buildWorkbook(md) {
  var blocks = scanCellsBlocks(md);
  var order = [];     // workbook ids, first-seen order
  var byWb = {};      // id -> [{ name, model }]
  var parseErrors = [];
  for (var i = 0; i < blocks.length; i++) {
    var model;
    try { model = CELLS.parseCells(blocks[i].body); }
    catch (e) { parseErrors.push((e && e.message) || 'parse error'); continue; }
    if (model.error) { parseErrors.push(model.error); continue; }
    if (model.unresolved || model.empty) continue;
    var fence = CELLS.parseFenceInfo(blocks[i].info || '');
    var wbId = fence.workbook || (model.workbook != null ? String(model.workbook) : '');
    var explicitName = fence.name || (model.name && String(model.name).trim()) || '';
    if (!byWb[wbId]) { byWb[wbId] = []; order.push(wbId); }
    byWb[wbId].push({ name: explicitName, model: model });
  }
  var workbooks = order.map(function (id) {
    var autoIdx = 0;
    var sheets = byWb[id].map(function (s) {
      return { name: s.name || ('Sheet' + (++autoIdx)), model: s.model };
    });
    return { id: id, sheets: sheets };
  });
  return { workbooks: workbooks, parseErrors: parseErrors };
}

// Render one sheet's computed grid to a 2D array of display strings: a formula
// cell shows its result (number, or the error code), every other cell shows its
// literal text verbatim. fxGrid is this sheet's recalcWorkbook results.
function valuesFor(model, fxGrid) {
  var out = [];
  for (var r = 0; r < model.cells.length; r++) {
    var line = model.cells[r];
    var row = [];
    for (var c = 0; c < line.length; c++) {
      var cell = line[c];
      if (FX.isFormula(cell.raw)) {
        var fx = (fxGrid[r] && fxGrid[r][c]) || { kind: 'empty' };
        if (fx.kind === 'number') row.push(String(fx.value));
        else if (fx.kind === 'error') row.push(fx.code);
        else if (fx.kind === 'text') row.push(String(fx.value));
        else row.push('');
      } else {
        row.push(cell.raw);
      }
    }
    out.push(row);
  }
  return out;
}

// Collect cell errors across a sheet for the exit code + --json errors list.
function errorsFor(name, model, fxGrid) {
  var errs = [];
  for (var r = 0; r < fxGrid.length; r++) {
    var line = fxGrid[r] || [];
    for (var c = 0; c < line.length; c++) {
      var fx = line[c];
      if (fx && fx.kind === 'error') {
        errs.push({ sheet: name, cell: CELLS.colName(c) + (r + 1), code: fx.code });
      }
    }
  }
  return errs;
}

async function cellsVerifyCommand(opts) {
  var file = opts.extra;   // `sdoc cells verify <file>` -> file lands in extra
  if (!file) {
    console.error('sdoc: cells verify needs a file - usage: sdoc cells verify <file.md> [--json] [--sheet <name>]');
    process.exit(2);
  }

  var content = await io.readContent(file);   // same baking the browser receives
  if (content == null) {
    console.error('sdoc: nothing to read from ' + file);
    process.exit(2);
  }

  var wb = buildWorkbook(content);

  // Recalc each workbook in isolation, then flatten to a per-sheet view that
  // remembers which workbook each sheet came from. --sheet filters it after.
  var rendered = [];
  wb.workbooks.forEach(function (book) {
    var fxGrids = FX.recalcWorkbook(book.sheets.map(function (s) {
      return { name: s.name, model: s.model };
    }));
    book.sheets.forEach(function (s, i) {
      var errs = errorsFor(s.name, s.model, fxGrids[i] || []);
      if (book.id) errs.forEach(function (e) { e.workbook = book.id; });
      rendered.push({
        workbook: book.id,
        name: s.name,
        values: valuesFor(s.model, fxGrids[i] || []),
        errors: errs,
      });
    });
  });

  if (opts.sheetName) {
    var want = String(opts.sheetName).toLowerCase();
    var only = rendered.filter(function (r) { return r.name.toLowerCase() === want; });
    if (!only.length) {
      console.error('sdoc: no tab named "' + opts.sheetName + '" in ' + file);
      process.exit(2);
    }
    rendered = only;
  }

  var allErrors = [];
  rendered.forEach(function (r) { allErrors = allErrors.concat(r.errors); });
  var ok = allErrors.length === 0 && wb.parseErrors.length === 0;

  if (opts.jsonFlag) {
    process.stdout.write(JSON.stringify({
      ok: ok,
      sheets: rendered.map(function (r) {
        var o = { name: r.name, values: r.values };
        if (r.workbook) o.workbook = r.workbook;
        return o;
      }),
      errors: allErrors,
      parseErrors: wb.parseErrors,
    }, null, 2) + '\n');
  } else {
    if (!rendered.length) console.error('sdoc: no cells tabs found in ' + file);
    var chunks = rendered.map(function (r) {
      var banner = r.workbook ? ('# workbook: ' + r.workbook + ' / sheet: ' + r.name) : ('# sheet: ' + r.name);
      return banner + '\n' + CELLS.serializeCsv(r.values);
    });
    if (chunks.length) process.stdout.write(chunks.join('\n') + '\n');
    wb.parseErrors.forEach(function (e) { console.error('sdoc: cells parse error - ' + e); });
  }

  process.exit(ok ? 0 : 1);
}

module.exports = {
  cellsVerifyCommand: cellsVerifyCommand,
  scanCellsBlocks: scanCellsBlocks,
  buildWorkbook: buildWorkbook,
  valuesFor: valuesFor,
};
