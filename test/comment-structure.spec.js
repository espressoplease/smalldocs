const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { startFixture } = require('./cloud-onboarding-fixture');
const guide = fs.readFileSync(path.join(__dirname, 'fixtures/comment-structure.md'), 'utf8');
test.use({ serviceWorkers: 'block' });

async function load(page, markdown = guide) {
  await page.goto('/docs');
  await page.waitForFunction(() => window.SDocs && SDocs._appReady);
  await page.evaluate(md => {
    SDocs.loadText(md); SDocs.setMode('read'); SDocs.setAllSectionsOpen(true);
  }, markdown);
}
async function structure(page) {
  return page.evaluate(() => {
    const root = SDocs.renderedEl.cloneNode(true);
    root.querySelectorAll('.sdoc-card, button, .pre-tools').forEach(el => el.remove());
    root.querySelectorAll('.sdoc-element-host, .sdoc-block-host, .sdoc-table-host, .sdoc-anchor').forEach(el => el.replaceWith(...el.childNodes));
    return {
      lists: Array.from(root.querySelectorAll('ol,ul')).map(el => ({ tag: el.tagName, start: el.getAttribute('start'), reversed: el.hasAttribute('reversed'), children: Array.from(el.children).map(li => ({ tag: li.tagName, value: li.getAttribute('value'), text: li.textContent })) })),
      paragraphs: Array.from(root.querySelectorAll('p')).map(el => el.textContent),
      code: Array.from(root.querySelectorAll('pre')).map(el => el.textContent),
      invalidListChildren: root.querySelectorAll('ol > :not(li), ul > :not(li)').length,
    };
  });
}
async function markers(page) {
  const session = await page.context().newCDPSession(page);
  try {
    const tree = await session.send('Accessibility.getFullAXTree');
    return tree.nodes.filter(n => n.role && n.role.value === 'ListMarker').map(n => n.name.value);
  } finally { await session.detach(); }
}
async function addCrossItemComment(page) {
  await page.evaluate(() => {
    const S = SDocs, C = SDocComments, block = S.renderedEl.querySelector('ol');
    const text = S.commentsUi._cleanAnchorText(block);
    const from = text.indexOf('First'), end = text.indexOf('Third');
    S.currentMeta = C.addSelectionComment(S.currentMeta, {
      quote: text.slice(from, end).trimEnd(), block: 'ol:0', block_text: text.trim().slice(0, 240),
      document_hash: C.documentFingerprint(S.currentBody), quote_offset: from,
    }, { author: 'Reviewer', text: 'Check both steps.' }).meta;
    S.setMode('comment');
  });
}

test('saved inline comments spanning ordered items preserve numbering and list structure', async ({ page }) => {
  await load(page, '3. First step with **formatted text**.\n4. Second step with `code`.\n5. Third step.\n');
  const before = await structure(page), numbers = await markers(page);
  expect(numbers).toEqual(['3. ', '4. ', '5. ']);
  await addCrossItemComment(page);
  await expect(page.locator('.sdoc-card[data-c="c1"]')).toHaveCount(1);
  await expect(page.locator('.sdoc-card-orphaned')).toHaveCount(0);
  expect(await structure(page)).toEqual(before);
  expect(await markers(page)).toEqual(numbers);
  await page.evaluate(() => { SDocs.setMode('read'); SDocs.setMode('comment'); });
  expect(await structure(page)).toEqual(before);
});

