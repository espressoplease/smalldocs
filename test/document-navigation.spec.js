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
  await expect(page.locator('#_sd_sidebar').getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.locator('#_sd_sidebar').getByText('You agree to our', { exact: false })).toBeVisible();
  await expect(page.locator('#doc-site-menu')).toHaveCount(0);
});

test('toolbar mode buttons use a stable selection ring and toggle panels closed', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/docs');

  const read = page.locator('#_sd_btn-read');
  const info = page.locator('#_sd_btn-info');
  const initialBoxes = await Promise.all([read.boundingBox(), info.boundingBox()]);
  await expect(read).toHaveClass(/active/);
  await expect(read).toHaveAttribute('aria-pressed', 'true');
  await expect(read).toHaveCSS('border-color', 'rgb(212, 207, 201)');
  await expect(info).toHaveAttribute('aria-pressed', 'false');
  await expect(info).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)');

  await info.click();
  await expect(page.locator('body')).toHaveClass(/info-mode/);
  await expect(info).toHaveClass(/active/);
  await expect(info).toHaveAttribute('aria-pressed', 'true');
  await expect(info).toHaveCSS('border-color', 'rgb(212, 207, 201)');
  await expect(read).toHaveAttribute('aria-pressed', 'false');
  const selectedBoxes = await Promise.all([read.boundingBox(), info.boundingBox()]);
  expect(selectedBoxes[0].width).toBe(initialBoxes[0].width);
  expect(selectedBoxes[0].height).toBe(initialBoxes[0].height);
  expect(selectedBoxes[1].width).toBe(initialBoxes[1].width);
  expect(selectedBoxes[1].height).toBe(initialBoxes[1].height);

  await info.click();
  await expect(page.locator('body')).toHaveClass(/read-mode/);
  await expect(read).toHaveAttribute('aria-pressed', 'true');
  await expect(info).toHaveAttribute('aria-pressed', 'false');

  await info.click();
  await read.click();
  await expect(page.locator('body')).toHaveClass(/read-mode/);
  await expect(info).toHaveAttribute('aria-pressed', 'false');

  await info.click();
  const overflow = page.locator('#_sd_btn-overflow');
  const overflowGroup = page.locator('#_sd_toggle-overflow');
  await overflow.click();
  await expect(overflow).toHaveAttribute('aria-expanded', 'true');
  await page.mouse.move(900, 700);
  await expect(overflow).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)');
  await expect(overflow).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const format = page.locator('#_sd_btn-style');
  await format.click();
  await page.mouse.move(900, 700);
  await expect(page.locator('body')).toHaveClass(/style-mode/);
  await expect(format).toHaveAttribute('aria-pressed', 'true');
  await expect(overflowGroup).toHaveClass(/open/);
  await expect(overflow).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await format.click();
  await expect(page.locator('body')).toHaveClass(/read-mode/);
  await expect(read).toHaveAttribute('aria-pressed', 'true');
  await expect(format).toHaveAttribute('aria-pressed', 'false');
  await expect(overflow).toHaveAttribute('aria-expanded', 'false');
  await expect(overflowGroup).not.toHaveClass(/open/);
});

test('mobile panels open fully with a backdrop and an explicit close button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs');
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '1600px';
    document.getElementById('_sd_rendered').appendChild(spacer);
    window.scrollTo(0, 320);
  });
  const initialScroll = await page.evaluate(() => window.scrollY);
  expect(initialScroll).toBeGreaterThan(0);

  const cases = [
    {
      mode: 'style',
      trigger: '#_sd_btn-style',
      panel: '#_sd_right',
      title: 'Format document',
      close: '#_sd_right-close',
      usesOverflow: true,
    },
    {
      mode: 'export',
      trigger: '#_sd_btn-export',
      panel: '#_sd_export-panel',
      title: 'Export document',
      close: '#_sd_export-panel-close',
      usesOverflow: true,
    },
    {
      mode: 'info',
      trigger: '#_sd_btn-info',
      panel: '#_sd_info-panel',
      title: 'Information',
      close: '#_sd_info-panel-close',
      usesOverflow: false,
    },
  ];

  for (const item of cases) {
    if (item.usesOverflow) {
      await page.locator('#_sd_btn-overflow').evaluate(element => element.click());
    }
    await page.locator(item.trigger).evaluate(element => element.click());

    await expect(page.locator('body')).toHaveClass(new RegExp(item.mode + '-mode'));
    await expect(page.locator(item.panel).getByText(item.title, { exact: true })).toBeVisible();
    await expect(page.locator(item.close)).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('overflow', 'visible');
    await expect(page.locator(item.panel)).toHaveCSS('overscroll-behavior', 'contain');
    expect(await page.evaluate(() => window.scrollY)).toBe(initialScroll);
    await expect.poll(async () => {
      const box = await page.locator(item.panel).boundingBox();
      return box ? box.height : 0;
    }).toBeGreaterThan(150);
    await expect.poll(() => page.locator('body').evaluate(element =>
      getComputedStyle(element, '::after').opacity)).toBe('1');
    const backdrop = await page.locator('body').evaluate(element => ({
      pointerEvents: getComputedStyle(element, '::after').pointerEvents,
      touchAction: getComputedStyle(element, '::after').touchAction,
    }));
    expect(backdrop).toEqual({ pointerEvents: 'auto', touchAction: 'none' });

    await page.locator(item.close).evaluate(element => element.click());
    await expect(page.locator('body')).toHaveClass(/read-mode/);
    expect(await page.evaluate(() => window.scrollY)).toBe(initialScroll);
    await expect.poll(() => page.locator('body').evaluate(element =>
      getComputedStyle(element, '::after').opacity)).toBe('0');
  }
});

