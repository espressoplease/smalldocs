const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const CHECKOUT_PAGE = '/public/cloud-checkout.html';

async function mockCheckout(page, options) {
  const calls = [];
  let checkoutAttempts = 0;
  const workspaces = options && options.workspaces ? options.workspaces : [];

  await page.route('**/api/cloud/v1/workspaces', async route => {
    const request = route.request();
    if (request.method() === 'GET') {
      calls.push({ method: 'GET', path: '/api/cloud/v1/workspaces' });
      const hasNoName = options && options.hasNoName;
      return route.fulfill({ json: { ok: true, workspaces,
        user: { id: 'user-1', first_name: hasNoName ? null : 'Josh',
          last_name: hasNoName ? null : 'Summers' } } });
    }
    const body = request.postDataJSON();
    calls.push({ method: 'POST', path: '/api/cloud/v1/workspaces', body });
    return route.fulfill({ status: 201, json: { ok: true,
      workspace: { workspaceId: body.kind === 'team' ? 'team-1' : 'personal-1',
        projectId: 'project-1' } } });
  });

  await page.route('**/api/cloud/v1/me', async route => {
    const body = route.request().postDataJSON();
    calls.push({ method: 'PATCH', path: '/api/cloud/v1/me', body });
    return route.fulfill({ json: { ok: true,
      user: { id: 'user-1', first_name: body.first_name, last_name: body.last_name } } });
  });

  await page.route('**/api/cloud/billing/checkout', async route => {
    checkoutAttempts += 1;
    const body = route.request().postDataJSON();
    calls.push({ method: 'POST', path: '/api/cloud/billing/checkout', body });
    if (options && options.failFirstCheckout && checkoutAttempts === 1) {
      return route.fulfill({ status: 503, json: { ok: false, error: 'provider_unavailable' } });
    }
    return route.fulfill({ json: { ok: true, checkout_url: '/stripe-test/session' } });
  });

  await page.route('**/stripe-test/session', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Stripe test handoff</title><h1>Stripe test handoff</h1>',
  }));
  return calls;
}

test('chooses a personal account and preserves the document return path', async ({ page }) => {
  const calls = await mockCheckout(page);
  await page.goto(CHECKOUT_PAGE + '?return=%2Fdocs%3Fcloud-document%3Ddocument-1');

  await expect(page.getByRole('heading', { name: 'Who is Cloud for?' })).toBeVisible();
  await page.getByRole('button', { name: /Just me/ }).click();
  await expect(page.getByRole('heading', { name: 'Set up Cloud' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'First name' })).toHaveValue('Josh');
  await expect(page.getByRole('textbox', { name: 'Last name' })).toHaveValue('Summers');

  const back = page.getByRole('button', { name: 'Back to account choice' });
  const detail = page.locator('#checkout-detail');
  expect(await back.evaluate((element, selected) => element.parentElement === selected.parentElement,
    await detail.elementHandle())).toBe(true);
  expect(await back.evaluate(element => element.contains(document.querySelector('#checkout-detail')))).toBe(false);
  const backBox = await back.boundingBox();
  const detailBox = await detail.boundingBox();
  expect(backBox.y + backBox.height).toBeLessThanOrEqual(detailBox.y);

  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(page.getByRole('heading', { name: 'Stripe test handoff' })).toBeVisible();
  expect(calls.find(call => call.path === '/api/cloud/billing/checkout').body).toEqual({
    workspace_id: 'personal-1',
    plan: 'personal',
    return_to: '/docs?cloud-document=document-1',
  });
  expect(calls.find(call => call.path === '/api/cloud/v1/me').body)
    .toEqual({ first_name: 'Josh', last_name: 'Summers' });
  expect(calls.find(call => call.method === 'POST' && call.path === '/api/cloud/v1/workspaces').body)
    .toEqual({ kind: 'personal', name: 'Josh Summers', project_name: 'Documents' });
});

test('requires both first and last name', async ({ page }) => {
  await mockCheckout(page, { hasNoName: true });
  await page.goto(CHECKOUT_PAGE);
  await page.getByRole('button', { name: /Just me/ }).click();

  const continueButton = page.getByRole('button', { name: 'Continue to payment' });
  await expect(continueButton).toBeDisabled();
  await page.getByRole('textbox', { name: 'First name' }).fill('Ada');
  await expect(continueButton).toBeDisabled();
  await page.getByRole('textbox', { name: 'Last name' }).fill('Lovelace');
  await expect(continueButton).toBeEnabled();
});

test('creates a team before opening its checkout', async ({ page }) => {
  const calls = await mockCheckout(page);
  await page.goto(CHECKOUT_PAGE + '?return=%2Fdocs');
  await page.getByRole('button', { name: /My team/ }).click();

  const continueButton = page.getByRole('button', { name: 'Continue to payment' });
  await expect(continueButton).toBeDisabled();
  await page.getByRole('textbox', { name: 'Team name' }).fill('Acme Engineering');
  await expect(page.locator('#checkout-team-note'))
    .toHaveText('Used in Cloud settings and invitations.');
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  await expect(page.getByRole('heading', { name: 'Stripe test handoff' })).toBeVisible();
  expect(calls.find(call => call.method === 'POST' && call.path === '/api/cloud/v1/workspaces').body)
    .toEqual({ kind: 'team', name: 'Acme Engineering', project_name: 'Documents' });
  expect(calls.find(call => call.path === '/api/cloud/billing/checkout').body).toEqual({
    workspace_id: 'team-1', plan: 'team', return_to: '/docs',
  });
});

test('supports visible and browser Back navigation between the two steps', async ({ page }) => {
  await mockCheckout(page);
  await page.goto(CHECKOUT_PAGE);

  await page.getByRole('button', { name: /Just me/ }).click();
  await page.getByRole('button', { name: 'Back to account choice' }).click();
  await expect(page.getByRole('heading', { name: 'Who is Cloud for?' })).toBeVisible();

  await page.getByRole('button', { name: /My team/ }).click();
  await expect(page.getByRole('heading', { name: 'Set up Cloud' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Who is Cloud for?' })).toBeVisible();
});

test('reports a checkout failure and permits a successful retry', async ({ page }) => {
  const calls = await mockCheckout(page, { failFirstCheckout: true });
  await page.goto(CHECKOUT_PAGE);
  await page.getByRole('button', { name: /Just me/ }).click();

  const continueButton = page.getByRole('button', { name: 'Continue to payment' });
  await continueButton.click();
  await expect(page.getByRole('status')).toHaveText('Payment could not be opened. Try again.');
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  await expect(page.getByRole('heading', { name: 'Stripe test handoff' })).toBeVisible();
  expect(calls.filter(call => call.path === '/api/cloud/billing/checkout')).toHaveLength(2);
});

test('keeps the chooser and selected state usable on a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCheckout(page);
  await page.goto(CHECKOUT_PAGE);

  await expect(page.getByRole('button', { name: /Just me/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /My team/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.getByRole('button', { name: /Just me/ }).click();
  const backBox = await page.getByRole('button', { name: 'Back to account choice' }).boundingBox();
  const detailBox = await page.locator('#checkout-detail').boundingBox();
  expect(backBox.y + backBox.height).toBeLessThanOrEqual(detailBox.y);
  expect(detailBox.x).toBeGreaterThanOrEqual(0);
  expect(detailBox.x + detailBox.width).toBeLessThanOrEqual(390);
});
