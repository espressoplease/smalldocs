const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function (harness) {
  const { assert, test } = harness;
  const Database = require('better-sqlite3');
  const { createBillingStore } = require('../lib/cloud-billing');
  const { manage } = require('../ops/manage-cloud-access');

  test('manual Cloud access grants active non-expiring access without Stripe quotas', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-manual-cloud-'));
    const cloudDb = path.join(dir, 'cloud.db');
    const billingDb = path.join(dir, 'billing.db');
    const db = new Database(cloudDb);
    db.exec(`
      CREATE TABLE cloud_workspaces (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, deleted_at_ms INTEGER
      );
      CREATE TABLE cloud_workspace_memberships (
        workspace_id TEXT NOT NULL, user_id TEXT NOT NULL,
        status TEXT NOT NULL
      );
      INSERT INTO cloud_workspaces (id, kind, deleted_at_ms)
        VALUES ('workspace-free', 'team', NULL);
      INSERT INTO cloud_workspace_memberships (workspace_id, user_id, status)
        VALUES ('workspace-free', 'user-1', 'active'),
               ('workspace-free', 'user-2', 'active');
    `);
    db.close();
    try {
      const result = manage({ action: 'grant', workspace_id: 'workspace-free' }, {
        cloudDb, billingDb,
        planLimits: { team: { maxStoredBytes: 100, maxMembers: 2,
          maxProjects: 1, search: { maxRequests: 1, windowMs: 1000 } } },
      });
      assert.strictEqual(result.subscription.provider, 'manual');
      assert.strictEqual(result.subscription.status, 'active');
      assert.strictEqual(result.subscription.currentPeriodEndMs, null);
      assert.strictEqual(result.entitlements.access.write, true);
      assert.strictEqual(result.entitlements.limits.maxStoredBytes, null);
      assert.strictEqual(result.entitlements.limits.maxMembers, null);
      assert.strictEqual(result.entitlements.limits.maxProjects, null);
      assert.strictEqual(result.entitlements.limits.search.maxRequests, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('manual Cloud access refuses to replace a Stripe billing record', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-manual-cloud-'));
    const cloudDb = path.join(dir, 'cloud.db');
    const billingDb = path.join(dir, 'billing.db');
    const db = new Database(cloudDb);
    db.exec(`
      CREATE TABLE cloud_workspaces (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, deleted_at_ms INTEGER
      );
      CREATE TABLE cloud_workspace_memberships (
        workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL
      );
      INSERT INTO cloud_workspaces (id, kind, deleted_at_ms)
        VALUES ('workspace-paid', 'team', NULL);
      INSERT INTO cloud_workspace_memberships (workspace_id, user_id, status)
        VALUES ('workspace-paid', 'user-1', 'active');
    `);
    db.close();
    const billing = createBillingStore({ dbPath: billingDb });
    billing.upsertSubscription({ workspaceId: 'workspace-paid', plan: 'team',
      status: 'active', seatQuantity: 1, provider: 'stripe',
      providerSubscriptionId: 'sub_paid' });
    billing.db.close();
    try {
      assert.throws(() => manage({ action: 'grant', workspace_id: 'workspace-paid' }, {
        cloudDb, billingDb,
      }), /already has a stripe billing record/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
};
