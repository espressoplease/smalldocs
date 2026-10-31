const { test, expect } = require('@playwright/test');
const BASE = process.env.SDOCS_TEST_BASE_URL || 'http://localhost:3000';

async function load(page, body, comments) {
  await page.evaluate(({ body, comments }) => {
    const S = window.SDocs;
    S.loadText(window.SDocYaml.serializeFrontMatter({ comments }) + '\n' + body);
    S.setMode('comment');
  }, { body, comments });
}

const note = (fields) => Object.assign({ id: 'c1', author: 'reader', color: '#ffbb00', text: 'review this' }, fields);
const fence = (source) => '```js\n' + source + '\n```\n';

test.beforeEach(async ({ page }) => {
  await page.goto(BASE + '/docs');
  await page.waitForFunction(() => window.SDocs?.commentsUi && window.SDocsCommentData && window.SDocsCodeComments);
});

test('comment cards never become context for later anchors', async ({ page }) => {
  await load(page, 'alpha target and beta target.\n', [
    note({ quote: 'alpha', kind: 'inline', block: 'p:0', text: 'target in a note' }),
    note({ id: 'c2', kind: 'inline', block: 'p:0', quote: 'target', prefix: 'alpha target and beta ', suffix: '.' }),
  ]);
  const before = await page.evaluate(() => {
    const root = window.SDocs.renderedEl, anchor = root.querySelector('.sdoc-anchor[data-c="c2"]');
    const range = document.createRange(); range.setStart(root.querySelector('p'), 0); range.setEndBefore(anchor);
    const clone = document.createElement('span'); clone.appendChild(range.cloneContents());
    return window.SDocs.commentsUi._cleanAnchorText(clone);
  });
  expect(before).toBe('alpha target and beta ');
});

test('duplicate prose targets remain visible as ambiguous after insertion', async ({ page }) => {
  await load(page, 'Same target.\n\nSame target.\n\nSame target.\n', [
    note({ kind: 'inline', quote: 'target', prefix: 'Same ', suffix: '.', block: 'p:1' }),
  ]);
  await expect(page.locator('.sdoc-anchor[data-c="c1"]')).toHaveCount(0);
  await expect(page.locator('.sdoc-card[data-c="c1"] .sdoc-card-orphan-badge')).toHaveText('anchor ambiguous');
});

test('a rewritten passage cannot transfer its note to the remaining quote elsewhere', async ({ page }) => {
  await load(page, 'Production retry 45.\n\nSandbox retry 10.\n', [
    note({ kind: 'inline', block: 'p:0', quote: '10', prefix: 'Production retry ', suffix: '.', block_text: 'Production retry 10.' }),
  ]);
  await expect(page.locator('.sdoc-anchor[data-c="c1"]')).toHaveCount(0);
  await expect(page.locator('.sdoc-card[data-c="c1"].sdoc-card-orphaned')).toHaveCount(1);
});

test('unchanged source positions keep duplicate targets usable until the body changes', async ({ page }) => {
  await page.evaluate(() => {
    const S = window.SDocs, body = 'Same target.\n\nSame target.\n';
    S.loadText(body); S.currentMeta = { comments: [{ id: 'c1', kind: 'inline', block: 'p:1', quote: 'target',
      quote_offset: 5, document_hash: window.SDocComments.documentFingerprint(body), text: 'second paragraph' }] };
    S.setMode('comment'); S.render();
  });
  await expect(page.locator('#_sd_rendered p').nth(1).locator('.sdoc-anchor[data-c="c1"]')).toHaveText('target');
  await page.evaluate(() => { window.SDocs.currentBody = 'Same target.\n\n' + window.SDocs.currentBody; window.SDocs.render(); });
  await expect(page.locator('.sdoc-anchor[data-c="c1"]')).toHaveCount(0);
  await expect(page.locator('.sdoc-card[data-c="c1"] .sdoc-card-orphan-badge')).toHaveText('anchor ambiguous');
});

test('explicit lost-anchor status prevents all fallback reattachment', async ({ page }) => {
  await load(page, 'Only target remains.\n\n' + fence('target()'), [
    note({ kind: 'inline', quote: 'target', anchor_status: 'orphaned' }),
    note({ id: 'c2', kind: 'line', block: 'pre:0', line: 0, anchorText: 'target()', anchor_status: 'orphaned' }),
  ]);
  await expect(page.locator('.sdoc-anchor')).toHaveCount(0);
  await expect(page.locator('.sdoc-card-orphaned')).toHaveCount(2);
});

