const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');

test.use({ serviceWorkers: 'block' });
let f;
test.beforeEach(async () => {
  f = await startFixture();
  f.store.grantProject({ actorUserId: f.users.bob.id, workspaceId: f.team.workspaceId,
    projectId: f.team.projectId, userId: f.users.member.id, role: 'editor' });
});
test.afterEach(async () => { if (f) await f.close(); });

const next = page => page.locator('[data-cloud-page="next"]');
const previous = page => page.locator('[data-cloud-page="previous"]');
const indicator = page => page.locator('nav[aria-label="Document pages"] span');
const ids = page => page.locator('.res').evaluateAll(rows => rows.map(row => row.dataset.id));
const searchResponse = (page, predicate = () => true) => page.waitForResponse(response =>
  response.url() === f.origin + '/api/cloud/v1/search' && predicate(response.request().postDataJSON()));

async function seed(count, options = {}) {
  const actor = options.actor || 'bob';
  const library = options.library || f.team;
  const documents = [];
  const now = Date.now() - 1000;
  for (let index = 0; index < count; index++) {
    const title = (options.prefix || 'Record') + ' ' + index;
    const markdown = '---\ntags:\n  - ' + (options.tag || 'review') + '\n---\n# ' + title + '\n\n' + (options.body || 'beacon phrase');
    let document = await f.store.createDocument({ userId: f.users[actor].id, projectId: library.projectId,
      filename: title + '.md', markdown, idempotencyKey: 'pagination-' + title + '-' + actor + '-' + library.workspaceId });
    if (options.shared !== false) f.store.setDocumentPermission({ userId: f.users[actor].id,
      documentId: document.id, mode: 'everyone' });
    if (options.updatedBy) document = await f.store.saveRevision({ userId: f.users[options.updatedBy].id,
      documentId: document.id, expectedHeadRevisionId: document.current_revision_id,
      filename: title + '.md', markdown: markdown + '\nReviewed.', idempotencyKey: 'review-' + document.id });
    if (options.starred) f.store.setDocumentStar({ userId: f.users.bob.id, documentId: document.id, starred: true });
    // Equal timestamps exercise stable document ID ordering on every page.
    f.store.db.prepare('UPDATE cloud_documents SET updated_at_ms=? WHERE id=?').run(now, document.id);
    documents.push(document);
  }
  return documents.sort((a, b) => a.id.localeCompare(b.id));
}

async function openLibrary(page, actor = 'bob') {
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users[actor].sessionToken, url: f.origin }]);
  const response = searchResponse(page, body => !body.cursor);
  await page.goto(f.origin + '/library?scope=cloud&workspace=' + f.team.workspaceId);
  expect((await response).status()).toBe(200);
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
}

async function go(page, direction, number) {
  const response = searchResponse(page);
  await (direction === 'next' ? next(page) : previous(page)).click();
  const result = await response;
  expect(result.status(), await result.text()).toBe(200);
  await expect(indicator(page)).toHaveText('Page ' + number);
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
  return result;
}

for (const count of [1, 60, 61, 120, 121]) {
  test('60-document pages cover ' + count + ' documents without duplicates or accumulated rows', async ({ page }) => {
    const documents = await seed(count);
    await openLibrary(page);
    await expect(page.locator('.res')).toHaveCount(Math.min(count, 60));
    expect(await ids(page)).toEqual(documents.slice(0, 60).map(doc => doc.id));
    if (count <= 60) {
      await expect(next(page)).toHaveCount(0);
      await expect(previous(page)).toHaveCount(0);
      return;
    }
    await expect(previous(page)).toBeDisabled();
    const seen = await ids(page);
    for (let number = 2; number <= Math.ceil(count / 60); number++) {
      const response = await go(page, 'next', number);
      expect(response.request().postDataJSON().limit).toBe(60);
      const expected = documents.slice((number - 1) * 60, number * 60).map(doc => doc.id);
      expect(await ids(page)).toEqual(expected);
      await expect(page.locator('.res')).toHaveCount(expected.length);
      seen.push(...expected);
    }
    expect(new Set(seen).size).toBe(count);
    await expect(next(page)).toBeDisabled();
    for (let number = Math.ceil(count / 60) - 1; number > 0; number--) {
      await go(page, 'previous', number);
      expect(await ids(page)).toEqual(documents.slice((number - 1) * 60, number * 60).map(doc => doc.id));
    }
    await expect(previous(page)).toBeDisabled();
  });
}