test('compact desktop navigation uses a click-to-expand rail from 950px', async ({ page }) => {
  await page.setViewportSize({ width: 950, height: 800 });
  await page.goto('/docs?sidebar=preview');

  const menu = page.locator('#_sd_mobile_menu');
  const sidebar = page.locator('#_sd_sidebar');
  const documentPanel = page.locator('#_sd_left');
  const localButton = page.locator('[data-sidebar-section="library"] > .sdocs-sidebar-top-row');
  await expect(menu).toBeHidden();
  await expect(sidebar).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/sdocs-sidebar-collapsed/);
  await expect(sidebar).toHaveAttribute('data-sidebar-collapsed', 'true');
  await expect(page.getByText('Local library', { exact: true })).toBeHidden();

  const collapsed = await Promise.all([sidebar.boundingBox(), documentPanel.boundingBox()]);
  expect(Math.round(collapsed[0].width)).toBe(52);
  expect(Math.round(collapsed[1].x)).toBe(52);
  expect(Math.round(collapsed[1].width)).toBe(898);

  await localButton.hover();
  await expect.poll(() => localButton.evaluate(element =>
    getComputedStyle(element, '::after').opacity)).toBe('1');
  const tooltip = await localButton.evaluate(element => ({
    content: getComputedStyle(element, '::after').content,
    opacity: getComputedStyle(element, '::after').opacity,
  }));
  expect(tooltip.content).toBe('"Local library"');
  expect(tooltip.opacity).toBe('1');

  await localButton.click();
  await expect(page.locator('body')).not.toHaveClass(/sdocs-sidebar-collapsed/);
  await expect(page.getByText('Local library', { exact: true })).toBeVisible();
  await expect(page.locator('[data-sidebar-section="library"]')).toHaveClass(/is-expanded/);
  const expanded = await Promise.all([sidebar.boundingBox(), documentPanel.boundingBox()]);
  expect(Math.round(expanded[0].width)).toBe(224);
  expect(Math.round(expanded[1].x)).toBe(224);
  expect(Math.round(expanded[1].width)).toBe(726);

  await page.locator('.sdocs-sidebar-collapse-toggle').click();
  await expect(page.locator('body')).toHaveClass(/sdocs-sidebar-collapsed/);
  await expect(sidebar).toHaveAttribute('data-sidebar-collapsed', 'true');
  await expect(page.locator('[data-sidebar-section="library"]')).not.toHaveClass(/is-expanded/);
  await expect(localButton).toHaveAttribute('aria-expanded', 'false');

  await page.setViewportSize({ width: 951, height: 800 });
  await expect(page.locator('body')).not.toHaveClass(/sdocs-sidebar-collapsed/);
  await expect(sidebar).toHaveAttribute('data-sidebar-collapsed', 'false');
  await expect(page.locator('.sdocs-sidebar-collapse-toggle')).toBeHidden();
  await page.locator('.sdocs-sidebar-collapse-toggle').evaluate(element => element.click());
  await expect(page.locator('body')).not.toHaveClass(/sdocs-sidebar-collapsed/);
});

