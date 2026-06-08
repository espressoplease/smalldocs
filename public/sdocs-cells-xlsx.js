// sdocs-cells-xlsx.js - build a real Excel workbook (.xlsx) from a cells
// model, formulas included.
//
// An .xlsx file is a ZIP of XML parts (Office Open XML SpreadsheetML). This
// module writes that structure by hand rather than pulling a spreadsheet
// library: our needs are narrow (one worksheet, values + formulas + a few
// number formats), the XML is small and deterministic, and a hand-rolled
// writer keeps the export dependency-free and byte-testable in Node.
//
// What lands in the workbook:
//   - numbers as native values
//   - text as inline strings (no shared-strings table to manage)
//   - =formula cells as live Excel formulas (<f>), with their computed value
//     cached alongside (<v>) and fullCalcOnLoad set so Excel recalculates on
//     open - the formulas keep working in Excel
//   - format: directive columns ($ / % / ,) as Excel number formats
//
// The ZIP is STORED (no compression). Sheets are small; skipping deflate
// keeps the writer ~100 lines and makes the output inspectable - the XML is
// readable in the raw bytes, which the tests rely on.
//
// Our formula grammar is a subset of Excel's: SUM MIN MAX COUNT COUNTA
// PRODUCT ROUND ABS IF and the operators all carry over verbatim. The one
// exception is AVG, our alias for AVERAGE, which is renamed on the way out.
//
// UMD: window.SDocCellsXlsx in the browser, module.exports in Node tests.
(function (exports) {
  'use strict';

  // ── XML helpers ─────────────────────────────────────────

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Column index (0-based) -> Excel letters: 0 -> A, 25 -> Z, 26 -> AA.
  function colLetter(index) {
    var name = '';
    var n = index;
    while (n >= 0) {
      name = String.fromCharCode(65 + (n % 26)) + name;
      n = Math.floor(n / 26) - 1;
    }
    return name;
  }

  // ── Formula translation ─────────────────────────────────

  // Our formula text minus the leading '=', with our AVG alias renamed to
  // Excel's AVERAGE. Everything else in our grammar is already Excel syntax.
  function excelFormula(raw) {
    var body = String(raw).replace(/^=/, '');
    // Rename AVG( -> AVERAGE( as a word: AVERAGE( itself must not match.
    return body.replace(/\bAVG\s*\(/gi, 'AVERAGE(');
  }

  // ── Number formats (styles) ─────────────────────────────

  // Map a parsed format spec ({ kind, decimals }) to an Excel format code.
  function formatCode(fmt) {
    if (!fmt) return null;
    var d = fmt.decimals;
    if (fmt.kind === 'currency') {
      var dec = d == null ? 2 : d;
      return '$#,##0' + (dec > 0 ? '.' + new Array(dec + 1).join('0') : '');
    }
    if (fmt.kind === 'percent') {
      var pd = d == null ? 1 : d;
      return '0' + (pd > 0 ? '.' + new Array(pd + 1).join('0') : '') + '%';
    }
    if (fmt.kind === 'number') {
      return '#,##0' + (d > 0 ? '.' + new Array(d + 1).join('0') : '');
    }
    return null;
  }

  // The distinct format codes a model needs, in column order. Returns
  // { codes: [...], styleForCol: { colIndex: cellXfs index } }. Style index 0
  // is the default (no format); custom formats start at 1.
  function collectFormats(model) {
    var codes = [];
    var styleForCol = {};
    var formats = model.formats || {};
    for (var c = 0; c < (model.cols || 0); c++) {
      var code = formatCode(formats[c]);
      if (!code) continue;
      var idx = codes.indexOf(code);
      if (idx < 0) { codes.push(code); idx = codes.length - 1; }
      styleForCol[c] = idx + 1;                       // cellXfs[0] is default
    }
    return { codes: codes, styleForCol: styleForCol };
  }

  // xl/styles.xml - the minimum Excel accepts: one font, the mandatory two
  // fills, one border, plus a cellXfs entry per number format in use.
  function stylesXml(model) {
    var fc = collectFormats(model);
    var numFmts = fc.codes.map(function (code, i) {
      // Ids 164+ are the custom-format range.
      return '<numFmt numFmtId="' + (164 + i) + '" formatCode="' + escapeXml(code) + '"/>';
    }).join('');
    var xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    for (var i = 0; i < fc.codes.length; i++) {
      xfs.push('<xf numFmtId="' + (164 + i) + '" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>');
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (fc.codes.length ? '<numFmts count="' + fc.codes.length + '">' + numFmts + '</numFmts>' : '') +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="' + xfs.length + '">' + xfs.join('') + '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  }

  // ── Worksheet XML ───────────────────────────────────────

  // Error codes that prove a formula PARSED AND RAN inside our grammar - it
  // just hit a legitimate computational error. These may still export as live
  // formulas. #NAME? (unknown function) and #VALUE! (syntax we don't have)
  // are deliberately absent: those are exactly the cases where the formula
  // contains things our engine never vetted.
  var COMPUTED_ERROR_CODES = { '#DIV/0!': 1, '#CIRC!': 1, '#REF!': 1 };

  // xl/worksheets/sheet1.xml from a cell model. fx is the formula engine's
  // recalc() output, indexed [row][col].
  //
  // SECURITY: a formula exports as a live Excel formula ONLY when fx shows our
  // engine evaluated it - proof it stays inside our purely computational
  // grammar (no WEBSERVICE, no HYPERLINK, no DDE, no functions we don't know).
  // Anything else - including all formulas when fx is null - exports as inert
  // inline text. Without this, a shared document could smuggle an Excel
  // data-exfiltration or phishing formula into a trusted .xlsx download
  // (the CSV-injection attack class).
  function sheetXml(model, fx) {
    var fc = collectFormats(model);
    var rowsXml = [];
    for (var r = 0; r < (model.rows || 0); r++) {
      var line = model.cells[r] || [];
      var cellsXml = [];
      for (var c = 0; c < (model.cols || 0); c++) {
        var cell = line[c];
        if (!cell || cell.type === 'empty') continue;
        var ref = colLetter(c) + (r + 1);
        var style = fc.styleForCol[c] ? ' s="' + fc.styleForCol[c] + '"' : '';
        var isFormula = cell.raw && cell.raw.charAt(0) === '=' && cell.raw.length > 1;
        var fxCell = (isFormula && fx && fx[r]) ? fx[r][c] : null;
        var vetted = fxCell && (fxCell.kind === 'number' ||
          (fxCell.kind === 'error' && COMPUTED_ERROR_CODES[fxCell.code]));
        if (isFormula && vetted) {
          var cached = (fxCell.kind === 'number' && isFinite(fxCell.value))
            ? '<v>' + fxCell.value + '</v>' : '';
          cellsXml.push('<c r="' + ref + '"' + style + '><f>' +
            escapeXml(excelFormula(cell.raw)) + '</f>' + cached + '</c>');
        } else if (isFormula) {
          // Unvetted formula: visible, copyable, but inert.
          cellsXml.push('<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' +
            escapeXml(cell.raw) + '</t></is></c>');
        } else if (cell.type === 'number') {
          cellsXml.push('<c r="' + ref + '"' + style + '><v>' + cell.value + '</v></c>');
        } else {
          // Text -> inline string. xml:space keeps leading/trailing spaces
          // and embedded newlines intact.
          cellsXml.push('<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' +
            escapeXml(cell.raw) + '</t></is></c>');
        }
      }
      if (cellsXml.length) {
        rowsXml.push('<row r="' + (r + 1) + '">' + cellsXml.join('') + '</row>');
      }
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' + rowsXml.join('') + '</sheetData>' +
      '</worksheet>';
  }

  // ── The fixed workbook parts ────────────────────────────

  var CONTENT_TYPES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>';

  var ROOT_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  // fullCalcOnLoad: Excel recomputes every formula when the file opens, so
  // the cached values never go stale even if our engine and Excel disagree.
  var WORKBOOK =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>' +
    '<calcPr fullCalcOnLoad="1"/>' +
    '</workbook>';

  var WORKBOOK_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  // ── Stored ZIP writer ───────────────────────────────────

  // Standard CRC-32 (the ZIP polynomial), table-driven.
  var CRC_TABLE = (function () {
    var table = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = -1;
    for (var i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  }

  function strToBytes(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    return new Uint8Array(Buffer.from(s, 'utf8'));   // Node < TextEncoder fallback
  }

  // Build a stored (method 0) ZIP from [{ name, data: Uint8Array }]. A fixed
  // DOS timestamp keeps the output byte-deterministic across runs.
  var DOS_TIME = 0;                                  // 00:00:00
  var DOS_DATE = (2026 - 1980) << 9 | (1 << 5) | 1;  // 2026-01-01

  function zipStore(files) {
    var locals = [];
    var centrals = [];
    var offset = 0;
    var totalLocal = 0;

    files.forEach(function (f) {
      var nameBytes = strToBytes(f.name);
      var crc = crc32(f.data);
      var local = new Uint8Array(30 + nameBytes.length + f.data.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);            // local file header signature
      lv.setUint16(4, 20, true);                     // version needed
      lv.setUint16(8, 0, true);                      // method: stored
      lv.setUint16(10, DOS_TIME, true);
      lv.setUint16(12, DOS_DATE, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, f.data.length, true);         // compressed size
      lv.setUint32(22, f.data.length, true);         // uncompressed size
      lv.setUint16(26, nameBytes.length, true);
      local.set(nameBytes, 30);
      local.set(f.data, 30 + nameBytes.length);
      locals.push(local);

      var central = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);            // central directory signature
      cv.setUint16(4, 20, true);                     // version made by
      cv.setUint16(6, 20, true);                     // version needed
      cv.setUint16(10, 0, true);                     // method: stored
      cv.setUint16(12, DOS_TIME, true);
      cv.setUint16(14, DOS_DATE, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, f.data.length, true);
      cv.setUint32(24, f.data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);                // local header offset
      central.set(nameBytes, 46);
      centrals.push(central);

      offset += local.length;
      totalLocal += local.length;
    });

    var centralSize = centrals.reduce(function (n, c) { return n + c.length; }, 0);
    var out = new Uint8Array(totalLocal + centralSize + 22);
    var pos = 0;
    locals.forEach(function (l) { out.set(l, pos); pos += l.length; });
    var centralStart = pos;
    centrals.forEach(function (c) { out.set(c, pos); pos += c.length; });

    var ev = new DataView(out.buffer, pos);
    ev.setUint32(0, 0x06054b50, true);              // end of central directory
    ev.setUint16(8, files.length, true);             // entries on this disk
    ev.setUint16(10, files.length, true);            // entries total
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralStart, true);
    return out;
  }

  // ── The workbook ────────────────────────────────────────

  // Build the complete .xlsx as bytes. model is a parsed cells model
  // (SDocCells.parseCells); fx is the formula engine's recalc() output or
  // null (formulas still export, Excel computes them on open).
  function buildXlsx(model, fx) {
    return zipStore([
      { name: '[Content_Types].xml', data: strToBytes(CONTENT_TYPES) },
      { name: '_rels/.rels', data: strToBytes(ROOT_RELS) },
      { name: 'xl/workbook.xml', data: strToBytes(WORKBOOK) },
      { name: 'xl/_rels/workbook.xml.rels', data: strToBytes(WORKBOOK_RELS) },
      { name: 'xl/styles.xml', data: strToBytes(stylesXml(model)) },
      { name: 'xl/worksheets/sheet1.xml', data: strToBytes(sheetXml(model, fx)) },
    ]);
  }

  exports.crc32 = crc32;
  exports.excelFormula = excelFormula;
  exports.sheetXml = sheetXml;
  exports.stylesXml = stylesXml;
  exports.buildXlsx = buildXlsx;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocCellsXlsx = {}));
