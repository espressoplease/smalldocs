const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

async function installAdminApi(page, options) {
  const calls = [];
  const workspaces = options.workspaces;
  let domains = options.domains || [];
  let invitations = options.invitations || [];
  await page.route('**/api/cloud/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    calls.push({ method, path, query: url.search, body: request.postDataJSON ? request.postDataJSON() : null });
    if (path === '/api/cloud/v1/me') return route.fulfill({ json: { ok: true,
      user: { id: 'user-1', email: 'owner@smalldocs.org' } } });
    if (path === '/api/cloud/v1/workspaces') return route.fulfill({ json: { ok: true, workspaces } });
    if (path === '/api/cloud/v1/cli/credentials') return route.fulfill({ json: { ok: true, credentials: [] } });
    if (path === '/api/cloud/v1/documents') return route.fulfill({ json: { ok: true,
      documents: options.documents || [], next_cursor: null } });
    if (/\/workspaces\/[^/]+\/billing$/.test(path)) return route.fulfill({ json: { ok: true,
      billing: Object.prototype.hasOwnProperty.call(options, 'billing') ? options.billing
        : { plan: options.kind, effectiveStatus: 'active',
          usage: { memberCount: 1, projectCount: 1, storedBytes: 24 } } } });
    if (path === '/api/cloud/v1/account/members') return route.fulfill({ json: { ok: true,
      members: options.members || [] } });
    if (path === '/api/cloud/v1/account/invitations' && method === 'GET') {
      return route.fulfill({ json: { ok: true, invitations } });
    }
    if (path === '/api/cloud/v1/account/invitations' && method === 'POST') {
      const body = request.postDataJSON();
      const invitation = { id: 'invite-new', email: body.email, role: 'member',
        expires_at: '2026-08-26T12:00:00.000Z' };
      invitations = [invitation].concat(invitations);
      return route.fulfill({ status: 201, json: { ok: true, invitation } });
    }
    if (path === '/api/cloud/v1/account/invite-policy' && method === 'GET') {
      return route.fulfill({ json: { ok: true,
        policy: { domains, can_manage: options.canManage !== false,
          can_invite: options.canInvite !== false } } });
    }
    if (path === '/api/cloud/v1/account/invite-policy' && method === 'PATCH') {
      const body = request.postDataJSON();
      if (body.domains.includes('gmail.com')) {
        return route.fulfill({ status: 400, json: { ok: false, error: 'public_email_domain' } });
      }
      domains = body.domains;
      return route.fulfill({ json: { ok: true,
        policy: { domains, can_manage: true, can_invite: true } } });
    }
    return route.fulfill({ status: 404, json: { ok: false, error: 'resource_unavailable' } });
  });
  return calls;
}

test('Personal Cloud hides team and project concepts and uses a compact left sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  const calls = await installAdminApi(page, {
    kind: 'personal',
    workspaces: [{ id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' }],
  });
  await page.goto('/public/cloud-admin.html');
  await expect(page.getByRole('heading', { name: 'Personal Cloud' })).toBeVisible();
  await expect(page.locator('#workspace-picker')).toBeHidden();
  await expect(page.getByRole('button', { name: 'People' })).toBeHidden();
  await expect(page.getByText('Projects', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Invite person' })).toBeHidden();
  await expect.poll(() => calls.some(call => call.path.includes('/members'))).toBe(false);
  await expect.poll(() => calls.some(call => call.path === '/api/cloud/v1/account/invitations')).toBe(false);

  const overview = await page.getByRole('button', { name: 'Overview' }).boundingBox();
  const agents = await page.getByRole('button', { name: 'Agent access' }).boundingBox();
  expect(overview.height).toBeLessThanOrEqual(40);
  expect(agents.height).toBeLessThanOrEqual(40);
  expect(Math.abs(overview.x - agents.x)).toBeLessThan(2);
  expect(agents.y).toBeGreaterThanOrEqual(overview.y + overview.height);
});

test('Team Cloud keeps invitations and domains in People without project controls', async ({ page }) => {
  const calls = await installAdminApi(page, {
    kind: 'team',
    workspaces: [{ id: 'team-1', name: 'SmallDocs', kind: 'team', role: 'owner' }],
    members: [{ user_id: 'user-1', email: 'owner@smalldocs.org', role: 'owner', status: 'active' }],
  });
  await page.goto('/public/cloud-admin.html');
  await page.getByRole('button', { name: 'People' }).click();
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
  await expect(page.getByText('Projects', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/project access/i)).toHaveCount(0);
  await expect(page.locator('#workspace-picker')).toBeHidden();

  await page.getByRole('textbox', { name: 'Company email domain' }).fill('smalldocs.org');
  await page.getByRole('button', { name: 'Allow domain' }).click();
  await expect(page.locator('.domain-pill')).toContainText('@smalldocs.org');
  expect(calls.some(call => call.method === 'PATCH'
    && call.path === '/api/cloud/v1/account/invite-policy')).toBe(true);

  await page.getByRole('button', { name: 'Invite person' }).click();
  await page.getByPlaceholder('name@company.com').fill('ada@example.com');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('ada@example.com', { exact: true })).toBeVisible();
  const inviteCall = calls.find(call => call.method === 'POST'
    && call.path === '/api/cloud/v1/account/invitations');
  expect(inviteCall.body).toEqual({ account_id: 'team-1', email: 'ada@example.com' });
});

