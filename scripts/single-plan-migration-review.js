// Read-only review of existing subscriptions before enabling the single-plan model.
'use strict';
const Database = require('better-sqlite3');
const { SinglePlan } = require('../lib/cloud-single-plan');
const storeDb = new Database(process.env.CLOUD_DB, { readonly: true, fileMustExist: true });
const billingDb = new Database(process.env.CLOUD_BILLING_DB, { readonly: true, fileMustExist: true });
try {
  const mapped = billingDb.prepare("SELECT 1 FROM sqlite_master WHERE name='cloud_single_accounts'").get();
  const context = { store: { db: storeDb }, db: billingDb,
    ownAccount: userId => mapped ? billingDb.prepare('SELECT * FROM cloud_single_accounts WHERE owner_user_id=?').get(userId) : null,
    billing: { getSubscription: workspaceId => {
      const row = billingDb.prepare('SELECT * FROM cloud_billing_subscriptions WHERE workspace_id=?').get(workspaceId);
      return row && { status: row.status, plan: row.plan, provider: row.provider, providerSubscriptionId: row.provider_subscription_id };
    } } };
  const trials = billingDb.prepare("SELECT 1 FROM sqlite_master WHERE name='cloud_billing_personal_trials'").get();
  if (!trials) context.db = { prepare: sql => /FROM cloud_billing_personal_trials/.test(sql)
    ? { get: () => undefined } : billingDb.prepare(sql) };
  const owners = storeDb.prepare("SELECT DISTINCT user_id FROM cloud_workspace_memberships WHERE role='owner' AND status='active'").all();
  const accounts = owners.map(row => SinglePlan.prototype.migrationReview.call(context, row.user_id));
  console.log(JSON.stringify({ read_only: true, owner_count: owners.length,
    conflict_count: accounts.filter(row => row.subscription_conflicts.length).length, accounts }, null, 2));
} finally { storeDb.close(); billingDb.close(); }
