/**
 * Pure workbook planner and instance controller tests.
 */

module.exports = function (harness) {
  const { assert, test } = harness;
  const fs = require('fs');
  const path = require('path');

  console.log('\n-- Cells Controller Tests ----------------------\n');

  const CELLS = require('../public/sdocs-cells');
  const FX = require('../public/sdocs-cells-formula');
  const CONTROLLER = require('../public/sdocs-cells-controller');

  function controller(limits) {
    return CONTROLLER.createController({ cells: CELLS, formula: FX, limits });
  }

  test('cells controller requires injected model and formula APIs', () => {
    assert.throws(() => CONTROLLER.createController({ formula: FX }), /cells must provide parseCells/);
    assert.throws(() => CONTROLLER.createController({ cells: CELLS }), /formula must provide recalcWorkbook/);
  });

  test('planner preserves the default workbook and effective sheet names', () => {
    const ctl = controller();
    const plan = ctl.plan([
      { source: 'A,1' },
      { source: 'sdoc-cells: name="Named"\nA,2' },
      { source: 'A,3' },
    ]);
    assert.deepStrictEqual(plan.groups.map((group) => group.id), ['']);
    assert.deepStrictEqual(plan.entries.map((entry) => entry.name), ['Sheet1', 'Named', 'Sheet2']);
    assert.deepStrictEqual(plan.entries.map((entry) => entry.duplicate), [false, false, false]);
  });

  test('automatic names preserve production collision behavior', () => {
    const ctl = controller();
    const plan = ctl.plan([
      { source: 'sdoc-cells: name="Sheet1"\nA,1' },
      { source: 'A,2' },
    ]);
    assert.deepStrictEqual(plan.entries.map((entry) => entry.name), ['Sheet1', 'Sheet1']);
    assert.deepStrictEqual(plan.entries.map((entry) => entry.duplicate), [false, true]);
  });

  test('duplicates are case-insensitive and formulas resolve to the first name', () => {
    const ctl = controller();
    const plan = ctl.plan([
      { source: 'sdoc-cells: name="Data"\nValue\n10' },
      { source: 'sdoc-cells: name="data"\nValue\n99' },
      { source: 'sdoc-cells: name="Calc"\nResult,=DATA!A2' },
    ]);
    assert.deepStrictEqual(plan.entries.map((entry) => entry.duplicate), [false, true, false]);
    assert.strictEqual(plan.groups[0].fx[2][0][1].value, 10);
  });

  test('named workbooks remain isolated and retain first-seen order', () => {
    const ctl = controller();
    const plan = ctl.plan([
      { source: 'sdoc-cells: name="Data" workbook="one"\nValue\n10' },
      { source: 'sdoc-cells: name="Data" workbook="two"\nValue\n99' },
      { source: 'sdoc-cells: name="Calc" workbook="one"\nResult,=Data!A2' },
    ]);
    assert.deepStrictEqual(plan.groups.map((group) => group.id), ['one', 'two']);
    assert.strictEqual(plan.groups[0].fx[1][0][1].value, 10);
    assert.strictEqual(plan.entries[0].duplicate, false);
    assert.strictEqual(plan.entries[1].duplicate, false);
  });

  test('planner processes 50 blocks and leaves later blocks omitted', () => {
    const ctl = controller();
    const blocks = Array.from({ length: 51 }, (_, i) => ({ source: 'Value\n' + i }));
    const plan = ctl.plan(blocks);
    assert.strictEqual(plan.processedCount, 50);
    assert.strictEqual(plan.entries.length, 50);
    assert.strictEqual(plan.omittedCount, 1);
  });

  test('planner applies the current JavaScript string-length source cap', () => {
    const ctl = controller();
    const cap = CONTROLLER.DEFAULT_LIMITS.sourceCharacters;
    const plan = ctl.plan([{ source: 'x'.repeat(cap + 1), context: { id: 7 } }]);
    assert.strictEqual(plan.entries.length, 0);
    assert.strictEqual(plan.items[0].kind, 'error');
    assert.strictEqual(plan.items[0].message, 'Cells source exceeds 256 KB cap');
    assert.deepStrictEqual(plan.items[0].context, { id: 7 });
  });

  test('controllers keep workbook registries isolated by instance', () => {
    const first = controller();
    const second = controller();
    const a = first.plan([{ source: 'sdoc-cells: name="Data"\nValue\n10' }]);
    const b = second.plan([{ source: 'sdoc-cells: name="Data"\nValue\n99' }]);
    assert.strictEqual(first.groupFor(a.entries[0].model).sheets[0].model.cells[1][0].value, 10);
    assert.strictEqual(second.groupFor(b.entries[0].model).sheets[0].model.cells[1][0].value, 99);
  });

  test('group and recalc accept an instance adapter for effective edited models', () => {
    const ctl = controller();
    const plan = ctl.plan([
      { source: 'sdoc-cells: name="Data"\nValue\n10' },
      { source: 'sdoc-cells: name="Calc"\nResult,=Data!A2' },
    ]);
    const edited = CELLS.parseCells('Value\n42');
    const resolve = (entry) => entry.name === 'Data' ? edited : entry.model;
    const calcFx = ctl.recalculateFor(plan.entries[1].model, resolve);
    assert.strictEqual(calcFx[0][1].value, 42);
    assert.strictEqual(ctl.groupFor(plan.entries[0].model, resolve).sheets[0].model, edited);
  });

  test('destroy is idempotent and closes controller planning', () => {
    const ctl = controller();
    ctl.destroy();
    ctl.destroy();
    assert.deepStrictEqual(ctl.getPlan().entries, []);
    assert.throws(() => ctl.plan([]), /destroyed/);
  });

  test('controller source has no DOM ownership surface', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'sdocs-cells-controller.js'), 'utf8');
    ['document.', 'addEventListener', 'ResizeObserver', 'MutationObserver', 'createObjectURL'].forEach((token) => {
      assert.strictEqual(source.includes(token), false, 'controller must not contain ' + token);
    });
  });
};
