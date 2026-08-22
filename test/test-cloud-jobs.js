const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function(harness) {
  const { assert, test } = harness;
  const { CloudJobsError, createCloudJobs } = require('../lib/cloud-jobs');
  const jobStatus = require('../scripts/cloud-job-status');
  const jobRetry = require('../scripts/cloud-job-retry');

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

    test('summary exposes counts and error codes without payloads or identifiers', () => {
      const summary = first.summary({ types: ['email.send', 'webhook'] });
      assert.strictEqual(summary.states.dead, 2);
      assert.strictEqual(summary.states.complete, 0);
      assert.strictEqual(summary.expiredLeaseCount, 0);
      assert(summary.types.some((item) => item.type === 'email.send' && item.dead === 1));
      assert(summary.types.some((item) => item.type === 'webhook' && item.dead === 1));
      assert.deepStrictEqual(summary.errors, [
        { type: 'email.send', code: 'unknown', count: 1 },
      ]);
      const serialized = JSON.stringify(summary);
      assert(!serialized.includes('email-1'));
      assert(!serialized.includes('webhook-1'));
      assert(!serialized.includes('payload'));
    });

    test('operator command requeues only confirmed dead Team seat jobs', () => {
      const seatJob = first.enqueue({ type: 'team_seat_sync', idempotencyKey: 'seat-dead',
        payload: { workspaceId: 'workspace-private' }, maxAttempts: 1 });
      const claimed = first.claim({ workerId: 'seat-worker', types: ['team_seat_sync'] });
      first.retry({ jobId: claimed.id, workerId: 'seat-worker',
        error: { code: 'stripe_api_error' } });
      assert.strictEqual(first.get(seatJob.id).state, 'dead');

      const refused = [];
      assert.strictEqual(jobRetry.run(['--db', dbPath, '--type', 'team_seat_sync'], {
        log: () => {}, error: line => refused.push(line),
      }), 1);
      assert(refused[0].startsWith('--confirm is required'));
      assert.strictEqual(first.get(seatJob.id).state, 'dead');

      const output = [];
      assert.strictEqual(jobRetry.run(['--db', dbPath, '--type', 'team_seat_sync',
        '--confirm'], { log: line => output.push(line), error: () => {} }), 0);
      assert.deepStrictEqual(output, ['Requeued 1 dead team_seat_sync job.']);
      const requeued = first.get(seatJob.id);
      assert.strictEqual(requeued.state, 'queued');
      assert.strictEqual(requeued.attempts, 0);
      assert.deepStrictEqual(requeued.lastError, { code: 'stripe_api_error' });
      clock = Date.now() + 1000;
      const retried = first.claim({ workerId: 'seat-worker', types: ['team_seat_sync'] });
      const completed = first.complete({ jobId: retried.id, workerId: 'seat-worker' });
      assert.strictEqual(completed.state, 'complete');
      assert.strictEqual(completed.lastError, null);
    });

    test('job status output is redacted and can fail on dead delivery work', () => {
      assert.ok(jobStatus.EMAIL_JOB_TYPES.includes('billing_state_email'));
      const delivery = first.enqueue({ type: 'document_notification_email',
        idempotencyKey: 'private-recipient@example.com',
        payload: { recipient: 'private-recipient@example.com', documentTitle: 'Private plan' },
        maxAttempts: 1 });
      const claimed = first.claim({ workerId: 'email-diagnostic',
        types: ['document_notification_email'] });
      first.retry({ jobId: claimed.id, workerId: 'email-diagnostic',
        error: { code: 'email_delivery_failed', detail: 'private-recipient@example.com' } });
      const output = [];
      const errors = [];
      const exitCode = jobStatus.run(['--db', dbPath, '--email', '--fail-on-dead'], {
        log: (line) => output.push(line), error: (line) => errors.push(line),
      });
      assert.strictEqual(exitCode, 2);
      assert.strictEqual(errors.length, 0);
      assert(output[0].includes('document_notification_email'));
      assert(output[0].includes('email_delivery_failed'));
      assert(!output[0].includes(delivery.id));
      assert(!output[0].includes('private-recipient@example.com'));
      assert(!output[0].includes('Private plan'));
    });

    test('job status refuses a missing database instead of creating an empty one', () => {
      const missingPath = path.join(dir, 'missing.db');
      const output = [];
      const errors = [];
      assert.strictEqual(jobStatus.run(['--db', missingPath], {
        log: (line) => output.push(line), error: (line) => errors.push(line),
      }), 1);
      assert.strictEqual(output.length, 0);
      assert.strictEqual(errors[0],
        'Could not open the Cloud jobs database. Check CLOUD_JOBS_DB or --db.');
      assert.strictEqual(fs.existsSync(missingPath), false);
    });

    test('job status rejects a non-jobs database and a missing db argument cleanly', () => {
      const unrelatedPath = path.join(dir, 'unrelated.db');
      const Database = require('better-sqlite3');
      const unrelated = new Database(unrelatedPath);
      unrelated.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)');
      unrelated.close();
      const output = [];
      const errors = [];
      assert.strictEqual(jobStatus.run(['--db', unrelatedPath], {
        log: (line) => output.push(line), error: (line) => errors.push(line),
      }), 1);
      assert.strictEqual(output.length, 0);
      assert.strictEqual(errors[0],
        'Could not read Cloud job status. Check that this is a Cloud jobs database.');
      errors.length = 0;
      assert.strictEqual(jobStatus.run(['--db', '--email'], {
        log: (line) => output.push(line), error: (line) => errors.push(line),
      }), 1);
      assert(errors[0].startsWith('--db requires a path'));
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
