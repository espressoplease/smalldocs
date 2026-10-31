'use strict';
const crypto = require('crypto');
const { buildStripeSubscriptionUpdate } = require('./cloud-billing-lifecycle');
function fail(code) { throw Object.assign(new Error(code), { code }); }
function table(billing) {
  billing.db.exec(`CREATE TABLE IF NOT EXISTS cloud_library_upgrades (
    workspace_id TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL,
    state TEXT NOT NULL, data TEXT NOT NULL
  )`);
}
async function owned(input) {
  const workspace = (await input.store.listWorkspaces(input.userId)).find(w => w.id === input.workspaceId && w.role === 'owner');
  if (!workspace) fail('permission_denied');
  return workspace;
}
function summary(input) {
  const rows = input.store.db.prepare(`SELECT d.id, d.created_by_user_id, g.mode FROM cloud_documents d
    LEFT JOIN cloud_permission_groups g ON g.document_id = d.id
    WHERE d.workspace_id = ? AND d.deleted_at_ms IS NULL ORDER BY d.id`).all(input.workspaceId);
  return { document_count: rows.length, everyone_count: rows.filter(row => row.mode === 'everyone').length,
    unchanged_count: rows.filter(row => row.mode !== 'everyone').length };
}
function fingerprint(subscription, usage, access) {
  return JSON.stringify({ subscription, members: usage.memberCount, access });
}
async function preview(input) {
  const workspace = await owned(input);
  table(input.billing);
  const previous = input.billing.db.prepare('SELECT * FROM cloud_library_upgrades WHERE workspace_id = ?').get(workspace.id);
  if (previous && previous.state === 'processing') return { preview: JSON.parse(previous.data), processing: true };
  if (workspace.kind === 'team') return { workspace_id: workspace.id, completed: true };
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 512) fail('invalid_request');
  const subscription = input.billing.getSubscription(workspace.id);
  const trial = input.billing.db.prepare('SELECT * FROM cloud_billing_personal_trials WHERE workspace_id = ?').get(workspace.id);
  const usage = input.store.getWorkspaceUsage({ workspaceId: workspace.id, skipAccess: true });
  const access = summary(input);
  const data = { operation_id: crypto.randomUUID(), workspace_id: workspace.id, name: input.name.trim(),
    ...access, trial_ends_at_ms: trial && !subscription ? trial.ends_at_ms : null,
    snapshot: fingerprint(subscription, usage, access), seats: Math.max(1, usage.memberCount),
    team_limits: input.billing.planLimits.team,
    billing_kind: subscription ? subscription.provider : 'trial',
    requires_subscription: !subscription && (!trial || trial.ends_at_ms <= Date.now()) };
  if (subscription && subscription.provider === 'stripe') {
    if (!input.stripe || !input.teamPriceId) fail('billing_not_configured');
    const remote = await input.stripe.retrieveSubscription({ subscriptionId: subscription.providerSubscriptionId });
    if (remote.status !== 'active' || remote.items.data.length !== 1 || remote.schedule) fail('billing_update_required');
    const item = remote.items.data[0];
    if (remote.metadata.plan !== 'personal' || remote.metadata.workspace_id !== workspace.id) fail('billing_update_required');
    data.proration_date = Math.floor(Date.now() / 1000);
    data.subscription_id = remote.id; data.item_id = item.id; data.price_id = input.teamPriceId;
    data.remote_snapshot = remoteSnapshot(remote);
    const price = await input.stripe.retrievePrice({ priceId: input.teamPriceId });
    data.currency = remote.currency || item.price.currency;
    const rate = price.currency === data.currency ? price : (price.currency_options || {})[data.currency];
    if (!rate || !Number.isSafeInteger(rate.unit_amount) || !price.active || !price.recurring || price.recurring.interval !== 'month' || price.recurring.interval_count !== 1) fail('billing_update_required');
    data.unit_amount = rate.unit_amount;
    const invoice = await input.stripe.previewTeamUpgrade({ subscriptionId: remote.id, itemId: item.id,
      priceId: input.teamPriceId, quantity: data.seats, prorationDate: data.proration_date });
    if (invoice.currency !== data.currency || !Number.isSafeInteger(invoice.amount_due)) fail('billing_update_required');
    data.amount_due = invoice.amount_due;
    data.cancel_at_period_end = remote.cancel_at_period_end === true;
    data.period_end = item.current_period_end || remote.current_period_end;
  } else if (subscription && subscription.provider !== 'manual') fail('billing_update_required');
  const saved = input.billing.db.prepare(`INSERT INTO cloud_library_upgrades VALUES (?, ?, ?, 'preview', ?)
    ON CONFLICT(workspace_id) DO UPDATE SET id=excluded.id, user_id=excluded.user_id, state='preview', data=excluded.data
    WHERE cloud_library_upgrades.state = 'preview'`)
    .run(workspace.id, data.operation_id, input.userId, JSON.stringify(data));
  if (!saved.changes) fail('upgrade_in_progress');
  return { preview: data };
}
function remoteSnapshot(remote) {
  const item = remote.items.data[0];
  return JSON.stringify({ status: remote.status, price: item.price.id, quantity: item.quantity,
    currency: remote.currency, cancellation: remote.cancel_at_period_end, cancel_at: remote.cancel_at,
    period: item.current_period_end || remote.current_period_end, schedule: remote.schedule });
}
async function confirm(input) {
  const workspace = await owned(input);
  table(input.billing);
  const row = input.billing.db.prepare('SELECT * FROM cloud_library_upgrades WHERE workspace_id = ? AND id = ? AND user_id = ?')
    .get(workspace.id, input.operationId, input.userId);
  if (!row) fail('resource_unavailable');
  const data = JSON.parse(row.data);
  if (row.state === 'completed') return { workspace_id: workspace.id, completed: true };
  const subscription = input.billing.getSubscription(workspace.id);
  const usage = input.store.getWorkspaceUsage({ workspaceId: workspace.id, skipAccess: true });
  if (row.state === 'preview') {
    if (data.snapshot !== fingerprint(subscription, usage, summary(input))) fail('upgrade_preview_changed');
    const changed = input.billing.db.prepare("UPDATE cloud_library_upgrades SET state = 'processing' WHERE id = ? AND state = 'preview'").run(row.id);
    if (!changed.changes) fail('upgrade_in_progress');
  }
  if (data.billing_kind === 'stripe') {
    if (!input.stripe) fail('billing_not_configured');
    let remote = await input.stripe.retrieveSubscription({ subscriptionId: data.subscription_id });
    if (remote.metadata.upgrade_operation_id !== row.id) {
      if (remoteSnapshot(remote) !== data.remote_snapshot) {
        input.billing.db.prepare("UPDATE cloud_library_upgrades SET state = 'preview' WHERE id = ?").run(row.id);
        fail('upgrade_preview_changed');
      }
      try { remote = await input.stripe.upgradeSubscription({ subscriptionId: data.subscription_id, itemId: data.item_id,
        priceId: data.price_id, quantity: data.seats, prorationDate: data.proration_date,
        workspaceId: workspace.id, operationId: row.id, idempotencyKey: 'team-upgrade-' + row.id }); } catch (error) {
        // A declined invoice leaves the provider subscription unchanged. A new preview can retry it.
        // Network failures remain resumable with the same provider idempotency key.
        if (error.code === 'stripe_api_error' && error.status === 402) {
          input.billing.db.prepare("UPDATE cloud_library_upgrades SET state = 'preview' WHERE id = ?").run(row.id);
        }
        throw error;
      }
    }
    if (remote.status !== 'active' || remote.metadata.plan !== 'team' || remote.metadata.workspace_id !== workspace.id || remote.items.data[0].price.id !== data.price_id) fail('billing_update_required');
    input.billing.upsertSubscription(buildStripeSubscriptionUpdate({ subscription: remote,
      existing: input.billing.getSubscription(workspace.id), eventCreatedMs: Date.now() }));
  }
  await input.store.convertPersonalToTeam({ userId: input.userId, workspaceId: workspace.id, name: data.name });
  if (data.billing_kind === 'trial') input.billing.db.prepare("UPDATE cloud_billing_personal_trials SET plan = 'team' WHERE workspace_id = ?").run(workspace.id);
  if (data.billing_kind === 'manual') input.billing.upsertSubscription({ ...subscription, plan: 'team' });
  input.billing.db.prepare("UPDATE cloud_library_upgrades SET state = 'completed' WHERE id = ?").run(row.id);
  return { workspace_id: workspace.id, completed: true, requires_subscription: data.requires_subscription };
}
async function recoverLocal(input) {
  table(input.billing);
  const rows = input.billing.db.prepare("SELECT * FROM cloud_library_upgrades WHERE user_id = ? AND state = 'processing'").all(input.userId);
  for (const row of rows) {
    if (JSON.parse(row.data).billing_kind !== 'stripe') {
      await confirm({ ...input, workspaceId: row.workspace_id, operationId: row.id });
    }
  }
}
module.exports = { preview, confirm, recoverLocal };
