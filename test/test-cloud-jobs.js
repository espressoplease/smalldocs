const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function(harness) {
  const { assert, test } = harness;
  const { CloudJobsError, createCloudJobs } = require('../lib/cloud-jobs');

  return function() {
    console.log('\n-- Cloud Jobs Tests -----------------------------------\n');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-jobs-'));
    const dbPath = path.join(dir, 'jobs.db');
    let clock = 1700000000000;
    let sequence = 0;
    const options = {
      dbPath,
      now: () => clock,
      randomUUID: () => 'job-' + (++sequence),
      baseBackoffMs: 100,
      maxBackoffMs: 1000,
    };
    const first = createCloudJobs(options);
    const second = createCloudJobs(Object.assign({}, options, {
      randomUUID: () => 'other-' + (++sequence),
    }));

    test('enqueue persists JSON and deduplicates matching input', () => {
      const created = first.enqueue({
        type: 'revision.cleanup', idempotencyKey: 'cleanup-1',
        payload: { workspaceId: 'workspace-1', revisionIds: ['revision-2', 'revision-1'] },
        maxAttempts: 3,
      });
      assert.strictEqual(created.created, true);
      assert.strictEqual(created.state, 'queued');
      assert.deepStrictEqual(created.payload, {
        revisionIds: ['revision-2', 'revision-1'], workspaceId: 'workspace-1',
      });
      const duplicate = second.enqueue({
        type: 'revision.cleanup', idempotencyKey: 'cleanup-1',
        payload: { revisionIds: ['revision-2', 'revision-1'], workspaceId: 'workspace-1' },
        maxAttempts: 3,
      });
      assert.strictEqual(duplicate.id, created.id);
      assert.strictEqual(duplicate.created, false);
      assert.throws(() => first.enqueue({
        type: 'revision.cleanup', idempotencyKey: 'cleanup-1', payload: { workspaceId: 'different' },
        maxAttempts: 3,
      }), (error) => error instanceof CloudJobsError && error.code === 'idempotency_mismatch');
    });

    test('claim is atomic across workers and complete requires the lease owner', () => {
      const claimed = first.claim({ workerId: 'worker-a', leaseMs: 500 });
      assert.strictEqual(claimed.id, 'job-1');
      assert.strictEqual(claimed.attempts, 1);
      assert.strictEqual(second.claim({ workerId: 'worker-b', leaseMs: 500 }), null);
      assert.throws(() => second.complete({ jobId: claimed.id, workerId: 'worker-b' }),
        (error) => error instanceof CloudJobsError && error.code === 'lease_lost');
      const completed = first.complete({ jobId: claimed.id, workerId: 'worker-a' });
      assert.strictEqual(completed.state, 'complete');
      assert.strictEqual(completed.completedAtMs, clock);
    });

    test('claim filters job types and respects scheduled availability', () => {
      first.enqueue({
        type: 'email.send', idempotencyKey: 'email-1', payload: {}, availableAtMs: clock + 100,
        maxAttempts: 3,
      });
      first.enqueue({ type: 'revision.cleanup', idempotencyKey: 'cleanup-2', payload: {} });
      assert.strictEqual(first.claim({ workerId: 'email-worker', types: ['email.send'] }), null);
      const cleanup = first.claim({ workerId: 'cleanup-worker', types: ['revision.cleanup'] });
      assert.strictEqual(cleanup.type, 'revision.cleanup');
      first.complete({ jobId: cleanup.id, workerId: 'cleanup-worker' });
      clock += 100;
      assert.strictEqual(first.claim({ workerId: 'email-worker', types: ['email.send'] }).type, 'email.send');
    });

    test('retry applies exponential backoff and becomes dead at max attempts', () => {
      const runningEmail = first.db.prepare("SELECT id FROM cloud_jobs WHERE type = 'email.send' AND state = 'running'").get();
      let retried = first.retry({
        jobId: runningEmail.id, workerId: 'email-worker', error: { code: 'temporary_failure' },
      });
      assert.strictEqual(retried.state, 'queued');
      assert.strictEqual(retried.availableAtMs, clock + 100);
      assert.deepStrictEqual(retried.lastError, { code: 'temporary_failure' });
      clock += 100;
      retried = first.claim({ workerId: 'email-worker', types: ['email.send'] });
      assert.strictEqual(retried.attempts, 2);
      retried = first.retry({ jobId: retried.id, workerId: 'email-worker' });
      assert.strictEqual(retried.availableAtMs, clock + 200);
      clock += 200;
      retried = first.claim({ workerId: 'email-worker', types: ['email.send'] });
      assert.strictEqual(retried.attempts, 3);
      retried = first.retry({ jobId: retried.id, workerId: 'email-worker', error: 'final failure' });
      assert.strictEqual(retried.state, 'dead');
      assert.strictEqual(retried.deadAtMs, clock);
      assert.strictEqual(first.claim({ workerId: 'email-worker', types: ['email.send'] }), null);
    });

    test('an expired lease is reclaimed and exhausted expired work becomes dead', () => {
      const reclaimable = first.enqueue({
        type: 'webhook', idempotencyKey: 'webhook-1', payload: {}, maxAttempts: 2,
      });
      first.claim({ workerId: 'crashed-a', leaseMs: 50, types: ['webhook'] });
      clock += 50;
      const reclaimed = second.claim({ workerId: 'worker-b', leaseMs: 50, types: ['webhook'] });
      assert.strictEqual(reclaimed.id, reclaimable.id);
      assert.strictEqual(reclaimed.attempts, 2);
      clock += 50;
      assert.strictEqual(first.claim({ workerId: 'worker-c', types: ['webhook'] }), null);
      assert.strictEqual(first.get(reclaimable.id).state, 'dead');
    });

    test('cleanup removes only old terminal jobs up to the requested limit', () => {
      clock += 1000;
      const oldComplete = first.enqueue({ type: 'old', idempotencyKey: 'complete', payload: {} });
      const claimedComplete = first.claim({ workerId: 'worker-a', types: ['old'] });
      first.complete({ jobId: claimedComplete.id, workerId: 'worker-a' });
      const oldDead = first.enqueue({ type: 'old', idempotencyKey: 'dead', payload: {}, maxAttempts: 1 });
      const claimedDead = first.claim({ workerId: 'worker-a', types: ['old'] });
      first.retry({ jobId: claimedDead.id, workerId: 'worker-a' });
      const queued = first.enqueue({ type: 'old', idempotencyKey: 'queued', payload: {} });
      clock += 100;
      const beforeCount = first.db.prepare(
        "SELECT COUNT(*) AS count FROM cloud_jobs WHERE state IN ('complete', 'dead')"
      ).get().count;
      assert.deepStrictEqual(first.cleanup({ beforeMs: clock, limit: 1 }), { deleted: 1 });
      const afterCount = first.db.prepare(
        "SELECT COUNT(*) AS count FROM cloud_jobs WHERE state IN ('complete', 'dead')"
      ).get().count;
      assert.strictEqual(afterCount, beforeCount - 1);
      assert.notStrictEqual(first.get(queued.id), null);
      assert.deepStrictEqual(first.cleanup({ beforeMs: clock, limit: 100 }), { deleted: afterCount });
      assert.strictEqual(first.get(oldComplete.id), null);
      assert.strictEqual(first.get(oldDead.id), null);
      assert.notStrictEqual(first.get(queued.id), null);
    });

    first.close();
    second.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
};
