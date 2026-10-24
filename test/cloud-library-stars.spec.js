const { test, expect } = require('@playwright/test');
const { randomUUID } = require('crypto');
const { startFixture } = require('./cloud-onboarding-fixture');

test.use({ serviceWorkers: 'block' });
let f;
test.beforeEach(async () => {
  f = await startFixture();
  f.store.grantProject({ actorUserId: f.users.bob.id, workspaceId: f.team.workspaceId,
    projectId: f.team.projectId, userId: f.users.member.id, role: 'viewer' });
});
test.afterEach(async () => { if (f) await f.close(); });

async function openLibrary(page, actor = 'bob', workspaceId = f.team.workspaceId) {
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users[actor].sessionToken, url: f.origin }]);
  await page.goto(f.origin + '/library?scope=cloud&workspace=' + encodeURIComponent(workspaceId));
  await expect(page.locator('body')).not.toHaveClass(/cloud-library-loading/);
  await expect(page.locator('#status-line')).not.toHaveText('loading...');
}

async function createDocument(actor, title, options = {}) {
  const response = await f.api(actor, '/api/cloud/v1/account/documents', 'POST', {
    account_id: options.workspaceId || f.team.workspaceId,
    filename: title.toLowerCase().replace(/\s+/g, '-') + '.md', markdown: '# ' + title + '\n\nLibrary notes.',
    idempotency_key: 'star-create-' + title,
  });
  expect(response.status, JSON.stringify(response.data)).toBe(201);
  if (options.shared !== false) {
    const shared = await f.api(actor, '/api/cloud/v1/documents/' + response.data.document.id + '/permission', 'PATCH', { mode: 'everyone' });
    expect(shared.status).toBe(200);
  }
  return response.data.document;
}

function row(page, document) { return page.locator('.res[data-id="' + document.id + '"]'); }
function star(page, document) { return row(page, document).locator('.res-star'); }
function starPath(document) { return '/api/cloud/v1/documents/' + document.id + '/star'; }
function starResponse(page, document) {
  return page.waitForResponse(response => response.url() === f.origin + starPath(document)
    && response.request().method() === 'PUT');
}
function searchResponse(page, predicate) {
  return page.waitForResponse(response => response.url() === f.origin + '/api/cloud/v1/search'
    && predicate(response.request().postDataJSON()));
}
async function setStar(page, document, value) {
  await expect(star(page, document)).toHaveAttribute('aria-pressed', String(!value));
  const written = starResponse(page, document);
  await star(page, document).click();
  const response = await written;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toMatchObject({ starred: value });
  await expect(star(page, document)).toHaveAttribute('aria-pressed', String(value));
  await expect(star(page, document)).toBeEnabled();
}
async function search(actor, body = {}) {
  const response = await f.api(actor, '/api/cloud/v1/search', 'POST', { workspace_id: f.team.workspaceId, ...body });
  expect(response.status, JSON.stringify(response.data)).toBe(200);
  return response.data;
}

test('Cloud stars survive reload and a fresh browser context, and unstar persists', async ({ page, browser }) => {
  const document = await createDocument('bob', 'Project outline');
  await openLibrary(page);
  await expect(star(page, document)).toHaveAttribute('aria-pressed', 'false');
  await setStar(page, document, true);
  expect((await search('bob')).documents.find(item => item.id === document.id).starred).toBe(true);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await expect(star(page, document)).toHaveAttribute('aria-pressed', 'true');
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const otherPage = await context.newPage();
    await openLibrary(otherPage);
    await expect(star(otherPage, document)).toHaveAttribute('aria-pressed', 'true');
    await setStar(otherPage, document, false);
    await otherPage.reload();
    await expect(star(otherPage, document)).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await expect(star(page, document)).toHaveAttribute('aria-pressed', 'false');
    expect((await search('bob')).documents.find(item => item.id === document.id).starred).toBe(false);
  } finally { await context.close(); }
});

