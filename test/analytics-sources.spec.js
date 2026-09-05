const { test, expect } = require('@playwright/test');

test('short-link sources can filter and group targeted placements', async ({ page }) => {
  await page.route('**/analytics/sources/data?type=short', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        weeks: ['2026-W36', '2026-W37'],
        sourceCampaigns: [],
        targetedPlacements: [
          {
            placementId: 'Reply_07', shortLinkId: 'Short_01', source: 'x', total: 3,
            firstSeen: '2026-09-01 10:00:00', lastSeen: '2026-09-03 12:00:00',
            visits: { '2026-W36': 2, '2026-W37': 1 }
          },
          {
            placementId: 'Video_01', shortLinkId: 'Short_01', source: 'yt', total: 2,
            firstSeen: '2026-09-02 10:00:00', lastSeen: '2026-09-04 12:00:00',
            visits: { '2026-W37': 2 }
          }
        ]
      })
    });
  });

  await page.goto('/analytics/sources?type=short');
  await expect(page.getByRole('heading', { name: 'Targeted placements' })).toBeVisible();
  await expect(page.getByText('5 targeted visits')).toBeVisible();
  await expect(page.getByText('2 placements')).toBeVisible();
  await expect(page.locator('#placement-results')).toContainText('Reply_07');
  await expect(page.locator('#placement-results')).toContainText('Video_01');

  await page.locator('#placement-source').selectOption('x');
  await expect(page.locator('#placement-results')).toContainText('Reply_07');
  await expect(page.locator('#placement-results')).not.toContainText('Video_01');

  await page.locator('#placement-source').selectOption('');
  await page.locator('#placement-group').selectOption('short');
  await expect(page.locator('#placement-results tbody tr')).toHaveCount(1);
  await expect(page.locator('#placement-results')).toContainText('/s/Short_01');
  await expect(page.locator('#placement-results')).toContainText('5');

  await page.locator('#placement-search').fill('video');
  await expect(page.locator('#placement-results')).toContainText('Short_01');
  await expect(page.locator('#placement-results')).toContainText('2');
});

test('untagged short-link visits do not create placement rows', async ({ page }) => {
  await page.route('**/analytics/sources/data?type=short', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        weeks: ['2026-W36'],
        sourceCampaigns: [{ source: 'x', total: 4, visits: { '2026-W36': 4 } }],
        targetedPlacements: []
      })
    });
  });
  await page.addInitScript(() => {
    window.Chart = function () {};
  });
  await page.goto('/analytics/sources?type=short');
  await expect(page.locator('#placement-results')).toHaveText('No targeted placement visits yet.');
  await expect(page.getByText('0 targeted visits')).toBeVisible();
});
