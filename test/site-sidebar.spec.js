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
    ['/public/cloud-admin.html', null],
  ];

  for (const [url, activeLabel] of surfaces) {
    await page.goto(url);
    await expect(page.locator('#_sd_site_sidebar')).toBeVisible();
    if (activeLabel) {
      await expect(page.locator('.sdocs-site-sidebar-row.is-active')).toContainText(activeLabel);
    }
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const layout = await page.evaluate(() => ({
      sidebarRight: document.querySelector('#_sd_site_sidebar').getBoundingClientRect().right,
      bodyPaddingLeft: parseFloat(getComputedStyle(document.body).paddingLeft),
    }));
    expect(layout.sidebarRight).toBe(224);
    expect(layout.bodyPaddingLeft).toBe(224);
  }
});

test('all app sidebars use the same account shortcuts without legacy menu items', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  async function contract(url, selector) {
    await page.goto(url);
    const sidebar = page.locator(selector);
    await expect(sidebar.locator('[data-sidebar-section="capabilities"], [data-sidebar-section="sdk"]')).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Source on GitHub' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Private by design' })).toHaveCount(0);
    await expect(sidebar).not.toContainText('Loaded:');
    const account = sidebar.locator('.sdocs-sidebar-settings-shortcut');
    const news = sidebar.getByRole('button', { name: "What's new", exact: true });
    await expect(account).toBeVisible();
    await expect(news).toBeVisible();
    return sidebar.evaluate(element => {
      const values = (target, names) => {
        const style = getComputedStyle(target);
        return Object.fromEntries(names.map(name => [name, style[name]]));
      };
      const account = element.querySelector('.sdocs-sidebar-settings-shortcut');
      const news = element.querySelector('#_sd_btn-info');
      const bounds = element.getBoundingClientRect();
      const footer = element.querySelector('.sdocs-sidebar-account-footer').getBoundingClientRect();
      return {
        sidebar: values(element, ['width', 'paddingTop', 'paddingRight', 'paddingBottom',
          'paddingLeft', 'fontFamily', 'fontSize', 'fontWeight']),
        account: values(account, ['width', 'height', 'borderRadius', 'color']),
        icon: values(account.querySelector('svg'), ['width', 'height', 'strokeWidth', 'fill']),
        aligned: account.getBoundingClientRect().top === news.getBoundingClientRect().top,
        bottomSpace: Math.round(bounds.bottom - footer.bottom),
      };
    });
  }
  const reader = await contract('/docs', '#_sd_sidebar');
  for (const url of ['/public/library/library.html?demo=1', '/public/cloud-admin.html',
    '/public/connect.html', '/public/cloud.html', '/public/library/rescued.html']) {
    expect(await contract(url, '#_sd_site_sidebar')).toEqual(reader);
  }
  expect(reader.account).toMatchObject({ width: '36px', height: '36px', borderRadius: '50%' });
  expect(reader.icon).toMatchObject({ width: '18px', height: '18px', strokeWidth: '1.5px', fill: 'none' });
  expect(reader.aligned).toBe(true);
  expect(reader.bottomSpace).toBe(16);
});