test('search, included/excluded tags, people, dates, shared and starred filters stay identical in both directions', async ({ page }) => {
  test.setTimeout(45000);
  const documents = await seed(123, { actor: 'member', updatedBy: 'bob', starred: true });
  await seed(1, { actor: 'member', updatedBy: 'bob', starred: true, tag: 'excluded', prefix: 'Excluded' });
  await seed(1, { actor: 'member', updatedBy: 'bob', prefix: 'Unstarred' });
  await seed(1, { actor: 'bob', starred: true, prefix: 'Other author' });
  await seed(1, { actor: 'member', updatedBy: 'bob', starred: true, body: 'Different words', prefix: 'Other query' });
  await openLibrary(page);
  await page.locator('[data-facet="tag"]').click();
  await page.locator('.facet-option[data-value="review"] .opt-label').click();
  await page.locator('.facet-option[data-value="excluded"] .opt-minus').click();
  await page.locator('[data-facet="since"]').click();
  await page.locator('.facet-option[data-value="30d"] .opt-label').click();
  await page.locator('[data-facet="author"]').click();
  await page.locator('[data-person-choice="' + f.users.member.id + '"]').click();
  await page.locator('[data-facet="updatedBy"]').click();
  await page.locator('[data-person-choice="' + f.users.bob.id + '"]').click();
  await page.locator('#shared-toggle').click();
  await page.locator('#star-toggle').click();
  const searched = searchResponse(page, body => body.query === 'beacon phrase');
  await page.locator('#q').fill('beacon phrase');
  const first = await searched;
  expect(first.status()).toBe(200);
  await expect(page.locator('#count')).toHaveText('123 results');
  const firstRequest = first.request().postDataJSON();
  expect(firstRequest).toMatchObject({ limit: 60, query: 'beacon phrase', tags: ['review'], tags_none: ['excluded'],
    author_user_ids: [f.users.member.id], updated_by_user_ids: [f.users.bob.id], shared_with_me: true, starred_only: true });
  expect(firstRequest.updated_after).toBeTruthy();
  for (const [direction, number] of [['next', 2], ['next', 3], ['previous', 2], ['previous', 1]]) {
    const response = await go(page, direction, number);
    const { cursor, ...filters } = response.request().postDataJSON();
    expect(filters).toEqual(firstRequest);
    expect(Boolean(cursor)).toBe(number > 1);
    expect(await ids(page)).toEqual(documents.slice((number - 1) * 60, number * 60).map(doc => doc.id));
    await expect(page.locator('#q')).toHaveValue('beacon phrase');
    await expect(page.locator('#chips-row .filter-chip')).toHaveCount(5);
  }
});

test('Previous refetches documents and excludes newly revoked files instead of restoring a cached page', async ({ page }) => {
  const documents = await seed(125);
  await seed(1, { actor: 'bob', prefix: 'Private canary', shared: false, tag: 'private-canary' });
  await seed(1, { actor: 'outsider', library: f.otherTeam, prefix: 'Foreign canary', tag: 'foreign-canary' });
  await openLibrary(page, 'member');
  await go(page, 'next', 2);
  await go(page, 'next', 3);
  for (const document of [documents[0], documents[65]]) f.store.setDocumentPermission({
    userId: f.users.bob.id, documentId: document.id, mode: 'custom', memberUserIds: [],
  });
  await go(page, 'previous', 2);
  expect(await ids(page)).not.toContain(documents[65].id);
  await expect(page.locator('#count')).toHaveText('123 results');
  await go(page, 'previous', 1);
  expect(await ids(page)).not.toContain(documents[0].id);
  await expect(page.locator('#results')).not.toContainText('canary');
  await expect(page.locator('.res')).toHaveCount(60);
});

