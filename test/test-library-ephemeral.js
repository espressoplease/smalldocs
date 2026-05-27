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

  test('isThrowawayPath: tmpdir() qualifies', () => {
    const f = path.join(os.tmpdir(), 'scratch.md');
    assert.strictEqual(ephem.isThrowawayPath(f), true);
  });

  if (process.platform === 'darwin') {
    test('isThrowawayPath: /var/folders is throwaway on macOS', () => {
      assert.strictEqual(ephem.isThrowawayPath('/var/folders/aa/bb/T/test.md'), true);
    });
    test('isThrowawayPath: /private/var/folders alias is throwaway', () => {
      assert.strictEqual(ephem.isThrowawayPath('/private/var/folders/aa/bb/T/test.md'), true);
    });
    test('isEphemeralPath: /private/var/folders alias matches tmpdir()', () => {
      // Regression: the bug that let test artifacts skip rescue. The
      // /private prefix should be canonicalised so it matches os.tmpdir().
      const synthetic = '/private' + path.resolve(os.tmpdir()) + '/sample.md';
      assert.strictEqual(ephem.isEphemeralPath(synthetic), true);
    });
    test('isThrowawayPath: /tmp is NOT throwaway (only ephemeral)', () => {
      // /tmp gets rescue copies; users do work there. Only OS scratch
      // dirs are throwaway.
      assert.strictEqual(ephem.isThrowawayPath('/tmp/foo.md'), false);
    });
  }

  test('isThrowawayPath: ordinary home file is not throwaway', () => {
    const f = path.join(os.homedir(), 'docs', 'note.md');
    assert.strictEqual(ephem.isThrowawayPath(f), false);
  });

  test('isThrowawayPath: empty / null returns false', () => {
    assert.strictEqual(ephem.isThrowawayPath(''), false);
    assert.strictEqual(ephem.isThrowawayPath(null), false);
  });
};