test('mobile document controls scroll behind a fixed navigation menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs');

  const toolbar = page.locator('#_sd_left-toolbar');
  const scroller = page.locator('.sdocs-mobile-toolbar-scroll');
  const menu = page.locator('#_sd_mobile_menu');
  const cloudButton = page.locator('[data-sidebar-section="cloud"] > .doc-site-action');
  await expect(toolbar).toHaveCSS('position', 'relative');
  await expect(toolbar).toHaveCSS('height', '44px');
  await expect(page.locator('html')).not.toHaveClass(/sdocs-mobile-page-scrolled/);
  await expect(page.locator('#_sd_left')).toHaveCSS('min-height', '844px');
  await expect(page.locator('.sdocs-mobile-toolbar-brand .toolbar-brand-short')).toBeVisible();
  await expect(page.locator('.sdocs-mobile-toolbar-brand .toolbar-brand-tiny')).toBeHidden();
  await expect(page.locator('#_sd_sidebar > .sdocs-sidebar-main > #_sd_toolbar-brand')).toBeHidden();
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS('order', '-1');
  await expect(menu.locator('.sdocs-mobile-menu-icon')).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#_sd_left')).toHaveCSS('width', '390px');
  await page.locator('#_sd_btn-overflow').click();
  await expect(page.locator('#_sd_toggle-overflow')).toHaveClass(/open/);
  await expect.poll(() => scroller.evaluate(element => element.scrollWidth)).toBeGreaterThan(await scroller.evaluate(element => element.clientWidth));

  const menuBeforeScroll = await menu.boundingBox();
  expect(Math.round(menuBeforeScroll.x)).toBe(0);
  await scroller.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  const menuAfterScroll = await menu.boundingBox();
  expect(menuAfterScroll.x).toBe(menuBeforeScroll.x);
  expect(menuAfterScroll.width).toBe(menuBeforeScroll.width);
  expect(await scroller.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);

  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '1600px';
    document.getElementById('_sd_rendered').appendChild(spacer);
    window.scrollTo(0, 320);
  });
  const initialScroll = await page.evaluate(() => window.scrollY);
  expect(initialScroll).toBeGreaterThan(0);
  await expect(page.locator('html')).toHaveClass(/sdocs-mobile-page-scrolled/);
  await expect(toolbar).toHaveCSS('position', 'sticky');
  expect(Math.round((await toolbar.boundingBox()).y)).toBe(0);

  await menu.evaluate(element => element.click());
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.locator('.sdocs-mobile-menu-close')).toBeVisible();
  await expect(page.locator('#_sd_sidebar')).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('overflow', 'visible');
  await expect(page.locator('#_sd_sidebar')).toHaveCSS('overscroll-behavior', 'contain');
  expect(await page.evaluate(() => window.scrollY)).toBe(initialScroll);
  await expect.poll(async () => Math.round((await page.locator('#_sd_sidebar').boundingBox()).x)).toBe(0);
  const drawer = await page.locator('#_sd_sidebar').boundingBox();
  expect(Math.round(drawer.x)).toBe(0);
  expect(Math.round(drawer.width)).toBe(320);
  await expect(page.getByText('Local library', { exact: true })).toBeHidden();
  await expect(page.getByText('Cloud library', { exact: true })).toBeVisible();
  await page.mouse.click(drawer.x + drawer.width + 20, drawer.y + 80);
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#_sd_sidebar')).toBeHidden();
  await menu.evaluate(element => element.click());
  await expect(page.locator('#_sd_sidebar')).toBeVisible();
  await expect(scroller).toHaveAttribute('inert', '');
  await expect(page.locator('#_sd_content-area')).toHaveAttribute('inert', '');
  await expect(cloudButton).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(menu).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cloudButton).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#_sd_sidebar')).toBeHidden();
  await expect(scroller).not.toHaveAttribute('inert', '');
  await expect(page.locator('#_sd_content-area')).not.toHaveAttribute('inert', '');
  await expect(menu).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(initialScroll);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('html')).not.toHaveClass(/sdocs-mobile-page-scrolled/);
  await expect(toolbar).toHaveCSS('position', 'relative');
  const topGeometry = await page.evaluate(() => {
    const bar = document.getElementById('_sd_left-toolbar').getBoundingClientRect();
    const content = document.getElementById('_sd_content-area').getBoundingClientRect();
    return { barTop: Math.round(bar.top), barBottom: Math.round(bar.bottom), contentTop: Math.round(content.top) };
  });
  expect(topGeometry.barTop).toBe(0);
  expect(topGeometry.contentTop).toBeGreaterThanOrEqual(topGeometry.barBottom);
});

