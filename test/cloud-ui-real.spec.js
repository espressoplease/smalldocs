const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

test('real Cloud admin controls save, invite, share, tag, and remove through account APIs', async ({ page }) => {
  const calls = [];
  let revision = 1;
  let tags = [];
  let invitations = [];
  let invitePolicy = { domains: [], can_manage: true, can_invite: true };
  let failInvitations = false;
  let permission = { id: 'group-1', account_id: 'acct-1', document_id: 'doc-1',
    mode: 'custom', member_user_ids: ['usr-1'], owner_user_id: 'usr-1', can_manage: true };
  await page.route('**/api/cloud/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push({ method: request.method(), path });
    if (path === '/api/cloud/v1/account') return route.fulfill({ json: { ok: true,
      account: { id: 'acct-1', kind: 'team', name: 'SmallDocs', role: 'admin', can_write: true },
      accounts: [], user: { id: 'usr-1', email: 'josh@example.com' } } });
    if (path === '/api/cloud/v1/account/members') return route.fulfill({ json: { ok: true,
      account_id: 'acct-1', members: [
        { user_id: 'usr-1', email: 'josh@example.com', name: 'Josh', initials: 'JS', is_you: true },
        { user_id: 'usr-2', email: 'tom@example.com', name: 'Tom Smith', initials: 'TS', is_you: false },
      ] } });
    if (path === '/api/cloud/v1/account/tags') return route.fulfill({ json: { ok: true,
      account_id: 'acct-1', tags: [{ tag: 'planning', count: 4 }] } });
    if (path === '/api/cloud/v1/account/invite-policy' && request.method() === 'GET') {
      return route.fulfill({ json: { ok: true, account_id: 'acct-1', policy: invitePolicy } });
    }
    if (path === '/api/cloud/v1/account/invite-policy' && request.method() === 'PATCH') {
      const body = request.postDataJSON();
      if (body.domains.includes('gmail.com')) {
        return route.fulfill({ status: 400, json: { ok: false, error: 'public_email_domain' } });
      }
      invitePolicy = { domains: body.domains, can_manage: true, can_invite: true };
      return route.fulfill({ json: { ok: true, account_id: 'acct-1', policy: invitePolicy } });
    }
    if (path === '/api/cloud/v1/account/invitations' && request.method() === 'GET') {
      return route.fulfill({ json: { ok: true, account_id: 'acct-1', invitations } });
    }
    if (path === '/api/cloud/v1/account/invitations' && request.method() === 'POST') {
      if (failInvitations) {
        return route.fulfill({ status: 503, json: { ok: false, error: 'email_delivery_unavailable' } });
      }
      const body = request.postDataJSON();
      const invitation = { id: 'invite-1', email: body.email, role: 'member',
        expires_at: '2026-08-26T12:00:00.000Z' };
      invitations.unshift(invitation);
      return route.fulfill({ status: 201, json: { ok: true, invitation } });
    }
    if (path === '/api/cloud/v1/account/invitations/invite-1' && request.method() === 'DELETE') {
      invitations = [];
      return route.fulfill({ json: { ok: true, invitation: { id: 'invite-1' } } });
    }
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
  await page.getByRole('textbox', { name: 'Company email domain' }).fill('smalldocs.org');
  await page.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(page.getByText('@smalldocs.org', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Company email domain' }).fill('gmail.com');
  await page.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(page.locator('.sdoc-cloud-lab-status')).toHaveText(
    'Use a company domain rather than a public email provider.');
  await page.getByRole('textbox', { name: 'Email address' }).fill('ada@example.com');
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.getByText('ada@example.com', { exact: true })).toBeVisible();
  await expect(page.getByText('Invitation pending', { exact: true })).toBeVisible();
  await expect(page.getByText('Billing adds one team seat after the person accepts.')).toBeVisible();
  expect(calls.some(call => call.method === 'POST' &&
    call.path === '/api/cloud/v1/account/invitations')).toBe(true);
  await page.getByRole('button', { name: 'Cancel invitation for ada@example.com' }).click();
  await expect(page.getByText('Invitation pending', { exact: true })).toHaveCount(0);
  expect(calls.some(call => call.method === 'DELETE' &&
    call.path === '/api/cloud/v1/account/invitations/invite-1')).toBe(true);
  failInvitations = true;
  await page.getByRole('textbox', { name: 'Email address' }).fill('blocked@example.com');
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.locator('.sdoc-cloud-lab-status')).toHaveText('The invitation was not sent.');

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

test('team members can invite coworkers only at approved domains', async ({ page }) => {
  const calls = [];
  let permission = { id: 'group-1', account_id: 'acct-1', document_id: 'doc-1',
    mode: 'custom', member_user_ids: ['usr-1'], owner_user_id: 'usr-1', can_manage: true };
  await page.route('**/api/cloud/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push({ method: request.method(), path });
    if (path === '/api/cloud/v1/account') return route.fulfill({ json: { ok: true,
      account: { id: 'acct-1', kind: 'team', name: 'SmallDocs', role: 'member', can_write: true },
      accounts: [], user: { id: 'usr-1', email: 'josh@smalldocs.org' } } });
    if (path === '/api/cloud/v1/account/members') return route.fulfill({ json: { ok: true,
      account_id: 'acct-1', members: [
        { user_id: 'usr-1', email: 'josh@smalldocs.org', name: 'Josh', initials: 'JS', is_you: true },
      ] } });
    if (path === '/api/cloud/v1/account/tags') return route.fulfill({ json: { ok: true,
      account_id: 'acct-1', tags: [] } });
    if (path === '/api/cloud/v1/account/invite-policy') return route.fulfill({ json: { ok: true,
      account_id: 'acct-1', policy: { domains: ['smalldocs.org'],
        can_manage: false, can_invite: true } } });
    if (path === '/api/cloud/v1/account/documents') return route.fulfill({ status: 201, json: {
      ok: true, account: { id: 'acct-1', kind: 'team', name: 'SmallDocs' },
      document: { id: 'doc-1', filename: 'sdoc.md', title: 'SmallDocs', tags: [],
        current_revision_id: 'rev-1', revision_number: 1, workspace_id: 'acct-1' }, permission } });
    if (path === '/api/cloud/v1/account/invitations' && request.method() === 'POST') {
      const email = request.postDataJSON().email;
      if (!email.endsWith('@smalldocs.org')) {
        return route.fulfill({ status: 403, json: { ok: false, error: 'permission_denied' } });
      }
      return route.fulfill({ status: 201, json: { ok: true,
        invitation: { id: 'invite-member', email, role: 'member' } } });
    }
    if (path === '/api/cloud/v1/documents/doc-1/permission') {
      permission = Object.assign({}, permission, request.postDataJSON());
      return route.fulfill({ json: { ok: true, permission } });
    }
    return route.fulfill({ status: 404, json: { ok: false, error: 'resource_unavailable' } });
  });

  await page.goto('/docs');
  await page.addStyleTag({ url: '/public/css/cloud-ui-lab.css' });
  await page.evaluate(() => { window.SDocs._isDefaultState = false; });
  await page.addScriptTag({ url: '/public/sdocs-cloud-prototype.js' });
  await expect.poll(() => calls.some(call => call.path === '/api/cloud/v1/account')).toBe(true);
  await page.locator('.sdoc-cloud-lab-add-link').click();
  await page.locator('.sdoc-cloud-lab-access').click();

  await expect(page.getByText(/You can invite people at @smalldocs.org/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Company email domain' })).toHaveCount(0);
  await expect.poll(() => calls.some(call => call.path === '/api/cloud/v1/account/invitations'
    && call.method === 'GET')).toBe(false);

  const email = page.getByRole('textbox', { name: 'Email address' });
  await email.fill('tom@smalldocs.org');
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.locator('.sdoc-cloud-lab-status')).toHaveText(
    'Invitation sent to tom@smalldocs.org.');

  await email.fill('tom@example.com');
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.locator('.sdoc-cloud-lab-status')).toHaveText(
    'Members can invite only @smalldocs.org.');
});
