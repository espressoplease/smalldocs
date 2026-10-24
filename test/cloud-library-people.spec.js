const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');

test.use({ serviceWorkers: 'block' });
let f;
test.beforeEach(async () => {
  f = await startFixture();
  f.auth.updateUserProfile({ userId: f.users.member.id, firstName: 'Alice', lastName: 'Chen' });
  f.store.grantProject({ actorUserId: f.users.bob.id, workspaceId: f.team.workspaceId,
    projectId: f.team.projectId, userId: f.users.member.id, role: 'editor' });
});
test.afterEach(async () => { if (f) await f.close(); });

async function openLibrary(page, actor = 'bob', workspaceId = f.team.workspaceId) {
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users[actor].sessionToken, url: f.origin }]);
  await page.goto(f.origin + '/library?scope=cloud&workspace=' + encodeURIComponent(workspaceId));
  await expect(page.locator('body')).not.toHaveClass(/cloud-library-loading/);
  await expect(page.locator('#status-line')).not.toHaveText('loading...');
}

async function createDocument(actor, title, options = {}) {
  const markdown = (options.tags ? '---\ntags:\n' + options.tags.map(tag => '  - ' + tag).join('\n') + '\n---\n' : '')
    + '# ' + title + '\n\n' + (options.body || 'Document text.');
  const response = await f.api(actor, '/api/cloud/v1/account/documents', 'POST', {
    account_id: options.workspaceId || f.team.workspaceId, filename: title.toLowerCase().replace(/\s+/g, '-') + '.md',
    markdown, idempotency_key: 'create-' + title,
  });
  expect(response.status, JSON.stringify(response.data)).toBe(201);
  if (options.shared !== false) {
    const shared = await f.api(actor, '/api/cloud/v1/documents/' + response.data.document.id + '/permission', 'PATCH', { mode: 'everyone' });
    expect(shared.status, JSON.stringify(shared.data)).toBe(200);
  }
  return response.data.document;
}

async function editDocument(actor, document, markdown) {
  const response = await f.api(actor, '/api/cloud/v1/documents/' + document.id + '/revisions', 'POST', {
    expected_head_revision_id: document.current_revision_id, markdown, filename: document.filename,
    idempotency_key: 'edit-' + document.id + '-' + actor,
  });
  expect(response.status, JSON.stringify(response.data)).toBe(201);
  return response.data.document;
}

function row(page, document) { return page.locator('.res[data-id="' + document.id + '"]'); }
function personChoice(page, actor) { return page.locator('[data-person-choice="' + f.users[actor].id + '"]'); }
function searchResponse(page, predicate) {
  return page.waitForResponse(response => response.url() === f.origin + '/api/cloud/v1/search'
    && predicate(response.request().postDataJSON()));
}

async function choosePerson(page, facet, actor) {
  if (await page.locator('[data-facet="' + facet + '"]').getAttribute('aria-expanded') !== 'true') {
    await page.locator('[data-facet="' + facet + '"]').click();
  }
  const response = searchResponse(page, body => (body[facet === 'author' ? 'author_user_ids' : 'updated_by_user_ids'] || []).includes(f.users[actor].id));
  await personChoice(page, actor).click();
  expect((await response).status()).toBe(200);
}

async function createSoloTeam() {
  const workspace = await f.store.createTeamWorkspace({ userId: f.users.bob.id, name: 'Personal notes', projectName: 'Documents' });
  f.billing.upsertSubscription({ workspaceId: workspace.workspaceId, plan: 'team', status: 'active', provider: 'manual' });
  return workspace;
}

