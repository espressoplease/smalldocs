#!/usr/bin/env node
'use strict';

const path = require('path');
const { createInviteLink } = require('./create-business-invite-link');

function required(value, name) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(name + ' is required');
  return text;
}

function createKeyProvider(env) {
  if (env.CLOUD_KMS_KEY_ID) {
    let kmsClient;
    if (env.CLOUD_KMS_CLIENT_MODULE) {
      const kmsModule = require(path.resolve(env.CLOUD_KMS_CLIENT_MODULE));
      kmsClient = typeof kmsModule.createKmsClient === 'function'
        ? kmsModule.createKmsClient({ environment: env.CLOUD_ENVIRONMENT || 'production' })
        : kmsModule;
    } else {
      kmsClient = require('../lib/cloud-aws-kms').createAwsKmsClient({
        region: env.CLOUD_KMS_REGION || env.AWS_REGION || env.AWS_DEFAULT_REGION,
        maxAttempts: env.CLOUD_KMS_MAX_ATTEMPTS == null
          ? undefined : Number(env.CLOUD_KMS_MAX_ATTEMPTS),
        connectionTimeoutMs: env.CLOUD_KMS_CONNECTION_TIMEOUT_MS == null
          ? undefined : Number(env.CLOUD_KMS_CONNECTION_TIMEOUT_MS),
        requestTimeoutMs: env.CLOUD_KMS_REQUEST_TIMEOUT_MS == null
          ? undefined : Number(env.CLOUD_KMS_REQUEST_TIMEOUT_MS),
        operationTimeoutMs: env.CLOUD_KMS_OPERATION_TIMEOUT_MS == null
          ? undefined : Number(env.CLOUD_KMS_OPERATION_TIMEOUT_MS),
      });
    }
    return require('../lib/cloud-kms').createManagedKmsKeyProvider({
      kmsClient,
      keyId: env.CLOUD_KMS_KEY_ID,
      environment: env.CLOUD_ENVIRONMENT || 'production',
    });
  }
  if (env.CLOUD_MASTER_KEY) {
    return require('../lib/cloud-store').createLocalKeyProvider({
      masterKey: env.CLOUD_MASTER_KEY,
      environment: env.CLOUD_ENVIRONMENT || 'development',
      reference: env.CLOUD_KEY_REFERENCE || 'local-development-key',
    });
  }
  throw new Error('Cloud key provider is required');
}

async function issueBusinessInvite(input, options) {
  input = input || {};
  options = options || {};
  const store = options.store;
  if (!store) throw new Error('store is required');
  const workspaceId = required(input.workspace_id, 'workspace_id');
  const inviterUserId = required(input.inviter_user_id, 'inviter_user_id');
  const email = required(input.email, 'email');
  const role = input.role || 'member';
  if (!['member', 'admin'].includes(role)) throw new Error('role must be member or admin');
  const project = input.project_id
    ? { id: required(input.project_id, 'project_id') }
    : store.db.prepare(`
      SELECT id FROM cloud_projects
      WHERE workspace_id = ? AND deleted_at_ms IS NULL
      ORDER BY created_at_ms, id LIMIT 1
    `).get(workspaceId);
  if (!project) throw new Error('workspace has no active project');
  const invitation = await store.createInvitation({
    userId: inviterUserId,
    workspaceId,
    email,
    role,
    projectGrants: [{ projectId: project.id, role: 'editor' }],
  });
  const url = createInviteLink({
    origin: options.origin || 'https://smalldocs.org',
    token: invitation.token,
    name: input.name,
    first_name: input.first_name,
    last_name: input.last_name,
    email,
    company: input.company,
    inviter: input.inviter,
  });
  return {
    ok: true,
    workspace_id: workspaceId,
    project_id: project.id,
    invitation_id: invitation.id,
    expires_at: new Date(invitation.expiresAtMs).toISOString(),
    email_sent: false,
    url,
  };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const source = await readStdin();
  const input = JSON.parse(source);
  const keyProvider = createKeyProvider(process.env);
  const { createCloudStore } = require('../lib/cloud-store');
  const store = createCloudStore({
    dbPath: required(process.env.CLOUD_DB, 'CLOUD_DB'),
    keyProvider,
    idempotencySecret: process.env.CLOUD_IDEMPOTENCY_SECRET || process.env.CLOUD_AUTH_PEPPER,
  });
  try {
    const result = await issueBusinessInvite(input, {
      store,
      origin: process.env.CLOUD_AUTH_PUBLIC_ORIGIN || 'https://smalldocs.org',
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    store.db.close();
    if (typeof keyProvider.clearCache === 'function') keyProvider.clearCache();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write('Could not issue business invitation: ' + error.message + '\n');
    process.exitCode = 1;
  });
}

module.exports = { createKeyProvider, issueBusinessInvite };