test('plain imported footnotes keep the selected repeated quote', async ({ page }) => {
  await page.evaluate(() => {
    window.SDocs.loadText('first target.\n\nsecond [target][^c1].\n\n[^c1]: u - fix\n');
    window.SDocs.setMode('comment');
  });
  await expect(page.locator('p').filter({ has: page.locator('.sdoc-anchor[data-c="c1"]') })).toContainText('second target');
});

test('block fingerprints recover after paragraphs are inserted above', async ({ page }) => {
  await load(page, 'New paragraph.\n\nIntro.\n\nTarget paragraph.\n', [
    note({ kind: 'block', block: 'p:1', block_text: 'Target paragraph.' }),
  ]);
  await expect(page.locator('.sdoc-block-host').filter({ has: page.locator('.sdoc-card[data-c="c1"]') })).toContainText('Target paragraph.');
});

test('reader and code viewer resolve shifted lines to the same source', async ({ page }) => {
  await load(page, fence('inserted()\nbefore()\ntarget()'), [
    note({ kind: 'line', block: 'pre:0', line: 1, anchorText: 'target()' }),
  ]);
  await expect(page.locator('.sdoc-anchor[data-c="c1"]')).toHaveText('target()');
  await page.evaluate(() => window.SDocs.codeFocus.open(window.SDocs.renderedEl.querySelector('pre'), { comment: true }));
  await expect(page.locator('.sdoc-cc-thread[data-c="c1"]')).toHaveAttribute('data-ln', '2');
});

test('code context distinguishes repeated lines', async ({ page }) => {
  await load(page, fence('first()\ntarget()\nother()\nsecond()\ntarget()\ntail()'), [
    note({ kind: 'line', block: 'pre:0', line: 1, anchorText: 'target()', line_prefix: 'other()\nsecond()', line_suffix: 'tail()' }),
  ]);
  const before = await page.evaluate(() => {
    const S = window.SDocs, range = document.createRange();
    range.setStart(S.renderedEl.querySelector('pre'), 0); range.setEndBefore(S.renderedEl.querySelector('.sdoc-anchor[data-c="c1"]'));
    return range.toString();
  });
  expect(before).toContain('second()\n');
});

test('token context selects the second repeated phrase in reader and viewer', async ({ page }) => {
  await load(page, fence('target + target'), [note({ kind: 'token', block: 'pre:0', line: 0,
    anchorText: 'target + target', quote: 'target', quote_prefix: 'target + ', quote_suffix: '' })]);
  const before = await page.evaluate(() => {
    const S = window.SDocs, range = document.createRange(); range.setStart(S.renderedEl.querySelector('pre'), 0);
    range.setEndBefore(S.renderedEl.querySelector('.sdoc-anchor[data-c="c1"]')); return range.toString();
  });
  expect(before).toBe('target + ');
  await page.evaluate(() => window.SDocs.codeFocus.open(window.SDocs.renderedEl.querySelector('pre'), { comment: true }));
  await expect(page.locator('.sdoc-cc-token-mark[data-c="c1"]')).toHaveText('target');
  const markBefore = await page.evaluate(() => {
    const root = document.querySelector('.sdoc-cl-code'), range = document.createRange();
    range.setStart(root, 0); range.setEndBefore(root.querySelector('.sdoc-cc-token-mark')); return range.toString();
  });
  expect(markBefore).toBe('target + ');
});

test('identical code fences leave the thread unplaced on both surfaces', async ({ page }) => {
  await load(page, fence('target()') + '\n' + fence('target()'), [
    note({ kind: 'line', block: 'pre:0', block_text: 'target()', line: 0, anchorText: 'target()' }),
  ]);
  await expect(page.locator('.sdoc-card[data-c="c1"] .sdoc-card-orphan-badge')).toHaveText('anchor ambiguous');
  await page.evaluate(() => window.SDocs.codeFocus.open(window.SDocs.renderedEl.querySelector('pre'), { comment: true }));
  await expect(page.locator('.sdoc-cc-orphans .sdoc-cc-thread[data-c="c1"]')).toHaveCount(1);
});

test('code comments follow their fence when another fence is inserted', async ({ page }) => {
  await load(page, fence('unrelated()') + '\n' + fence('before()\ntarget()'), [
    note({ kind: 'line', block: 'pre:0', block_text: 'before()\ntarget()', line: 1, anchorText: 'target()' }),
  ]);
  await expect(page.locator('pre').nth(0).locator('.sdoc-anchor')).toHaveCount(0);
  await expect(page.locator('pre').nth(1).locator('.sdoc-anchor[data-c="c1"]')).toHaveText('target()');
  await page.evaluate(() => window.SDocs.codeFocus.open(window.SDocs.renderedEl.querySelectorAll('pre')[1], { comment: true }));
  await expect(page.locator('.sdoc-cc-thread[data-c="c1"]')).toHaveAttribute('data-ln', '1');
});

