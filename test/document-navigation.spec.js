const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

test('signed-out desktop navigation explains how to connect each library', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/docs');

  await expect(page.getByText('Local library', { exact: true })).toBeVisible();
  await expect(page.getByText('Cloud library', { exact: true })).toBeVisible();
  await page.getByText('Local library', { exact: true }).click();
  await expect(page.getByText('Connect this browser to browse and tag Markdown files on your computer.', { exact: true })).toBeVisible();
  const localLearnMore = page.locator('#_sd_sidebar_local_disconnected').getByRole('link', { name: 'Learn more', exact: true });
  await expect(localLearnMore).toBeVisible();
  await expect(localLearnMore).toHaveAttribute('href', '/connect?return=%2Fdocs');
  await expect(page.locator('#_sd_sidebar_local_disconnected .sdocs-sidebar-explainer')).toHaveCSS('color', 'rgb(28, 25, 23)');
  await expect(page.locator('#_sd_sidebar_local_connected')).toBeHidden();
  await expect(page.locator('#_sd_sidebar_local_connected')).toHaveCSS('display', 'none');
  await page.getByText('Cloud library', { exact: true }).click();
  await expect(page.getByText('Keep documents available across devices and share them with other people and agents.', { exact: true })).toBeVisible();
  const cloudLearnMore = page.locator('#_sd_sidebar_cloud_disconnected').getByRole('link', { name: 'Learn more', exact: true });
  await expect(cloudLearnMore).toBeVisible();
  await expect(cloudLearnMore).toHaveAttribute('href', '/cloud');
  await expect(page.locator('#doc-site-menu')).toBeHidden();
});

test('mobile document controls scroll behind a fixed navigation menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs');

  const toolbar = page.locator('#_sd_left-toolbar');
  const scroller = page.locator('.sdocs-mobile-toolbar-scroll');
  const menu = page.locator('#_sd_mobile_menu');
  await expect(toolbar).toHaveCSS('top', '0px');
  await expect(toolbar).toHaveCSS('height', '44px');
  await expect(page.locator('.sdocs-mobile-toolbar-brand .toolbar-brand-short')).toBeVisible();
  await expect(page.locator('.sdocs-mobile-toolbar-brand .toolbar-brand-tiny')).toBeHidden();
  await expect(page.locator('#_sd_sidebar > .sdocs-sidebar-main > #_sd_toolbar-brand')).toBeHidden();
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sdocs-mobile-menu-icon')).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#_sd_left')).toHaveCSS('width', '390px');
  await page.locator('#_sd_btn-overflow').click();
  await expect(page.locator('#_sd_toggle-overflow')).toHaveClass(/open/);
  await expect.poll(() => scroller.evaluate(element => element.scrollWidth)).toBeGreaterThan(await scroller.evaluate(element => element.clientWidth));

  const menuBeforeScroll = await menu.boundingBox();
  await scroller.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  const menuAfterScroll = await menu.boundingBox();
  expect(menuAfterScroll.x).toBe(menuBeforeScroll.x);
  expect(menuAfterScroll.width).toBe(menuBeforeScroll.width);
  expect(await scroller.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);

  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.locator('.sdocs-mobile-menu-close')).toBeVisible();
  await expect(page.locator('#_sd_sidebar')).toBeVisible();
  await expect(page.getByText('Local library', { exact: true })).toBeHidden();
  await expect(page.getByText('Cloud library', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#_sd_sidebar')).toBeHidden();
});

test('narrow mobile wordmark collapses to SD inside the scroll rail', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/docs');

  await expect(page.locator('.sdocs-mobile-toolbar-brand .toolbar-brand-short')).toBeHidden();
  await expect(page.locator('.sdocs-mobile-toolbar-brand .toolbar-brand-tiny')).toBeVisible();
});

