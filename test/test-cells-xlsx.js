// test-cells-xlsx.js - the .xlsx writer for ```cells sheets.
//
// SDocCellsXlsx builds a real Excel workbook (Office Open XML SpreadsheetML
// in a stored, uncompressed ZIP) from a cell model: numbers as values, text
// as inline strings, =formulas as live Excel formulas that recalculate on
// open. Because the ZIP is stored (no compression), tests can assert on the
// raw bytes directly.
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
    return XLSX.crc32(data) >>> 0 === 0xcbf43926;
  });

  // ── Formula translation ─────────────────────────────────
  test('xlsx: excelFormula strips the = and keeps Excel-native functions', () => {
    return XLSX.excelFormula('=SUM(B2:B5)') === 'SUM(B2:B5)'
        && XLSX.excelFormula('=B2*C2') === 'B2*C2'
        && XLSX.excelFormula('=IF(B2>20, 1, 0)') === 'IF(B2>20, 1, 0)';
  });

  test('xlsx: excelFormula maps AVG (our alias) to Excel\'s AVERAGE', () => {
    return XLSX.excelFormula('=AVG(B2:B5)') === 'AVERAGE(B2:B5)'
        && XLSX.excelFormula('=avg(B2:B5)') === 'AVERAGE(B2:B5)'
        // AVERAGE itself passes through untouched (no AVERAGEAGE mangling).
        && XLSX.excelFormula('=AVERAGE(B2:B5)') === 'AVERAGE(B2:B5)';
  });

  // ── Worksheet XML ───────────────────────────────────────
  test('xlsx: sheetXml emits numbers, inline strings, and formulas', () => {
    const model = CELLS.parseCells('Item,Qty\nLaptop,12\nTotal,=SUM(B2:B2)');
    const fx = FX.recalc(model);
    const xml = XLSX.sheetXml(model, fx);
    return xml.indexOf('<is><t>Item</t></is>') >= 0          // text -> inline string
        && xml.indexOf('<c r="B2"><v>12</v></c>') >= 0       // number -> value
        && xml.indexOf('<f>SUM(B2:B2)</f>') >= 0             // formula, = stripped
        && xml.indexOf('<v>12</v></c></row></sheetData>') >= 0; // cached formula result
  });

  test('xlsx: sheetXml escapes XML special characters in text', () => {
    const model = CELLS.parseCells('a\n"<b> & </b>"');
    const xml = XLSX.sheetXml(model, null);
    return xml.indexOf('&lt;b&gt; &amp; &lt;/b&gt;') >= 0
        && xml.indexOf('<b>') < 0;
  });

  test('xlsx: sheetXml skips empty cells and empty rows', () => {
    const model = CELLS.parseCells('a,,c\n,,');
    const xml = XLSX.sheetXml(model, null);
    // Row 2 is all-empty: no <row r="2">. Cell B1 is empty: no <c r="B1">.
    return xml.indexOf('<row r="2">') < 0
        && xml.indexOf('r="B1"') < 0
        && xml.indexOf('r="A1"') >= 0 && xml.indexOf('r="C1"') >= 0;
  });

  test('xlsx: a formula whose evaluation failed emits the formula without a cached value', () => {
    const model = CELLS.parseCells('a\n=1/0');
    const fx = FX.recalc(model);
    const xml = XLSX.sheetXml(model, fx);
    return xml.indexOf('<f>1/0</f>') >= 0
        && xml.indexOf('<f>1/0</f><v>') < 0;
  });

  // ── Number formats (format: directive -> styles) ────────
  test('xlsx: format directive columns carry a style index', () => {
    const model = CELLS.parseCells('format: B=$ C=%\nItem,Price,Margin\nA,1100,0.262');
    const xml = XLSX.sheetXml(model, null);
    // B2 (currency) and C2 (percent) get s= style attributes; A2 (text) does not.
    return /<c r="B2" s="[0-9]+"><v>1100<\/v><\/c>/.test(xml)
        && /<c r="C2" s="[0-9]+"><v>0\.262<\/v><\/c>/.test(xml)
        && xml.indexOf('<c r="A2" t="inlineStr"><is>') >= 0;
  });

  test('xlsx: stylesXml defines currency and percent number formats', () => {
    const model = CELLS.parseCells('format: B=$ C=%\na,b,c\nx,1,0.5');
    const xml = XLSX.stylesXml(model);
    return xml.indexOf('$#,##0.00') >= 0
        && xml.indexOf('%') >= 0
        && xml.indexOf('<cellXfs') >= 0;
  });

  // ── The full workbook (ZIP) ─────────────────────────────
  test('xlsx: buildXlsx returns a stored ZIP with the workbook parts', () => {
    const model = CELLS.parseCells('Item,Qty\nLaptop,12\nTotal,=SUM(B2:B2)');
    const fx = FX.recalc(model);
    const bytes = XLSX.buildXlsx(model, fx);
    const s = bytesToStr(bytes);
    return bytes instanceof Uint8Array
        && bytes[0] === 0x50 && bytes[1] === 0x4b                  // "PK"
        && s.indexOf('[Content_Types].xml') >= 0
        && s.indexOf('xl/workbook.xml') >= 0
        && s.indexOf('xl/worksheets/sheet1.xml') >= 0
        && s.indexOf('xl/styles.xml') >= 0
        && s.indexOf('_rels/.rels') >= 0;
  });

  test('xlsx: the workbook recalculates formulas on open (fullCalcOnLoad)', () => {
    const model = CELLS.parseCells('a\n=1+1');
    const bytes = XLSX.buildXlsx(model, null);
    const s = bytesToStr(bytes);
    // The ZIP is stored (uncompressed) so the workbook XML is readable in place.
    return s.indexOf('fullCalcOnLoad="1"') >= 0
        && s.indexOf('<f>1+1</f>') >= 0;
  });

  test('xlsx: zip entries carry correct sizes for a stored archive', () => {
    const model = CELLS.parseCells('a,b\n1,2');
    const bytes = XLSX.buildXlsx(model, null);
    // Walk local file headers: signature PK\x03\x04, method 0 (stored),
    // compressed size === uncompressed size.
    let i = 0, entries = 0, ok = true;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (i < bytes.length && view.getUint32(i, true) === 0x04034b50) {
      const method = view.getUint16(i + 8, true);
      const csize = view.getUint32(i + 18, true);
      const usize = view.getUint32(i + 22, true);
      const nameLen = view.getUint16(i + 26, true);
      const extraLen = view.getUint16(i + 28, true);
      if (method !== 0 || csize !== usize) ok = false;
      i += 30 + nameLen + extraLen + csize;
      entries++;
    }
    return ok && entries === 6;   // content types, .rels, workbook, wb rels, styles, sheet
  });
};
