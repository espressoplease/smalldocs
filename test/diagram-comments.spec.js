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

test('sequence participants and messages are targets beside a flowchart, with portable agent context', async ({ page }) => {
  const sequence = 'sequenceDiagram\n participant Requester\n participant Owner\n Requester->>Owner: Submit request\n Owner-->>Requester: Confirm the delivery date\n';
  const body = '# Delivery sequence\n\n' + fence(dsl) + '\n' + fence(sequence);
  await load(page, body);
  const diagram = page.locator('.sdoc-mermaid').nth(1);
  await diagram.getByRole('button', { name: 'Comment on Owner', exact: true }).first().click();
  await save(page, 'Name the delivery owner.');
  await expect(diagram.locator('.sdoc-diagram-node-commented')).toHaveCount(2);
  await page.locator('.sdoc-mermaid').nth(1).getByRole('button', { name: 'Comment on Submit request', exact: true }).click();
  await save(page, 'Include a request number.');
  const saved = await page.evaluate(() => ({ markdown: SDocYaml.serializeFrontMatter(SDocs.currentMeta) + '\n' + SDocs.currentBody,
    comments: SDocs.currentMeta.comments, body: SDocs.currentBody }));
  expect(saved.body).toBe(body);
  expect(saved.comments[0].node_id).toBe('sequence:participant:Owner');
  expect(saved.comments[1].node_id).toMatch(/^sequence:message:/);
  const projected = require('../lib/cloud-comment-context').project(saved.markdown, saved.comments, { context: 'snippet' });
  expect(projected.map(note => note.anchor.match_status)).toEqual(['exact', 'exact']);
  expect(projected[1].context.markdown).toContain('Requester->>Owner: Submit request');
  await expect(page.locator('.sdoc-diagram-card').last()).toContainText('Message: Submit request');
  await page.evaluate(() => { SDocs.currentBody = 'Intro added.\n\n' + SDocs.currentBody.replace('participant Owner', 'participant Owner as Delivery owner'); SDocs.render(); });
  await expect(page.locator('.sdoc-card-orphaned')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Comment on Delivery owner', exact: true })).toHaveCount(2);
});

test('sequence actors and repeated messages remain separate, with fullscreen keyboard feedback', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const source = 'sequenceDiagram\n actor A as Requester\n participant B as Owner\n A->>B: Review\n A->>B: Review\n';
  await load(page, '# Sequence\n\n' + fence(source));
  await page.getByRole('button', { name: 'Open diagram in fullscreen' }).click();
  const modal = page.locator('.sdoc-mermaid-focus');
  await modal.getByRole('button', { name: 'Comment on Requester', exact: true }).first().focus();
  await page.keyboard.press('Enter'); await save(page, 'Check this participant.', modal);
  await modal.getByRole('button', { name: 'Comment on Review', exact: true }).nth(1).click();
  await save(page, 'The second review.', modal);
  const note = await page.evaluate(() => SDocs.currentMeta.comments.at(-1));
  expect(JSON.parse(note.node_id.slice('sequence:message:'.length)).at(-1)).toBe(1);
  await expect(modal.locator('.sdoc-diagram-message.sdoc-diagram-node-commented')).toHaveCount(1);
  const cards = await modal.locator('.sdoc-diagram-focus-comments').boundingBox();
  expect(cards.x).toBeGreaterThanOrEqual(0); expect(cards.x + cards.width).toBeLessThanOrEqual(391);
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => { SDocs.currentBody = SDocs.currentBody.replace(' A->>B: Review', ' A->>B: A new message\n A->>B: Review'); SDocs.render(); });
  await expect(page.locator('.sdoc-card-orphaned')).toContainText('The second review.');
});