test('signed-out shortcuts retain the return path and authenticated shortcuts open Settings', async ({ page }) => {
  await page.goto('/public/library/library.html?demo=1');
  const actions = page.locator('.sdocs-sidebar-account-actions');
  await expect(actions.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href',
    '/cloud/sign-in?return=%2Fpublic%2Flibrary%2Flibrary.html%3Fdemo%3D1');
  await actions.evaluate(element => {
    element.outerHTML = window.SDocsSidebarShared.accountActionsHtml({ authenticated: true });
  });
  await expect(page.getByRole('link', { name: 'Account settings', exact: true }))
    .toHaveAttribute('href', '/cloud/admin');
  await expect(actions.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
});

test('Information works on site pages and shares the reader panel content', async ({ page }) => {
  await page.goto('/docs');
  const readerContent = await page.locator('#_sd_info-panel').innerHTML();
  await page.goto('/public/cloud-admin.html');
  const url = page.url();
  expect(await page.locator('#_sd_info-panel').innerHTML()).toBe(readerContent);
  const news = page.getByRole('button', { name: "What's new", exact: true });
  await news.click();
  await expect(news).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'Information' })).toBeVisible();
  await expect(page.locator('#_sd_info-feedback')).toBeEditable();
  await page.locator('#_sd_info-notify-off').click();
  await expect(page.locator('#_sd_info-notify-off')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(news).toHaveAttribute('aria-pressed', 'false');
  await expect(news).toBeFocused();
  await expect(page.locator('#_sd_info-panel')).toHaveAttribute('aria-hidden', 'true');
  await expect(page).toHaveURL(url);

  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator('body')).toHaveClass(/sdocs-sidebar-collapsed/);
  await news.click();
  await expect(page.getByRole('complementary', { name: 'Information' })).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/sdocs-sidebar-collapsed/);
  await page.getByRole('button', { name: 'Close information panel' }).click();

  await page.setViewportSize({ width: 390, height: 700 });
  const menu = page.locator('.sdocs-site-mobilebar-menu');
  await menu.click();
  await news.click();
  const panel = page.getByRole('dialog', { name: 'Information' });
  await expect(panel).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.shell')).toHaveAttribute('inert', '');
  const close = panel.getByRole('button', { name: 'Close information panel' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(panel.getByRole('link', { name: 'Learn about SmallDocs', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await close.click();
  await expect(menu).toBeFocused();
  await expect(page.locator('.shell')).not.toHaveAttribute('inert', '');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const path of ['/public/cloud-admin.html', '/public/library/library.html?demo=1']) {
    await page.goto(path);
    await page.getByRole('button', { name: "What's new", exact: true }).click();
    const background = await page.locator('#_sd_info-panel').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(background.match(/\d+/g).slice(0, 3).map(Number).every(channel => channel < 100)).toBe(true);
  }
});

test('compact site navigation uses a rail and mobile navigation uses a left drawer', async ({ page }) => {
  await page.setViewportSize({ width: 950, height: 800 });
  await page.goto('/public/cloud.html');

  const compactMenu = page.locator('.sdocs-site-mobilebar-menu');
  const sidebar = page.locator('#_sd_site_sidebar');
  const local = page.locator('.sdocs-site-sidebar-local');
  await expect(compactMenu).toBeHidden();
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveAttribute('data-sidebar-collapsed', 'true');
  await expect(page.locator('body')).toHaveCSS('padding-left', '52px');
  expect(Math.round((await sidebar.boundingBox()).width)).toBe(52);
  await expect(local.getByText('Local library', { exact: true })).toBeHidden();

  await local.click();
  await expect(page).toHaveURL(/\/public\/cloud\.html$/);
  await expect(sidebar).toHaveAttribute('data-sidebar-collapsed', 'false');
  await expect(page.locator('body')).toHaveCSS('padding-left', '224px');
  await expect(local.getByText('Local library', { exact: true })).toBeVisible();
  expect(Math.round((await sidebar.boundingBox()).width)).toBe(224);

  await page.locator('.sdocs-sidebar-collapse-toggle').click();
  await expect(sidebar).toHaveAttribute('data-sidebar-collapsed', 'true');
  await expect(local).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)');

  await page.setViewportSize({ width: 951, height: 800 });
  await expect(sidebar).toHaveAttribute('data-sidebar-collapsed', 'false');
  await expect(page.locator('.sdocs-sidebar-collapse-toggle')).toBeHidden();
  await page.locator('.sdocs-sidebar-collapse-toggle').evaluate(element => element.click());
  await expect(sidebar).toHaveAttribute('data-sidebar-collapsed', 'false');

  await page.setViewportSize({ width: 390, height: 844 });

  const mobileBar = page.locator('.sdocs-site-mobilebar');
  await expect(page.locator('body')).toHaveCSS('padding-top', '0px');
  await expect(page.locator('body')).toHaveCSS('min-height', '0px');
  await expect(mobileBar).toHaveCSS('position', 'sticky');
  await expect(mobileBar).toHaveAttribute('data-mobile-header-state', 'visible');
  await expect(page.locator('html')).not.toHaveClass(/sdocs-mobile-page-scrolled/);

  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '1600px';
    document.body.appendChild(spacer);
    window.scrollTo(0, 320);
  });
  const initialScroll = await page.evaluate(() => window.scrollY);
  expect(initialScroll).toBeGreaterThan(0);
  await expect(page.locator('html')).not.toHaveClass(/sdocs-mobile-page-scrolled/);
  await expect(mobileBar).toHaveAttribute('data-mobile-header-state', 'visible');
  await expect.poll(async () => Math.round((await mobileBar.boundingBox()).y)).toBe(0);
  const drawerScroll = await page.evaluate(() => window.scrollY);

  const menu = page.locator('.sdocs-site-mobilebar-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sdocs-site-mobilebar-menu-icon')).toBeVisible();
  await expect(menu.locator('.sdocs-site-mobilebar-close-icon')).toBeHidden();
  await expect(page.locator('#_sd_site_sidebar')).toBeHidden();
  await menu.evaluate(element => element.click());
  await expect(page.locator('#_sd_site_sidebar')).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('overflow', 'visible');
  await expect(page.locator('#_sd_site_sidebar')).toHaveCSS('overscroll-behavior', 'contain');
  expect(await page.evaluate(() => window.scrollY)).toBe(drawerScroll);
  const backdrop = await page.locator('body').evaluate(element => ({
    pointerEvents: getComputedStyle(element, '::after').pointerEvents,
    touchAction: getComputedStyle(element, '::after').touchAction,
  }));
  expect(backdrop).toEqual({ pointerEvents: 'auto', touchAction: 'none' });
  await expect.poll(async () => Math.round((await page.locator('#_sd_site_sidebar').boundingBox()).x)).toBe(0);
  const drawer = await page.locator('#_sd_site_sidebar').boundingBox();
  expect(Math.round(drawer.x)).toBe(0);
  expect(Math.round(drawer.width)).toBe(320);
  await expect(page.locator('.sdocs-site-sidebar-local')).toBeHidden();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toHaveAttribute('aria-label', 'Close menu');
  await expect(menu.locator('.sdocs-site-mobilebar-menu-icon')).toBeHidden();
  await expect(menu.locator('.sdocs-site-mobilebar-close-icon')).toBeVisible();
  await page.mouse.click(drawer.x + drawer.width + 20, drawer.y + 80);
  await expect(page.locator('#_sd_site_sidebar')).toBeHidden();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.evaluate(element => element.click());
  await expect(page.locator('#_sd_site_sidebar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#_sd_site_sidebar')).toBeHidden();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toHaveAttribute('aria-label', 'Open menu');
  await expect(menu.locator('.sdocs-site-mobilebar-menu-icon')).toBeVisible();
  await expect(menu.locator('.sdocs-site-mobilebar-close-icon')).toBeHidden();
  expect(await page.evaluate(() => window.scrollY)).toBe(drawerScroll);

  const geometry = await page.evaluate(() => ({
    menuLeft: Math.round(document.querySelector('.sdocs-site-mobilebar-menu').getBoundingClientRect().left),
    scrollWidth: document.body.scrollWidth,
    width: innerWidth,
  }));
  expect(geometry.menuLeft).toBe(0);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('html')).not.toHaveClass(/sdocs-mobile-page-scrolled/);
  await expect(mobileBar).toHaveCSS('position', 'sticky');
  const topGeometry = await page.evaluate(() => {
    const bar = document.querySelector('.sdocs-site-mobilebar').getBoundingClientRect();
    const content = document.querySelector('.content').getBoundingClientRect();
    return { barTop: Math.round(bar.top), barBottom: Math.round(bar.bottom), contentTop: Math.round(content.top) };
  });
  expect(topGeometry.barTop).toBe(0);
  expect(topGeometry.contentTop).toBeGreaterThanOrEqual(topGeometry.barBottom);
});
