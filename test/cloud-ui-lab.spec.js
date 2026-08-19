const { test, expect } = require('@playwright/test');

async function openPrototype(page) {
  await page.goto('/docs?cloud-ui-prototype=1');
  await page.addStyleTag({ url: '/public/css/cloud-ui-lab.css' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-ui-lab.js' });
  await expect(page.locator('.fic-row-cloud-lab')).toBeVisible();
}

test('Cloud UI lab changes access without contacting Cloud APIs', async ({ page }) => {
  const cloudRequests = [];
  page.on('request', request => {
    if (request.url().includes('/api/cloud/')) cloudRequests.push(request.url());
  });
  await openPrototype(page);

  const access = page.locator('.sdoc-cloud-lab-access');
  await expect(access).toContainText('You, TS, LT, DS');
  await access.click();
  await expect(page.locator('#_sd_cloud-lab-panel')).toBeVisible();
  await expect(page.getByText('Tom Smith', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Only you' }).click();
  await expect(access).toContainText('Only you');

  await page.getByRole('button', { name: 'Everyone' }).click();
  await expect(access).toContainText('You, TS, LT, DS, +1');
  expect(cloudRequests).toEqual([]);
});

test('Cloud UI lab edits prototype tags and saved state', async ({ page }) => {
  await openPrototype(page);
  await page.getByRole('button', { name: 'Edit Cloud tags' }).click();
  await expect(page.getByText('Current Cloud tags')).toBeVisible();

  await page.getByRole('textbox', { name: 'New Cloud tag' }).fill('release');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.fic-row-cloud-lab')).toContainText('#release');

  await page.getByRole('button', { name: 'In Cloud' }).click();
  await expect(page.locator('.sdoc-cloud-lab-save')).toContainText('Saved');
});

test('Cloud UI lab panel becomes a mobile bottom sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPrototype(page);
  await page.locator('.sdoc-cloud-lab-access').click();

  const panel = page.locator('#_sd_cloud-lab-panel');
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.width)).toBe(390);
  expect(Math.round(box.y + box.height)).toBe(844);
});

test('Cloud UI lab remains active after a refresh', async ({ page }) => {
  await openPrototype(page);
  await expect.poll(() => page.url()).toContain('cloud-ui-prototype=1');
  await page.reload();
  await page.addStyleTag({ url: '/public/css/cloud-ui-lab.css' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-ui-lab.js' });
  await expect(page.locator('.fic-row-cloud-lab')).toBeVisible();
});
