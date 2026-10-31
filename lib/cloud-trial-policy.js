'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_WARNING_MS = 7 * DAY_MS;

// Payment grace is based on the original deadline, never the last visit.
function applyTrialPolicy(entitlements, now, originalDeadline) {
  if (!entitlements || !entitlements.trialEndsAtMs) return entitlements;
  const deadline = Math.min(entitlements.trialEndsAtMs, originalDeadline || Infinity);
  const paywallAt = deadline + TRIAL_WARNING_MS;
  const phase = now < deadline ? 'trial' : now < paywallAt ? 'trial_warning' : 'payment_required';
  const allowed = phase !== 'payment_required';
  const blockedBy = (entitlements.blockedBy || []).filter(code =>
    code !== 'subscription_read_only' && code !== 'trial_payment_required');
  if (!allowed) blockedBy.unshift('trial_payment_required');
  return { ...entitlements, trialEndsAtMs: deadline, trialPaywallAtMs: paywallAt,
    effectiveStatus: phase, blockedBy,
    access: { ...entitlements.access, read: allowed, write: allowed,
      search: allowed && !blockedBy.includes('search_limit_reached'), manageMembers: allowed } };
}

function trialStatus(entitlements, now, origin = '') {
  const end = entitlements && entitlements.trialEndsAtMs;
  const phase = end ? entitlements.effectiveStatus : entitlements && entitlements.effectiveStatus && entitlements.effectiveStatus !== 'none'
    ? entitlements.effectiveStatus : entitlements && entitlements.access.write ? 'active' : 'uncovered';
  const paywall = end ? end + TRIAL_WARNING_MS : null;
  const notice = phase === 'trial_warning' ? {
    code: 'trial_ended', severity: 'warning',
    message: 'Your free trial has ended. Subscribe before ' + new Date(paywall).toISOString() + ' to keep using SmallDocs.',
    dedupe_key: 'trial-ended:' + end, feedback_requested: true,
    next_action: 'Tell the user their trial has ended and offer the subscription and feedback links.',
  } : phase === 'payment_required' ? {
    code: 'trial_payment_required', severity: 'action_required',
    message: 'Your free trial and extra week have ended. Subscribe to continue using SmallDocs.',
    dedupe_key: 'trial-payment-required:' + end,
    next_action: 'Open subscribe_url for the human to complete payment, then retry the command. Do not bypass the paywall with local viewing.',
  } : phase === 'past_due_grace' ? {
    code: 'payment_failed', severity: 'warning',
    message: 'Payment needs attention. Update your payment details to keep saving documents.',
    dedupe_key: 'payment-failed:' + entitlements.graceEndsAtMs,
    next_action: 'Tell the user payment needs attention and offer billing_url.',
  } : phase === 'canceled' ? {
    code: 'subscription_read_only', severity: 'action_required',
    message: 'Your subscription has ended. You can open and export your documents. Subscribe again to save changes.',
    dedupe_key: 'subscription-read-only:canceled',
    next_action: 'Offer subscribe_url so the human can restart their subscription.',
  } : ['past_due', 'read_only'].includes(phase) ? {
    code: 'subscription_read_only', severity: 'action_required',
    message: 'Your subscription is read-only. You can open and export documents. Update billing to save changes.',
    dedupe_key: 'subscription-read-only:' + phase,
    next_action: 'Offer billing_url so the human can restore editing.',
  } : null;
  return { phase, grace_ends_at_ms: entitlements && entitlements.graceEndsAtMs || null, trial_ends_at_ms: end || null, paywall_starts_at_ms: paywall,
    days_until_paywall: paywall ? Math.max(0, Math.ceil((paywall - now) / DAY_MS)) : null,
    deletion_at_ms: null,
    subscribe_url: origin + '/cloud/subscribe', billing_url: origin + '/cloud/admin?panel=billing',
    feedback_url: origin + '/cloud/trial-feedback', notices: notice ? [notice] : [] };
}

module.exports = { DAY_MS, TRIAL_WARNING_MS, applyTrialPolicy, trialStatus };
