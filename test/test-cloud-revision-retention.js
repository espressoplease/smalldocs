'use strict';
const assert = require('assert');
const { startFixture } = require('./cloud-onboarding-fixture');
const { createCloudJobs } = require('../lib/cloud-jobs');
const path = require('path');

module.exports = function (h) {
  return async function () {
    await h.testAsync('real revision worker upgrades legacy count-capped jobs to all revisions for 90 days', async () => {
      const f = await startFixture({ jobs: true });
      const jobs = createCloudJobs({ dbPath: path.join(f.dir, 'jobs.db') });
      const day = 24 * 60 * 60 * 1000;
      try {
        const userId = f.users.returning.id;
        let document = await f.store.createDocument({ userId, projectId: f.personal.projectId,
          filename: 'worker-retention.md', markdown: '# Revision 1', idempotencyKey: 'retention-worker-create' });
        for (let n = 2; n <= 7; n += 1) {
          document = await f.store.saveRevision({ userId, documentId: document.id,
            expectedHeadRevisionId: document.current_revision_id, filename: 'worker-retention.md',
            markdown: '# Revision ' + n, idempotencyKey: 'retention-worker-save-' + n });
        }
        const revisions = f.store.listRevisions({ userId, documentId: document.id });
        const now = Date.now();
        for (const revision of revisions) {
          const ageDays = revision.revision_number === 1 ? 91
            : revision.revision_number === 2 ? 60 : revision.revision_number === 7 ? 100 : 1;
          f.store.db.prepare('UPDATE cloud_document_revisions SET created_at_ms=? WHERE id=?')
            .run(now - ageDays * day, revision.id);
        }
        const legacy = jobs.enqueue({ type: 'revision_prune', idempotencyKey: 'legacy-count-capped-retention',
          payload: { documentId: document.id, keepPrevious: 0, retentionMs: 30 * day } });
        for (let n = 0; n < 100 && jobs.get(legacy.id).state !== 'complete'; n += 1) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.strictEqual(jobs.get(legacy.id).state, 'complete');
        assert.deepStrictEqual(f.store.listRevisions({ userId, documentId: document.id })
          .map(revision => revision.revision_number), [7, 6, 5, 4, 3, 2]);
        assert.strictEqual((await f.store.getDocument({ userId, documentId: document.id })).markdown,
          '# Revision 7');
        const rows = jobs.db.prepare("SELECT id FROM cloud_jobs WHERE type='revision_prune'").all();
        const next = rows.map(row => jobs.get(row.id)).find(job => job.id !== legacy.id);
        assert.ok(next);
        assert.strictEqual(next.state, 'queued');
        assert.strictEqual(next.payload.retentionMs, 90 * day);
        assert.strictEqual(Object.hasOwn(next.payload, 'keepPrevious'), false);
        assert.ok(next.availableAtMs > now + 29 * day);

        const response = await f.api('returning', '/api/cloud/v1/documents/' + document.id + '/revisions', 'POST', {
          target_revision_id: document.current_revision_id, markdown: '# Revision 8',
          idempotency_key: 'retention-worker-http-save',
        });
        assert.strictEqual(response.status, 201);
        const current = response.data.document;
        const all = jobs.db.prepare("SELECT id FROM cloud_jobs WHERE type='revision_prune'").all()
          .map(row => jobs.get(row.id));
        const scheduled = all.find(job => job.idempotencyKey === document.id + ':'
          + current.current_revision_id + ':age-only-v1');
        assert.ok(scheduled, 'new save should schedule an age-only retention job');
        assert.strictEqual(scheduled.payload.retentionMs, 90 * day);
        assert.strictEqual(Object.hasOwn(scheduled.payload, 'keepPrevious'), false);
        jobs.enqueue({ type: 'revision_prune',
          idempotencyKey: document.id + ':' + current.current_revision_id,
          payload: { documentId: document.id, keepPrevious: 3, retentionMs: 30 * day } });
        const noop = await f.api('returning', '/api/cloud/v1/documents/' + document.id + '/revisions', 'POST', {
          target_revision_id: current.current_revision_id, markdown: '# Revision 8',
          idempotency_key: 'retention-worker-http-noop',
        });
        assert.strictEqual(noop.status, 201);
        assert.strictEqual(noop.data.document.current_revision_id, current.current_revision_id);
      } finally {
        jobs.close();
        await f.close();
      }
    });
  };
};
