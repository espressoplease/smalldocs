/**
 * Analytics module tests — week.js, db.js, query.js
 */
const path = require('path');

module.exports = function (harness) {
  const { assert, test } = harness;
  const { getISOWeek } = require(path.join(__dirname, '..', 'analytics', 'week'));

  console.log('\n── Analytics: ISO Week Tests ────────────────────\n');

  test('getISOWeek: 2026-04-10 is W15', () => {
    assert.strictEqual(getISOWeek(new Date(2026, 3, 10)), '2026-W15');
  });

  test('getISOWeek: 2026-01-01 is W01', () => {
    assert.strictEqual(getISOWeek(new Date(2026, 0, 1)), '2026-W01');
  });

  test('getISOWeek: 2025-12-29 is 2026-W01 (year boundary)', () => {
    assert.strictEqual(getISOWeek(new Date(2025, 11, 29)), '2026-W01');
  });

  test('getISOWeek: 2025-12-28 is 2025-W52', () => {
    assert.strictEqual(getISOWeek(new Date(2025, 11, 28)), '2025-W52');
  });

  test('getISOWeek: 2024-12-30 is 2025-W01', () => {
    assert.strictEqual(getISOWeek(new Date(2024, 11, 30)), '2025-W01');
  });

  console.log('\n── Analytics: DB Tests ──────────────────────────\n');

  const analyticsDb = require(path.join(__dirname, '..', 'analytics', 'db'));
  const analyticsQuery = require(path.join(__dirname, '..', 'analytics', 'query'));

  // Use in-memory DB for tests
  analyticsDb.init(':memory:');

  test('logVisit inserts a row', () => {
    analyticsDb.logVisit('192.168.1.1', '2026-W15');
    const db = analyticsDb.getDB();
    const count = db.prepare('SELECT COUNT(*) as c FROM visits').get();
    assert.strictEqual(count.c, 1);
  });

  test('logVisit hashes IP deterministically', () => {
    const hash1 = analyticsDb.hashIP('192.168.1.1', '2026-W15');
    const hash2 = analyticsDb.hashIP('192.168.1.1', '2026-W15');
    assert.strictEqual(hash1, hash2);
  });

  test('logVisit hashes differently with different cohort salt', () => {
    const hash1 = analyticsDb.hashIP('192.168.1.1', '2026-W15');
    const hash2 = analyticsDb.hashIP('192.168.1.1', '2026-W16');
    assert.notStrictEqual(hash1, hash2);
  });

  test('logVisit with empty cohort still inserts', () => {
    const db = analyticsDb.getDB();
    const before = db.prepare('SELECT COUNT(*) as c FROM visits').get().c;
    analyticsDb.logVisit('10.0.0.1', '');
    const after = db.prepare('SELECT COUNT(*) as c FROM visits').get().c;
    assert.strictEqual(after, before + 1);
  });

  test('logVisit stores correct cohort_week', () => {
    const db = analyticsDb.getDB();
    // Insert with known cohort
    analyticsDb.logVisit('10.0.0.2', '2026-W10');
    const row = db.prepare("SELECT cohort_week FROM visits WHERE cohort_week = '2026-W10' LIMIT 1").get();
    assert.strictEqual(row.cohort_week, '2026-W10');
  });

  console.log('\n── Analytics: Query Tests ───────────────────────\n');

  test('getRetentionData returns correct structure', () => {
    const data = analyticsQuery.getRetentionData();
    assert.ok(Array.isArray(data.weeks), 'weeks should be an array');
    assert.ok(Array.isArray(data.cohorts), 'cohorts should be an array');
    assert.ok(data.generated, 'should have generated timestamp');
  });

  test('getRetentionData excludes empty cohort from retention', () => {
    const data = analyticsQuery.getRetentionData();
    const emptyCohort = data.cohorts.find(function (c) { return c.cohort_week === ''; });
    assert.strictEqual(emptyCohort, undefined, 'empty cohort should not appear in retention');
  });

  test('getRetentionData includes non-empty cohorts', () => {
    const data = analyticsQuery.getRetentionData();
    assert.ok(data.cohorts.length > 0, 'should have at least one cohort');
    const w15 = data.cohorts.find(function (c) { return c.cohort_week === '2026-W15'; });
    assert.ok(w15, '2026-W15 cohort should exist');
    assert.ok(w15.cohort_size > 0, 'cohort size should be > 0');
  });

  // Clean up
  analyticsDb.close();
};
