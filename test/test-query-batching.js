'use strict';
const { startFixture } = require('./cloud-onboarding-fixture');
const { CloudReferrals } = require('../lib/cloud-referrals');
function trace(db) {
  const original = db.prepare, statements = [];
  db.prepare = function (sql) {
    const statement = original.call(this, sql);
    return new Proxy(statement, { get(target, key) {
      const value = target[key];
      if (['get', 'all', 'run', 'iterate'].includes(key)) return function (...args) {
        statements.push(sql); return value.apply(target, args);
      };
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  return { statements, stop() { db.prepare = original; } };
}
module.exports = ({ assert, testAsync }) => async () => {
  const f = await startFixture();
  try {
    await testAsync('batch account summaries preserve labels and identity ordering without per-user queries or private fields', async () => {
      const ids = [];
      for (let i = 0; i < 55; i++) {
        const user = f.auth.signInWithVerifiedEmail('batch-' + i + '@example.test').user;
        f.auth.updateUserProfile({ userId: user.id, firstName: 'Person', lastName: String(i) }); ids.push(user.id);
      }
      const tracing = trace(f.auth.db);
      let summaries;
      try { summaries = f.auth.getUserSummaries([...ids, ids[0], 'missing', "' OR 1=1"]); }
      finally { tracing.stop(); }
      assert.strictEqual(tracing.statements.length, 2); assert.strictEqual(summaries.size, 55);
      for (const id of ids) {
        const full = f.auth.getUser(id), summary = summaries.get(id);
        assert.strictEqual(summary.name, [full.firstName, full.lastName].filter(Boolean).join(' '));
        assert.strictEqual(summary.email, full.identities.find(value => value.verifiedEmail).verifiedEmail);
        assert.deepStrictEqual(Object.keys(summary).sort(), ['email', 'id', 'name']);
      }
    });
    await testAsync('workspace name and role revalidation uses two queries for many libraries', async () => {
      for (let i = 0; i < 20; i++) await f.store.createTeamWorkspace({ userId: f.users.bob.id, name: 'Library ' + i, projectName: 'Documents' });
      const tracing = trace(f.store.db);
      let libraries;
      try { libraries = await f.store.listWorkspaces(f.users.bob.id); } finally { tracing.stop(); }
      assert.strictEqual(libraries.length, 21); assert.strictEqual(tracing.statements.length, 2);
      assert.ok(libraries.every(value => value.role === 'owner'));
      const original = f.store._workspaceName;
      let changed = false;
      f.store._workspaceName = async function (row) {
        const name = await original.call(this, row);
        if (!changed) {
          changed = true;
          this.removeWorkspaceMember({ actorUserId: f.users.bob.id, workspaceId: f.team.workspaceId, userId: f.users.member.id });
        }
        return name;
      };
      try { assert.deepStrictEqual(await f.store.listWorkspaces(f.users.member.id), []); }
      finally { f.store._workspaceName = original; }
    });
    await testAsync('referral summary batches account names and reward totals while retaining referrer scoping', async () => {
      const referrals = new CloudReferrals({ billing: f.billing, auth: f.auth, store: f.store, secret: f.auth.pepper, origin: f.origin });
      const code = referrals.link(f.users.bob.id).code;
      let single;
      for (let i = 0; i < 20; i++) {
        const person = f.auth.signInWithVerifiedEmail('referred-' + i + '@example.test');
        const intentKey = 'batch-intent-' + i;
        referrals.rememberIntent(intentKey, code); referrals.attribute({ ...person, intentKey });
        if (i === 0) {
          const a = trace(f.auth.db), b = trace(f.billing.db);
          try { referrals.summary(f.users.bob.id); single = a.statements.length + b.statements.length; }
          finally { a.stop(); b.stop(); }
        }
      }
      const a = trace(f.auth.db), b = trace(f.billing.db);
      let result;
      try {
        result = referrals.summary(f.users.bob.id);
        assert.strictEqual(a.statements.length + b.statements.length, single);
        assert.strictEqual(a.statements.length, 2);
      } finally { a.stop(); b.stop(); }
      assert.strictEqual(result.referrals.length, 20);
      assert.ok(result.referrals.every(item => item.earned_person_months === 0));
      assert.strictEqual(referrals.summary(f.users.outsider.id).referrals.length, 0);
    });
  } finally { await f.close(); }
};
if (require.main === module) { const h = require('./runner'); module.exports(h)().then(() => h.report()); }
