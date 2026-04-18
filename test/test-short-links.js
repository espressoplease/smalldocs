/**
 * Short-links DB tests: insert, fetch, collision-safe IDs, TTL cleanup.
 */
const path = require('path');

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Short-links: DB Tests ──────────────────────\n');

  const shortLinks = require(path.join(__dirname, '..', 'short-links', 'db'));

  // Fresh in-memory DB per suite
  shortLinks.init(':memory:');

  test('insert returns an id and fetch returns the same ciphertext', () => {
    const id = shortLinks.insert('AAAA_BBBB');
    assert.ok(typeof id === 'string' && id.length > 0);
    assert.strictEqual(shortLinks.fetch(id), 'AAAA_BBBB');
  });

  test('insert generates distinct ids for distinct payloads', () => {
    const a = shortLinks.insert('payload-a');
    const b = shortLinks.insert('payload-b');
    assert.notStrictEqual(a, b);
  });

  test('fetch returns null for unknown id', () => {
    assert.strictEqual(shortLinks.fetch('nosuchidnope'), null);
  });

  test('insert rejects empty ciphertext', () => {
    let threw = false;
    try { shortLinks.insert(''); } catch (e) { threw = true; }
    assert.ok(threw, 'should throw for empty ciphertext');
  });

  test('fetch updates last_accessed_at (touch)', () => {
    const id = shortLinks.insert('touch-me');
    const db = shortLinks.getDB();
    // Force last_accessed_at back in time
    db.prepare("UPDATE short_links SET last_accessed_at = datetime('now', '-100 days') WHERE id = ?").run(id);
    const before = db.prepare("SELECT last_accessed_at FROM short_links WHERE id = ?").get(id);
    shortLinks.fetch(id);
    const after = db.prepare("SELECT last_accessed_at FROM short_links WHERE id = ?").get(id);
    assert.notStrictEqual(before.last_accessed_at, after.last_accessed_at);
  });

  test('cleanupExpired deletes rows older than ttl', () => {
    const id = shortLinks.insert('stale-row');
    const db = shortLinks.getDB();
    db.prepare("UPDATE short_links SET last_accessed_at = datetime('now', '-400 days') WHERE id = ?").run(id);
    const removed = shortLinks.cleanupExpired(365);
    assert.ok(removed >= 1, 'should delete at least the stale row');
    assert.strictEqual(shortLinks.fetch(id), null);
  });

  test('cleanupExpired leaves fresh rows alone', () => {
    const id = shortLinks.insert('fresh-row');
    shortLinks.cleanupExpired(365);
    assert.strictEqual(shortLinks.fetch(id), 'fresh-row');
  });

  test('getWeeklyCreationCounts buckets rows by ISO week', () => {
    // Fresh in-memory DB so prior inserts do not pollute counts.
    shortLinks.close();
    shortLinks.init(':memory:');
    const db = shortLinks.getDB();
    const seed = db.prepare('INSERT INTO short_links (id, ciphertext, created_at, last_accessed_at) VALUES (?, ?, ?, ?)');
    // 2026-04-10 is ISO W15, 2026-04-13 (Mon) is W16, 2026-04-17 (Fri) is W16.
    seed.run('id1aaaa1', 'ct', '2026-04-10 12:00:00', '2026-04-10 12:00:00');
    seed.run('id1aaaa2', 'ct', '2026-04-10 23:59:59', '2026-04-10 23:59:59');
    seed.run('id1aaaa3', 'ct', '2026-04-13 00:00:01', '2026-04-13 00:00:01');
    seed.run('id1aaaa4', 'ct', '2026-04-17 09:00:00', '2026-04-17 09:00:00');

    const rows = shortLinks.getWeeklyCreationCounts();
    assert.deepStrictEqual(rows, [
      { week: '2026-W15', count: 2 },
      { week: '2026-W16', count: 2 },
    ]);
  });

  shortLinks.close();

  console.log('\n── Short-links: Rate-limit Tests ──────────────\n');

  const rateLimit = require(path.join(__dirname, '..', 'short-links', 'rate-limit'));

  test('rate-limit allows up to the cap, then blocks', () => {
    rateLimit.reset();
    rateLimit.setLimit(5);
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(rateLimit.check('1.2.3.4'), true, 'request ' + i + ' should pass');
    }
    assert.strictEqual(rateLimit.check('1.2.3.4'), false, '6th request should be blocked');
  });

  test('rate-limit isolates by ip', () => {
    rateLimit.reset();
    rateLimit.setLimit(2);
    assert.strictEqual(rateLimit.check('a'), true);
    assert.strictEqual(rateLimit.check('a'), true);
    assert.strictEqual(rateLimit.check('a'), false);
    assert.strictEqual(rateLimit.check('b'), true, 'different ip should not be blocked');
  });

  test('rate-limit lets empty ip through (fail-open)', () => {
    rateLimit.reset();
    rateLimit.setLimit(1);
    assert.strictEqual(rateLimit.check(''), true);
    assert.strictEqual(rateLimit.check(''), true);
  });

  rateLimit.stopCleanup();
};
