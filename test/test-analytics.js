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

  console.log('\n── Analytics: Local Time-of-Day Tests ───────────\n');

  test('logVisit stores local hour + weekday; out-of-range values become NULL', () => {
    analyticsDb.close();
    analyticsDb.init(':memory:');
    analyticsDb.logVisit('2026-W15', '', '', 14, 3);   // valid
    analyticsDb.logVisit('2026-W15', '', '', 0, 0);    // midnight / Sunday — must persist
    analyticsDb.logVisit('2026-W15', '', '', 99, -1);  // both out of range → NULL
    analyticsDb.logVisit('2026-W15', '', '');          // omitted → NULL
    analyticsDb.flush();
    const db = analyticsDb.getDB();
    assert.strictEqual(db.prepare('SELECT COUNT(*) as c FROM visits WHERE local_hour IS NOT NULL').get().c, 2);
    assert.strictEqual(db.prepare('SELECT COUNT(*) as c FROM visits WHERE local_dow IS NOT NULL').get().c, 2);
    assert.strictEqual(db.prepare('SELECT COUNT(*) as c FROM visits WHERE local_hour = 0').get().c, 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) as c FROM visits WHERE local_dow = 0').get().c, 1);
  });

  test('getRetentionData buckets byHour and byDow', () => {
    analyticsDb.close();
    analyticsDb.init(':memory:');
    const db = analyticsDb.getDB();
    const ins = db.prepare('INSERT INTO visits (cohort_week, visit_week, local_hour, local_dow) VALUES (?, ?, ?, ?)');
    // 3 visits at hour 9 / Monday(1), 2 at hour 14 / Wednesday(3), 1 with no local data.
    for (let i = 0; i < 3; i++) ins.run('2026-W15', '2026-W15', 9, 1);
    for (let i = 0; i < 2; i++) ins.run('2026-W15', '2026-W15', 14, 3);
    ins.run('2026-W15', '2026-W15', null, null);

    const data = analyticsQuery.getRetentionData();
    const h9 = data.byHour.find(r => Number(r.hour) === 9);
    const h14 = data.byHour.find(r => Number(r.hour) === 14);
    assert.strictEqual(h9.count, 3);
    assert.strictEqual(h14.count, 2);
    assert.ok(!data.byHour.some(r => r.hour === null), 'null hour excluded');

    const mon = data.byDow.find(r => Number(r.dow) === 1);
    const wed = data.byDow.find(r => Number(r.dow) === 3);
    assert.strictEqual(mon.count, 3);
    assert.strictEqual(wed.count, 2);
  });

  test('readVisitPayload degrades to empty byHour/byDow on a legacy db without the columns', () => {
    const Database = require('better-sqlite3');
    const legacy = new Database(':memory:');
    legacy.exec(`CREATE TABLE visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cohort_week TEXT NOT NULL DEFAULT '',
      visit_week TEXT NOT NULL,
      device TEXT NOT NULL DEFAULT '',
      browser TEXT NOT NULL DEFAULT '',
      referer TEXT NOT NULL DEFAULT ''
    );`);
    legacy.prepare("INSERT INTO visits (cohort_week, visit_week) VALUES ('2026-W10', '2026-W10')").run();
    const payload = analyticsQuery.readVisitPayload(legacy);
    assert.deepStrictEqual(payload.byHour, [], 'missing column → empty, not a throw');
    assert.deepStrictEqual(payload.byDow, []);
    legacy.close();
  });

  test('mergeVisitPayloads sums byHour/byDow in clock order', () => {
    const a = { byHour: [{ hour: 9, count: 2 }], byDow: [{ dow: 3, count: 2 }] };
    const b = { byHour: [{ hour: 9, count: 1 }, { hour: 2, count: 5 }], byDow: [{ dow: 1, count: 4 }] };
    const m = analyticsQuery.mergeVisitPayloads(a, b);
    assert.deepStrictEqual(m.byHour.map(r => Number(r.hour)), [2, 9], 'sorted ascending by hour');
    assert.strictEqual(m.byHour.find(r => Number(r.hour) === 9).count, 3, 'same hour summed across dbs');
    assert.deepStrictEqual(m.byDow.map(r => Number(r.dow)), [1, 3]);
  });

  console.log('\n── Analytics: Load-Type Tests ───────────────────\n');

  test('logVisit stores load_type; unknown values become empty', () => {
    analyticsDb.close();
    analyticsDb.init(':memory:');
    analyticsDb.logVisit('2026-W15', '', '', null, null, 'short');
    analyticsDb.logVisit('2026-W15', '', '', null, null, 'hash');
    analyticsDb.logVisit('2026-W15', '', '', null, null, 'home');   // marketing landing page
    analyticsDb.logVisit('2026-W15', '', '', null, null, 'bogus');  // not allowlisted → ''
    analyticsDb.logVisit('2026-W15', '', '', null, null);           // omitted → ''
    analyticsDb.flush();
    const db = analyticsDb.getDB();
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM visits WHERE load_type = 'short'").get().c, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM visits WHERE load_type = 'hash'").get().c, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM visits WHERE load_type = 'home'").get().c, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM visits WHERE load_type = ''").get().c, 2);
  });

  test('getRetentionData buckets loadTypes, excluding empties', () => {
    analyticsDb.close();
    analyticsDb.init(':memory:');
    const db = analyticsDb.getDB();
    const ins = db.prepare('INSERT INTO visits (cohort_week, visit_week, load_type) VALUES (?, ?, ?)');
    for (let i = 0; i < 5; i++) ins.run('2026-W15', '2026-W15', 'short');
    for (let i = 0; i < 3; i++) ins.run('2026-W15', '2026-W15', 'hash');
    ins.run('2026-W15', '2026-W15', '');  // no load type — must not appear as a bucket

    const data = analyticsQuery.getRetentionData();
    const short = data.loadTypes.find(r => r.type === 'short');
    const hash = data.loadTypes.find(r => r.type === 'hash');
    assert.strictEqual(short.count, 5);
    assert.strictEqual(hash.count, 3);
    assert.ok(!data.loadTypes.some(r => r.type === ''), 'empty load_type excluded');
    assert.strictEqual(data.loadTypes[0].type, 'short', 'ordered by count desc');
  });

  test('readVisitPayload degrades to empty loadTypes on a legacy db without the column', () => {
    const Database = require('better-sqlite3');
    const legacy = new Database(':memory:');
    legacy.exec(`CREATE TABLE visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cohort_week TEXT NOT NULL DEFAULT '',
      visit_week TEXT NOT NULL,
      device TEXT NOT NULL DEFAULT '',
      browser TEXT NOT NULL DEFAULT '',
      referer TEXT NOT NULL DEFAULT ''
    );`);
    legacy.prepare("INSERT INTO visits (cohort_week, visit_week) VALUES ('2026-W10', '2026-W10')").run();
    const payload = analyticsQuery.readVisitPayload(legacy);
    assert.deepStrictEqual(payload.loadTypes, [], 'missing column → empty, not a throw');
    legacy.close();
  });

  test('mergeVisitPayloads sums loadTypes across dbs', () => {
    const a = { loadTypes: [{ type: 'short', count: 4 }, { type: 'hash', count: 2 }] };
    const b = { loadTypes: [{ type: 'short', count: 1 }, { type: 'app', count: 3 }] };
    const m = analyticsQuery.mergeVisitPayloads(a, b);
    assert.strictEqual(m.loadTypes.find(r => r.type === 'short').count, 5);
    assert.strictEqual(m.loadTypes.find(r => r.type === 'hash').count, 2);
    assert.strictEqual(m.loadTypes.find(r => r.type === 'app').count, 3);
  });

  console.log('\n── Analytics: Segment Tests (per-channel cohorts, per-week day/hour) ──\n');

  test('getRetentionData builds cohortsByType, dowByWeek and hourByWeek', () => {
    analyticsDb.close();
    analyticsDb.init(':memory:');
    const db = analyticsDb.getDB();
    const ins = db.prepare('INSERT INTO visits (cohort_week, visit_week, local_hour, local_dow, load_type) VALUES (?, ?, ?, ?, ?)');
    // W15 cohort: 4 #md visits in W15 (Mon 9h), 2 #md in W16 (Tue 10h), 3 short in W15 (Wed 14h).
    for (let i = 0; i < 4; i++) ins.run('2026-W15', '2026-W15', 9, 1, 'hash');
    for (let i = 0; i < 2; i++) ins.run('2026-W15', '2026-W16', 10, 2, 'hash');
    for (let i = 0; i < 3; i++) ins.run('2026-W15', '2026-W15', 14, 3, 'short');
    ins.run('2026-W15', '2026-W15', null, null, 'home'); // home visit, no local time

    const data = analyticsQuery.getRetentionData();

    // Per-channel cohort matrices
    const hashCohort = data.cohortsByType.hash.find(c => c.cohort_week === '2026-W15');
    assert.strictEqual(hashCohort.cohort_size, 4, '#md birth-week size');
    assert.deepStrictEqual(hashCohort.visits, { '2026-W15': 4, '2026-W16': 2 });
    assert.strictEqual(data.cohortsByType.short.find(c => c.cohort_week === '2026-W15').cohort_size, 3);
    assert.ok(data.cohortsByType.home, 'home channel present');

    // Per-week day/hour buckets (inner keys are the dow/hour integers)
    assert.strictEqual(data.dowByWeek['2026-W15'][1], 4, 'Mon W15 = 4 (#md)');
    assert.strictEqual(data.dowByWeek['2026-W15'][3], 3, 'Wed W15 = 3 (short)');
    assert.strictEqual(data.dowByWeek['2026-W16'][2], 2, 'Tue W16 = 2');
    assert.strictEqual(data.hourByWeek['2026-W15'][9], 4, 'hour 9 in W15 = 4');
    assert.strictEqual(data.hourByWeek['2026-W16'][10], 2, 'hour 10 in W16 = 2');
  });

  test('readSegments degrades to empty on a legacy db without the columns', () => {
    const Database = require('better-sqlite3');
    const legacy = new Database(':memory:');
    legacy.exec('CREATE TABLE visits (id INTEGER PRIMARY KEY AUTOINCREMENT, cohort_week TEXT, visit_week TEXT);');
    legacy.prepare("INSERT INTO visits (cohort_week, visit_week) VALUES ('2026-W10', '2026-W10')").run();
    const seg = analyticsQuery.readSegments(legacy);
    assert.deepStrictEqual(seg.cohortsByType, {}, 'no load_type column → empty, not a throw');
    assert.deepStrictEqual(seg.dowByWeek, {});
    assert.deepStrictEqual(seg.hourByWeek, {});
    legacy.close();
  });

  // Clean up
  analyticsDb.close();
};
