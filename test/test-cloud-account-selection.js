const selection = require('../public/sdocs-cloud-account-selection');

function storage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

module.exports = function(harness) {
  const { assert, test } = harness;

  console.log('\n-- Cloud Account Selection Tests ----------------------\n');

  test('resolves and remembers the only account', () => {
    const store = storage();
    const account = { id: 'one', name: 'Cloud' };
    assert.strictEqual(selection.resolve([account], null, store), account);
    assert.strictEqual(selection.storedId(store), 'one');
  });

  test('requires a deliberate choice when several accounts have no stored selection', () => {
    const accounts = [{ id: 'one' }, { id: 'two' }];
    assert.strictEqual(selection.resolve(accounts, null, storage()), null);
  });

  test('explicit selection replaces a stored account and stale selections are cleared', () => {
    const store = storage({ [selection.STORAGE_KEY]: 'old' });
    const accounts = [{ id: 'one' }, { id: 'two' }];
    assert.strictEqual(selection.resolve(accounts, 'two', store), accounts[1]);
    assert.strictEqual(selection.storedId(store), 'two');
    assert.strictEqual(selection.resolve([{ id: 'one' }], null, store).id, 'one');
    assert.strictEqual(selection.storedId(store), 'one');
  });

  test('labels Personal distinctly from named team libraries and shares library icons', () => {
    const user = { first_name: 'Ada', last_name: 'Lovelace' };
    assert.strictEqual(selection.label({ kind: 'personal', name: 'Ada Lovelace' }, user), 'Personal');
    assert.strictEqual(selection.label({ kind: 'team', name: 'Analytical Engines' }, user),
      'Analytical Engines');
    assert.strictEqual(selection.initials('Ada Lovelace'), 'AL');
    assert.ok(selection.icon('personal').includes('data-library-kind="personal"'));
    assert.ok(selection.icon('team').includes('data-library-kind="team"'));
    const libraries = [{ id: 'team', kind: 'team' }, { id: 'personal', kind: 'personal' }];
    assert.deepStrictEqual(selection.orderedLibraries(libraries).map(library => library.id), ['personal', 'team']);
    assert.strictEqual(libraries[0].id, 'team');
  });

  test('people colours depend only on identity and keep the current person neutral', () => {
    const ids = ['a', 'g', 'm', 's', 'y', 'A', 'G', 'M'];
    assert.notStrictEqual(selection.color('a'), selection.color('g'));
    assert.strictEqual(new Set(ids.map(id => selection.color(id))).size, ids.length);
    assert.strictEqual(selection.color('library-one'), selection.color('library-one'));
    const colors = ids.map(id => selection.personColor(id, false));
    assert.strictEqual(new Set(colors).size, ids.length);
    for (const id of ids) {
      assert.strictEqual(selection.personColor(id), selection.personColor(id, false));
      assert.strictEqual(selection.personColor(id, true), null);
    }
    assert.strictEqual(selection.personColor(null), null);
  });
};
