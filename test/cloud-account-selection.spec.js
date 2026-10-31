const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block', locale: 'en-GB' });

async function installCloudLibraryApi(page, workspaces, canRead = true, documents = []) {
  await page.route('**/api/cloud/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/cloud/v1/workspaces') return route.fulfill({ json: {
      ok: true, workspaces,
      user: { id: 'user-1', first_name: 'Josh', last_name: 'Summers' },
    } });
    if (path === '/api/cloud/v1/me') return route.fulfill({ json: { ok: true,
      user: { id: 'user-1', email: 'josh@smalldocs.org', first_name: 'Josh', last_name: 'Summers' } } });
    if (path === '/api/cloud/v1/account') return route.fulfill({ json: { ok: true,
      account: { id: new URL(route.request().url()).searchParams.get('account_id'), can_read: canRead,
        can_write: canRead } } });
    if (path === '/api/cloud/v1/documents') return route.fulfill({ json: { ok: true,
      documents, next_cursor: null } });
    if (path === '/api/cloud/v1/search') {
      const query = route.request().postDataJSON();
      const matches = documents.filter(doc => (!query.shared_with_me || doc.shared_with_me) &&
        (query.tags || []).every(tag => (doc.tags || []).includes(tag)));
      return route.fulfill({ json: { ok: true, documents: matches, total_count: matches.length, next_cursor: null } });
    }
    if (path === '/api/cloud/v1/account/tags') return route.fulfill({ json: { ok: true, tags: [] } });
    if (path === '/api/cloud/v1/account/members') return route.fulfill({ json: { ok: true, members: [] } });
    return route.fulfill({ status: 404, json: { ok: false, error: 'resource_unavailable' } });
  });
}

