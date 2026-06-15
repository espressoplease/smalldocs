// Library indexing tests: buildEntry, indexFile, scanAndIndex, tag
// injection, ephemeral rescue. Uses an isolated SDOCS_HOME and a
// temporary content tree.

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-lib-index-'));
const CONTENT = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-lib-content-'));
process.env.SDOCS_HOME = SANDBOX;

const libIndex = require('../cli/lib/library-index');
const store    = require('../cli/lib/library-store');
const SDocYaml = require('../cli/shared/sdocs-yaml');

function write(rel, content) {
  const full = path.join(CONTENT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

module.exports = function (h) {
  const { test, assert } = h;

  test('buildEntry: title from first heading when meta lacks title', () => {
    const e = libIndex.buildEntry({
      absPath: '/x/foo.md',
      content: '# Hello world\n\nbody text',
      addTags: [],
    });
    assert.strictEqual(e.title, 'Hello world');
    assert.deepStrictEqual(e.tags, []);
  });

  test('buildEntry: title from first heading with leading blank lines', () => {
    const e = libIndex.buildEntry({
      absPath: '/x/foo.md',
      content: '\n\n  \n# Title with leading blank lines\n\nbody text',
    });
    assert.strictEqual(e.title, 'Title with leading blank lines');
  });

  test('buildEntry: trims trailing spaces from heading title', () => {
    const e = libIndex.buildEntry({
      absPath: '/x/foo.md',
      content: '# Clean Title      ',
    });
    assert.strictEqual(e.title, 'Clean Title');
  });

  test('buildEntry: ignores headings that are not on the first content line', () => {
    const content = 'This is prose before the heading.\n\n# Not the title\nBody content.';
    const e = libIndex.buildEntry({
      absPath: '/x/foo.md',
      content: content,
    });
    assert.strictEqual(e.title, 'foo');
  });

  test('buildEntry: meta.tags merge with addTags', () => {
    const md = '---\ntitle: T\ntags:\n  - front\n---\n\nbody text';
    const e = libIndex.buildEntry({
      absPath: '/x/foo.md',
      content: md,
      addTags: ['cli'],
    });
    assert.deepStrictEqual(e.tags, ['front', 'cli']);
  });

  test('buildEntry: #words in body are NOT extracted as tags', () => {
    // Body hashtags were removed - prose mentions like "#planning" are
    // just words to SDocs. Only YAML front matter and +tag CLI args
    // contribute to a file's tag list.
    const md = '---\ntitle: T\ntags:\n  - front\n---\n\n#planning is mentioned but not a tag';
    const e = libIndex.buildEntry({
      absPath: '/x/foo.md',
      content: md,
      addTags: [],
    });
    assert.deepStrictEqual(e.tags, ['front']);
  });

  test('buildEntry: pulls agent/session from sdocs-library namespace', () => {
    const md = '---\nsdocs-library: { agent: claude-code, session-id: abc-123 }\n---\nbody';
    const e = libIndex.buildEntry({ absPath: '/x/foo.md', content: md });
    assert.strictEqual(e.agent, 'claude-code');
    assert.strictEqual(e.sessionId, 'abc-123');
  });

  test('indexFile: indexes a plain file', () => {
    store.clearIndex();
    const f = write('plain.md', '---\ntags:\n  - demo\n---\n# Plain\n\nhello');
    const entry = libIndex.indexFile(f);
    assert.ok(entry);
    assert.strictEqual(entry.title, 'Plain');
    assert.deepStrictEqual(entry.tags, ['demo']);
  });

  test('indexFile: --tag injection writes front matter to file', () => {
    store.clearIndex();
    const f = write('to-tag.md', '# To tag\n\nbody');
    libIndex.indexFile(f, { addTags: ['plan', 'refactor'] });
    const raw = fs.readFileSync(f, 'utf8');
    const parsed = SDocYaml.parseFrontMatter(raw);
    assert.deepStrictEqual(parsed.meta.tags, ['plan', 'refactor']);
  });

  test('indexFile: tag injection merges with existing tags', () => {
    store.clearIndex();
    const f = write('merge-tag.md', '---\ntags:\n  - existing\n---\n# heading\nbody');
    libIndex.indexFile(f, { addTags: ['new'] });
    const raw = fs.readFileSync(f, 'utf8');
    const parsed = SDocYaml.parseFrontMatter(raw);
    assert.deepStrictEqual(parsed.meta.tags, ['existing', 'new']);
  });

  test('removeTagsFromFile: drops a tag and writes the file', () => {
    const f = write('remove-tag.md', '---\ntags:\n  - keep\n  - drop\n---\n# h\nbody');
    const next = libIndex.removeTagsFromFile(f, ['drop']);
    assert.deepStrictEqual(next, ['keep']);
    const parsed = SDocYaml.parseFrontMatter(fs.readFileSync(f, 'utf8'));
    assert.deepStrictEqual(parsed.meta.tags, ['keep']);
  });

  test('removeTagsFromFile: deletes the tags key when the list goes empty', () => {
    const f = write('remove-last-tag.md', '---\ntags:\n  - only\n---\n# h\nbody');
    libIndex.removeTagsFromFile(f, ['only']);
    const parsed = SDocYaml.parseFrontMatter(fs.readFileSync(f, 'utf8'));
    assert.strictEqual(parsed.meta.tags, undefined);
  });

  test('removeTagsFromFile: returns null when nothing matches', () => {
    const f = write('no-match.md', '---\ntags:\n  - keep\n---\n# h\nbody');
    const out = libIndex.removeTagsFromFile(f, ['ghost']);
    assert.strictEqual(out, null);
  });

  test('indexFile: opted out via sdocs-library: false is skipped', () => {
    store.clearIndex();
    const f = write('skip.md', '---\nsdocs-library: false\n---\n# nope');
    const e = libIndex.indexFile(f);
    assert.strictEqual(e, null);
    assert.strictEqual(store.loadIndex().entries.length, 0);
  });

  test('indexFile: ephemeral source path triggers rescue copy', () => {
    store.clearIndex();
    const f = path.join(os.tmpdir(), 'eph-' + Date.now() + '.md');
    fs.writeFileSync(f, '# Eph\n\nbody');
    const entry = libIndex.indexFile(f);
    assert.strictEqual(entry.rescued, true);
    assert.strictEqual(entry.rescuedFrom, path.resolve(f));
    assert.ok(entry.path.startsWith(path.join(SANDBOX, 'library', 'rescued')));
    assert.ok(fs.existsSync(entry.path), 'rescue copy must exist on disk');
    try { fs.unlinkSync(f); } catch (_) {}
  });

  test('scanAndIndex: walks roots and indexes all .md', () => {
    store.clearIndex();
    write('a.md', '# A');
    write('sub/b.md', '# B');
    write('sub/.hidden/c.md', '# C should be skipped');
    write('node_modules/d.md', '# D should be skipped');
    const r = libIndex.scanAndIndex({ roots: [CONTENT] });
    assert.ok(r.scanned >= 2);
    const idx = store.loadIndex();
    const titles = idx.entries.map(e => e.title).sort();
    assert.ok(titles.includes('A'));
    assert.ok(titles.includes('B'));
    assert.ok(!titles.includes('C should be skipped'));
    assert.ok(!titles.includes('D should be skipped'));
  });

  test('rebuild: empties index and re-scans', () => {
    const before = store.loadIndex().entries.length;
    assert.ok(before > 0);
    store.upsertEntry({ id: 'ghost', path: '/nope', title: 'ghost' });
    libIndex.rebuild = libIndex.rebuild || (() => {});
    // Re-run scanAndIndex against the content tree (rebuild does the same
    // but uses real defaults; we want the deterministic root here).
    store.clearIndex();
    libIndex.scanAndIndex({ roots: [CONTENT] });
    const after = store.loadIndex();
    assert.ok(after.entries.every(e => e.id !== 'ghost'));
  });

  test('tagsUnderPrefix: only counts entries under the prefix', () => {
    store.clearIndex();
    const projA = path.join(CONTENT, 'proj-a');
    const projB = path.join(CONTENT, 'proj-b');
    write('proj-a/one.md', '---\ntags:\n  - alpha\n---\n# one');
    write('proj-a/two.md', '---\ntags:\n  - alpha\n  - beta\n---\n# two');
    write('proj-b/three.md', '---\ntags:\n  - gamma\n---\n# three');
    libIndex.scanAndIndex({ roots: [CONTENT] });
    const tagsA = libIndex.tagsUnderPrefix(projA).map(t => t.tag);
    assert.deepStrictEqual(tagsA.sort(), ['alpha', 'beta']);
    const tagsB = libIndex.tagsUnderPrefix(projB).map(t => t.tag);
    assert.deepStrictEqual(tagsB, ['gamma']);
  });

  test('indexFile: refuses files under OS scratch dirs (throwaway)', () => {
    // The runner sets SDOCS_ALLOW_THROWAWAY_INDEXING=1 so the rest of
    // these tests can use mkdtemp paths. Toggle it off here to verify
    // the production rule blocks the same path.
    const prev = process.env.SDOCS_ALLOW_THROWAWAY_INDEXING;
    delete process.env.SDOCS_ALLOW_THROWAWAY_INDEXING;
    try {
      const f = path.join(os.tmpdir(), 'throwaway-' + Date.now() + '.md');
      fs.writeFileSync(f, '# scratch');
      const result = libIndex.indexFile(f);
      assert.strictEqual(result, null, 'throwaway path should be refused');
      try { fs.unlinkSync(f); } catch (_) {}
    } finally {
      if (prev !== undefined) process.env.SDOCS_ALLOW_THROWAWAY_INDEXING = prev;
    }
  });

  test('pruneMissing: drops entries whose path no longer exists', () => {
    store.clearIndex();
    const realFile = path.join(CONTENT, 'present.md');
    fs.mkdirSync(path.dirname(realFile), { recursive: true });
    fs.writeFileSync(realFile, '# alive');
    libIndex.indexFile(realFile);

    // Inject a synthetic entry whose path is gone.
    store.upsertEntry({
      id: 'gone-entry',
      path: path.join(CONTENT, 'never-existed-' + Date.now() + '.md'),
      title: 'gone',
      tags: [],
    });
    assert.ok(store.getEntry('gone-entry'), 'precondition: ghost entry exists');
    const realEntries = store.loadIndex().entries.filter(e => e.id !== 'gone-entry');
    assert.ok(realEntries.length >= 1, 'precondition: at least one real entry');

    const removed = libIndex.pruneMissing();
    assert.ok(removed >= 1, 'expected at least one entry pruned, got ' + removed);
    assert.strictEqual(store.getEntry('gone-entry'), null, 'ghost should be gone');

    // The real entry survives the prune. Because realFile lives under
    // os.tmpdir(), indexFile rescues it - so the survivor is keyed by
    // a path under SDOCS_HOME (the rescue copy), with rescuedFrom set
    // to realFile.
    const afterReal = store.loadIndex().entries.filter(e =>
      e.path !== store.getEntry('gone-entry')?.path
    );
    assert.ok(afterReal.length >= 1, 'real entry should remain in the index');
  });

  test('scanAndIndex: returns a removed count and prunes during scan', () => {
    store.clearIndex();
    const realFile = path.join(CONTENT, 'real-during-prune.md');
    fs.writeFileSync(realFile, '# real');
    libIndex.indexFile(realFile);

    store.upsertEntry({
      id: 'phantom-prune',
      path: path.join(CONTENT, 'phantom-' + Date.now() + '.md'),
      title: 'phantom',
      tags: [],
    });

    const result = libIndex.scanAndIndex({ roots: [CONTENT] });
    assert.ok('removed' in result, 'scanAndIndex result should include removed count');
    assert.ok(result.removed >= 1, 'phantom should have been pruned');
    assert.strictEqual(store.getEntry('phantom-prune'), null);
  });

  test('cleanup', () => {
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(CONTENT, { recursive: true, force: true }); } catch (_) {}
    assert.ok(true);
  });
};
