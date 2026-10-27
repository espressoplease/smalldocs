const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });

test('targeted Cloud edits update the open reader on focus and on the normal revision timer', async ({ page }) => {
  test.setTimeout(35000);
  const f = await startFixture({ singlePlan: true });
  try {
    const account = (await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {})).data.workspaces[0].id;
    const created = await f.api('josh', '/api/cloud/v1/account/documents', 'POST', {
      account_id: account, filename: 'service.md', markdown: '# Service\n\n## Limits\nRetry window: 10 minutes.\n', idempotency_key: 'browser-edit' });
    expect(created.status).toBe(201);
    const doc = created.data.document;
    await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.josh.sessionToken, url: f.origin }]);
    await page.goto(f.origin + '/docs?cloud-document=' + doc.id);
    await expect(page.locator('#_sd_rendered')).toContainText('Retry window: 10 minutes.');
    await page.waitForFunction(() => typeof window.SDocs.checkCloudNow === 'function');
    const navigation = await page.evaluate(() => {
      window.__editReaderSentinel = 'same-page';
      return performance.timeOrigin;
    });
    async function edit(base, before, after, key) {
      const result = await f.api('josh', '/api/cloud/v1/documents/' + doc.id + '/edits', 'POST', {
        base_revision_id: base, edits: [{ old_text: before, new_text: after, section: 'Limits' }], idempotency_key: key });
      expect(result.status).toBe(201);
      return result.data.document.revision_id;
    }
    const first = await edit(doc.current_revision_id, '10 minutes', '25 minutes', 'browser-edit-1');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('#_sd_rendered')).toContainText('Retry window: 25 minutes.');
    const second = await edit(first, '25 minutes', '40 minutes', 'browser-edit-2');
    await expect(page.locator('#_sd_rendered')).toContainText('Retry window: 40 minutes.', { timeout: 15000 });
    expect(await page.evaluate(() => window.SDocs.cloudDocument.current_revision_id)).toBe(second);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(navigation);
    expect(await page.evaluate(() => window.__editReaderSentinel)).toBe('same-page');
    expect(page.url()).toBe(f.origin + '/docs?cloud-document=' + doc.id);
  } finally { await f.close(); }
});