test('missing code targets remain reachable in reader and viewer', async ({ page }) => {
  await load(page, fence('replacement()'), [note({ kind: 'line', block: 'pre:0', line: 0, anchorText: 'deleted()' })]);
  await expect(page.locator('.sdoc-card[data-c="c1"].sdoc-card-orphaned')).toHaveCount(1);
  await page.evaluate(() => window.SDocs.codeFocus.open(window.SDocs.renderedEl.querySelector('pre'), { comment: true }));
  await expect(page.locator('.sdoc-cc-orphans .sdoc-cc-thread[data-c="c1"]')).toHaveCount(1);
});

test('a remote document replacement dismisses stale code cards before another action', async ({ page }) => {
  await load(page, fence('oldTarget()'), [note({ kind: 'line', block: 'pre:0', line: 0, anchorText: 'oldTarget()', text: 'old note' })]);
  await page.evaluate(() => window.SDocs.codeFocus.open(window.SDocs.renderedEl.querySelector('pre'), { comment: true }));
  await load(page, fence('newTarget()'), [note({ kind: 'line', block: 'pre:0', line: 0, anchorText: 'newTarget()', text: 'remote note' })]);
  await expect(page.locator('.sdoc-code-focus')).toHaveCount(0);
  await expect(page.locator('.sdoc-card[data-c="c1"] .sdoc-card-body')).toHaveText('remote note');
});

test('list targets follow their content across block moves and remain visible if deleted', async ({ page }) => {
  const comment = note({ kind: 'element', block: 'ul:0', element: 'li:1', element_text: 'target', block_text: 'beforetarget' });
  await load(page, '- unrelated\n\nA paragraph.\n\n- before\n- target\n', [comment]);
  await expect(page.locator('li').filter({ has: page.locator('.sdoc-card[data-c="c1"]') })).toContainText('target');
  await load(page, '- unrelated\n\nA paragraph.\n\n- before\n- replacement\n', [comment]);
  await expect(page.locator('.sdoc-card[data-c="c1"].sdoc-card-orphaned')).toHaveCount(1);
});

test('table targets recover after row and column moves', async ({ page }) => {
  await load(page, '| Status | Name |\n|---|---|\n| Done | Beta |\n| Open | Alpha |\n', [
    note({ kind: 'table', block: 'table:0', table_scope: 'cell', table_row: 0, table_column: 1,
      row_text: 'Alpha', column_text: 'Status', cell_text: 'Open' }),
  ]);
  await expect(page.locator('td.sdoc-table-cell-commented')).toHaveText('Open');
});

test('repeated list and table targets remain unplaced instead of choosing the first', async ({ page }) => {
  await load(page, '- target\n- target\n\n| Name | Status |\n|---|---|\n| Alpha | Open |\n| Alpha | Open |\n', [
    note({ kind: 'element', block: 'ul:0', element: 'li:1', element_text: 'target' }),
    note({ id: 'c2', kind: 'table', block: 'table:0', table_scope: 'cell', table_row: 1, table_column: 1,
      row_text: 'Alpha', column_text: 'Status', cell_text: 'Open' }),
  ]);
  await expect(page.locator('.sdoc-card-orphaned')).toHaveCount(2);
  await expect(page.locator('.sdoc-element-commented, .sdoc-table-cell-commented')).toHaveCount(0);
});

test('slide and shape comments follow content after slide insertion and shape reorder', async ({ page }) => {
  const original = 'grid 100 56.25\nr 5 5 90 18 | Title\nr 5 28 90 22 | Target';
  const changed = 'grid 100 56.25\nr 5 28 90 22 | Target\nr 5 5 90 18 | Title';
  const slide = (dsl) => '```slide\n' + dsl + '\n```\n';
  await load(page, slide('grid 100 56.25\nr 5 5 90 18 | Inserted') + '\n' + slide(changed), [
    note({ kind: 'slide', slide: 0, shape: 1, slide_text: 'Target', slide_source: original, shape_texts: ['Target'] }),
  ]);
  await expect(page.locator('.sdoc-slide[data-slide-index="1"] .sdoc-slide-hit[data-shape-idx="0"]')).toHaveClass(/is-commented/);
  await expect(page.locator('.sdoc-slide[data-slide-index="0"] .sdoc-slide-hit.is-commented')).toHaveCount(0);
});

test('deleted slide targets remain visible as unplaced feedback', async ({ page }) => {
  await load(page, 'The slide was deleted.\n', [note({ kind: 'slide', slide: 1, shape: 1, slide_text: 'Target', shape_texts: ['Target'] })]);
  await expect(page.locator('.sdoc-slide-orphan[data-c="c1"]')).toContainText('review this');
  await expect(page.locator('#_sd_comment-orphan')).toContainText('1 orphaned');
});

