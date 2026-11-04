const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let f, doc;
test.beforeEach(async ({ page }) => {
  f = await startFixture({ singlePlan: true });
  const setup = await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {});
  const saved = await f.api('josh', '/api/cloud/v1/account/documents', 'POST', {
    account_id: setup.data.workspaces[0].id, filename: 'shortcuts.md',
    markdown: '# Sidebar shortcuts\n\nA document for checking the shared navigation.',
    idempotency_key: 'sidebar-shortcuts',
  });
  expect(saved.status).toBe(201); doc = saved.data.document;
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.josh.sessionToken, url: f.origin }]);
});
test.afterEach(async () => { if (f) await f.close(); });
const urlFor = surface => f.origin + (surface === 'reader' ? '/docs?cloud-document=' + doc.id
  : surface === 'library' ? '/library?scope=cloud' : '/cloud/admin?panel=account');
async function phase(page, value) {
  const now = Date.now();
  await page.route('**/api/cloud/billing/subscription', route => route.fulfill({ json: {
    phase: value, trial_starts_at_ms: now - 86400000, trial_ends_at_ms: now + 7 * 86400000,
  } }));
}
async function checkTip(page, target, label, placement) {
  await target.hover();
  const tip = page.locator('#_sd_tooltip');
  await expect(tip).toHaveClass(/show/);
  await expect(tip).toHaveText(label);
  await expect(tip).toHaveAttribute('data-placement', placement);
  await expect(target).toHaveAttribute('aria-describedby', /_sd_tooltip/);
  await tip.evaluate(el => Promise.allSettled(el.getAnimations().map(a => a.finished)));
  const box = await tip.boundingBox(), icon = await target.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(6);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width - 6);
  expect(box.y).toBeGreaterThanOrEqual(6);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height - 6);
  if (placement === 'bottom') expect(box.y).toBeGreaterThanOrEqual(icon.y + icon.height + 7);
  else expect(box.y + box.height).toBeLessThanOrEqual(icon.y - 7);
}
for (const surface of ['reader', 'library', 'account']) {
  for (const state of ['trial', 'active']) {
    test(surface + ' footer tips prefer below with a trial and flip above without one: ' + state, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 700 });
      await phase(page, state); await page.goto(urlFor(surface));
      const footer = page.locator('.sdocs-sidebar-account-actions');
      if (state === 'trial') await expect(page.locator('.sdocs-sidebar-subscription')).toBeVisible();
      else await expect(page.locator('.sdocs-sidebar-subscription')).toHaveCount(0);
      const controls = footer.locator('.sdocs-sidebar-icon-shortcut');
      for (const target of await controls.all()) {
        await expect(target).toHaveCSS('width', '36px');
        await expect(target).toHaveCSS('height', '36px');
        await expect(target).toHaveCSS('border-radius', '50%');
        await checkTip(page, target, await target.getAttribute('aria-label'), state === 'trial' ? 'bottom' : 'top');
      }
      const github = footer.getByRole('link', { name: 'SmallDocs on GitHub', exact: true });
      await expect(github).toHaveAttribute('href', 'https://github.com/espressoplease/smalldocs');
      await expect(github).toHaveAttribute('target', '_blank');
      await expect(github).toHaveAttribute('rel', /noopener/);
      const x = footer.getByRole('link', { name: 'SmallDocs on X', exact: true });
      await expect(x).toHaveAttribute('href', 'https://x.com/smalldocs_org');
      await expect(x).toHaveAttribute('target', '_blank');
      await expect(x).toHaveAttribute('rel', /noopener/);
      await page.mouse.move(1000, 10);
      await expect(page.locator('#_sd_tooltip')).toHaveAttribute('aria-hidden', 'true');
      await expect(github).not.toHaveAttribute('aria-describedby');
    });
  }
}
test('compact and short sidebars keep footer tips inside the viewport', async ({ page }) => {
  await phase(page, 'active'); await page.goto(urlFor('reader'));
  for (const size of [{ width: 900, height: 650 }, { width: 1280, height: 360 }]) {
    await page.setViewportSize(size);
    const github = page.getByRole('link', { name: 'SmallDocs on GitHub', exact: true });
    await checkTip(page, github, 'SmallDocs on GitHub', 'top');
    await page.keyboard.press('Escape');
    await expect(page.locator('#_sd_tooltip')).toHaveAttribute('aria-hidden', 'true');
  }
});
test('keyboard users get footer help and Escape dismisses it', async ({ page }) => {
  await phase(page, 'active'); await page.goto(urlFor('library'));
  await page.keyboard.press('Tab');
  const settings = page.getByRole('link', { name: 'Account settings', exact: true });
  await settings.focus();
  await expect(page.locator('#_sd_tooltip')).toHaveText('Account settings');
  await expect(page.locator('#_sd_tooltip')).toHaveClass(/show/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#_sd_tooltip')).toHaveAttribute('aria-hidden', 'true');
  await expect(settings).toBeFocused();
});
test('document actions and dynamically inserted targets share one safe tooltip', async ({ page }) => {
  await page.goto(urlFor('reader'));
  await checkTip(page, page.getByRole('button', { name: 'Read', exact: true }), 'Read', 'bottom');
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'dynamic-tip'; button.textContent = 'Dynamic shortcut';
    button.dataset.tip = '<img src=x onerror="window.tooltipInjected=true">';
    document.querySelector('#_sd_left-toolbar .toggle-group').appendChild(button);
  });
  await page.locator('#dynamic-tip').hover();
  await expect(page.locator('#_sd_tooltip')).toHaveText('<img src=x onerror="window.tooltipInjected=true">');
  await expect(page.locator('#_sd_tooltip img')).toHaveCount(0);
  expect(await page.evaluate(() => window.tooltipInjected)).toBeUndefined();
  await expect(page.locator('#_sd_tooltip')).toHaveCount(1);
});
test('touch navigation opens Information without a lingering hover tooltip', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 700 }, isMobile: true, hasTouch: true });
  try {
    await context.addCookies([{ name: 'sdocs_cloud', value: f.users.josh.sessionToken, url: f.origin }]);
    const page = await context.newPage(); await page.goto(urlFor('reader'));
    await page.getByRole('button', { name: 'Open SmallDocs menu', exact: true }).tap();
    await page.getByRole('button', { name: "What's new", exact: true }).tap();
    await expect(page.locator('#_sd_info-panel')).toBeVisible();
    await expect(page.locator('#_sd_tooltip.show')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
});
