/**
 * Cells model tests - the backbone of the sheets-v1 feature.
 * Pure parser + grid model, no DOM.
 */

module.exports = function(harness) {
  const { assert, test } = harness;

  console.log('\n── Cells Model Tests ──────────────────────────\n');

  const { colName, classify, parseCsv, parseCells, serializeCsv } = require('../public/sdocs-cells');

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
