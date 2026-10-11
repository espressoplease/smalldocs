const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

async function openTags(page) {
  const account = { id: 'acct-1', kind: 'personal', name: 'Personal', can_write: true };
  await page.route('**/api/cloud/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    let data = {};
    if (path.endsWith('/workspaces')) data = { workspaces: [account] };
    else if (path.endsWith('/account')) data = { account, accounts: [account], user: { id: 'usr-1' } };
    else if (path.endsWith('/account/tags')) data = { tags: [
      { tag: 'new-fridge', count: 7 }, { tag: 'fridge', count: 4 }, { tag: 'fringe', count: 2 },
      ...Array.from({ length: 40 }, (_, i) => ({ tag: 'sample-' + i, count: 1 })),
    ] };
    else if (path.endsWith('/account/members')) data = { members: [] };
    else if (path.endsWith('/documents/doc-1')) data = {
      document: { id: 'doc-1', workspace_id: account.id, filename: 'tags.md', tags: ['september'],
        markdown: '---\ntags:\n  - september\n---\n# Tags\n', current_revision_id: 'rev-1' },
      permission: { mode: 'custom', member_user_ids: [], can_manage: true },
    };
    return route.fulfill({ json: { ok: true, ...data } });
  });
  await page.goto('/docs');
  await page.addStyleTag({ url: '/public/css/cloud-ui-lab.css' });
  await page.evaluate(() => {
    window.SDocs.Sources._reset();
    history.replaceState(null, '', '/docs?cloud-document=doc-1');
  });
  await page.addScriptTag({ url: '/public/sdocs-cloud-account-selection.js' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-prototype.js' });
  await page.evaluate(() => window.SDocs.Sources.select().load());
  await page.getByRole('button', { name: 'Edit Cloud tags', exact: true }).click();
}

for (const width of [390, 600]) {
  test('mobile Tags sheet holds its input position while filtering at width ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openTags(page);
    const panel = page.locator('#_sd_cloud-lab-panel');
    const input = page.getByRole('textbox', { name: 'New Cloud tag' });
    await expect.poll(async () => Math.round((await panel.boundingBox()).height)).toBe(709);
    const panelBefore = await panel.boundingBox();
    const inputBefore = await input.boundingBox();
    const suggestions = page.locator('.sdoc-cloud-lab-suggestions');
    await expect.poll(() => suggestions.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await suggestions.evaluate(el => { el.scrollTop = el.scrollHeight; });
    expect((await input.boundingBox()).y).toBeCloseTo(inputBefore.y, 0);
    for (const query of ['f', 'fri', 'no-matches', '']) {
      await input.fill(query);
      await expect(input).toBeFocused();
      expect((await panel.boundingBox()).height).toBeCloseTo(panelBefore.height, 0);
      expect((await input.boundingBox()).y).toBeCloseTo(inputBefore.y, 0);
    }
    await expect(page.locator('[data-cloud-add-tag]')).toHaveCount(43);
    await page.getByRole('button', { name: 'Close Cloud panel' }).click();
    await expect.poll(async () => Math.round((await panel.boundingBox()).height)).toBe(0);
  });
}

test('mobile Tags sheet fits above the keyboard when the visible viewport shrinks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTags(page);
  const panel = page.locator('#_sd_cloud-lab-panel');
  await expect.poll(async () => Math.round((await panel.boundingBox()).height)).toBe(709);
  // Desktop headless browsers have no software keyboard. Simulate its viewport geometry.
  await page.evaluate(() => {
    Object.defineProperty(window, 'visualViewport', { configurable: true,
      value: { height: 390, offsetTop: 0 } });
    window.dispatchEvent(new Event('resize'));
  });
  await expect.poll(async () => Math.round((await panel.boundingBox()).height)).toBe(390);
  const bounds = await panel.boundingBox();
  expect(bounds.y).toBeCloseTo(0, 0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(391);
  const input = page.getByRole('textbox', { name: 'New Cloud tag' });
  const inputBefore = await input.boundingBox();
  expect(inputBefore.y).toBeGreaterThanOrEqual(0);
  expect(inputBefore.y + inputBefore.height).toBeLessThan(390);
  await input.fill('fri');
  expect((await input.boundingBox()).y).toBeCloseTo(inputBefore.y, 0);
});
