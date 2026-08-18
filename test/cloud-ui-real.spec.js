const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

test('real Cloud controls save, share, tag, and remove through account APIs', async ({ page }) => {
  const calls = [];
  let revision = 1;
  let tags = [];
  let permission = { id: 'group-1', account_id: 'acct-1', document_id: 'doc-1',
    mode: 'custom', member_user_ids: ['usr-1'], owner_user_id: 'usr-1', can_manage: true };
  await page.route('**/api/cloud/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push({ method: request.method(), path });
    if (path === '/api/cloud/v1/account') return route.fulfill({ json: { ok: true,
      account: { id: 'acct-1', kind: 'team', name: 'SmallDocs', can_write: true },
      accounts: [], user: { id: 'usr-1', email: 'josh@example.com' } } });
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
    if (path === '/api/cloud/v1/documents/doc-1' && request.method() === 'DELETE') {
      return route.fulfill({ json: { ok: true, document: { id: 'doc-1' } } });
    }
    return route.fulfill({ status: 404, json: { ok: false, error: 'resource_unavailable' } });
  });

  await page.goto('/docs');
  await page.addStyleTag({ url: '/public/css/cloud-ui-lab.css' });
  await page.evaluate(() => { window.SDocs._isDefaultState = false; });
  await page.addScriptTag({ url: '/public/sdocs-cloud-prototype.js' });
  await expect(page.locator('.sdoc-cloud-lab-add-link')).toBeVisible();
  await expect.poll(() => calls.some(call => call.path === '/api/cloud/v1/account')).toBe(true);
  await expect(page.locator('.fic-row-cloud')).not.toContainText('paid feature');
  await page.locator('.sdoc-cloud-lab-add-link').click();
  await expect(page.locator('.sdoc-cloud-lab-access')).toContainText('You');
  expect(calls.some(call => call.method === 'POST' &&
    call.path === '/api/cloud/v1/account/documents')).toBe(true);

  await page.locator('.sdoc-cloud-lab-access').click();
  await page.getByRole('button', { name: 'Everyone' }).click();
  await expect(page.locator('.sdoc-cloud-lab-access')).toContainText('Everyone');

  await page.getByRole('button', { name: 'Edit Cloud tags' }).click();
  await page.getByRole('textbox', { name: 'New Cloud tag' }).fill('release');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.fic-row-cloud')).toContainText('#release');

  await page.locator('.sdoc-cloud-lab-saved').click();
  await expect(page.locator('.sdoc-cloud-lab-add-link')).toBeVisible();
  expect(calls.some(call => call.method === 'DELETE' &&
    call.path === '/api/cloud/v1/documents/doc-1')).toBe(true);
});