test('Cloud rows show their creator and only a different latest editor, and both pills filter', async ({ page }) => {
  const edited = await createDocument('bob', 'Handoff plan');
  await editDocument('member', edited, '# Handoff plan\n\nAlice revised the plan.');
  const own = await createDocument('bob', 'Owner notes');
  await editDocument('bob', own, '# Owner notes\n\nOwner revised the notes.');
  const member = await createDocument('member', 'Member notes');
  await openLibrary(page);
  await expect(page.locator('.res')).toHaveCount(3);
  await expect(row(page, edited).locator('.cloud-library-person')).toHaveText(['You', 'Updated by Alice Chen']);
  await expect(row(page, edited).locator('[data-person-facet="author"]')).toHaveAttribute('title', 'Created by You');
  await expect(row(page, own).locator('.cloud-library-person')).toHaveText(['You']);
  await expect(row(page, member).locator('.cloud-library-person')).toHaveText(['Alice Chen']);
  await expect(page.locator('[data-facet="author"]')).toBeVisible();
  await expect(page.locator('[data-facet="updatedBy"]')).toBeVisible();

  const before = page.url();
  const creatorResponse = searchResponse(page, body => (body.author_user_ids || []).includes(f.users.bob.id));
  await row(page, edited).locator('[data-person-facet="author"]').click();
  expect((await creatorResponse).status()).toBe(200);
  await expect(page.locator('.res')).toHaveCount(2);
  await expect(page.locator('#count')).toHaveText('2 results');
  await expect(page.locator('#chips-row')).toContainText('Created by:You');
  await expect(personChoice(page, 'bob')).toHaveAttribute('aria-pressed', 'true');
  expect(page.url()).toBe(before);
  expect(page.context().pages()).toHaveLength(1);

  const editorResponse = searchResponse(page, body => (body.updated_by_user_ids || []).includes(f.users.member.id));
  await row(page, edited).locator('[data-person-facet="updatedBy"]').click();
  expect((await editorResponse).status()).toBe(200);
  await expect(page.locator('.res')).toHaveCount(1);
  await expect(row(page, edited)).toBeVisible();
  await expect(page.locator('#chips-row')).toContainText('Updated by:Alice Chen');
  await expect(page.locator('#facet-panel-title')).toHaveText('Updated by');
  await expect(personChoice(page, 'member')).toHaveAttribute('aria-pressed', 'true');

  const clearResponse = searchResponse(page, body => !body.author_user_ids && !body.updated_by_user_ids);
  await page.locator('#clear').click();
  expect((await clearResponse).status()).toBe(200);
  await expect(page.locator('.res')).toHaveCount(3);
  await expect(page.locator('#chips-row .filter-chip')).toHaveCount(0);
});

