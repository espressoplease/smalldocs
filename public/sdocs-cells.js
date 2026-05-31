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

  // Inverse of colName: a column letter -> 0-based index ("A" -> 0, "AA" -> 26).
  // Returns -1 for anything that isn't a run of A-Z letters.
  function colIndex(letter) {
    var s = String(letter).toUpperCase();
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i) - 64;   // A -> 1
      if (c < 1 || c > 26) return -1;
      n = n * 26 + c;
    }
    return s.length ? n - 1 : -1;
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

  // A bare {{path/to/file.csv}} reference (optionally with a :range suffix).
  // Present only when a doc is opened WITHOUT the CLI (which otherwise bakes
  // the data in); the renderer shows a "load it with sdoc" message.
  var REFERENCE_RE = /^\{\{\s*([^}]+?)\s*\}\}$/;
  // The machine-generated metadata line the CLI prepends to a baked block:
  //   sdoc-cells: source=report.csv range=B5:J32
  //   sdoc-cells: error="Could not read report.csv"
  var DIRECTIVE_RE = /^sdoc-cells:\s*(.*)$/;

  // Parse `key=value` / `key="quoted value"` pairs from a directive line.
  function parseDirectives(str) {
    var meta = {};
    var re = /(\w+)=(?:"([^"]*)"|(\S+))/g;
    var m;
    while ((m = re.exec(str))) meta[m[1]] = m[2] !== undefined ? m[2] : m[3];
    return meta;
  }

  // Build the grid model from a ```cells block body.
  // Returns { rows, cols, cells, empty } where cells is row-major, every row
  // padded to `cols` with empty cells so the grid is rectangular. May instead
  // return { unresolved: <ref> } or { error: <msg> } for reference blocks.
  function parseCells(src) {
    var text = String(src == null ? '' : src);
    // Drop leading blank lines and all trailing whitespace (incl. the final
    // newline marked emits) but keep interior blank rows - a blank row is
    // meaningful in a sheet.
    var trimmed = text.replace(/^\n+/, '').replace(/\s+$/, '');
    if (trimmed === '') return { rows: 0, cols: 0, cells: [], empty: true };

    // Peel leading directive lines (in any order, machine or author):
    //   sdoc-cells: source=... range=... error=...   (baked metadata)
    //   format: A=$ B=% C=plain                        (author column formats)
    var source, range, formats;
    var lines = trimmed.split('\n');
    var idx = 0;
    var FORMAT_RE = /^format:\s*(.*)$/i;
    while (idx < lines.length) {
      var dm = lines[idx].match(DIRECTIVE_RE);
      var fm = lines[idx].match(FORMAT_RE);
      if (dm) {
        var meta = parseDirectives(dm[1]);
        source = meta.source; range = meta.range;
        if (meta.error) return { empty: false, error: meta.error, source: source };
        idx++; continue;
      }
      if (fm) { formats = parseFormats(fm[1]); idx++; continue; }
      break;
    }
    var body = lines.slice(idx).join('\n').replace(/\s+$/, '');

    // Unresolved reference (after directives): the CLI never baked it.
    var ref = body.match(REFERENCE_RE);
    if (ref) return { empty: false, unresolved: ref[1], formats: formats };
    if (body === '') return { rows: 0, cols: 0, cells: [], empty: true, source: source, range: range, formats: formats };

    var raw = parseCsv(body);
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
    return { rows: raw.length, cols: cols, cells: cells, empty: false, source: source, range: range, formats: formats };
  }

  // Serialize a 2D array of raw cell strings back to CSV (RFC 4180 quoting:
  // wrap in quotes and double any embedded quote when a field contains a
  // comma, quote, or newline). The inverse of parseCsv for the copy actions.
  function serializeCsv(rows) {
    return rows.map(function (row) {
      return row.map(function (v) {
        var s = String(v == null ? '' : v);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\n');
  }

  // Stats for a selected rectangle [r0..r1] x [c0..c1] of a model. Numbers
  // drive sum/avg/min/max; count is every non-empty cell (Excel's "Count").
  // Cells past the data (fullscreen padding) read as empty.
  function selectionStats(model, r0, c0, r1, c1) {
    var count = 0, numericCount = 0, sum = 0, min = null, max = null;
    for (var r = r0; r <= r1; r++) {
      var line = model.cells[r];
      for (var c = c0; c <= c1; c++) {
        var cell = line && line[c];
        if (!cell || cell.type === 'empty') continue;
        count++;
        if (cell.type === 'number') {
          numericCount++;
          var v = cell.value;
          sum += v;
          if (min === null || v < min) min = v;
          if (max === null || v > max) max = v;
        }
      }
    }
    return {
      count: count,
      numericCount: numericCount,
      sum: sum,
      avg: numericCount > 0 ? sum / numericCount : null,
      min: min,
      max: max,
    };
  }

  // Heuristic: is row 0 a header? True when row 0 has no numbers and there is
  // numeric data below it - so a sort can keep it pinned to the top.
  function looksLikeHeader(model) {
    if (!model || model.rows < 2) return false;
    var row0 = model.cells[0];
    for (var c = 0; c < model.cols; c++) {
      if (row0[c] && row0[c].type === 'number') return false;
    }
    for (var r = 1; r < model.rows; r++) {
      var line = model.cells[r];
      for (var c2 = 0; c2 < model.cols; c2++) {
        if (line[c2] && line[c2].type === 'number') return true;
      }
    }
    return false;
  }

  // Sort key: numbers (rank 0) sort before text (rank 1); empty (rank 2) last.
  function sortKey(cell) {
    if (!cell || cell.type === 'empty') return { rank: 2, v: 0 };
    if (cell.type === 'number') return { rank: 0, v: cell.value };
    return { rank: 1, v: String(cell.value).toLowerCase() };
  }

  // Return the row order (array of original indices) sorting the model by a
  // column. A view reorder - the model itself is not changed. Empty cells stay
  // last either direction; a header row (when hasHeader) stays pinned to row 0.
  function sortRows(model, col, dir, hasHeader) {
    var order = [];
    for (var r = 0; r < model.rows; r++) order.push(r);
    var start = hasHeader ? 1 : 0;
    var head = order.slice(0, start);
    var body = order.slice(start);
    var sign = dir === 'desc' ? -1 : 1;
    body.sort(function (ra, rb) {
      var a = sortKey(model.cells[ra] && model.cells[ra][col]);
      var b = sortKey(model.cells[rb] && model.cells[rb][col]);
      if (a.rank === 2 || b.rank === 2) return a.rank - b.rank;  // empty always last
      if (a.rank !== b.rank) return (a.rank - b.rank) * sign;
      if (a.v < b.v) return -1 * sign;
      if (a.v > b.v) return 1 * sign;
      return 0;
    });
    return head.concat(body);
  }

  // Display formatting for a numeric raw string: group the integer part with
  // thousands separators, preserve the sign and the decimal part verbatim
  // (so "1234.50" keeps its trailing zero). Display only - the model's raw is
  // untouched, so copy / export still emit the original value.
  function formatNumber(raw) {
    var s = String(raw == null ? '' : raw).trim();
    var neg = s.charAt(0) === '-';
    if (neg) s = s.slice(1);
    var dot = s.indexOf('.');
    var intPart = dot === -1 ? s : s.slice(0, dot);
    var rest = dot === -1 ? '' : s.slice(dot);
    intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + intPart + rest;
  }

  // Parse one format token into a spec: { kind, symbol?, decimals? }.
  // Tokens: $ / usd / currency, £ / gbp, € / eur, % / percent, , / comma /
  // number, plain / text / raw, plus an optional trailing .N for decimals
  // (e.g. "$.0", "%.1", ".2"). Unknown tokens return null.
  function parseFmtToken(tok) {
    var t = String(tok).trim();
    var decimals = null;
    var dm = t.match(/\.(\d+)$/);
    if (dm) { decimals = parseInt(dm[1], 10); t = t.slice(0, t.length - dm[0].length); }
    var lc = t.toLowerCase();
    if (t === '$' || lc === 'usd' || lc === 'currency') return { kind: 'currency', symbol: '$', decimals: decimals == null ? 2 : decimals };
    if (t === '£' || lc === 'gbp') return { kind: 'currency', symbol: '£', decimals: decimals == null ? 2 : decimals };
    if (t === '€' || lc === 'eur') return { kind: 'currency', symbol: '€', decimals: decimals == null ? 2 : decimals };
    if (t === '%' || lc === 'percent') { var p = { kind: 'percent' }; if (decimals != null) p.decimals = decimals; return p; }
    if (t === ',' || lc === 'comma' || lc === 'number' || lc === 'num') { var nn = { kind: 'number' }; if (decimals != null) nn.decimals = decimals; return nn; }
    if (lc === 'plain' || lc === 'text' || lc === 'raw') return { kind: 'plain' };
    if (t === '' && decimals != null) return { kind: 'number', decimals: decimals };
    return null;
  }

  // Parse a per-column format spec like "A=plain B=$ C=%.1" into a map
  // { colIndex: fmt }. Keys are column letters; unknown tokens are skipped.
  function parseFormats(spec) {
    var out = {};
    var re = /([A-Za-z]+)\s*=\s*(\S+)/g;
    var m;
    while ((m = re.exec(spec))) {
      var col = colIndex(m[1]);
      var fmt = parseFmtToken(m[2]);
      if (col >= 0 && fmt) out[col] = fmt;
    }
    return out;
  }

  // Format a numeric cell's display per a column format. Returns null for
  // non-number cells (the caller falls back to text rendering). Display only -
  // the model's raw is untouched, so copy / export emit the original.
  function formatValue(cell, fmt) {
    if (!cell || cell.type !== 'number') return null;
    var v = cell.value;
    if (!fmt || fmt.kind === 'number') {
      return (fmt && fmt.decimals != null) ? formatNumber(v.toFixed(fmt.decimals)) : formatNumber(cell.raw);
    }
    if (fmt.kind === 'plain') return cell.raw;
    if (fmt.kind === 'currency') {
      var d = fmt.decimals == null ? 2 : fmt.decimals;
      return (v < 0 ? '-' : '') + fmt.symbol + formatNumber(Math.abs(v).toFixed(d));
    }
    if (fmt.kind === 'percent') {
      var p = v * 100;
      var str = fmt.decimals != null ? p.toFixed(fmt.decimals) : String(Math.round(p * 1e6) / 1e6);
      return formatNumber(str) + '%';
    }
    return formatNumber(cell.raw);
  }

  exports.colName = colName;
  exports.classify = classify;
  exports.parseCsv = parseCsv;
  exports.parseCells = parseCells;
  exports.serializeCsv = serializeCsv;
  exports.selectionStats = selectionStats;
  exports.formatNumber = formatNumber;
  exports.colIndex = colIndex;
  exports.parseFormats = parseFormats;
  exports.formatValue = formatValue;
  exports.looksLikeHeader = looksLikeHeader;
  exports.sortRows = sortRows;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocCells = {}));
