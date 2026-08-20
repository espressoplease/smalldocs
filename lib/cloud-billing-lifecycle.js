'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_POLICY = Object.freeze({
  paymentGraceMs: 7 * DAY_MS,
  failedPaymentRetentionMs: 60 * DAY_MS,
  cancellationRetentionMs: 30 * DAY_MS,
  deletionWarningMs: 7 * DAY_MS,
});

const DEFAULT_PLAN_LIMITS = Object.freeze({
  personal: Object.freeze({ maxStoredBytes: 1024 * 1024 * 1024,
    maxFileBytes: 10 * 1024 * 1024, revisionRetentionDays: 90,
    maxProjects: null, maxMembers: 1,
    search: Object.freeze({ maxRequests: null, windowMs: null }) }),
  team: Object.freeze({ maxStoredBytes: 5 * 1024 * 1024 * 1024,
    maxFileBytes: 10 * 1024 * 1024, revisionRetentionDays: 90,
    maxProjects: null, maxMembers: null,
    search: Object.freeze({ maxRequests: null, windowMs: null }) }),
});

const STATUS_MAP = Object.freeze({
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  unpaid: 'read_only',
  paused: 'read_only',
  canceled: 'canceled',
  incomplete: 'read_only',
  incomplete_expired: 'canceled',
});

function safeTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function secondsToMs(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value * 1000 : null;
}

function addMs(value, duration) {
  if (value == null || !Number.isSafeInteger(duration) || duration < 1) return null;
  const result = value + duration;
  return Number.isSafeInteger(result) ? result : null;
}

function sameProviderSubscription(existing, providerSubscriptionId) {
  return Boolean(existing && existing.provider === 'stripe' &&
    existing.providerSubscriptionId === providerSubscriptionId);
}

function policyValue(policy, name) {
  const value = policy && policy[name];
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_POLICY[name];
}

function buildStripeSubscriptionUpdate(input) {
  input = input || {};
  const subscription = input.subscription || {};
  const existing = input.existing || null;
  const now = safeTimestamp(input.now) == null ? Date.now() : input.now;
  const metadata = subscription.metadata || {};
  const item = subscription.items && subscription.items.data && subscription.items.data[0];
  const providerSubscriptionId = subscription.id;
  const sameSubscription = sameProviderSubscription(existing, providerSubscriptionId);
  const status = STATUS_MAP[subscription.status] || 'read_only';
  const currentPeriodEndMs = secondsToMs(subscription.current_period_end);
  const canceledAtMs = secondsToMs(subscription.canceled_at);
  const cancelAtPeriodEnd = subscription.cancel_at_period_end === true;
  const failedPaymentState = subscription.status === 'past_due' || subscription.status === 'unpaid';

  let graceEndsAtMs = null;
  if (status === 'past_due') {
    graceEndsAtMs = sameSubscription && existing.graceEndsAtMs != null
      ? existing.graceEndsAtMs
      : addMs(now, policyValue(input.policy, 'paymentGraceMs'));
  } else if (subscription.status === 'unpaid') {
    graceEndsAtMs = sameSubscription && existing.graceEndsAtMs != null
      ? existing.graceEndsAtMs : now;
  }

  let retentionEndsAtMs = null;
  if (failedPaymentState) {
    const existingFailedPaymentClock = sameSubscription && existing.retentionEndsAtMs != null &&
      (existing.status === 'past_due' || existing.status === 'read_only') &&
      existing.cancelAtPeriodEnd !== true;
    retentionEndsAtMs = existingFailedPaymentClock
      ? existing.retentionEndsAtMs
      : addMs(now, policyValue(input.policy, 'failedPaymentRetentionMs'));
  } else if (cancelAtPeriodEnd || status === 'canceled') {
    const existingCancellationClock = sameSubscription && existing.retentionEndsAtMs != null &&
      (existing.cancelAtPeriodEnd === true || existing.status === 'canceled');
    const cancellationBaseMs = currentPeriodEndMs || canceledAtMs || now;
    retentionEndsAtMs = existingCancellationClock
      ? existing.retentionEndsAtMs
      : addMs(cancellationBaseMs, policyValue(input.policy, 'cancellationRetentionMs'));
  }

  return {
    workspaceId: metadata.workspace_id,
    plan: metadata.plan,
    status,
    seatQuantity: Math.max(1, Number(item && item.quantity) || 1),
    provider: 'stripe',
    providerCustomerId: subscription.customer,
    providerSubscriptionId,
    currentPeriodEndMs,
    graceEndsAtMs,
    retentionEndsAtMs,
    cancelAtPeriodEnd,
    canceledAtMs,
    providerEventCreatedMs: safeTimestamp(input.eventCreatedMs),
    providerSubscriptionCreatedMs: secondsToMs(subscription.created),
  };
}