test('a failed Previous keeps the current page and Retry fetches the intended previous cursor', async ({ page }) => {
  await seed(125);
  await openLibrary(page);
  const second = await go(page, 'next', 2);
  await go(page, 'next', 3);
  const current = await ids(page);
  const previousCursor = second.request().postDataJSON().cursor;
  let fail = true;
  await page.route('**/api/cloud/v1/search', route => {
    if (fail) { fail = false; return route.fulfill({ status: 503, json: { ok: false } }); }
    return route.continue();
  });
  const failed = searchResponse(page);
  await previous(page).click();
  expect((await failed).status()).toBe(503);
  await expect(page.locator('#agent-banner')).toBeVisible();
  await expect(indicator(page)).toHaveText('Page 3');
  expect(await ids(page)).toEqual(current);
  const retried = searchResponse(page);
  await page.locator('#agent-banner').getByRole('button', { name: 'Retry' }).click();
  expect((await retried).request().postDataJSON().cursor).toBe(previousCursor);
  await expect(indicator(page)).toHaveText('Page 2');
  await expect(page.locator('.res')).toHaveCount(60);
});

test('an emptied later page returns to the first page with the same query and date bounds', async ({ page }) => {
  const documents = await seed(61);
  await openLibrary(page);
  await page.locator('[data-facet="since"]').click();
  await page.locator('.facet-option[data-value="30d"] .opt-label').click();
  const queried = searchResponse(page, body => body.query === 'beacon');
  await page.locator('#q').fill('beacon');
  const original = (await queried).request().postDataJSON();
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
  f.store.deleteDocument({ userId: f.users.bob.id, documentId: documents[60].id,
    expectedHeadRevisionId: documents[60].current_revision_id });
  const firstAgain = searchResponse(page, body => body.query === 'beacon' && !body.cursor);
  await next(page).click();
  expect((await firstAgain).request().postDataJSON()).toEqual(original);
  await expect(page.locator('.res')).toHaveCount(60);
  await expect(page.locator('#count')).toHaveText('60 results');
  await expect(next(page)).toHaveCount(0);
  await expect(page.locator('#q')).toHaveValue('beacon');
});

test('filter changes reset to the first page and ignore a delayed page response', async ({ page }) => {
  await seed(125);
  const [specific] = await seed(1, { prefix: 'Specific topic', body: 'unique-search-marker' });
  await openLibrary(page);
  await go(page, 'next', 2);
  let release, started, finished;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = new Promise(resolve => { started = resolve; });
  const complete = new Promise(resolve => { finished = resolve; });
  let pageRequests = 0;
  await page.route('**/api/cloud/v1/search', async route => {
    if (!route.request().postDataJSON().cursor) return route.continue();
    pageRequests++;
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response }).catch(() => {});
    finished();
  });
  try {
    await next(page).click();
    await pending;
    await expect(next(page)).toBeDisabled();
    await expect(previous(page)).toBeDisabled();
    await page.evaluate(() => document.querySelector('[data-cloud-page="next"]').click());
    const searched = searchResponse(page, body => body.query === 'unique-search-marker');
    await page.locator('#q').fill('unique-search-marker');
    expect((await searched).request().postDataJSON().cursor).toBeUndefined();
    await expect(page.locator('.res')).toHaveCount(1);
    expect(await ids(page)).toEqual([specific.id]);
    release(); await complete;
    await expect(next(page)).toHaveCount(0);
    expect(await ids(page)).toEqual([specific.id]);
    expect(pageRequests).toBe(1);
    const cleared = searchResponse(page, body => !body.query && !body.cursor);
    await page.locator('#q').fill('');
    expect((await cleared).status()).toBe(200);
    await expect(indicator(page)).toHaveText('Page 1');
    await expect(previous(page)).toBeDisabled();
    await expect(page.locator('.res')).toHaveCount(60);
  } finally { release(); }
});

