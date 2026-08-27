const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test.use({ serviceWorkers: 'block' });

test('requires an explicit Terms choice and keeps the Privacy Notice separate', async ({ page }) => {
  let submitted = null;
  await page.route('**/public/cloud-terms.html*', route => route.fulfill({
    contentType: 'text/html',
    body: fs.readFileSync(path.join(__dirname, '..', 'public', 'cloud-terms.html'), 'utf8'),
  }));
  await page.route('**/public/cloud-terms.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: fs.readFileSync(path.join(__dirname, '..', 'public', 'cloud-terms.js'), 'utf8'),
  }));
  await page.route('**/api/cloud/auth/terms/accept', async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, return_to: '/cloud/admin' } });
  });
  await page.route('**/cloud/admin', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Cloud settings</title><h1>Cloud settings</h1>',
  }));

  await page.goto('/public/cloud-terms.html?return=%2Fcloud%2Fadmin');
  const choice = page.getByLabel('I agree to the Terms of Service.');
  const submit = page.getByRole('button', { name: 'Agree and continue' });
  await expect(choice).not.toBeChecked();
  await expect(submit).toBeDisabled();
  await expect(page.locator('.terms-privacy')).toContainText(
    'The Privacy Notice explains how SmallDocs handles personal data.');
  await expect(page.locator('.terms-privacy input')).toHaveCount(0);

  await choice.check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(/\/cloud\/admin$/);
  expect(submitted).toEqual({
    accepted: true,
    terms_version: '__CLOUD_TERMS_VERSION__',
    return_to: '/cloud/admin',
  });
});
