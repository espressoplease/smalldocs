const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

test('signed-out Cloud document links preserve the document while redirecting to sign in', async ({ page }) => {
  await page.route('**/api/cloud/v1/documents/restricted-document', route => route.fulfill({
    status: 401, json: { ok: false, error: 'login_required' },
  }));

  await page.goto('/docs');
  await page.evaluate(() => {
    window.SDocs.Sources._reset();
    history.replaceState(null, '', '/docs?cloud-document=restricted-document');
  });
  await page.addScriptTag({ url: '/public/sdocs-cloud-prototype.js' });
  await page.evaluate(() => window.SDocs.Sources.select().load());
  await expect.poll(() => page.url()).toContain('/cloud/sign-in?return=');
  const returnTo = new URL(page.url()).searchParams.get('return');
  expect(returnTo).toBe('/docs?cloud-document=restricted-document');
});

test('signed-in users without access stay on a generic unavailable document page', async ({ page }) => {
  await page.route('**/api/cloud/v1/documents/restricted-document', route => route.fulfill({
    status: 404, json: { ok: false, error: 'resource_unavailable' },
  }));

  await page.goto('/docs');
  await page.evaluate(() => {
    window.SDocs.Sources._reset();
    history.replaceState(null, '', '/docs?cloud-document=restricted-document');
  });
  await page.addScriptTag({ url: '/public/sdocs-cloud-prototype.js' });
  await page.evaluate(() => window.SDocs.Sources.select().load());
  await expect(page.locator('#_sd_status-text')).toHaveText('Could not open this Cloud document.');
  expect(new URL(page.url()).pathname).toBe('/docs');
  expect(new URL(page.url()).searchParams.get('cloud-document')).toBe('restricted-document');
  await expect(page.locator('body')).not.toContainText('permission_denied');
});

test('Cloud identity canonicalizes a new-document URL without carrying its snapshot', async ({ page }) => {
  await page.goto('/new');
  await page.evaluate(async () => {
    window.SDocs._isDefaultState = false;
    window.SDocs.currentBody = '# New Cloud document';
    window.SDocs.currentMode = 'write';
    history.replaceState(null, '', '/new#md=stale-local-snapshot&present=0');
    window.SDocs.cloudDocument = { id: 'doc canonical' };
    await window.SDocs.updateDocumentLocationNow();
  });
  const url = new URL(page.url());
  expect(url.pathname).toBe('/docs');
  expect(url.searchParams.get('cloud-document')).toBe('doc canonical');
  expect(url.hash).not.toContain('md=');
  expect(new URLSearchParams(url.hash.slice(1)).get('mode')).toBe('write');
  expect(new URLSearchParams(url.hash.slice(1)).get('present')).toBe('0');
});