test('short mobile documents fill the viewport with the document background', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs');
  await page.evaluate(() => {
    SDocs.renderedEl.innerHTML = '<p>Short document</p>';
    SDocs.setStyleVar('--md-bg', '#dbeafe');
  });

  const canvas = await page.evaluate(() => {
    const content = document.getElementById('_sd_content-area');
    const rendered = document.getElementById('_sd_rendered');
    const bottomElement = document.elementFromPoint(innerWidth / 2, innerHeight - 1);
    return {
      contentBackground: getComputedStyle(content).backgroundColor,
      renderedBackground: getComputedStyle(rendered).backgroundColor,
      contentBottom: Math.round(content.getBoundingClientRect().bottom),
      viewportBottom: innerHeight,
      bottomIsDocumentCanvas: bottomElement === content || content.contains(bottomElement),
    };
  });

  expect(canvas.contentBackground).toBe('rgb(219, 234, 254)');
  expect(canvas.renderedBackground).toBe(canvas.contentBackground);
  expect(canvas.contentBottom).toBeGreaterThanOrEqual(canvas.viewportBottom);
  expect(canvas.bottomIsDocumentCanvas).toBe(true);
});

test('narrow mobile wordmark collapses to SD inside the scroll rail', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/docs');

  await expect(page.locator('.sdocs-mobile-toolbar-brand .toolbar-brand-short')).toBeHidden();
  await expect(page.locator('.sdocs-mobile-toolbar-brand .toolbar-brand-tiny')).toBeVisible();
});

test('touch menu button does not retain a hover fill after closing', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await page.goto('/docs');
    const menu = page.locator('#_sd_mobile_menu');
    expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches))
      .toBe(false);
    const restingBackground = await menu.evaluate(element => getComputedStyle(element).backgroundColor);
    await menu.tap();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await menu.tap();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => menu.evaluate(element => getComputedStyle(element).backgroundColor))
      .toBe(restingBackground);
  } finally {
    await context.close();
  }
});

test('connected libraries show related documents, recent documents, and open actions', async ({ page }) => {
  await page.goto('/docs?sidebar=preview');

  await page.getByText('Local library', { exact: true }).click();
  const localPanel = page.locator('#_sd_sidebar_local_connected');
  const localOpen = localPanel.getByRole('link', { name: 'Open library', exact: true });
  const localShared = localPanel.getByRole('button', { name: 'Shared tags 4', exact: true });
  const localRecent = localPanel.getByRole('button', { name: 'Recent 10', exact: true });
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
  await expect(page.getByText('Sign in', { exact: true })).toBeVisible();
});

test('connected Local Library uses indexed documents and excludes the open file', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sdocs.connect', JSON.stringify({ connected: true }));
  });
  await page.route('http://127.0.0.1:47843/api/library/data', route => route.fulfill({
    status: 200,
    headers: { 'Access-Control-Allow-Origin': route.request().headers().origin },
    json: {
      entries: [
        { id: 'current', title: 'Open document', path: '/notes/current.md', tags: ['design', 'product'], mtime: '2026-08-28T12:00:00Z' },
        { id: 'related', title: 'Related document', path: '/notes/related.md', tags: ['design', 'product'], mtime: '2026-08-27T12:00:00Z' },
        { id: 'design', title: 'Design notes', path: '/notes/design.md', tags: ['design'], mtime: '2026-08-26T12:00:00Z' },
      ],
    },
  }));
  await page.goto('/docs');
  await page.evaluate(() => {
    window.SDocs.localMeta = { fullPath: '/notes/current.md' };
    window.SDocs.currentMeta = { tags: ['design', 'product'] };
    window.SDocs.sidebarRefresh();
  });

  await page.getByText('Local library', { exact: true }).click();
  const panel = page.locator('#_sd_sidebar_local_connected');
  const shared = panel.getByRole('button', { name: 'Shared tags 2', exact: true });
  const recent = panel.getByRole('button', { name: 'Recent 2', exact: true });
  await expect(shared).toBeVisible();
  await expect(recent).toBeVisible();
  await shared.click();
  const sharedGroups = page.locator('#_sd_sidebar_tag_groups');
  await expect(sharedGroups.getByText('Related document', { exact: true })).toBeVisible();
  await expect(sharedGroups.getByText('Design notes', { exact: true })).toBeVisible();
  await expect(panel.getByText('Open document', { exact: true })).toHaveCount(0);
  await recent.click();
  await expect(page.locator('#_sd_sidebar_recent .sdocs-sidebar-preview-entry')).toHaveText([
    'Related document',
    'Design notes',
  ]);
});