function transitionTypes(before, after) {
  if (!after) return [];
  const transitions = [];
  const beforeFailed = before && before.retentionEndsAtMs != null &&
    (before.status === 'past_due' || before.status === 'read_only') &&
    before.cancelAtPeriodEnd !== true;
  const afterFailed = after.retentionEndsAtMs != null &&
    (after.status === 'past_due' || after.status === 'read_only') &&
    after.cancelAtPeriodEnd !== true;
  if (after.status === 'past_due' && !beforeFailed) transitions.push('payment_failed');
  if (beforeFailed && after.status === 'active' && !after.cancelAtPeriodEnd) {
    transitions.push('payment_recovered');
  }
  if (after.status === 'active' && after.cancelAtPeriodEnd &&
      !(before && before.status === 'active' && before.cancelAtPeriodEnd)) {
    transitions.push('cancellation_scheduled');
  }
  if (before && before.cancelAtPeriodEnd && after.status === 'active' &&
      !after.cancelAtPeriodEnd) transitions.push('cancellation_reversed');
  if (after.status === 'canceled' && (!before || before.status !== 'canceled')) {
    transitions.push('cancellation_effective');
  }
  return transitions;
}

function scheduledBillingEvents(subscription, policy) {
  if (!subscription) return [];
  const events = [];
  if ((subscription.status === 'past_due' ||
      (subscription.status === 'read_only' && subscription.retentionEndsAtMs != null)) &&
      subscription.graceEndsAtMs != null) {
    events.push({ type: 'payment_read_only', availableAtMs: subscription.graceEndsAtMs });
  }
  if (subscription.status === 'active' && subscription.cancelAtPeriodEnd &&
      subscription.currentPeriodEndMs != null) {
    events.push({ type: 'cancellation_effective',
      availableAtMs: subscription.currentPeriodEndMs });
  }
  if (subscription.retentionEndsAtMs != null) {
    events.push({ type: 'deletion_warning', availableAtMs: Math.max(0,
      subscription.retentionEndsAtMs - policyValue(policy, 'deletionWarningMs')) });
    events.push({ type: 'retention_expire', availableAtMs: subscription.retentionEndsAtMs });
  }
  return events;
}

function billingEventApplies(subscription, payload, now) {
  if (!subscription || !payload) return false;
  if (payload.providerSubscriptionId &&
      subscription.providerSubscriptionId !== payload.providerSubscriptionId) return false;
  if (payload.retentionEndsAtMs != null &&
      subscription.retentionEndsAtMs !== payload.retentionEndsAtMs) return false;
  if (payload.graceEndsAtMs != null && subscription.graceEndsAtMs !== payload.graceEndsAtMs) {
    return false;
  }
  const time = safeTimestamp(now) == null ? Date.now() : now;
  switch (payload.type) {
    case 'payment_failed':
      return subscription.status === 'past_due';
    case 'payment_recovered':
    case 'cancellation_reversed':
      return subscription.status === 'active' && !subscription.cancelAtPeriodEnd &&
        subscription.retentionEndsAtMs == null;
    case 'payment_read_only':
      return (subscription.status === 'past_due' ||
          (subscription.status === 'read_only' && subscription.retentionEndsAtMs != null)) &&
        subscription.graceEndsAtMs != null &&
        time >= subscription.graceEndsAtMs;
    case 'cancellation_scheduled':
      return subscription.status === 'active' && subscription.cancelAtPeriodEnd;
    case 'cancellation_effective':
      return subscription.status === 'canceled' ||
        (subscription.status === 'active' && subscription.cancelAtPeriodEnd &&
          subscription.currentPeriodEndMs != null && time >= subscription.currentPeriodEndMs);
    case 'deletion_warning':
    case 'retention_expire':
      return subscription.retentionEndsAtMs != null && time >= payload.availableAtMs &&
        !(subscription.status === 'active' && !subscription.cancelAtPeriodEnd);
    default:
      return false;
  }
}

module.exports = {
  DAY_MS,
  DEFAULT_PLAN_LIMITS,
  DEFAULT_POLICY,
  STATUS_MAP,
  billingEventApplies,
  buildStripeSubscriptionUpdate,
  scheduledBillingEvents,
  transitionTypes,
};