test('connected libraries show related documents, recent documents, and open actions', async ({ page }) => {
  await page.goto('/docs?sidebar=preview');
  await page.locator('#doc-site-menu').evaluate(element => { element.hidden = false; });

  await page.getByText('Local library', { exact: true }).click();
  const localPanel = page.locator('#_sd_sidebar_local_connected');
  const localOpen = localPanel.getByRole('link', { name: 'Open library', exact: true });
  const localShared = localPanel.getByRole('button', { name: 'Shared tags 6', exact: true });
  const localRecent = localPanel.getByRole('button', { name: 'Recent 3', exact: true });
  await expect(localOpen).toBeVisible();
  await expect(localOpen).toHaveAttribute('target', '_blank');
  await expect(localOpen.locator('svg')).toBeVisible();
  await expect(localShared).toHaveAttribute('aria-expanded', 'false');
  await expect(localRecent).toHaveAttribute('aria-expanded', 'false');
  await localShared.click();
  await expect(localShared).toHaveAttribute('aria-expanded', 'true');
  await expect(localShared).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(localShared).not.toHaveCSS('border-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('#_sd_sidebar_tag_groups').getByText('Reader redesign notes', { exact: true })).toBeVisible();
  await localRecent.click();
  await expect(localShared).toHaveAttribute('aria-expanded', 'false');
  await expect(localRecent).toHaveAttribute('aria-expanded', 'true');
  await expect(localRecent).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(localRecent).not.toHaveCSS('border-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('#_sd_sidebar_recent').getByText('Reader redesign notes', { exact: true })).toBeVisible();

  await page.mouse.move(800, 400);
  await page.goto('/docs?sidebar=preview');
  await page.locator('#doc-site-menu').evaluate(element => { element.hidden = false; });
  await page.getByText('Cloud library', { exact: true }).click();
  const cloudPanel = page.locator('#_sd_sidebar_cloud_connected');
  const cloudLibraryCta = cloudPanel.getByRole('link', { name: 'Open library', exact: true });
  await expect(cloudLibraryCta).toBeVisible();
  await expect(cloudLibraryCta).toHaveClass(/sdocs-sidebar-library-row/);
  await expect(cloudLibraryCta).toHaveAttribute('target', '_blank');
  expect(await cloudLibraryCta.evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(220);
  const cloudShared = cloudPanel.getByRole('button', { name: 'Shared tags 2', exact: true });
  await expect(cloudShared).toHaveAttribute('aria-expanded', 'false');
  await expect(cloudPanel.getByRole('button', { name: 'Recent 3', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await cloudShared.click();
  await expect(page.locator('#_sd_sidebar_cloud_tag_groups').getByText('Product brief', { exact: true })).toBeVisible();
  await expect(page.getByText('Account settings', { exact: true })).toBeVisible();
});

test('local library groups documents by the exact shared tag set', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/docs?sidebar=preview');
  await page.locator('#_sd_btn-library').click();
  await page.locator('#_sd_sidebar_local_shared_section > .sdocs-sidebar-library-toggle').click();
  await page.waitForTimeout(350);

  const groups = page.locator('#_sd_sidebar_tag_groups .sdocs-sidebar-tag-group');
  await expect(page.locator('#_sd_sidebar_local_shared_section').getByText('Shared tags', { exact: true })).toBeVisible();
  await expect(page.getByText('Documents with the same tags', { exact: true })).toHaveCount(0);
  await expect(groups).toHaveCount(4);
  await expect(groups.nth(0).locator('.sdocs-sidebar-tag')).toHaveText(['#design', '#renderer', '#product']);
  await expect(groups.nth(0).locator('.sdocs-sidebar-preview-entry')).toHaveText([
    'Reader redesign notes',
    'Shared renderer research',
    'SmallDocs UI audit',
  ]);
  await expect(groups.nth(1).locator('.sdocs-sidebar-tag')).toHaveText(['#renderer', '#product']);
  await expect(groups.nth(1).locator('.sdocs-sidebar-preview-entry')).toHaveText(['SmallDocs renderer roadmap']);
  expect(await groups.evaluateAll(elements => elements.every(element => getComputedStyle(element).borderBottomWidth === '0px'))).toBe(true);

  const order = await page.locator('#_sd_sidebar_local_connected').evaluate(element => {
    const groupsHost = element.querySelector('#_sd_sidebar_tag_groups');
    const sharedToggle = element.querySelector('#_sd_sidebar_local_shared_section > .sdocs-sidebar-library-toggle');
    const recentToggle = element.querySelector('#_sd_sidebar_local_recent_section > .sdocs-sidebar-library-toggle');
    const recentList = element.querySelector('#_sd_sidebar_recent');
    const scroll = element.querySelector('.sdocs-sidebar-library-scroll');
    const cta = element.querySelector('.sdocs-sidebar-library-open');
    return {
      scrollContainsCta: scroll.contains(cta),
      ctaBeforeShared: Boolean(cta.compareDocumentPosition(sharedToggle) & Node.DOCUMENT_POSITION_FOLLOWING),
      sharedBeforeGroups: Boolean(sharedToggle.compareDocumentPosition(groupsHost) & Node.DOCUMENT_POSITION_FOLLOWING),
      groupsBeforeRecent: Boolean(groupsHost.compareDocumentPosition(recentToggle) & Node.DOCUMENT_POSITION_FOLLOWING),
      recentBeforeList: Boolean(recentToggle.compareDocumentPosition(recentList) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  expect(order).toEqual({ scrollContainsCta: true, ctaBeforeShared: true, sharedBeforeGroups: true, groupsBeforeRecent: true, recentBeforeList: true });
});

test('truncated sidebar document names use the shared toolbar tooltip', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/docs?sidebar=preview');
  await page.locator('#_sd_btn-library').click();
  await page.locator('#_sd_sidebar_local_shared_section > .sdocs-sidebar-library-toggle').click();
  await page.waitForTimeout(350);
  await page.addStyleTag({ content: '.sdocs-sidebar-preview-entry { max-width: 140px; }' });
  await page.evaluate(() => window.SDocs.sidebarRefresh());

  const truncated = page.getByText('SmallDocs renderer roadmap', { exact: true });
  await expect(truncated).toHaveAttribute('data-tip', 'SmallDocs renderer roadmap');
  await expect(page.getByText('Research plan', { exact: true })).not.toHaveAttribute('data-tip');
  await truncated.hover();
  await page.waitForTimeout(350);
  await expect(page.locator('#_sd_tooltip')).toHaveText('SmallDocs renderer roadmap');
  await expect(page.locator('#_sd_tooltip')).toHaveClass(/show/);
});

test('local document rows are pointer links with new-tab targets', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/docs?sidebar=preview');
  await page.locator('#_sd_btn-library').click();
  await page.locator('#_sd_sidebar_local_shared_section > .sdocs-sidebar-library-toggle').click();
  await page.waitForTimeout(350);

  const documentLink = page.locator('#_sd_sidebar_tag_groups').getByText('Reader redesign notes', { exact: true });
  await expect(documentLink).toHaveAttribute('target', '_blank');
  await expect(documentLink).toHaveAttribute('rel', 'noopener');
  await expect(documentLink).toHaveCSS('cursor', 'pointer');
  await expect(documentLink).toHaveAttribute('href', /\/library\?demo=1$/);
});

test('sidebar tags follow the light and dark accent tokens', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/docs?sidebar=preview');
  await page.locator('#_sd_btn-library').click();
  await page.locator('#_sd_sidebar_local_shared_section > .sdocs-sidebar-library-toggle').click();
  await page.waitForTimeout(350);

  const colors = async () => page.locator('.sdocs-sidebar-tag').first().evaluate(tag => {
    const root = getComputedStyle(document.documentElement);
    const style = getComputedStyle(tag);
    const group = tag.closest('.sdocs-sidebar-tag-group');
    return {
      background: style.backgroundColor,
      borderColor: style.borderColor,
      color: style.color,
      padding: style.padding,
      groupPadding: getComputedStyle(tag.parentElement).padding,
      groupBackground: getComputedStyle(group).backgroundColor,
      accentBackground: root.getPropertyValue('--accent-light').trim(),
      accentText: root.getPropertyValue('--accent-text').trim(),
      surfaceBackground: root.getPropertyValue('--bg-surface').trim(),
    };
  });
  const firstTag = page.locator('.sdocs-sidebar-tag').first();
  await expect(firstTag).toHaveAttribute('href', /\/library\?tag=design$/);
  await expect(firstTag).toHaveCSS('cursor', 'pointer');
  expect(await colors()).toEqual({
    background: 'rgb(238, 242, 255)',
    borderColor: 'rgb(29, 78, 216)',
    color: 'rgb(29, 78, 216)',
    padding: '3px 7px',
    groupPadding: '0px 6px 4px',
    groupBackground: 'rgb(241, 237, 232)',
    accentBackground: '#EEF2FF',
    accentText: '#1D4ED8',
    surfaceBackground: '#F1EDE8',
  });

  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  expect(await colors()).toEqual({
    background: 'rgb(30, 41, 59)',
    borderColor: 'rgb(96, 165, 250)',
    color: 'rgb(96, 165, 250)',
    padding: '3px 7px',
    groupPadding: '0px 6px 4px',
    groupBackground: 'rgb(37, 35, 32)',
    accentBackground: '#1E293B',
    accentText: '#60A5FA',
    surfaceBackground: '#252320',
  });
});

test('sidebar preview data survives reader URL cleanup', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/docs?sidebar=preview');
  await page.evaluate(() => history.replaceState(null, '', '/docs'));
  await page.locator('#_sd_btn-library').click();
  await page.waitForTimeout(350);

  await expect(page.locator('#_sd_sidebar_tag_groups .sdocs-sidebar-tag-group')).toHaveCount(4);
  await expect(page.locator('#_sd_sidebar_recent .sdocs-sidebar-preview-entry')).toHaveCount(3);
});

test('empty local library stays compact and only shows the recent empty state', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/docs?sidebar=empty');
  await page.locator('#_sd_btn-library').click();
  await page.waitForTimeout(350);

  await expect(page.locator('#_sd_sidebar_local_shared_section')).toBeHidden();
  await expect(page.locator('#_sd_sidebar_tag_groups')).toBeHidden();
  const localPanel = page.locator('#_sd_sidebar_local_connected');
  const recent = localPanel.getByRole('button', { name: 'Recent 0', exact: true });
  await expect(recent).toHaveAttribute('aria-expanded', 'false');
  await recent.click();
  await expect(recent).toHaveAttribute('aria-expanded', 'true');
  await expect(localPanel.getByText('No recent documents', { exact: true })).toBeVisible();
  await expect(page.locator('.sdocs-sidebar-section-library')).not.toHaveClass(/has-scrollable-content/);
  await expect(page.locator('#_sd_sidebar_library_panel')).toHaveCSS('box-shadow', 'none');

  const spacing = await page.locator('#_sd_sidebar').evaluate(sidebar => {
    const local = sidebar.querySelector('.sdocs-sidebar-section-library').getBoundingClientRect();
    const cloud = sidebar.querySelector('[data-sidebar-section="cloud"]').getBoundingClientRect();
    return { localHeight: local.height, gap: cloud.top - local.bottom };
  });
  expect(spacing.localHeight).toBeLessThan(180);
  expect(spacing.gap).toBeLessThanOrEqual(4);
});

test('short-link visits add About SmallDocs and standalone Install navigation', async ({ page }) => {
  await page.goto('/s/sidebar-preview');

  await expect(page.getByText('About SmallDocs', { exact: true })).toBeVisible();
  await expect(page.getByText('Install', { exact: true })).toBeVisible();
  await page.getByText('About SmallDocs', { exact: true }).click();
  await expect(page.getByText('SmallDocs is a tool your agents use to produce rich and flexible documents.', { exact: true })).toBeVisible();
  await expect(page.getByText('SmallDoc documents provide deep support for text, code, charts, diagrams, spreadsheets and slides. All formats can be combined. Slides can be exported to PPT and PDF; spreadsheets can be exported to Excel.', { exact: true })).toBeVisible();
  await expect(page.getByText('SmallDocs are written in Markdown and are token-efficient to produce.', { exact: true })).toBeVisible();
  const learnMore = page.locator('#_sd_sidebar_about_panel').getByRole('link', { name: 'Learn more', exact: true });
  await expect(learnMore).toHaveClass(/sdocs-sidebar-cta/);
  await expect(learnMore).toHaveAttribute('href', '/');
  await expect(learnMore).toHaveAttribute('target', '_blank');
  await expect(learnMore).toHaveAttribute('rel', 'noopener');
  await expect(page.getByText('View demo', { exact: true })).toHaveCount(0);
});

test('expanded short-link sections keep row height and scroll the whole sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 520 });
  await page.goto('/s/sidebar-preview');
  await page.getByText('About SmallDocs', { exact: true }).click();
  await page.waitForTimeout(350);

  const beforeScroll = await page.locator('#_sd_sidebar').evaluate(sidebar => {
    const install = sidebar.querySelector('.sdocs-short-link-only[href="/#install"]');
    const footer = sidebar.querySelector('.sdocs-sidebar-footer');
    const style = getComputedStyle(sidebar);
    return {
      clientHeight: sidebar.clientHeight,
      scrollHeight: sidebar.scrollHeight,
      overflowY: style.overflowY,
      scrollbarWidth: style.scrollbarWidth,
      installHeight: install.getBoundingClientRect().height,
      footerTop: footer.getBoundingClientRect().top,
      sidebarBottom: sidebar.getBoundingClientRect().bottom,
    };
  });

  expect(beforeScroll.overflowY).toBe('auto');
  expect(beforeScroll.scrollbarWidth).toBe('none');
  expect(beforeScroll.scrollHeight).toBeGreaterThan(beforeScroll.clientHeight);
  expect(beforeScroll.installHeight).toBe(36);
  expect(beforeScroll.footerTop).toBeGreaterThan(beforeScroll.sidebarBottom);

  await page.locator('#_sd_sidebar').evaluate(sidebar => { sidebar.scrollTop = sidebar.scrollHeight; });
  expect(await page.locator('#_sd_sidebar').evaluate(sidebar => sidebar.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByText('Private by design', { exact: true })).toBeVisible();
});

test('SDK expansion uses the product description and a disabled coming soon action', async ({ page }) => {
  await page.goto('/docs');
  await page.getByText('SDK', { exact: true }).click();

  await expect(page.getByText('Render agent-generated Markdown as rich, interactive documents inside your application with configurable styling.', { exact: true })).toBeVisible();
  const comingSoon = page.locator('#_sd_sidebar_sdk_panel').getByRole('button', { name: 'Coming soon', exact: true });
  await expect(comingSoon).toBeVisible();
  await expect(comingSoon).toBeDisabled();
  await expect(comingSoon).toHaveClass(/sdocs-sidebar-cta/);
  await expect(comingSoon).toHaveCSS('color', 'rgb(168, 162, 158)');
  await expect(page.locator('#_sd_sidebar_sdk_panel').getByText('Learn more', { exact: true })).toHaveCount(0);
  await expect(page.locator('#_sd_sidebar_sdk_panel').getByText('Talk to sales', { exact: true })).toHaveCount(0);
});

test('desktop document shell uses a sidebar and full-width action rail', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/docs?sidebar=preview');

  const sidebar = await page.locator('#_sd_sidebar').boundingBox();
  const toolbar = await page.locator('#_sd_left-toolbar').boundingBox();
  const left = await page.locator('#_sd_left').boundingBox();

  expect(sidebar).not.toBeNull();
  expect(toolbar).not.toBeNull();
  expect(left).not.toBeNull();
  await expect(page.locator('#_sd_sidebar')).toHaveCSS('padding', '27px 14px 16px');
  expect(sidebar.width).toBe(224);
  expect(sidebar.x + sidebar.width).toBe(left.x);
  expect(toolbar.y).toBe(0);
  expect(toolbar.width).toBe(left.width);
  expect(Math.abs((toolbar.x + toolbar.width / 2) - (left.x + left.width / 2))).toBeLessThan(1);
  await expect(page.locator('#_sd_toolbar-brand .sdocs-sidebar-mark')).toBeHidden();
  await expect(page.locator('#_sd_toolbar-brand .toolbar-brand-full')).toBeVisible();
  await expect(page.locator('#_sd_toolbar-brand .toolbar-brand-full')).toHaveCSS('color', 'rgb(37, 99, 235)');
  await expect(page.locator('#_sd_toolbar-brand')).toHaveAttribute('href', '/');
  expect((await page.locator('#_sd_toolbar-brand').boundingBox()).width).toBeLessThan(100);
  await page.locator('#_sd_toolbar-brand').hover();
  await expect(page.locator('#_sd_toolbar-brand')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const footerSpacing = await page.locator('#_sd_sidebar').evaluate(sidebar => ({
    sidebarBottom: sidebar.getBoundingClientRect().bottom,
    footerBottom: sidebar.querySelector('.sdocs-sidebar-footer').getBoundingClientRect().bottom,
    footerMarginTop: getComputedStyle(sidebar.querySelector('.sdocs-sidebar-footer')).marginTop,
  }));
  expect(footerSpacing.footerMarginTop).toBe('12px');
  expect(footerSpacing.sidebarBottom - footerSpacing.footerBottom).toBe(16);
  await expect(page.locator('body > #_sd_statusbar')).toBeHidden();
});

test('collapsed desktop navigation stays at the top of the sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/docs?sidebar=preview');

  const geometry = await page.locator('#_sd_sidebar').evaluate(sidebar => {
    const brand = sidebar.querySelector('#_sd_toolbar-brand').getBoundingClientRect();
    const local = sidebar.querySelector('#_sd_btn-library').getBoundingClientRect();
    return { brandBottom: brand.bottom, localTop: local.top };
  });

  expect(geometry.localTop).toBeGreaterThan(geometry.brandBottom);
  expect(geometry.localTop - geometry.brandBottom).toBeLessThan(40);
});

test('sidebar previews open by click and ignore hover', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/docs?sidebar=preview');

  const panel = page.locator('#_sd_sidebar_library_panel');
  const row = page.locator('#_sd_btn-library');
  const collapsedGeometry = await row.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { height: rect.height, width: rect.width, borderColor: style.borderColor };
  });
  expect(collapsedGeometry.borderColor).toBe('rgba(0, 0, 0, 0)');
  expect(await panel.evaluate(element => element.getBoundingClientRect().height)).toBe(0);
  await row.hover();
  await expect(row).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(row).not.toHaveCSS('border-color', 'rgba(0, 0, 0, 0)');
  await page.waitForTimeout(350);
  expect(await panel.evaluate(element => element.getBoundingClientRect().height)).toBe(0);
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(row).not.toHaveCSS('border-color', 'rgba(0, 0, 0, 0)');
  expect(await row.evaluate((element, before) => {
    const rect = element.getBoundingClientRect();
    return { sameHeight: rect.height === before.height, sameWidth: rect.width === before.width };
  }, collapsedGeometry)).toEqual({ sameHeight: true, sameWidth: true });
  await page.waitForTimeout(350);
  expect(await panel.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(70);
  await expect(page.locator('#_sd_btn-library .sdocs-sidebar-row-chevron')).not.toHaveCSS('transform', 'none');
  await expect(page.locator('#_sd_sidebar_local_shared_section > .sdocs-sidebar-library-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#_sd_sidebar_local_recent_section > .sdocs-sidebar-library-toggle')).toHaveAttribute('aria-expanded', 'false');
  expect(await page.locator('#_sd_sidebar_local_recent_content').evaluate(element => element.getBoundingClientRect().height)).toBe(0);
  await expect(page.getByText('Preview data', { exact: true })).toHaveCount(0);

  const cloud = page.locator('[data-sidebar-section="cloud"] > .doc-site-action');
  await cloud.click();
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await expect(cloud).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#_sd_btn-library .sdocs-sidebar-row-chevron')).toHaveCSS('transform', 'none');
  await cloud.click();
  await expect(cloud).toHaveAttribute('aria-expanded', 'false');
});

