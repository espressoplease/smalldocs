/**
 * Cells model tests - the backbone of the sheets-v1 feature.
 * Pure parser + grid model, no DOM.
 */

module.exports = function(harness) {
  const { assert, test } = harness;

  console.log('\n── Cells Model Tests ──────────────────────────\n');

  const { colName, classify, parseCsv, parseCells, serializeCsv, selectionStats, formatNumber, parseFormats, formatValue, colIndex, sortRows, looksLikeHeader } = require('../public/sdocs-cells');

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

  // ── Sorting (a view reorder - returns the row order) ──
  test('looksLikeHeader: text row 0 over numeric data is a header', () => {
    assert.strictEqual(looksLikeHeader(parseCells('Region,Q1\nNorth,100\nSouth,90')), true);
    assert.strictEqual(looksLikeHeader(parseCells('1,2\n3,4')), false);       // numeric row 0
    assert.strictEqual(looksLikeHeader(parseCells('only,one')), false);       // < 2 rows
  });

  test('sortRows: ascending by a numeric column (header kept fixed)', () => {
    const m = parseCells('Name,Score\nBea,30\nAl,10\nCy,20');
    const order = sortRows(m, 1, 'asc', true);   // sort by Score, header fixed
    assert.deepStrictEqual(order, [0, 2, 3, 1]); // header, then 10, 20, 30
  });

  test('sortRows: descending', () => {
    const m = parseCells('Name,Score\nBea,30\nAl,10\nCy,20');
    const order = sortRows(m, 1, 'desc', true);
    assert.deepStrictEqual(order, [0, 1, 3, 2]); // header, then 30, 20, 10
  });

  test('sortRows: text sorts alphabetically', () => {
    const m = parseCells('x\nBea\nAl\nCy');       // rows: x, Bea, Al, Cy
    const order = sortRows(m, 0, 'asc', false);  // no header
    assert.deepStrictEqual(order, [2, 1, 3, 0]); // Al, Bea, Cy, x
  });

  test('sortRows: empty cells go last regardless of direction', () => {
    const m = parseCells('a\n5\n\n2');            // rows: 5, (empty), 2
    const asc = sortRows(m, 0, 'asc', false);
    assert.strictEqual(asc[asc.length - 1], 2);   // the empty row last
    const desc = sortRows(m, 0, 'desc', false);
    assert.strictEqual(desc[desc.length - 1], 2); // still last
  });

  test('sortRows: formula cells sort by their computed value when fx is given', () => {
    // Without fx, "=..." cells are text and sort alphabetically by formula
    // source - wrong. With a recalc results grid they sort by computed value.
    const m = parseCells('Item,Val\nA,=1*30\nB,=1*10\nC,=1*20');
    const fx = [
      [{ kind: 'text' }, { kind: 'text' }],
      [{ kind: 'text' }, { kind: 'number', value: 30 }],
      [{ kind: 'text' }, { kind: 'number', value: 10 }],
      [{ kind: 'text' }, { kind: 'number', value: 20 }],
    ];
    const order = sortRows(m, 1, 'asc', true, fx);
    assert.deepStrictEqual(order, [0, 2, 3, 1]);  // header, then 10, 20, 30
    const desc = sortRows(m, 1, 'desc', true, fx);
    assert.deepStrictEqual(desc, [0, 1, 3, 2]);   // header, then 30, 20, 10
  });

  test('sortRows: formula errors sort with text (after numbers)', () => {
    // rows: 0 = error formula, 1 = plain 5, 2 = formula evaluating to 4
    const m = parseCells('=NOPE(\n5\n=2*2');
    const fx = [
      [{ kind: 'error', code: '#NAME?' }],
      [{ kind: 'number', value: 5 }],
      [{ kind: 'number', value: 4 }],
    ];
    const order = sortRows(m, 0, 'asc', false, fx);
    assert.deepStrictEqual(order, [2, 1, 0]);     // 4, 5, then the error
  });

  test('sortRows: a trailing Total row (range formula) stays pinned at the bottom', () => {
    // A summary row aggregates a multi-row range (=SUM(B2:B4)); per-row
    // formulas (=B2*2) do not. Sorting must not jumble the summary into the
    // data - it stays last, like the header stays first.
    const m = parseCells('Item,Val\nB,30\nA,10\nTotal,=SUM(B2:B3)');
    const fx = [
      [{ kind: 'text' }, { kind: 'text' }],
      [{ kind: 'text' }, { kind: 'number', value: 30 }],
      [{ kind: 'text' }, { kind: 'number', value: 10 }],
      [{ kind: 'text' }, { kind: 'number', value: 40 }],
    ];
    const asc = sortRows(m, 1, 'asc', true, fx);
    assert.deepStrictEqual(asc, [0, 2, 1, 3]);    // header, 10, 30, Total pinned
    const desc = sortRows(m, 1, 'desc', true, fx);
    assert.deepStrictEqual(desc, [0, 1, 2, 3]);   // header, 30, 10, Total pinned
  });

  test('sortRows: multiple trailing summary rows stay pinned in their own order', () => {
    const m = parseCells('Val\n30\n10\n=SUM(A2:A3)\n=AVERAGE(A2:A3)');
    const fx = [
      [{ kind: 'text' }],
      [{ kind: 'number', value: 30 }],
      [{ kind: 'number', value: 10 }],
      [{ kind: 'number', value: 40 }],
      [{ kind: 'number', value: 20 }],
    ];
    const order = sortRows(m, 0, 'asc', true, fx);
    assert.deepStrictEqual(order, [0, 2, 1, 3, 4]);  // header, 10, 30, SUM, AVERAGE
  });

  test('sortRows: a same-row formula (no range) is NOT treated as a summary row', () => {
    // =A2*2 references a single cell, not a range - it sorts with the data.
    const m = parseCells('A,B\n3,=A2*2\n1,=A3*2\n2,=A4*2');
    const fx = [
      [{ kind: 'text' }, { kind: 'text' }],
      [{ kind: 'number', value: 3 }, { kind: 'number', value: 6 }],
      [{ kind: 'number', value: 1 }, { kind: 'number', value: 2 }],
      [{ kind: 'number', value: 2 }, { kind: 'number', value: 4 }],
    ];
    const order = sortRows(m, 1, 'asc', true, fx);
    assert.deepStrictEqual(order, [0, 2, 3, 1]);  // header, 2, 4, 6 - nothing pinned
  });

  // ── Column format directives (author-controlled, display only) ──
  test('colIndex: letters to 0-based index', () => {
    assert.strictEqual(colIndex('A'), 0);
    assert.strictEqual(colIndex('B'), 1);
    assert.strictEqual(colIndex('Z'), 25);
    assert.strictEqual(colIndex('AA'), 26);
  });

  test('parseFormats: parses per-column format spec', () => {
    const f = parseFormats('A=plain B=$ C=% D=,');
    assert.strictEqual(f[0].kind, 'plain');
    assert.strictEqual(f[1].kind, 'currency');
    assert.strictEqual(f[1].symbol, '$');
    assert.strictEqual(f[1].decimals, 2);
    assert.strictEqual(f[2].kind, 'percent');
    assert.strictEqual(f[3].kind, 'number');
  });

  test('parseFormats: currency symbols and decimal overrides', () => {
    const f = parseFormats('A=£ B=$.0 C=%.1 D=.2');
    assert.strictEqual(f[0].symbol, '£');
    assert.strictEqual(f[1].decimals, 0);
    assert.strictEqual(f[2].kind, 'percent');
    assert.strictEqual(f[2].decimals, 1);
    assert.strictEqual(f[3].kind, 'number');
    assert.strictEqual(f[3].decimals, 2);
  });

  test('formatValue: currency', () => {
    assert.strictEqual(formatValue(classify('12000'), { kind: 'currency', symbol: '$', decimals: 2 }), '$12,000.00');
    assert.strictEqual(formatValue(classify('-1200'), { kind: 'currency', symbol: '$', decimals: 2 }), '-$1,200.00');
    assert.strictEqual(formatValue(classify('5'), { kind: 'currency', symbol: '£', decimals: 0 }), '£5');
  });

  test('formatValue: percent multiplies by 100', () => {
    assert.strictEqual(formatValue(classify('0.23'), { kind: 'percent' }), '23%');
    assert.strictEqual(formatValue(classify('0.2356'), { kind: 'percent', decimals: 1 }), '23.6%');
  });

  test('formatValue: plain returns the raw (no separators - good for years/ids)', () => {
    assert.strictEqual(formatValue(classify('2024'), { kind: 'plain' }), '2024');
  });

  test('formatValue: number with fixed decimals', () => {
    assert.strictEqual(formatValue(classify('3.14159'), { kind: 'number', decimals: 2 }), '3.14');
    assert.strictEqual(formatValue(classify('12000'), { kind: 'number' }), '12,000');
  });

  test('formatValue: text cells get no number format', () => {
    assert.strictEqual(formatValue(classify('Region'), { kind: 'currency', symbol: '$' }), null);
  });

  test('parseCells: peels a format: directive into model.formats', () => {
    const m = parseCells('format: A=plain B=$\n2024,12000\n2025,15000');
    assert.ok(m.formats);
    assert.strictEqual(m.formats[0].kind, 'plain');
    assert.strictEqual(m.formats[1].kind, 'currency');
    assert.strictEqual(m.rows, 2);
    assert.strictEqual(m.cells[0][0].value, 2024);   // the directive line is stripped
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

  test('selectionStats: formula cells contribute their computed value when fx is given', () => {
    // rows: header, 10, 20, =SUM (computes to 30)
    const m = parseCells('Qty\n10\n20\n=SUM(A2:A3)');
    const fx = [
      [{ kind: 'text' }],
      [{ kind: 'number', value: 10 }],
      [{ kind: 'number', value: 20 }],
      [{ kind: 'number', value: 30 }],
    ];
    const s = selectionStats(m, 0, 0, 3, 0, fx);
    assert.strictEqual(s.sum, 60);               // 10 + 20 + computed 30
    assert.strictEqual(s.numericCount, 3);
    assert.strictEqual(s.count, 4);              // header text still counts as non-empty
    assert.strictEqual(s.max, 30);
    // Without fx the formula cell falls back to text (raw "=SUM...").
    const s2 = selectionStats(m, 0, 0, 3, 0);
    assert.strictEqual(s2.sum, 30);
    assert.strictEqual(s2.numericCount, 2);
  });

  test('selectionStats: formula errors count as non-empty but not numeric', () => {
    const m = parseCells('=1/0\n5');
    const fx = [
      [{ kind: 'error', code: '#DIV/0!' }],
      [{ kind: 'number', value: 5 }],
    ];
    const s = selectionStats(m, 0, 0, 1, 0, fx);
    assert.strictEqual(s.sum, 5);
    assert.strictEqual(s.numericCount, 1);
    assert.strictEqual(s.count, 2);
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
