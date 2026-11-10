const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function ({ assert, testAsync }) {
  return async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-invitation-roles-'));
    const { createCloudStore, createLocalKeyProvider } = require('../lib/cloud-store');
    let now = Date.now();
    const store = createCloudStore({ dbPath: path.join(dir, 'cloud.db'), now: () => now,
      keyProvider: createLocalKeyProvider({ masterKey: Buffer.alloc(32, 7), environment: 'test' }),
      idempotencySecret: 'invitation-role-regression-secret' });
    try {
      const team = await store.createTeamWorkspace({ userId: 'owner', name: 'Engineering',
        projectName: 'Documents', inviteDomains: ['company.test'] });
      store.addWorkspaceMember({ actorUserId: 'owner', workspaceId: team.workspaceId,
        userId: 'member', role: 'member' });
      store.addWorkspaceMember({ actorUserId: 'owner', workspaceId: team.workspaceId,
        userId: 'admin', role: 'admin' });
      const invite = (actor, target, role = 'member', grantRole = 'viewer') => store.createInvitation({
        userId: actor, workspaceId: team.workspaceId, email: target + '@company.test', role,
        allowMemberInvite: true, projectGrants: [{ projectId: team.projectId, role: grantRole }] });
      const accept = (target, invitation) => store.acceptInvitation({ userId: target,
        verifiedEmails: [target + '@company.test'], token: invitation.token });
      const grant = target => store.db.prepare('SELECT role,revoked_at_ms FROM cloud_project_grants WHERE project_id=? AND user_id=?')
        .get(team.projectId, target);

      await testAsync('a coworker invitation cannot demote the final owner or their editor grant', async () => {
        store.grantProject({ actorUserId: 'owner', workspaceId: team.workspaceId, projectId: team.projectId,
          userId: 'owner', role: 'editor' });
        const invitation = await invite('member', 'owner');
        assert.strictEqual((await accept('owner', invitation)).role, 'owner');
        assert.deepStrictEqual(store.listWorkspaceOwnerUserIds(team.workspaceId), ['owner']);
        assert.strictEqual(grant('owner').role, 'editor');
        const accepted = await store.getInvitationDetails({ userId: 'owner', token: invitation.token,
          verifiedEmails: ['owner@company.test'] });
        assert.strictEqual(accepted.role, 'owner');
        assert.strictEqual(accepted.accepted, true);
        assert.throws(() => store.removeWorkspaceMember({ actorUserId: 'owner',
          workspaceId: team.workspaceId, userId: 'owner' }), error => error.code === 'final_owner_required');
      });

      await testAsync('invitations preserve other active owner and admin roles', async () => {
        store.transferWorkspaceOwnership({ actorUserId: 'owner', workspaceId: team.workspaceId, targetUserId: 'admin' });
        assert.strictEqual((await accept('admin', await invite('member', 'admin'))).role, 'owner');
        store.addWorkspaceMember({ actorUserId: 'owner', workspaceId: team.workspaceId, userId: 'admin2', role: 'admin' });
        assert.strictEqual((await accept('admin2', await invite('member', 'admin2'))).role, 'admin');
        assert.strictEqual((await accept('member', await invite('owner', 'member', 'admin'))).role, 'member');
        assert.strictEqual(store.listWorkspaceOwnerUserIds(team.workspaceId).length, 2);
      });

      await testAsync('new members and disabled members receive the invited role and grants', async () => {
        assert.strictEqual((await accept('new', await invite('owner', 'new', 'admin', 'editor'))).role, 'admin');
        store.removeWorkspaceMember({ actorUserId: 'owner', workspaceId: team.workspaceId, userId: 'new' });
        assert.ok(grant('new').revoked_at_ms != null);
        assert.strictEqual((await accept('new', await invite('owner', 'new', 'member', 'viewer'))).role, 'member');
        assert.deepStrictEqual(grant('new'), { role: 'viewer', revoked_at_ms: null });
      });

      await testAsync('accepting another invitation never lowers an active editor project grant', async () => {
        store.grantProject({ actorUserId: 'owner', workspaceId: team.workspaceId, projectId: team.projectId,
          userId: 'member', role: 'editor' });
        await accept('member', await invite('owner', 'member', 'member', 'viewer'));
        assert.deepStrictEqual(grant('member'), { role: 'editor', revoked_at_ms: null });
        await accept('new', await invite('owner', 'new', 'member', 'editor'));
        assert.deepStrictEqual(grant('new'), { role: 'editor', revoked_at_ms: null });
      });

      await testAsync('revoked and expired invitations cannot rejoin disabled members', async () => {
        store.removeWorkspaceMember({ actorUserId: 'owner', workspaceId: team.workspaceId, userId: 'new' });
        const revoked = await invite('owner', 'new');
        store.revokeWorkspaceInvitation({ userId: 'owner', workspaceId: team.workspaceId, invitationId: revoked.id });
        await assert.rejects(accept('new', revoked), error => error.code === 'resource_unavailable');
        const expired = await invite('owner', 'new');
        now = expired.expiresAtMs;
        await assert.rejects(accept('new', expired), error => error.code === 'resource_unavailable');
        assert.strictEqual(store._workspaceRole('new', team.workspaceId), null);
      });
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
};
