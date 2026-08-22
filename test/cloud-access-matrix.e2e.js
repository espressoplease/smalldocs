const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { test, expect } = require('@playwright/test');
const { LOCAL_TEST_LOGIN_SECRET, TEST_IDENTITIES } = require('./cloud-e2e-constants');
const SDocYaml = require('../cli/shared/sdocs-yaml.js');

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

let ownerStorageState;

test.beforeAll(async ({ browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL).replace(/\/$/, '');
  const owner = await login(browser, baseURL, TEST_IDENTITIES.owner, configuredSecret());
  ownerStorageState = await owner.storageState();
  await owner.close();
});

function ownerContext(browser, baseURL) {
  return browser.newContext({ baseURL, ignoreHTTPSErrors: true,
    serviceWorkers: 'block', storageState: ownerStorageState });
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

function withComments(markdown, comments) {
  const parsed = SDocYaml.parseFrontMatter(markdown);
  const meta = Object.assign({}, parsed.meta || {});
  if (comments.length) meta.comments = comments;
  else delete meta.comments;
  return SDocYaml.serializeFrontMatter(meta) + '\n' + parsed.body;
}

function runCli(args, env) {
  const cli = path.join(__dirname, '..', 'cli', 'bin', 'sdocs-dev.js');
  const child = spawn(process.execPath, [cli].concat(args), {
    cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const completed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
  return { child, completed, stdout: () => stdout, stderr: () => stderr };
}

async function cliJson(args, env) {
  const result = await runCli(args.concat('--json'), env).completed;
  expect(result.code, result.stderr || result.stdout).toBe(0);
  return JSON.parse(result.stdout.trim());
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
    contexts.owner = await ownerContext(browser, baseURL);
    for (const name of ['selected', 'removed']) {
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

    const selectedWorkspaces = await json(contexts.selected, baseURL, 'GET',
      '/api/cloud/v1/workspaces');
    expect(selectedWorkspaces.response.status()).toBe(200);
    const ownerName = [workspaces.body.user.first_name, workspaces.body.user.last_name]
      .filter(Boolean).join(' ');
    const selectedName = [selectedWorkspaces.body.user.first_name,
      selectedWorkspaces.body.user.last_name].filter(Boolean).join(' ');
    const commentTarget = document.current_revision_id;
    const commentBase = document.markdown;
    const ownerCommentMarkdown = withComments(commentBase, [{
      id: 'c1', kind: 'block', block: 'p:0', block_text: 'Cloud access matrix',
      author: ownerName, color: '#2f6feb', at: '2026-08-21T15:00:00.000Z',
      text: 'Owner acceptance note',
    }]);
    const selectedCommentMarkdown = withComments(commentBase, [{
      id: 'c1', kind: 'block', block: 'p:0', block_text: 'Cloud access matrix',
      author: selectedName, color: '#0a8f45', at: '2026-08-21T15:00:01.000Z',
      text: 'Selected acceptance note',
    }]);
    const ownerComment = await json(owner, baseURL, 'POST',
      '/api/cloud/v1/documents/' + document.id + '/revisions', {
        target_revision_id: commentTarget,
        target_markdown: commentBase,
        filename: document.filename,
        markdown: ownerCommentMarkdown,
        idempotency_key: 'cloud-comment-owner-' + runId,
      });
    expect(ownerComment.response.status()).toBe(201);
    const selectedComment = await json(contexts.selected, baseURL, 'POST',
      '/api/cloud/v1/documents/' + document.id + '/revisions', {
        target_revision_id: commentTarget,
        target_markdown: commentBase,
        filename: document.filename,
        markdown: selectedCommentMarkdown,
        idempotency_key: 'cloud-comment-selected-' + runId,
      });
    expect(selectedComment.response.status()).toBe(201);
    document = selectedComment.body.document;
    let comments = SDocYaml.parseFrontMatter(document.markdown).meta.comments;
    expect(comments.map(comment => comment.author).sort()).toEqual([ownerName, selectedName].sort());
    expect(new Set(comments.map(comment => comment.id)).size).toBe(2);
    expect(document.comment_id_remaps).toHaveLength(1);

    comments = comments.map(comment => comment.author === ownerName
      ? Object.assign({}, comment, { text: 'Owner acceptance note edited' }) : comment);
    const editedComment = await json(owner, baseURL, 'POST',
      '/api/cloud/v1/documents/' + document.id + '/revisions', {
        target_revision_id: document.current_revision_id,
        target_markdown: document.markdown,
        filename: document.filename,
        markdown: withComments(document.markdown, comments),
        idempotency_key: 'cloud-comment-edit-' + runId,
      });
    expect(editedComment.response.status()).toBe(201);
    document = editedComment.body.document;
    const selectedReopen = await json(contexts.selected, baseURL, 'GET',
      '/api/cloud/v1/documents/' + document.id);
    expect(selectedReopen.response.status()).toBe(200);
    expect(SDocYaml.parseFrontMatter(selectedReopen.body.document.markdown).meta.comments)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ author: ownerName, text: 'Owner acceptance note edited' }),
      ]));

    comments = SDocYaml.parseFrontMatter(document.markdown).meta.comments
      .filter(comment => comment.author !== selectedName);
    const deletedComment = await json(contexts.selected, baseURL, 'POST',
      '/api/cloud/v1/documents/' + document.id + '/revisions', {
        target_revision_id: document.current_revision_id,
        target_markdown: document.markdown,
        filename: document.filename,
        markdown: withComments(document.markdown, comments),
        idempotency_key: 'cloud-comment-delete-' + runId,
      });
    expect(deletedComment.response.status()).toBe(201);
    document = deletedComment.body.document;
    const ownerReopen = await json(owner, baseURL, 'GET',
      '/api/cloud/v1/documents/' + document.id);
    expect(ownerReopen.response.status()).toBe(200);
    expect(SDocYaml.parseFrontMatter(ownerReopen.body.document.markdown).meta.comments)
      .toEqual([expect.objectContaining({
        author: ownerName, text: 'Owner acceptance note edited',
      })]);

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

    const deniedComments = SDocYaml.parseFrontMatter(document.markdown).meta.comments.concat([{
      id: 'c99', kind: 'block', block: 'p:0', block_text: 'Cloud access matrix',
      author: 'Removed member', color: '#888888', text: 'This must not be saved',
    }]);
    const removedCommentSave = await json(removed, baseURL, 'POST',
      '/api/cloud/v1/documents/' + document.id + '/revisions', {
        target_revision_id: document.current_revision_id,
        target_markdown: document.markdown,
        filename: document.filename,
        markdown: withComments(document.markdown, deniedComments),
        idempotency_key: 'cloud-comment-removed-' + runId,
      });
    expect(removedCommentSave.response.status()).toBe(404);
    const afterDeniedComment = await json(owner, baseURL, 'GET',
      '/api/cloud/v1/documents/' + document.id);
    expect(afterDeniedComment.response.status()).toBe(200);
    expect(afterDeniedComment.body.document.markdown).not.toContain('This must not be saved');
    document = afterDeniedComment.body.document;

    const ownerPage = await owner.newPage();
    await ownerPage.setViewportSize({ width: 390, height: 844 });
    await ownerPage.goto('/library?scope=cloud&account_id=' + encodeURIComponent(accountId));
    await expect(ownerPage.getByRole('link', { name: 'Local' })).toBeHidden();
    await expect(ownerPage.getByRole('link', { name: 'Cloud' })).toBeHidden();
    await expect(ownerPage.locator('#workspace-button')).toBeHidden();
    const libraryRow = ownerPage.locator('.res[data-id="' + document.id + '"]');
    await expect(libraryRow.locator('.res-title')).toHaveText(document.title);
    await expect(libraryRow.locator('.tag')).toHaveText(['#permission-matrix', '#shared-test']);
    await libraryRow.click();
    await expect.poll(() => new URL(ownerPage.url()).searchParams.get('cloud-document'))
      .toBe(document.id);
    await expect(ownerPage.locator('#_sd_rendered')).toContainText('Selected edit from a pruned target.');
    await expect.poll(() => ownerPage.evaluate(() => window.SDocs.currentMeta.comments))
      .toEqual([expect.objectContaining({
        author: ownerName, text: 'Owner acceptance note edited',
      })]);
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