for (const width of [390, 1440]) {
  test('person icon colours stay distinct and consistent across rows, filters and reloads at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const handoff = await createDocument('bob', 'Colour handoff');
    await editDocument('member', handoff, '# Colour handoff\n\nAlice updated the handoff.');
    const member = await createDocument('member', 'Colour notes');
    await openLibrary(page);
    await expect(row(page, member).locator('.cloud-library-person')).toHaveText('Alice Chen');
    const iconColor = locator => locator.locator('svg').evaluate(icon => getComputedStyle(icon).color);
    const creator = row(page, handoff).locator('[data-person-facet="author"]');
    const updater = row(page, handoff).locator('[data-person-facet="updatedBy"]');
    const bobColor = await iconColor(creator), aliceColor = await iconColor(updater);
    expect(bobColor).not.toBe(aliceColor);
    expect(await iconColor(row(page, member).locator('.cloud-library-person'))).toBe(aliceColor);
    for (const pill of [creator, updater]) {
      const colors = await pill.evaluate(button => [getComputedStyle(button).color, getComputedStyle(button.querySelector('span')).color]);
      expect(colors[0]).toBe(colors[1]);
      expect(await pill.getAttribute('style')).toBeNull();
    }
    await page.screenshot({ path: test.info().outputPath('person-colours-' + width + '.png'), fullPage: true });
    await choosePerson(page, 'updatedBy', 'member');
    expect(await iconColor(personChoice(page, 'member'))).toBe(aliceColor);
    expect(await iconColor(personChoice(page, 'bob'))).toBe(bobColor);
    expect(await iconColor(row(page, handoff).locator('[data-person-facet="updatedBy"]'))).toBe(aliceColor);
    await page.reload();
    await expect(row(page, member).locator('.cloud-library-person')).toHaveText('Alice Chen');
    expect(await iconColor(row(page, handoff).locator('[data-person-facet="author"]'))).toBe(bobColor);
    expect(await iconColor(row(page, member).locator('.cloud-library-person'))).toBe(aliceColor);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('documents and searches do not wait for tags or members, and typing does not restart filter requests', async ({ page }) => {
  const document = await createDocument('bob', 'Release notes', { tags: ['release'] });
  const held = {};
  const calls = { tags: 0, members: 0 };
  for (const kind of ['tags', 'members']) await page.route('**/api/cloud/v1/account/' + kind + '?*', route => {
    calls[kind]++; held[kind] = route;
  });
  await openLibrary(page);
  await expect(row(page, document)).toBeVisible();
  await expect(row(page, document).locator('.tag')).toHaveText('#release');
  await expect.poll(() => calls).toEqual({ tags: 1, members: 1 });
  const searched = searchResponse(page, body => body.query === 'release');
  await page.locator('#q').fill('release');
  expect((await searched).status()).toBe(200);
  await expect(row(page, document)).toBeVisible();
  await held.tags.continue();
  await expect(page.locator('.facet-option[data-value="release"]')).toBeVisible();
  expect(calls).toEqual({ tags: 1, members: 1 });
  await held.members.continue();
  await expect(row(page, document).locator('.cloud-library-person')).toHaveText('You');
});

test('all accessible tags load before the panel is opened, including tags outside the first document page', async ({ page }) => {
  for (let index = 0; index < 75; index++) {
    await f.store.createDocument({ userId: f.users.bob.id, projectId: f.team.projectId,
      filename: 'tagged-' + index + '.md', markdown: '---\ntags:\n  - common\n  - subject-' + index + '\n---\n# Tagged ' + index,
      idempotencyKey: 'tag-vocabulary-' + index });
  }
  await createDocument('member', 'Private source', { tags: ['private-only-label', 'common'], shared: false });
  let tagRequests = 0;
  page.on('request', request => { if (request.url().includes('/api/cloud/v1/account/tags?')) tagRequests++; });
  const loaded = page.waitForResponse(response => response.url().includes('/api/cloud/v1/account/tags?'));
  await openLibrary(page);
  const response = await loaded;
  expect(response.status()).toBe(200);
  expect((await response.json()).tags).toHaveLength(76);
  await expect(page.locator('.res')).toHaveCount(60);
  await expect(page.locator('.res .tag').filter({ hasText: /^#subject-0$/ })).toHaveCount(0);
  await page.locator('[data-facet="tag"]').click();
  await expect(page.locator('.facet-option')).toHaveCount(76);
  await expect(page.locator('.facet-option').first()).toHaveAttribute('data-value', 'common');
  await expect(page.locator('.facet-option[data-value="common"] .count')).toHaveText('75');
  await expect(page.locator('.facet-option[data-value="private-only-label"]')).toHaveCount(0);
  const filtered = searchResponse(page, body => body.tags.includes('subject-0'));
  await page.locator('.facet-option[data-value="subject-0"] .opt-label').click();
  expect((await filtered).status()).toBe(200);
  await expect(page.locator('.res')).toHaveCount(1);
  await expect(page.locator('.res-title')).toHaveText('Tagged 0');
  expect(tagRequests).toBe(1);
});

for (const failedKind of ['tags', 'members']) test('failed ' + failedKind + ' loading keeps documents usable and retries only the missing filters', async ({ page }) => {
  const document = await createDocument('bob', 'Tagged handoff', { tags: ['handoff'] });
  const calls = { tags: 0, members: 0 };
  for (const kind of ['tags', 'members']) await page.route('**/api/cloud/v1/account/' + kind + '?*', route => {
    calls[kind]++;
    if (kind === failedKind && calls[kind] === 1) return route.fulfill({ status: 503, json: { ok: false } });
    return route.continue();
  });
  await openLibrary(page);
  await expect(row(page, document)).toBeVisible();
  await expect(page.locator('#agent-banner')).toContainText('Could not load library filters.');
  await page.locator('#agent-banner').getByRole('button', { name: 'Retry', exact: true }).click();
  await page.locator('[data-facet="tag"]').click();
  await expect(page.locator('.facet-option[data-value="handoff"]')).toBeVisible();
  await expect(row(page, document).locator('.cloud-library-person')).toHaveText('You');
  await expect(page.locator('#agent-banner')).toBeHidden();
  expect(calls).toEqual(failedKind === 'tags' ? { tags: 2, members: 1 } : { tags: 1, members: 2 });
  await expect(row(page, document)).toBeVisible();
});

test('switching libraries ignores delayed tag and member responses from the previous library', async ({ page }) => {
  const old = await createDocument('bob', 'Team tag notes', { tags: ['team-only'] });
  const solo = await createSoloTeam();
  const own = await createDocument('bob', 'Personal tag notes', { workspaceId: solo.workspaceId, tags: ['personal-only'] });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const completed = [];
  for (const kind of ['tags', 'members']) {
    let finished;
    completed.push(new Promise(resolve => { finished = resolve; }));
    await page.route('**/api/cloud/v1/account/' + kind + '?*', async route => {
      if (!route.request().url().includes(f.team.workspaceId)) return route.continue();
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response }).catch(() => {});
      finished();
    });
  }
  try {
    await openLibrary(page);
    await expect(row(page, old)).toBeVisible();
    await page.locator('#workspace-button').click();
    await page.locator('#workspace-menu .workspace-menu-item').filter({ hasText: 'Personal notes' }).click();
    await expect(row(page, own)).toBeVisible();
    await page.locator('[data-facet="tag"]').click();
    await expect(page.locator('.facet-option[data-value="personal-only"]')).toBeVisible();
    release();
    await Promise.all(completed);
    await expect(page.locator('.facet-option[data-value="team-only"]')).toHaveCount(0);
    await expect(page.locator('.facet-option[data-value="personal-only"]')).toBeVisible();
    await expect(page.locator('.cloud-library-person')).toHaveCount(0);
    await expect(page.locator('[data-facet="author"]')).toBeHidden();
  } finally { release(); }
});

test('native keyboard activation filters people and keeps focus in the people panel', async ({ page }) => {
  const own = await createDocument('bob', 'Owner draft');
  const member = await createDocument('member', 'Member draft');
  await openLibrary(page);
  await expect(page.locator('.res')).toHaveCount(2);
  const ownerSearch = searchResponse(page, body => (body.author_user_ids || []).includes(f.users.bob.id));
  await row(page, own).locator('[data-person-facet="author"]').focus();
  await page.keyboard.press('Enter');
  expect((await ownerSearch).status()).toBe(200);
  await expect(personChoice(page, 'bob')).toBeFocused();
  await expect(row(page, own)).toBeVisible();
  const memberSearch = searchResponse(page, body => (body.author_user_ids || []).includes(f.users.member.id));
  await personChoice(page, 'member').focus();
  await page.keyboard.press('Space');
  expect((await memberSearch).status()).toBe(200);
  await expect(personChoice(page, 'member')).toBeFocused();
  await expect(page.locator('.res')).toHaveCount(1);
  await expect(row(page, member)).toBeVisible();
  expect(page.context().pages()).toHaveLength(1);
});

test('Cloud keeps local-only filter syntax in the query and still commits supported tag chips', async ({ page }) => {
  const document = await createDocument('bob', 'Review draft', { tags: ['review'] });
  await openLibrary(page);
  await expect(row(page, document)).toBeVisible();
  const raw = 'path:notes project:planning agent:codex -since:7d';
  const literal = searchResponse(page, body => body.query === raw);
  await page.locator('#q').fill(raw + ' ');
  const response = await literal;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON().updated_after).toBeUndefined();
  await expect(page.locator('#chips-row .filter-chip')).toHaveCount(0);
  await expect(page.locator('#q')).toHaveValue(raw + ' ');
  const tagged = searchResponse(page, body => !body.query && body.tags.includes('review'));
  await page.locator('#q').fill('tag:review ');
  expect((await tagged).status()).toBe(200);
  await expect(page.locator('#q')).toHaveValue('');
  await expect(page.locator('#chips-row .filter-chip')).toHaveCount(1);
  await expect(page.locator('#chips-row')).toContainText('tag:review');
  await expect(row(page, document)).toBeVisible();
});

test('people controls follow active library membership rather than a team or personal label', async ({ page }) => {
  const solo = await createSoloTeam();
  const document = await createDocument('bob', 'Private journal', { workspaceId: solo.workspaceId });
  await openLibrary(page, 'bob', solo.workspaceId);
  await expect(row(page, document)).toBeVisible();
  await expect(page.locator('.cloud-library-person')).toHaveCount(0);
  await expect(page.locator('[data-facet="author"]')).toBeHidden();
  await expect(page.locator('[data-facet="updatedBy"]')).toBeHidden();

  f.store.addWorkspaceMember({ actorUserId: f.users.bob.id, workspaceId: solo.workspaceId, userId: f.users.member.id });
  await page.reload();
  await expect(row(page, document).locator('.cloud-library-person')).toHaveText(['You']);
  await expect(page.locator('[data-facet="author"]')).toBeVisible();
  await expect(page.locator('[data-facet="updatedBy"]')).toBeVisible();
  await page.locator('[data-facet="author"]').click();
  await expect(page.locator('[data-person-choice]')).toHaveText(['You', 'Alice Chen']);

  f.store.removeWorkspaceMember({ actorUserId: f.users.bob.id, workspaceId: solo.workspaceId, userId: f.users.member.id });
  await page.reload();
  await expect(row(page, document)).toBeVisible();
  await expect(page.locator('.cloud-library-person')).toHaveCount(0);
  await expect(page.locator('[data-facet="author"]')).toBeHidden();
  await expect(page.locator('[data-facet="updatedBy"]')).toBeHidden();
});

test('a one-member personal library hides people controls and names', async ({ page }) => {
  const document = await createDocument('returning', 'Reading list', { workspaceId: f.personal.workspaceId });
  await openLibrary(page, 'returning', f.personal.workspaceId);
  await expect(row(page, document)).toBeVisible();
  await expect(page.locator('.cloud-library-person')).toHaveCount(0);
  await expect(page.locator('[data-facet="author"]')).toBeHidden();
  await expect(page.locator('[data-facet="updatedBy"]')).toBeHidden();
});

test('authorized documents retain the names of former contributors', async ({ page }) => {
  const authored = await createDocument('member', 'Archived handoff');
  const edited = await createDocument('bob', 'Shared decision');
  await editDocument('member', edited, '# Shared decision\n\nAlice recorded the decision.');
  f.store.addWorkspaceMember({ actorUserId: f.users.bob.id, workspaceId: f.team.workspaceId,
    userId: f.users.josh.id });
  f.store.removeWorkspaceMember({ actorUserId: f.users.bob.id, workspaceId: f.team.workspaceId,
    userId: f.users.member.id });
  await openLibrary(page);
  await expect(page.locator('.res')).toHaveCount(2);
  await expect(row(page, authored).locator('.cloud-library-person')).toHaveText(['Alice Chen']);
  await expect(row(page, edited).locator('.cloud-library-person')).toHaveText(['You', 'Updated by Alice Chen']);
  await choosePerson(page, 'author', 'member');
  await expect(page.locator('.res')).toHaveCount(1);
  await expect(row(page, authored)).toBeVisible();
});

test('people filters query all documents and pagination has no duplicates, including with a date filter', async ({ page }) => {
  test.setTimeout(45000);
  const documents = [];
  const updatedAt = Date.now() - 1000;
  // Seed through the real encrypted store so this fixture can exceed a page without API write-rate noise.
  for (let index = 0; index < 68; index++) {
    const actor = index < 3 ? 'member' : 'bob';
    const document = await f.store.createDocument({ userId: f.users[actor].id, projectId: f.team.projectId,
      filename: 'record-' + index + '.md', markdown: '# Record ' + index + '\n\nPaginated people search.',
      idempotencyKey: 'bulk-' + index });
    f.store.setDocumentPermission({ userId: f.users[actor].id, documentId: document.id, mode: 'everyone' });
    // Equal timestamps exercise the server cursor's document-id tie breaker.
    f.store.db.prepare('UPDATE cloud_documents SET updated_at_ms=? WHERE id=?').run(updatedAt - (actor === 'member' ? 86400000 : 0), document.id);
    documents.push(document);
  }
  await openLibrary(page);
  await expect(page.locator('.res')).toHaveCount(60);
  await expect(page.locator('#count')).toHaveText('68 results');
  expect(await page.locator('.res [data-cloud-person="' + f.users.member.id + '"]').count()).toBe(0);
  await choosePerson(page, 'author', 'member');
  await expect(page.locator('.res')).toHaveCount(3);
  await expect(page.locator('#count')).toHaveText('3 results');
  expect(new Set(await page.locator('.res').evaluateAll(rows => rows.map(item => item.dataset.id))))
    .toEqual(new Set(documents.slice(0, 3).map(item => item.id)));
  await choosePerson(page, 'author', 'bob');
  await expect(page.locator('.res')).toHaveCount(60);
  await expect(page.locator('#count')).toHaveText('65 results');

  await page.locator('[data-facet="since"]').click();
  const dated = searchResponse(page, body => Boolean(body.updated_after) && !body.cursor);
  await page.locator('.facet-option[data-value="30d"] .opt-label').click();
  const datedResponse = await dated;
  expect(datedResponse.status()).toBe(200);
  const datedRequest = datedResponse.request().postDataJSON();
  const firstIds = await page.locator('.res').evaluateAll(rows => rows.map(item => item.dataset.id));
  await expect(page.locator('[data-cloud-page="next"]')).toBeEnabled();
  const next = searchResponse(page, body => Boolean(body.cursor));
  await page.locator('[data-cloud-page="next"]').click();
  const nextResponse = await next;
  expect(nextResponse.status(), await nextResponse.text()).toBe(200);
  expect(nextResponse.request().postDataJSON().updated_after).toBe(datedRequest.updated_after);
  await expect(page.locator('.res')).toHaveCount(5);
  await expect(page.locator('[data-cloud-page="next"]')).toBeDisabled();
  const ids = firstIds.concat(await page.locator('.res').evaluateAll(rows => rows.map(item => item.dataset.id)));
  expect(new Set(ids).size).toBe(65);
  expect(new Set(ids)).toEqual(new Set(documents.slice(3).map(item => item.id)));
  const previous = searchResponse(page, body => !body.cursor && Boolean(body.updated_after));
  await page.locator('[data-cloud-page="previous"]').click();
  expect((await previous).request().postDataJSON().updated_after).toBe(datedRequest.updated_after);
  await expect(page.locator('.res')).toHaveCount(60);
  expect(await page.locator('.res').evaluateAll(rows => rows.map(item => item.dataset.id))).toEqual(firstIds);

  const cleared = searchResponse(page, body => !body.author_user_ids && !body.updated_after && !body.cursor);
  await page.locator('#clear').click();
  expect((await cleared).status()).toBe(200);
  await expect(page.locator('.res')).toHaveCount(60);
  const allNext = searchResponse(page, body => Boolean(body.cursor) && !body.author_user_ids);
  await page.locator('[data-cloud-page="next"]').click();
  expect((await allNext).status()).toBe(200);
  await expect(page.locator('.res')).toHaveCount(8);
  expect(new Set(await page.locator('.res').evaluateAll(rows => rows.map(item => item.dataset.id))).size).toBe(8);
});

test('a failed replacement search cannot reuse a cursor from the previous filter', async ({ page }) => {
  for (let index = 0; index < 61; index++) {
    await f.store.createDocument({ userId: f.users.bob.id, projectId: f.team.projectId,
      filename: 'needle-' + index + '.md', markdown: '# Needle ' + index,
      idempotencyKey: 'failure-page-' + index });
  }
  let failNext = true;
  await page.route('**/api/cloud/v1/search', route => {
    if (route.request().postDataJSON().query === 'needle' && failNext) {
      failNext = false;
      return route.fulfill({ status: 503, json: { ok: false, error: 'temporary_service_failure' } });
    }
    return route.continue();
  });
  await openLibrary(page);
  await expect(page.locator('.res')).toHaveCount(60);
  await expect(page.locator('[data-cloud-page="next"]')).toBeEnabled();
  const failed = searchResponse(page, body => body.query === 'needle');
  await page.locator('#q').fill('needle');
  expect((await failed).status()).toBe(503);
  await expect(page.locator('#agent-banner')).toContainText('Cloud search is temporarily unavailable.');
  await expect(page.locator('.res')).toHaveCount(0);
  await expect(page.locator('[data-cloud-page="next"]')).toHaveCount(0);
  const retried = searchResponse(page, body => body.query === 'needle');
  await page.locator('#agent-banner').getByRole('button', { name: 'Retry', exact: true }).click();
  const response = await retried;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON().cursor).toBeUndefined();
  await expect(page.locator('.res')).toHaveCount(60);
  await expect(page.locator('#agent-banner')).toBeHidden();
  const next = searchResponse(page, body => body.query === 'needle' && Boolean(body.cursor));
  await page.locator('[data-cloud-page="next"]').click();
  expect((await next).status()).toBe(200);
  await expect(page.locator('.res')).toHaveCount(1);
  const reset = searchResponse(page, body => !body.query && !body.cursor);
  await page.locator('#q').fill('');
  expect((await reset).status()).toBe(200);
  await expect(page.locator('.res')).toHaveCount(60);
  await expect(page.locator('#count')).toHaveText('61 results');
});

test('a failed next page preserves existing results and Retry fetches that page', async ({ page }) => {
  for (let index = 0; index < 61; index++) {
    await f.store.createDocument({ userId: f.users.bob.id, projectId: f.team.projectId,
      filename: 'append-' + index + '.md', markdown: '# Append ' + index,
      idempotencyKey: 'failed-append-' + index });
  }
  let failNext = true;
  await page.route('**/api/cloud/v1/search', route => {
    if (route.request().postDataJSON().cursor && failNext) {
      failNext = false;
      return route.fulfill({ status: 503, json: { ok: false, error: 'temporary_service_failure' } });
    }
    return route.continue();
  });
  await openLibrary(page);
  await expect(page.locator('.res')).toHaveCount(60);
  const firstIds = await page.locator('.res').evaluateAll(rows => rows.map(item => item.dataset.id));
  const failed = searchResponse(page, body => Boolean(body.cursor));
  await page.locator('[data-cloud-page="next"]').click();
  expect((await failed).status()).toBe(503);
  await expect(page.locator('#agent-banner')).toContainText('Cloud search is temporarily unavailable.');
  await expect(page.locator('.res')).toHaveCount(60);
  expect(await page.locator('.res').evaluateAll(rows => rows.map(item => item.dataset.id))).toEqual(firstIds);
  await expect(page.locator('[data-cloud-page="next"]')).toBeEnabled();
  const retried = searchResponse(page, body => Boolean(body.cursor));
  await page.locator('#agent-banner').getByRole('button', { name: 'Retry', exact: true }).click();
  expect((await retried).status()).toBe(200);
  await expect(page.locator('.res')).toHaveCount(1);
  await expect(page.locator('#agent-banner')).toBeHidden();
  await expect(page.locator('[data-cloud-page="next"]')).toBeDisabled();
  await expect(page.locator('[data-cloud-page="previous"]')).toBeEnabled();
});

test('creator and editor filters combine with full-text, tag and shared filters on the server', async ({ page }) => {
  const hit = await createDocument('member', 'Release checklist', { tags: ['review'], body: 'handoff detail' });
  await editDocument('bob', hit, '---\ntags:\n  - review\n---\n# Release checklist\n\nHandoff reviewed by Bob.');
  await createDocument('bob', 'Owner handoff', { tags: ['review'], body: 'handoff detail' });
  await createDocument('member', 'Different topic', { tags: ['review'] });
  await openLibrary(page);
  await expect(page.locator('.res')).toHaveCount(3);
  await choosePerson(page, 'author', 'member');
  await choosePerson(page, 'updatedBy', 'bob');
  const query = searchResponse(page, body => body.query === 'handoff');
  await page.locator('#q').fill('handoff');
  expect((await query).status()).toBe(200);
  await page.locator('[data-facet="tag"]').click();
  // Tag inventory uses the typed query, so clear it before choosing a tag and restore it afterwards.
  const queryCleared = searchResponse(page, body => !body.query);
  await page.locator('#q').fill('');
  expect((await queryCleared).status()).toBe(200);
  const tagged = searchResponse(page, body => body.tags.includes('review'));
  await page.locator('.facet-option[data-value="review"] .opt-label').click();
  expect((await tagged).status()).toBe(200);
  const queryRestored = searchResponse(page, body => body.query === 'handoff');
  await page.locator('#q').fill('handoff');
  expect((await queryRestored).status()).toBe(200);
  const shared = searchResponse(page, body => body.shared_with_me === true);
  await page.locator('#shared-toggle').click();
  const sharedResponse = await shared;
  expect(sharedResponse.status()).toBe(200);
  expect(sharedResponse.request().postDataJSON()).toMatchObject({ workspace_id: f.team.workspaceId,
    query: 'handoff', author_user_ids: [f.users.member.id], updated_by_user_ids: [f.users.bob.id], tags: ['review'], shared_with_me: true });
  await expect(page.locator('.res')).toHaveCount(1);
  await expect(row(page, hit)).toBeVisible();
  await expect(page.locator('#count')).toHaveText('1 result');
});

test('people filtering cannot reveal private documents or another library', async ({ page }) => {
  const visible = await createDocument('bob', 'Shared handbook');
  const privateDocument = await createDocument('member', 'Private salary canary', { shared: false });
  const other = await createDocument('outsider', 'Other company canary', { workspaceId: f.otherTeam.workspaceId });
  await openLibrary(page);
  await expect(page.locator('.res')).toHaveCount(1);
  await expect(row(page, visible)).toBeVisible();
  await expect(row(page, privateDocument)).toHaveCount(0);
  await expect(row(page, other)).toHaveCount(0);
  await choosePerson(page, 'author', 'member');
  await expect(page.locator('.res')).toHaveCount(0);
  await expect(page.locator('#count')).toHaveText('0 results');

  const denied = await f.api('outsider', '/api/cloud/v1/search', 'POST', {
    workspace_id: f.team.workspaceId, author_user_ids: [f.users.bob.id], facets: true,
  });
  expect(denied.status).toBe(404);
  expect(JSON.stringify(denied.data)).not.toContain(visible.id);
  expect(JSON.stringify(denied.data)).not.toContain(f.users.bob.email);
  const membersDenied = await f.api('outsider', '/api/cloud/v1/account/members?account_id=' + f.team.workspaceId);
  expect(membersDenied.status).toBe(404);
  const searched = await f.api('bob', '/api/cloud/v1/search', 'POST', {
    workspace_id: f.team.workspaceId, author_user_ids: [f.users.member.id], facets: true,
  });
  expect(searched.status).toBe(200);
  expect(searched.data.documents).toEqual([]);
  expect(searched.data.total_count).toBe(0);
  expect(JSON.stringify(searched.data)).not.toContain(privateDocument.id);
});

test('switching libraries clears people filters and ignores a delayed response from the previous library', async ({ page }) => {
  const old = await createDocument('bob', 'Team handoff');
  const solo = await createSoloTeam();
  const soloDocument = await createDocument('bob', 'Personal journal', { workspaceId: solo.workspaceId });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  let finished;
  const released = new Promise(resolve => { finished = resolve; });
  await page.route('**/api/cloud/v1/search', async route => {
    if (route.request().postDataJSON().query !== 'delayed') return route.continue();
    const response = await route.fetch();
    started();
    await held;
    await route.fulfill({ response }).catch(() => {});
    finished();
  });
  try {
    await openLibrary(page);
    await expect(row(page, old)).toBeVisible();
    await choosePerson(page, 'author', 'bob');
    await page.locator('#q').fill('delayed');
    await pending;
    await page.locator('#workspace-button').click();
    await page.locator('#workspace-menu .workspace-menu-item').filter({ hasText: 'Personal notes' }).click();
    await expect(row(page, soloDocument)).toBeVisible();
    await expect(page.locator('#q')).toHaveValue('');
    await expect(page.locator('#chips-row .filter-chip')).toHaveCount(0);
    await expect(page.locator('.cloud-library-person')).toHaveCount(0);
    await expect(page.locator('[data-facet="author"]')).toBeHidden();
    await expect(page.locator('[data-facet="updatedBy"]')).toBeHidden();
    release();
    await released;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(row(page, old)).toHaveCount(0);
    await expect(row(page, soloDocument)).toBeVisible();
    await page.locator('#workspace-button').click();
    await page.locator('#workspace-menu .workspace-menu-item').filter({ hasText: "Joe's engineering" }).click();
    await expect(row(page, old)).toBeVisible();
    await expect(page.locator('[data-facet="author"]')).toBeVisible();
    await expect(page.locator('#chips-row .filter-chip')).toHaveCount(0);
    await expect(row(page, soloDocument)).toHaveCount(0);
  } finally { release(); }
});

for (const width of [320, 390, 1440]) {
  test('long person names and filter options fit the library at ' + width + 'px', async ({ page }) => {
    f.auth.updateUserProfile({ userId: f.users.member.id, firstName: 'Alexandria-Cassandra', lastName: 'Montgomery-Worthington' });
    const document = await createDocument('bob', 'Quarterly planning');
    await editDocument('member', document, '# Quarterly planning\n\nPlanning update.');
    await page.setViewportSize({ width, height: 900 });
    await openLibrary(page);
    await expect(row(page, document).locator('.cloud-library-person')).toHaveCount(2);
    await page.locator('[data-facet="updatedBy"]').click();
    await expect(personChoice(page, 'member')).toBeVisible();
    const geometry = await page.evaluate(() => {
      const row = document.querySelector('.res');
      const rowBounds = row.getBoundingClientRect();
      return { viewport: innerWidth, scroll: document.documentElement.scrollWidth,
        pills: Array.from(row.querySelectorAll('.cloud-library-person')).map(pill => {
          const bounds = pill.getBoundingClientRect();
          return { left: bounds.left, right: bounds.right, rowLeft: rowBounds.left, rowRight: rowBounds.right };
        }),
        options: Array.from(document.querySelectorAll('[data-person-choice]')).map(option => {
          const bounds = option.getBoundingClientRect();
          return { left: bounds.left, right: bounds.right, scroll: option.scrollWidth, width: option.clientWidth };
        }) };
    });
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport);
    for (const pill of geometry.pills) {
      expect(pill.left).toBeGreaterThanOrEqual(pill.rowLeft);
      expect(pill.right).toBeLessThanOrEqual(pill.rowRight);
    }
    for (const option of geometry.options) {
      expect(option.left).toBeGreaterThanOrEqual(0);
      expect(option.right).toBeLessThanOrEqual(geometry.viewport);
      expect(option.scroll).toBeLessThanOrEqual(option.width);
    }
  });
}
