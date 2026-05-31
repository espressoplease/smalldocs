/**
 * Cells model tests - the backbone of the sheets-v1 feature.
 * Pure parser + grid model, no DOM.
 */

module.exports = function(harness) {
  const { assert, test } = harness;

  console.log('\n── Cells Model Tests ──────────────────────────\n');

  const { colName, classify, parseCsv, parseCells, serializeCsv, selectionStats, formatNumber } = require('../public/sdocs-cells');

  // ── Column names (bijective base-26) ──
  test('colName: first columns', () => {
    assert.strictEqual(colName(0), 'A');
    assert.strictEqual(colName(1), 'B');
    assert.strictEqual(colName(25), 'Z');
  });

  test('colName: rolls over to two letters', () => {
    assert.strictEqual(colName(26), 'AA');
    assert.strictEqual(colName(27), 'AB');
    assert.strictEqual(colName(51), 'AZ');
    assert.strictEqual(colName(701), 'ZZ');
    assert.strictEqual(colName(702), 'AAA');
  });

  // ── Cell classification (raw vs value vs type) ──
  test('classify: integer is a number, raw preserved', () => {
    const c = classify('42');
    assert.strictEqual(c.type, 'number');
    assert.strictEqual(c.value, 42);
    assert.strictEqual(c.raw, '42');
  });

  test('classify: negative and decimal are numbers', () => {
    assert.strictEqual(classify('-5').value, -5);
    assert.strictEqual(classify('3.14').type, 'number');
    assert.strictEqual(classify('3.14').value, 3.14);
  });

  test('classify: text stays text', () => {
    const c = classify('Revenue');
    assert.strictEqual(c.type, 'text');
    assert.strictEqual(c.value, 'Revenue');
  });

  test('classify: empty / whitespace is empty', () => {
    assert.strictEqual(classify('').type, 'empty');
    assert.strictEqual(classify('   ').type, 'empty');
  });

  test('classify: thousands-separator string is NOT a number in v1', () => {
    // a quoted "1,000" reaches us as one field; we keep it text rather than
    // guessing locale.
    assert.strictEqual(classify('1,000').type, 'text');
  });

  test('classify: leading-zero / phone-like stays text only if non-numeric', () => {
    // "007" is digits -> number 7; that is acceptable v1 behaviour.
    assert.strictEqual(classify('007').type, 'number');
    assert.strictEqual(classify('1a').type, 'text');
  });

  // ── CSV parsing ──
  test('parseCsv: simple rows', () => {
    const rows = parseCsv('a,b,c\n1,2,3');
    assert.deepStrictEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
  });

  test('parseCsv: quoted field with embedded comma', () => {
    const rows = parseCsv('name,note\n"Smith, J",hi');
    assert.deepStrictEqual(rows, [['name', 'note'], ['Smith, J', 'hi']]);
  });

  test('parseCsv: escaped double quotes', () => {
    const rows = parseCsv('a\n"she said ""hi"""');
    assert.deepStrictEqual(rows, [['a'], ['she said "hi"']]);
  });

  test('parseCsv: quoted field with embedded newline', () => {
    const rows = parseCsv('a,b\n"line1\nline2",x');
    assert.deepStrictEqual(rows, [['a', 'b'], ['line1\nline2', 'x']]);
  });

  test('parseCsv: CRLF line endings', () => {
    const rows = parseCsv('a,b\r\n1,2');
    assert.deepStrictEqual(rows, [['a', 'b'], ['1', '2']]);
  });

  // ── Grid model ──
  test('parseCells: builds a rectangular grid', () => {
    const m = parseCells('Region,Q1,Q2\nNorth,100,150\nSouth,90,95');
    assert.strictEqual(m.empty, false);
    assert.strictEqual(m.rows, 3);
    assert.strictEqual(m.cols, 3);
    assert.strictEqual(m.cells[0][0].value, 'Region');
    assert.strictEqual(m.cells[1][1].type, 'number');
    assert.strictEqual(m.cells[1][1].value, 100);
  });

  test('parseCells: ragged rows are padded with empty cells', () => {
    const m = parseCells('a,b,c\nx');
    assert.strictEqual(m.cols, 3);
    assert.strictEqual(m.cells[1].length, 3);
    assert.strictEqual(m.cells[1][0].value, 'x');
    assert.strictEqual(m.cells[1][1].type, 'empty');
    assert.strictEqual(m.cells[1][2].type, 'empty');
  });

  test('parseCells: empty input flagged', () => {
    assert.strictEqual(parseCells('').empty, true);
    assert.strictEqual(parseCells('   \n  \n').empty, true);
    assert.strictEqual(parseCells(null).empty, true);
  });

  test('parseCells: leading blank lines dropped, interior blank row kept', () => {
    const m = parseCells('\n\na,b\n,\nc,d');
    assert.strictEqual(m.rows, 3);
    assert.strictEqual(m.cells[1][0].type, 'empty');
    assert.strictEqual(m.cells[1][1].type, 'empty');
    assert.strictEqual(m.cells[2][0].value, 'c');
  });

  // ── CSV serialization (copy actions) ──
  test('serializeCsv: plain rows', () => {
    assert.strictEqual(serializeCsv([['a', 'b'], ['1', '2']]), 'a,b\n1,2');
  });

  test('serializeCsv: quotes fields with comma / quote / newline', () => {
    assert.strictEqual(serializeCsv([['Smith, J', 'he said "hi"', 'one\ntwo']]),
      '"Smith, J","he said ""hi""","one\ntwo"');
  });

  test('serializeCsv: round-trips through parseCsv', () => {
    const src = 'name,note\n"Smith, J","a ""quote""\nline"\nplain,42';
    const rows = parseCsv(src);
    assert.strictEqual(serializeCsv(rows), src);
  });

  // ── Number formatting (display only - raw is preserved) ──
  test('formatNumber: adds thousands separators', () => {
    assert.strictEqual(formatNumber('1000'), '1,000');
    assert.strictEqual(formatNumber('12000'), '12,000');
    assert.strictEqual(formatNumber('1234567'), '1,234,567');
  });

  test('formatNumber: small numbers unchanged', () => {
    assert.strictEqual(formatNumber('0'), '0');
    assert.strictEqual(formatNumber('999'), '999');
  });

  test('formatNumber: preserves the decimal part verbatim (incl. trailing zeros)', () => {
    assert.strictEqual(formatNumber('3.14'), '3.14');
    assert.strictEqual(formatNumber('1234.50'), '1,234.50');
    assert.strictEqual(formatNumber('1000000.5'), '1,000,000.5');
  });

  test('formatNumber: handles negatives', () => {
    assert.strictEqual(formatNumber('-7'), '-7');
    assert.strictEqual(formatNumber('-12000'), '-12,000');
    assert.strictEqual(formatNumber('-1234.5'), '-1,234.5');
  });

  test('formatNumber: only groups the integer part', () => {
    assert.strictEqual(formatNumber('12345.6789'), '12,345.6789');
  });

  // ── Selection stats (Sum / Avg / Count / Min / Max) ──
  test('selectionStats: sums numbers across a range', () => {
    const m = parseCells('1,2,3\n4,5,6');
    const s = selectionStats(m, 0, 0, 1, 2);     // the whole 2x3 grid
    assert.strictEqual(s.sum, 21);
    assert.strictEqual(s.count, 6);
    assert.strictEqual(s.numericCount, 6);
    assert.strictEqual(s.avg, 3.5);
    assert.strictEqual(s.min, 1);
    assert.strictEqual(s.max, 6);
  });

  test('selectionStats: text/empty counted as non-empty but excluded from sum', () => {
    const m = parseCells('Region,100\nNorth,\nSouth,50');
    const s = selectionStats(m, 0, 0, 2, 1);     // 3x2: Region/100, North/(empty), South/50
    assert.strictEqual(s.numericCount, 2);       // 100, 50
    assert.strictEqual(s.sum, 150);
    assert.strictEqual(s.avg, 75);
    assert.strictEqual(s.count, 5);              // non-empty: Region,100,North,South,50
  });

  test('selectionStats: an all-empty range has no numbers', () => {
    const m = parseCells(',\n,');
    const s = selectionStats(m, 0, 0, 1, 1);
    assert.strictEqual(s.count, 0);
    assert.strictEqual(s.numericCount, 0);
    assert.strictEqual(s.sum, 0);
    assert.strictEqual(s.avg, null);
    assert.strictEqual(s.min, null);
    assert.strictEqual(s.max, null);
  });

  test('selectionStats: negatives and decimals', () => {
    const m = parseCells('-5,2.5\n10,-1');
    const s = selectionStats(m, 0, 0, 1, 1);
    assert.strictEqual(s.sum, 6.5);
    assert.strictEqual(s.min, -5);
    assert.strictEqual(s.max, 10);
  });

  test('selectionStats: a single numeric cell', () => {
    const m = parseCells('a,b\n1,2');
    const s = selectionStats(m, 1, 1, 1, 1);     // just "2"
    assert.strictEqual(s.sum, 2);
    assert.strictEqual(s.count, 1);
    assert.strictEqual(s.numericCount, 1);
    assert.strictEqual(s.avg, 2);
  });

  test('selectionStats: a range past the data treats padding as empty', () => {
    const m = parseCells('1,2\n3,4');                 // 2x2 of numbers
    const s = selectionStats(m, 0, 0, 3, 3);          // select a 4x4 region (fullscreen padding)
    assert.strictEqual(s.sum, 10);                    // only the real data
    assert.strictEqual(s.numericCount, 4);
    assert.strictEqual(s.count, 4);
  });

  // ── CSV file references (baked by the CLI) ──
  test('parseCells: unresolved {{ref}} reports the referenced path', () => {
    const m = parseCells('{{data/report.csv}}');
    assert.strictEqual(m.unresolved, 'data/report.csv');
    assert.strictEqual(m.empty, false);
  });

  test('parseCells: baked block strips the directive and keeps source', () => {
    const m = parseCells('sdoc-cells: source=report.csv\nRegion,Q1\nNorth,100');
    assert.strictEqual(m.source, 'report.csv');
    assert.strictEqual(m.rows, 2);
    assert.strictEqual(m.cells[0][0].value, 'Region');
    assert.strictEqual(m.cells[1][1].value, 100);
  });

  test('parseCells: baked directive carries a range view hint', () => {
    const m = parseCells('sdoc-cells: source=r.csv range=B5:J32\na,b\n1,2');
    assert.strictEqual(m.source, 'r.csv');
    assert.strictEqual(m.range, 'B5:J32');
  });

  test('parseCells: baked error directive surfaces the message', () => {
    const m = parseCells('sdoc-cells: error="Could not read report.csv"');
    assert.strictEqual(m.error, 'Could not read report.csv');
    assert.strictEqual(m.empty, false);
  });

  test('parseCells: a normal CSV row is not mistaken for a directive', () => {
    const m = parseCells('Region,Q1\nNorth,100');
    assert.strictEqual(m.source, undefined);
    assert.strictEqual(m.rows, 2);
  });

  test('parseCells: raw is preserved verbatim for round-trip', () => {
    const m = parseCells('  spaced  ,42');
    // raw keeps the spaces; value/type use the trimmed view.
    assert.strictEqual(m.cells[0][0].raw, '  spaced  ');
    assert.strictEqual(m.cells[0][0].value, 'spaced');
    assert.strictEqual(m.cells[0][1].raw, '42');
  });
};