test('workspace picker appears only when there is something to switch to', async ({ page }) => {
  await installAdminApi(page, {
    kind: 'personal',
    workspaces: [
      { id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' },
      { id: 'team-1', name: 'SmallDocs', kind: 'team', role: 'admin' },
    ],
  });
  await page.goto('/public/cloud-admin.html?workspace_id=personal-1');
  await expect(page.locator('#workspace-picker')).toBeVisible();
  await expect(page.locator('#workspace-switch')).toHaveValue('personal-1');
});

test('team members can invite an allowed company email without admin controls', async ({ page }) => {
  const calls = await installAdminApi(page, {
    kind: 'team',
    workspaces: [{ id: 'team-1', name: 'SmallDocs', kind: 'team', role: 'member' }],
    members: [{ user_id: 'user-1', email: 'owner@smalldocs.org', role: 'member', is_you: true }],
    domains: ['smalldocs.org'],
    canManage: false,
  });
  await page.goto('/public/cloud-admin.html');
  await page.getByRole('button', { name: 'People' }).click();
  await expect(page.getByRole('textbox', { name: 'Company email domain' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Invite person' }).click();
  await page.getByPlaceholder('name@company.com').fill('tom@smalldocs.org');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.locator('#invite-status')).toHaveText('Invitation sent to tom@smalldocs.org.');
  expect(calls.some(call => call.method === 'GET'
    && call.path === '/api/cloud/v1/account/invitations')).toBe(false);
});

test('an unpaid team can open settings and subscribe without loading paid data', async ({ page }) => {
  const calls = await installAdminApi(page, {
    kind: 'team',
    workspaces: [{ id: 'team-new', name: 'SmallDocs Demo', kind: 'team', role: 'owner' }],
    members: [{ user_id: 'user-1', email: 'owner@smalldocs.org', role: 'owner', is_you: true }],
    billing: { plan: null, effectiveStatus: 'inactive',
      usage: { memberCount: 1, projectCount: 1, storedBytes: 0 } },
  });
  await page.route('**/api/cloud/v1/documents?**', route => route.fulfill({ status: 402,
    json: { ok: false, error: 'subscription_required' } }));
  await page.route('**/api/cloud/v1/account/invitations?**', route => route.fulfill({ status: 402,
    json: { ok: false, error: 'subscription_required' } }));
  await page.goto('/public/cloud-admin.html');
  await expect(page.getByRole('heading', { name: 'SmallDocs Demo' })).toBeVisible();
  await expect(page.locator('#page-error')).toBeHidden();
  await page.getByRole('button', { name: 'Billing' }).click();
  await expect(page.getByRole('link', { name: 'Subscribe' })).toBeVisible();
  await page.getByRole('button', { name: 'People' }).click();
  await expect(page.getByRole('button', { name: 'Invite person' })).toBeHidden();
  expect(calls.some(call => call.path.includes('/projects'))).toBe(false);
});
