module.exports = function (h) {
  const { test, assert } = h;
  const { applyTrialPolicy, trialStatus, DAY_MS, TRIAL_WARNING_MS } = require('../lib/cloud-trial-policy');
  const end = Date.UTC(2026, 9, 24, 12);
  const base = { trialEndsAtMs: end, access: { read: true, write: false, search: true }, blockedBy: ['subscription_read_only'] };
  for (const [offset, phase, allowed] of [[-1, 'trial', true], [0, 'trial_warning', true],
    [TRIAL_WARNING_MS - 1, 'trial_warning', true], [TRIAL_WARNING_MS, 'payment_required', false]]) {
    test('trial boundary ' + offset + ' has phase ' + phase, () => {
      const entitlement = applyTrialPolicy(base, end + offset);
      assert.strictEqual(entitlement.effectiveStatus, phase);
      for (const operation of ['read', 'write', 'search', 'manageMembers']) assert.strictEqual(entitlement.access[operation], allowed);
      const state = trialStatus(entitlement, end + offset, 'https://cloud.example.test');
      assert.strictEqual(state.phase, phase);
      assert.strictEqual(state.paywall_starts_at_ms, end + TRIAL_WARNING_MS);
      assert.strictEqual(state.deletion_at_ms, null);
      assert.strictEqual(state.subscribe_url, 'https://cloud.example.test/cloud/subscribe');
      assert.strictEqual(state.notices.length, phase === 'trial' ? 0 : 1);
    });
  }
  test('a later team trial cannot extend an earlier personal deadline or warning week', () => {
    const result = applyTrialPolicy({ ...base, trialEndsAtMs: end + 20 * DAY_MS }, end + 8 * DAY_MS, end);
    assert.strictEqual(result.trialEndsAtMs, end);
    assert.strictEqual(result.effectiveStatus, 'payment_required');
  });
  test('paid coverage bypasses an earlier trial and preserves existing limits', () => {
    const paid = { access: { read: true, write: true, search: true }, blockedBy: [] };
    assert.strictEqual(applyTrialPolicy(paid, end + 8 * DAY_MS, end), paid);
    assert.strictEqual(trialStatus(paid, end).phase, 'active');
    const limited = applyTrialPolicy({ ...base, blockedBy: ['subscription_read_only', 'search_limit_reached', 'storage_limit_reached'] }, end);
    assert.strictEqual(limited.access.search, false);
    assert.ok(limited.blockedBy.includes('storage_limit_reached'));
  });
};
