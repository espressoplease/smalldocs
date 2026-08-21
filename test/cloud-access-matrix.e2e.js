const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { LOCAL_TEST_LOGIN_SECRET, TEST_IDENTITIES } = require('./cloud-e2e-constants');

function configuredSecret() {
  if (!process.env.CLOUD_E2E_BASE_URL) return LOCAL_TEST_LOGIN_SECRET;
  const secretFile = process.env.CLOUD_E2E_TEST_SECRET_FILE;
  if (!secretFile) {
    throw new Error('CLOUD_E2E_TEST_SECRET_FILE is required for a live staging run');
  }
  if (!fs.statSync(secretFile).isFile() || (fs.statSync(secretFile).mode & 0o077) !== 0) {
    throw new Error('CLOUD_E2E_TEST_SECRET_FILE must be a regular file readable only by its owner');
  }
  const secret = fs.readFileSync(secretFile, 'utf8').trim();
  if (secret.length < 32) throw new Error('Cloud E2E test secret must contain at least 32 characters');
  return secret;
}

async function login(browser, baseURL, email, secret) {
  const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true,
    serviceWorkers: 'block' });
  const response = await context.request.post(baseURL + '/api/cloud/auth/test-login', {
    headers: { Origin: baseURL },
    data: { email, secret, return_to: '/library?scope=cloud' },
  });
  expect(response.status(), 'staging login for ' + email).toBe(200);
  return context;
}

async function json(context, baseURL, method, pathname, data) {
  const response = await context.request.fetch(baseURL + pathname, {
    method,
    headers: { Origin: baseURL },
    data,
  });
  let body = null;
  try { body = await response.json(); } catch (_) {}
  return { response, body };
}

async function visibleDocumentIds(context, baseURL, accountId) {
  const result = await json(context, baseURL, 'GET',
    '/api/cloud/v1/documents?workspace_id=' + encodeURIComponent(accountId));
  expect(result.response.status()).toBe(200);
  return result.body.documents.map(document => document.id);
}

async function searchDocumentIds(context, baseURL, accountId, query, tags) {
  const result = await json(context, baseURL, 'POST', '/api/cloud/v1/search', {
    workspace_id: accountId,
    query,
    tags: tags || [],
  });
  expect(result.response.status()).toBe(200);
  return result.body.documents.map(document => document.id);
}

