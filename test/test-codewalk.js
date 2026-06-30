/**
 * Code walkthrough tests:
 *  - parseArgs: multi-file collection + per-file annotation binding
 *  - readCodewalkContent: N files -> one tabbed body + basename tab list
 *  - sdocs-codewalk model: build() ordering, grouping, validation
 *  - YAML round-trip of the codewalk front matter
 */
const fs   = require('fs');
const os   = require('os');
const path = require('path');

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Code Walkthrough Tests ─────────────────────\n');

  const cli = require(path.join(__dirname, '..', 'cli', 'bin', 'sdocs-dev.js'));
  const SDocYaml = require(path.join(__dirname, '..', 'cli', 'shared', 'sdocs-yaml.js'));
  const { readCodewalkContent } = require(path.join(__dirname, '..', 'cli', 'lib', 'io.js'));
  const CW = require(path.join(__dirname, '..', 'public', 'sdocs-codewalk.js'));
  const { parseArgs } = cli;

  // ── parseArgs ───────────────────────────────────────

  test('parseArgs: single code file is unchanged (file set, one tab, bound annotation)', () => {
    const o = parseArgs(['app.py', '9:hello']);
    assert.strictEqual(o.file, 'app.py');
    assert.deepStrictEqual(o.files, ['app.py']);
    assert.deepStrictEqual(o.annotations, [{ line: 9, endLine: 9, text: 'hello', file: 'app.py' }]);
  });

  test('parseArgs: interleaved files bind annotations to the cursor file in order', () => {
    const o = parseArgs(['file1.py', '4:a', 'file2.py', '13:b', 'file1.py', '20:c']);
    // Files are kept in raw command order (dedup happens at read time).
    assert.deepStrictEqual(o.files, ['file1.py', 'file2.py', 'file1.py']);
    assert.strictEqual(o.file, 'file1.py');
    assert.deepStrictEqual(o.annotations.map(a => [a.file, a.line, a.text]), [
      ['file1.py', 4, 'a'],
      ['file2.py', 13, 'b'],
      ['file1.py', 20, 'c'],
    ]);
  });

  test('parseArgs: range annotation binds and keeps endLine', () => {
    const o = parseArgs(['a.py', '10-12:block']);
    assert.deepStrictEqual(o.annotations, [{ line: 10, endLine: 12, text: 'block', file: 'a.py' }]);
  });

  test('parseArgs: annotation before any file has null file binding', () => {
    const o = parseArgs(['4:early', 'a.py']);
    assert.strictEqual(o.annotations[0].file, null);
    assert.deepStrictEqual(o.files, ['a.py']);
  });

  test('parseArgs: non-code positionals never become walkthrough files', () => {
    const md = parseArgs(['notes.md']);
    assert.deepStrictEqual(md.files, []);
    assert.strictEqual(md.file, 'notes.md');
  });

  test('parseArgs: subcommand sub-args are not collected as files', () => {
    const o = parseArgs(['slides', 'icons', 'heart']);
    assert.strictEqual(o.subcommand, 'slides');
    assert.strictEqual(o.file, 'icons');
    assert.strictEqual(o.extra, 'heart');
    assert.deepStrictEqual(o.files, []);
  });

  // ── readCodewalkContent ─────────────────────────────

  test('readCodewalkContent: wraps each unique file in a labelled fence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.py'), 'print(1)\n');
      fs.writeFileSync(path.join(dir, 'b.rb'), 'puts 2\n');
      const { body, files } = readCodewalkContent([
        path.join(dir, 'a.py'),
        path.join(dir, 'b.rb'),
        path.join(dir, 'a.py'), // referenced twice -> one tab
      ]);
      assert.deepStrictEqual(files, ['a.py', 'b.rb']);
      assert.ok(body.includes('```python a.py\nprint(1)\n```'));
      assert.ok(body.includes('```ruby b.rb\nputs 2\n```'));
      // a.py appears once despite being passed twice.
      assert.strictEqual(body.split('```python a.py').length - 1, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── model: build() ──────────────────────────────────

  test('build: steps follow annotation order, tabs follow files order', () => {
    const m = CW.build({
      files: ['app.py', 'util.py'],
      annotations: [
        { file: 'app.py', line: 4, text: 'start' },
        { file: 'util.py', line: 13, text: 'then' },
        { file: 'app.py', line: 20, text: 'back' },
      ],
    });
    assert.deepStrictEqual(m.files, ['app.py', 'util.py']);
    assert.strictEqual(m.total, 3);
    assert.deepStrictEqual(m.steps.map(s => [s.file, s.line, s.index]), [
      ['app.py', 4, 0], ['util.py', 13, 1], ['app.py', 20, 2],
    ]);
    // byFile groups each tab's steps, preserving the global step objects.
    assert.deepStrictEqual(m.byFile['app.py'].map(s => s.index), [0, 2]);
    assert.deepStrictEqual(m.byFile['util.py'].map(s => s.index), [1]);
  });

  test('build: endLine coerced, invalid line / empty text dropped', () => {
    const m = CW.build({
      files: ['a.py'],
      annotations: [
        { file: 'a.py', line: 0, text: 'bad line' },
        { file: 'a.py', line: 5, text: '   ' },
        { file: 'a.py', line: 7, endLine: 3, text: 'end<start' },
        { file: 'a.py', line: 9, endLine: 11, text: 'good' },
      ],
    });
    assert.strictEqual(m.total, 2);
    assert.deepStrictEqual(m.steps[0], { file: 'a.py', line: 7, endLine: 7, text: 'end<start', index: 0 });
    assert.deepStrictEqual(m.steps[1], { file: 'a.py', line: 9, endLine: 11, text: 'good', index: 1 });
  });

  test('build: unbound annotation falls back to the first tab', () => {
    const m = CW.build({ files: ['x.py', 'y.py'], annotations: [{ line: 2, text: 'hi' }] });
    assert.strictEqual(m.steps[0].file, 'x.py');
  });

  test('build: annotation naming an undeclared tab is dropped', () => {
    const m = CW.build({ files: ['x.py'], annotations: [{ file: 'ghost.py', line: 2, text: 'hi' }] });
    assert.strictEqual(m.total, 0);
  });

  test('build: tabs derived from steps when files are absent', () => {
    const m = CW.build({
      annotations: [
        { file: 'b.py', line: 1, text: 'one' },
        { file: 'a.py', line: 2, text: 'two' },
        { file: 'b.py', line: 3, text: 'three' },
      ],
    });
    assert.deepStrictEqual(m.files, ['b.py', 'a.py']); // first-seen order
    assert.strictEqual(m.total, 3);
  });

  test('build: caps steps and tabs', () => {
    const anns = [];
    for (let i = 0; i < CW.MAX_STEPS + 50; i++) anns.push({ file: 'a.py', line: i + 1, text: 't' });
    const m = CW.build({ files: ['a.py'], annotations: anns });
    assert.strictEqual(m.total, CW.MAX_STEPS);
  });

  test('clamp: holds at the ends, -1 when empty', () => {
    assert.strictEqual(CW.clamp(-3, 5), 0);
    assert.strictEqual(CW.clamp(9, 5), 4);
    assert.strictEqual(CW.clamp(2, 5), 2);
    assert.strictEqual(CW.clamp(0, 0), -1);
  });

  test('isCodewalk: accepts true and truthy string spellings', () => {
    assert.strictEqual(CW.isCodewalk({ codewalk: true }), true);
    assert.strictEqual(CW.isCodewalk({ codewalk: 'true' }), true); // YAML parser yields the string
    assert.strictEqual(CW.isCodewalk({ codewalk: 'yes' }), true);
    assert.strictEqual(CW.isCodewalk({}), false);
    assert.strictEqual(CW.isCodewalk({ codewalk: 'false' }), false);
  });

  // ── YAML round-trip ─────────────────────────────────

  test('codewalk front matter round-trips through the YAML serializer', () => {
    const meta = {
      codewalk: true,
      files: ['app.py', 'util.py'],
      annotations: [
        { file: 'app.py', line: 4, endLine: 4, text: 'we start here' },
        { file: 'util.py', line: 13, endLine: 13, text: 'then X' },
      ],
    };
    const text = SDocYaml.serializeFrontMatter(meta) + '\nbody';
    const parsed = SDocYaml.parseFrontMatter(text);
    assert.ok(CW.isCodewalk(parsed.meta));
    assert.deepStrictEqual(parsed.meta.files, ['app.py', 'util.py']);
    assert.deepStrictEqual(parsed.meta.annotations, meta.annotations);
    // And the model reads the reparsed front matter cleanly.
    const m = CW.build(parsed.meta);
    assert.strictEqual(m.total, 2);
    assert.deepStrictEqual(m.files, ['app.py', 'util.py']);
  });
};
