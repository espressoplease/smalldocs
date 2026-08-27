const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

test('Library and supporting text pages share the desktop navigation shell', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  const surfaces = [
    ['/public/library/library.html?demo=1', 'Local library'],
    ['/public/library/library.html?scope=cloud', 'Cloud library'],
    ['/public/connect.html', 'Local library'],
    ['/public/cloud.html', 'Cloud library'],
    ['/public/library/rescued.html', 'Local library'],
  ];

  for (const [url, activeLabel] of surfaces) {
    await page.goto(url);
    await expect(page.locator('#_sd_site_sidebar')).toBeVisible();
    await expect(page.locator('.sdocs-site-sidebar-row.is-active')).toContainText(activeLabel);
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const layout = await page.evaluate(() => ({
      sidebarRight: document.querySelector('#_sd_site_sidebar').getBoundingClientRect().right,
      bodyPaddingLeft: parseFloat(getComputedStyle(document.body).paddingLeft),
    }));
    expect(layout.sidebarRight).toBe(260);
    expect(layout.bodyPaddingLeft).toBe(260);
  }
});

test('expandable site navigation stays closed until selected', async ({ page }) => {
  await page.goto('/public/library/library.html?demo=1');
  const capabilities = page.locator('[data-site-section="capabilities"]');
  const sdk = page.locator('[data-site-section="sdk"]');

  await expect(capabilities.locator('.sdocs-site-sidebar-row')).toHaveAttribute('aria-expanded', 'false');
  await expect(capabilities.getByRole('link', { name: 'Diagrams' })).toBeHidden();
  await capabilities.locator('.sdocs-site-sidebar-row').click();
  await expect(capabilities.locator('.sdocs-site-sidebar-row')).toHaveAttribute('aria-expanded', 'true');
  await expect(capabilities.getByRole('link', { name: 'Diagrams' })).toBeVisible();
  await expect(sdk.locator('.sdocs-site-sidebar-row')).toHaveAttribute('aria-expanded', 'false');
});

test('Library and reader sidebars share capability and footer content', async ({ page }) => {
  async function sharedContent(url, sidebar) {
    await page.goto(url);
    return page.locator(sidebar).evaluate(element => ({
      capabilities: Array.from(element.querySelectorAll('[data-sdocs-shared-capabilities] a'))
        .map(link => ({ label: link.textContent, href: link.getAttribute('href') })),
      footer: Array.from(element.querySelectorAll('.sdocs-sidebar-footer-link'))
        .map(link => link.textContent.trim()),
      footerBottom: Math.round(element.querySelector('.sdocs-sidebar-footer').getBoundingClientRect().bottom),
      sidebarBottom: Math.round(element.getBoundingClientRect().bottom),
    }));
  }

  const library = await sharedContent('/public/library/library.html?demo=1', '#_sd_site_sidebar');
  const reader = await sharedContent('/docs?sidebar=preview', '#_sd_sidebar');
  expect(library.capabilities).toEqual(reader.capabilities);
  expect(library.footer).toEqual(reader.footer);
  expect(library.footer).toEqual(['Private by design', 'Source on GitHub']);
  expect(library.sidebarBottom - library.footerBottom).toBe(16);
  expect(reader.sidebarBottom - reader.footerBottom).toBe(16);
});

test('mobile site navigation keeps the menu button fixed and hides Local library', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/public/cloud.html');

  const menu = page.locator('.sdocs-site-mobilebar-menu');
  await expect(menu).toBeVisible();
  await expect(page.locator('#_sd_site_sidebar')).toBeHidden();
  await menu.click();
  await expect(page.locator('#_sd_site_sidebar')).toBeVisible();
  await expect(page.locator('.sdocs-site-sidebar-local')).toBeHidden();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#_sd_site_sidebar')).toBeHidden();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');

  const geometry = await page.evaluate(() => ({
    menuRight: Math.round(document.querySelector('.sdocs-site-mobilebar-menu').getBoundingClientRect().right),
    width: innerWidth,
    scrollWidth: document.body.scrollWidth,
  }));
  expect(geometry.menuRight).toBe(geometry.width);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
});
