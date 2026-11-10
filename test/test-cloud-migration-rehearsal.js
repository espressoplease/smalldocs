'use strict';
module.exports = function (h) {
  return async function () {
    await h.testAsync('release rehearsal preserves data and permissions and restores an untouched snapshot', async () => {
      const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
      const { execFileSync } = require('child_process');
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-migration-test-'));
      const source = path.join(root, 'source'), snapshot = path.join(root, 'snapshot');
      fs.mkdirSync(source); fs.mkdirSync(path.join(snapshot, 'etc/smalldocs'), { recursive: true });
      const pepper = crypto.randomBytes(32).toString('hex'), masterKey = crypto.randomBytes(32).toString('base64');
      const auth = require('../lib/cloud-auth').createAuthStore({ dbPath: source + '/auth.db', pepper });
      const store = require('../lib/cloud-store').createCloudStore({ dbPath: source + '/store.db',
        keyProvider: require('../lib/cloud-store').createLocalKeyProvider({ masterKey, environment: 'development' }), idempotencySecret: pepper });
      const billing = require('../lib/cloud-billing').createBillingStore({ dbPath: source + '/billing.db', trialIdentitySecret: pepper });
      const jobs = require('../lib/cloud-jobs').createCloudJobs({ dbPath: source + '/jobs.db' });
      try {
        const owner = auth.signInWithVerifiedEmail('owner@example.test').user;
        auth.signInWithVerifiedEmail('outsider@example.test');
        const library = await store.ensurePersonalWorkspace(owner.id, 'Knowledge');
        const document = await store.createDocument({ userId: owner.id, projectId: library.projectId,
          filename: 'notes.md', markdown: '# A retained thought\n\nPrivate text.', idempotencyKey: 'create' });
        await store.saveRevision({ userId: owner.id, documentId: document.id,
          expectedHeadRevisionId: document.current_revision_id, filename: 'notes.md',
          markdown: '# A retained thought\n\nUpdated text.', idempotencyKey: 'edit' });
        billing.ensurePersonalTrial({ userId: owner.id, workspaceId: library.workspaceId, verifiedEmail: 'owner@example.test' });
        const config = { CLOUD_ENVIRONMENT: 'development', CLOUD_MASTER_KEY: masterKey, CLOUD_AUTH_PEPPER: pepper,
          CLOUD_IDEMPOTENCY_SECRET: pepper, CLOUD_AUTH_PUBLIC_ORIGIN: 'https://example.test',
          CLOUD_AUTH_DB: '/var/lib/rehearsal/auth.db', CLOUD_OAUTH_DB: '/var/lib/rehearsal/auth.db',
          CLOUD_DB: '/var/lib/rehearsal/store.db', CLOUD_BILLING_DB: '/var/lib/rehearsal/billing.db', CLOUD_JOBS_DB: '/var/lib/rehearsal/jobs.db' };
        fs.writeFileSync(path.join(snapshot, 'etc/smalldocs/smalldocs.env'), Object.entries(config).map(([k, v]) => k + '=' + v).join('\n'));
        const target = path.join(snapshot, 'var/lib/rehearsal'); fs.mkdirSync(target, { recursive: true });
        for (const [name, resource] of [['auth', auth], ['store', store], ['billing', billing], ['jobs', jobs]]) await resource.db.backup(target + '/' + name + '.db');
        const fingerprint = () => ['auth', 'store', 'billing', 'jobs'].map(name => crypto.createHash('sha256').update(fs.readFileSync(target + '/' + name + '.db')).digest('hex'));
        const before = fingerprint(), work = path.join(root, 'work'), report = path.join(root, 'report.json');
        const output = execFileSync(process.execPath, [path.join(__dirname, '../ops/rehearse-cloud-migration.js'),
          '--snapshot-root', snapshot, '--previous-release', path.join(__dirname, '..'), '--work-dir', work, '--report', report],
        { encoding: 'utf8', timeout: 20000 });
        const result = JSON.parse(output);
        h.assert.strictEqual(result.ok, true);
        h.assert.strictEqual(result.permission_pairs_checked, 2);
        h.assert.strictEqual(result.permissions_preserved, true);
        h.assert.strictEqual(result.encrypted_data.revisions, 2);
        h.assert.strictEqual(result.trial_deadlines_preserved, true);
        h.assert.strictEqual(result.previous_reader_after_migration, true);
        h.assert.strictEqual(result.backup_restore_previous_reader, true);
        h.assert.strictEqual(result.server_started, false);
        h.assert.strictEqual(result.payment_or_email_requests, false);
        h.assert.strictEqual(fs.existsSync(work), false);
        h.assert.deepStrictEqual(fingerprint(), before);
        h.assert.ok(!output.includes('Private text') && !output.includes('owner@example.test') && !output.includes(pepper));
      } finally {
        for (const resource of [auth, store, billing, jobs]) resource.close();
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  };
};
