const crypto = require('crypto');

const PLANS = Object.freeze(['personal', 'team']);
const STATUSES = Object.freeze(['active', 'past_due', 'canceled', 'read_only']);

class BillingError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'BillingError';
    this.code = code;
  }
}

function requiredText(value, field, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maxLength) {
    throw new BillingError('invalid_' + field, field + ' is required');
  }
  return text;
}

function optionalText(value, field, maxLength) {
  if (value == null || value === '') return null;
  return requiredText(value, field, maxLength);
}

function optionalTimestamp(value, field) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BillingError('invalid_' + field, field + ' must be a millisecond timestamp');
  }
  return value;
}

function optionalLimit(value, field) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new BillingError('invalid_plan_limits', field + ' must be a positive integer or null');
  }
  return value;
}

function normalizePlanLimits(input) {
  input = input || {};
  const search = input.search || {};
  const limits = {
    maxStoredBytes: optionalLimit(input.maxStoredBytes, 'maxStoredBytes'),
    maxFileBytes: optionalLimit(input.maxFileBytes, 'maxFileBytes'),
    revisionRetentionDays: optionalLimit(input.revisionRetentionDays, 'revisionRetentionDays'),
    maxProjects: optionalLimit(input.maxProjects, 'maxProjects'),
    maxMembers: optionalLimit(input.maxMembers, 'maxMembers'),
    search: {
      maxRequests: optionalLimit(search.maxRequests, 'search.maxRequests'),
      windowMs: optionalLimit(search.windowMs, 'search.windowMs'),
    },
  };
  if ((limits.search.maxRequests == null) !== (limits.search.windowMs == null)) {
    throw new BillingError('invalid_plan_limits', 'search maxRequests and windowMs must be configured together');
  }
  return Object.freeze(limits);
}

function normalizeUsage(input) {
  input = input || {};
  const fields = ['storedBytes', 'projectCount', 'memberCount', 'searchRequestsInWindow'];
  const usage = {};
  for (const field of fields) {
    const value = input[field] == null ? 0 : input[field];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new BillingError('invalid_usage', field + ' must be a non-negative integer');
    }
    usage[field] = value;
  }
  return usage;
}

function reached(value, limit) {
  return limit != null && value >= limit;
}

function exceeds(value, limit) {
  return limit != null && value > limit;
}

