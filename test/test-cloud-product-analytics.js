'use strict';

module.exports = function ({ test, assert }) {
  const fs = require('fs'), os = require('os'), path = require('path');
  const Database = require('better-sqlite3');
  const { CloudProductAnalytics, DAY_MS, CACHE_MS } = require('../lib/cloud-product-analytics');
  const { CURRENT_TERMS_VERSION } = require('../lib/cloud-terms');
  function fixture(run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-product-metrics-'));
    const auth = { db: new Database(path.join(dir, 'auth.db')) };
    const store = { db: new Database(path.join(dir, 'content.db')) };
    const billing = { db: new Database(path.join(dir, 'billing.db')) };
    auth.db.exec(`CREATE TABLE cloud_auth_users(id TEXT PRIMARY KEY,first_name TEXT,last_name TEXT,created_at_ms INTEGER,disabled_at_ms INTEGER);
      CREATE TABLE cloud_auth_identities(user_id TEXT,provider TEXT,verified_email TEXT);
      CREATE TABLE cloud_auth_terms_acceptances(user_id TEXT,terms_version TEXT);
      CREATE TABLE cloud_cli_credentials(user_id TEXT,created_at_ms INTEGER,revoked_at_ms INTEGER);`);
    store.db.exec(`CREATE TABLE cloud_workspaces(id TEXT,kind TEXT,deleted_at_ms INTEGER);
      CREATE TABLE cloud_workspace_memberships(workspace_id TEXT,user_id TEXT,status TEXT);
      CREATE TABLE cloud_projects(id TEXT,workspace_id TEXT,deleted_at_ms INTEGER);
      CREATE TABLE cloud_document_activation_events(user_id TEXT);
      CREATE TABLE cloud_documents(created_by_user_id TEXT);`);
    billing.db.exec(`CREATE TABLE cloud_single_accounts(id TEXT,owner_user_id TEXT);
      CREATE TABLE cloud_single_libraries(workspace_id TEXT,account_id TEXT);
      CREATE TABLE cloud_single_sponsors(user_id TEXT,account_id TEXT);
      CREATE TABLE cloud_billing_personal_trials(user_id TEXT);
      CREATE TABLE cloud_billing_subscriptions(workspace_id TEXT,provider TEXT,status TEXT,initial_payment_pending INTEGER,access_activated_at_ms INTEGER,seat_quantity INTEGER);`);
    let now = Date.UTC(2026, 10, 10, 12);
    const analytics = new CloudProductAnalytics({ auth, store, billing, singlePlan: true, adminUserIds: 'admin', now: () => now });
    const add = (id, created = now, disabled = null) => auth.db.prepare('INSERT INTO cloud_auth_users VALUES (?,?,?,?,?)').run(id, 'Private name', 'Example', created, disabled);
    try { run({ auth: auth.db, store: store.db, billing: billing.db, analytics, add, now,
      advance: ms => { now += ms; } }); }
    finally { analytics.close(); auth.db.close(); store.db.close(); billing.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  }

  test('public signup counts are accounts, not identities, and include disabled retained accounts', () => fixture(f => {
    f.add('today'); f.add('disabled', f.now, f.now); f.add('week', f.now - 6 * DAY_MS);
    f.add('month', f.now - 29 * DAY_MS); f.add('older', f.now - 100 * DAY_MS); f.add('future', f.now + DAY_MS);
    f.auth.exec("INSERT INTO cloud_auth_identities VALUES ('today','google','private@example.test'),('today','email','other@example.test')");
    const result = f.analytics.signups();
    assert.deepStrictEqual(result.summary, { total: 5, today: 2, last_7_days: 3, last_30_days: 4 });
    assert.strictEqual(result.daily.length, 90);
    assert.deepStrictEqual(result.daily.at(-1), { date: '2026-11-10', accounts: 2 });
    assert.ok(result.daily.some(day => day.accounts === 0));
    const json = JSON.stringify(result);
    for (const secret of ['Private name', 'private@example.test', 'disabled', 'user_id', 'provider']) assert.ok(!json.includes(secret));
    assert.deepStrictEqual(Object.keys(result).sort(), ['available', 'daily', 'generated_at', 'summary', 'timezone']);
  }));

  test('signup cache expires and changes UTC day without retaining yesterday as today', () => fixture(f => {
    f.add('one'); const original = f.analytics.signups(); f.add('two');
    assert.strictEqual(f.analytics.signups(), original);
    f.advance(CACHE_MS); assert.strictEqual(f.analytics.signups().summary.total, 2);
    f.advance(12 * 3600000 - CACHE_MS);
    assert.strictEqual(f.analytics.signups().summary.today, 0);
    assert.strictEqual(f.analytics.signups().daily.at(-1).date, '2026-11-11');
  }));

  test('each private cache hit still requires administrator access', () => fixture(f => {
    f.add('admin'); const result = f.analytics.overview('admin');
    assert.strictEqual(result.totals.accounts, 1);
    assert.throws(() => f.analytics.overview('member'), error => error.code === 'resource_unavailable');
    f.analytics.admins.clear();
    assert.throws(() => f.analytics.overview('admin'), error => error.code === 'resource_unavailable');
  }));

  test('private figures use a fresh consistent snapshot even while public counts are cached', () => fixture(f => {
    f.add('one'); assert.strictEqual(f.analytics.signups().summary.total, 1);
    f.add('two'); const overview = f.analytics.overview('admin');
    assert.strictEqual(overview.signups.total, 2);
    assert.strictEqual(overview.signups.total, overview.totals.accounts);
  }));

  test('setup progress counts people once across libraries, credentials and authored documents', () => fixture(f => {
    f.add('alice', f.now - DAY_MS); f.add('bob'); f.add('disabled', f.now, f.now);
    f.auth.prepare('INSERT INTO cloud_auth_terms_acceptances VALUES (?,?)').run('alice', CURRENT_TERMS_VERSION);
    f.auth.exec("INSERT INTO cloud_auth_terms_acceptances VALUES ('bob','old-terms'); INSERT INTO cloud_cli_credentials VALUES ('alice',1,NULL),('alice',2,3)");
    f.store.exec(`INSERT INTO cloud_workspaces VALUES ('personal','personal',NULL),('team','team',NULL),('deleted','team',1);
      INSERT INTO cloud_projects VALUES ('a','personal',NULL),('b','team',NULL),('c','deleted',NULL);
      INSERT INTO cloud_workspace_memberships VALUES ('personal','alice','active'),('team','alice','active'),('team','bob','active'),('deleted','disabled','active');
      INSERT INTO cloud_documents VALUES ('alice'),('alice'); INSERT INTO cloud_document_activation_events VALUES ('alice'),('bob')`);
    const result = f.analytics.overview('admin');
    assert.deepStrictEqual(result.totals, { accounts: 3, enabled: 2, profile_complete: 3, ready: 1, agent_connected: 1, document_created: 2, paid_people: 0 });
    assert.deepStrictEqual(result.libraries, { personal: 1, team: 1 });
    assert.strictEqual(result.cohorts.at(-2).agent_connected, 1);
    assert.strictEqual(result.cohorts.at(-1).agent_connected, 0);
  }));

  test('paid coverage deduplicates sponsors and excludes revoked memberships, pending payments and manual access', () => fixture(f => {
    for (const id of ['owner', 'member', 'removed', 'pending', 'manual', 'disabled']) f.add(id, f.now, id === 'disabled' ? f.now : null);
    f.billing.exec(`INSERT INTO cloud_single_accounts VALUES ('paid','owner'),('pending','pending'),('manual','manual');
      INSERT INTO cloud_single_sponsors VALUES ('owner','paid'),('member','paid'),('removed','paid'),('disabled','paid');
      INSERT INTO cloud_single_libraries VALUES ('team','paid'),('other','paid');
      INSERT INTO cloud_billing_subscriptions VALUES ('paid','stripe','active',0,1,4),('pending','stripe','past_due',1,NULL,1),('manual','manual','active',0,1,1);
      INSERT INTO cloud_billing_personal_trials VALUES ('owner'),('member')`);
    f.store.exec(`INSERT INTO cloud_workspaces VALUES ('team','team',NULL),('other','team',NULL);
      INSERT INTO cloud_workspace_memberships VALUES ('team','member','active'),('other','member','active'),('team','removed','disabled'),('team','disabled','active')`);
    const result = f.analytics.overview('admin');
    assert.strictEqual(result.totals.paid_people, 2);
    assert.strictEqual(result.billing.active_subscriptions, 1);
    assert.strictEqual(result.billing.pending_subscriptions, 1);
    assert.strictEqual(result.billing.billed_seats, 4);
    assert.strictEqual(result.billing.trials_started, 2);
  }));

  test('analytics connections reject mutations in every attached database', () => fixture(f => {
    for (const sql of ['DELETE FROM cloud_auth_users', 'DELETE FROM content.cloud_documents', 'DELETE FROM billing.cloud_single_accounts']) {
      assert.throws(() => f.analytics.db.exec(sql), /readonly|read-only/);
    }
    assert.strictEqual(f.analytics.db.pragma('query_only', { simple: true }), 1);
  }));

  test('identified accounts require administrator access and paginate without duplicate linked identities', () => fixture(f => {
    for (let i = 0; i < 55; i++) f.add('person-' + String(i).padStart(3, '0'));
    f.auth.exec("INSERT INTO cloud_auth_identities VALUES ('person-054','google','primary@example.test'),('person-054','email','primary@example.test'),('person-054','email','alias@example.test')");
    assert.throws(() => f.analytics.users('member', 'missing'), error => error.code === 'resource_unavailable');
    const one = f.analytics.users('admin'); const two = f.analytics.users('admin', one.next_cursor);
    assert.strictEqual(one.items.length, 50); assert.strictEqual(two.items.length, 5);
    assert.strictEqual(new Set([...one.items, ...two.items].map(item => item.id)).size, 55);
    assert.deepStrictEqual(one.items[0].emails, ['alias@example.test', 'primary@example.test']);
    assert.strictEqual(two.next_cursor, null);
    assert.deepStrictEqual(Object.keys(one.items[0]).sort(), ['agent_connected', 'created_at', 'disabled', 'document_created', 'emails', 'id', 'manual_access', 'paid_coverage', 'profile_complete', 'subscribed']);
    for (const cursor of ['', 'missing', 'x'.repeat(129), {}, "' OR 1=1 --"]) {
      assert.throws(() => f.analytics.users('admin', cursor), error => error.code === 'invalid_request');
    }
  }));

  test('private account list uses a constant query budget for one or fifty accounts', () => fixture(f => {
    f.add('one');
    const prepare = f.analytics.db.prepare;
    let queries = 0;
    f.analytics.db.prepare = function (sql) { queries++; return prepare.call(this, sql); };
    try {
      f.analytics.users('admin'); const single = queries;
      for (let i = 0; i < 55; i++) f.add('extra-' + i);
      queries = 0; f.analytics.users('admin');
      assert.strictEqual(queries, single); assert.strictEqual(queries, 3);
      queries = 0;
      assert.throws(() => f.analytics.users('not-admin'), error => error.code === 'resource_unavailable');
      assert.strictEqual(queries, 0);
    } finally { f.analytics.db.prepare = prepare; }
  }));

  test('email rows are uncached and never enter either aggregate cache', () => fixture(f => {
    f.add('one'); f.add('disabled', f.now - DAY_MS, f.now);
    f.auth.exec("INSERT INTO cloud_auth_identities VALUES ('one','email','first@example.test')");
    f.analytics.signups(); f.analytics.overview('admin');
    assert.deepStrictEqual(f.analytics.users('admin').items[0].emails, ['first@example.test']);
    f.auth.exec("UPDATE cloud_auth_identities SET verified_email='updated@example.test'");
    const users = f.analytics.users('admin');
    assert.deepStrictEqual(users.items[0].emails, ['updated@example.test']);
    assert.deepStrictEqual(users.items[1].emails, []); assert.strictEqual(users.items[1].disabled, true);
    for (const cache of [f.analytics.publicCache, f.analytics.privateCache]) assert.ok(!JSON.stringify(cache).includes('@example.test'));
    f.analytics.admins.clear();
    assert.throws(() => f.analytics.users('admin'), error => error.code === 'resource_unavailable');
  }));

  test('account progress distinguishes paid owners, sponsored members, free grants and historical agent/document actions', () => fixture(f => {
    for (const id of ['payer', 'sponsored', 'free', 'new', 'pending', 'disabled']) f.add(id, f.now, id === 'disabled' ? f.now : null);
    f.auth.exec("INSERT INTO cloud_cli_credentials VALUES ('payer',1,2)");
    f.store.exec("INSERT INTO cloud_document_activation_events VALUES ('payer'); INSERT INTO cloud_workspaces VALUES ('team','team',NULL); INSERT INTO cloud_workspace_memberships VALUES ('team','sponsored','active'),('team','disabled','active')");
    f.billing.exec(`INSERT INTO cloud_single_accounts VALUES ('paid','payer'),('manual','free'),('pending','pending');
      INSERT INTO cloud_single_libraries VALUES ('team','paid');
      INSERT INTO cloud_single_sponsors VALUES ('sponsored','paid'),('disabled','paid');
      INSERT INTO cloud_billing_subscriptions VALUES ('paid','stripe','active',0,1,3),('manual','manual','active',0,1,1),('pending','stripe','past_due',1,NULL,1)`);
    const rows = new Map(f.analytics.users('admin').items.map(row => [row.id, row]));
    assert.strictEqual(rows.get('payer').agent_connected, true);
    assert.strictEqual(rows.get('payer').document_created, true);
    assert.strictEqual(rows.get('payer').subscribed, true);
    assert.strictEqual(rows.get('sponsored').subscribed, false); assert.strictEqual(rows.get('sponsored').paid_coverage, true);
    assert.strictEqual(rows.get('free').manual_access, true); assert.strictEqual(rows.get('free').paid_coverage, false);
    assert.strictEqual(rows.get('new').subscribed, false); assert.strictEqual(rows.get('new').agent_connected, false);
    assert.strictEqual(rows.get('pending').subscribed, false); assert.strictEqual(rows.get('disabled').paid_coverage, false);
    assert.strictEqual([...rows.values()].filter(row => row.paid_coverage).length, f.analytics.overview('admin').totals.paid_people);
  }));

  test('empty deployments return zero totals without fabricating billing or content availability', () => fixture(f => {
    const empty = new CloudProductAnalytics({ auth: { db: f.auth }, adminUserIds: 'admin', now: () => f.now });
    try {
      assert.strictEqual(empty.signups().summary.total, 0);
      const result = empty.overview('admin');
      assert.strictEqual(result.billing, null); assert.strictEqual(result.libraries, null);
      assert.ok(result.cohorts.every(day => day.accounts === 0));
    } finally { empty.close(); }
  }));

  test('a hundred thousand document metadata rows produce bounded aggregates and reusable caches', () => fixture(f => {
    f.auth.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<5000)
      INSERT INTO cloud_auth_users SELECT 'user-'||n,'First','Last',?,NULL FROM numbers`).run(f.now);
    f.store.exec(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<100000)
      INSERT INTO cloud_documents SELECT 'user-'||((n%5000)+1) FROM numbers`);
    const result = f.analytics.overview('admin');
    assert.strictEqual(result.totals.accounts, 5000);
    assert.strictEqual(result.totals.document_created, 5000);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 20000);
    assert.strictEqual(f.analytics.overview('admin'), result);
  }));
};
