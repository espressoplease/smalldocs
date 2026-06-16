/**
 * `sdoc cells verify` tests - spawns the real CLI binary against temp
 * fixtures (the command calls process.exit, so it must run out-of-process).
 * Covers the values output, banners, CSV re-quoting, --json, --sheet, the
 * exit-code contract, and that it reuses the same transclude+engine path the
 * browser runs.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Cells Verify (CLI) ─────────────────────────\n');

  const BIN = path.join(__dirname, '..', 'cli', 'bin', 'sdocs-dev.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdoc-verify-'));
  function write(name, body) { const p = path.join(dir, name); fs.writeFileSync(p, body); return p; }
  function run(args) {
    const r = spawnSync('node', [BIN, 'cells', 'verify', ...args], {
      encoding: 'utf-8',
      env: Object.assign({}, process.env, { SDOCS_NO_UPDATE_CHECK: '1', SDOCS_NO_SETUP: '1' }),
    });
    return { out: r.stdout || '', err: r.stderr || '', code: r.status };
  }

  const TWO_TAB = [
    '# Budget',
    '',
    '```cells Expenses',
    'Category,Jan,Feb,Mar',
    'Rent,1200,1200,1200',
    'Food,350,400,380',
    'Total,=SUM(B2:B3),=SUM(C2:C3),=SUM(D2:D3)',
    '```',
    '',
    '```cells Summary',
    'Metric,Value',
    'Grand Total,=SUM(Expenses!B4:D4)',
    '```',
    '',
  ].join('\n');

  test('verify: multi-tab doc prints banners and computed cross-tab values', () => {
    const f = write('wb.md', TWO_TAB);
    const r = run([f]);
    assert.strictEqual(r.code, 0, 'clean doc exits 0');
    assert.ok(r.out.indexOf('# sheet: Expenses') >= 0, 'Expenses banner');
    assert.ok(r.out.indexOf('# sheet: Summary') >= 0, 'Summary banner');
    assert.ok(/Total,1550,1600,1580/.test(r.out), 'in-tab SUM computed');
    assert.ok(/Grand Total,4730/.test(r.out), 'cross-tab SUM computed (1550+1600+1580)');
  });

  test('verify: a single-tab doc still gets one banner (uniform format)', () => {
    const f = write('one.md', '```cells\nA,B\n1,2\n```\n');
    const r = run([f]);
    assert.strictEqual(r.code, 0);
    assert.ok(r.out.indexOf('# sheet: Sheet1') >= 0, 'unnamed single tab is Sheet1');
  });

  test('verify: text values with commas/quotes are re-quoted (valid CSV)', () => {
    const f = write('q.md', '```cells Data\nName,Note\n"Smith, Jane","a, b"\n```\n');
    const r = run([f]);
    assert.strictEqual(r.code, 0);
    assert.ok(r.out.indexOf('"Smith, Jane","a, b"') >= 0, 'commas inside cells stay quoted');
  });

  test('verify: --json is structured and lossless', () => {
    const f = write('wb2.md', TWO_TAB);
    const r = run([f, '--json']);
    assert.strictEqual(r.code, 0);
    const data = JSON.parse(r.out);
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.sheets.length, 2);
    assert.strictEqual(data.sheets[0].name, 'Expenses');
    assert.strictEqual(data.sheets[1].name, 'Summary');
    // last row of Summary is the cross-tab grand total
    const summary = data.sheets[1].values;
    assert.deepStrictEqual(summary[summary.length - 1], ['Grand Total', '4730']);
  });

  test('verify: exit 1 when any cell errors, with the cell located', () => {
    const f = write('bad.md', '```cells A\nx,=Nope!A1\n```\n');
    const r = run([f, '--json']);
    assert.strictEqual(r.code, 1, 'a cell error exits 1');
    const data = JSON.parse(r.out);
    assert.strictEqual(data.ok, false);
    assert.strictEqual(data.errors[0].code, '#REF!');
    assert.strictEqual(data.errors[0].cell, 'B1');
  });

  test('verify: --sheet scopes output to one tab', () => {
    const f = write('wb3.md', TWO_TAB);
    const r = run([f, '--sheet', 'Summary']);
    assert.strictEqual(r.code, 0);
    assert.ok(r.out.indexOf('# sheet: Summary') >= 0);
    assert.ok(r.out.indexOf('# sheet: Expenses') < 0, 'Expenses tab omitted');
  });

  test('verify: --sheet naming an absent tab exits 2 with a message', () => {
    const f = write('wb4.md', TWO_TAB);
    const r = run([f, '--sheet', 'Nope']);
    assert.strictEqual(r.code, 2);
    assert.ok(/no tab named/i.test(r.err), 'stderr explains the missing tab');
  });

  test('verify: --sheet exit code scopes to the named tab', () => {
    // Expenses is clean; Summary errors. --sheet Expenses should exit 0.
    const doc = [
      '```cells Expenses', 'A', '1', '```', '',
      '```cells Summary', '=Nope!A1', '```', '',
    ].join('\n');
    const f = write('scoped.md', doc);
    assert.strictEqual(run([f, '--sheet', 'Expenses']).code, 0, 'clean tab exits 0');
    assert.strictEqual(run([f, '--sheet', 'Summary']).code, 1, 'errored tab exits 1');
  });

  test('verify: reuses the {{file.csv}} transclude path (same as the browser)', () => {
    write('data.csv', 'Item,Qty\nLaptop,3\nMouse,5\n');
    const f = write('trans.md', '```cells Stock\n{{data.csv}}\n```\n');
    const r = run([f]);
    assert.strictEqual(r.code, 0);
    assert.ok(/Laptop,3/.test(r.out) && /Mouse,5/.test(r.out), 'baked CSV data appears');
  });

  test('verify: a bare .csv file verifies as Sheet1', () => {
    const f = write('plain.csv', 'x,y\n5,=A2*2\n');   // A2 = 5 -> 10
    const r = run([f]);
    assert.strictEqual(r.code, 0);
    assert.ok(r.out.indexOf('# sheet: Sheet1') >= 0);
    assert.ok(/5,10/.test(r.out), 'the .csv formula computed (5 * 2)');
  });

  test('verify: needs a file argument (exit 2)', () => {
    const r = run([]);
    assert.strictEqual(r.code, 2);
  });

  // Best-effort cleanup; the OS tmp dir is reclaimed regardless.
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
};