test('real Cloud document controls save, share, tag, and remove through account APIs', async ({ page }) => {
  const calls = [];
  let revision = 1;
  let releaseRemovalSave = null;
  let heldRemovalSave = false;
  let tags = [];
  let permission = { id: 'group-1', account_id: 'acct-1', document_id: 'doc-1',
    mode: 'custom', member_user_ids: ['usr-1'], owner_user_id: 'usr-1', can_manage: true };
  await page.route('**/api/cloud/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push({ method: request.method(), path,
      body: request.method() === 'GET' ? null : request.postDataJSON() });
    if (path === '/api/cloud/v1/workspaces') return route.fulfill({ json: { ok: true,
      workspaces: [{ id: 'acct-1', kind: 'team', name: 'SmallDocs', role: 'admin' }],
      user: { id: 'usr-1', first_name: 'Josh', last_name: 'Summers' } } });
    if (path === '/api/cloud/v1/account') return route.fulfill({ json: { ok: true,
      account: { id: 'acct-1', kind: 'team', name: 'SmallDocs', role: 'admin', can_write: true },
      accounts: [], user: { id: 'usr-1', email: 'josh@example.com',
        first_name: 'Josh', last_name: 'Summers' } } });
    if (path === '/api/cloud/v1/account/members') return route.fulfill({ json: { ok: true,
      account_id: 'acct-1', members: [
        { user_id: 'usr-1', email: 'josh@example.com', name: 'Josh', initials: 'JS', is_you: true },
        { user_id: 'usr-2', email: 'tom@example.com', name: 'Tom Smith', initials: 'TS', is_you: false },
      ] } });
    if (path === '/api/cloud/v1/account/tags') return route.fulfill({ json: { ok: true,
      account_id: 'acct-1', tags: [{ tag: 'planning', count: 4 }] } });
    if (path === '/api/cloud/v1/account/documents') return route.fulfill({ status: 201, json: {
      ok: true, account: { id: 'acct-1', kind: 'team', name: 'SmallDocs' },
      document: { id: 'doc-1', filename: 'sdoc.md', title: 'SmallDocs', tags,
        current_revision_id: 'rev-1', revision_number: 1, workspace_id: 'acct-1' }, permission } });
    if (path === '/api/cloud/v1/documents/doc-1/permission') {
      const body = request.postDataJSON();
      permission = Object.assign({}, permission, { mode: body.mode,
        member_user_ids: body.mode === 'everyone' ? ['usr-1'] : ['usr-1'].concat(body.member_user_ids || []) });
      return route.fulfill({ json: { ok: true, permission } });
    }
    if (path === '/api/cloud/v1/documents/doc-1/tags') {
      tags = request.postDataJSON().tags;
      revision += 1;
      return route.fulfill({ json: { ok: true, document: { id: 'doc-1', filename: 'sdoc.md',
        title: 'SmallDocs', tags, current_revision_id: 'rev-' + revision, revision_number: revision } } });
    }
    if (path === '/api/cloud/v1/documents/doc-1/revisions') {
      const body = request.postDataJSON();
      if (!heldRemovalSave && body.markdown.includes('First edit before removal.')) {
        heldRemovalSave = true;
        await new Promise(resolve => { releaseRemovalSave = resolve; });
      }
      revision += 1;
      return route.fulfill({ status: 201, json: { ok: true, document: {
        id: 'doc-1', filename: 'sdoc.md', title: 'SmallDocs', tags,
        current_revision_id: 'rev-' + revision, revision_number: revision,
        workspace_id: 'acct-1' } } });
    }
    if (path === '/api/cloud/v1/documents/doc-1' && request.method() === 'DELETE') {
      return route.fulfill({ json: { ok: true, document: { id: 'doc-1' } } });
    }
    return route.fulfill({ status: 404, json: { ok: false, error: 'resource_unavailable' } });
  });

  await page.goto('/docs');
  await page.addStyleTag({ url: '/public/css/cloud-ui-lab.css' });
  await page.evaluate(() => {
    window.SDocs._isDefaultState = false;
    window.SDocs.currentBody += '\n\nLocal upload marker.';
    window.SDocs.syncAll('write');
  });
  await expect.poll(() => new URL(page.url()).hash).toContain('md=');
  await page.addScriptTag({ url: '/public/sdocs-cloud-account-selection.js' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-prototype.js' });
  await expect(page.locator('.sdoc-cloud-lab-add-link')).toBeVisible();
  await expect.poll(() => calls.some(call => call.path === '/api/cloud/v1/account')).toBe(true);
  await expect(page.locator('.fic-row-cloud')).not.toContainText('paid feature');
  await page.locator('.sdoc-cloud-lab-add-link').click();
  await expect(page.locator('.sdoc-cloud-lab-access')).toContainText('You');
  expect(calls.some(call => call.method === 'POST' &&
    call.path === '/api/cloud/v1/account/documents')).toBe(true);
  await expect.poll(() => page.url()).toContain('/docs?cloud-document=doc-1');
  expect(new URL(page.url()).hash).not.toContain('md=');

  await page.getByRole('button', { name: 'Comment mode' }).click();
  await expect(page.locator('#_sd_comment-pref-author')).toHaveValue('Josh Summers');
  await expect(page.locator('#_sd_comment-pref-author')).toHaveAttribute('readonly', '');
  await page.evaluate(() => {
    var prefs = window.SDocs.commentsUi.readPrefs();
    var result = window.SDocComments.addBlockComment(window.SDocs.currentMeta || {},
      { block: 'p:0', block_text: 'SmallDocs' },
      { text: 'Cloud comment', author: prefs.author, color: prefs.color,
        at: '2026-08-20T15:30:00.000Z' });
    window.SDocs.currentMeta = result.meta;
    window.SDocs.syncAll('comment');
  });
  await expect.poll(() => calls.filter(call =>
    call.path === '/api/cloud/v1/documents/doc-1/revisions').length).toBe(1);
  const createCall = calls.find(call => call.path === '/api/cloud/v1/account/documents');
  const commentCall = calls.find(call =>
    call.path === '/api/cloud/v1/documents/doc-1/revisions');
  const savedComment = commentCall.body.markdown;
  expect(commentCall.body.target_markdown).toBe(createCall.body.markdown);
  expect(savedComment).toContain('author: "Josh Summers"');
  expect(savedComment).toContain('at: "2026-08-20T15:30:00.000Z"');
  expect(savedComment).toContain('text: "Cloud comment"');
  const savedFrontMatter = savedComment.slice(0, savedComment.indexOf('\n---\n', 4));
  expect(savedFrontMatter).not.toContain('baseFontSize: 16');

  await page.evaluate(() => {
    window.SDocs.currentBody += '\n\nCloud body edit.';
    window.SDocs.syncAll('write');
  });
  await expect.poll(() => calls.filter(call =>
    call.path === '/api/cloud/v1/documents/doc-1/revisions').length).toBe(2);
  const savedBody = calls.filter(call =>
    call.path === '/api/cloud/v1/documents/doc-1/revisions')[1].body.markdown;
  expect(savedBody).toContain('Cloud body edit.');
  expect(calls.filter(call =>
    call.path === '/api/cloud/v1/documents/doc-1/revisions')[1]
    .body.target_revision_id).toBe('rev-2');
  expect(calls.filter(call =>
    call.path === '/api/cloud/v1/documents/doc-1/revisions')[1]
    .body.target_markdown).toBe(savedComment);

  await page.locator('.sdoc-cloud-lab-access').click();
  await expect(page.getByRole('textbox', { name: 'Company email domain' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Email address' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Everyone' }).click();
  await expect(page.locator('.sdoc-cloud-lab-access')).toContainText('Everyone');

  await page.getByRole('button', { name: 'Edit Cloud tags' }).click();
  await page.getByRole('textbox', { name: 'New Cloud tag' }).fill('release');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.fic-row-cloud')).toContainText('#release');
  const tagCall = calls.find(call => call.path === '/api/cloud/v1/documents/doc-1/tags');
  expect(tagCall.body.target_revision_id).toBe('rev-3');
  expect(tagCall.body.target_markdown).toBe(savedBody);
  expect(tagCall.body.expected_head_revision_id).toBeUndefined();

  await page.evaluate(() => {
    window.SDocs.currentBody += '\n\nFirst edit before removal.';
    window.SDocs.syncAll('write');
  });
  await expect.poll(() => typeof releaseRemovalSave).toBe('function');
  await page.evaluate(() => {
    window.SDocs.currentBody += '\n\nSecond edit while the first save is in flight.';
    window.SDocs.syncAll('write');
  });
  await page.locator('.sdoc-cloud-lab-saved').click();
  releaseRemovalSave();
  await expect(page.locator('.sdoc-cloud-lab-add-link')).toBeVisible();
  const finalRevisionIndex = calls.findLastIndex(call =>
    call.path === '/api/cloud/v1/documents/doc-1/revisions');
  const deleteIndex = calls.findIndex(call => call.method === 'DELETE' &&
    call.path === '/api/cloud/v1/documents/doc-1');
  expect(finalRevisionIndex).toBeGreaterThan(-1);
  expect(deleteIndex).toBeGreaterThan(finalRevisionIndex);
  expect(calls[finalRevisionIndex].body.markdown)
    .toContain('Second edit while the first save is in flight.');
  expect(calls[deleteIndex].body.expected_head_revision_id).toBe('rev-6');
  const localUrl = new URL(page.url());
  expect(localUrl.searchParams.has('cloud-document')).toBe(false);
  expect(localUrl.hash).toContain('md=');
  await page.reload();
  await expect(page.locator('#_sd_rendered')).toContainText('Cloud body edit.');
  await expect(page.locator('#_sd_rendered'))
    .toContainText('Second edit while the first save is in flight.');
});

test('Add to Cloud asks before uploading when several accounts have no saved choice', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  const calls = [];
  await page.route('**/api/cloud/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push({ method: request.method(), path: url.pathname, query: url.search });
    if (url.pathname === '/api/cloud/v1/workspaces') return route.fulfill({ json: { ok: true,
      workspaces: [
        { id: 'personal-1', kind: 'personal', name: 'Personal', role: 'owner' },
        { id: 'team-1', kind: 'team', name: 'SmallDocs', role: 'owner' },
      ], user: { id: 'user-1', first_name: 'Josh', last_name: 'Summers' } } });
    if (url.pathname === '/api/cloud/v1/account') return route.fulfill({ json: { ok: true,
      account: { id: 'team-1', kind: 'team', name: 'SmallDocs', role: 'owner', can_write: true },
      accounts: [], user: { id: 'user-1', first_name: 'Josh', last_name: 'Summers' } } });
    if (url.pathname === '/api/cloud/v1/account/members') {
      return route.fulfill({ json: { ok: true, members: [] } });
    }
    if (url.pathname === '/api/cloud/v1/account/tags') {
      return route.fulfill({ json: { ok: true, tags: [] } });
    }
    if (url.pathname === '/api/cloud/v1/account/documents') return route.fulfill({ status: 201,
      json: { ok: true, account: { id: 'team-1', kind: 'team', name: 'SmallDocs' },
        document: { id: 'doc-2', filename: 'sdoc.md', title: 'SmallDocs', tags: [],
          current_revision_id: 'rev-1', revision_number: 1, workspace_id: 'team-1' },
        permission: { mode: 'custom', member_user_ids: [] } } });
    return route.fulfill({ status: 404, json: { ok: false, error: 'resource_unavailable' } });
  });

  await page.goto('/docs');
  await page.addStyleTag({ url: '/public/css/cloud-ui-lab.css' });
  await page.evaluate(() => { window.SDocs._isDefaultState = false; });
  await page.addScriptTag({ url: '/public/sdocs-cloud-account-selection.js' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-prototype.js' });
  await page.locator('.sdoc-cloud-lab-add-link').click();

  await expect(page.getByRole('heading', { name: 'Choose an account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Josh Summers' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'SmallDocs' })).toBeVisible();
  expect(calls.some(call => call.path === '/api/cloud/v1/account/documents')).toBe(false);

  await page.getByRole('button', { name: 'SmallDocs' }).click();
  await expect(page.locator('.sdoc-cloud-lab-access')).toBeVisible();
  expect(calls.some(call => call.path === '/api/cloud/v1/account'
    && call.query === '?account_id=team-1')).toBe(true);
  expect(calls.some(call => call.path === '/api/cloud/v1/account/documents')).toBe(true);
});

test('Add to Cloud releases a live bridge before later Cloud autosaves', async ({ page }) => {
  const calls = [];
  await page.route('**/api/cloud/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push({ method: request.method(), path });
    if (path === '/api/cloud/v1/workspaces') return route.fulfill({ json: { ok: true,
      workspaces: [{ id: 'acct-1', kind: 'personal', name: 'Personal', role: 'owner' }],
      user: { id: 'usr-1', first_name: 'Josh', last_name: 'Summers' } } });
    if (path === '/api/cloud/v1/account') return route.fulfill({ json: { ok: true,
      account: { id: 'acct-1', kind: 'personal', name: 'Personal', role: 'owner', can_write: true },
      accounts: [], user: { id: 'usr-1', first_name: 'Josh', last_name: 'Summers' } } });
    if (path === '/api/cloud/v1/account/members') {
      return route.fulfill({ json: { ok: true, members: [] } });
    }
    if (path === '/api/cloud/v1/account/tags') {
      return route.fulfill({ json: { ok: true, tags: [] } });
    }
    if (path === '/api/cloud/v1/account/documents') return route.fulfill({ status: 201,
      json: { ok: true, account: { id: 'acct-1', kind: 'personal', name: 'Personal' },
        document: { id: 'doc-bridge', filename: 'bridge.md', title: 'Bridge', tags: [],
          current_revision_id: 'rev-1', revision_number: 1, workspace_id: 'acct-1' },
        permission: { mode: 'custom', member_user_ids: [] } } });
    if (path === '/api/cloud/v1/documents/doc-bridge/revisions') {
      return route.fulfill({ status: 201, json: { ok: true, document: {
        id: 'doc-bridge', filename: 'bridge.md', title: 'Bridge', tags: [],
        current_revision_id: 'rev-2', revision_number: 2, workspace_id: 'acct-1' } } });
    }
    return route.fulfill({ status: 404, json: { ok: false, error: 'resource_unavailable' } });
  });

  await page.goto('/docs');
  await page.addStyleTag({ url: '/public/css/cloud-ui-lab.css' });
  await page.evaluate(() => {
    window.SDocs._isDefaultState = false;
    window.SDocs.currentBody = '# Bridge document\n\nBefore Cloud.';
    window.SDocs.localMeta = { fullPath: '/tmp/bridge.md', path: './bridge.md' };
    sessionStorage.setItem('sdocs.localMeta', JSON.stringify(window.SDocs.localMeta));
    window.SDocs.syncAll('write');
  });
  await page.addScriptTag({ url: '/public/sdocs-cloud-account-selection.js' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-prototype.js' });
  await page.evaluate(() => {
    const bridge = new window.SDocs.bridgeInternals.BridgeSource({
      addr: '127.0.0.1:1', token: 'test', file: 'bridge.md', md: null,
    });
    bridge._connected = true;
    bridge._helloed = true;
    bridge._ws = {
      readyState: 1,
      sent: [],
      closed: false,
      send(value) { this.sent.push(value); },
      close() { this.closed = true; },
    };
    bridge._lastWritten = bridge._currentDocument();
    bridge._installAutoSaveHook();
    window._testBridge = bridge;
  });

  await page.locator('.sdoc-cloud-lab-add-link').click();
  await expect.poll(() => page.url()).toContain('cloud-document=doc-bridge');
  const released = await page.evaluate(() => ({
    released: window._testBridge._releasedToCloud,
    canSave: window._testBridge.capabilities.canSave,
    closed: window._testBridge._ws.closed,
    sent: window._testBridge._ws.sent.length,
    activeBridge: window.SDocs.bridge,
    localMeta: window.SDocs.localMeta,
    storedLocalMeta: sessionStorage.getItem('sdocs.localMeta'),
  }));
  expect(released).toEqual({ released: true, canSave: false, closed: true, sent: 0,
    activeBridge: null, localMeta: {}, storedLocalMeta: null });
  await expect(page.locator('.fic-row-bridge')).toHaveCount(0);

  await page.evaluate(() => {
    window.SDocs.currentBody += '\n\nCloud-only edit.';
    window.SDocs.syncAll('write');
  });
  await expect.poll(() => calls.filter(call =>
    call.path === '/api/cloud/v1/documents/doc-bridge/revisions').length).toBe(1);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window._testBridge._ws.sent.length)).toBe(0);
});

