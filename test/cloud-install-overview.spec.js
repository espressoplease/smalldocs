const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let f;
test.beforeEach(async () => { f = await startFixture({ singlePlan: true }); });
test.afterEach(async () => { await f.close(); });
for (const width of [390, 1440]) test('install overview, copy feedback and installer explanation at ' + width, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 1000 });
  await context.addCookies([{ name: 'sdocs_cloud', value: f.users.josh.sessionToken, url: f.origin }]);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: f.origin });
  await page.goto(f.origin + '/cloud/install');
  await expect(page.getByRole('heading', { name: 'Install SmallDocs', exact: true })).toBeVisible();
  await expect(page.locator('.sdoc-install-overview ol > li')).toHaveCount(2);
  await expect(page.locator('.sdoc-install-overview')).toContainText('CLI');
  await expect(page.locator('.sdoc-install-overview')).toContainText('Agent skill');
  await page.getByRole('button', { name: 'Copy CLI command', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('curl -fsSL https://smalldocs.org/install | sh');
  await expect(page.locator('[data-install-copy="cli"]')).toHaveClass(/done/);
  await page.getByRole('button', { name: 'Copy skill command', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('/agent-skills/cloud --global --yes');
  await expect(page.locator('.sdoc-install-info p')).toBeHidden();
  await page.locator('summary[aria-label="Why use this installer?"]').click();
  await expect(page.locator('.sdoc-install-info p')).toBeVisible();
  await expect(page.locator('.sdoc-install-info p')).toContainText('no administrator access');
  await page.getByRole('button', { name: 'Copy setup prompt', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Create one getting-started document');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('summary[aria-label="Why use this installer?"]').click();
  await expect(page.locator('.sdoc-install-info p')).toBeHidden();
  await page.waitForTimeout(1600);
  await page.screenshot({ path: '/tmp/smalldocs-annual-rollout/install-' + width + '.png', fullPage: true });
});
test('Windows installation does not show the POSIX installer explanation', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36' });
  try {
    await context.addCookies([{ name: 'sdocs_cloud', value: f.users.josh.sessionToken, url: f.origin }]);
    const page = await context.newPage(); await page.goto(f.origin + '/cloud/install');
    await expect(page.locator('[data-install-field="cli"]')).toHaveText('npm i -g sdocs-dev');
    await expect(page.locator('.sdoc-install-info')).toHaveCount(0);
  } finally { await context.close(); }
});