test('a fresh CLI authorizes, manages a Cloud document, persists, and revokes its credential',
  async ({ browser }, testInfo) => {
    test.setTimeout(120000);
    const baseURL = String(testInfo.project.use.baseURL).replace(/\/$/, '');
    const owner = await ownerContext(browser, baseURL);
    const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-cli-e2e-'));
    const cliEnv = Object.assign({}, process.env, {
      SDOCS_HOME: cliHome,
      SDOCS_CLOUD_FILE_CREDENTIALS: '1',
      SDOCS_CLOUD_URL: baseURL,
    });
    if (!process.env.CLOUD_E2E_BASE_URL) cliEnv.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    let documentId = null;
    let loggedIn = false;

    try {
      const workspaces = await json(owner, baseURL, 'GET', '/api/cloud/v1/workspaces');
      expect(workspaces.response.status()).toBe(200);
      const team = workspaces.body.workspaces.find(workspace =>
        workspace.kind === 'team' && workspace.name === 'SmallDocs Acceptance');
      expect(team).toBeTruthy();
      const accountId = team.id;

      const loginProcess = runCli(['cloud', 'login', '--no-open', '--json'], cliEnv);
      await expect.poll(loginProcess.stderr, { timeout: 10000 })
        .toContain('Authorize this CLI at:');
      const verificationUrl = loginProcess.stderr().split('\n')
        .find(line => line.startsWith(baseURL + '/cloud/authorize?'));
      expect(verificationUrl).toBeTruthy();
      const authorizePage = await owner.newPage();
      await authorizePage.goto(verificationUrl);
      await expect(authorizePage.getByText(/Request from/)).toBeVisible();
      await authorizePage.getByRole('button', { name: 'Authorize CLI' }).click();
      await expect(authorizePage.getByText('CLI authorized. You can return to the terminal.'))
        .toBeVisible();
      const loginResult = await loginProcess.completed;
      expect(loginResult.code, loginResult.stderr || loginResult.stdout).toBe(0);
      expect(JSON.parse(loginResult.stdout.trim())).toMatchObject({
        ok: true, command: 'cloud.login',
      });
      loggedIn = true;

      const status = await cliJson(['cloud', 'status', '--account', accountId], cliEnv);
      expect(status).toMatchObject({ ok: true, command: 'cloud.status',
        account: { id: accountId } });
      expect(status.credential_id).toBeTruthy();
      const credentialPath = path.join(cliHome, 'cloud', 'credentials.json');
      expect(fs.statSync(credentialPath).mode & 0o777).toBe(0o600);

      const runId = Date.now() + '-' + Math.random().toString(16).slice(2);
      const source = path.join(cliHome, 'cli-acceptance-' + runId + '.md');
      fs.writeFileSync(source, '# CLI acceptance ' + runId + '\n\nCreated from a fresh machine.\n');
      const created = await cliJson(['cloud', 'create', source, '--account', accountId], cliEnv);
      expect(created).toMatchObject({ ok: true, command: 'cloud.create',
        account_id: accountId, binding_created: true });
      documentId = created.document_id;

      const privateDocument = await json(owner, baseURL, 'GET',
        '/api/cloud/v1/documents/' + documentId);
      expect(privateDocument.response.status()).toBe(200);
      expect(privateDocument.body.permission.mode).toBe('custom');
      expect(privateDocument.body.permission.member_user_ids).toEqual([
        privateDocument.body.permission.owner_user_id,
      ]);
      const tagged = await cliJson(['cloud', 'tag', documentId,
        '--tag', 'cli-acceptance', '--tag', 'release-candidate'], cliEnv);
      expect(tagged.tags).toEqual(['cli-acceptance', 'release-candidate']);
      const access = await cliJson(['cloud', 'access', documentId, '--everyone'], cliEnv);
      expect(access.permission.mode).toBe('everyone');
      expect((await json(owner, baseURL, 'GET',
        '/api/cloud/v1/documents/' + documentId)).body.permission.mode).toBe('everyone');

      const members = await cliJson(['cloud', 'members', '--account', accountId], cliEnv);
      expect(members.members.length).toBeGreaterThanOrEqual(3);
      const tags = await cliJson(['cloud', 'tags', '--account', accountId], cliEnv);
      expect(tags.tags.map(item => item.tag)).toContain('cli-acceptance');
      const groups = await cliJson(['cloud', 'permission-groups', '--account', accountId], cliEnv);
      expect(groups.permission_groups).toEqual(expect.arrayContaining([
        expect.objectContaining({ document_id: documentId, mode: 'everyone' }),
      ]));
      const listed = await cliJson(['cloud', 'ls', '--tag', 'cli-acceptance'], cliEnv);
      expect(listed.documents.map(item => item.id)).toContain(documentId);
      const searched = await cliJson(['cloud', 'search', runId], cliEnv);
      expect(searched.documents.map(item => item.id)).toContain(documentId);

      const pulledPath = path.join(cliHome, 'pulled-' + runId + '.md');
      const pulled = await cliJson(['cloud', 'pull', documentId, '--output', pulledPath], cliEnv);
      expect(pulled).toMatchObject({ document_id: documentId, binding_created: true });
      expect(fs.readFileSync(pulledPath, 'utf8')).toContain('Created from a fresh machine.');
      fs.appendFileSync(pulledPath, '\nUpdated through the CLI.\n');
      const pushed = await cliJson(['cloud', 'push', pulledPath], cliEnv);
      expect(pushed).toMatchObject({ document_id: documentId, no_change: false });
      expect((await json(owner, baseURL, 'GET',
        '/api/cloud/v1/documents/' + documentId)).body.document.markdown)
        .toContain('Updated through the CLI.');
      const history = await cliJson(['cloud', 'history', documentId], cliEnv);
      expect(history.revisions.length).toBeGreaterThanOrEqual(2);

      const deleted = await cliJson(['cloud', 'delete', documentId,
        '--base-revision', pushed.revision_id], cliEnv);
      expect(deleted.document_id).toBe(documentId);
      const deletedList = await cliJson(['cloud', 'deleted'], cliEnv);
      expect(deletedList.documents.map(item => item.id)).toContain(documentId);
      const restored = await cliJson(['cloud', 'undelete', documentId,
        '--base-revision', pushed.revision_id], cliEnv);
      expect(restored.document_id).toBe(documentId);

      const logout = await cliJson(['cloud', 'logout'], cliEnv);
      expect(logout).toMatchObject({ ok: true, command: 'cloud.logout', logged_out: true });
      loggedIn = false;
      expect(JSON.parse(fs.readFileSync(credentialPath, 'utf8'))).toEqual({});
      expect(fs.statSync(credentialPath).mode & 0o777).toBe(0o600);
      const signedOut = await runCli(['cloud', 'status', '--account', accountId, '--json'], cliEnv)
        .completed;
      expect(signedOut.code).toBe(3);
      expect(JSON.parse(signedOut.stdout.trim())).toMatchObject({
        ok: false, command: 'cloud.status', error: 'login_required',
      });
    } finally {
      if (documentId) {
        const opened = await json(owner, baseURL, 'GET', '/api/cloud/v1/documents/' + documentId);
        if (opened.response.status() === 200) {
          await json(owner, baseURL, 'DELETE', '/api/cloud/v1/documents/' + documentId, {
            expected_head_revision_id: opened.body.document.current_revision_id,
          });
        }
      }
      if (loggedIn) await runCli(['cloud', 'logout', '--json'], cliEnv).completed;
      await owner.close();
      fs.rmSync(cliHome, { recursive: true, force: true });
    }
  });
