const { test, expect } = require('@playwright/test');
const BASE = process.env.SDOCS_TEST_BASE_URL || 'http://localhost:3000';
const dsl = 'flowchart LR\n A[Receive] --> B[Review]\n';
const fence = source => '```mermaid\n' + source + '```\n';
async function load(page, body = '# Delivery flow\n\n' + fence(dsl), comments) {
  await page.goto(BASE + '/docs');
  await page.waitForFunction(() => window.SDocs?.diagramComments);
  await page.evaluate(({ body, comments }) => {
    SDocs.loadText((comments ? SDocYaml.serializeFrontMatter({ comments }) + '\n' : '') + body);
    SDocs.setMode('comment'); SDocs.setAllSectionsOpen(true);
  }, { body, comments });
  await expect(page.locator('.sdoc-mermaid svg').first()).toBeVisible();
  await expect(page.locator('.sdoc-diagram-add').first()).toBeVisible();
}
async function save(page, text, scope = page) {
  await scope.locator('.sdoc-card-edit .sdoc-card-input').fill(text);
  await scope.locator('.sdoc-card-edit .sdoc-card-save').click();
  await expect(scope.locator('.sdoc-card-edit')).toHaveCount(0);
}
test('diagram node feedback preserves SVG, source, thread lifecycle and portable anchors', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await load(page);
  await page.getByRole('button', { name: 'Comment on Review', exact: true }).click();
  await save(page, 'Clarify who reviews.');
  const card = page.locator('.sdoc-diagram-comments .sdoc-card[data-c="c1"]');
  await expect(card).toContainText('Diagram node: Review');
  await expect(page.locator('g.node.sdoc-diagram-node-commented')).toHaveCount(1);
  const saved = await page.evaluate(() => ({ body: SDocs.currentBody, comments: SDocs.currentMeta.comments,
    copied: SDocComments.serializeFootnotes(SDocs.currentMeta, SDocs.currentBody) }));
  expect(saved.body).toBe('# Delivery flow\n\n' + fence(dsl));
  expect(saved.comments[0].node_id).toBe('B');
  expect(saved.copied).toContain('node B');
  await card.getByRole('button', { name: 'Resolve comment' }).click();
  await expect(page.locator('.sdoc-diagram-card .sdoc-thread-status')).toHaveText('Resolved');
  await page.locator('.sdoc-diagram-card').getByRole('button', { name: 'Delete comment' }).click();
  await expect(page.locator('.sdoc-diagram-card')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('whole sequence diagrams support comments without depending on node IDs', async ({ page }) => {
  await load(page, '# Sequence\n\n' + fence('sequenceDiagram\n Alice->>Bob: Review the draft\n'));
  await page.getByRole('button', { name: 'Comment on diagram', exact: true }).click();
  await save(page, 'Add the acknowledgement.');
  await expect(page.locator('.sdoc-diagram-card')).toContainText('Add the acknowledgement.');
});
test('fullscreen diagram comments save, edit and delete without leaving the diagram', async ({ page }) => {
  await load(page);
  await page.getByRole('button', { name: 'Open diagram in fullscreen' }).click();
  const modal = page.locator('.sdoc-mermaid-focus');
  await modal.getByRole('button', { name: 'Comment on Review', exact: true }).click();
  await save(page, 'Name the reviewer.', modal);
  await expect(modal.locator('.sdoc-diagram-card')).toContainText('Name the reviewer.');
  await modal.locator('.sdoc-card-body').click();
  await modal.locator('.sdoc-card-edit .sdoc-card-input').fill('Name the owner.');
  await page.evaluate(() => SDocs.commentsUi.render());
  await expect(modal.locator('.sdoc-card-edit .sdoc-card-input')).toHaveValue('Name the owner.');
  await save(page, 'Name the owner.', modal);
  await modal.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await expect(modal.locator('.sdoc-card')).toHaveCount(0);
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.sdoc-diagram-card')).toHaveCount(0);
});
test('node feedback follows label edits and diagram insertion, while missing nodes stay reachable', async ({ page }) => {
  const note = { id: 'c1', kind: 'diagram', block: 'diagram:0', diagram_source: dsl,
    node_id: 'B', node_text: 'Review', text: 'Clarify this node.', color: '#ffbb00' };
  await load(page, '# Flow\n\n' + fence('flowchart LR\n X --> Y\n') + '\n' + fence(dsl.replace('Review', 'Approve')), [note]);
  await expect(page.locator('.sdoc-mermaid').nth(1).locator('.sdoc-diagram-node-commented')).toHaveCount(1);
  await load(page, '# Flow\n\n' + fence('flowchart LR\n X --> Y\n'), [note]);
  await expect(page.locator('.sdoc-card-orphaned[data-c="c1"]')).toContainText('anchor lost');
  await page.locator('.sdoc-card-orphaned').getByRole('button', { name: 'Delete comment' }).click();
  await expect(page.locator('.sdoc-card-orphaned')).toHaveCount(0);
});
test('keyboard node selection and mobile fullscreen comments remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await load(page);
  const node = page.getByRole('button', { name: 'Comment on Review', exact: true });
  await node.focus(); await page.keyboard.press('Enter'); await save(page, 'Mobile feedback.');
  await page.getByRole('button', { name: 'Open diagram in fullscreen' }).click();
  const modal = page.locator('.sdoc-mermaid-focus');
  await expect(modal.locator('.sdoc-diagram-card')).toBeVisible();
  const geometry = await modal.locator('.sdoc-diagram-card').boundingBox();
  expect(geometry.x).toBeGreaterThanOrEqual(0); expect(geometry.x + geometry.width).toBeLessThanOrEqual(391);
  expect(geometry.y + geometry.height).toBeLessThanOrEqual(844);
});

test('fullscreen reading can start whole-diagram feedback directly', async ({ page }) => {
  await load(page); await page.evaluate(() => SDocs.setMode('read'));
  await page.getByRole('button', { name: 'Open diagram in fullscreen' }).click();
  const modal = page.locator('.sdoc-mermaid-focus');
  await modal.getByRole('button', { name: 'Comment on diagram', exact: true }).click();
  await save(page, 'Explain the handover.', modal);
  await expect(modal.locator('.sdoc-diagram-card')).toContainText('Explain the handover.');
});

test('identical diagrams still open fullscreen and retain their own feedback', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await load(page, '# Duplicate flows\n\n' + fence(dsl) + '\n' + fence(dsl));
  await page.getByRole('button', { name: 'Open diagram in fullscreen' }).nth(1).click();
  const modal = page.locator('.sdoc-mermaid-focus');
  await modal.getByRole('button', { name: 'Comment on diagram', exact: true }).click();
  await save(page, 'Second flow.', modal);
  await expect(modal.locator('.sdoc-diagram-card')).toContainText('Second flow.');
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.sdoc-mermaid').nth(1).locator('xpath=following-sibling::*[1]')).toContainText('Second flow.');
  expect(errors).toEqual([]);
});