test('Cloud checks apply remote updates when clean and merge them with local edits', async ({ page }) => {
  const revisionCalls = [];
  let serverDocument = { id: 'doc-shared', filename: 'shared.md', title: 'Shared', tags: [],
    current_revision_id: 'rev-1', revision_number: 1, workspace_id: 'acct-1',
    markdown: '# Shared\n\nInitial.' };
  await page.route('**/api/cloud/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/cloud/v1/workspaces') return route.fulfill({ json: { ok: true,
      workspaces: [{ id: 'acct-1', kind: 'personal', name: 'Personal', role: 'owner' }],
      user: { id: 'usr-1', first_name: 'Josh', last_name: 'Summers' } } });
    if (path === '/api/cloud/v1/account') return route.fulfill({ json: { ok: true,
      account: { id: 'acct-1', kind: 'personal', name: 'Personal', role: 'owner', can_write: true },
      accounts: [], user: { id: 'usr-1', first_name: 'Josh', last_name: 'Summers' } } });
    if (path === '/api/cloud/v1/account/members') {
      return route.fulfill({ json: { ok: true, members: [] } });
    }
    if (path === '/api/cloud/v1/account/tags') {
      return route.fulfill({ json: { ok: true, tags: [] } });
    }
    if (path === '/api/cloud/v1/documents/doc-shared/head') {
      return route.fulfill({ json: { ok: true, document: {
        id: serverDocument.id, current_revision_id: serverDocument.current_revision_id,
        revision_number: serverDocument.revision_number, updated_at: '2026-08-21T12:00:00.000Z',
      } } });
    }
    if (path === '/api/cloud/v1/documents/doc-shared' && request.method() === 'GET') {
      return route.fulfill({ json: { ok: true, document: serverDocument,
        permission: { mode: 'custom', member_user_ids: ['usr-1'] } } });
    }
    if (path === '/api/cloud/v1/documents/doc-shared/revisions') {
      const body = request.postDataJSON();
      revisionCalls.push(body);
      if (revisionCalls.length === 1) {
        serverDocument = Object.assign({}, serverDocument, {
          current_revision_id: 'rev-2', revision_number: 2, markdown: body.markdown,
        });
      } else {
        serverDocument = Object.assign({}, serverDocument, {
          current_revision_id: 'rev-5', revision_number: 5,
          markdown: '# Shared\n\nInitial local.\n\nRemote while editing.\n\nLocal dirty edit.',
          combined: true,
        });
      }
      return route.fulfill({ status: 201, json: { ok: true, document: serverDocument } });
    }
    return route.fulfill({ status: 404, json: { ok: false, error: 'resource_unavailable' } });
  });

  await page.goto('/docs');
  await page.addStyleTag({ url: '/public/css/cloud-ui-lab.css' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-account-selection.js' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-prototype.js' });
  await page.evaluate(() => {
    window.SDocs.cloudDocument = { id: 'doc-shared', filename: 'shared.md',
      current_revision_id: 'rev-1', revision_number: 1, workspace_id: 'acct-1' };
    window.SDocs._loadingDocument = false;
    window.SDocs.currentBody = '# Shared\n\nInitial local.';
    window.SDocs.syncAll('write');
  });
  await expect.poll(() => revisionCalls.length).toBe(1);
  expect(revisionCalls[0].target_revision_id).toBe('rev-1');

  serverDocument = Object.assign({}, serverDocument, {
    current_revision_id: 'rev-3', revision_number: 3,
    markdown: '# Shared\n\nInitial local.\n\nRemote clean update.',
  });
  await page.evaluate(() => window.SDocs.checkCloudNow());
  await expect.poll(() => page.evaluate(() => window.SDocs.currentBody))
    .toContain('Remote clean update.');

  await page.evaluate(() => {
    window.SDocs.currentBody += '\n\nLocal dirty edit.';
    window.SDocs.syncAll('write');
  });
  serverDocument = Object.assign({}, serverDocument, {
    current_revision_id: 'rev-4', revision_number: 4,
    markdown: '# Shared\n\nInitial local.\n\nRemote while editing.',
  });
  await page.evaluate(() => window.SDocs.checkCloudNow());
  await expect.poll(() => revisionCalls.length).toBe(2);
  expect(revisionCalls[1].target_revision_id).toBe('rev-3');
  await expect.poll(() => page.evaluate(() => window.SDocs.currentBody))
    .toContain('Remote while editing.');
  expect(await page.evaluate(() => window.SDocs.currentBody)).toContain('Local dirty edit.');
  await expect(page.locator('#_sd_status-text')).toContainText('combined');
});

