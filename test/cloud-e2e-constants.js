'use strict';

const TEST_IDENTITIES = Object.freeze({
  owner: 'team-owner-demo@smalldocs.org',
  selected: 'tom.smith@smalldocs.org',
  unselected: 'lenny.thompson@smalldocs.org',
  removed: 'dan.stow@smalldocs.org',
});

const TEST_LOGIN_EMAILS = Object.freeze([
  'personal-demo@smalldocs.org',
  TEST_IDENTITIES.owner,
  TEST_IDENTITIES.selected,
  TEST_IDENTITIES.unselected,
  TEST_IDENTITIES.removed,
  'maya.chen@smalldocs.org',
]);

const LOCAL_TEST_LOGIN_SECRET = 'local-playwright-cloud-secret-keep-out-of-deploys';

module.exports = { LOCAL_TEST_LOGIN_SECRET, TEST_IDENTITIES, TEST_LOGIN_EMAILS };
