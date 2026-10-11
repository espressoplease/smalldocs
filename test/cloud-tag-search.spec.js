const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const tags = [
  { tag: 'september', count: 20 }, { tag: 'fringe', count: 2 },
  { tag: 'fridge', count: 4 }, { tag: 'new-fridge', count: 7 },
  { tag: 'october', count: 12 },
  ...Array.from({ length: 12 }, (_, i) => ({ tag: 'extra-' + i, count: 1 })),
];

async function openCloudLibrary(page) {
  await page.route('**/api/cloud/v1/**', route => {
    const url = new URL(route.request().url());
    let data;
    switch (url.pathname) {
      case '/api/cloud/v1/workspaces':
        data = { workspaces: [{ id: 'acct-1', name: 'Personal', kind: 'personal' }] }; break;
      case '/api/cloud/v1/me': data = { user: { email: 'reader@example.com' } }; break;
      case '/api/cloud/v1/account': data = { account: { id: 'acct-1', can_read: true } }; break;
      case '/api/cloud/v1/account/tags':
        expect(['acct-1', 'acct-2']).toContain(url.searchParams.get('account_id'));
        data = { tags: url.searchParams.get('account_id') === 'acct-2'
          ? [{ tag: 'friday', count: 9 }] : tags }; break;
      case '/api/cloud/v1/documents':
        data = { documents: [{ id: 'doc-1', title: 'Fridge notes', filename: 'fridge.md',
          tags: ['fridge'], updated_at: '2026-10-10T12:00:00Z' }] }; break;
      case '/api/cloud/v1/search': data = { documents: [] }; break;
      default: data = {};
    }
    return route.fulfill({ json: { ok: true, ...data } });
  });
  await page.goto('/public/library/library.html?scope=cloud');
  await page.evaluate(() => { document.body.dataset.cloudAuthenticated = 'true'; });
  await page.addStyleTag({ url: '/public/library/cloud-library-prototype.css' });
  await page.addScriptTag({ url: '/public/sdocs-cloud-account-selection.js' });
  await page.addScriptTag({ url: '/public/library/cloud-library-prototype.js' });
  await expect(page.locator('.res')).toHaveCount(1);
}

test('Cloud library opens tags while typing and keeps full-workspace counts after search', async ({ page }) => {
  await openCloudLibrary(page);
  const tagButton = page.locator('[data-facet="tag"]');
  const options = page.locator('.facet-option');
  await tagButton.click();
  await expect(options).toHaveCount(17);
  await tagButton.click();
  await expect(tagButton).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#q').fill('FRI');
  await expect(tagButton).toHaveAttribute('aria-expanded', 'true');
  await expect(options).toHaveCount(3);
  expect(await options.evaluateAll(items => items.map(item => item.dataset.value)))
    .toEqual(['new-fridge', 'fridge', 'fringe']);
  expect(await options.locator('mark').allTextContents()).toEqual(['fri', 'fri', 'fri']);
  const searchDone = page.waitForResponse('**/api/cloud/v1/search');
  await page.locator('#q').fill('fri');
  await searchDone;
  await expect(page.locator('.res')).toHaveCount(0);
  await expect(options).toHaveCount(3);
  expect(await options.locator('.count').allTextContents()).toEqual(['7', '4', '2']);
  await options.locator('.opt-label').first().click();
  await expect(page.locator('#chips-row')).toContainText('new-fridge');
  await page.locator('#q').fill('no-match');
  await expect(options).toHaveCount(0);
  await page.locator('#q').fill('');
  await expect(tagButton).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#facet-panel')).toHaveAttribute('aria-hidden', 'true');
  await tagButton.click();
  await expect(options).toHaveCount(17);
  await expect(options.locator('mark')).toHaveCount(0);
});

test('Cloud library typing preserves an already open facet', async ({ page }) => {
  await openCloudLibrary(page);
  const when = page.locator('[data-facet="since"]');
  await when.click();
  await page.locator('#q').fill('fri');
  await expect(when).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-facet="tag"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#facet-panel-title')).toHaveText('When');
  await page.locator('#q').fill('');
  await expect(when).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#q').fill('fri');
  await page.locator('[data-facet="tag"]').click();
  await expect(page.locator('.facet-option')).toHaveCount(3);
});


test('Cloud library replaces the tag inventory when the workspace changes', async ({ page }) => {
  await openCloudLibrary(page);
  await page.locator('#q').fill('fri');
  await expect(page.locator('.facet-option')).toHaveCount(3);
  await page.evaluate(() => {
    window.SDocsCloudLibrary.workspaceId = 'acct-2';
    window.dispatchEvent(new CustomEvent('sdocs-cloud-workspace-change'));
  });
  await expect(page.locator('#q')).toHaveValue('');
  await expect(page.locator('[data-facet="tag"]')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('[data-facet="tag"]').click();
  await expect(page.locator('.facet-option')).toHaveCount(1);
  await expect(page.locator('.facet-option')).toHaveAttribute('data-value', 'friday');
  await page.locator('#q').fill('fri');
  await expect(page.locator('.facet-option mark')).toHaveText('fri');
  await expect(page.locator('.facet-option .count')).toHaveText('9');
});


for (const clearWith of ['input', 'clear-all']) {
  for (const manuallyOpened of [false, true]) {
    test('Cloud library ' + clearWith + ' preserves only manually opened tags: ' + manuallyOpened,
      async ({ page }) => {
        await openCloudLibrary(page);
        const tags = page.locator('[data-facet="tag"]');
        if (manuallyOpened) await tags.click();
        await page.locator('#q').fill('fri');
        await expect(tags).toHaveAttribute('aria-expanded', 'true');
        if (clearWith === 'input') await page.locator('#q').fill('');
        else await page.locator('#clear').click();
        await expect(tags).toHaveAttribute('aria-expanded', String(manuallyOpened));
        await expect(page.locator('#facet-panel')).toHaveAttribute('aria-hidden', String(!manuallyOpened));
        if (manuallyOpened) await expect(page.locator('.facet-option')).toHaveCount(17);
      });
  }
}

test('manually reopening Tags during search keeps it open after clearing', async ({ page }) => {
  await openCloudLibrary(page);
  await page.locator('#q').fill('fri');
  const tags = page.locator('[data-facet="tag"]');
  await tags.click();
  await tags.click();
  await page.locator('#q').fill('');
  await expect(tags).toHaveAttribute('aria-expanded', 'true');
});


test('committing a search tag chip closes automatically opened Tags', async ({ page }) => {
  await openCloudLibrary(page);
  await page.locator('#q').fill('tag:fridge');
  await expect(page.locator('[data-facet="tag"]')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#q').press('Enter');
  await expect(page.locator('#q')).toHaveValue('');
  await expect(page.locator('[data-facet="tag"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#chips-row')).toContainText('fridge');
});
