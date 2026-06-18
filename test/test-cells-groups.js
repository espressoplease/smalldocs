/**
 * Cells workbook-grouping tests (Stage A: isolation).
 *
 * A ```cells fence can name a workbook: ```cells financials/Model. Blocks that
 * share a workbook id form one independent workbook - own name namespace, own
 * cross-sheet formula scope. These tests pin the two pure pieces that the
 * isolation rests on: the fence splitter (parseFenceInfo) and the fact that
 * recalcWorkbook resolves references ONLY within the array it is handed (so a
 * reference into another workbook reads #REF!, never a leaked value).
 */

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Cells Workbook Groups ──────────────────────\n');

  const CELLS = require('../cli/shared/sdocs-cells');
  const FX = require('../cli/shared/sdocs-cells-formula');

  // ── parseFenceInfo: the one shared split (browser + CLI use it) ──

  test('parseFenceInfo: no slash -> default workbook, whole string is the name', () => {
    assert.deepStrictEqual(CELLS.parseFenceInfo('Model'), { workbook: '', name: 'Model' });
  });

  test('parseFenceInfo: first slash splits workbook from sheet', () => {
    assert.deepStrictEqual(CELLS.parseFenceInfo('financials/Model'), { workbook: 'financials', name: 'Model' });
  });

  test('parseFenceInfo: sheet name may contain spaces', () => {
    assert.deepStrictEqual(CELLS.parseFenceInfo('Q1/Revenue by Region'), { workbook: 'Q1', name: 'Revenue by Region' });
  });

  test('parseFenceInfo: everything after the first slash is the name verbatim', () => {
    assert.deepStrictEqual(CELLS.parseFenceInfo('a/b/c'), { workbook: 'a', name: 'b/c' });
  });

  test('parseFenceInfo: trims around the slash', () => {
    assert.deepStrictEqual(CELLS.parseFenceInfo('  fin / Sheet '), { workbook: 'fin', name: 'Sheet' });
  });

  test('parseFenceInfo: empty info -> empty workbook and name', () => {
    assert.deepStrictEqual(CELLS.parseFenceInfo(''), { workbook: '', name: '' });
  });

  // ── parseCells peels a baked workbook directive ──

  test('parseCells: peels workbook= from the baked directive', () => {
    const m = CELLS.parseCells('sdoc-cells: name="Model" workbook="financials"\nA,1');
    assert.strictEqual(m.workbook, 'financials');
    assert.strictEqual(m.name, 'Model');
  });

  test('parseCells: no workbook directive -> workbook undefined (default)', () => {
    const m = CELLS.parseCells('sdoc-cells: name="Model"\nA,1');
    assert.strictEqual(m.workbook, undefined);
  });

  // ── Isolation: recalcWorkbook only sees the array it is handed ──

  test('groups: a reference into another workbook reads #REF!', () => {
    // Calc resolves Data!B2 (present) but Secret!B1 (absent from this array).
    const data = CELLS.parseCells('Metric,Value\nA,10');           // B2 = 10
    const calc = CELLS.parseCells('Local,=Data!B2\nForeign,=Secret!B1');
    const grids = FX.recalcWorkbook([{ name: 'Data', model: data }, { name: 'Calc', model: calc }]);
    assert.strictEqual(grids[1][0][1].value, 10);                  // Local resolves
    assert.strictEqual(grids[1][1][1].code, '#REF!');             // Foreign cannot reach Secret
  });

  test('groups: the same sheet name in two workbooks resolves to its own data', () => {
    // Two workbooks each named their sheet "Data"; a "Local,=Data!B2" formula
    // in each must read its OWN Data, not the other's (no global first-wins).
    const dataA = CELLS.parseCells('Metric,Value\nA,10');
    const calcA = CELLS.parseCells('Local,=Data!B2');
    const a = FX.recalcWorkbook([{ name: 'Data', model: dataA }, { name: 'Calc', model: calcA }]);

    const dataB = CELLS.parseCells('Metric,Value\nA,99');
    const calcB = CELLS.parseCells('Local,=Data!B2');
    const b = FX.recalcWorkbook([{ name: 'Data', model: dataB }, { name: 'Calc', model: calcB }]);

    assert.strictEqual(a[1][0][1].value, 10);
    assert.strictEqual(b[1][0][1].value, 99);
  });

  test('groups: a would-be cross-workbook cycle is two #REF!s, never #CIRC!', () => {
    // Alpha references a sheet that only exists in Beta and vice versa. Because
    // each workbook recalcs alone, neither sees the other, so each is a plain
    // missing-name #REF! - there is no cycle to detect.
    const aCalc = CELLS.parseCells('X,=BetaOnly!A1');
    const bCalc = CELLS.parseCells('Y,=AlphaOnly!A1');
    const a = FX.recalcWorkbook([{ name: 'AlphaOnly', model: aCalc }]);
    const b = FX.recalcWorkbook([{ name: 'BetaOnly', model: bCalc }]);
    assert.strictEqual(a[0][0][1].code, '#REF!');
    assert.strictEqual(b[0][0][1].code, '#REF!');
  });
};
