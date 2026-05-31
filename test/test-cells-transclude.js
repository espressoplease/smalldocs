/**
 * CLI cells transclusion tests - baking {{file.csv}} references into the doc.
 */

module.exports = function(harness) {
  const { assert, test } = harness;

  console.log('\n── Cells Transclude Tests ─────────────────────\n');

  const { transcludeCells, wrapCsvFile } = require('../cli/lib/cells-transclude');

  // Injectable reader: a path->contents map; missing keys throw like fs would.
  const reader = (map) => (p) => {
    if (map[p] == null) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
    return map[p];
  };

  test('bakes a {{file.csv}} reference into data + source label', () => {
    const content = '# Doc\n\n```cells\n{{report.csv}}\n```\n';
    const out = transcludeCells(content, '/base', reader({ '/base/report.csv': 'a,b\n1,2\n' }));
    assert.ok(out.includes('sdoc-cells: source=report.csv'), 'has source label');
    assert.ok(out.includes('a,b\n1,2'), 'has the csv data');
    assert.ok(!out.includes('{{report.csv}}'), 'reference replaced');
  });

  test('records only the basename (no directory leak)', () => {
    const out = transcludeCells('```cells\n{{data/sub/report.csv}}\n```', '/base',
      reader({ '/base/data/sub/report.csv': 'x\n1' }));
    assert.ok(out.includes('source=report.csv'));
    assert.ok(!out.includes('data/sub'), 'path not leaked into the doc');
  });

  test('missing file bakes an error directive', () => {
    const out = transcludeCells('```cells\n{{nope.csv}}\n```', '/base', reader({}));
    assert.ok(/sdoc-cells: error=/.test(out));
    assert.ok(out.includes('Could not read nope.csv'));
  });

  test('leaves inline-data cells blocks untouched', () => {
    const content = '```cells\na,b\n1,2\n```';
    assert.strictEqual(transcludeCells(content, '/base', reader({})), content);
  });

  test('leaves docs with no cells blocks untouched', () => {
    const content = '# Hello\n\nJust prose.\n';
    assert.strictEqual(transcludeCells(content, '/base', reader({})), content);
  });

  test('strips a :range suffix off the path and records it', () => {
    const out = transcludeCells('```cells\n{{report.csv:B5:J32}}\n```', '/base',
      reader({ '/base/report.csv': 'a\n1' }));
    assert.ok(out.includes('source=report.csv'));
    assert.ok(out.includes('range=B5:J32'));
  });

  test('bakes multiple references in one document', () => {
    const content = '```cells\n{{a.csv}}\n```\n\ntext\n\n```cells\n{{b.csv}}\n```';
    const out = transcludeCells(content, '/base', reader({ '/base/a.csv': '1', '/base/b.csv': '2' }));
    assert.ok(out.includes('source=a.csv'));
    assert.ok(out.includes('source=b.csv'));
  });

  test('wrapCsvFile wraps a standalone csv with a source label', () => {
    const out = wrapCsvFile('a,b\n1,2\n', '/x/y/data.csv');
    assert.ok(out.startsWith('```cells\nsdoc-cells: source=data.csv\n'));
    assert.ok(out.includes('a,b\n1,2'));
    assert.ok(out.trimEnd().endsWith('```'));
  });
};
