/**
 * Document-source registry tests.
 *
 * The registry is a browser-only module that hangs methods off
 * window.SDocs. To test it in Node we fake a window, eval the script,
 * then exercise SDocs.Sources directly. Browser-side load behaviour
 * (Fragment / ShortLink / NewDocument source) is covered by the
 * Playwright suite — here we only assert the registry contract.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Document-source registry tests ─────────────\n');

  function freshSources() {
    const win = {};
    const ctx = vm.createContext({ window: win });
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'sdocs-source.js'), 'utf-8');
    vm.runInContext(src, ctx);
    return win.SDocs.Sources;
  }

  test('register: rejects definitions missing required fields', () => {
    const S = freshSources();
    assert.throws(() => S.register(), /definition required/);
    assert.throws(() => S.register({}), /name is required|matches.* is required/);
    assert.throws(() => S.register({ name: 'x', matches: () => true }), /create.* is required/);
    assert.throws(() => S.register({ name: 'x', create: () => ({}) }), /matches.* is required/);
  });

  test('select: picks the first matching source (order matters)', () => {
    const S = freshSources();
    S.register({ name: 'specific', matches: (loc) => loc.pathname === '/foo', create: () => ({ name: 'specific' }) });
    S.register({ name: 'catch-all', matches: () => true, create: () => ({ name: 'catch-all' }) });

    assert.strictEqual(S.select({ pathname: '/foo' }).name, 'specific');
    assert.strictEqual(S.select({ pathname: '/other' }).name, 'catch-all');
  });

  test('select: returns null when nothing matches', () => {
    const S = freshSources();
    S.register({ name: 'never', matches: () => false, create: () => ({}) });
    assert.strictEqual(S.select({ pathname: '/anything' }), null);
  });

  test('select: a buggy matches() in one source does not break later ones', () => {
    const S = freshSources();
    S.register({ name: 'broken', matches: () => { throw new Error('boom'); }, create: () => ({}) });
    S.register({ name: 'fine',   matches: () => true, create: () => ({ name: 'fine' }) });
    assert.strictEqual(S.select({ pathname: '/' }).name, 'fine');
  });

  test('select: URL-shape dispatch (the four shapes the editor cares about)', () => {
    const S = freshSources();
    const SHORT_RE = /^\/s\/([A-Za-z0-9_-]{1,32})$/;

    // The registrations mirror sdocs-app.js: short-link → new-document → fragment.
    S.register({ name: 'short-link',  matches: (loc) => SHORT_RE.test(loc.pathname),  create: () => ({ name: 'short-link' }) });
    S.register({ name: 'new-document', matches: (loc) => loc.pathname === '/new',     create: () => ({ name: 'new-document' }) });
    S.register({ name: 'fragment',    matches: () => true,                            create: () => ({ name: 'fragment' }) });

    assert.strictEqual(S.select({ pathname: '/s/abc123' }).name, 'short-link');
    assert.strictEqual(S.select({ pathname: '/new' }).name,      'new-document');
    assert.strictEqual(S.select({ pathname: '/' }).name,         'fragment');
    assert.strictEqual(S.select({ pathname: '/anything-else' }).name, 'fragment');
  });

  test('names: returns the list of registered source names in order', () => {
    const S = freshSources();
    S.register({ name: 'a', matches: () => false, create: () => ({}) });
    S.register({ name: 'b', matches: () => false, create: () => ({}) });
    // S.names() returns an array from the vm-context realm; copy into the
    // test realm so deepStrictEqual compares structure, not prototype.
    assert.deepStrictEqual(Array.from(S.names()), ['a', 'b']);
  });

  test('fragment source contract: a load()-only source satisfies the interface', () => {
    // Minimal source that today's FragmentSource resembles: just a load().
    // The contract is: name, capabilities, load (async or sync).
    const source = {
      name: 'fragment',
      capabilities: { canSave: true, canWatch: false, canSubmit: false },
      load: function () { return Promise.resolve(); },
    };
    assert.strictEqual(typeof source.name, 'string');
    assert.strictEqual(typeof source.capabilities, 'object');
    assert.strictEqual(typeof source.capabilities.canSave, 'boolean');
    assert.strictEqual(typeof source.capabilities.canWatch, 'boolean');
    assert.strictEqual(typeof source.capabilities.canSubmit, 'boolean');
    assert.strictEqual(typeof source.load, 'function');
    // Optional methods may be absent — capability flags carry the signal.
    assert.strictEqual(source.save, undefined);
    assert.strictEqual(source.onExternalChange, undefined);
    assert.strictEqual(source.submit, undefined);
  });
};