test('simultaneous owner and member sessions keep their stars separate', async ({ page, browser }) => {
  const document = await createDocument('bob', 'Shared roadmap');
  await openLibrary(page);
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const memberPage = await context.newPage();
    await openLibrary(memberPage, 'member');
    await expect(star(memberPage, document)).toHaveAttribute('aria-pressed', 'false');
    await setStar(page, document, true);
    await memberPage.reload();
    await expect(star(memberPage, document)).toHaveAttribute('aria-pressed', 'false');
    await setStar(memberPage, document, true);
    await setStar(page, document, false);
    await memberPage.reload();
    await expect(star(memberPage, document)).toHaveAttribute('aria-pressed', 'true');
    const [owner, member] = await Promise.all([search('bob'), search('member')]);
    expect(owner.documents.find(item => item.id === document.id).starred).toBe(false);
    expect(member.documents.find(item => item.id === document.id).starred).toBe(true);
    expect(page.context().pages()).toHaveLength(1);
    expect(context.pages()).toHaveLength(1);
  } finally { await context.close(); }
});

test('failed star and unstar writes roll back the row and preserve server state', async ({ page }) => {
  const document = await createDocument('bob', 'Important decision');
  await openLibrary(page);
  let failNext = true;
  await page.route('**' + starPath(document), route => {
    if (failNext) {
      failNext = false;
      return route.fulfill({ status: 503, json: { ok: false, error: 'temporary_service_failure' } });
    }
    return route.continue();
  });
  let failed = starResponse(page, document);
  await star(page, document).click();
  expect((await failed).status()).toBe(503);
  await expect(star(page, document)).toHaveAttribute('aria-pressed', 'false');
  await expect(star(page, document)).toBeEnabled();
  await expect(page.locator('#agent-banner')).toBeVisible();
  expect((await search('bob')).documents.find(item => item.id === document.id).starred).toBe(false);
  await setStar(page, document, true);
  failNext = true;
  failed = starResponse(page, document);
  await star(page, document).click();
  expect((await failed).status()).toBe(503);
  await expect(star(page, document)).toHaveAttribute('aria-pressed', 'true');
  await expect(star(page, document)).toBeEnabled();
  await expect(page.locator('#agent-banner')).toBeVisible();
  expect((await search('bob')).documents.find(item => item.id === document.id).starred).toBe(true);
  await page.reload();
  await expect(star(page, document)).toHaveAttribute('aria-pressed', 'true');
});

