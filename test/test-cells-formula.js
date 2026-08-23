/**
 * Cells formula-engine tests (public/sdocs-cells-formula.js).
 * Pure evaluator + whole-model recalc, no DOM.
 */
module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Cells Formula Tests ────────────────────────\n');

  const F = require('../public/sdocs-cells-formula');
  const { classify } = require('../public/sdocs-cells');

  // Build a model from a 2D array of raw strings using the real classifier.
  function model(rows) {
    return { cells: rows.map((line) => line.map((raw) => classify(String(raw)))) };
  }
  // Evaluate one formula by placing it in its own row and reading the result.
  function evalIn(rows, formula) {
    const m = model(rows.concat([[formula]]));
    const res = F.recalc(m);
    const last = res[res.length - 1][0];
    return last.kind === 'error' ? last.code : last.value;
  }

  test('formula: arithmetic and precedence', () => {
    assert.strictEqual(evalIn([], '=1+2*3'), 7);
    assert.strictEqual(evalIn([], '=(1+2)*3'), 9);
    assert.strictEqual(evalIn([], '=2^10'), 1024);
    assert.strictEqual(evalIn([], '=-3+1'), -2);
    assert.strictEqual(evalIn([], '=10%'), 0.1);
  });

  test('formula: cell references', () => {
    assert.strictEqual(evalIn([['5', '10']], '=A1+B1'), 15);
    assert.strictEqual(evalIn([['5', '']], '=A1+B1'), 5);       // empty ref = 0
    assert.strictEqual(evalIn([['hi', '2']], '=A1+B1'), '#VALUE!'); // text ref errors
  });

  test('formula: aggregate functions over ranges', () => {
    const grid = [['1', '2'], ['3', '4'], ['5', '6']];
    assert.strictEqual(evalIn(grid, '=SUM(A1:A3)'), 9);
    assert.strictEqual(evalIn(grid, '=SUM(A1:B3)'), 21);
    assert.strictEqual(evalIn(grid, '=AVERAGE(A1:A3)'), 3);
    assert.strictEqual(evalIn(grid, '=MIN(A1:B3)'), 1);
    assert.strictEqual(evalIn(grid, '=MAX(A1:B3)'), 6);
    assert.strictEqual(evalIn(grid, '=COUNT(A1:B3)'), 6);
    assert.strictEqual(evalIn(grid, '=PRODUCT(A1:A3)'), 15);
  });

  test('formula: COUNTA counts text, COUNT does not', () => {
    const grid = [['x', '2'], ['', '4']];
    assert.strictEqual(evalIn(grid, '=COUNT(A1:B2)'), 2);
    assert.strictEqual(evalIn(grid, '=COUNTA(A1:B2)'), 3);
  });

  test('formula: ROUND, ABS, IF', () => {
    assert.strictEqual(evalIn([], '=ROUND(3.14159,2)'), 3.14);
    assert.strictEqual(evalIn([], '=ABS(-7)'), 7);
    assert.strictEqual(evalIn([['10', '20']], '=IF(A1>B1,1,0)'), 0);
    assert.strictEqual(evalIn([['30', '20']], '=IF(A1>B1,A1,B1)'), 30);
  });

  test('formula: errors - div by zero, unknown name, trailing junk', () => {
    assert.strictEqual(evalIn([], '=1/0'), '#DIV/0!');
    assert.strictEqual(evalIn([], '=BOGUS(1)'), '#NAME?');
    assert.strictEqual(evalIn([], '=1+'), '#VALUE!');
  });

  test('formula: a literal #REF! is parsed as an expression value, not an early tokenizer exit', () => {
    // The unchosen IF branch must not poison the whole formula. More
    // importantly for export validation, the parser must still inspect every
    // token after an error literal rather than throwing as soon as it sees #.
    assert.strictEqual(evalIn([], '=IF(1,1,#REF!)'), 1);
    assert.strictEqual(evalIn([], '=IF(0,1,#REF!)'), '#REF!');
  });

  test('formula: chained references recalc', () => {
    const m = model([['2'], ['=A1*3'], ['=A2+1']]);
    const res = F.recalc(m);
    assert.strictEqual(res[1][0].value, 6);
    assert.strictEqual(res[2][0].value, 7);
  });

  test('formula: circular reference is flagged, not hung', () => {
    const m = model([['=A2'], ['=A1']]);
    const res = F.recalc(m);
    assert.strictEqual(res[0][0].kind, 'error');
    assert.strictEqual(res[0][0].code, '#CIRC!');
  });

  test('formula: isFormula guard', () => {
    assert.strictEqual(F.isFormula('=A1'), true);
    assert.strictEqual(F.isFormula('123'), false);
    assert.strictEqual(F.isFormula('='), false);
  });

  // ── recalc is a thin adapter over recalcWorkbook ──
  // recalc(model) must stay byte-identical to running the same model as a
  // single anonymous sheet through recalcWorkbook. This pins the refactor:
  // any future change that lets the two diverge breaks every existing doc.
  test('recalc(model) deep-equals recalcWorkbook([{model}])[0]', () => {
    const m = model([
      ['1', '2', 'hi'],          // numbers + a text cell
      ['=A1+B1', '=SUM(A1:B1)', '=C1+1'],  // formula, range, text-ref error
      ['=A3', '', ''],           // self-cycle on A3
    ]);
    const viaRecalc = F.recalc(m);
    const viaWorkbook = F.recalcWorkbook([{ name: '', model: m }])[0];
    assert.deepStrictEqual(viaRecalc, viaWorkbook);
    // and the fixture genuinely exercises every result kind
    assert.strictEqual(viaRecalc[1][0].value, 3);          // number
    assert.strictEqual(viaRecalc[1][2].code, '#VALUE!');   // text ref
    assert.strictEqual(viaRecalc[2][0].code, '#CIRC!');    // cycle
  });

  // ── Cross-tab references (Sheet!A1) via recalcWorkbook ──
  // Build a workbook from {name: [[raw,...],...]} and return its results grids
  // keyed by sheet name for easy assertion.
  function workbook(spec) {
    const sheets = Object.keys(spec).map((name) => ({ name, model: model(spec[name]) }));
    const grids = F.recalcWorkbook(sheets);
    const byName = {};
    sheets.forEach((s, i) => { byName[s.name] = grids[i]; });
    return byName;
  }

  test('cross-tab: Sheet!A1 reads another sheet; bare ref stays local', () => {
    const wb = workbook({
      Expenses: [['Category', 'Jan'], ['Rent', '1200'], ['Total', '=B2']],
      Summary: [['Grand', '=Expenses!B3'], ['7', '=A2']],
    });
    assert.strictEqual(wb.Expenses[2][1].value, 1200);   // =B2 local
    assert.strictEqual(wb.Summary[0][1].value, 1200);    // =Expenses!B3 cross-sheet
    assert.strictEqual(wb.Summary[1][1].value, 7);       // =A2 stays local (Summary's own A2 = 7)
  });

  test('cross-tab: a qualified range walks only the named sheet', () => {
    const wb = workbook({
      Expenses: [['1', '2', '3'], ['10', '20', '30']],
      Summary: [['=SUM(Expenses!A2:C2)']],
    });
    assert.strictEqual(wb.Summary[0][0].value, 60);
  });

  test('cross-tab: a range spanning two sheets is #REF!', () => {
    const wb = workbook({
      Sheet1: [['1']],
      Sheet2: [['2']],
      Out: [['=SUM(Sheet1!A1:Sheet2!A1)']],
    });
    assert.strictEqual(wb.Out[0][0].kind, 'error');
    assert.strictEqual(wb.Out[0][0].code, '#REF!');
  });

  test('cross-tab: a reference to a missing sheet is #REF! and terminates', () => {
    const wb = workbook({ Only: [['=Nope!A1']] });
    assert.strictEqual(wb.Only[0][0].code, '#REF!');
  });

  test('cross-tab: out-of-bounds cell on a valid sheet reads 0', () => {
    const wb = workbook({
      Sales: [['5']],
      Summary: [['=Sales!Z99+1']],
    });
    assert.strictEqual(wb.Summary[0][0].value, 1);   // empty ref = 0, +1
  });

  test('cross-tab: a self-referential qualified ref is #CIRC!', () => {
    // Sales!B2 written in Sales B2 (row 2, col B) refers to itself.
    const wb = workbook({ Sales: [['x', 'y'], ['a', '=Sales!B2']] });
    assert.strictEqual(wb.Sales[1][1].code, '#CIRC!');
  });

  test('cross-tab: a cycle that spans two sheets is #CIRC! on both', () => {
    const wb = workbook({
      A: [['=B!A1']],
      B: [['=A!A1']],
    });
    assert.strictEqual(wb.A[0][0].code, '#CIRC!');
    assert.strictEqual(wb.B[0][0].code, '#CIRC!');
  });

  test('cross-tab: sheet lookup is case-insensitive', () => {
    const wb = workbook({
      Sales: [['42']],
      Summary: [['=sales!A1', '=SALES!A1']],
    });
    assert.strictEqual(wb.Summary[0][0].value, 42);
    assert.strictEqual(wb.Summary[0][1].value, 42);
  });

  test('cross-tab: on a name collision the first sheet wins', () => {
    // Two sheets both named Dup; a ref resolves to the first one's data.
    const sheets = [
      { name: 'Dup', model: model([['100']]) },
      { name: 'Dup', model: model([['200']]) },
      { name: 'Ref', model: model([['=Dup!A1']]) },
    ];
    const grids = F.recalcWorkbook(sheets);
    assert.strictEqual(grids[2][0][0].value, 100);
  });

  // ── shiftFormula: relative reference adjustment (fill / copy-paste) ──
  test('shiftFormula: shifts row references', () => {
    assert.strictEqual(F.shiftFormula('=B2*C2', 1, 0), '=B3*C3');
    assert.strictEqual(F.shiftFormula('=B2*C2', 3, 0), '=B5*C5');
    assert.strictEqual(F.shiftFormula('=B5+1', -2, 0), '=B3+1');
  });

  test('shiftFormula: shifts column references', () => {
    assert.strictEqual(F.shiftFormula('=B2+C2', 0, 1), '=C2+D2');
    assert.strictEqual(F.shiftFormula('=Z1', 0, 1), '=AA1');     // letter rollover
    assert.strictEqual(F.shiftFormula('=AA1', 0, -1), '=Z1');
  });

  test('shiftFormula: shifts ranges and leaves function names alone', () => {
    assert.strictEqual(F.shiftFormula('=SUM(B2:B5)', 0, 1), '=SUM(C2:C5)');
    assert.strictEqual(F.shiftFormula('=SUM(B2:B5)', 2, 0), '=SUM(B4:B7)');
    assert.strictEqual(F.shiftFormula('=ROUND(A1,2)', 1, 1), '=ROUND(B2,2)');
    // numbers and operators untouched
    assert.strictEqual(F.shiftFormula('=A1*2+10%', 1, 0), '=A2*2+10%');
  });

  test('shiftFormula: a reference pushed off the sheet becomes #REF!', () => {
    assert.strictEqual(F.shiftFormula('=A1+B1', -1, 0), '=#REF!+#REF!');
    assert.strictEqual(F.shiftFormula('=A1', 0, -1), '=#REF!');
    // and evaluating that yields a #REF! error, not a crash
    assert.strictEqual(evalIn([], F.shiftFormula('=A1', -1, 0)), '#REF!');
  });

  test('shiftFormula: a sheet name is kept, only the cell ref shifts', () => {
    assert.strictEqual(F.shiftFormula('=Sales!B2', 1, 0), '=Sales!B3');
    // a numeric-suffixed sheet name must not be shifted as a cell ref
    assert.strictEqual(F.shiftFormula('=Sheet1!B2*2', 0, 1), '=Sheet1!C2*2');
    assert.strictEqual(F.shiftFormula('=Q1!A1+B1', 1, 0), '=Q1!A2+B2');
  });

  test('shiftFormula: zero shift is identity; non-formulas pass through', () => {
    assert.strictEqual(F.shiftFormula('=SUM(A1:B2)*3', 0, 0), '=SUM(A1:B2)*3');
    assert.strictEqual(F.shiftFormula('plain text', 1, 1), 'plain text');
    assert.strictEqual(F.shiftFormula('123', 1, 1), '123');
  });

  test('formula: string, boolean, concatenation, and error handling return typed values', () => {
    const text = F.evaluate('=UPPER("small")&" docs"', { cell: () => ({ kind: 'empty' }) });
    assert.deepStrictEqual(text, { value: 'SMALL docs', kind: 'text', safe: true });
    const bool = F.evaluate('=AND(TRUE,NOT(FALSE))', { cell: () => ({ kind: 'empty' }) });
    assert.deepStrictEqual(bool, { value: true, kind: 'boolean', safe: true });
    assert.deepStrictEqual(F.evaluate('=2>1', { cell: () => ({ kind: 'empty' }) }),
      { value: true, kind: 'boolean', safe: true });
    assert.strictEqual(F.evaluate('=IFERROR(1/0,"fallback")', { cell: () => ({ kind: 'empty' }) }).value, 'fallback');
  });

  test('formula: common math, conditional aggregate, lookup, date, and finance functions', () => {
    const m = model([
      ['Key', 'Value'],
      ['a', '10'],
      ['b', '20'],
      ['c', '30'],
      ['sum b+', '=SUMIF(B2:B4,">=20")'],
      ['lookup', '=XLOOKUP("b",A2:A4,B2:B4)'],
      ['vlookup', '=VLOOKUP("c",A2:B4,2,FALSE)'],
      ['index', '=INDEX(B2:B4,MATCH("a",A2:A4,0))'],
      ['date', '=YEAR(DATE(2026,8,23))'],
      ['npv', '=ROUND(NPV(0.1,100,100),2)'],
    ]);
    const fx = F.recalc(m);
    assert.strictEqual(fx[4][1].value, 50);
    assert.strictEqual(fx[5][1].value, 20);
    assert.strictEqual(fx[6][1].value, 30);
    assert.strictEqual(fx[7][1].value, 10);
    assert.strictEqual(fx[8][1].value, 2026);
    assert.strictEqual(fx[9][1].value, 173.55);
    assert.strictEqual(F.evaluate('=ROUND(-1.5,0)', { cell: () => ({ kind: 'empty' }) }).value, -2);
    assert.strictEqual(F.evaluate('=ROUND(1.005,2)', { cell: () => ({ kind: 'empty' }) }).value, 1.01);
  });

  test('formula: quoted and punctuation sheet names resolve case-insensitively', () => {
    const wb = workbook({
      'Rev by Region': [['Key', 'Value'], ['x', '42']],
      'A_B.2026': [['=\'Rev by Region\'!$B$2']],
      Summary: [['=A_B.2026!A1']],
    });
    assert.strictEqual(wb['A_B.2026'][0][0].value, 42);
    assert.strictEqual(wb.Summary[0][0].value, 42);
  });

  test('shiftFormula: mixed and absolute references keep anchored axes', () => {
    assert.strictEqual(F.shiftFormula('=$A1+A$1+$A$1+A1', 1, 1), '=$A2+B$1+$A$1+B2');
    assert.strictEqual(F.shiftFormula('=\'Rev by Region\'!$A1+Sheet1!B$2', 1, 1),
      '=\'Rev by Region\'!$A2+Sheet1!C$2');
    assert.strictEqual(F.shiftFormula('="A1"&A1', 1, 1), '="A1"&B2');
  });

  test('formula: full Excel-sized sparse ranges only visit populated cells', () => {
    const m = model([['1'], ['2'], ['=SUM(A1:XFD2)']]);
    assert.strictEqual(F.recalc(m)[2][0].value, 3);
    assert.strictEqual(F.evaluate('=SUM(A1:XFE1)', { cell: () => ({ kind: 'empty' }) }).error, '#REF!');
  });

  test('formula: malformed numeric lexemes fail closed for export safety', () => {
    const ctx = { cell: () => ({ kind: 'empty' }) };
    ['=1.2.3', '=1e', '=1e+'].forEach((formula) => {
      const out = F.evaluate(formula, ctx);
      assert.strictEqual(out.error, '#VALUE!');
      assert.strictEqual(out.safe, false);
    });
  });

  test('formula: export safety propagates through referenced formulas', () => {
    const m = model([['=IF(TRUE,1,WEBSERVICE(B1))', '=A1+1']]);
    const fx = F.recalc(m);
    assert.strictEqual(fx[0][0].value, 1);
    assert.strictEqual(fx[0][0].safe, false);
    assert.strictEqual(fx[0][1].value, 2);
    assert.strictEqual(fx[0][1].safe, false);
  });

  test('formula: missing-sheet ranges return #REF even in COUNT', () => {
    const wb = workbook({ Summary: [['=COUNT(Nope!A1:A2)']] });
    assert.strictEqual(wb.Summary[0][0].code, '#REF!');
  });

  test('formula: positional and criteria ranges preserve implicit blanks', () => {
    const m = model([['x', '', '', '=INDEX(A1:C1,1,3)', '=COUNTIF(A1:A10,"")']]);
    const fx = F.recalc(m);
    assert.strictEqual(fx[0][3].value, '');
    assert.strictEqual(fx[0][4].value, 9);
  });

  test('formula: reviewed functions follow Excel edge semantics', () => {
    const m = model([
      ['1', '10', '=AVERAGEIF(A1:A2,">0",B1:B2)'],
      ['2', 'x', '=XLOOKUP("A",D2:D2,E2:E2)', 'a', '7'],
    ]);
    const fx = F.recalc(m);
    assert.strictEqual(fx[0][2].value, 10);
    assert.strictEqual(fx[1][2].value, 7);
    assert.strictEqual(F.evaluate('=DATE(1900,1,1)', { cell: () => ({ kind: 'empty' }) }).value, 1);
    assert.strictEqual(F.evaluate('=AND(FALSE,1/0)', { cell: () => ({ kind: 'empty' }) }).error, '#DIV/0!');
    assert.strictEqual(F.evaluate('=OR(TRUE,1/0)', { cell: () => ({ kind: 'empty' }) }).error, '#DIV/0!');
    assert.strictEqual(F.evaluate('=LEFT("abc",-1)', { cell: () => ({ kind: 'empty' }) }).error, '#VALUE!');
    assert.strictEqual(F.evaluate('=RIGHT("abc",-1)', { cell: () => ({ kind: 'empty' }) }).error, '#VALUE!');
    assert.strictEqual(F.evaluate('=MID("abc",0,2)', { cell: () => ({ kind: 'empty' }) }).error, '#VALUE!');
  });
};