async function openCloudLibrary(page, extraQuery) {
  await page.goto('/public/library/library.html?scope=cloud' + (extraQuery || ''));
  await page.evaluate(() => { document.body.dataset.cloudAuthenticated = 'true'; });
  await page.addStyleTag({ url: '/public/library/cloud-library-prototype.css' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-account-selection.js' });
  await page.addScriptTag({ url: '/public/sdocs-library-header.js' });
  await page.addScriptTag({ url: '/public/library/cloud-library-prototype.js' });
}

test('signed-out Cloud Library explains the feature without calling Cloud APIs', async ({ page }) => {
  const requests = [];
  page.on('request', request => {
    if (request.url().includes('/api/cloud/')) requests.push(request.url());
  });
  await page.goto('/public/library/library.html?scope=cloud');
  await page.addStyleTag({ url: '/public/library/cloud-library-prototype.css' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-account-selection.js' });
  await page.addScriptTag({ url: '/public/sdocs-library-header.js' });
  await page.addScriptTag({ url: '/public/library/cloud-library-prototype.js' });

  await expect(page.getByRole('heading', { name: 'Cloud Library' })).toBeVisible();
  const onboardingSignIn = page.locator('#cloud-onboarding [data-cloud-sign-in]');
  await expect(onboardingSignIn).toBeVisible();
  await expect(onboardingSignIn).toHaveAttribute('href', '/cloud/sign-in?return=%2Flibrary%3Fscope%3Dcloud');
  const sidebarSignIn = page.locator('#_sd_site_sidebar [data-sdocs-sign-in-return]');
  await expect(sidebarSignIn).toBeVisible();
  await expect(sidebarSignIn).toHaveAttribute('href', /return=.*library/);
  await expect(page.getByRole('link', { name: 'Cloud features, pricing, and security' })).toBeVisible();
  await expect(page.getByText('$5 USD or €5 EUR', { exact: true })).toBeVisible();
  await expect(page.getByText('$9 USD or €8 EUR', { exact: true })).toBeVisible();
  await expect(page.getByText('Search and tags', { exact: true })).toBeVisible();
  await expect(page.locator('.input-block')).toBeHidden();
  expect(requests).toEqual([]);
});

test('signed-in user without an account sees subscription onboarding without another sign-in action', async ({ page }) => {
  await installCloudLibraryApi(page, []);
  await openCloudLibrary(page);

  await expect(page.getByRole('heading', { name: 'Cloud Library' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Subscribe to Cloud' })).toBeVisible();
  await expect(page.locator('[data-cloud-sign-in]')).toBeHidden();
  await expect(page.locator('.input-block')).toBeHidden();
});

test('one-library page opens directly and keeps Personal and team creation visible', async ({ page }) => {
  await installCloudLibraryApi(page, [
    { id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' },
  ]);
  await openCloudLibrary(page);

  await expect(page.locator('#cloud-library-actions')).toBeVisible();
  await expect(page.locator('#workspace-button')).toContainText('Personal');
  await expect(page.locator('#workspace-button [data-library-kind="personal"]')).toBeVisible();
  await expect(page.locator('#personal-library-note')).toContainText('for you only');
  await expect(page.locator('.cloud-create-library')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.SDocsCloudLibrary &&
    window.SDocsCloudLibrary.workspaceId))
    .toBe('personal-1');
  await expect(page.locator('.cloud-access-note')).toContainText('Signed in as josh@smalldocs.org');
  await expect(page.locator('#status-line')).toHaveText('Cloud');
  await expect(page.locator('[data-facet="project"]')).toBeHidden();
  await expect(page.locator('[data-facet="path"]')).toBeHidden();
  await expect(page.locator('#facet-panel')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#results')).toContainText('No Cloud documents yet.');
});

test('Cloud Library filters documents shared with the signed-in user', async ({ page }) => {
  await installCloudLibraryApi(page, [
    { id: 'team-1', name: 'SmallDocs', kind: 'team', role: 'member' },
  ], true, [
    { id: 'owned-1', title: 'My draft', filename: 'mine.md', tags: [],
      current_revision_id: 'rev-1', updated_at: '2026-08-20T12:00:00.000Z',
      created_by_user_id: 'user-1', shared_with_me: false },
    { id: 'shared-1', title: 'Shared plan', filename: 'shared.md', tags: [],
      current_revision_id: 'rev-2', updated_at: '2026-08-20T11:00:00.000Z',
      created_by_user_id: 'user-2', shared_with_me: true },
  ]);
  await openCloudLibrary(page);

  await expect(page.locator('#results')).toContainText('My draft');
  await expect(page.locator('#results')).toContainText('Shared plan');
  await page.locator('#shared-toggle').click();
  await expect(page.locator('#shared-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#results')).not.toContainText('My draft');
  await expect(page.locator('#results')).toContainText('Shared plan');
});

test('one click opens a Cloud document in a new tab', async ({ page, context }) => {
  await installCloudLibraryApi(page, [
    { id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' },
  ], true, [
    { id: 'document-1', title: 'Reader notes', filename: 'reader-notes.md', tags: ['design'],
      current_revision_id: 'rev-1', updated_at: '2026-08-20T12:00:00.000Z' },
  ]);
  await openCloudLibrary(page);
  const originalUrl = page.url();
  const [documentPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('.res:has-text("Reader notes")').click(),
  ]);
  await documentPage.waitForLoadState('domcontentloaded');
  expect(documentPage.url()).toContain('/docs?cloud-document=document-1');
  expect(page.url()).toBe(originalUrl);
});

test('Cloud Library tag query opens with the matching filter applied', async ({ page }) => {
  await installCloudLibraryApi(page, [
    { id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' },
  ], true, [
    { id: 'design-1', title: 'Design notes', filename: 'design.md', tags: ['design'],
      current_revision_id: 'rev-1', updated_at: '2026-08-20T12:00:00.000Z' },
    { id: 'release-1', title: 'Release notes', filename: 'release.md', tags: ['release'],
      current_revision_id: 'rev-2', updated_at: '2026-08-20T11:00:00.000Z' },
  ]);
  await openCloudLibrary(page, '&tag=design');

  await expect(page.locator('#results')).toContainText('Design notes');
  await expect(page.locator('#results')).not.toContainText('Release notes');
  await expect(page.locator('#chips-row')).toContainText('design');
});

test('an account without an active subscription sees subscription onboarding', async ({ page }) => {
  await installCloudLibraryApi(page, [
    { id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' },
  ], false);
  await openCloudLibrary(page);

  await expect(page.getByRole('link', { name: 'Subscribe to Cloud' })).toBeVisible();
  await expect(page.locator('[data-cloud-sign-in]')).toBeHidden();
  await expect(page.locator('.input-block')).toBeHidden();
});

test('multi-account Library asks once, uses account names, and remembers the choice', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await installCloudLibraryApi(page, [
    { id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' },
    { id: 'team-1', name: 'SmallDocs', kind: 'team', role: 'admin' },
  ]);
  await openCloudLibrary(page);

  await expect(page.locator('#cloud-library-actions')).toBeVisible();
  await expect(page.locator('#workspace-button')).toContainText('Choose library');
  await expect(page.locator('.cloud-access-note')).toContainText('Choose a library');
  await page.locator('#workspace-button').click();
  const menu = page.locator('#workspace-menu');
  await expect(menu).toContainText('Personal');
  await expect(menu).toContainText('SmallDocs');
  await expect(menu).not.toContainText('Team workspace');
  await expect(menu.locator('[data-library-kind="personal"]')).toHaveCount(1);
  await expect(menu.locator('[data-library-kind="team"]')).toHaveCount(1);
  const colors = await menu.locator('.workspace-mark').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).color));
  expect(new Set(colors).size).toBe(2);
  await menu.getByRole('menuitem', { name: 'SmallDocs' }).click();
  await expect(page.locator('#personal-library-note')).toBeHidden();
  const selectedColor = await page.locator('#workspace-button .workspace-mark').evaluate(node => getComputedStyle(node).color);
  expect(selectedColor).toBe(colors[1]);
  await expect.poll(() => page.evaluate(() => window.SDocsCloudLibrary.workspaceId)).toBe('team-1');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sdocs.cloud.account_id')))
    .toBe('team-1');
});