test('changing libraries drops page cursors and a delayed response from the previous library', async ({ page }) => {
  await seed(61);
  const library = await f.store.createTeamWorkspace({ userId: f.users.bob.id, name: 'Personal notes', projectName: 'Documents' });
  f.billing.upsertSubscription({ workspaceId: library.workspaceId, plan: 'team', status: 'active', provider: 'manual' });
  const [own] = await seed(1, { library, prefix: 'Personal note' });
  await openLibrary(page);
  let release, started, finished;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = new Promise(resolve => { started = resolve; });
  const complete = new Promise(resolve => { finished = resolve; });
  await page.route('**/api/cloud/v1/search', async route => {
    if (!route.request().postDataJSON().cursor) return route.continue();
    const response = await route.fetch();
    started(); await gate;
    await route.fulfill({ response }).catch(() => {});
    finished();
  });
  try {
    await next(page).click(); await pending;
    const changed = searchResponse(page, body => body.workspace_id === library.workspaceId);
    await page.locator('#workspace-button').click();
    await page.locator('#workspace-menu .workspace-menu-item').filter({ hasText: 'Personal notes' }).click();
    expect((await changed).request().postDataJSON().cursor).toBeUndefined();
    await expect(page.locator('.res')).toHaveCount(1);
    expect(await ids(page)).toEqual([own.id]);
    release(); await complete;
    expect(await ids(page)).toEqual([own.id]);
    await expect(next(page)).toHaveCount(0);
    await page.locator('#workspace-button').click();
    await page.locator('#workspace-menu .workspace-menu-item').filter({ hasText: "Joe's engineering" }).click();
    await expect(indicator(page)).toHaveText('Page 1');
    await expect(page.locator('.res')).toHaveCount(60);
    await expect(previous(page)).toBeDisabled();
  } finally { release(); }
});

test('starring a document refreshes its current page and removing the final starred row returns to page one', async ({ page }) => {
  await seed(61, { starred: true });
  await openLibrary(page);
  await go(page, 'next', 2);
  const original = await ids(page);
  const refreshed = searchResponse(page, body => Boolean(body.cursor));
  await page.locator('.res-star').click();
  expect((await refreshed).status()).toBe(200);
  await expect(indicator(page)).toHaveText('Page 2');
  expect(await ids(page)).toEqual(original);
  await expect(page.locator('.res-star')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('.res-star').click();
  await expect(page.locator('.res-star')).toBeEnabled();
  const starred = searchResponse(page, body => body.starred_only && !body.cursor);
  await page.locator('#star-toggle').click();
  expect((await starred).status()).toBe(200);
  await expect(indicator(page)).toHaveText('Page 1');
  await go(page, 'next', 2);
  const restarted = searchResponse(page, body => body.starred_only && !body.cursor);
  await page.locator('.res-star').click();
  expect((await restarted).status()).toBe(200);
  await expect(page.locator('.res')).toHaveCount(60);
  await expect(page.locator('#count')).toHaveText('60 results');
  await expect(next(page)).toHaveCount(0);
  await expect(page.locator('#star-toggle')).toHaveAttribute('aria-pressed', 'true');
});

for (const width of [320, 390, 1440]) test('pagination fits and works with the keyboard at ' + width + 'px', async ({ page }) => {
  await seed(61);
  await page.setViewportSize({ width, height: 800 });
  await openLibrary(page);
  const nav = page.locator('nav[aria-label="Document pages"]');
  await expect(nav).toBeVisible();
  expect(await nav.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const response = searchResponse(page, body => Boolean(body.cursor));
  await next(page).focus();
  await page.keyboard.press('Enter');
  expect((await response).status()).toBe(200);
  await expect(indicator(page)).toHaveText('Page 2');
  await expect(page.locator('#results')).toBeFocused();
  await expect(page.locator('.res')).toHaveCount(1);
  await expect(next(page)).toBeDisabled();
});
