// Tests for `sdoc library ls` and `sdoc library ls --tags`.
//
// Runs in a sandbox SDOCS_HOME so the real index is never touched.
// Captures console.log to assert on the exact output shape (preamble
// line, entries / tag rows, closing count line) - the format is part
// of the contract agents read.

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-lib-ls-'));
process.env.SDOCS_HOME = SANDBOX;

const store = require('../cli/lib/library-store');
const libIndex = require('../cli/lib/library-index');
const libCmds = require('../cli/lib/library-commands');

function captureLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { fn(); }
  finally { console.log = original; }
  return lines;
}

function seedEntry(absPath, content) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content);
  return libIndex.indexFile(absPath);
}

module.exports = function (h) {
  const { test, assert } = h;

  test('library ls: empty index prints scope + hint', () => {
    store.clearIndex();
    const lines = captureLog(() => libCmds.libraryLs({ extra: SANDBOX }));
    assert.ok(lines[0].startsWith('library has no markdown indexed under '),
      'preamble should announce empty state with scope');
    assert.ok(lines[0].includes(SANDBOX), 'scope path appears in preamble');
    assert.ok(lines.some(l => l.includes('sdoc library rebuild')),
      'hint mentions rebuild');
  });

  test('library ls: lists files with tags inline and closing count', () => {
    store.clearIndex();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-ls-root-'));
    seedEntry(path.join(root, 'plan.md'),
      '---\ntags:\n  - planning\n  - q2\n---\n# Plan\n');
    seedEntry(path.join(root, 'notes', 'meeting.md'),
      '---\ntags:\n  - meeting\n---\n# Meeting\n');
    seedEntry(path.join(root, 'untagged.md'), '# Untagged\n');

    const lines = captureLog(() => libCmds.libraryLs({ extra: root }));
    assert.ok(lines[0].startsWith('library files for '),
      'preamble starts with explicit scope statement');
    assert.ok(lines[0].includes(root), 'preamble names the scope path');

    const body = lines.slice(1, -1).join('\n');
    assert.ok(body.includes('plan.md'), 'file appears');
    assert.ok(body.includes('[planning, q2]'), 'tags appear inline');
    assert.ok(body.includes(path.join('notes', 'meeting.md')),
      'nested files appear with relative path');
    assert.ok(body.includes('[meeting]'), 'nested file tags appear');
    assert.ok(body.includes('untagged.md'), 'untagged file appears');
    assert.ok(body.includes('[no tags]'), 'untagged files show [no tags]');

    const last = lines[lines.length - 1];
    assert.strictEqual(last, '(3 files)');

    fs.rmSync(root, { recursive: true, force: true });
  });

  test('library ls: explicit path arg overrides scope', () => {
    store.clearIndex();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-ls-root-'));
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-ls-other-'));
    seedEntry(path.join(root, 'a.md'), '# A\n');
    seedEntry(path.join(other, 'b.md'), '# B\n');

    const linesA = captureLog(() => libCmds.libraryLs({ extra: root }));
    const bodyA = linesA.slice(1, -1).join('\n');
    assert.ok(bodyA.includes('a.md'));
    assert.ok(!bodyA.includes('b.md'), 'other-root file not listed under root scope');

    const linesB = captureLog(() => libCmds.libraryLs({ extra: other }));
    const bodyB = linesB.slice(1, -1).join('\n');
    assert.ok(bodyB.includes('b.md'));
    assert.ok(!bodyB.includes('a.md'));

    fs.rmSync(root,  { recursive: true, force: true });
    fs.rmSync(other, { recursive: true, force: true });
  });

  test('library ls: file count line matches grammar (1 file / N files)', () => {
    store.clearIndex();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-ls-grammar-'));
    seedEntry(path.join(root, 'only.md'), '# Only\n');
    const lines = captureLog(() => libCmds.libraryLs({ extra: root }));
    assert.strictEqual(lines[lines.length - 1], '(1 file)');
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('library ls --tags: empty case', () => {
    store.clearIndex();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-ls-tagless-'));
    seedEntry(path.join(root, 'a.md'), '# Just a file\n');
    const lines = captureLog(() => libCmds.libraryLs({ extra: root, tagsFlag: true }));
    assert.ok(lines[0].startsWith('no tagged markdown files indexed under '),
      'preamble announces tagless state');
    assert.ok(lines[0].includes(root), 'scope appears in preamble');
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('library ls --tags: prints tag - count, sorted by frequency, with closing count', () => {
    store.clearIndex();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-ls-tags-'));
    seedEntry(path.join(root, 'a.md'), '---\ntags:\n  - docs\n  - intro\n---\n# A\n');
    seedEntry(path.join(root, 'b.md'), '---\ntags:\n  - docs\n---\n# B\n');
    seedEntry(path.join(root, 'c.md'), '---\ntags:\n  - docs\n  - intro\n---\n# C\n');
    seedEntry(path.join(root, 'd.md'), '---\ntags:\n  - rare\n---\n# D\n');

    const lines = captureLog(() => libCmds.libraryLs({ extra: root, tagsFlag: true }));
    assert.ok(lines[0].startsWith('most frequent tags for tagged markdown files under '),
      'preamble matches the agent-readable format');
    assert.ok(lines[0].includes('(tag - count)'),
      'preamble names the column format');

    // Lines 1..N-1 are the tag rows. docs (3) should come before intro (2)
    // which comes before rare (1).
    const tagRows = lines.slice(1, -1);
    assert.strictEqual(tagRows[0], '  docs - 3');
    assert.strictEqual(tagRows[1], '  intro - 2');
    assert.strictEqual(tagRows[2], '  rare - 1');

    const last = lines[lines.length - 1];
    assert.strictEqual(last, '(3 distinct tags across 4 tagged files)');

    fs.rmSync(root, { recursive: true, force: true });
  });

  test('library ls: walks up to .git root when no path given', () => {
    store.clearIndex();
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-ls-repo-'));
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    const nested = path.join(repo, 'docs', 'plans');
    fs.mkdirSync(nested, { recursive: true });
    seedEntry(path.join(repo, 'top.md'), '# Top\n');
    seedEntry(path.join(nested, 'deep.md'), '# Deep\n');

    // Process cwd = deeply nested dir. resolveLsScope should walk up
    // to the .git root and list both files.
    const cwd = process.cwd();
    try {
      process.chdir(nested);
      const lines = captureLog(() => libCmds.libraryLs({}));
      assert.ok(lines[0].includes(fs.realpathSync(repo)),
        'scope preamble names the realpath of the repo root');
      const body = lines.slice(1, -1).join('\n');
      assert.ok(body.includes('top.md'), 'top-level file appears');
      assert.ok(body.includes(path.join('docs', 'plans', 'deep.md')),
        'nested file appears with path relative to repo root');
    } finally {
      process.chdir(cwd);
    }
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('library ls: rescued entries are listed by their original path', () => {
    store.clearIndex();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-ls-rescued-'));
    // Insert an entry directly so we can fake the rescued state without
    // depending on the ephemeral detection logic (which differs by OS).
    store.upsertEntry({
      id: 'rescued-1',
      path: '/rescued/elsewhere/abc-foo.md',  // would be ~/.sdocs/library/rescued/...
      rescued: true,
      rescuedFrom: path.join(root, 'foo.md'),
      title: 'Foo',
      tags: ['rescue'],
      mtime: new Date().toISOString(),
    });
    const lines = captureLog(() => libCmds.libraryLs({ extra: root }));
    const body = lines.slice(1, -1).join('\n');
    assert.ok(body.includes('foo.md'),
      'rescued entry is listed under its original path, not the rescue copy path');
    fs.rmSync(root, { recursive: true, force: true });
  });
};
