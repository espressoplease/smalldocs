const { test, expect } = require('@playwright/test');
const { startFixture } = require('./cloud-onboarding-fixture');
test.use({ serviceWorkers: 'block' });
let f, url, savedDocument, workspaceId;
test.beforeEach(async ({ page }) => {
  f = await startFixture({ singlePlan: true });
  const setup = await f.api('josh', '/api/cloud/v1/onboarding/complete', 'POST', {});
  workspaceId = setup.data.workspaces[0].id;
  const saved = await f.api('josh', '/api/cloud/v1/account/documents', 'POST', {
    account_id: setup.data.workspaces[0].id, filename: 'guide.md',
    markdown: '# A working guide\n\n## First section\n\nFirst passage.\n\n## Second section\n\nSecond passage.\n',
    source_file: { absolute_path: '/Users/josh/Documents/guide.md' },
    idempotency_key: 'document-actions',
  });
  expect(saved.status).toBe(201);
  savedDocument = saved.data.document;
  url = f.origin + '/docs?cloud-document=' + saved.data.document.id;
  await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.josh.sessionToken, url: f.origin }]);
});

for (const width of [1328, 390, 320]) {
  test('context tools follow document icons and keep every pill 40px high at ' + width + 'px', async ({ page, context }) => {
    await page.setViewportSize({ width, height: 844 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const note = await f.api('josh', '/api/cloud/v1/documents/' + savedDocument.id + '/comments/actions', 'POST', {
      action: 'add', anchor: { kind: 'inline', quote: 'First passage.' }, text: 'Review this passage.',
      base_revision_id: savedDocument.current_revision_id, idempotency_key: 'context-tools-comment',
    });
    expect(note.status).toBe(201);
    await page.goto(url);
    await page.getByRole('button', { name: 'Edit document', exact: true }).click();
    const editTools = page.getByRole('toolbar', { name: 'Editing tools' });
    await expect(editTools).toBeVisible();
    await expect(editTools.locator('.sdoc-toolbar-pill')).toHaveCount(5);
    await expect(editTools.getByRole('group', { name: 'Edit history', exact: true })).toBeVisible();
    await page.locator('#_sd_write-toolbar').evaluate(el =>
      Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
    async function checkPills(toolbar) {
      const primary = await page.locator('#_sd_left-toolbar').boundingBox();
      const rectangles = await toolbar.locator('.sdoc-toolbar-pill').evaluateAll(pills =>
        pills.filter(pill => pill.getClientRects().length && getComputedStyle(pill).visibility !== 'hidden')
          .map(pill => { const box = pill.getBoundingClientRect(); return { height: box.height, top: box.top, left: box.left, right: box.right }; }));
      expect(rectangles.length).toBeGreaterThan(0);
      for (const rect of rectangles) {
        expect(rect.height).toBe(40);
        expect(rect.top).toBeGreaterThanOrEqual(primary.y + primary.height);
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(width);
      }
    }
    await checkPills(editTools);
    await page.evaluate(() => {
      const paragraph = document.querySelector('#_sd_write p');
      const range = document.createRange(); range.selectNodeContents(paragraph); range.collapse(false);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.getByRole('combobox', { name: 'Text style' }).selectOption('h5');
    await expect(page.locator('#_sd_write h5')).toHaveText('First passage.');
    await page.getByRole('combobox', { name: 'Text style' }).selectOption('p');
    await expect(page.locator('#_sd_write p').first()).toHaveText('First passage.');
    await page.getByRole('button', { name: 'Comment mode', exact: true }).click();
    const commentTools = page.getByRole('toolbar', { name: 'Comment tools' });
    await expect(commentTools).toBeVisible();
    await page.locator('#_sd_comment-toolbar').evaluate(el =>
      Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
    await checkPills(commentTools);
    await commentTools.getByRole('button', { name: 'Copy document with comments' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Review this passage.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Read', exact: true }).click();
    await expect(editTools).toBeHidden();
    await expect(commentTools).toBeHidden();
  });
}
test.afterEach(async () => { await f.close(); });

for (const width of [1328, 390, 320]) {
  test('actions and context pills stay together while scrolling at ' + width + 'px', async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const markdown = '# A longer guide\n\n' + Array.from({ length: 36 }, (_, i) =>
      '## Section ' + i + '\n\nPassage ' + i + '. ' + 'A practical detail for this section. '.repeat(12)).join('\n\n');
    const saved = await f.api('josh', '/api/cloud/v1/account/documents', 'POST', {
      account_id: workspaceId, filename: 'longer-guide.md', markdown,
      idempotency_key: 'sticky-tools-document',
    });
    expect(saved.status).toBe(201);
    const note = await f.api('josh', '/api/cloud/v1/documents/' + saved.data.document.id + '/comments/actions', 'POST', {
      action: 'add', anchor: { kind: 'inline', quote: 'Passage 18.' }, text: 'Check this detail.',
      base_revision_id: saved.data.document.current_revision_id, idempotency_key: 'sticky-tools-comment',
    });
    expect(note.status).toBe(201);
    await page.goto(f.origin + '/docs?cloud-document=' + saved.data.document.id);
    const mobile = width <= 768;
    const surface = page.locator(mobile ? '#_sd_mobile-header' : '#_sd_document-tools');
    const viewportTop = 0;
    const top = mobile ? 0 : -6;
    const initial = await surface.boundingBox();
    if (mobile) expect(initial.y).toBe(top);
    else expect(initial.y).toBeGreaterThan(top);
    await page.getByRole('button', { name: 'Expand all', exact: true }).click();
    await page.locator('#_sd_rendered p').filter({ hasText: 'Passage 18.' }).evaluate(el =>
      el.scrollIntoView({ block: 'start' }));
    async function checkSticky() {
      await expect.poll(async () => Math.round((await surface.boundingBox()).y)).toBe(top);
      const background = await page.evaluate(() => ({
        tools: getComputedStyle(document.getElementById('_sd_document-tools')).backgroundColor,
        document: getComputedStyle(document.getElementById('_sd_rendered')).backgroundColor,
      }));
      expect(background.tools).toBe(background.document);
      expect(background.tools).not.toBe('rgba(0, 0, 0, 0)');
    }
    await checkSticky();
    const read = await page.getByRole('button', { name: 'Read', exact: true }).boundingBox();
    const pinned = await surface.boundingBox();
    const spaceAbove = read.y - viewportTop;
    const spaceBelow = pinned.y + pinned.height - read.y - read.height;
    expect(spaceAbove).toBeCloseTo(spaceBelow, 4);
    expect(spaceAbove).toBe(mobile ? 7 : 12);
    const passage = page.locator('#_sd_rendered p').filter({ hasText: 'Passage 18.' });
    const passageBefore = await passage.boundingBox();
    // Click the visible sticky icon as a reader would. Locator.click first
    // scrolls its flow position into view, moving the passage before the click.
    const commentButton = await page.getByRole('button', { name: 'Comment mode', exact: true }).boundingBox();
    await page.mouse.click(commentButton.x + commentButton.width / 2, commentButton.y + commentButton.height / 2);
    const comments = page.getByRole('toolbar', { name: 'Comment tools' });
    await expect(comments).toBeVisible();
    await comments.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
    await checkSticky();
    const passageAfter = await passage.boundingBox();
    expect(Math.abs(passageAfter.y - passageBefore.y)).toBeLessThan(200);
    const actions = await page.locator('#_sd_left-toolbar').boundingBox();
    const pills = await comments.boundingBox();
    expect(pills.y).toBeGreaterThanOrEqual(actions.y + actions.height);
    expect(pills.y + pills.height).toBeLessThan(844);
    await comments.getByRole('button', { name: 'Next comment', exact: true }).click();
    await expect.poll(async () => {
      const card = await page.locator('.sdoc-card').filter({ hasText: 'Check this detail.' }).first().boundingBox();
      const tools = await surface.boundingBox();
      return card && card.y >= tools.y + tools.height && card.y + card.height <= 844;
    }).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('sticky-comment-tools.png') });
    await page.getByRole('button', { name: 'Edit document', exact: true }).click();
    const editing = page.getByRole('toolbar', { name: 'Editing tools' });
    await expect(editing).toBeVisible();
    await editing.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
    await checkSticky();
    const editBox = await editing.boundingBox();
    expect(editBox.y + editBox.height).toBeLessThan(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Read', exact: true }).click();
    await expect(editing).toBeHidden();
    const themeButton = await page.getByRole('button', { name: 'Toggle dark mode', exact: true }).boundingBox();
    await page.mouse.click(themeButton.x + themeButton.width / 2, themeButton.y + themeButton.height / 2);
    await checkSticky();
    await page.evaluate(() => window.SDocs.applyStylesFromMeta({ background: '#123142', color: '#f4ede1' }));
    await expect.poll(async () => page.evaluate(() => getComputedStyle(document.getElementById('_sd_document-tools')).backgroundColor)).toBe('rgb(18, 49, 66)');
    await checkSticky();
    await page.screenshot({ path: testInfo.outputPath('sticky-tools.png') });
    await page.evaluate(() => { if (innerWidth <= 768) scrollTo(0, 0); else document.getElementById('_sd_content-area').scrollTop = 0; });
    if (mobile) await expect.poll(async () => (await surface.boundingBox()).y).toBe(top);
    else await expect.poll(async () => (await surface.boundingBox()).y).toBeGreaterThan(top);
    await expect(page.locator('#_sd_rendered h1')).toBeInViewport();
  });
}

test('document actions sit between file info and the title and retain their handlers', async ({ page, context }) => {
  await page.setViewportSize({ width: 1328, height: 801 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(url);
  const toolbar = page.getByRole('toolbar', { name: 'Document actions' });
  await expect(toolbar).toBeVisible();
  const info = await page.locator('#_sd_sdocs-file-info').boundingBox();
  const actions = await toolbar.boundingBox();
  const title = await page.locator('#_sd_rendered h1').boundingBox();
  expect(actions.y).toBeGreaterThanOrEqual(info.y + info.height);
  expect(actions.y + actions.height).toBeLessThanOrEqual(title.y);
  await page.getByRole('button', { name: 'Copy document', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Second passage.');
  await page.locator('#_sd_btn-fold').click();
  await expect(page.locator('#_sd_btn-fold')).toHaveClass(/is-open/);
  await expect(page.locator('#_sd_btn-fold')).toHaveAttribute('aria-label', 'Collapse all');
  await expect(page.locator('#_sd_btn-fold .icon-fold')).toBeVisible();
  await page.locator('#_sd_btn-fold').click();
  await expect(page.locator('#_sd_btn-fold')).toHaveAttribute('aria-label', 'Expand all');
  await expect(page.locator('#_sd_btn-fold .icon-unfold')).toBeVisible();
  await expect(page.locator('#_sd_rendered .md-section-body.open')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit document', exact: true }).click();
  await expect(page.locator('#_sd_write')).toBeVisible();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByRole('button', { name: 'Format document', exact: true }).click();
  await expect(page.locator('body')).toHaveClass(/style-mode/);
  await page.getByRole('button', { name: 'Format document', exact: true }).click();
  await expect(page.locator('body')).toHaveClass(/read-mode/);
});

for (const width of [320, 390, 768]) {
  test('mobile document controls share the 44px top menu above Cloud and copyable file information at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(url);
    const actions = page.getByRole('toolbar', { name: 'Document actions' });
    await expect(actions).toBeVisible();
    await expect(page.locator('#_sd_content-area #_sd_left-toolbar')).toHaveCount(0);
    await expect(page.locator('#_sd_mobile-navigation #_sd_left-toolbar')).toHaveCount(1);
    await expect(page.locator('#_sd_mobile-header')).toHaveCSS('height', '44px');
    const toolbar = await page.locator('#_sd_left-toolbar').boundingBox();
    expect(toolbar.y).toBe(0);
    expect(toolbar.height).toBe(44);
    const info = page.locator('#_sd_sdocs-file-info');
    await expect(info.locator('.fic-row-cloud')).toHaveCount(1);
    await expect(info.locator('.fic-row').first()).toHaveClass(/fic-row-cloud/);
    await expect(info.locator('[data-key="title"] .fic-value')).toHaveText('A working guide');
    await expect(info.locator('[data-key="fullPath"] .fic-value')).toHaveText('/Users/josh/Documents/guide.md');
    const cloud = await info.boundingBox();
    const heading = await page.locator('#_sd_rendered h1').boundingBox();
    expect(cloud.y).toBeGreaterThanOrEqual(44);
    expect(heading.y).toBeGreaterThanOrEqual(cloud.y + cloud.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('resizing between mobile and desktop reuses the same working controls', async ({ page }) => {
  await page.setViewportSize({ width: 1328, height: 844 });
  await page.goto(url);
  await page.getByRole('button', { name: 'Comment mode', exact: true }).click();
  for (const width of [390, 769, 320, 1328]) {
    await page.setViewportSize({ width, height: 844 });
    const mobile = width <= 768;
    await expect(page.locator(mobile ? '#_sd_mobile-navigation #_sd_left-toolbar' : '#_sd_document-tools #_sd_left-toolbar')).toHaveCount(1);
    await expect(page.locator('#_sd_btn-comment')).toHaveCount(1);
    await expect(page.locator('#_sd_left-toolbar')).not.toHaveAttribute('inert');
    await expect(page.getByRole('toolbar', { name: 'Comment tools' })).toBeVisible();
    await expect(page.locator(mobile ? '#_sd_mobile-header #_sd_comment-toolbar' : '#_sd_content-area #_sd_comment-toolbar')).toHaveCount(1);
    await page.getByRole('button', { name: 'Read', exact: true }).click();
    await expect(page.getByRole('toolbar', { name: 'Comment tools' })).toBeHidden();
    await page.getByRole('button', { name: 'Comment mode', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 320) {
      await page.getByRole('button', { name: 'Open SmallDocs menu', exact: true }).click();
      await expect(page.locator('#_sd_left-toolbar')).toHaveAttribute('inert', '');
      await expect(page.locator('#_sd_mobile-header')).toHaveCSS('height', '44px');
    }
  }
});

test('account icons sit together above the trial and work from the compact rail', async ({ page }) => {
  await page.setViewportSize({ width: 1328, height: 801 });
  await page.goto(url);
  const settings = page.locator('.sdocs-sidebar-settings-shortcut');
  const updates = page.getByRole('button', { name: "What's new", exact: true });
  const trial = page.locator('.sdocs-sidebar-subscription');
  await expect(settings).toHaveAttribute('href', '/cloud/admin');
  await expect(settings).toHaveCSS('border-radius', '50%');
  await expect(settings).toHaveText('');
  await expect(updates).toHaveCSS('border-radius', '50%');
  await expect(page.getByRole('toolbar', { name: 'Document actions' }).locator('#_sd_btn-info')).toHaveCount(0);
  await expect(trial).toBeVisible();
  const gear = await settings.boundingBox(), subscription = await trial.boundingBox();
  const info = await updates.boundingBox();
  expect(info.y).toBe(gear.y);
  expect(info.x).toBeGreaterThan(gear.x + gear.width);
  expect(gear.y + gear.height).toBeLessThan(subscription.y);
  await updates.click();
  await expect(page.locator('#_sd_info-panel')).toBeVisible();
  await expect(updates).toHaveAttribute('aria-pressed', 'true');
  await updates.click();
  await page.route('**/api/cloud/billing/subscription', route => route.fulfill({ json: { phase: 'active' } }));
  await page.reload();
  await expect(trial).toHaveCount(0);
  const paidGear = await settings.boundingBox();
  expect(paidGear.y).toBeGreaterThan(700);
  await page.setViewportSize({ width: 900, height: 801 });
  await expect(page.locator('body')).toHaveClass(/sdocs-sidebar-collapsed/);
  await updates.click();
  await expect(page.locator('#_sd_info-panel')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/sdocs-sidebar-collapsed/);
  await updates.click();
  await settings.click();
  await expect(page).toHaveURL(f.origin + '/cloud/admin');
  await expect(page.locator('#_sd_site_sidebar .sdocs-sidebar-settings-shortcut'))
    .toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#_sd_site_sidebar [data-sidebar-section="capabilities"], .sdocs-sidebar-footer-link')).toHaveCount(0);
  await page.getByRole('button', { name: "What's new", exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Information' })).toBeVisible();
});

test('mobile actions fit the document and the settings shortcut stays reachable in the drawer', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(url);
  await expect(page.getByRole('toolbar', { name: 'Document actions' })).toBeVisible();
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.locator('body')).toHaveClass(/export-mode/);
  await page.getByRole('button', { name: 'Close export panel', exact: true }).click();
  await page.getByRole('button', { name: 'Open SmallDocs menu', exact: true }).click();
  await expect(page.locator('.sdocs-sidebar-settings-shortcut')).toBeVisible();
  await page.getByRole('button', { name: "What's new", exact: true }).click();
  await expect(page.locator('body')).not.toHaveClass(/sdocs-mobile-nav-open/);
  await expect(page.locator('#_sd_info-panel')).toBeVisible();
  await expect(page.locator('#_sd_content-area')).not.toHaveAttribute('inert');
  await page.locator('#_sd_info-panel-close').click();
  await expect(page.locator('#_sd_info-panel')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
