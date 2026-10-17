const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const INVITE_PAGE = '/public/cloud-invite.html';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/cloud/v1/invitations/*', route => {
    const token = new URL(route.request().url()).pathname.split('/').pop();
    if (token === 'wrong-email') return route.fulfill({ status: 403, json: { error: 'permission_denied' } });
    if (token === 'unavailable') return route.fulfill({ status: 404, json: { error: 'resource_unavailable' } });
    return route.fulfill({ json: { ok: true, invitation: { workspace_id: 'team-1', workspace_name: 'Engineering', role: 'member', accepted: false } } });
  });
});

async function routeExistingProfile(page) {
  await page.route('**/api/cloud/v1/me', async route => {
    if (route.request().method() === 'PATCH') {
      return route.fulfill({ json: { ok: true, user: route.request().postDataJSON() } });
    }
    return route.fulfill({ json: { ok: true,
      user: { id: 'usr-2', first_name: 'Tom', last_name: 'Oakley' } } });
  });
}

test('collects both names, accepts an invitation, and opens the invited team Install tab', async ({ page }) => {
  const requests = [];
  await page.route('**/api/cloud/v1/me', async route => {
    const request = route.request();
    requests.push({ method: request.method(), path: '/me',
      body: request.method() === 'PATCH' ? request.postDataJSON() : null });
    if (request.method() === 'PATCH') {
      return route.fulfill({ json: { ok: true, user: request.postDataJSON() } });
    }
    return route.fulfill({ json: { ok: true,
      user: { id: 'usr-2', first_name: null, last_name: null } } });
  });
  await page.route('**/api/cloud/v1/invitations/invite-token/accept', async route => {
    requests.push({ method: route.request().method(), path: '/accept',
      body: route.request().postDataJSON() });
    await route.fulfill({ json: { ok: true, workspace_id: 'team-1', role: 'member' } });
  });
  await page.route('**/cloud/admin?panel=install&workspace_id=team-1', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Install</title><h1>Install SmallDocs</h1>',
  }));

  await page.goto(INVITE_PAGE + '?token=invite-token');
  const button = page.getByRole('button', { name: 'Accept invitation' });
  await expect(button).toBeDisabled();
  await page.getByLabel('First name').fill('Tom');
  await page.getByLabel('Last name').fill('Oakley');
  await expect(button).toBeEnabled();
  await page.getByRole('button', { name: 'Accept invitation' }).click();

  await expect(page).toHaveURL(/\/cloud\/admin\?panel=install&workspace_id=team-1$/);
  await expect(page.getByRole('heading', { name: 'Install SmallDocs' })).toBeVisible();
  expect(requests).toEqual([
    { method: 'GET', path: '/me', body: null },
    { method: 'PATCH', path: '/me', body: { first_name: 'Tom', last_name: 'Oakley' } },
    { method: 'POST', path: '/accept', body: {} },
  ]);
});

test('explains when the signed-in email does not match the invitation', async ({ page }) => {
  await routeExistingProfile(page);
  await page.route('**/api/cloud/v1/invitations/wrong-email/accept', route => route.fulfill({
    status: 403, json: { ok: false, error: 'permission_denied' },
  }));

  await page.goto(INVITE_PAGE + '?token=wrong-email');
  const button = page.getByRole('button', { name: 'Accept invitation' });
  await expect(page.getByRole('status')).toHaveText(
    'Sign in with the email address this invitation was sent to.');
  await expect(button).toBeDisabled();
});

test('explains when an invitation is expired, revoked, or already used', async ({ page }) => {
  await routeExistingProfile(page);
  await page.route('**/api/cloud/v1/invitations/unavailable/accept', route => route.fulfill({
    status: 404, json: { ok: false, error: 'resource_unavailable' },
  }));

  await page.goto(INVITE_PAGE + '?token=unavailable');
  const button = page.getByRole('button', { name: 'Accept invitation' });

  await expect(page.getByRole('status')).toHaveText('This invitation is no longer available.');
  await expect(button).toBeDisabled();
});

test('explains when the server still requires a complete profile', async ({ page }) => {
  await routeExistingProfile(page);
  await page.route('**/api/cloud/v1/invitations/profile-required/accept', route => route.fulfill({
    status: 409, json: { ok: false, error: 'profile_required' },
  }));

  await page.goto(INVITE_PAGE + '?token=profile-required');
  const button = page.getByRole('button', { name: 'Accept invitation' });
  await expect(button).toBeEnabled();
  await button.click();

  await expect(page.getByRole('status')).toHaveText('Enter your first and last name.');
  await expect(button).toBeEnabled();
});

test('disables acceptance when the invitation token is missing', async ({ page }) => {
  await page.goto(INVITE_PAGE);

  await expect(page.getByRole('button', { name: 'Accept invitation' })).toBeDisabled();
  await expect(page.getByRole('status')).toHaveText('This invitation link is incomplete.');
});
