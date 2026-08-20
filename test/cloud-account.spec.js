const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

async function installAccountApi(page, credentials) {
  const calls = [];
  await page.route('**/api/cloud/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push({ method: request.method(), path });
    if (path === '/api/cloud/v1/workspaces/deleted') {
      return route.fulfill({ json: { ok: true, workspaces: [] } });
    }
    if (path === '/api/cloud/v1/documents/deleted') {
      return route.fulfill({ json: { ok: true, documents: [] } });
    }
    if (path === '/api/cloud/v1/cli/credentials' && request.method() === 'GET') {
      return route.fulfill({ json: { ok: true, credentials } });
    }
    if (/\/api\/cloud\/v1\/cli\/credentials\/[^/]+$/.test(path)
      && request.method() === 'DELETE') {
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: { ok: false, error: 'resource_unavailable' } });
  });
  return calls;
}

test('account settings list and revoke only the signed-in user machines', async ({ page }) => {
  const calls = await installAccountApi(page, [
    {
      id: 'cli-1', displayName: 'build-server', createdAtMs: Date.UTC(2026, 7, 20, 9),
      lastUsedAtMs: Date.UTC(2026, 7, 20, 10), revokedAtMs: null,
    },
    {
      id: 'cli-old', displayName: 'old-machine', createdAtMs: Date.UTC(2026, 7, 1),
      lastUsedAtMs: Date.UTC(2026, 7, 1), revokedAtMs: Date.UTC(2026, 7, 2),
    },
  ]);
  await page.goto('/public/cloud-account.html');

  await expect(page.getByRole('heading', { name: 'Your Cloud account' })).toBeVisible();
  await expect(page.getByText('Connected machines', { exact: true })).toBeVisible();
  await expect(page.getByText('build-server', { exact: true })).toBeVisible();
  await expect(page.getByText('old-machine', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/credential refreshed/)).toBeVisible();
  await page.getByRole('button', { name: 'Revoke build-server' }).click();
  await expect(page.getByText('build-server', { exact: true })).toHaveCount(0);
  await expect(page.getByText('No machines are connected.')).toBeVisible();
  expect(calls.some(call => call.method === 'DELETE'
    && call.path === '/api/cloud/v1/cli/credentials/cli-1')).toBe(true);
});

test('connected machines fit on a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installAccountApi(page, [
    {
      id: 'cli-1', displayName: 'remote-analysis-server-with-a-long-hostname',
      createdAtMs: Date.UTC(2026, 7, 20, 9), lastUsedAtMs: Date.UTC(2026, 7, 20, 10),
      revokedAtMs: null,
    },
  ]);
  await page.goto('/public/cloud-account.html');

  const cardBox = await page.locator('.cloud-account-card').boundingBox();
  const rowBox = await page.locator('.connected-machine-row').boundingBox();
  expect(cardBox.x).toBeGreaterThanOrEqual(0);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(390);
  expect(rowBox.x).toBeGreaterThanOrEqual(cardBox.x);
  expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
});
