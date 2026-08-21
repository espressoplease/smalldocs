module.exports = function(harness) {
  const { assert, test } = harness;
  const { createCloudCollaborationMetrics } = require('../lib/cloud-collaboration-metrics');

  test('Cloud collaboration metrics aggregate polls, merges, retries, and expiry', () => {
    let clock = Date.parse('2026-08-21T12:00:00.000Z');
    const metrics = createCloudCollaborationMetrics({ now: () => clock });
    metrics.recordHeadCheck(false);
    metrics.recordHeadCheck(true);
    metrics.recordTargetSave({ merge_classification: 'rebased', merge_retry_count: 2 }, 17);
    metrics.recordTargetSave({ merge_classification: 'combined', merge_retry_count: 0 }, 31);
    metrics.recordTargetSave({ merge_classification: 'noop', merge_retry_count: 0 }, 2);
    metrics.recordTargetTooOld();
    clock += 60 * 1000;
    const snapshot = metrics.flush();
    assert.strictEqual(snapshot.event, 'cloud_collaboration_metrics');
    assert.strictEqual(snapshot.head_checks, 2);
    assert.strictEqual(snapshot.head_changes, 1);
    assert.strictEqual(snapshot.head_unchanged, 1);
    assert.strictEqual(snapshot.target_saves, 3);
    assert.strictEqual(snapshot.target_save_noop, 1);
    assert.strictEqual(snapshot.target_save_rebased, 1);
    assert.strictEqual(snapshot.target_save_combined, 1);
    assert.strictEqual(snapshot.merge_retries, 2);
    assert.strictEqual(snapshot.merge_duration_ms_total, 50);
    assert.strictEqual(snapshot.merge_duration_ms_max, 31);
    assert.strictEqual(snapshot.target_too_old, 1);
    assert.strictEqual(metrics.flush(), null);
  });
};
