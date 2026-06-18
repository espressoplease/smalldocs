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

  // Quote a sheet name the way Excel needs it inside a formula reference: a
  // plain identifier is left bare; anything with a space / punctuation, or that
  // reads like a cell address (A1, AB12), is wrapped in single quotes with any
  // embedded quote doubled.
  function quoteSheetRef(name) {
    var s = String(name);
    var bare = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(s) && !/^[A-Za-z]{1,3}[0-9]+$/.test(s);
    return bare ? s : "'" + s.replace(/'/g, "''") + "'";
  }

  // Our formula text minus the leading '=', with our AVG alias renamed to
  // Excel's AVERAGE. Everything else in our grammar is already Excel syntax.
  // When a nameMap (in-doc sheet name -> Excel sheet name, both lower-cased
  // keys) is supplied, a Sheet!A1 qualifier is rewritten to the exported,
  // sanitised, Excel-quoted sheet name - so a cross-sheet reference keeps
  // pointing at the right tab even after the name was truncated or de-duped.
  // Our engine only allows a bare-word sheet qualifier (Sales!A1), so matching
  // a [letter][word]! token is enough.
  function excelFormula(raw, nameMap) {
    var body = String(raw).replace(/^=/, '');
    // Rename AVG( -> AVERAGE( as a word: AVERAGE( itself must not match.
    body = body.replace(/\bAVG\s*\(/gi, 'AVERAGE(');
    if (nameMap) {
      body = body.replace(/([A-Za-z][A-Za-z0-9]*)!/g, function (full, word) {
        var ex = nameMap[word.toLowerCase()];
        return (ex != null ? quoteSheetRef(ex) : word) + '!';
      });
    }
    return body;
  }

  // True when every sheet-qualified reference in a formula points at a sheet
  // that is actually present in this export. `known` is a lower-cased set of
  // the in-doc sheet names being written (one entry for a single-sheet export,
  // all of them for a workbook). A null set opts out (legacy callers keep the
  // old behaviour). A formula that fails this would become a broken external
  // link in Excel, so the writer degrades it to its computed value instead.
  function formulaSelfContained(raw, known) {
    if (!known) return true;
    var re = /([A-Za-z][A-Za-z0-9]*)!/g, m;
    while ((m = re.exec(raw))) {
      if (!known[m[1].toLowerCase()]) return false;
    }
    return true;
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

  // The distinct format codes across a whole workbook, with a per-sheet
  // column->style-index map into that one shared style table. So one styles.xml
  // serves every worksheet and each sheet's s="" indices line up.
  function collectFormatsShared(sheets) {
    var codes = [];
    var perSheet = sheets.map(function (s) {
      var styleForCol = {};
      var formats = (s.model && s.model.formats) || {};
      for (var c = 0; c < ((s.model && s.model.cols) || 0); c++) {
        var code = formatCode(formats[c]);
        if (!code) continue;
        var idx = codes.indexOf(code);
        if (idx < 0) { codes.push(code); idx = codes.length - 1; }
        styleForCol[c] = idx + 1;                      // cellXfs[0] is default
      }
      return styleForCol;
    });
    return { codes: codes, perSheet: perSheet };
  }

  // xl/styles.xml - the minimum Excel accepts: one font, the mandatory two
  // fills, one border, plus a cellXfs entry per number format in use.
  function stylesXml(model) {
    return stylesXmlFromCodes(collectFormats(model).codes);
  }

  // The styles part for an explicit list of format codes (one shared table for
  // a multi-sheet workbook). stylesXml(model) is the single-sheet shorthand.
  function stylesXmlFromCodes(codes) {
    var numFmts = codes.map(function (code, i) {
      // Ids 164+ are the custom-format range.
      return '<numFmt numFmtId="' + (164 + i) + '" formatCode="' + escapeXml(code) + '"/>';
    }).join('');
    var xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    for (var i = 0; i < codes.length; i++) {
      xfs.push('<xf numFmtId="' + (164 + i) + '" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>');
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (codes.length ? '<numFmts count="' + codes.length + '">' + numFmts + '</numFmts>' : '') +
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
  function sheetXml(model, fx, opts) {
    opts = opts || {};
    // styleForCol comes from the shared workbook table when exporting a
    // multi-sheet book; otherwise from this model alone (single-sheet path,
    // byte-identical to before). nameMap rewrites cross-sheet qualifiers.
    var styleForCol = opts.styleForCol || collectFormats(model).styleForCol;
    var nameMap = opts.nameMap || null;
    var known = opts.knownNames || null;     // sheet names present in this export
    var rowsXml = [];
    for (var r = 0; r < (model.rows || 0); r++) {
      var line = model.cells[r] || [];
      var cellsXml = [];
      for (var c = 0; c < (model.cols || 0); c++) {
        var cell = line[c];
        if (!cell || cell.type === 'empty') continue;
        var ref = colLetter(c) + (r + 1);
        var style = styleForCol[c] ? ' s="' + styleForCol[c] + '"' : '';
        var isFormula = cell.raw && cell.raw.charAt(0) === '=' && cell.raw.length > 1;
        var fxCell = (isFormula && fx && fx[r]) ? fx[r][c] : null;
        var vetted = fxCell && (fxCell.kind === 'number' ||
          (fxCell.kind === 'error' && COMPUTED_ERROR_CODES[fxCell.code]));
        // A formula whose cross-sheet target is not in this export would become
        // a broken external link in Excel (#REF! + an "unsafe external source"
        // prompt). Only keep it live when every referenced sheet is present.
        var selfContained = formulaSelfContained(cell.raw, known);
        if (isFormula && vetted && selfContained) {
          var cached = (fxCell.kind === 'number' && isFinite(fxCell.value))
            ? '<v>' + fxCell.value + '</v>' : '';
          cellsXml.push('<c r="' + ref + '"' + style + '><f>' +
            escapeXml(excelFormula(cell.raw, nameMap)) + '</f>' + cached + '</c>');
        } else if (isFormula && fxCell && fxCell.kind === 'number' && isFinite(fxCell.value)) {
          // Cross-sheet reference into a sheet this file does not contain:
          // export the engine's computed value so the cell is correct and inert
          // (no dangling external link). Carries the column's number format.
          cellsXml.push('<c r="' + ref + '"' + style + '><v>' + fxCell.value + '</v></c>');
        } else if (isFormula) {
          // Unvetted or non-numeric formula: visible, copyable, but inert.
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
    // The lone sheet is the only one present, so any cross-sheet reference is
    // unresolvable here and degrades to its value. A self-reference by name
    // (rare) still resolves, so seed the set with this sheet's own name.
    var known = {};
    if (model && model.name) known[String(model.name).toLowerCase()] = 1;
    return zipStore([
      { name: '[Content_Types].xml', data: strToBytes(CONTENT_TYPES) },
      { name: '_rels/.rels', data: strToBytes(ROOT_RELS) },
      { name: 'xl/workbook.xml', data: strToBytes(WORKBOOK) },
      { name: 'xl/_rels/workbook.xml.rels', data: strToBytes(WORKBOOK_RELS) },
      { name: 'xl/styles.xml', data: strToBytes(stylesXml(model)) },
      { name: 'xl/worksheets/sheet1.xml', data: strToBytes(sheetXml(model, fx, { knownNames: known })) },
    ]);
  }

  // ── Multi-sheet workbook (a cells "workbook" group -> one .xlsx) ──

  // Make one in-doc sheet name safe for Excel: strip the characters Excel
  // forbids in a tab name ( [ ] : * ? / \ ), trim, cap at 31 chars, and never
  // hand back an empty string.
  function sanitizeSheetName(name) {
    var s = String(name == null ? '' : name).replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length > 31) s = s.slice(0, 31).trim();
    return s || 'Sheet';
  }

  // Sanitise a list of names AND make them unique case-insensitively (Excel
  // rejects two tabs whose names differ only in case). Collisions get a ~2/~3
  // suffix, re-trimmed to the 31-char ceiling.
  function dedupeSheetNames(names) {
    var used = {};
    return names.map(function (raw) {
      var base = sanitizeSheetName(raw);
      var name = base, n = 2;
      while (used[name.toLowerCase()]) {
        var suffix = '~' + (n++);
        name = base.slice(0, 31 - suffix.length) + suffix;
      }
      used[name.toLowerCase()] = 1;
      return name;
    });
  }

  function contentTypesFor(sheetCount) {
    var overrides = '';
    for (var i = 1; i <= sheetCount; i++) {
      overrides += '<Override PartName="/xl/worksheets/sheet' + i + '.xml" ' +
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      overrides +
      '</Types>';
  }

  // workbook.xml lists each sheet with a sheetId (1..N) and an r:id pointing
  // into the rels below. The two id spaces are separate: sheetId is the tab's
  // own id; r:id resolves the worksheet part. Crossing them makes Excel refuse
  // the file, so keep sheetId=i and r:id=rId{i} aligned with the rels.
  function workbookXmlFor(excelNames) {
    var tags = excelNames.map(function (nm, i) {
      return '<sheet name="' + escapeXml(nm) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + tags + '</sheets>' +
      '<calcPr fullCalcOnLoad="1"/>' +
      '</workbook>';
  }

  // rId1..rIdN are the worksheets; styles takes the next id so it never
  // collides with a sheet rel.
  function workbookRelsFor(sheetCount) {
    var rels = '';
    for (var i = 1; i <= sheetCount; i++) {
      rels += '<Relationship Id="rId' + i + '" ' +
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
        'Target="worksheets/sheet' + i + '.xml"/>';
    }
    rels += '<Relationship Id="rId' + (sheetCount + 1) + '" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ' +
      'Target="styles.xml"/>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels + '</Relationships>';
  }

  // Build a complete multi-sheet .xlsx from a workbook group. sheets is
  // [{ name, model }] in tab order; fxGrids is the recalcWorkbook output (one
  // grid per sheet) or [] (formulas still export; Excel computes on open). All
  // sheets share one styles part, and cross-sheet formula qualifiers are
  // rewritten to the exported (sanitised, de-duped) sheet names so the links
  // survive in Excel.
  function buildXlsxWorkbook(sheets, fxGrids) {
    sheets = sheets || [];
    fxGrids = fxGrids || [];
    var excelNames = dedupeSheetNames(sheets.map(function (s) { return s.name; }));
    var nameMap = {};
    var known = {};
    sheets.forEach(function (s, i) {
      if (s.name) {
        nameMap[String(s.name).toLowerCase()] = excelNames[i];
        known[String(s.name).toLowerCase()] = 1;
      }
    });
    var fmt = collectFormatsShared(sheets);

    var parts = [
      { name: '[Content_Types].xml', data: strToBytes(contentTypesFor(sheets.length)) },
      { name: '_rels/.rels', data: strToBytes(ROOT_RELS) },
      { name: 'xl/workbook.xml', data: strToBytes(workbookXmlFor(excelNames)) },
      { name: 'xl/_rels/workbook.xml.rels', data: strToBytes(workbookRelsFor(sheets.length)) },
      { name: 'xl/styles.xml', data: strToBytes(stylesXmlFromCodes(fmt.codes)) },
    ];
    sheets.forEach(function (s, i) {
      parts.push({
        name: 'xl/worksheets/sheet' + (i + 1) + '.xml',
        data: strToBytes(sheetXml(s.model, fxGrids[i] || null, { styleForCol: fmt.perSheet[i], nameMap: nameMap, knownNames: known })),
      });
    });
    return zipStore(parts);
  }

  exports.crc32 = crc32;
  exports.excelFormula = excelFormula;
  exports.quoteSheetRef = quoteSheetRef;
  exports.sanitizeSheetName = sanitizeSheetName;
  exports.dedupeSheetNames = dedupeSheetNames;
  exports.buildXlsxWorkbook = buildXlsxWorkbook;
  exports.sheetXml = sheetXml;
  exports.stylesXml = stylesXml;
  exports.buildXlsx = buildXlsx;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocCellsXlsx = {}));
