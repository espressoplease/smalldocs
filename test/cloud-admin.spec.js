const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

async function installAdminApi(page, options) {
  const calls = [];
  const workspaces = options.workspaces;
  let domains = options.domains || [];
  let invitations = options.invitations || [];
  let credentials = options.credentials || [];
  await page.route('**/api/cloud/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    calls.push({ method, path, query: url.search, body: request.postDataJSON ? request.postDataJSON() : null });
    if (path === '/api/cloud/v1/me') return route.fulfill({ json: { ok: true,
      user: { id: 'user-1', email: 'owner@smalldocs.org' } } });
    if (path === '/api/cloud/v1/workspaces') return route.fulfill({ json: { ok: true, workspaces } });
    if (path === '/api/cloud/v1/cli/credentials' && method === 'GET') {
      return route.fulfill({ json: { ok: true, credentials } });
    }
    if (/\/api\/cloud\/v1\/cli\/credentials\/[^/]+$/.test(path) && method === 'DELETE') {
      const credentialId = path.split('/').pop();
      credentials = credentials.filter(credential => credential.id !== credentialId);
      return route.fulfill({ json: { ok: true } });
    }
    if (path === '/api/cloud/v1/workspaces/deleted') {
      return route.fulfill({ json: { ok: true, workspaces: options.deletedWorkspaces || [] } });
    }
    if (path === '/api/cloud/v1/documents/deleted') {
      return route.fulfill({ json: { ok: true, documents: options.deletedDocuments || [] } });
    }
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
      const invitation = { id: 'invite-new', email: body.email, role: body.role || 'member',
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

test('an individual account hides account, team, and project controls', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  const calls = await installAdminApi(page, {
    kind: 'personal',
    workspaces: [{ id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' }],
  });
  await page.goto('/public/cloud-admin.html');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.locator('#account-switcher')).toBeHidden();
  await expect(page.getByRole('button', { name: 'People' })).toBeHidden();
  await expect(page.getByText('Projects', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connected machines' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite person' })).toBeHidden();
  const sidebar = page.locator('#_sd_site_sidebar');
  const library = sidebar.getByRole('link', { name: 'Cloud library' });
  await expect(sidebar).toBeVisible();
  await expect(library).toHaveAttribute('href', '/library?scope=cloud');
  await expect(library.locator('svg')).toHaveCount(1);
  await expect(sidebar.getByRole('link', { name: 'Account settings' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Cloud settings', level: 1 })).toHaveCount(1);
  await expect(page.locator('.header')).toHaveCount(0);
  await expect(page.locator('.side-label')).toHaveCount(0);
  await expect.poll(() => calls.some(call => call.path.includes('/members'))).toBe(false);
  await expect.poll(() => calls.some(call => call.path === '/api/cloud/v1/account/invitations')).toBe(false);
  await expect.poll(() => calls.some(call => call.path === '/api/cloud/v1/cli/credentials')).toBe(true);

  const overview = await page.getByRole('button', { name: 'Overview' }).boundingBox();
  const machines = await page.getByRole('button', { name: 'Connected machines' }).boundingBox();
  const billing = await page.getByRole('button', { name: 'Billing' }).boundingBox();
  expect(overview.height).toBeLessThanOrEqual(40);
  expect(machines.height).toBeLessThanOrEqual(40);
  expect(billing.height).toBeLessThanOrEqual(40);
  expect(Math.abs(overview.y - machines.y)).toBeLessThan(2);
  expect(Math.abs(machines.y - billing.y)).toBeLessThan(2);
  expect(machines.x).toBeGreaterThanOrEqual(overview.x + overview.width);
  expect(billing.x).toBeGreaterThanOrEqual(machines.x + machines.width);
});

test('Connected machines is a dedicated settings panel and revokes a personal credential', async ({ page }) => {
  const calls = await installAdminApi(page, {
    kind: 'personal',
    workspaces: [{ id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' }],
    credentials: [
      {
        id: 'cli-1', displayName: 'build-server', createdAtMs: Date.UTC(2026, 7, 20, 9),
        lastUsedAtMs: Date.UTC(2026, 7, 20, 10), revokedAtMs: null,
      },
      {
        id: 'cli-old', displayName: 'old-machine', createdAtMs: Date.UTC(2026, 7, 1),
        lastUsedAtMs: Date.UTC(2026, 7, 1), revokedAtMs: Date.UTC(2026, 7, 2),
      },
    ],
  });
  await page.goto('/public/cloud-admin.html?panel=machines');

  await expect(page.getByRole('heading', { name: 'Connected machines' })).toBeVisible();
  await expect(page.getByText('build-server', { exact: true })).toBeVisible();
  await expect(page.getByText('old-machine', { exact: true })).toHaveCount(0);
  await expect(page.locator('#panel-machines')).toHaveCSS('text-align', 'start');
  await page.getByRole('button', { name: 'Revoke build-server' }).click();
  await page.getByRole('button', { name: 'Revoke machine' }).click();
  await expect(page.getByText('build-server', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/No machines are connected/)).toBeVisible();
  expect(calls.some(call => call.method === 'DELETE'
    && call.path === '/api/cloud/v1/cli/credentials/cli-1')).toBe(true);
});

test('Connected machines stays left aligned and usable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installAdminApi(page, {
    kind: 'personal',
    workspaces: [{ id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' }],
    credentials: [{
      id: 'cli-1', displayName: 'remote-analysis-server-with-a-long-hostname',
      createdAtMs: Date.UTC(2026, 7, 20, 9), lastUsedAtMs: Date.UTC(2026, 7, 20, 10),
      revokedAtMs: null,
    }],
  });
  await page.goto('/public/cloud-admin.html?panel=machines');

  const mainBox = await page.locator('.main').boundingBox();
  const rowBox = await page.locator('.machine-row').boundingBox();
  expect(rowBox.x).toBeGreaterThanOrEqual(mainBox.x);
  expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(mainBox.x + mainBox.width);
  await expect(page.locator('.machine-row')).toHaveCSS('text-align', 'start');
  await expect(page.getByRole('button', { name: 'Revoke remote-analysis-server-with-a-long-hostname' }))
    .toBeVisible();
});

test('Team Cloud keeps invitations and domains in People without project controls', async ({ page }) => {
  const calls = await installAdminApi(page, {
    kind: 'team',
    workspaces: [{ id: 'team-1', name: 'SmallDocs', kind: 'team', role: 'owner' }],
    members: [
      { user_id: 'user-1', email: 'owner@smalldocs.org', name: 'Olivia Walker', initials: 'OW',
        role: 'owner', status: 'active' },
      { user_id: 'user-2', email: 'tom@smalldocs.org', name: 'Tom Smith', initials: 'TS',
        role: 'member', status: 'active' },
    ],
  });
  await page.goto('/public/cloud-admin.html');
  await page.getByRole('button', { name: 'People' }).click();
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
  await expect(page.getByText('Projects', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/project access/i)).toHaveCount(0);
  await expect(page.locator('#account-switcher')).toBeHidden();
  await expect(page.getByText('Olivia Walker', { exact: true })).toBeVisible();
  await expect(page.getByText('Tom Smith', { exact: true })).toBeVisible();
  const avatar = page.locator('.avatar').first();
  await expect(avatar).toHaveText('OW');
  await expect(avatar).toHaveCSS('display', 'grid');
  await expect(avatar).toHaveCSS('align-items', 'center');
  await expect(avatar).toHaveCSS('justify-items', 'center');
  await expect(avatar).toHaveCSS('margin-top', '0px');

  await page.getByRole('textbox', { name: 'Company email domain' }).fill('smalldocs.org');
  await page.getByRole('button', { name: 'Allow domain' }).click();
  await expect(page.locator('.domain-pill')).toContainText('@smalldocs.org');
  expect(calls.some(call => call.method === 'PATCH'
    && call.path === '/api/cloud/v1/account/invite-policy')).toBe(true);

  await page.getByRole('button', { name: 'Invite person' }).click();
  await expect(page.getByRole('radio', { name: 'Member' })).toBeChecked();
  await page.getByRole('radio', { name: 'Admin' }).check();
  await expect(page.locator('#invite-role-copy'))
    .toHaveText('Can manage people and allowed domains, and invite any email.');
  await page.getByPlaceholder('name@company.com').fill('ada@example.com');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('ada@example.com', { exact: true })).toBeVisible();
  const inviteCall = calls.find(call => call.method === 'POST'
    && call.path === '/api/cloud/v1/account/invitations');
  expect(inviteCall.body).toEqual({ account_id: 'team-1', email: 'ada@example.com', role: 'admin' });
  await expect(page.getByRole('radio', { name: 'Member' })).toBeChecked();

  await page.getByRole('button', { name: 'Billing' }).click();
  await expect(page.getByRole('button', { name: 'Delete team' })).toBeVisible();
});

test('a new team shows the company domain seeded from its owner email', async ({ page }) => {
  const calls = await installAdminApi(page, {
    kind: 'team',
    workspaces: [{ id: 'team-1', name: 'SmallDocs', kind: 'team', role: 'owner' }],
    members: [{ user_id: 'user-1', email: 'owner@smalldocs.org', role: 'owner', status: 'active' }],
    domains: ['smalldocs.org'],
  });
  await page.goto('/public/cloud-admin.html');
  await page.getByRole('button', { name: 'People' }).click();

  await expect(page.locator('.domain-pill')).toContainText('@smalldocs.org');
  expect(calls.some(call => call.method === 'PATCH'
    && call.path === '/api/cloud/v1/account/invite-policy')).toBe(false);
});

test('a team admin cannot delete the team', async ({ page }) => {
  await installAdminApi(page, {
    kind: 'team',
    workspaces: [{ id: 'team-1', name: 'SmallDocs', kind: 'team', role: 'admin' }],
    members: [{ user_id: 'user-1', email: 'admin@smalldocs.org', role: 'admin', status: 'active' }],
  });
  await page.goto('/public/cloud-admin.html');
  await page.getByRole('button', { name: 'People' }).click();
  await page.getByRole('button', { name: 'Invite person' }).click();
  await expect(page.getByRole('radio', { name: 'Admin' })).toBeVisible();
  await page.getByRole('button', { name: 'Billing' }).click();
  await expect(page.getByRole('button', { name: 'Delete team' })).toBeHidden();
});

test('account switcher appears only when there is something to switch to', async ({ page }) => {
  await installAdminApi(page, {
    kind: 'personal',
    workspaces: [
      { id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' },
      { id: 'team-1', name: 'SmallDocs', kind: 'team', role: 'admin' },
    ],
  });
  await page.goto('/public/cloud-admin.html?workspace_id=personal-1');
  await expect(page.locator('#account-switcher')).toBeVisible();
  await expect(page.locator('#account-switcher-name')).toHaveText('Personal');
  await page.locator('#account-switcher-button').click();
  await expect(page.locator('#account-switcher-menu').getByRole('menuitem')).toHaveCount(2);
  await expect(page.locator('#account-switcher-menu')).toContainText('SmallDocs');
});

test('shared navigation and the account switcher stay usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installAdminApi(page, {
    kind: 'team',
    workspaces: [
      { id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' },
      { id: 'team-1', name: 'SmallDocs Demo', kind: 'team', role: 'owner' },
    ],
  });
  await page.goto('/public/cloud-admin.html?workspace_id=team-1');

  const picker = page.locator('#account-switcher-button');
  await expect(picker).toBeVisible();
  const menu = page.getByRole('button', { name: 'Open menu' });
  await expect(menu).toBeVisible();
  await menu.click();
  const library = page.locator('#_sd_site_sidebar').getByRole('link', { name: 'Cloud library' });
  await expect(library).toBeVisible();
  await expect(library.locator('svg')).toHaveCount(1);
  await expect(page.locator('#_sd_site_sidebar').getByRole('link', { name: 'Local library' })).toBeHidden();
  await expect(page.locator('#_sd_site_sidebar').getByRole('link', { name: 'Account settings' }))
    .toHaveAttribute('aria-current', 'page');

  const pickerBox = await picker.boundingBox();
  expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual(390);
});

test('Cloud settings navigation and panels fit a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installAdminApi(page, {
    kind: 'team',
    workspaces: [
      { id: 'personal-1', name: 'Personal', kind: 'personal', role: 'owner' },
      { id: 'team-1', name: 'SmallDocs Demo', kind: 'team', role: 'owner' },
    ],
    members: [{ user_id: 'user-1', email: 'owner@smalldocs.org', role: 'owner', is_you: true }],
  });
  await page.goto('/public/cloud-admin.html?workspace_id=team-1');

  const pickerBox = await page.locator('#account-switcher-button').boundingBox();
  const tabsBox = await page.locator('.settings-nav').boundingBox();
  const initialMainBox = await page.locator('.main').boundingBox();
  expect(pickerBox.y + pickerBox.height).toBeLessThanOrEqual(tabsBox.y);
  expect(tabsBox.x).toBeGreaterThanOrEqual(0);
  expect(tabsBox.x + tabsBox.width).toBeLessThanOrEqual(390);
  expect(initialMainBox.y).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole('button', { name: 'Connected machines' })).toContainText('Machines');
  const tabWidths = await page.locator('.settings-nav').evaluate(element => ({
    client: element.clientWidth, scroll: element.scrollWidth,
  }));
  expect(tabWidths.scroll).toBeLessThanOrEqual(tabWidths.client);

  for (const panelName of ['Overview', 'People', 'Connected machines', 'Billing']) {
    await page.getByRole('button', { name: panelName }).click();
    const geometry = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      bodyWidth: document.body.scrollWidth,
      documentWidth: document.documentElement.scrollWidth,
      main: document.querySelector('.main').getBoundingClientRect().toJSON(),
    }));
    expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.main.x).toBeGreaterThanOrEqual(0);
    expect(geometry.main.right).toBeLessThanOrEqual(geometry.viewportWidth);
  }

  await page.getByRole('button', { name: 'People' }).click();
  const field = page.getByRole('textbox', { name: 'Company email domain' });
  await expect(field).toHaveCSS('font-size', '16px');
  await page.getByRole('button', { name: 'Invite person' }).click();
  const inviteButton = await page.getByRole('button', { name: 'Invite person' }).boundingBox();
  const mainBox = await page.locator('.main').boundingBox();
  expect(inviteButton.x).toBeGreaterThanOrEqual(mainBox.x);
  expect(inviteButton.x + inviteButton.width).toBeLessThanOrEqual(mainBox.x + mainBox.width);

  await page.setViewportSize({ width: 320, height: 700 });
  const narrowGeometry = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    bodyWidth: document.body.scrollWidth,
    tabClientWidth: document.querySelector('.settings-nav').clientWidth,
    tabScrollWidth: document.querySelector('.settings-nav').scrollWidth,
  }));
  expect(narrowGeometry.bodyWidth).toBeLessThanOrEqual(narrowGeometry.viewportWidth);
  expect(narrowGeometry.tabScrollWidth).toBeLessThanOrEqual(narrowGeometry.tabClientWidth);
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
  await expect(page.getByRole('radiogroup', { name: 'Invitation role' })).toBeHidden();
  await page.getByPlaceholder('name@company.com').fill('tom@smalldocs.org');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.locator('#invite-status')).toHaveText('Invitation sent to tom@smalldocs.org.');
  expect(calls.some(call => call.method === 'GET'
    && call.path === '/api/cloud/v1/account/invitations')).toBe(false);
  const inviteCall = calls.find(call => call.method === 'POST'
    && call.path === '/api/cloud/v1/account/invitations');
  expect(inviteCall.body.role).toBe('member');
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
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.locator('#page-error')).toBeHidden();
  await page.getByRole('button', { name: 'Billing' }).click();
  await expect(page.getByRole('link', { name: 'Subscribe' })).toBeVisible();
  await page.getByRole('button', { name: 'People' }).click();
  await expect(page.getByRole('button', { name: 'Invite person' })).toBeHidden();
  expect(calls.some(call => call.path.includes('/projects'))).toBe(false);
});
