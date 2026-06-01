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

  test('shiftFormula: zero shift is identity; non-formulas pass through', () => {
    assert.strictEqual(F.shiftFormula('=SUM(A1:B2)*3', 0, 0), '=SUM(A1:B2)*3');
    assert.strictEqual(F.shiftFormula('plain text', 1, 1), 'plain text');
    assert.strictEqual(F.shiftFormula('123', 1, 1), '123');
  });
};