test('an expired target preserves the local edit and offers copy recovery', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const revisionCalls = [];
  await page.route('**/api/cloud/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/cloud/v1/documents/doc-conflict/revisions') {
      revisionCalls.push(request.postDataJSON());
      return route.fulfill({ status: 409, json: { ok: false, error: 'target_too_old',
        document_id: 'doc-conflict', target_revision_id: 'rev-1',
        current_revision_id: 'rev-remote' } });
    }
    return route.fulfill({ status: 404, json: { ok: false, error: 'resource_unavailable' } });
  });

  await page.goto('/docs');
  await page.addStyleTag({ url: '/public/css/cloud-ui-lab.css' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-account-selection.js' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-prototype.js' });
  await page.evaluate(() => {
    window.SDocs.cloudDocument = { id: 'doc-conflict', filename: 'draft.md',
      current_revision_id: 'rev-1', revision_number: 1 };
    window.SDocs._loadingDocument = false;
    window.SDocs.currentBody = '# Draft\n\nMy unsaved edit.';
    window.SDocs.syncAll('write');
  });

  await expect.poll(() => revisionCalls.length).toBe(1);
  expect(revisionCalls[0].target_revision_id).toBe('rev-1');
  await expect(page.locator('#_sd_status-text')).toContainText('not saved to Cloud');
  await expect(page.getByRole('heading', { name: 'Cloud could not combine your edits' })).toBeVisible();
  expect(await page.evaluate(() => window.SDocs.currentBody)).toContain('My unsaved edit.');

  await page.evaluate(() => {
    window.SDocs.currentBody += '\n\nA second local edit.';
    window.SDocs.syncAll('write');
  });
  await page.waitForTimeout(1000);
  expect(revisionCalls).toHaveLength(1);
  expect(await page.evaluate(() => window.SDocs.currentBody)).toContain('A second local edit.');
  await page.getByRole('button', { name: 'Copy my edits' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('A second local edit.');
});

test('local comments do not create Cloud documents or revisions', async ({ page }) => {
  const mutationCalls = [];
  await page.route('**/api/cloud/v1/**', async route => {
    if (route.request().method() !== 'GET') mutationCalls.push({
      method: route.request().method(), path: new URL(route.request().url()).pathname });
    return route.fulfill({ status: 404, json: { ok: false, error: 'resource_unavailable' } });
  });

  await page.goto('/docs');
  await page.addStyleTag({ url: '/public/css/cloud-ui-lab.css' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-account-selection.js' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-prototype.js' });
  await page.evaluate(() => {
    var result = window.SDocComments.addBlockComment(window.SDocs.currentMeta || {},
      { block: 'p:0', block_text: 'SmallDocs' },
      { text: 'Local only', author: 'Local reader', color: '#ffbb00' });
    window.SDocs.currentMeta = result.meta;
    window.SDocs.syncAll('comment');
  });
  await page.waitForTimeout(250);
  expect(mutationCalls).toEqual([]);
});
