#!/usr/bin/env node
'use strict';

const { createBillingStore } = require('../lib/cloud-billing');
const billingLifecycle = require('../lib/cloud-billing-lifecycle');

function required(value, name) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(name + ' is required');
  return text;
}

function openWorkspaceDatabase(file) {
  const Database = require('better-sqlite3');
  return new Database(file, { readonly: true, fileMustExist: true });
}

function workspaceRecord(db, workspaceId) {
  return db.prepare(`
    SELECT w.id, w.kind,
      (SELECT COUNT(*) FROM cloud_workspace_memberships m
       WHERE m.workspace_id = w.id AND m.status = 'active') AS member_count
    FROM cloud_workspaces w
    WHERE w.id = ? AND w.deleted_at_ms IS NULL
  `).get(workspaceId);
}

function manage(input, options) {
  input = input || {};
  options = options || {};
  const workspaceId = required(input.workspace_id, 'workspace_id');
  const action = input.action || 'status';
  const cloudDb = openWorkspaceDatabase(required(options.cloudDb, 'CLOUD_DB'));
  const billing = createBillingStore({
    dbPath: required(options.billingDb, 'CLOUD_BILLING_DB'),
    planLimits: options.planLimits || billingLifecycle.DEFAULT_PLAN_LIMITS,
  });
  try {
    const workspace = workspaceRecord(cloudDb, workspaceId);
    if (!workspace) throw new Error('workspace was not found');
    const existing = billing.getSubscription(workspaceId);
    if (action === 'status') {
      return { ok: true, action, workspace_id: workspaceId, workspace_kind: workspace.kind,
        member_count: workspace.member_count, subscription: existing,
        entitlements: billing.computeEntitlements(workspaceId, {
          memberCount: workspace.member_count,
        }) };
    }
    if (action !== 'grant') throw new Error('action must be status or grant');
    if (existing && existing.provider && existing.provider !== 'manual') {
      throw new Error('workspace already has a ' + existing.provider + ' billing record');
    }
    const subscription = billing.upsertSubscription({
      workspaceId,
      plan: workspace.kind === 'team' ? 'team' : 'personal',
      status: 'active',
      seatQuantity: Math.max(1, workspace.member_count),
      provider: 'manual',
    });
    return { ok: true, action, workspace_id: workspaceId, workspace_kind: workspace.kind,
      member_count: workspace.member_count, subscription,
      entitlements: billing.computeEntitlements(workspaceId, {
        memberCount: workspace.member_count,
      }) };
  } finally {
    cloudDb.close();
    billing.db.close();
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

if (require.main === module) {
  readStdin().then((source) => {
    const input = JSON.parse(source);
    const planLimits = process.env.CLOUD_PLAN_LIMITS_JSON
      ? JSON.parse(process.env.CLOUD_PLAN_LIMITS_JSON) : undefined;
    const result = manage(input, {
      cloudDb: process.env.CLOUD_DB,
      billingDb: process.env.CLOUD_BILLING_DB,
      planLimits,
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }).catch((error) => {
    process.stderr.write('Could not manage Cloud access: ' + error.message + '\n');
    process.exitCode = 1;
  });
}

module.exports = { manage };
