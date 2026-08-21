#!/usr/bin/env node
'use strict';

if (process.env.CLOUD_ENVIRONMENT !== 'staging') {
  throw new Error('This script runs only with CLOUD_ENVIRONMENT=staging');
}

const { createAuthStore } = require('../lib/cloud-auth');
const { createBillingStore } = require('../lib/cloud-billing');
const { createCloudStore, createLocalKeyProvider, defaultInviteDomainFromEmail } =
  require('../lib/cloud-store');

const required = ['CLOUD_AUTH_DB', 'CLOUD_DB', 'CLOUD_BILLING_DB', 'CLOUD_AUTH_PEPPER',
  'CLOUD_IDEMPOTENCY_SECRET', 'CLOUD_MASTER_KEY'];
required.forEach((name) => {
  if (!process.env[name]) throw new Error(name + ' is required');
});

const auth = createAuthStore({ dbPath: process.env.CLOUD_AUTH_DB,
  pepper: process.env.CLOUD_AUTH_PEPPER });
const keyProvider = createLocalKeyProvider({ masterKey: process.env.CLOUD_MASTER_KEY,
  environment: 'staging', reference: process.env.CLOUD_KEY_REFERENCE || 'local-staging-key' });
const cloud = createCloudStore({ dbPath: process.env.CLOUD_DB, keyProvider,
  idempotencySecret: process.env.CLOUD_IDEMPOTENCY_SECRET });
const billing = createBillingStore({ dbPath: process.env.CLOUD_BILLING_DB,
  planLimits: process.env.CLOUD_PLAN_LIMITS_JSON
    ? JSON.parse(process.env.CLOUD_PLAN_LIMITS_JSON) : {} });

function person(email, firstName, lastName) {
  const signedIn = auth.signInWithVerifiedEmail(email);
  return auth.updateUserProfile({ userId: signedIn.user.id, firstName, lastName });
}

async function main() {
  const individual = person('personal-demo@smalldocs.org', 'Personal', 'Demo');
  const individualAccount = await cloud.ensurePersonalWorkspace(
    individual.id, individual.firstName + ' ' + individual.lastName);
  billing.upsertSubscription({ workspaceId: individualAccount.workspaceId,
    plan: 'personal', status: 'active', seatQuantity: 1 });

  const teamOwner = person('team-owner-demo@smalldocs.org', 'Team', 'Owner');
  let team = (await cloud.listWorkspaces(teamOwner.id)).find((workspace) =>
    workspace.kind === 'team' && workspace.name === 'SmallDocs Demo');
  if (!team) {
    const created = await cloud.createTeamWorkspace({ userId: teamOwner.id,
      name: 'SmallDocs Demo', projectName: 'Documents',
      inviteDomains: [defaultInviteDomainFromEmail('team-owner-demo@smalldocs.org')].filter(Boolean) });
    team = { id: created.workspaceId };
  }
  const demoMemberProfiles = [
    ['tom.smith@smalldocs.org', 'Tom', 'Smith', 'admin'],
    ['lenny.thompson@smalldocs.org', 'Lenny', 'Thompson', 'member'],
    ['dan.stow@smalldocs.org', 'Dan', 'Stow', 'member'],
    ['maya.chen@smalldocs.org', 'Maya', 'Chen', 'member'],
  ];
  const demoMembers = demoMemberProfiles.map(([email, firstName, lastName, role]) => {
    const member = person(email, firstName, lastName);
    cloud.addWorkspaceMember({ actorUserId: teamOwner.id, workspaceId: team.id,
      userId: member.id, role });
    return { email, user_id: member.id, role };
  });
  billing.upsertSubscription({ workspaceId: team.id,
    plan: 'team', status: 'active', seatQuantity: 1 + demoMembers.length });

  const accessOwner = person('access-owner@smalldocs.org', 'Access', 'Owner');
  let accessTeam = (await cloud.listWorkspaces(accessOwner.id)).find((workspace) =>
    workspace.kind === 'team' && workspace.name === 'SmallDocs Acceptance');
  if (!accessTeam) {
    const created = await cloud.createTeamWorkspace({ userId: accessOwner.id,
      name: 'SmallDocs Acceptance', projectName: 'Documents', inviteDomains: ['smalldocs.org'] });
    accessTeam = { id: created.workspaceId };
  }
  const accessMemberProfiles = [
    ['access-selected@smalldocs.org', 'Access', 'Selected'],
    ['access-removed@smalldocs.org', 'Access', 'Removed'],
  ];
  const accessMembers = accessMemberProfiles.map(([email, firstName, lastName]) => {
    const member = person(email, firstName, lastName);
    cloud.addWorkspaceMember({ actorUserId: accessOwner.id, workspaceId: accessTeam.id,
      userId: member.id, role: 'member' });
    return { email, user_id: member.id, role: 'member' };
  });
  billing.upsertSubscription({ workspaceId: accessTeam.id,
    plan: 'team', status: 'active', seatQuantity: 1 + accessMembers.length });

  const result = {
    individual: { email: 'personal-demo@smalldocs.org', user_id: individual.id,
      account_id: individualAccount.workspaceId },
    team: { email: 'team-owner-demo@smalldocs.org', user_id: teamOwner.id,
      account_id: team.id, members: demoMembers },
    acceptance: { email: 'access-owner@smalldocs.org', user_id: accessOwner.id,
      account_id: accessTeam.id, members: accessMembers },
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main().finally(() => {
  auth.db.close();
  cloud.db.close();
  billing.db.close();
});