test('a failed refresh after a successful star keeps the saved star and offers search Retry', async ({ page }) => {
  const document = await createDocument('bob', 'Meeting decisions');
  await openLibrary(page);
  await expect(star(page, document)).toHaveAttribute('aria-pressed', 'false');
  let failNextSearch = true;
  await page.route('**/api/cloud/v1/search', route => {
    if (failNextSearch) {
      failNextSearch = false;
      return route.fulfill({ status: 503, json: { ok: false, error: 'temporary_service_failure' } });
    }
    return route.continue();
  });
  const written = starResponse(page, document);
  const failed = searchResponse(page, () => true);
  await star(page, document).click();
  expect((await written).status()).toBe(200);
  expect((await failed).status()).toBe(503);
  expect((await search('bob')).documents.find(item => item.id === document.id).starred).toBe(true);
  await expect(page.locator('#agent-banner')).toContainText('Cloud search is temporarily unavailable.');
  const recovered = searchResponse(page, body => !body.cursor);
  await page.locator('#agent-banner').getByRole('button', { name: 'Retry', exact: true }).click();
  expect((await recovered).status()).toBe(200);
  await expect(star(page, document)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#agent-banner')).toBeHidden();
});

test('Starred searches the full library, including documents beyond the first page', async ({ page }) => {
  const documents = [];
  for (let index = 0; index < 66; index++) {
    const document = await f.store.createDocument({ userId: f.users.bob.id, projectId: f.team.projectId,
      filename: 'star-record-' + index + '.md', markdown: '# Star record ' + index,
      idempotencyKey: 'star-page-' + index });
    documents.push(document);
  }
  const chosen = documents[0];
  const written = await f.api('bob', starPath(chosen), 'PUT', { starred: true });
  expect(written.status).toBe(200);
  await openLibrary(page);
  await expect(page.locator('.res')).toHaveCount(60);
  await expect(row(page, chosen)).toHaveCount(0);
  await expect(page.locator('#star-toggle')).toBeVisible();
  const filtered = searchResponse(page, body => body.starred_only === true);
  await page.locator('#star-toggle').click();
  const response = await filtered;
  expect(response.status()).toBe(200);
  await expect(page.locator('#star-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.res')).toHaveCount(1);
  await expect(row(page, chosen)).toBeVisible();
  await expect(page.locator('#count')).toHaveText('1 result');
  await expect(star(page, chosen)).toHaveAttribute('aria-pressed', 'true');
  const removed = starResponse(page, chosen);
  await star(page, chosen).click();
  expect((await removed).status()).toBe(200);
  await expect(page.locator('.res')).toHaveCount(0);
  await expect(page.locator('#count')).toHaveText('0 results');
  await expect(page.locator('#star-toggle')).toHaveAttribute('aria-pressed', 'true');
  expect((await search('bob', { starred_only: true })).documents).toEqual([]);
});

test('revoking document access blocks both star writes and starred search results', async ({ page }) => {
  const document = await createDocument('bob', 'Restricted review');
  const starred = await f.api('member', starPath(document), 'PUT', { starred: true });
  expect(starred.status).toBe(200);
  await openLibrary(page, 'member');
  await expect(star(page, document)).toHaveAttribute('aria-pressed', 'true');
  const restricted = await f.api('bob', '/api/cloud/v1/documents/' + document.id + '/permission', 'PATCH', {
    mode: 'custom', member_user_ids: [],
  });
  expect(restricted.status).toBe(200);
  const denied = starResponse(page, document);
  await star(page, document).click();
  expect((await denied).status()).toBe(404);
  for (const value of [true, false]) {
    const response = await f.api('member', starPath(document), 'PUT', { starred: value });
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.data)).not.toContain(document.id);
    expect(JSON.stringify(response.data)).not.toContain('Restricted review');
  }
  const result = await search('member', { starred_only: true, facets: true });
  expect(result.documents).toEqual([]);
  expect(result.total_count).toBe(0);
  expect(JSON.stringify(result)).not.toContain(document.id);
  await page.reload();
  await expect(row(page, document)).toHaveCount(0);
  await expect(page.locator('#count')).toHaveText('0 results');
});

