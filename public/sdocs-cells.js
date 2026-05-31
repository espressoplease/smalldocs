// sdocs-cells.js - pure grid data model for ```cells fenced blocks.
//
// This is the BACKBONE of the cells/sheets feature. It is deliberately
// just the model: parse a block body into an addressable grid of cells.
// Every renderer (the inline grid, the future fullscreen sheet, the
// future editor) and the exporter read FROM this model; none of them is
// the source of truth. The DOM is always a view, never the data.
//
// A cell is two values from day one:
//   { raw, value, type }
//     raw   - exactly what the source held (a literal today, a formula
//             string like "=B2-B3" tomorrow). Never rewritten.
//     value - the computed display value. In v1 (no formula engine) this
//             equals the parsed literal. When formulas land, only the
//             compute step changes; raw already carries what it needs.
//     type  - 'number' | 'text' | 'empty', drives alignment + display.
//
// The block body is CSV. That is on purpose: inline raw data and a future
// {{file.csv}} transclusion then share one parser and one model, so those
// two features are one code path rather than two with a seam between them.
//
// UMD so Node tests can require it directly; no DOM, no window.SDocs here.
(function (exports) {
  'use strict';

  // Bijective base-26 spreadsheet column name. 0 -> A, 25 -> Z, 26 -> AA,
  // 701 -> ZZ, 702 -> AAA. Matches how every spreadsheet labels columns.
  function colName(index) {
    var i = index + 1;
    var s = '';
    while (i > 0) {
      var rem = (i - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  // Strict literal number: optional sign, digits, optional single decimal.
  // No thousands separators in v1 - a bare "1,000" is two CSV fields, and a
  // quoted "1,000" stays text rather than guessing the user's locale.
  var NUMBER_RE = /^-?\d+(?:\.\d+)?$/;

  // Classify a raw field string into a cell record. The trimmed text drives
  // type detection; `raw` is preserved verbatim for display and round-trip.
  function classify(raw) {
    var t = String(raw).trim();
    if (t === '') return { raw: raw, value: '', type: 'empty' };
    if (NUMBER_RE.test(t)) return { raw: raw, value: Number(t), type: 'number' };
    return { raw: raw, value: t, type: 'text' };
  }

  // Parse a CSV string into an array of row arrays of field strings.
  // Handles quoted fields with embedded commas / newlines and "" escapes.
  // Lenient by design: there is no such thing as a malformed sheet, only a
  // ragged one (which parseCells pads).
  function parseCsv(src) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;
    var n = src.length;
    while (i < n) {
      var ch = src.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (src.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    row.push(field);
    rows.push(row);
    return rows;
  }

  // Build the grid model from a ```cells block body.
  // Returns { rows, cols, cells, empty } where cells is row-major,
  // every row padded to `cols` with empty cells so the grid is rectangular.
  function parseCells(src) {
    var text = String(src == null ? '' : src);
    // Drop leading blank lines and all trailing whitespace (incl. the final
    // newline marked emits) but keep interior blank rows - a blank row is
    // meaningful in a sheet.
    var trimmed = text.replace(/^\n+/, '').replace(/\s+$/, '');
    if (trimmed === '') return { rows: 0, cols: 0, cells: [], empty: true };

    var raw = parseCsv(trimmed);
    var cols = 0;
    for (var r = 0; r < raw.length; r++) {
      if (raw[r].length > cols) cols = raw[r].length;
    }
    var cells = [];
    for (var r2 = 0; r2 < raw.length; r2++) {
      var line = raw[r2];
      var out = [];
      for (var c = 0; c < cols; c++) {
        out.push(classify(c < line.length ? line[c] : ''));
      }
      cells.push(out);
    }
    return { rows: raw.length, cols: cols, cells: cells, empty: false };
  }

  exports.colName = colName;
  exports.classify = classify;
  exports.parseCsv = parseCsv;
  exports.parseCells = parseCells;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocCells = {}));
