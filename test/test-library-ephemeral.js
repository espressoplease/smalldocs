// Ephemeral-path detection unit tests.

const os   = require('os');
const path = require('path');

const ephem = require('../cli/lib/library-ephemeral');

module.exports = function (h) {
  const { test, assert } = h;

  test('isEphemeralPath: tmpdir() qualifies', () => {
    const f = path.join(os.tmpdir(), 'whatever.md');
    assert.strictEqual(ephem.isEphemeralPath(f), true);
  });

  if (process.platform === 'darwin') {
    test('isEphemeralPath: /tmp on macOS', () => {
      assert.strictEqual(ephem.isEphemeralPath('/tmp/foo/bar.md'), true);
    });
    test('isEphemeralPath: /private/var/tmp on macOS', () => {
      assert.strictEqual(ephem.isEphemeralPath('/private/var/tmp/abc.md'), true);
    });
  } else if (process.platform === 'linux') {
    test('isEphemeralPath: /tmp on Linux', () => {
      assert.strictEqual(ephem.isEphemeralPath('/tmp/foo/bar.md'), true);
    });
  }

  test('isEphemeralPath: ordinary home file is not ephemeral', () => {
    const f = path.join(os.homedir(), 'work', 'foo.md');
    assert.strictEqual(ephem.isEphemeralPath(f), false);
  });

  test('isEphemeralPath: empty / null returns false', () => {
    assert.strictEqual(ephem.isEphemeralPath(''), false);
    assert.strictEqual(ephem.isEphemeralPath(null), false);
  });

  test('ephemeralRoots: includes os.tmpdir()', () => {
    const roots = ephem.ephemeralRoots();
    assert.ok(roots.includes(path.resolve(os.tmpdir())), 'expected tmpdir() in roots');
  });
};
