/**
 * file-wrap tests - the shared "file contents -> renderable document"
 * dispatch. Used by readContent (the URL-snapshot path) AND the bridge (the
 * live-sync path), so a .csv / .mmd / .rb opened either way renders as its
 * fenced block, not as raw text.
 */

module.exports = function(harness) {
  const { assert, test } = harness;

  console.log('\n── File Wrap Tests ────────────────────────────\n');

  const { wrapForDisplay, isWrappedFile } = require('../cli/lib/file-wrap');

  test('isWrappedFile: csv / mmd / mermaid are wrapped types; md is not', () => {
    assert.strictEqual(isWrappedFile('report.csv'), true);
    assert.strictEqual(isWrappedFile('/a/b/REPORT.CSV'), true);
    assert.strictEqual(isWrappedFile('graph.mmd'), true);
    assert.strictEqual(isWrappedFile('graph.mermaid'), true);
    assert.strictEqual(isWrappedFile('doc.md'), false);
    assert.strictEqual(isWrappedFile(''), false);
    assert.strictEqual(isWrappedFile(null), false);
  });

  test('isWrappedFile: source files are wrapped types too', () => {
    assert.strictEqual(isWrappedFile('app.rb'), true);
    assert.strictEqual(isWrappedFile('/src/server.js'), true);
    assert.strictEqual(isWrappedFile('main.go'), true);
    assert.strictEqual(isWrappedFile('README.md'), false, 'markdown still opens as a doc');
    assert.strictEqual(isWrappedFile('notes.txt'), false, 'plain text still opens as a doc');
  });

  test('wrapForDisplay: a source file lands inside a language fence', () => {
    const out = wrapForDisplay('def hi\n  1\nend\n', '/x/app.rb');
    assert.strictEqual(out, '```ruby\ndef hi\n  1\nend\n```\n');
  });

  test('wrapForDisplay: extension picks the highlight.js language label', () => {
    assert.ok(wrapForDisplay('x=1', 'a.py').startsWith('```python\n'));
    assert.ok(wrapForDisplay('x=1', 'a.ts').startsWith('```typescript\n'));
    assert.ok(wrapForDisplay('x=1', 'a.tsx').startsWith('```typescript\n'));
  });

  test('wrapForDisplay: csv content lands inside a cells fence', () => {
    const out = wrapForDisplay('a,b\n1,2\n', '/tmp/report.csv');
    assert.ok(out.startsWith('```cells\nsdoc-cells: source=report.csv\n'));
    assert.ok(out.includes('a,b\n1,2'));
  });

  test('wrapForDisplay: mermaid content lands inside a mermaid fence', () => {
    const out = wrapForDisplay('graph TD\nA-->B\n', 'flow.mmd');
    assert.strictEqual(out, '```mermaid\ngraph TD\nA-->B\n```\n');
  });

  test('wrapForDisplay: markdown passes through untouched', () => {
    assert.strictEqual(wrapForDisplay('# hi\n', 'doc.md'), '# hi\n');
  });
};
