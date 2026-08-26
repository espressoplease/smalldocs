const { test, expect } = require('@playwright/test');

async function expectPlan(page, plan, primary, alternatives) {
  const card = page.locator('[data-cloud-plan="' + plan + '"]').first();
  await expect(card.locator('[data-cloud-price-primary]')).toHaveText(primary);
  if (alternatives) {
    await expect(card.locator('[data-cloud-price-alternatives]')).toHaveText(alternatives);
  }
}

test.describe('UK Cloud pricing', () => {
  test.use({ serviceWorkers: 'block', locale: 'en-GB' });

  test('shows GBP first and the other currencies underneath', async ({ page }) => {
    await page.goto('/public/cloud.html');
    await expectPlan(page, 'personal', '£4', '$5 USD or €5 EUR');
    await expectPlan(page, 'team', '£7', '$9 USD or €8 EUR');
  });
});

test.describe('US Cloud pricing', () => {
  test.use({ serviceWorkers: 'block', locale: 'en-US' });

  test('shows USD consistently across the Cloud page, Library, and checkout', async ({ page }) => {
    await page.goto('/public/cloud.html');
    await expectPlan(page, 'personal', '$5', '£4 GBP or €5 EUR');
    await expectPlan(page, 'team', '$9', '£7 GBP or €8 EUR');

    await page.goto('/public/library/library.html?scope=cloud');
    await expectPlan(page, 'personal', '$5', '£4 GBP or €5 EUR');

    await page.route('**/api/cloud/v1/workspaces', route => route.fulfill({ json: {
      ok: true,
      workspaces: [],
      user: { id: 'user-1', first_name: 'Test', last_name: 'User' },
    } }));
    await page.goto('/public/cloud-checkout.html');
    await expectPlan(page, 'personal', '$5');
    await page.getByRole('button', { name: /Just me/ }).click();
    await expect(page.locator('#checkout-plan-note')).toContainText('$5 each month.');
  });
});

test.describe('euro Cloud pricing', () => {
  test.use({ serviceWorkers: 'block', locale: 'de-DE' });

  test('shows EUR first and the other currencies underneath', async ({ page }) => {
    await page.goto('/public/cloud.html');
    await expectPlan(page, 'personal', '€5', '£4 GBP or $5 USD');
    await expectPlan(page, 'team', '€8', '£7 GBP or $9 USD');
  });
});
