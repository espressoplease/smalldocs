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

test('expandable site navigation stays closed until selected', async ({ page }) => {
  await page.goto('/public/library/library.html?demo=1');
  const capabilities = page.locator('[data-sidebar-section="capabilities"]');
  const sdk = page.locator('[data-sidebar-section="sdk"]');

  await expect(capabilities.locator('.sdocs-sidebar-top-row')).toHaveAttribute('aria-expanded', 'false');
  await expect(capabilities.getByRole('link', { name: 'View homepage' })).toBeHidden();
  await expect(capabilities.getByRole('link', { name: 'Diagrams' })).toBeHidden();
  await capabilities.locator('.sdocs-sidebar-top-row').click();
  await expect(capabilities.locator('.sdocs-sidebar-top-row')).toHaveAttribute('aria-expanded', 'true');
  const homepage = capabilities.getByRole('link', { name: 'View homepage' });
  await expect(homepage).toBeVisible();
  await expect(homepage).toHaveAttribute('href', '/home');
  await expect(homepage).toHaveAttribute('target', '_blank');
  await expect(homepage).toHaveClass(/sdocs-sidebar-library-open/);
  await expect(homepage.locator('svg')).toHaveCount(1);
  await expect(homepage.locator('path').first()).toHaveAttribute('d',
    'M13 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7');
  expect(await capabilities.locator('[data-sdocs-shared-capabilities] a').first().innerText())
    .toBe('View homepage');
  await expect(capabilities.getByRole('link', { name: 'Diagrams' })).toBeVisible();
  await expect(sdk.locator('.sdocs-sidebar-top-row')).toHaveAttribute('aria-expanded', 'false');
});

test('Library and reader sidebars share capability and footer content', async ({ page }) => {
  async function sharedContent(url, sidebar) {
    await page.goto(url);
    return page.locator(sidebar).evaluate(element => ({
      renderer: element.getAttribute('data-sdocs-sidebar-renderer'),
      capabilities: Array.from(element.querySelectorAll('[data-sdocs-shared-capabilities] a'))
        .map(link => ({ label: link.textContent, href: link.getAttribute('href') })),
      footer: Array.from(element.querySelectorAll('.sdocs-sidebar-footer-link'))
        .map(link => link.textContent.trim()),
      legal: element.querySelector('.sdocs-sidebar-legal').textContent.trim(),
      footerBottom: Math.round(element.querySelector('.sdocs-sidebar-footer').getBoundingClientRect().bottom),
      sidebarBottom: Math.round(element.getBoundingClientRect().bottom),
      contract: (() => {
        const styleValues = (target, names) => {
          const style = getComputedStyle(target);
          return Object.fromEntries(names.map(name => [name, style[name]]));
        };
        const row = Array.from(element.querySelectorAll('.sdocs-sidebar-top-row'))
          .find(target => getComputedStyle(target).display !== 'none');
        const brand = element.querySelector('.sdocs-sidebar-brand');
        const footerLink = element.querySelector('.sdocs-sidebar-footer-link');
        const footerIcon = footerLink.querySelector('svg');
        const legal = element.querySelector('.sdocs-sidebar-legal');
        const legalLink = legal.querySelector('a');
        const capabilityAction = element.querySelector('[data-sdocs-shared-capabilities] a');
        const capabilityItem = element.querySelector('[data-sdocs-shared-capabilities] a:nth-child(2)');
        const bounds = element.getBoundingClientRect();
        const brandBounds = brand.getBoundingClientRect();
        return {
          sidebar: styleValues(element, ['width', 'paddingTop', 'paddingRight', 'paddingBottom',
            'paddingLeft', 'fontSize']),
          row: styleValues(row, ['height', 'paddingLeft', 'paddingRight', 'columnGap', 'fontSize',
            'borderRadius']),
          footerLink: styleValues(footerLink, ['minHeight', 'paddingLeft', 'paddingRight',
            'columnGap', 'fontSize', 'borderRadius']),
          footerIcon: styleValues(footerIcon, ['width', 'height', 'fill', 'stroke', 'strokeWidth',
            'strokeLinecap', 'strokeLinejoin']),
          legal: styleValues(legal, ['fontSize']),
          legalLink: styleValues(legalLink, ['textDecorationLine']),
          capabilityAction: styleValues(capabilityAction, ['width', 'minHeight', 'paddingTop',
            'paddingRight', 'paddingBottom', 'paddingLeft', 'columnGap', 'borderRadius']),
          capabilityItem: styleValues(capabilityItem, ['width', 'minHeight', 'paddingTop',
            'paddingRight', 'paddingBottom', 'paddingLeft', 'columnGap', 'borderRadius']),
          brandOffset: {
            top: Math.round(brandBounds.top - bounds.top),
            left: Math.round(brandBounds.left - bounds.left),
          },
        };
      })(),
    }));
  }

  const library = await sharedContent('/public/library/library.html?demo=1', '#_sd_site_sidebar');
  const reader = await sharedContent('/docs?sidebar=preview', '#_sd_sidebar');
  expect(library.renderer).toBe('shared');
  expect(reader.renderer).toBe('shared');
  expect(library.capabilities).toEqual(reader.capabilities);
  expect(reader.capabilities[0]).toEqual({ label: 'View homepage', href: '/home' });
  expect(library.footer).toEqual(reader.footer);
  expect(library.footer).toEqual(['Sign in', 'Private by design', 'Source on GitHub']);
  expect(library.legal).toBe('You agree to our Terms');
  expect(reader.legal).toBe(library.legal);
  await expect(page.locator('#_sd_sidebar').getByText('For business', { exact: true })).toHaveCount(0);
  expect(library.contract).toEqual(reader.contract);
  expect(reader.contract.sidebar.width).toBe('224px');
  expect(reader.contract.footerIcon).toMatchObject({
    width: '15px',
    height: '15px',
    fill: 'none',
    strokeWidth: '2px',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  });
  expect(reader.contract.legal.fontSize).toBe('11px');
  expect(reader.contract.legalLink.textDecorationLine).toBe('underline');
  expect(reader.contract.capabilityAction).toMatchObject({
    minHeight: '32px',
    paddingTop: '5px',
    paddingRight: '9px',
    paddingBottom: '5px',
    paddingLeft: '9px',
    columnGap: '7px',
    borderRadius: '4px',
  });
  expect(reader.contract.capabilityItem).toMatchObject({
    minHeight: '28px',
    paddingTop: '5px',
    paddingRight: '10px',
    paddingBottom: '5px',
    paddingLeft: '10px',
    columnGap: '6px',
    borderRadius: '4px',
  });
  expect(library.sidebarBottom - library.footerBottom).toBe(16);
  expect(reader.sidebarBottom - reader.footerBottom).toBe(16);
});