test('forged company IDs and user IDs cannot change another account stars', async () => {
  const ours = await createDocument('bob', 'Company briefing');
  const privateDocument = await createDocument('bob', 'Private briefing', { shared: false });
  const theirs = await createDocument('outsider', 'Company briefing', { workspaceId: f.otherTeam.workspaceId });
  const writes = await Promise.all([
    f.api('bob', starPath(ours), 'PUT', { starred: true }),
    f.api('member', starPath(ours), 'PUT', { starred: true }),
    f.api('outsider', starPath(theirs), 'PUT', { starred: true }),
  ]);
  expect(writes.map(response => response.status)).toEqual([200, 200, 200]);
  for (const [actor, document] of [['bob', theirs], ['outsider', ours], ['member', privateDocument]]) {
    for (const value of [true, false]) {
      const denied = await f.api(actor, starPath(document), 'PUT', {
        starred: value, account_id: f.team.workspaceId, workspace_id: f.team.workspaceId,
        user_id: f.users.bob.id,
      });
      expect(denied.status).toBe(404);
      expect(JSON.stringify(denied.data)).not.toContain(document.id);
    }
  }
  const absent = await f.api('bob', starPath({ id: randomUUID() }), 'PUT', { starred: true });
  expect(absent.status).toBe(404);
  const memberUnstar = await f.api('member', starPath(ours), 'PUT', { starred: false, user_id: f.users.bob.id });
  expect(memberUnstar.status).toBe(200);
  const [owner, member, outsider] = await Promise.all([
    search('bob', { starred_only: true }), search('member', { starred_only: true }),
    search('outsider', { workspace_id: f.otherTeam.workspaceId, starred_only: true }),
  ]);
  expect(owner.documents.map(document => document.id)).toEqual([ours.id]);
  expect(member.documents).toEqual([]);
  expect(outsider.documents.map(document => document.id)).toEqual([theirs.id]);
  const crossCompany = await f.api('bob', '/api/cloud/v1/search', 'POST', {
    workspace_id: f.otherTeam.workspaceId, starred_only: true, facets: true,
  });
  expect(crossCompany.status).toBe(404);
  expect(JSON.stringify(crossCompany.data)).not.toContain(theirs.id);
  const allOurs = await f.api('bob', '/api/cloud/v1/search', 'POST', { starred_only: true, facets: true });
  expect(allOurs.status).toBe(200);
  expect(allOurs.data.documents.map(document => document.id)).toEqual([ours.id]);
  for (const invalid of ['true', 1, null]) {
    const response = await f.api('bob', starPath(ours), 'PUT', { starred: invalid });
    expect(response.status).toBe(400);
  }
  expect((await search('bob', { starred_only: true })).documents.map(document => document.id)).toEqual([ours.id]);
});

test('a pending star write cannot repopulate a different selected library', async ({ page }) => {
  const document = await createDocument('bob', 'Engineering decisions');
  const solo = await f.store.createTeamWorkspace({ userId: f.users.bob.id, name: 'Personal notes', projectName: 'Documents' });
  f.billing.upsertSubscription({ workspaceId: solo.workspaceId, plan: 'team', status: 'active', provider: 'manual' });
  const other = await createDocument('bob', 'Reading list', { workspaceId: solo.workspaceId });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  let finished;
  const released = new Promise(resolve => { finished = resolve; });
  await page.route('**' + starPath(document), async route => {
    const response = await route.fetch();
    started();
    await held;
    await route.fulfill({ response }).catch(() => {});
    finished();
  });
  try {
    await openLibrary(page);
    await expect(star(page, document)).toHaveAttribute('aria-pressed', 'false');
    await star(page, document).click();
    await pending;
    await page.locator('#workspace-button').click();
    await page.locator('#workspace-menu .workspace-menu-item').filter({ hasText: 'Personal notes' }).click();
    await expect(row(page, other)).toBeVisible();
    release();
    await released;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('.res')).toHaveCount(1);
    await expect(row(page, other)).toBeVisible();
    await expect(star(page, other)).toHaveAttribute('aria-pressed', 'false');
    await expect(row(page, document)).toHaveCount(0);
    await page.locator('#workspace-button').click();
    await page.locator('#workspace-menu .workspace-menu-item').filter({ hasText: "Joe's engineering" }).click();
    await expect(star(page, document)).toHaveAttribute('aria-pressed', 'true');
  } finally { release(); }
});

test('keyboard starring works on mobile without opening the document', async ({ page }) => {
  const document = await createDocument('bob', 'Quarterly planning and review');
  await page.setViewportSize({ width: 390, height: 850 });
  await openLibrary(page);
  await expect(star(page, document)).toBeVisible();
  const written = starResponse(page, document);
  await star(page, document).focus();
  await page.keyboard.press('Enter');
  expect((await written).status()).toBe(200);
  await expect(star(page, document)).toHaveAttribute('aria-pressed', 'true');
  expect(page.context().pages()).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(star(page, document)).toHaveAttribute('aria-pressed', 'true');
});
