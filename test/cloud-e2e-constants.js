'use strict';

const TEST_IDENTITIES = Object.freeze({
  owner: 'access-owner@smalldocs.org',
  selected: 'access-selected@smalldocs.org',
  removed: 'access-removed@smalldocs.org',
  outsider: 'personal-demo@smalldocs.org',
});

const TEST_LOGIN_EMAILS = Object.freeze([
  TEST_IDENTITIES.outsider,
  TEST_IDENTITIES.owner,
  TEST_IDENTITIES.selected,
  TEST_IDENTITIES.removed,
  'team-owner-demo@smalldocs.org',
  'tom.smith@smalldocs.org',
  'lenny.thompson@smalldocs.org',
  'dan.stow@smalldocs.org',
  'maya.chen@smalldocs.org',
]);

const LOCAL_TEST_LOGIN_SECRET = 'local-playwright-cloud-secret-keep-out-of-deploys';

module.exports = { LOCAL_TEST_LOGIN_SECRET, TEST_IDENTITIES, TEST_LOGIN_EMAILS };
