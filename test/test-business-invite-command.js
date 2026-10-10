'use strict';

const assert = require('assert');
const { issueBusinessInvite } = require('../ops/issue-business-invite');

module.exports = function (harness) {
  const { testAsync } = harness;

  return async function runBusinessInviteCommand() {
    await testAsync('business invite command creates an encrypted link without sending email', async () => {
      let createInput = null;
      const store = {
        db: { prepare() { return { get() { return { id: 'project-1' }; } }; } },
        async createInvitation(input) {
          createInput = input;
          return { id: 'invitation-1', token: 'private-token', expiresAtMs: 1800000000000 };
        },
      };
      const result = await issueBusinessInvite({
        workspace_id: 'workspace-1',
        inviter_user_id: 'user-1',
        first_name: 'Dexter',
        last_name: 'Horthy',
        email: 'dexter@humanlayer.dev',
        company: 'HumanLayer',
        inviter: 'Joshua',
      }, { store, origin: 'https://smalldocs.org' });
      const url = new URL(result.url);
      assert.strictEqual(result.email_sent, false);
      assert.strictEqual(url.searchParams.get('token'), 'private-token');
      assert.ok(url.hash.startsWith('#invite=v1.'));
      assert.strictEqual(createInput.userId, 'user-1');
      assert.deepStrictEqual(createInput.projectGrants,
        [{ projectId: 'project-1', role: 'editor' }]);
    });

    await testAsync('business invite command requires an active project', async () => {
      const store = {
        db: { prepare() { return { get() { return undefined; } }; } },
        async createInvitation() { throw new Error('should not run'); },
      };
      await assert.rejects(() => issueBusinessInvite({
        workspace_id: 'workspace-1', inviter_user_id: 'user-1', email: 'dexter@example.com',
      }, { store }), /workspace has no active project/);
    });
  };
};
