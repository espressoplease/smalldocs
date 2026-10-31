#!/usr/bin/env node
'use strict';

const { createKeyProvider } = require('./cloud-key-provider');
const { createCloudStore } = require('../lib/cloud-store');

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const at = args.indexOf(name);
    return at < 0 ? undefined : args[at + 1];
  };
  if (!process.env.CLOUD_DB) throw new Error('CLOUD_DB is required');
  const secret = process.env.CLOUD_IDEMPOTENCY_SECRET || process.env.CLOUD_AUTH_PEPPER;
  if (!secret) throw new Error('CLOUD_IDEMPOTENCY_SECRET or CLOUD_AUTH_PEPPER is required');
  const provider = createKeyProvider(process.env);
  const store = createCloudStore({ dbPath: process.env.CLOUD_DB, keyProvider: provider, idempotencySecret: secret });
  try {
    const scope = flag('--workspace') ? { workspaceIds: [flag('--workspace')] } : {};
    if (args.includes('--status')) {
      process.stdout.write(JSON.stringify(store.searchIndexStatus(scope)) + '\n');
      return;
    }
    const limit = flag('--batch-size') == null ? 100 : Number(flag('--batch-size'));
    let result;
    do {
      result = await store.rebuildSearchIndex({ ...scope, limit });
      process.stdout.write(JSON.stringify(result) + '\n');
    } while (!result.ready && !args.includes('--once'));
  } finally {
    store.close();
    if (typeof provider.clearCache === 'function') provider.clearCache();
    if (provider.kmsClient && typeof provider.kmsClient.close === 'function') provider.kmsClient.close();
  }
}

if (require.main === module) main().catch((error) => {
  process.stderr.write('Cloud search rebuild failed: ' + (error.code || error.message) + '\n');
  process.exitCode = 1;
});

module.exports = { main };
