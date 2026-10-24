'use strict';
const { applyTrialPolicy } = require('./cloud-trial-policy');
// A library owns content and membership. A billing account pays for unique people.
// Legacy subscription plan codes remain an implementation detail of the billing adapter.
class SinglePlan {
  constructor({ billing, store }) {
    this.billing = billing; this.store = store; this.db = billing.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_single_checkouts (account_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, quantity INTEGER NOT NULL, session_id TEXT, url TEXT);
      CREATE TABLE IF NOT EXISTS cloud_single_accounts (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS cloud_single_libraries (workspace_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES cloud_single_accounts(id));
      CREATE TABLE IF NOT EXISTS cloud_single_sponsors (user_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES cloud_single_accounts(id), source_workspace_id TEXT NOT NULL);
    `);
    if (!this.db.prepare('PRAGMA table_info(cloud_single_accounts)').all().some(column => column.name === 'standard_subscription_id')) {
      this.db.exec('ALTER TABLE cloud_single_accounts ADD COLUMN standard_subscription_id TEXT');
    }
  }
  account(workspaceId) { return this.db.prepare('SELECT a.* FROM cloud_single_libraries l JOIN cloud_single_accounts a ON a.id=l.account_id WHERE l.workspace_id=?').get(workspaceId); }
  ownAccount(userId) { return this.db.prepare('SELECT * FROM cloud_single_accounts WHERE owner_user_id=?').get(userId); }
  migrationReview(userId) {
    const libraries = this.store.db.prepare(`SELECT w.id FROM cloud_workspaces w
      JOIN cloud_workspace_memberships m ON m.workspace_id=w.id
      WHERE m.user_id=? AND m.role='owner' AND m.status='active' AND w.created_by_user_id=? AND w.deleted_at_ms IS NULL
      ORDER BY w.created_at_ms,w.id`).all(userId, userId);
    const ranked = libraries.map(row => {
      const subscription = this.billing.getSubscription(row.id);
      const trial = this.db.prepare('SELECT ends_at_ms FROM cloud_billing_personal_trials WHERE workspace_id=?').get(row.id);
      const live = subscription && subscription.status !== 'canceled';
      return { workspace_id: row.id, provider: subscription && subscription.provider,
        subscription_id: subscription && subscription.providerSubscriptionId,
        score: live && subscription.provider === 'stripe' ? 4 : live ? 3 : trial ? 2 : subscription ? 1 : 0 };
    }).sort((a, b) => b.score - a.score);
    const paid = ranked.filter(row => row.score === 4 && row.subscription_id);
    return { user_id: userId, account_id: this.ownAccount(userId)?.id || ranked[0]?.workspace_id || null,
      libraries: ranked.map(row => row.workspace_id),
      subscription_conflicts: paid.length > 1 ? paid.map(row => row.subscription_id) : [] };
  }
  attach(userId, workspaceId) {
    const existing = this.account(workspaceId);
    if (existing) return existing;
    this.store._requireWorkspaceRole(userId, workspaceId, ['owner']);
    return this.db.transaction(() => {
      const review = this.migrationReview(userId);
      this.db.prepare('INSERT OR IGNORE INTO cloud_single_accounts (id,owner_user_id) VALUES (?, ?)').run(review.account_id || workspaceId, userId);
      const account = this.ownAccount(userId);
      this.db.prepare('INSERT OR IGNORE INTO cloud_single_libraries VALUES (?, ?)').run(workspaceId, account.id);
      return account;
    }).immediate();
  }
  initialize(userId, workspaceId, email) {
    const account = this.attach(userId, workspaceId);
    this.store.enableLibraryCollaboration({ userId, workspaceId });
    const trial = this.db.prepare('SELECT ends_at_ms FROM cloud_billing_personal_trials WHERE workspace_id=?').get(account.id);
    // A library ownership transfer keeps its original payer and trial deadline.
    if (!this.billing.getSubscription(account.id) && !trial && account.owner_user_id === userId) {
      this.billing.ensurePersonalTrial({ userId, workspaceId: account.id, verifiedEmail: email });
    }
    if (trial || account.owner_user_id === userId) {
      this.db.prepare("UPDATE cloud_billing_personal_trials SET plan='team' WHERE workspace_id=?").run(account.id);
    }
    this.claim(userId, workspaceId);
    return account;
  }
  async checkout({ userId, stripe, priceId, origin, email }) {
    const account = this.selfAccount(userId);
    const covered = this.coverage(userId);
    if (covered && covered.account_id !== account.id && this.hasSponsoredMembership(userId, covered.account_id)
      && this.billing.getSubscription(covered.account_id) && this.subscriptionAccess(covered.account_id).access.write) {
      throw Object.assign(new Error('already_covered'), { code: 'already_covered' });
    }
    const existing = this.billing.getSubscription(account.id);
    if (existing && existing.status !== 'canceled') throw Object.assign(new Error('subscription_exists'), { code: 'subscription_exists' });
    const quantity = this.seatCount(account.id);
    let row = this.db.prepare('SELECT * FROM cloud_single_checkouts WHERE account_id=?').get(account.id);
    if (row && row.session_id) {
      const session = await stripe.retrieveCheckoutSession({ sessionId: row.session_id });
      if (session.status === 'complete') throw Object.assign(new Error('subscription_pending'), { code: 'subscription_pending' });
      if (session.status === 'open' && row.quantity === quantity) return { id: session.id, url: session.url };
      if (session.status === 'open') await stripe.expireCheckoutSession({ sessionId: row.session_id });
      this.db.prepare('DELETE FROM cloud_single_checkouts WHERE account_id=? AND operation_id=?').run(account.id, row.operation_id);
      row = null;
    }
    if (!row) {
      this.db.prepare('INSERT OR IGNORE INTO cloud_single_checkouts VALUES (?, ?, ?, NULL, NULL)').run(account.id, require('crypto').randomUUID(), quantity);
      row = this.db.prepare('SELECT * FROM cloud_single_checkouts WHERE account_id=?').get(account.id);
    }
    const session = await stripe.createCheckoutSubscriptionSession({ priceId, quantity: row.quantity, workspaceId: account.id, plan: 'team', customerEmail: email,
      metadata: { owner_user_id: userId, single_plan: 'true', single_checkout_operation_id: row.operation_id }, successUrl: origin + '/cloud/start?subscribed=1',
      cancelUrl: origin + '/cloud/subscribe', idempotencyKey: 'single-checkout-' + row.operation_id });
    this.db.prepare('UPDATE cloud_single_checkouts SET session_id=?, url=? WHERE account_id=? AND operation_id=?').run(session.id, session.url, account.id, row.operation_id);
    return session;
  }

  resolveLibrary(workspaceId) {
    const existing = this.account(workspaceId);
    if (existing) return existing;
    const owner = this.store.listWorkspaceOwnerUserIds(workspaceId)[0];
    return owner ? this.attach(owner, workspaceId) : null;
  }
  selfAccount(userId) {
    let account = this.ownAccount(userId);
    if (!account) {
      const id = require('crypto').randomUUID();
      this.db.prepare('INSERT OR IGNORE INTO cloud_single_accounts (id,owner_user_id) VALUES (?, ?)').run(id, userId);
      account = this.ownAccount(userId);
    }
    return account;
  }
  subscriptionAccess(accountId) { return applyTrialPolicy(this.billing.computeEntitlements(accountId), this.billing.now()); }
  coverage(userId) { return this.db.prepare('SELECT * FROM cloud_single_sponsors WHERE user_id=?').get(userId); }
  claim(userId, workspaceId) {
    this.store._requireWorkspaceRole(userId, workspaceId, ['owner', 'admin', 'member']);
    const account = this.resolveLibrary(workspaceId);
    if (!account) return;
    const current = this.coverage(userId);
    // An active paid seat elsewhere must never be charged again here.
    if (current) {
      const subscription = this.billing.getSubscription(current.account_id);
      if (subscription && this.hasSponsoredMembership(userId, current.account_id) && this.subscriptionAccess(current.account_id).access.write) return current;
    }
    if (!this.subscriptionAccess(account.id).access.write) return current;
    this.db.prepare(`INSERT INTO cloud_single_sponsors VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET account_id=excluded.account_id, source_workspace_id=excluded.source_workspace_id`)
      .run(userId, account.id, workspaceId);
    return this.coverage(userId);
  }
  seatCount(accountId) {
    const rows = this.db.prepare('SELECT * FROM cloud_single_sponsors WHERE account_id=?').all(accountId);
    return Math.max(1, rows.filter(row => this.hasSponsoredMembership(row.user_id, accountId)).length);
  }
  hasSponsoredMembership(userId, accountId) {
    if (this.db.prepare('SELECT 1 FROM cloud_single_accounts WHERE id=? AND owner_user_id=?').get(accountId, userId)) return true;
    const libraries = this.db.prepare('SELECT workspace_id FROM cloud_single_libraries WHERE account_id=?').all(accountId);
    return libraries.some(row => this.store._workspaceRole(userId, row.workspace_id));
  }
  entitlements(userId, workspaceId, usage) {
    this.store._requireWorkspaceRole(userId, workspaceId, ['owner', 'admin', 'member']);
    const sponsor = this.coverage(userId);
    const account = sponsor && this.hasSponsoredMembership(userId, sponsor.account_id) ? sponsor.account_id : null;
    let result = this.billing.computeEntitlements(account || '__no_subscription__', usage);
    const originalTrial = this.db.prepare('SELECT ends_at_ms FROM cloud_billing_personal_trials WHERE user_id=?').get(userId);
    result = applyTrialPolicy(result, this.billing.now(), originalTrial && originalTrial.ends_at_ms);
    // Paid subscriptions retain the existing read-only cancellation policy.
    // Expired trials require payment for content. Document permissions apply separately.
    return { ...result, workspaceId, plan: result.plan ? 'standard' : null,
      limits: { ...this.billing.planLimits.team, billedSeats: account ? this.seatCount(account) : 0 },
      access: { ...result.access, read: result.effectiveStatus !== 'payment_required',
        search: result.effectiveStatus !== 'payment_required' && !result.blockedBy.includes('search_limit_reached'), manageMembers: result.access.write },
      covered: Boolean(result.access.write),
      billing_account_id: account && this.ownAccount(userId)?.id === account ? account : null };
  }
  check(userId, workspaceId, input) {
    const entitlements = this.entitlements(userId, workspaceId, input.usage);
    if (entitlements.effectiveStatus === 'payment_required') return { allowed: false, reason: 'trial_payment_required', entitlements };
    if (input.operation === 'read') return { allowed: true, entitlements };
    if (input.operation === 'search') return { allowed: entitlements.access.search, reason: entitlements.access.search ? null : 'search_limit_reached', entitlements };
    if (!entitlements.access.write) return { allowed: false, reason: 'subscription_read_only', entitlements };
    const sponsor = this.coverage(userId);
    const result = this.billing.checkOperation(sponsor.account_id, { ...input, entitlements });
    return { ...result, entitlements };
  }
}
module.exports = { SinglePlan };
