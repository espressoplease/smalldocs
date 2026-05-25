// Library store + index unit tests. Runs in a sandbox SDOCS_HOME so
// real state is never touched.

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-lib-store-'));
process.env.SDOCS_HOME = SANDBOX;

const store = require('../cli/lib/library-store');

function sample(id, overrides) {
  return Object.assign({
    id,
    path: '/abs/' + id + '.md',
    title: 'Title ' + id,
    tags: ['plan'],
    mtime: new Date().toISOString(),
  }, overrides || {});
}

module.exports = function (h) {
  const { test, assert } = h;

  test('store: loadIndex defaults to empty', () => {
    store.clearIndex();
    const idx = store.loadIndex();
    assert.deepStrictEqual(idx.entries, []);
  });

  test('store: upsert then get', () => {
    store.clearIndex();
    const e = store.upsertEntry(sample('aaa'));
    assert.strictEqual(e.id, 'aaa');
    const g = store.getEntry('aaa');
    assert.strictEqual(g.title, 'Title aaa');
  });

  test('store: upsert merges, does not duplicate', () => {
    store.clearIndex();
    store.upsertEntry(sample('bbb', { title: 'old' }));
    store.upsertEntry(sample('bbb', { title: 'new' }));
    const idx = store.loadIndex();
    assert.strictEqual(idx.entries.length, 1);
    assert.strictEqual(idx.entries[0].title, 'new');
  });

  test('store: firstSeen is preserved across upserts', () => {
    store.clearIndex();
    store.upsertEntry(sample('ccc'));
    const seen = store.getEntry('ccc').firstSeen;
    store.upsertEntry(sample('ccc', { title: 'changed' }));
    assert.strictEqual(store.getEntry('ccc').firstSeen, seen);
  });

  test('store: removeEntry actually removes', () => {
    store.clearIndex();
    store.upsertEntry(sample('ddd'));
    const removed = store.removeEntry('ddd');
    assert.strictEqual(removed, 1);
    assert.strictEqual(store.getEntry('ddd'), null);
  });

  test('store: setStar updates the flag', () => {
    store.clearIndex();
    store.upsertEntry(sample('eee'));
    const ok = store.setStar('eee', true);
    assert.strictEqual(ok, true);
    assert.strictEqual(store.getEntry('eee').starred, true);
  });

  test('state: enabled defaults to true', () => {
    const s = store.loadState();
    assert.strictEqual(s.enabled, true);
  });

  test('state: saveState round-trips', () => {
    store.saveState({ enabled: false, lastScanAt: 123 });
    const s = store.loadState();
    assert.strictEqual(s.enabled, false);
    assert.strictEqual(s.lastScanAt, 123);
    store.saveState({ enabled: true, lastScanAt: 0 });
  });

  test('idForPath: stable, short', () => {
    const a = store.idForPath('/abs/foo.md');
    const b = store.idForPath('/abs/foo.md');
    const c = store.idForPath('/abs/bar.md');
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, c);
    assert.strictEqual(a.length, 10);
  });

  test('atomic write: index file ends up valid after a save', () => {
    store.clearIndex();
    store.upsertEntry(sample('fff'));
    const raw = fs.readFileSync(path.join(SANDBOX, 'library-index.json'), 'utf8');
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.entries.length, 1);
  });

  test('cleanup', () => {
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {}
    assert.ok(true);
  });
};
