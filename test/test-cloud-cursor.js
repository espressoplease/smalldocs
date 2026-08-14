module.exports = function(harness) {
  const { assert, test } = harness;
  const { CloudCursorError, createCursorCodec, normalizeLimit } = require('../lib/cloud-cursor');

  test('Cloud cursors round-trip positions only within their signed scope', () => {
    const codec = createCursorCodec({ secret: 'cursor-test-secret-32-bytes-long' });
    const cursor = codec.encode('documents:user-1:project-1', {
      updated_at: '2026-08-14T12:00:00.000Z', id: 'doc-1',
    });
    assert.deepStrictEqual(codec.decode(cursor, 'documents:user-1:project-1'), {
      updated_at: '2026-08-14T12:00:00.000Z', id: 'doc-1',
    });
    assert.throws(() => codec.decode(cursor, 'documents:user-1:project-2'),
      (error) => error instanceof CloudCursorError && error.code === 'invalid_request');
    const parts = cursor.split('.');
    const replacement = parts[0] + '.' + (parts[1][0] === 'a' ? 'b' : 'a') + parts[1].slice(1);
    assert.throws(() => codec.decode(replacement, 'documents:user-1:project-1'),
      (error) => error.code === 'invalid_request');
  });

  test('Cloud page limits have a safe default and maximum', () => {
    assert.strictEqual(normalizeLimit(null), 50);
    assert.strictEqual(normalizeLimit('12'), 12);
    assert.strictEqual(normalizeLimit('500'), 100);
    assert.throws(() => normalizeLimit('0'), (error) => error.code === 'invalid_request');
    assert.throws(() => normalizeLimit('not-a-number'), (error) => error.code === 'invalid_request');
  });
};