test('repeated slide shape labels are marked ambiguous', async ({ page }) => {
  await load(page, '```slide\ngrid 100 56.25\nr 5 5 90 18 | Target\nr 5 28 90 22 | Target\n```\n', [
    note({ kind: 'slide', slide: 0, shape: 1, slide_text: 'Target', shape_texts: ['Target'] }),
  ]);
  await expect(page.locator('.sdoc-slide-orphan .sdoc-card-orphan-badge')).toHaveText('anchor ambiguous');
  await expect(page.locator('.sdoc-slide-hit.is-commented')).toHaveCount(0);
});

test('reply, resolution, reopening, and reload retain one thread and original note', async ({ page }) => {
  await load(page, 'Target paragraph.\n', [note({ kind: 'inline', quote: 'Target', block: 'p:0', uid: 'cm_stable' })]);
  const card = page.locator('.sdoc-card[data-c="c1"]');
  await card.getByRole('button', { name: 'Reply', exact: true }).click();
  await card.getByPlaceholder('Add a reply...').fill('Updated the paragraph.');
  await card.getByRole('button', { name: 'Save reply', exact: true }).click();
  await card.getByRole('button', { name: 'Resolve comment', exact: true }).click();
  await expect(card.locator('.sdoc-thread-status')).toHaveText('Resolved');
  await expect(card.locator('.sdoc-thread-reply-text')).toHaveText('Updated the paragraph.');
  await page.evaluate(() => {
    const S = window.SDocs, text = window.SDocYaml.serializeFrontMatter(S.currentMeta) + '\n' + S.currentBody;
    S.loadText(text); S.setMode('comment');
  });
  await expect(card.locator('.sdoc-thread-status')).toHaveText('Resolved');
  await expect(card.locator('.sdoc-thread-reply-text')).toHaveText('Updated the paragraph.');
  await card.getByRole('button', { name: 'Reopen comment', exact: true }).click();
  await expect(card.locator('.sdoc-thread-status')).toHaveCount(0);
  const saved = await page.evaluate(() => window.SDocs.currentMeta.comments[0]);
  expect(saved.uid).toBe('cm_stable'); expect(saved.text).toBe('review this'); expect(saved.replies).toHaveLength(1);
});

test('code threads use the same reply and resolution controls without covering source', async ({ page }) => {
  await load(page, fence('before()\ntarget()\nafter()'), [note({ kind: 'line', block: 'pre:0', line: 1, anchorText: 'target()' })]);
  await page.evaluate(() => window.SDocs.codeFocus.open(window.SDocs.renderedEl.querySelector('pre'), { comment: true }));
  const thread = page.locator('.sdoc-cc-thread[data-c="c1"]');
  await thread.getByRole('button', { name: 'Reply', exact: true }).click();
  await thread.getByPlaceholder('Add a reply...').fill('Checked the next revision.');
  await thread.getByRole('button', { name: 'Save reply', exact: true }).click();
  await thread.getByRole('button', { name: 'Resolve comment', exact: true }).click();
  await expect(thread.locator('.sdoc-thread-reply-text')).toHaveText('Checked the next revision.');
  await expect(thread.locator('.sdoc-thread-status')).toHaveText('Resolved');
  const overlaps = await page.evaluate(() => {
    const card = document.querySelector('.sdoc-cc-thread[data-c="c1"]').getBoundingClientRect();
    return Array.from(document.querySelectorAll('.sdoc-cl-row')).some(row => {
      const rect = row.getBoundingClientRect(); return rect.top < card.bottom && rect.bottom > card.top;
    });
  });
  expect(overlaps).toBe(false);
  await page.evaluate(() => window.SDocs.codeFocus.close());
  await expect(page.locator('.sdoc-card[data-c="c1"] .sdoc-thread-status')).toHaveText('Resolved');
});

test('comment links open comment mode and focus unplaced cards', async ({ page }) => {
  await page.goto(BASE + '/docs?comment=c1');
  await page.waitForFunction(() => window.SDocs?.commentsUi);
  await page.evaluate(() => window.SDocs.loadText('---\ncomments:\n  - id: c1\n    kind: inline\n    quote: missing\n    text: link target\n---\nOther text.\n'));
  await expect(page.locator('body')).toHaveClass(/comment-mode/);
  await expect(page.locator('.sdoc-card[data-c="c1"]')).toHaveClass(/sdoc-card-focus/);
  await page.locator('#_sd_btn-read').click();
  await expect(page.locator('body')).toHaveClass(/read-mode/);
  await page.evaluate(() => window.SDocs.render());
  await expect(page.locator('body')).toHaveClass(/read-mode/);
});