test('reusable staging identities enforce access and merge two-account edits', async ({ browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL).replace(/\/$/, '');
  const secret = configuredSecret();
  const contexts = {};
  let owner;
  let removed;
  let accountId;
  let projectId;
  let document;
  let removedUserId;

  try {
    for (const name of ['owner', 'selected', 'removed']) {
      const email = TEST_IDENTITIES[name];
      contexts[name] = await login(browser, baseURL, email, secret);
    }
    owner = contexts.owner;
    removed = contexts.removed;

    if (!process.env.CLOUD_E2E_BASE_URL) {
      const denied = await json(owner, baseURL, 'POST', '/api/cloud/auth/test-login', {
        email: 'not-allowlisted@smalldocs.org', secret, return_to: '/cloud/admin',
      });
      expect(denied.response.status()).toBe(403);
    }

    const workspaces = await json(owner, baseURL, 'GET', '/api/cloud/v1/workspaces');
    expect(workspaces.response.status()).toBe(200);
    const team = workspaces.body.workspaces.find(workspace =>
      workspace.kind === 'team' && workspace.name === 'SmallDocs Acceptance');
    expect(team).toBeTruthy();
    accountId = team.id;

    const members = await json(owner, baseURL, 'GET',
      '/api/cloud/v1/account/members?account_id=' + encodeURIComponent(accountId));
    expect(members.response.status()).toBe(200);
    const memberByEmail = new Map(members.body.members.map(member => [member.email, member]));
    const ownerMember = memberByEmail.get(TEST_IDENTITIES.owner);
    const selectedMember = memberByEmail.get(TEST_IDENTITIES.selected);
    const removedMember = memberByEmail.get(TEST_IDENTITIES.removed);
    expect(ownerMember).toBeTruthy();
    expect(selectedMember).toBeTruthy();
    expect(removedMember).toBeTruthy();
    removedUserId = removedMember.user_id;

    const projects = await json(owner, baseURL, 'GET',
      '/api/cloud/v1/projects?workspace_id=' + encodeURIComponent(accountId));
    expect(projects.response.status()).toBe(200);
    projectId = projects.body.projects.find(project => project.role === 'editor').id;

    const runId = Date.now() + '-' + Math.random().toString(16).slice(2);
    const created = await json(owner, baseURL, 'POST', '/api/cloud/v1/account/documents', {
      account_id: accountId,
      filename: 'cloud-access-matrix-' + runId + '.md',
      markdown: '---\ntags:\n  - seeded-local-tag\n---\n# Cloud access matrix ' + runId +
        '\n\nA unique permission test document.',
      idempotency_key: 'cloud-access-matrix-create-' + runId,
    });
    expect(created.response.status()).toBe(201);
    document = created.body.document;
    expect(created.body.permission.mode).toBe('custom');
    expect(created.body.permission.member_user_ids).toEqual([ownerMember.user_id]);

    for (const name of ['selected', 'removed']) {
      const opened = await json(contexts[name], baseURL, 'GET',
        '/api/cloud/v1/documents/' + document.id);
      expect(opened.response.status(), name + ' cannot open Only you').toBe(404);
      expect(await visibleDocumentIds(contexts[name], baseURL, accountId)).not.toContain(document.id);
      expect(await searchDocumentIds(contexts[name], baseURL, accountId, runId)).not.toContain(document.id);
    }

    const custom = await json(owner, baseURL, 'PATCH',
      '/api/cloud/v1/documents/' + document.id + '/permission', {
        mode: 'custom', member_user_ids: [selectedMember.user_id],
      });
    expect(custom.response.status()).toBe(200);
    expect(custom.body.permission.member_user_ids)
      .toEqual([ownerMember.user_id, selectedMember.user_id]);
    expect((await json(contexts.selected, baseURL, 'GET',
      '/api/cloud/v1/documents/' + document.id)).response.status()).toBe(200);
    expect(await visibleDocumentIds(contexts.selected, baseURL, accountId)).toContain(document.id);
    expect(await searchDocumentIds(contexts.selected, baseURL, accountId, runId)).toContain(document.id);
    expect((await json(contexts.removed, baseURL, 'GET',
      '/api/cloud/v1/documents/' + document.id)).response.status()).toBe(404);

    const tagged = await json(owner, baseURL, 'PATCH',
      '/api/cloud/v1/documents/' + document.id + '/tags', {
        tags: ['permission-matrix', 'shared-test'],
        expected_head_revision_id: document.current_revision_id,
        idempotency_key: 'cloud-access-matrix-tags-' + runId,
      });
    expect(tagged.response.status()).toBe(200);
    document = tagged.body.document;
    expect(document.tags).toEqual(['permission-matrix', 'shared-test']);
    const selectedTags = await json(contexts.selected, baseURL, 'GET',
      '/api/cloud/v1/account/tags?account_id=' + encodeURIComponent(accountId));
    expect(selectedTags.body.tags.map(item => item.tag)).toEqual(
      expect.arrayContaining(['permission-matrix', 'shared-test']));
    expect(await searchDocumentIds(contexts.selected, baseURL, accountId, runId,
      ['permission-matrix'])).toContain(document.id);

    const everyone = await json(owner, baseURL, 'PATCH',
      '/api/cloud/v1/documents/' + document.id + '/permission', {
        mode: 'everyone', member_user_ids: [],
      });
    expect(everyone.response.status()).toBe(200);
    expect(everyone.body.permission.mode).toBe('everyone');
    for (const name of ['selected', 'removed']) {
      const opened = await json(contexts[name], baseURL, 'GET',
        '/api/cloud/v1/documents/' + document.id);
      expect(opened.response.status(), name + ' can open Everyone').toBe(200);
      expect(opened.body.document.tags).toEqual(['permission-matrix', 'shared-test']);
      expect(await visibleDocumentIds(contexts[name], baseURL, accountId)).toContain(document.id);
    }

    const sharedOpened = await json(owner, baseURL, 'GET',
      '/api/cloud/v1/documents/' + document.id);
    expect(sharedOpened.response.status()).toBe(200);
    document = sharedOpened.body.document;
    const sharedTarget = document.current_revision_id;
    const ownerEdit = await json(owner, baseURL, 'POST',
      '/api/cloud/v1/documents/' + document.id + '/revisions', {
        target_revision_id: sharedTarget,
        target_markdown: document.markdown,
        filename: document.filename,
        markdown: document.markdown.replace('A unique permission test document.',
          'A unique permission test document.\n\nOwner contribution.'),
        idempotency_key: 'cloud-two-account-owner-' + runId,
      });
    expect(ownerEdit.response.status()).toBe(201);
    const selectedEdit = await json(contexts.selected, baseURL, 'POST',
      '/api/cloud/v1/documents/' + document.id + '/revisions', {
        target_revision_id: sharedTarget,
        target_markdown: document.markdown,
        filename: document.filename,
        markdown: document.markdown.replace('# Cloud access matrix ' + runId,
          '# Cloud access matrix ' + runId + '\n\nSelected account contribution.'),
        idempotency_key: 'cloud-two-account-selected-' + runId,
      });
    expect(selectedEdit.response.status()).toBe(201);
    document = selectedEdit.body.document;
    expect(document.merged_from_revision_id)
      .toBe(ownerEdit.body.document.current_revision_id);
    expect(document.markdown).toContain('Owner contribution.');
    expect(document.markdown).toContain('Selected account contribution.');
    const ownerFinal = await json(owner, baseURL, 'GET',
      '/api/cloud/v1/documents/' + document.id);
    expect(ownerFinal.body.document.markdown).toBe(document.markdown);

    const recoveryBase = document.markdown;
    const recoveryRemote = await json(owner, baseURL, 'POST',
      '/api/cloud/v1/documents/' + document.id + '/revisions', {
        target_revision_id: document.current_revision_id,
        target_markdown: recoveryBase,
        filename: document.filename,
        markdown: recoveryBase + '\n\nOwner edit after the recovery base.\n',
        idempotency_key: 'cloud-pruned-target-owner-' + runId,
      });
    expect(recoveryRemote.response.status()).toBe(201);
    const recovered = await json(contexts.selected, baseURL, 'POST',
      '/api/cloud/v1/documents/' + document.id + '/revisions', {
        target_revision_id: 'pruned-target-' + runId,
        target_markdown: recoveryBase,
        filename: document.filename,
        markdown: recoveryBase + '\n\nSelected edit from a pruned target.\n',
        idempotency_key: 'cloud-pruned-target-selected-' + runId,
      });
    expect(recovered.response.status()).toBe(201);
    document = recovered.body.document;
    expect(document.target_recovered).toBe(true);
    expect(document.merged_from_revision_id)
      .toBe(recoveryRemote.body.document.current_revision_id);
    expect(document.markdown).toContain('Owner edit after the recovery base.');
    expect(document.markdown).toContain('Selected edit from a pruned target.');

    const removedResponse = await json(owner, baseURL, 'DELETE',
      '/api/cloud/v1/workspaces/' + accountId + '/members/' + removedUserId, {});
    expect(removedResponse.response.status()).toBe(200);
    expect((await json(removed, baseURL, 'GET',
      '/api/cloud/v1/documents/' + document.id)).response.status()).toBe(404);
    expect(await visibleDocumentIds(removed, baseURL, accountId)).not.toContain(document.id);
    const removedSearch = await json(removed, baseURL, 'POST', '/api/cloud/v1/search', {
      workspace_id: accountId, query: runId,
    });
    expect(removedSearch.response.status()).toBe(404);

    const ownerPage = await owner.newPage();
    await ownerPage.goto('/library?scope=cloud&account_id=' + encodeURIComponent(accountId));
    const libraryRow = ownerPage.locator('.res[data-id="' + document.id + '"]');
    await expect(libraryRow.locator('.res-title')).toHaveText(document.title);
    await expect(libraryRow.locator('.tag')).toHaveText(['#permission-matrix', '#shared-test']);
  } finally {
    const cleanupErrors = [];
    if (owner && document) {
      try {
        const deleted = await json(owner, baseURL, 'DELETE',
          '/api/cloud/v1/documents/' + document.id, {
            expected_head_revision_id: document.current_revision_id,
          });
        if (deleted.response.status() !== 200) {
          cleanupErrors.push('test document cleanup returned ' + deleted.response.status());
        }
      } catch (error) {
        cleanupErrors.push('test document cleanup failed: ' + error.message);
      }
    }
    if (owner && removed && accountId && projectId && removedUserId) {
      try {
        const currentMembers = await json(owner, baseURL, 'GET',
          '/api/cloud/v1/account/members?account_id=' + encodeURIComponent(accountId));
        const stillActive = currentMembers.body && currentMembers.body.members.some(member =>
          member.user_id === removedUserId);
        if (!stillActive) {
          const invited = await json(owner, baseURL, 'POST',
            '/api/cloud/v1/workspaces/' + accountId + '/invitations', {
              email: TEST_IDENTITIES.removed,
              role: 'member',
              project_grants: [{ project_id: projectId, role: 'editor' }],
            });
          const acceptUrl = invited.body && invited.body.invitation && invited.body.invitation.accept_url;
          if (invited.response.status() !== 201 || !acceptUrl) {
            cleanupErrors.push('removed member reinvitation failed');
          } else {
            const token = new URL(acceptUrl).searchParams.get('token');
            const accepted = await json(removed, baseURL, 'POST',
              '/api/cloud/v1/invitations/' + encodeURIComponent(token) + '/accept', {});
            if (accepted.response.status() !== 200) {
              cleanupErrors.push('removed member restore returned ' + accepted.response.status());
            }
          }
        }
      } catch (error) {
        cleanupErrors.push('removed member restore failed: ' + error.message);
      }
    }
    await Promise.all(Object.values(contexts).map(context => context.close()));
    if (cleanupErrors.length) throw new Error(cleanupErrors.join('; '));
  }
});
