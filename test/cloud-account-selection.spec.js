const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

async function installCloudLibraryApi(page, workspaces) {
  await page.route('**/api/cloud/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/cloud/v1/workspaces') return route.fulfill({ json: {
      ok: true, workspaces,
      user: { id: 'user-1', first_name: 'Josh', last_name: 'Summers' },
    } });
    if (path === '/api/cloud/v1/me') return route.fulfill({ json: { ok: true,
      user: { id: 'user-1', email: 'josh@smalldocs.org', first_name: 'Josh', last_name: 'Summers' } } });
    if (path === '/api/cloud/v1/documents') return route.fulfill({ json: { ok: true,
      documents: [], next_cursor: null } });
    return route.fulfill({ status: 404, json: { ok: false, error: 'resource_unavailable' } });
  });
}

async function openCloudLibrary(page) {
  await page.goto('/public/library/library.html?scope=cloud');
  await page.evaluate(() => { document.body.dataset.cloudAuthenticated = 'true'; });
  await page.addStyleTag({ url: '/public/library/cloud-library-prototype.css' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-account-selection.js' });
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
  await page.addScriptTag({ url: '/public/library/cloud-library-prototype.js' });

  await expect(page.getByRole('heading', { name: 'Cloud Library' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Learn about Cloud' })).toBeVisible();
  await expect(page.locator('.input-block')).toBeHidden();
  expect(requests).toEqual([]);
});

test('one-account Library opens directly and hides the account switcher', async ({ page }) => {
  await installCloudLibraryApi(page, [
    { id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' },
  ]);
  await openCloudLibrary(page);

  await expect(page.locator('#cloud-library-actions')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.SDocsCloudLibrary &&
    window.SDocsCloudLibrary.workspaceId))
    .toBe('personal-1');
  await expect(page.locator('.cloud-access-note')).toContainText('Signed in as josh@smalldocs.org');
  await expect(page.locator('#status-line')).toHaveText('Cloud');
  await expect(page.locator('[data-facet="project"]')).toBeHidden();
  await expect(page.locator('[data-facet="path"]')).toBeHidden();
  await expect(page.locator('#facet-panel')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#results')).toContainText('Add a document to Cloud to see it here.');
});

test('multi-account Library asks once, uses account names, and remembers the choice', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await installCloudLibraryApi(page, [
    { id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' },
    { id: 'team-1', name: 'SmallDocs', kind: 'team', role: 'admin' },
  ]);
  await openCloudLibrary(page);

  await expect(page.locator('#cloud-library-actions')).toBeVisible();
  await expect(page.locator('#workspace-button')).toContainText('Choose account');
  await expect(page.locator('.cloud-access-note')).toContainText('Choose an account');
  await page.locator('#workspace-button').click();
  const menu = page.locator('#workspace-menu');
  await expect(menu).toContainText('Josh Summers');
  await expect(menu).toContainText('SmallDocs');
  await expect(menu).not.toContainText('Team workspace');
  await expect(menu).not.toContainText('Personal');
  await menu.getByRole('menuitem', { name: 'SmallDocs' }).click();
  await expect.poll(() => page.evaluate(() => window.SDocsCloudLibrary.workspaceId)).toBe('team-1');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sdocs.cloud.account_id')))
    .toBe('team-1');
});