test('connected Cloud Library loads paginated documents and links directly to them', async ({ page }) => {
  const requests = [];
  await page.route('**/api/cloud/v1/documents?**', route => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    if (!url.searchParams.get('cursor')) return route.fulfill({ json: {
      documents: [
        { id: 'cloud-current', title: 'Open Cloud document', filename: 'open.md', tags: ['design'], updated_at: '2026-08-28T12:00:00Z' },
        { id: 'cloud-related', title: 'Cloud design notes', filename: 'design.md', tags: ['design'], updated_at: '2026-08-27T12:00:00Z' },
      ],
      next_cursor: 'page-2',
    } });
    return route.fulfill({ json: {
      documents: [
        { id: 'cloud-recent', title: 'Cloud release notes', filename: 'release.md', tags: ['release'], updated_at: '2026-08-26T12:00:00Z' },
      ],
      next_cursor: null,
    } });
  });
  await page.goto('/docs');
  await page.evaluate(() => {
    const sidebar = document.getElementById('_sd_sidebar');
    sidebar.dataset.cloudAuthenticated = 'true';
    window.SDocs.currentMeta = { tags: ['design'] };
    window.SDocs.cloudDocument = { id: 'cloud-current', workspace_id: 'account-1' };
    window.SDocs.sidebarRefresh();
  });

  await page.getByText('Cloud library', { exact: true }).click();
  const panel = page.locator('#_sd_sidebar_cloud_connected');
  const shared = panel.getByRole('button', { name: 'Shared tags 1', exact: true });
  const recent = panel.getByRole('button', { name: 'Recent 2', exact: true });
  await expect(shared).toBeVisible();
  await expect(recent).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toContain('workspace_id=account-1');
  expect(requests[1]).toContain('cursor=page-2');
  await shared.click();
  const related = page.locator('#_sd_sidebar_cloud_tag_groups').getByText('Cloud design notes', { exact: true });
  await expect(related).toHaveAttribute('href', '/docs?cloud-document=cloud-related');
  await expect(panel.getByText('Open Cloud document', { exact: true })).toHaveCount(0);
  await expect(panel.locator('.sdocs-sidebar-tag').first()).toHaveAttribute('href', '/library?scope=cloud&tag=design');
});

test('library loading failures provide recovery actions', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sdocs.connect', JSON.stringify({ connected: true }));
  });
  let localAttempts = 0;
  await page.route('http://127.0.0.1:47843/api/library/data', route => {
    localAttempts += 1;
    const headers = { 'Access-Control-Allow-Origin': route.request().headers().origin };
    if (localAttempts === 1) return route.fulfill({ status: 503, headers, body: '{}' });
    return route.fulfill({ status: 200, headers, json: { entries: [] } });
  });
  await page.goto('/docs');
  await page.getByText('Local library', { exact: true }).click();
  const localStatus = page.locator('#_sd_sidebar_local_status');
  await expect(localStatus).toContainText('Local Library is unavailable.');
  await localStatus.getByRole('button', { name: 'Retry' }).click();
  await expect(localStatus).toBeHidden();
  await expect(page.locator('#_sd_sidebar_local_recent_count')).toHaveText('0');

  await page.route('**/api/cloud/v1/documents?**', route => route.fulfill({ status: 401, json: {
    ok: false, error: 'authentication_required',
  } }));
  await page.evaluate(() => {
    document.getElementById('_sd_sidebar').dataset.cloudAuthenticated = 'true';
    window.SDocs.sidebarRefresh();
  });
  await page.getByText('Cloud library', { exact: true }).click();
  const cloudStatus = page.locator('#_sd_sidebar_cloud_status');
  await expect(cloudStatus).toContainText('Sign in to load Cloud documents.');
  await expect(cloudStatus.getByRole('button', { name: 'Sign in' })).toBeVisible();
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

  const truncated = page.locator('#_sd_sidebar_tag_groups').getByText('SmallDocs renderer roadmap', { exact: true });
  await expect(truncated).toHaveAttribute('data-tip', 'SmallDocs renderer roadmap');
  await expect(page.locator('#_sd_sidebar_tag_groups').getByText('Research plan', { exact: true })).not.toHaveAttribute('data-tip');
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
  await expect(page.locator('#_sd_sidebar_recent .sdocs-sidebar-preview-entry')).toHaveCount(10);
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
    ];
    return selectors.map(selector => {
      const target = element.querySelector(selector);
      const style = getComputedStyle(target);
      return { fontSize: style.fontSize, textTransform: style.textTransform };
    });
  });
  expect(styles.every(style => style.fontSize === '13px')).toBe(true);
  expect(styles.every(style => style.textTransform === 'none')).toBe(true);
  await expect(page.locator('.sdocs-sidebar-legal')).toHaveCSS('font-size', '11px');
});
