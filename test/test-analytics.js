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

  test('logVisit buffers, flush writes to DB', () => {
    analyticsDb.logVisit('2026-W15');
    assert.strictEqual(analyticsDb.bufferSize(), 1);
    const db = analyticsDb.getDB();
    assert.strictEqual(db.prepare('SELECT COUNT(*) as c FROM visits').get().c, 0);
    analyticsDb.flush();
    assert.strictEqual(db.prepare('SELECT COUNT(*) as c FROM visits').get().c, 1);
    assert.strictEqual(analyticsDb.bufferSize(), 0);
  });

  test('logVisit with empty cohort still inserts after flush', () => {
    const db = analyticsDb.getDB();
    const before = db.prepare('SELECT COUNT(*) as c FROM visits').get().c;
    analyticsDb.logVisit('');
    analyticsDb.flush();
    const after = db.prepare('SELECT COUNT(*) as c FROM visits').get().c;
    assert.strictEqual(after, before + 1);
  });

  test('logVisit stores correct cohort_week after flush', () => {
    analyticsDb.logVisit('2026-W10');
    analyticsDb.flush();
    const db = analyticsDb.getDB();
    const row = db.prepare("SELECT cohort_week FROM visits WHERE cohort_week = '2026-W10' LIMIT 1").get();
    assert.strictEqual(row.cohort_week, '2026-W10');
  });

  test('schema has no ip_hash column', () => {
    const db = analyticsDb.getDB();
    const cols = db.prepare("PRAGMA table_info(visits)").all().map(function (c) { return c.name; });
    assert.ok(!cols.includes('ip_hash'), 'ip_hash should not exist on the visits table');
  });

  test('flush writes multiple visits in one transaction', () => {
    const db = analyticsDb.getDB();
    const before = db.prepare('SELECT COUNT(*) as c FROM visits').get().c;
    analyticsDb.logVisit('2026-W11');
    analyticsDb.logVisit('2026-W11');
    analyticsDb.logVisit('2026-W11');
    assert.strictEqual(analyticsDb.bufferSize(), 3);
    analyticsDb.flush();
    const after = db.prepare('SELECT COUNT(*) as c FROM visits').get().c;
    assert.strictEqual(after, before + 3);
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
    assert.ok(w15.visits, 'cohort should have a visits map');
  });

  // Clean up
  analyticsDb.close();
};
