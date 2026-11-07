const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let fixture, url;
const markdown = '# Published guide\n\nIntroduction stays visible.\n\n## Overview\n\nAn overview paragraph.\n\n### Details\n\nA distinctive nested answer for the index.\n\n#### Further reading\n\nA deeper explanation.\n\n## Checklist\n\n| Task | Status |\n| --- | --- |\n| Review | Ready |';
test.beforeEach(async () => {
  fixture = await startFixture({ singlePlan: true, compilePublications: true });
  const onboard = await fixture.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {});
  const workspace = onboard.data.workspaces.find(item => item.kind === 'personal');
  const saved = await fixture.api('josh', '/api/cloud/v1/account/documents', 'POST', {
    account_id: workspace.id, filename: 'published-guide.md', markdown, idempotency_key: 'folding-document',
  });
  expect(saved.status).toBe(201);
  const publication = await fixture.api('josh', '/api/cloud/v1/documents/' + saved.data.document.id + '/publication', 'POST', {
    expected_revision_id: saved.data.document.current_revision_id, idempotency_key: 'folding-publication',
  });
  expect(publication.status).toBe(200); url = publication.data.publication.url;
});
test.afterEach(async () => { if (fixture) await fixture.close(); });

test('published sections start collapsed, expand normally and preserve reader choices across theme changes', async ({ page }) => {
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-publication-ready', 'true');
  await expect(page.locator('.md-section-body')).toHaveCount(4);
  await expect(page.locator('.md-section-body.open')).toHaveCount(0);
  await expect(page.getByText('Introduction stays visible.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByText('A distinctive nested answer for the index.', { exact: true })).toBeHidden();
  await page.getByRole('heading', { name: 'Overview', exact: true }).click();
  await expect(page.getByText('A distinctive nested answer for the index.', { exact: true })).toBeVisible();
  await page.getByRole('heading', { name: 'Details', exact: true }).click();
  await expect(page.getByText('A distinctive nested answer for the index.', { exact: true })).toBeHidden();
  await page.locator('#_sd_btn-theme').click();
  await expect(page.locator('#overview').locator('..').locator(':scope > .md-section-body')).toHaveClass(/open/);
  await expect(page.locator('#details').locator('..').locator(':scope > .md-section-body')).not.toHaveClass(/open/);
  await page.getByRole('heading', { name: 'Details', exact: true }).click();
  await expect(page.getByText('A deeper explanation.', { exact: true })).toBeVisible();
  await page.locator('#_sd_btn-fold').click();
  await expect(page.locator('.md-section-body.open')).toHaveCount(4);
  await page.locator('#_sd_btn-fold').click();
  await expect(page.locator('.md-section-body.open')).toHaveCount(0);
});

test('all nested content remains in the response and readable with JavaScript disabled', async ({ browser, request }) => {
  const response = await request.get(url), html = await response.text();
  expect(html).toContain('A distinctive nested answer for the index.');
  expect(html).toContain('A deeper explanation.');
  const guest = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await guest.newPage(); await page.goto(url);
    await expect(page.locator('.md-section-body.open')).toHaveCount(4);
    await expect(page.getByText('A distinctive nested answer for the index.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Further reading', exact: true })).toBeVisible();
    await expect(page.getByRole('table')).toContainText('Ready');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index,follow');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', url);
  } finally { await guest.close(); }
});

test('a link to a nested heading opens its section and parents while other sections stay collapsed', async ({ page }) => {
  await page.goto(url + '#sec=details');
  await expect(page.locator('html')).toHaveAttribute('data-publication-ready', 'true');
  await expect(page.getByRole('heading', { name: 'Details', exact: true })).toBeVisible();
  await expect(page.getByText('A distinctive nested answer for the index.', { exact: true })).toBeVisible();
  await expect(page.getByText('A deeper explanation.', { exact: true })).toBeHidden();
  await expect(page.getByRole('table')).toBeHidden();
  await expect(page.locator('.md-section-body.open')).toHaveCount(2);
});
