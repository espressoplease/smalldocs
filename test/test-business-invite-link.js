'use strict';

const assert = require('assert');
const { createInviteLink } = require('../ops/create-business-invite-link');

module.exports = function (harness) {
  const { test } = harness;

  test('business invite link keeps personal details out of the HTTP request URL', () => {
    const link = createInviteLink({
      token: 'invite-token',
      first_name: 'Dexter',
      last_name: 'Horthy',
      email: 'dexter@example.com',
      company: 'HumanLayer',
      inviter: 'Joshua',
    });
    const url = new URL(link);
    assert.strictEqual(url.pathname, '/cloud/business-invite');
    assert.strictEqual(url.searchParams.get('token'), 'invite-token');
    assert.ok(url.hash.startsWith('#invite=v1.'));
    assert.ok(!url.pathname.includes('Dexter'));
    assert.ok(!url.search.includes('dexter'));
    assert.ok(!url.search.includes('HumanLayer'));
  });
};