test('selection by list child offsets preserves items during compose, cancel, save and delete', async ({ page }) => {
  await load(page, '1. First step.\n2. Second step.\n3. Third step.\n');
  const before = await structure(page), numbers = await markers(page);
  await page.evaluate(() => {
    SDocs.setMode('comment');
    const list = SDocs.renderedEl.querySelector('ol'), range = document.createRange();
    range.setStartBefore(list.children[0]); range.setEndAfter(list.children[1]);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const add = page.getByRole('button', { name: 'Comment on selection', exact: true });
  await add.click();
  expect(await structure(page)).toEqual(before);
  expect(await markers(page)).toEqual(numbers);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await structure(page)).toEqual(before);
  await page.evaluate(() => {
    const list = SDocs.renderedEl.querySelector('ol'), range = document.createRange();
    range.setStartBefore(list.children[0]); range.setEndAfter(list.children[1]);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await add.click();
  await page.locator('.sdoc-card-edit .sdoc-card-input').fill('Review the first two steps.');
  await page.locator('.sdoc-card-edit .sdoc-card-save').click();
  await expect(page.locator('.sdoc-card[data-c="c1"]')).toHaveCount(1);
  expect(await structure(page)).toEqual(before);
  expect(await markers(page)).toEqual(numbers);
  await page.locator('.sdoc-card[data-c="c1"] .sdoc-card-delete').click();
  await expect(page.locator('.sdoc-anchor, .sdoc-card')).toHaveCount(0);
  expect(await structure(page)).toEqual(before);
});

for (const width of [1440, 390]) {
  test('complex list items retain paragraphs, nested lists and code through comment lifecycle at ' + width, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await load(page);
    const before = await structure(page), numbers = await markers(page);
    await page.evaluate(() => SDocs.setMode('comment'));
    expect(await structure(page)).toEqual(before);
    const item = page.locator('#_sd_rendered ol').first().locator(':scope > li').first();
    await item.locator(':scope > .sdoc-element-host > .sdoc-element-add').click({ force: true });
    await page.locator('.sdoc-element-card .sdoc-card-input').fill('Check the complete release preparation step.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.sdoc-element-card')).toHaveCount(1);
    await expect(item.locator(':scope > .sdoc-element-host').last()).toContainText('This paragraph still belongs to step three.');
    await expect(item.locator(':scope > .sdoc-element-host').last().locator('.sdoc-element-card')).toHaveCount(1);
    await page.evaluate(() => {
      const S = SDocs, C = SDocComments;
      for (const quote of ['20 minutes', 'if (!release.approved) {', 'inline_code']) {
        S.currentMeta = C.addSelectionComment(S.currentMeta, { quote }, { author: 'Reviewer', text: 'Inspect ' + quote }).meta;
      }
      S.currentMeta = C.addBlockComment(S.currentMeta, { block: 'ol:0', block_text: S.commentsUi._cleanAnchorText(S.renderedEl.querySelector('ol')).trim().slice(0, 240) }, { text: 'Review the complete checklist.' }).meta;
      S.syncAll('comment'); S.setAllSectionsOpen(true);
    });
    await expect(page.locator('.sdoc-card-orphaned')).toHaveCount(0);
    expect(await structure(page)).toEqual(before);
    expect(await markers(page)).toEqual(numbers);
    await page.screenshot({ path: testInfo.outputPath('complex-comments-' + width + '.png') });
    for (let i = 0; i < 3; i++) await page.evaluate(() => { SDocs.setMode('read'); SDocs.setMode('comment'); SDocs.commentsUi.render(); });
    expect(await structure(page)).toEqual(before);
    expect(await markers(page)).toEqual(numbers);
    await page.evaluate(() => {
      const S = SDocs, text = SDocYaml.serializeFrontMatter(S.currentMeta) + '\n' + S.currentBody;
      S.loadText(text); S.setMode('comment'); S.setAllSectionsOpen(true);
    });
    expect(await structure(page)).toEqual(before);
    expect(await markers(page)).toEqual(numbers);
  });
}

test('complete quote context survives a new item above its original list', async ({ page }) => {
  await load(page, '1. First\n2. Target\n3. Third\n');
  await page.evaluate(() => {
    SDocs.currentMeta = SDocComments.addSelectionComment({}, {
      quote: 'Target', prefix: 'First\n', suffix: '\nThird\n', block: 'ol:0', block_text: 'First\nTarget\nThird\n',
    }, { text: 'Keep this attached.' }).meta;
    SDocs.currentBody = '1. Inserted\n2. First\n3. Target\n4. Third\n';
    SDocs.render(); SDocs.setMode('comment');
  });
  await expect(page.locator('.sdoc-anchor[data-c="c1"]')).toHaveText('Target');
  await expect(page.locator('.sdoc-card-orphaned')).toHaveCount(0);
});

test('repeated list context becomes ambiguous after an unrelated edit instead of moving to the first item', async ({ page }) => {
  const repeated = 'A'.repeat(50) + 'target' + 'Z'.repeat(50);
  await load(page, '1. ' + repeated + '\n2. ' + repeated + '\n');
  await page.evaluate(() => {
    const S = SDocs, C = SDocComments, list = S.renderedEl.querySelector('ol'), text = S.commentsUi._cleanAnchorText(list);
    S.currentMeta = C.addSelectionComment({}, {
      quote: 'target', prefix: 'A'.repeat(40), suffix: 'Z'.repeat(40), block: 'ol:0', block_text: text.trim(),
      document_hash: C.documentFingerprint(S.currentBody), quote_offset: text.lastIndexOf('target'),
    }, { text: 'Only the selected occurrence.' }).meta;
    S.setMode('comment');
  });
  await expect(page.locator('#_sd_rendered ol > li').nth(1).locator('.sdoc-anchor')).toHaveText('target');
  await page.evaluate(() => { SDocs.currentBody += '\nAn unrelated paragraph.\n'; SDocs.render(); });
  await expect(page.locator('.sdoc-anchor[data-c="c1"]')).toHaveCount(0);
  await expect(page.locator('.sdoc-card[data-c="c1"] .sdoc-card-orphan-badge')).toHaveText('anchor ambiguous');
});

test('overlapping complete contexts remain ambiguous after the source changes', async ({ page }) => {
  await load(page, '- ' + 'same text '.repeat(10) + '\n');
  await page.evaluate(() => {
    const S = SDocs, C = SDocComments, text = S.commentsUi._cleanAnchorText(S.renderedEl.querySelector('ul'));
    const at = text.indexOf('same', 45), quote = 'same';
    S.currentMeta = C.addSelectionComment({}, {
      quote, prefix: text.slice(at - 40, at), suffix: text.slice(at + quote.length, at + quote.length + 40),
      block: 'ul:0', block_text: text.trim(), document_hash: C.documentFingerprint(S.currentBody), quote_offset: at,
    }, { text: 'The selected occurrence.' }).meta;
    S.currentBody += '\nAnother paragraph.\n'; S.render(); S.setMode('comment');
  });
  await expect(page.locator('.sdoc-anchor[data-c="c1"]')).toHaveCount(0);
  await expect(page.locator('.sdoc-card[data-c="c1"] .sdoc-card-orphan-badge')).toHaveText('anchor ambiguous');
});

test('a late renderer from the previous document cannot replace current comment controls', async ({ page }) => {
  await load(page, 'An earlier document.\n');
  await page.evaluate(() => {
    const S = SDocs, original = S.processHighlight;
    S.processHighlight = () => new Promise(resolve => { window.finishOldHighlight = resolve; });
    S.render(); S.processHighlight = original;
    S.currentBody = '| Name | Status |\n|---|---|\n| Alpha | Ready |\n';
    S.render(); S.setMode('comment');
  });
  await page.locator('thead th').first().hover();
  await page.locator('.sdoc-table-table-add').hover();
  await expect(page.locator('.sdoc-table-target-preview')).toHaveCount(4);
  await page.locator('.sdoc-table-table-add').evaluate(button => { window.currentTableControl = button; });
  await page.evaluate(async () => { window.finishOldHighlight(); await Promise.resolve(); await Promise.resolve(); });
  expect(await page.locator('.sdoc-table-table-add').evaluate(button => button === window.currentTableControl)).toBe(true);
  await expect(page.locator('.sdoc-table-target-preview')).toHaveCount(4);
});

test('cross-paragraph and overlapping formatted selections never split paragraphs', async ({ page }) => {
  await load(page, '> First **bold phrase** in one paragraph.\n>\n> Second `code phrase` in another paragraph.\n');
  const before = await structure(page);
  await page.evaluate(() => {
    const S = SDocs, C = SDocComments, block = S.renderedEl.querySelector('blockquote');
    const text = S.commentsUi._cleanAnchorText(block);
    for (const quote of [text.slice(text.indexOf('bold'), text.indexOf('another')), 'bold phrase', 'phrase in one']) {
      S.currentMeta = C.addSelectionComment(S.currentMeta, { quote, block: 'blockquote:0', block_text: text.trim() }, { text: 'Review the passage.' }).meta;
    }
    S.setMode('comment');
  });
  await expect(page.locator('.sdoc-card-orphaned')).toHaveCount(0);
  await expect(page.locator('.sdoc-card')).toHaveCount(3);
  expect(await structure(page)).toEqual(before);
  await page.evaluate(() => { SDocs.commentsUi.render(); SDocs.setMode('read'); });
  expect(await structure(page)).toEqual(before);
});

test('overlapping highlights leave existing comment cards outside the selected document text', async ({ page }) => {
  await load(page, 'alpha beta gamma delta\n');
  await page.evaluate(() => {
    const S = SDocs, C = SDocComments;
    for (const quote of ['beta', 'alpha beta gamma']) {
      S.currentMeta = C.addSelectionComment(S.currentMeta, { quote }, { author: 'Reviewer', text: 'Existing feedback.' }).meta;
    }
    S.setMode('comment');
  });
  await expect(page.locator('.sdoc-card')).toHaveCount(2);
  await expect(page.locator('.sdoc-anchor .sdoc-card')).toHaveCount(0);
  expect((await page.locator('.sdoc-anchor[data-c="c2"]').allTextContents()).join('')).toBe('alpha beta gamma');
  await page.locator('.sdoc-card[data-c="c1"] .sdoc-card-body').evaluate(body => {
    const range = document.createRange(); range.selectNodeContents(body);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect(page.locator('.sdoc-selection-add')).toBeHidden();
});

test('a fence nested in a list composes and saves the same sidecar without covering code', async ({ page }) => {
  await load(page, '1. Run the check.\n\n   ```js\n   const x = 42;\n   const y = 7;\n   ```\n');
  const before = await structure(page), numbers = await markers(page);
  await page.evaluate(() => SDocs.setMode('comment'));
  await page.locator('#_sd_rendered pre').evaluate(pre => {
    const range = document.createRange(); range.selectNodeContents(pre.querySelector('code'));
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('button', { name: 'Comment on selection', exact: true }).click();
  await expect(page.locator('.sdoc-card-edit')).toHaveClass(/sdoc-card-sidecar/);
  await page.locator('.sdoc-card-input').fill('Check this code.');
  await page.locator('.sdoc-card-save').click();
  await expect(page.locator('.sdoc-card[data-c="c1"]')).toHaveClass(/sdoc-card-sidecar/);
  expect(await structure(page)).toEqual(before);
  expect(await markers(page)).toEqual(numbers);
  const code = await page.locator('#_sd_rendered pre').boundingBox(), card = await page.locator('.sdoc-card[data-c="c1"]').boundingBox();
  expect(card.y).toBeGreaterThanOrEqual(code.y + code.height);
});

test('varied saved selections keep the entire complex list tree intact', async ({ page }) => {
  await load(page);
  const before = await structure(page), numbers = await markers(page);
  const failures = await page.evaluate(() => {
    const S = SDocs, C = SDocComments, failures = [];
    for (let trial = 0; trial < 30; trial++) {
      S.currentMeta = {}; S.setMode('read'); S.render();
      const lists = S.renderedEl.querySelectorAll('ol,ul'), list = lists[trial % lists.length];
      const text = S.commentsUi._cleanAnchorText(list), start = (trial * 17) % Math.max(1, text.length - 5);
      const end = Math.min(text.length, start + 15 + trial * 23);
      S.currentMeta = C.addSelectionComment({}, {
        quote: text.slice(start, end), block: S.commentsUi._computeBlockId(list, S.renderedEl),
        block_text: text.trim().slice(0, 240), document_hash: C.documentFingerprint(S.currentBody), quote_offset: start,
      }, { text: 'Selection ' + trial }).meta;
      S.setMode('comment'); S.commentsUi.render();
      if (S.renderedEl.querySelector('ol > :not(li), ul > :not(li), .sdoc-anchor li, .sdoc-anchor p, .sdoc-anchor pre')) failures.push(trial);
    }
    S.setMode('read'); S.setAllSectionsOpen(true);
    return failures;
  });
  expect(failures).toEqual([]);
  expect(await structure(page)).toEqual(before);
  expect(await markers(page)).toEqual(numbers);
});

test('Cloud list comments retain numbering across save, reload, agent edit and cleanup', async ({ page }) => {
  const f = await startFixture({ singlePlan: true });
  const navigations = [];
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) { navigations.push(frame.url()); if (navigations.length > 12) navigations.shift(); } });
  try {
    const created = await f.api('bob', '/api/cloud/v1/account/documents', 'POST', {
      account_id: f.team.workspaceId, filename: 'release-guide.md', markdown: guide, idempotency_key: 'complex-cloud-comments',
    });
    expect(created.status).toBe(201);
    const id = created.data.document.id;
    await page.context().addCookies([{ name: 'sdocs_cloud', value: f.users.bob.sessionToken, url: f.origin }]);
    await page.goto(f.origin + '/docs?cloud-document=' + id);
    await expect(page.locator('#_sd_rendered h1')).toHaveText('Release operations field guide');
    await page.waitForFunction(() => SDocs._appReady && !SDocs._loadingDocument);
    await page.evaluate(() => SDocs.setAllSectionsOpen(true));
    const numbers = await markers(page);
    await page.evaluate(() => SDocs.setMode('comment'));
    const firstHost = page.locator('#_sd_rendered ol').first().locator(':scope > li > .sdoc-element-host').first();
    await firstHost.hover();
    await firstHost.locator(':scope > .sdoc-element-add').click();
    await page.locator('.sdoc-card-input').fill('Check the preparation step.');
    await page.locator('.sdoc-card-save').click();
    await expect.poll(async () => (await f.api('bob', '/api/cloud/v1/documents/' + id + '/comments')).data.counts.open).toBe(1);
    await page.getByText('20 minutes', { exact: true }).scrollIntoViewIfNeeded();
    await page.locator('#_sd_rendered ol').first().evaluate(list => {
      const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT); let text;
      while ((text = walker.nextNode())) if (text.nodeValue.includes('20 minutes')) break;
      const range = document.createRange(), at = text.nodeValue.indexOf('20 minutes');
      range.setStart(text, at); range.setEnd(text, at + '20 minutes'.length);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.getByRole('button', { name: 'Comment on selection', exact: true }).click();
    await page.locator('.sdoc-card-edit .sdoc-card-input').fill('Use 25 minutes.');
    await page.locator('.sdoc-card-edit .sdoc-card-save').click();
    await expect.poll(async () => (await f.api('bob', '/api/cloud/v1/documents/' + id + '/comments')).data.counts.open).toBe(2);
    await page.reload();
    await expect(page.locator('.sdoc-card[data-c="c2"]')).toContainText('Use 25 minutes.');
    await page.evaluate(() => SDocs.setAllSectionsOpen(true));
    expect(await markers(page)).toEqual(numbers);
    const head = (await f.api('bob', '/api/cloud/v1/documents/' + id + '/head')).data.document.current_revision_id;
    const edited = await f.api('bob', '/api/cloud/v1/documents/' + id + '/edits', 'POST', {
      base_revision_id: head, edits: [{ old_text: '20 minutes', new_text: '25 minutes', section: 'Prepare the release' }], idempotency_key: 'complex-agent-edit',
    });
    expect(edited.status, JSON.stringify(edited.data)).toBe(201);
    expect(edited.data.document.comment_follow_up.open_count).toBe(2);
    await page.evaluate(() => SDocs.checkCloudNow());
    await expect(page.locator('.sdoc-anchor[data-c="c2"]')).toHaveText('25 minutes');
    expect(await markers(page)).toEqual(numbers);
    const comments = (await f.api('bob', '/api/cloud/v1/documents/' + id + '/comments')).data.comments;
    const deleted = await f.api('bob', '/api/cloud/v1/documents/' + id + '/comments/actions', 'POST', {
      action: 'delete', comment_id: 'c2', base_revision_id: edited.data.document.revision_id,
      expected_comment_sha256: comments.find(c => c.id === 'c2').sha256, idempotency_key: 'complex-agent-cleanup',
    });
    expect(deleted.status).toBe(201);
    await page.evaluate(() => SDocs.checkCloudNow());
    await expect(page.locator('.sdoc-card[data-c="c2"], .sdoc-anchor[data-c="c2"]')).toHaveCount(0);
    await expect(page.locator('.sdoc-card[data-c="c1"]')).toContainText('Check the preparation step.');
    expect(await markers(page)).toEqual(numbers);
  } catch (error) {
    error.message += '\nDocument navigations: ' + JSON.stringify(navigations);
    throw error;
  } finally { await f.close(); }
});
