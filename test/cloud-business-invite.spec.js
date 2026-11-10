const { test, expect } = require('@playwright/test');
const { createInviteLink } = require('../ops/create-business-invite-link');

test.use({ serviceWorkers: 'block' });

function invitePath(fields) {
  const url = new URL(createInviteLink(Object.assign({
    origin: 'http://localhost:3000',
    name: 'Dexter',
    first_name: 'Dexter',
    last_name: 'Horthy',
    email: 'dexter@humanlayer.dev',
    company: 'HumanLayer',
    inviter: 'Joshua',
  }, fields)));
  url.pathname = '/public/cloud-business-invite.html';
  return url.pathname + url.search + url.hash;
}

test('ordinary visitors see a blank generic invitation', async ({ page }) => {
  await page.goto('/public/cloud-business-invite.html?preview=signin');

  await expect(page.getByRole('heading', { name: 'Welcome to SmallDocs' })).toBeVisible();
  await expect(page.getByLabel('Email address')).toHaveValue('');
  await expect(page.locator('#nav-label')).toHaveText('Invitation');
});

test('encrypted fragment personalizes the narrow invitation without exposing details in the request', async ({ page }) => {
  const previewUrl = invitePath({ preview: 'signin' });
  await page.goto(previewUrl);

  await expect(page.getByRole('heading', { name: 'Welcome to SmallDocs, Dexter' })).toBeVisible();
  await expect(page.getByText('Joshua invited you to try SmallDocs with HumanLayer')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Accept your invitation' })).toBeVisible();
  await expect(page.getByLabel('Email address')).toHaveValue('dexter@humanlayer.dev');
  await expect(page.locator('#invite-accept')).toBeHidden();
  await expect(page.locator('.preview-note')).toContainText('does not create an account');
  await expect(page.getByRole('heading', { name: 'To get started:' })).toBeVisible();
  await expect(page.locator('.overview-number')).toHaveText(['1', '2', '3', '4', '5', '6']);
  expect(new URL(page.url()).search).not.toContain('Dexter');
  expect(new URL(page.url()).search).not.toContain('humanlayer');

  const measurements = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    widths: ['.invite-intro', '.business-auth-card', '.invite-overview'].map(selector =>
      Math.round(document.querySelector(selector).getBoundingClientRect().width)),
    openSections: Array.from(document.querySelectorAll('.invite-overview > details'))
      .filter(section => section.open).length,
    detailBorder: getComputedStyle(document.querySelector('.invite-overview details')).borderTopWidth,
    authBorder: getComputedStyle(document.querySelector('.business-auth-card')).borderTopWidth,
  }));
  expect(measurements.overflow).toBe(false);
  expect(new Set(measurements.widths).size).toBe(1);
  expect(measurements.openSections).toBe(0);
  expect(measurements.detailBorder).toBe('0px');
  expect(measurements.authBorder).toBe('1px');

  await page.getByText('Two ways to use SmallDocs', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Build SmallDocs into HumanLayer' })).toBeVisible();
  await expect(page.locator('.value-icon')).toHaveCount(0);
  await page.getByText('Install SmallDocs Cloud', { exact: true }).click();
  await expect(page.locator('.install-command')).toHaveCount(3);
  await expect(page.locator('#install-prompt')).toContainText('use SmallDocs Cloud as the default');
  await expect(page.locator('#install-prompt')).toContainText('sdoc FILE.md');
  await expect(page.locator('#cloud-setup-command')).toHaveText('sdoc setup --cloud --yes');
  await page.getByText('Open a few SmallDocs', { exact: true }).click();
  const exampleLinks = page.locator('.example-link');
  await expect(exampleLinks).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expect(exampleLinks.nth(index)).toHaveAttribute('href', /^https:\/\/smalldocs\.org\/docs#md=/);
  }
  const expandedWidths = await page.evaluate(() => ({
    install: [document.querySelector('#install-details .overview-body'),
      document.querySelector('.install-commands')].map(node => Math.round(node.getBoundingClientRect().width)),
    ways: [document.querySelector('#ways-details .overview-body'),
      document.querySelector('.value-paths')].map(node => Math.round(node.getBoundingClientRect().width)),
    examples: [document.querySelector('#examples-details .overview-body'),
      document.querySelector('.example-links')].map(node => Math.round(node.getBoundingClientRect().width)),
  }));
  expect(expandedWidths.install[1]).toBe(expandedWidths.ways[1]);
  expect(expandedWidths.ways[1]).toBe(expandedWidths.examples[1]);
  expect(expandedWidths.install[1]).toBeLessThan(expandedWidths.install[0]);
  expect(expandedWidths.install[0] - expandedWidths.install[1]).toBe(24);
});

