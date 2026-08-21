const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function(harness) {
  const { assert, testAsync } = harness;

  return async function() {
    console.log('\n-- Cloud Staging Seed Tests --------------------------\n');
    await testAsync('staging seed creates separate individual and team identities', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-seed-'));
      const env = Object.assign({}, process.env, {
        CLOUD_ENVIRONMENT: 'staging',
        CLOUD_AUTH_DB: path.join(dir, 'auth.db'),
        CLOUD_DB: path.join(dir, 'cloud.db'),
        CLOUD_BILLING_DB: path.join(dir, 'billing.db'),
        CLOUD_AUTH_PEPPER: 'seed-test-pepper',
        CLOUD_IDEMPOTENCY_SECRET: 'seed-test-idempotency',
        CLOUD_MASTER_KEY: Buffer.alloc(32, 42).toString('base64'),
        CLOUD_PLAN_LIMITS_JSON: JSON.stringify({
          personal: { maxFileBytes: 10485760, revisionRetentionDays: 90 },
          team: { maxFileBytes: 10485760, revisionRetentionDays: 90 },
        }),
      });
      try {
        const output = await new Promise((resolve, reject) => {
          execFile(process.execPath, [path.join(__dirname, '..', 'ops', 'seed-cloud-staging.js')],
            { env }, (error, stdout) => error ? reject(error) : resolve(stdout));
        });
        const seeded = JSON.parse(output);
        assert.notStrictEqual(seeded.individual.user_id, seeded.team.user_id);
        assert.notStrictEqual(seeded.individual.account_id, seeded.team.account_id);
        assert.notStrictEqual(seeded.acceptance.user_id, seeded.team.user_id);
        assert.notStrictEqual(seeded.acceptance.account_id, seeded.team.account_id);

        const { createLocalKeyProvider, createCloudStore } = require('../lib/cloud-store');
        const store = createCloudStore({ dbPath: env.CLOUD_DB,
          keyProvider: createLocalKeyProvider({ masterKey: env.CLOUD_MASTER_KEY,
            environment: 'staging', reference: 'local-staging-key' }),
          idempotencySecret: env.CLOUD_IDEMPOTENCY_SECRET });
        const individualAccounts = await store.listWorkspaces(seeded.individual.user_id);
        const teamAccounts = await store.listWorkspaces(seeded.team.user_id);
        assert.strictEqual(individualAccounts.length, 1);
        assert.strictEqual(individualAccounts[0].kind, 'personal');
        assert.strictEqual(teamAccounts.length, 1);
        assert.strictEqual(teamAccounts[0].kind, 'team');
        assert.strictEqual(seeded.team.members.length, 4);
        const teamMembers = store.listAccountMembers({ userId: seeded.team.user_id,
          workspaceId: seeded.team.account_id });
        assert.strictEqual(teamMembers.length, 5);
        for (const member of seeded.team.members) {
          const accounts = await store.listWorkspaces(member.user_id);
          assert.strictEqual(accounts.length, 1);
          assert.strictEqual(accounts[0].id, seeded.team.account_id);
        }
        const acceptanceAccounts = await store.listWorkspaces(seeded.acceptance.user_id);
        assert.strictEqual(acceptanceAccounts.length, 1);
        assert.strictEqual(acceptanceAccounts[0].id, seeded.acceptance.account_id);
        assert.strictEqual(acceptanceAccounts[0].name, 'SmallDocs Acceptance');
        const acceptanceMembers = store.listAccountMembers({ userId: seeded.acceptance.user_id,
          workspaceId: seeded.acceptance.account_id });
        assert.strictEqual(acceptanceMembers.length, 3);
        for (const member of seeded.acceptance.members) {
          const accounts = await store.listWorkspaces(member.user_id);
          assert.strictEqual(accounts.length, 1);
          assert.strictEqual(accounts[0].id, seeded.acceptance.account_id);
        }
        store.db.close();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  };
};