test('expanded sidebar groups use the tightened document inset', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/docs?sidebar=preview');
  await page.locator('#_sd_btn-library').click();
  await page.locator('#_sd_sidebar_local_shared_section > .sdocs-sidebar-library-toggle').click();
  await page.waitForTimeout(350);

  const positions = await page.locator('#_sd_sidebar').evaluate(element => {
    const firstItem = element.querySelector('#_sd_sidebar_local_connected .sdocs-sidebar-preview-entry');
    const group = firstItem.closest('.sdocs-sidebar-tag-group');
    const preview = element.querySelector('#_sd_sidebar_local_connected');
    return {
      itemLeft: firstItem.getBoundingClientRect().left + parseFloat(getComputedStyle(firstItem).paddingLeft),
      groupLeft: group.getBoundingClientRect().left,
      previewWidth: preview.getBoundingClientRect().width,
      parentWidth: preview.parentElement.getBoundingClientRect().width,
    };
  });

  expect(Math.abs((positions.itemLeft - positions.groupLeft) - 6)).toBeLessThan(1);
  expect(Math.abs(positions.previewWidth - positions.parentWidth)).toBeLessThan(1);
});

test('connected libraries use the whole-sidebar scroll without inner scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 480 });
  await page.goto('/docs?sidebar=preview');
  await page.locator('#_sd_btn-library').click();
  await page.locator('#_sd_sidebar_local_shared_section > .sdocs-sidebar-library-toggle').click();
  await page.waitForTimeout(350);

  const section = page.locator('.sdocs-sidebar-section-library');
  await expect(section).not.toHaveClass(/has-scrollable-content|has-more-below/);
  await expect(page.locator('.sdocs-sidebar-library-scroll')).toHaveCSS('overflow-y', 'visible');
  await expect(page.locator('.sdocs-sidebar-library-scroll')).toHaveCSS('box-shadow', 'none');

  const localGeometry = await page.locator('#_sd_sidebar').evaluate(sidebar => {
    const section = sidebar.querySelector('.sdocs-sidebar-section-library');
    const fill = section.querySelector('.sdocs-sidebar-library-fill');
    const inner = section.querySelector('.sdocs-sidebar-library-scroll');
    const cta = section.querySelector('.sdocs-sidebar-library-open');
    return {
      sidebarClientHeight: sidebar.clientHeight,
      sidebarScrollHeight: sidebar.scrollHeight,
      sectionHeight: section.getBoundingClientRect().height,
      innerClientHeight: inner.clientHeight,
      innerScrollHeight: inner.scrollHeight,
      ctaWidth: cta.getBoundingClientRect().width,
      fillWidth: fill.getBoundingClientRect().width,
    };
  });

  expect(localGeometry.sidebarScrollHeight).toBeGreaterThan(localGeometry.sidebarClientHeight);
  expect(localGeometry.sectionHeight).toBeGreaterThan(300);
  expect(localGeometry.innerScrollHeight).toBe(localGeometry.innerClientHeight);
  expect(Math.abs(localGeometry.ctaWidth - localGeometry.fillWidth)).toBeLessThan(1);

  await page.getByText('Cloud library', { exact: true }).click();
  await page.locator('#_sd_sidebar_cloud_shared_section > .sdocs-sidebar-library-toggle').click();
  await page.waitForTimeout(350);
  const cloudGeometry = await page.locator('#_sd_sidebar').evaluate(sidebar => {
    const cloud = sidebar.querySelector('[data-sidebar-section="cloud"]');
    const capabilities = sidebar.querySelector('[data-sidebar-section="capabilities"]');
    return {
      clientHeight: sidebar.clientHeight,
      scrollHeight: sidebar.scrollHeight,
      sectionHeight: cloud.getBoundingClientRect().height,
      sectionBottom: cloud.getBoundingClientRect().bottom,
      nextTop: capabilities.getBoundingClientRect().top,
    };
  });
  expect(cloudGeometry.scrollHeight).toBeGreaterThan(cloudGeometry.clientHeight);
  expect(cloudGeometry.sectionHeight).toBeGreaterThan(150);
  expect(cloudGeometry.nextTop).toBeGreaterThanOrEqual(cloudGeometry.sectionBottom);
});