test('email code, Terms, profile, and invitation completion stay on one page', async ({ page }) => {
  let termsAccepted = false;
  let signedIn = false;
  let submittedEmail;
  let submittedProfile;

  await page.route('**/api/cloud/auth/email/request', async route => {
    submittedEmail = route.request().postDataJSON();
    await route.fulfill({ status: 202, json: {
      ok: true,
      challenge_id: 'challenge-business',
      expires_at: '2026-09-08T12:10:00.000Z',
    } });
  });
  await page.route('**/api/cloud/auth/email/verify', async route => {
    signedIn = true;
    await route.fulfill({ status: 200, json: {
      ok: true,
      return_to: '/public/cloud-business-invite.html?token=invite-token',
    } });
  });
  await page.route('**/api/cloud/auth/terms/accept', async route => {
    termsAccepted = true;
    await route.fulfill({ status: 200, json: {
      ok: true,
      return_to: '/public/cloud-business-invite.html?token=invite-token',
    } });
  });
  await page.route('**/api/cloud/v1/me', async route => {
    if (route.request().method() === 'PATCH') {
      submittedProfile = route.request().postDataJSON();
      await route.fulfill({ status: 200, json: { ok: true } });
      return;
    }
    if (!signedIn) {
      await route.fulfill({ status: 401, json: { ok: false, error: 'login_required' } });
      return;
    }
    if (!termsAccepted) {
      await route.fulfill({ status: 403, json: { ok: false, error: 'terms_acceptance_required' } });
      return;
    }
    await route.fulfill({ status: 200, json: { user: { email: 'dexter@humanlayer.dev' } } });
  });
  await page.route('**/api/cloud/v1/invitations/invite-token/accept', async route => {
    await route.fulfill({ status: 200, json: { ok: true, workspace_id: 'workspace-humanlayer' } });
  });

  const fullUrl = invitePath({ token: 'invite-token' });
  await page.goto(fullUrl);
  const initialUrl = page.url();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByRole('heading', { name: 'Enter the code from your email' })).toBeVisible();
  expect(submittedEmail).toEqual({
    email: 'dexter@humanlayer.dev',
    return_to: '/public/cloud-business-invite.html?token=invite-token',
  });

  await page.getByLabel('Six-digit code').fill('123456');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Review the Terms' })).toBeVisible();
  expect(page.url()).toBe(initialUrl);

  await page.getByLabel(/I agree to the Terms of Service/).check();
  await page.getByRole('button', { name: 'Agree and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Complete your profile' })).toBeVisible();
  await expect(page.getByLabel('First name')).toHaveValue('Dexter');
  await expect(page.getByLabel('Last name')).toHaveValue('Horthy');
  expect(page.url()).toBe(initialUrl);

  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page.getByRole('heading', { name: 'Your workspace is ready' })).toBeVisible();
  await expect(page.locator('#install-details')).toHaveAttribute('open', '');
  await expect(page.getByRole('link', { name: 'Open Cloud Library' }))
    .toHaveAttribute('href', '/library?scope=cloud&workspace=workspace-humanlayer');
  await expect(page.locator('#cloud-setup-command')).toHaveText(
    'sdoc setup --cloud --account workspace-humanlayer --yes');
  await expect(page.locator('#install-prompt')).toContainText(
    'sdoc setup --cloud --account workspace-humanlayer --yes');
  expect(submittedProfile).toEqual({ first_name: 'Dexter', last_name: 'Horthy' });
  expect(page.url()).toBe(initialUrl);
});

test('copy install prompt provides the cloud-first setup instructions', async ({ page }) => {
  await page.addInitScript(() => {
    window.__copiedText = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async value => { window.__copiedText = value; } },
    });
  });
  await page.goto(invitePath({ preview: 'signin' }));
  await page.getByText('Install SmallDocs Cloud', { exact: true }).click();
  await page.getByRole('button', { name: 'Copy install prompt' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await page.evaluate(() => window.__copiedText);
  expect(copied).toContain('sdoc cloud login');
  expect(copied).toContain('sdoc setup --cloud --yes');
  expect(copied).toContain('use SmallDocs Cloud as the default');
});

test('Business invitation remains narrow without mobile overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(invitePath({ preview: 'signin' }));
  await page.getByText('How agents create and update sdocs', { exact: true }).click();

  const result = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    widths: ['.invite-intro', '.business-auth-card', '.invite-overview'].map(selector =>
      Math.round(document.querySelector(selector).getBoundingClientRect().width)),
  }));
  expect(result.overflow).toBe(false);
  expect(new Set(result.widths).size).toBe(1);
});
