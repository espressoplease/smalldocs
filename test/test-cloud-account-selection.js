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

  test('uses the person name for an individual account and the account name otherwise', () => {
    const user = { first_name: 'Ada', last_name: 'Lovelace' };
    assert.strictEqual(selection.label({ kind: 'personal', name: 'Personal' }, user), 'Ada Lovelace');
    assert.strictEqual(selection.label({ kind: 'team', name: 'Analytical Engines' }, user),
      'Analytical Engines');
    assert.strictEqual(selection.initials('Ada Lovelace'), 'AL');
  });
};