test('non-scrolling expanded sections stay tight and do not cast a shadow', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/docs?sidebar=preview');
  await page.mouse.move(800, 400);
  await page.getByText('Cloud library', { exact: true }).click();
  await page.waitForTimeout(350);

  const cloudPanel = page.locator('#_sd_sidebar_cloud_panel');
  await expect(cloudPanel).toHaveCSS('box-shadow', 'none');
  const boundary = await page.locator('#_sd_sidebar').evaluate(sidebar => {
    const panel = sidebar.querySelector('#_sd_sidebar_cloud_panel').getBoundingClientRect();
    const capabilities = sidebar.querySelector('[data-sidebar-section="capabilities"] > .doc-site-action').getBoundingClientRect();
    return { panelBottom: panel.bottom, nextTop: capabilities.top };
  });
  expect(boundary.panelBottom).toBeLessThanOrEqual(boundary.nextTop);
  expect(boundary.nextTop - boundary.panelBottom).toBeLessThanOrEqual(4);
});

test('sidebar rows and expanded content use one normal-case font size', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/docs?sidebar=preview');
  await page.locator('#_sd_btn-library').click();
  await page.locator('#_sd_sidebar_local_shared_section > .sdocs-sidebar-library-toggle').click();
  await page.waitForTimeout(350);

  const styles = await page.locator('#_sd_sidebar').evaluate(element => {
    const selectors = [
      '#_sd_toolbar-brand .toolbar-brand-full',
      '#_sd_btn-library',
      '.sdocs-sidebar-library-row',
      '.sdocs-sidebar-subitem',
      '.sdocs-sidebar-preview-entry',
      '.sdocs-sidebar-tag',
      '.sdocs-sidebar-footer > a',
      '.sdocs-sidebar-legal',
    ];
    return selectors.map(selector => {
      const target = element.querySelector(selector);
      const style = getComputedStyle(target);
      return { fontSize: style.fontSize, textTransform: style.textTransform };
    });
  });
  expect(styles.every(style => style.fontSize === '13px')).toBe(true);
  expect(styles.every(style => style.textTransform === 'none')).toBe(true);
});