test('shared footer uses acceptance state without another request', async ({ page }) => {
  await page.goto('/public/library/library.html?demo=1');
  const footer = page.locator('#_sd_site_sidebar .sdocs-sidebar-footer');
  const signIn = footer.getByRole('link', { name: 'Sign in', exact: true });
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveAttribute('href',
    '/cloud/sign-in?return=%2Fpublic%2Flibrary%2Flibrary.html%3Fdemo%3D1');
  await expect(signIn.locator('path').last()).toHaveAttribute('d', 'm16 19 2 2 4-4');
  await expect(footer.getByRole('link', { name: 'Account settings' })).toHaveCount(0);

  await footer.evaluate(element => {
    element.innerHTML = window.SDocsSidebarShared.footerInnerHtml({
      authenticated: true,
      statusId: 'test-sidebar-status',
    });
    element.querySelector('#test-sidebar-status').textContent = 'Loaded';
  });
  await expect(footer.locator('#test-sidebar-status')).toHaveCSS('margin-bottom', '4px');
  await expect(footer.getByRole('link', { name: 'Account settings' })).toHaveAttribute('href', '/cloud/admin');
  await expect(footer.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  await expect(footer.locator('.sdocs-sidebar-footer-link').first()).toHaveText('Account settings');
  await expect(footer.locator('.sdocs-sidebar-footer-link').nth(1)).toHaveText('Private by design');
  await expect(footer.locator('.sdocs-sidebar-legal')).toHaveText('You agree to our Terms');

  await footer.evaluate(element => {
    element.innerHTML = window.SDocsSidebarShared.footerInnerHtml({
      authenticated: true,
      termsAccepted: true,
    });
  });
  await expect(footer.getByRole('link', { name: 'Account settings' })).toBeVisible();
  await expect(footer.locator('.sdocs-sidebar-legal')).toHaveCount(0);
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
