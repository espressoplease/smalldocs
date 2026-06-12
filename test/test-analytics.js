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

  // Fresh DB for the scenario test so earlier tests don't pollute it.
  analyticsDb.close();
  analyticsDb.init(':memory:');

  test('getRetentionData aggregates cohort/visit counts and unattributed correctly', () => {
    const db = analyticsDb.getDB();
    const insert = db.prepare('INSERT INTO visits (cohort_week, visit_week, device, browser, referer) VALUES (?, ?, ?, ?, ?)');
    const seed = (cohort, visit, n) => { for (let i = 0; i < n; i++) insert.run(cohort, visit, 'desktop', 'Chrome', 'direct'); };

    // Scenario:
    //   W15 cohort: 3 visits in W15, 5 in W16
    //   W16 cohort: 2 visits in W16
    //   W17:        1 visit with no cohort (unattributed)
    seed('2026-W15', '2026-W15', 3);
    seed('2026-W15', '2026-W16', 5);
    seed('2026-W16', '2026-W16', 2);
    seed('',         '2026-W17', 1);

    const data = analyticsQuery.getRetentionData();

    const w15 = data.cohorts.find(c => c.cohort_week === '2026-W15');
    const w16 = data.cohorts.find(c => c.cohort_week === '2026-W16');
    assert.ok(w15 && w16, 'both cohorts should appear');
    assert.strictEqual(w15.cohort_size, 3, 'W15 cohort_size = birth-week visits');
    assert.deepStrictEqual(w15.visits, { '2026-W15': 3, '2026-W16': 5 });
    assert.strictEqual(w16.cohort_size, 2);
    assert.deepStrictEqual(w16.visits, { '2026-W16': 2 });

    assert.strictEqual(data.unattributed['2026-W17'], 1, 'unattributed bucket holds the no-cohort row');
    assert.ok(!data.cohorts.some(c => c.cohort_week === ''), 'empty cohort must not appear in cohorts');
    assert.deepStrictEqual(data.weeks, ['2026-W15', '2026-W16', '2026-W17']);
  });

  console.log('\n── Analytics: Legacy Merge Tests ────────────────\n');

  test('mergeVisitPayloads sums two databases cell by cell', () => {
    const Database = require('better-sqlite3');
    const schema = `CREATE TABLE visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cohort_week TEXT NOT NULL DEFAULT '',
      visit_week TEXT NOT NULL,
      device TEXT NOT NULL DEFAULT '',
      browser TEXT NOT NULL DEFAULT '',
      referer TEXT NOT NULL DEFAULT ''
    );`;
    const mk = (rows) => {
      const d = new Database(':memory:');
      d.exec(schema);
      const ins = d.prepare('INSERT INTO visits (cohort_week, visit_week, device, browser, referer) VALUES (?, ?, ?, ?, ?)');
      rows.forEach(r => ins.run(...r));
      return d;
    };

    // Legacy site: W15 cohort, 2 visits in its birth week, Safari/mobile.
    const legacy = mk([
      ['2026-W15', '2026-W15', 'mobile', 'Safari', 'github'],
      ['2026-W15', '2026-W15', 'mobile', 'Safari', 'github'],
      ['',          '2026-W15', 'desktop', 'Chrome', ''],
    ]);
    // Current site: same cohort reappears in W20, plus a new W20 cohort.
    const current = mk([
      ['2026-W15', '2026-W20', 'desktop', 'Chrome', 'direct'],
      ['2026-W20', '2026-W20', 'desktop', 'Chrome', 'direct'],
    ]);

    const a = analyticsQuery.readVisitPayload(current);
    const b = analyticsQuery.readVisitPayload(legacy);
    const m = analyticsQuery.mergeVisitPayloads(a, b);

    assert.deepStrictEqual(m.weeks, ['2026-W15', '2026-W20']);
    const w15 = m.cohorts.find(c => c.cohort_week === '2026-W15');
    assert.strictEqual(w15.cohort_size, 2, 'birth-week size comes from the legacy db');
    assert.deepStrictEqual(w15.visits, { '2026-W15': 2, '2026-W20': 1 },
      'one cohort row spans both databases');
    assert.strictEqual(m.unattributed['2026-W15'], 1);
    assert.deepStrictEqual(m.volume, [
      { visit_week: '2026-W15', visits: 3 },
      { visit_week: '2026-W20', visits: 2 },
    ]);
    const chrome = m.browsers.find(r => r.browser === 'Chrome');
    const safari = m.browsers.find(r => r.browser === 'Safari');
    assert.strictEqual(chrome.count, 3);
    assert.strictEqual(safari.count, 2);
    legacy.close();
    current.close();
  });

  test('getRetentionData merges a legacy db pointed at by ANALYTICS_LEGACY_DB', () => {
    const fs = require('fs');
    const os = require('os');
    const Database = require('better-sqlite3');
    const legacyPath = path.join(os.tmpdir(), 'sdocs-test-legacy-analytics-' + process.pid + '.db');
    try { fs.unlinkSync(legacyPath); } catch (_) {}
    const d = new Database(legacyPath);
    d.exec(`CREATE TABLE visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cohort_week TEXT NOT NULL DEFAULT '',
      visit_week TEXT NOT NULL,
      device TEXT NOT NULL DEFAULT '',
      browser TEXT NOT NULL DEFAULT '',
      referer TEXT NOT NULL DEFAULT ''
    );`);
    d.prepare("INSERT INTO visits (cohort_week, visit_week, device, browser, referer) VALUES ('2026-W10', '2026-W10', 'desktop', 'Firefox', 'search')").run();
    d.close();

    // The in-memory primary db still holds the scenario seeded above
    // (W15/W16 cohorts). With the env var set, W10 joins the result.
    process.env.ANALYTICS_LEGACY_DB = legacyPath;
    try {
      const data = analyticsQuery.getRetentionData();
      assert.ok(data.weeks.includes('2026-W10'), 'legacy week appears');
      assert.ok(data.weeks.includes('2026-W15'), 'primary weeks remain');
      const w10 = data.cohorts.find(c => c.cohort_week === '2026-W10');
      assert.strictEqual(w10.cohort_size, 1);
    } finally {
      delete process.env.ANALYTICS_LEGACY_DB;
      try { fs.unlinkSync(legacyPath); } catch (_) {}
    }
  });

  // Clean up
  analyticsDb.close();
};