class CloudBillingStore {
  constructor(options) {
    options = options || {};
    if (!options.dbPath) throw new Error('dbPath is required');
    const Database = require('better-sqlite3');
    this.db = new Database(options.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.trialIdentitySecret = options.trialIdentitySecret || '';
    this.db.exec(`CREATE TABLE IF NOT EXISTS cloud_trial_feedback (
      user_id TEXT PRIMARY KEY, comment TEXT NOT NULL, rating INTEGER,
      created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
    )`);
    const configured = options.planLimits || {};
    this.planLimits = Object.freeze({
      personal: normalizePlanLimits(configured.personal),
      team: normalizePlanLimits(configured.team),
    });
    this._createSchema();
  }

  _createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_billing_personal_trials (
        user_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL UNIQUE,
        starts_at_ms INTEGER NOT NULL,
        ends_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cloud_billing_subscriptions (
        workspace_id TEXT PRIMARY KEY,
        plan TEXT NOT NULL CHECK(plan IN ('personal', 'team')),
        status TEXT NOT NULL CHECK(status IN ('active', 'past_due', 'canceled', 'read_only')),
        seat_quantity INTEGER NOT NULL CHECK(seat_quantity >= 1),
        provider TEXT,
        provider_customer_id TEXT,
        provider_subscription_id TEXT,
        current_period_end_ms INTEGER,
        grace_ends_at_ms INTEGER,
        retention_ends_at_ms INTEGER,
        cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK(cancel_at_period_end IN (0, 1)),
        canceled_at_ms INTEGER,
        provider_event_created_ms INTEGER,
        provider_subscription_created_ms INTEGER,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      DROP INDEX IF EXISTS cloud_billing_provider_customer_idx;
      CREATE INDEX IF NOT EXISTS cloud_billing_provider_customer_idx
        ON cloud_billing_subscriptions(provider, provider_customer_id)
        WHERE provider IS NOT NULL AND provider_customer_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS cloud_billing_provider_subscription_idx
        ON cloud_billing_subscriptions(provider, provider_subscription_id)
        WHERE provider IS NOT NULL AND provider_subscription_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS cloud_billing_webhook_events (
        provider TEXT NOT NULL,
        event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_digest TEXT,
        processed_at_ms INTEGER NOT NULL,
        PRIMARY KEY(provider, event_id)
      );
    `);
    if (!this.db.prepare('PRAGMA table_info(cloud_billing_personal_trials)').all().some(column => column.name === 'identity_hash')) {
      this.db.exec('ALTER TABLE cloud_billing_personal_trials ADD COLUMN identity_hash TEXT');
    }
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS cloud_personal_trial_identity ON cloud_billing_personal_trials(identity_hash) WHERE identity_hash IS NOT NULL');
    if (!this.db.prepare('PRAGMA table_info(cloud_billing_personal_trials)').all().some(column => column.name === 'plan')) {
      this.db.exec("ALTER TABLE cloud_billing_personal_trials ADD COLUMN plan TEXT NOT NULL DEFAULT 'personal'");
    }
    const columns = this.db.prepare('PRAGMA table_info(cloud_billing_subscriptions)').all();
    if (!columns.some((column) => column.name === 'provider_event_created_ms')) {
      this.db.exec('ALTER TABLE cloud_billing_subscriptions ADD COLUMN provider_event_created_ms INTEGER');
    }
    if (!columns.some((column) => column.name === 'provider_subscription_created_ms')) {
      this.db.exec('ALTER TABLE cloud_billing_subscriptions ADD COLUMN provider_subscription_created_ms INTEGER');
    }
    if (!columns.some((column) => column.name === 'retention_ends_at_ms')) {
      this.db.exec('ALTER TABLE cloud_billing_subscriptions ADD COLUMN retention_ends_at_ms INTEGER');
    }
    if (!columns.some((column) => column.name === 'cancel_at_period_end')) {
      this.db.exec(`
        ALTER TABLE cloud_billing_subscriptions
        ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK(cancel_at_period_end IN (0, 1))
      `);
    }
  }

  upsertSubscription(input) {
    input = input || {};
    const workspaceId = requiredText(input.workspaceId, 'workspace_id', 200);
    const plan = requiredText(input.plan, 'plan', 32).toLowerCase();
    const status = requiredText(input.status, 'status', 32).toLowerCase();
    if (!PLANS.includes(plan)) throw new BillingError('invalid_plan', 'plan must be personal or team');
    if (!STATUSES.includes(status)) throw new BillingError('invalid_status', 'status is not supported');
    const seatQuantity = input.seatQuantity == null ? 1 : input.seatQuantity;
    if (!Number.isSafeInteger(seatQuantity) || seatQuantity < 1) {
      throw new BillingError('invalid_seat_quantity', 'seatQuantity must be a positive integer');
    }
    if (plan === 'personal' && seatQuantity !== 1) {
      throw new BillingError('invalid_seat_quantity', 'personal subscriptions have one seat');
    }
    const providerValue = optionalText(input.provider, 'provider', 64);
    const provider = providerValue == null ? null : providerValue.toLowerCase();
    const providerCustomerId = optionalText(input.providerCustomerId, 'provider_customer_id', 512);
    const providerSubscriptionId = optionalText(input.providerSubscriptionId, 'provider_subscription_id', 512);
    if (!provider && (providerCustomerId || providerSubscriptionId)) {
      throw new BillingError('invalid_provider', 'provider is required with provider identifiers');
    }
    const now = this.now();
    const values = {
      workspaceId,
      plan,
      status,
      seatQuantity,
      provider,
      providerCustomerId,
      providerSubscriptionId,
      currentPeriodEndMs: optionalTimestamp(input.currentPeriodEndMs, 'current_period_end'),
      graceEndsAtMs: optionalTimestamp(input.graceEndsAtMs, 'grace_ends_at'),
      retentionEndsAtMs: optionalTimestamp(input.retentionEndsAtMs, 'retention_ends_at'),
      cancelAtPeriodEnd: input.cancelAtPeriodEnd === true ? 1 : 0,
      canceledAtMs: optionalTimestamp(input.canceledAtMs, 'canceled_at'),
      providerEventCreatedMs: optionalTimestamp(input.providerEventCreatedMs, 'provider_event_created'),
      providerSubscriptionCreatedMs: optionalTimestamp(
        input.providerSubscriptionCreatedMs, 'provider_subscription_created'),
    };
    const existing = this.getSubscription(workspaceId);
    if (existing && values.providerEventCreatedMs == null) {
      values.providerEventCreatedMs = existing.providerEventCreatedMs;
    }
    if (existing && values.providerSubscriptionCreatedMs == null &&
        existing.provider === values.provider &&
        existing.providerSubscriptionId === values.providerSubscriptionId) {
      values.providerSubscriptionCreatedMs = existing.providerSubscriptionCreatedMs;
    }
    const replacingProviderSubscription = existing && existing.provider === values.provider &&
      existing.providerSubscriptionId && values.providerSubscriptionId &&
      existing.providerSubscriptionId !== values.providerSubscriptionId;
    const replacementIsNewer = replacingProviderSubscription &&
      values.providerSubscriptionCreatedMs != null &&
      (existing.providerSubscriptionCreatedMs == null ||
       values.providerSubscriptionCreatedMs > existing.providerSubscriptionCreatedMs);
    if (replacingProviderSubscription && existing.providerSubscriptionCreatedMs != null &&
        !replacementIsNewer) {
      return existing;
    }
    if (!replacementIsNewer && existing &&
        values.providerEventCreatedMs != null && existing.providerEventCreatedMs != null &&
        values.providerEventCreatedMs < existing.providerEventCreatedMs) return existing;
    try {
      this.db.prepare(`
        INSERT INTO cloud_billing_subscriptions (
          workspace_id, plan, status, seat_quantity, provider, provider_customer_id,
          provider_subscription_id, current_period_end_ms, grace_ends_at_ms,
          retention_ends_at_ms, cancel_at_period_end, canceled_at_ms,
          provider_event_created_ms, provider_subscription_created_ms,
          created_at_ms, updated_at_ms
        ) VALUES (
          @workspaceId, @plan, @status, @seatQuantity, @provider, @providerCustomerId,
          @providerSubscriptionId, @currentPeriodEndMs, @graceEndsAtMs,
          @retentionEndsAtMs, @cancelAtPeriodEnd, @canceledAtMs,
          @providerEventCreatedMs, @providerSubscriptionCreatedMs, @now, @now
        )
        ON CONFLICT(workspace_id) DO UPDATE SET
          plan = excluded.plan,
          status = excluded.status,
          seat_quantity = excluded.seat_quantity,
          provider = excluded.provider,
          provider_customer_id = excluded.provider_customer_id,
          provider_subscription_id = excluded.provider_subscription_id,
          current_period_end_ms = excluded.current_period_end_ms,
          grace_ends_at_ms = excluded.grace_ends_at_ms,
          retention_ends_at_ms = excluded.retention_ends_at_ms,
          cancel_at_period_end = excluded.cancel_at_period_end,
          canceled_at_ms = excluded.canceled_at_ms,
          provider_event_created_ms = excluded.provider_event_created_ms,
          provider_subscription_created_ms = excluded.provider_subscription_created_ms,
          updated_at_ms = excluded.updated_at_ms
      `).run(Object.assign({}, values, { now }));
    } catch (error) {
      if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new BillingError('provider_identity_in_use', 'provider identifier belongs to another workspace');
      }
      throw error;
    }
    return this.getSubscription(workspaceId);
  }

  getSubscription(workspaceId) {
    const id = requiredText(workspaceId, 'workspace_id', 200);
    const row = this.db.prepare(`
      SELECT * FROM cloud_billing_subscriptions WHERE workspace_id = ?
    `).get(id);
    if (!row) return null;
    return {
      workspaceId: row.workspace_id,
      plan: row.plan,
      status: row.status,
      seatQuantity: row.seat_quantity,
      provider: row.provider,
      providerCustomerId: row.provider_customer_id,
      providerSubscriptionId: row.provider_subscription_id,
      currentPeriodEndMs: row.current_period_end_ms,
      graceEndsAtMs: row.grace_ends_at_ms,
      retentionEndsAtMs: row.retention_ends_at_ms,
      cancelAtPeriodEnd: row.cancel_at_period_end === 1,
      canceledAtMs: row.canceled_at_ms,
      providerEventCreatedMs: row.provider_event_created_ms,
      providerSubscriptionCreatedMs: row.provider_subscription_created_ms,
      createdAtMs: row.created_at_ms,
      updatedAtMs: row.updated_at_ms,
    };
  }

  recordTrialFeedback(input) {
    const userId = requiredText(input.userId, 'user_id', 256);
    const comment = requiredText(input.comment, 'comment', 10000);
    const rating = input.rating == null ? null : input.rating;
    if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      throw new BillingError('invalid_request', 'rating must be from 1 to 5');
    }
    const now = this.now();
    this.db.prepare(`INSERT INTO cloud_trial_feedback VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET comment=excluded.comment, rating=excluded.rating,
      updated_at_ms=excluded.updated_at_ms`).run(userId, comment, rating, now, now);
    return { received: true, updated_at_ms: now };
  }

  ensurePersonalTrial(input) {
    const userId = requiredText(input.userId, 'user_id', 256);
    const workspaceId = requiredText(input.workspaceId, 'workspace_id', 200);
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM cloud_billing_personal_trials WHERE user_id = ?').get(userId);
      if (existing && existing.workspace_id === workspaceId) return { created: false, workspaceId, endsAtMs: existing.ends_at_ms };
      if (existing && !this.getSubscription(workspaceId)) throw new BillingError('trial_already_used');
      // Paid or manually provisioned accounts retain their existing entitlement.
      if (this.getSubscription(workspaceId)) return { created: false, workspaceId, endsAtMs: null };
      let identityHash = null;
      if (input.verifiedEmail) {
        if (this.trialIdentitySecret.length < 16) throw new BillingError('billing_not_configured');
        identityHash = crypto.createHmac('sha256', this.trialIdentitySecret).update('personal-trial:' + input.verifiedEmail.trim().toLowerCase()).digest('hex');
        const used = this.db.prepare('SELECT user_id FROM cloud_billing_personal_trials WHERE identity_hash = ?').get(identityHash);
        if (used) throw new BillingError('trial_already_used');
      }
      const now = this.now();
      const end = new Date(now);
      const day = end.getUTCDate();
      end.setUTCDate(1);
      end.setUTCMonth(end.getUTCMonth() + 1);
      const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
      end.setUTCDate(Math.min(day, lastDay));
      this.db.prepare('INSERT INTO cloud_billing_personal_trials (user_id, workspace_id, starts_at_ms, ends_at_ms, identity_hash) VALUES (?, ?, ?, ?, ?)').run(userId, workspaceId, now, end.getTime(), identityHash);
      return { created: true, workspaceId, endsAtMs: end.getTime() };
    }).immediate();
  }

  computeEntitlements(workspaceId, usageInput) {
    let subscription = this.getSubscription(workspaceId);
    const trial = !subscription && this.db.prepare('SELECT * FROM cloud_billing_personal_trials WHERE workspace_id = ?').get(workspaceId);
    const trialActive = trial && this.now() < trial.ends_at_ms;
    if (trial) subscription = { workspaceId, plan: trial.plan, status: trialActive ? 'active' : 'read_only',
      provider: 'trial', seatQuantity: trial.plan === 'team' ? Math.max(1, Number(usageInput && usageInput.memberCount) || 1) : 1, currentPeriodEndMs: trial.ends_at_ms };
    const usage = normalizeUsage(usageInput);
    if (!subscription) {
      return {
        workspaceId,
        plan: null,
        subscriptionStatus: null,
        effectiveStatus: 'none',
        access: { read: false, write: false, search: false, manageMembers: false },
        limits: null,
        usage,
        blockedBy: ['subscription_required'],
      };
    }

    const configured = this.planLimits[subscription.plan];
    const manualAccess = subscription.provider === 'manual';
    const memberLimit = subscription.plan === 'personal' ? 1
      : manualAccess ? null : configured.maxMembers;
    const limits = {
      maxStoredBytes: manualAccess ? null : configured.maxStoredBytes,
      maxFileBytes: configured.maxFileBytes,
      revisionRetentionDays: configured.revisionRetentionDays,
      maxProjects: manualAccess ? null : configured.maxProjects,
      maxMembers: memberLimit,
      search: manualAccess ? { maxRequests: null, windowMs: null } : configured.search,
      documentCount: null,
      billedSeats: subscription.seatQuantity,
    };
    const inGrace = subscription.status === 'past_due' &&
      subscription.graceEndsAtMs != null && this.now() < subscription.graceEndsAtMs;
    const cancellationEffective = subscription.status === 'active' &&
      subscription.cancelAtPeriodEnd && subscription.currentPeriodEndMs != null &&
      this.now() >= subscription.currentPeriodEndMs;
    const write = (subscription.status === 'active' && !cancellationEffective) || inGrace;
    const read = true;
    const blockedBy = [];
    if (!write) blockedBy.push(subscription.status === 'past_due'
      ? 'payment_grace_expired' : 'subscription_read_only');
    if (reached(usage.storedBytes, limits.maxStoredBytes)) blockedBy.push('storage_limit_reached');
    if (reached(usage.projectCount, limits.maxProjects)) blockedBy.push('project_limit_reached');
    if (reached(usage.memberCount, limits.maxMembers)) blockedBy.push('member_limit_reached');
    const searchExhausted = reached(usage.searchRequestsInWindow, limits.search.maxRequests);
    if (searchExhausted) blockedBy.push('search_limit_reached');

    return {
      workspaceId: subscription.workspaceId,
      plan: subscription.plan,
      subscriptionStatus: subscription.status,
      trialEndsAtMs: trial ? trial.ends_at_ms : null,
      effectiveStatus: trial ? (trialActive ? 'trial' : 'trial_ended') : inGrace ? 'past_due_grace'
        : cancellationEffective ? 'canceled' : subscription.status,
      access: {
        read,
        write,
        search: read && !searchExhausted,
        manageMembers: write && subscription.plan === 'team',
      },
      limits,
      usage,
      blockedBy,
    };
  }

  checkOperation(workspaceId, input) {
    input = input || {};
    const operation = requiredText(input.operation, 'operation', 64);
    const entitlements = input.entitlements || this.computeEntitlements(workspaceId, input.usage);
    if (operation === 'read') return { allowed: entitlements.access.read, reason: entitlements.access.read ? null : 'subscription_required', entitlements };
    if (operation === 'search') {
      const reason = entitlements.access.search
        ? null
        : entitlements.blockedBy.includes('search_limit_reached')
          ? 'search_limit_reached'
          : entitlements.blockedBy[0] || 'subscription_required';
      return { allowed: entitlements.access.search, reason, entitlements };
    }
    if (!entitlements.access.write) return { allowed: false, reason: entitlements.blockedBy[0] || 'subscription_required', entitlements };

    let reason = null;
    if (operation === 'store_revision') {
      const fileBytes = input.fileBytes == null ? 0 : input.fileBytes;
      const storedBytesDelta = input.storedBytesDelta == null ? fileBytes : input.storedBytesDelta;
      if (!Number.isSafeInteger(fileBytes) || fileBytes < 0 ||
          !Number.isSafeInteger(storedBytesDelta) || storedBytesDelta < 0) {
        throw new BillingError('invalid_usage', 'file byte values must be non-negative integers');
      }
      if (exceeds(fileBytes, entitlements.limits.maxFileBytes)) reason = 'file_too_large';
      else if (exceeds(entitlements.usage.storedBytes + storedBytesDelta, entitlements.limits.maxStoredBytes)) reason = 'storage_limit_exceeded';
    } else if (operation === 'create_project' && reached(entitlements.usage.projectCount, entitlements.limits.maxProjects)) {
      reason = 'project_limit_reached';
    } else if (operation === 'add_member' && reached(entitlements.usage.memberCount, entitlements.limits.maxMembers)) {
      reason = 'member_limit_reached';
    } else if (!['manage', 'store_revision', 'create_project', 'add_member'].includes(operation)) {
      throw new BillingError('invalid_operation', 'operation is not supported');
    }
    return { allowed: reason == null, reason, entitlements };
  }

  recordWebhookEvent(input) {
    input = input || {};
    const provider = requiredText(input.provider, 'provider', 64);
    const eventId = requiredText(input.eventId, 'event_id', 512);
    const eventType = requiredText(input.eventType, 'event_type', 200);
    let payloadDigest = null;
    if (input.payload != null) {
      const payload = Buffer.isBuffer(input.payload) ? input.payload : Buffer.from(String(input.payload));
      payloadDigest = crypto.createHash('sha256').update(payload).digest('hex');
    }
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO cloud_billing_webhook_events
        (provider, event_id, event_type, payload_digest, processed_at_ms)
      VALUES (?, ?, ?, ?, ?)
    `).run(provider, eventId, eventType, payloadDigest, this.now());
    return { recorded: result.changes === 1, duplicate: result.changes === 0 };
  }

  processWebhookEvent(input, apply) {
    if (typeof apply !== 'function') throw new Error('apply callback is required');
    return this.db.transaction(() => {
      const recorded = this.recordWebhookEvent(input);
      if (recorded.duplicate) return { processed: false, duplicate: true };
      const value = apply(this);
      if (value && typeof value.then === 'function') {
        throw new Error('webhook apply callback must be synchronous');
      }
      return { processed: true, duplicate: false, value };
    }).immediate();
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

function createBillingStore(options) {
  return new CloudBillingStore(options);
}

module.exports = {
  BillingError,
  CloudBillingStore,
  PLANS,
  STATUSES,
  createBillingStore,
  normalizePlanLimits,
};
