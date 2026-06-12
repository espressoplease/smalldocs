/**
 * Teams-interest data model + notify pure-function tests.
 * The SMTP dialogue itself is not exercised here (it needs a live,
 * authenticated server); these pin the parts that can regress silently.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

module.exports = function(harness) {
  const { assert, test, testAsync } = harness;

  return async function() {
    console.log('\n── Teams Interest Tests ─────────────────────────\n');

    const teams = require('../teams/db');
    const notify = require('../teams/notify');
    const tmpDb = path.join(os.tmpdir(), 'sdocs-test-teams-unit-' + process.pid + '.db');

    test('teams db: insert + list round-trip', () => {
      teams.init(tmpDb);
      const id = teams.insert({ email: 'a@b.co', company: ' Acme ', message: 'hello' });
      assert.ok(id > 0);
      const rows = teams.list();
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].email, 'a@b.co');
      assert.strictEqual(rows[0].company, 'Acme');
      assert.strictEqual(rows[0].message, 'hello');
    });

    test('teams db: blank optional fields stored as null', () => {
      teams.insert({ email: 'c@d.co', company: '   ', message: '' });
      const rows = teams.list();
      assert.strictEqual(rows[0].company, null);
      assert.strictEqual(rows[0].message, null);
    });

    test('teams db: empty email throws', () => {
      assert.throws(() => teams.insert({ email: '  ' }), /email/);
    });

    await testAsync('notify: unconfigured env reports not_configured and never sends', async () => {
      delete process.env.NOTIFY_SMTP_USER;
      delete process.env.NOTIFY_SMTP_PASS;
      assert.strictEqual(notify.isConfigured(), false);
      const r = await notify.send('subject', 'body');
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.error, 'not_configured');
    });

    test('notify: dot-stuffing doubles leading dots and normalizes CRLF', () => {
      assert.strictEqual(notify.dotStuff('a\n.b\nc'), 'a\r\n..b\r\nc');
      assert.strictEqual(notify.dotStuff('.start'), '..start');
      assert.strictEqual(notify.dotStuff('no dots'), 'no dots');
    });

    teams.close();
    try { fs.unlinkSync(tmpDb); } catch (_) {}
    try { fs.unlinkSync(tmpDb + '-wal'); } catch (_) {}
    try { fs.unlinkSync(tmpDb + '-shm'); } catch (_) {}
  };
};
