const { test, expect } = require('@playwright/test');
const BASE = process.env.SDOCS_TEST_BASE_URL || 'http://localhost:3000';
const A = 'grid 100 56.25\nr 5 5 90 10 | Roadmap\nr 5 20 40 20 | Review\nr 55 20 40 20 | Review';
const B = 'grid 100 56.25\nr 5 5 90 10 | Budget\nr 5 20 90 20 | Costs';
const deck = (...slides) => slides.map(s => '~~~slide\n' + s + '\n~~~').join('\n\n');
async function load(page, body, keep = false) {
  await page.evaluate(({ body, keep }) => {
    SDocs.currentBody = body;
    if (!keep) SDocs.currentMeta = {};
    SDocs.render();
    SDocs.setMode('comment');
    SDocs.commentsUi.onHostRender();
  }, { body, keep });
  await expect(page.locator('.sdoc-slide-hit').first()).toBeVisible();
}
function hit(page, slide, shape) { return page.locator('.sdoc-slide[data-slide-index="' + slide + '"] .sdoc-slide-hit[data-shape-idx="' + shape + '"]'); }
async function save(page, text) {
  const composer = page.locator('.sdoc-slide-card.sdoc-card-edit');
  await composer.locator('textarea').fill(text);
  await composer.locator('.sdoc-card-save').click();
  await expect(composer).toHaveCount(0);
}
test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(BASE + '/docs');
  await page.waitForFunction(() => SDocs._appReady && !SDocs._loadingDocument);
});
test('plain click then shift adds an element and retains the written draft', async ({ page }) => {
  await load(page, deck(A, B));
  await hit(page, 0, 0).click();
  await page.locator('.sdoc-card-edit textarea').fill('Balance these two elements.');
  await hit(page, 0, 1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.sdoc-slide-hit.is-composing')).toHaveCount(2);
  await expect(page.locator('.sdoc-card-edit textarea')).toHaveValue('Balance these two elements.');
  await page.locator('.sdoc-card-edit .sdoc-card-save').click();
  expect(await page.evaluate(() => SDocs.currentMeta.comments[0].shapes)).toEqual([0, 1]);
  await expect(page.locator('.sdoc-slide[data-slide-index="0"] .sdoc-slide-comment-btn.has-comment')).toHaveCount(0);
});
test('multi selection can shrink without losing its draft or leaving stale highlights', async ({ page }) => {
  await load(page, deck(A));
  await hit(page, 0, 0).click({ modifiers: ['Shift'] });
  await hit(page, 0, 1).click({ modifiers: ['Shift'] });
  await page.locator('.sdoc-card-edit textarea').fill('Keep this note while selecting.');
  await hit(page, 0, 1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.sdoc-card-edit textarea')).toHaveValue('Keep this note while selecting.');
  await page.locator('.sdoc-card-cancel').click();
  await expect(page.locator('.sdoc-slide-hit.is-composing')).toHaveCount(0);
});
test('an unchanged slide with duplicate labels retains its element anchor after insertion', async ({ page }) => {
  await load(page, deck(A, B));
  await hit(page, 0, 2).click();
  await save(page, 'Use a different label on the right.');
  await load(page, deck(B, A), true);
  await expect(hit(page, 1, 2)).toHaveClass(/is-commented/);
  await expect(hit(page, 1, 1)).not.toHaveClass(/is-commented/);
  await expect(page.locator('.sdoc-slide-orphan')).toHaveCount(0);
  await page.locator('.sdoc-slide-comment-list[data-for="1"] .sdoc-slide-copy-c').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('(slide 2, element 2');
});
test('ambiguous duplicated slides do not attach feedback to an arbitrary copy', async ({ page }) => {
  await load(page, deck(A));
  await hit(page, 0, 1).click();
  await save(page, 'Check this label.');
  await load(page, deck(A, A), true);
  await expect(page.locator('.sdoc-slide-hit.is-commented')).toHaveCount(0);
  await expect(page.locator('.sdoc-slide-orphan')).toContainText('anchor ambiguous');
});
test('inserting a shape retains the intended duplicate-label element by its source identity', async ({ page }) => {
  await load(page, deck(A));
  await hit(page, 0, 2).click(); await save(page, 'Update the right box.');
  await load(page, deck(A.replace('r 5 20', 'r 2 45 40 8 | Added\nr 5 20')), true);
  await expect(hit(page, 0, 3)).toHaveClass(/is-commented/);
  await expect(hit(page, 0, 2)).not.toHaveClass(/is-commented/);
});
test('inserting a decorative arrow does not move feedback to the new first arrow', async ({ page }) => {
  const original = 'grid 100 56.25\nr 5 5 90 10 | Process\na 10 25 70 25\na 10 40 70 40';
  await load(page, deck(original));
  await hit(page, 0, 1).click(); await save(page, 'Reverse this arrow.');
  await load(page, deck(original.replace('a 10 25', 'a 10 18 70 18\na 10 25')), true);
  await expect(hit(page, 0, 2)).toHaveClass(/is-commented/);
  await expect(hit(page, 0, 1)).not.toHaveClass(/is-commented/);
});
test('presentation navigation lists only the active slide feedback', async ({ page }) => {
  await load(page, deck(A, B));
  await hit(page, 0, 0).click(); await save(page, 'Roadmap feedback.');
  await hit(page, 1, 0).click(); await save(page, 'Budget feedback.');
  await page.locator('.sdoc-slide-present').first().click();
  await page.locator('.sdoc-present-comment-btn').click();
  await expect(page.locator('.sdoc-present-comment-panel')).toContainText('Roadmap feedback.');
  await page.locator('.sdoc-present button[aria-label="Next slide"]').click();
  await expect(page.locator('.sdoc-present-comment-panel')).toContainText('Budget feedback.');
  await expect(page.locator('.sdoc-present-comment-panel')).not.toContainText('Roadmap feedback.');
  await expect(page.locator('.sdoc-present-comment-panel .sdoc-slide-comment-list')).toHaveCount(1);
});
test('presentation keeps an unsaved note with its own slide while navigating', async ({ page }) => {
  await load(page, deck(A, B));
  await page.locator('.sdoc-slide-present').first().click();
  await page.locator('.sdoc-present-comment-btn').click();
  await page.locator('.sdoc-present .sdoc-slide-hit[data-shape-idx="0"]').click();
  await page.locator('.sdoc-present-comment-panel textarea').fill('Roadmap draft.');
  await page.locator('.sdoc-present button[aria-label="Next slide"]').click();
  await expect(page.locator('.sdoc-present-comment-panel textarea')).toHaveCount(0);
  await page.locator('.sdoc-present .sdoc-slide-hit[data-shape-idx="0"]').click();
  await page.locator('.sdoc-present-comment-panel textarea').fill('Budget draft.');
  await page.locator('.sdoc-present button[aria-label="Previous slide"]').click();
  await expect(page.locator('.sdoc-present-comment-panel textarea')).toHaveValue('Roadmap draft.');
  await page.locator('.sdoc-present-comment-panel .sdoc-card-save').click();
  await expect(page.locator('.sdoc-present-comment-panel textarea')).toHaveCount(0);
  await page.locator('.sdoc-present button[aria-label="Next slide"]').click();
  await expect(page.locator('.sdoc-present-comment-panel textarea')).toHaveValue('Budget draft.');
  await page.locator('.sdoc-present-comment-panel .sdoc-card-save').click();
  const comments = await page.evaluate(() => SDocs.currentMeta.comments);
  expect(comments.map(c => [c.slide, c.text])).toEqual([[0, 'Roadmap draft.'], [1, 'Budget draft.']]);
  await page.locator('.sdoc-present button[aria-label="Previous slide"]').click();
  await expect(page.locator('.sdoc-present-comment-panel textarea')).toHaveCount(0);
});
test('mobile presentation keeps slide and feedback separate and supports edit and delete', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await load(page, deck(B));
  await page.locator('.sdoc-slide-present').click();
  await page.locator('.sdoc-present-comment-btn').click();
  await page.locator('.sdoc-present .sdoc-slide-comment-btn').click();
  const panel = page.locator('.sdoc-present-comment-panel');
  await panel.locator('textarea').fill('Keep the amount visible.');
  await panel.locator('.sdoc-card-save').click();
  await expect(panel.locator('.sdoc-slide-card:not(.sdoc-card-edit)')).toContainText('Keep the amount visible.');
  const boxes = await page.evaluate(() => {
    const p = document.querySelector('.sdoc-present-comment-panel').getBoundingClientRect();
    const s = document.querySelector('.sdoc-present-stage').getBoundingClientRect();
    return { panelTop: p.top, slideBottom: s.bottom, right: p.right, width: innerWidth };
  });
  expect(boxes.right).toBeLessThanOrEqual(boxes.width + 1);
  expect(boxes.slideBottom).toBeLessThanOrEqual(boxes.panelTop + 2);
  await panel.locator('.sdoc-card-body').click();
  await panel.locator('textarea').fill('Keep the total visible.');
  await panel.locator('.sdoc-card-save').click();
  await expect(panel.locator('.sdoc-card-body')).toHaveText('Keep the total visible.');
  await panel.locator('.sdoc-card-delete').click();
  await expect(panel.locator('.sdoc-slide-card')).toHaveCount(0);
  expect(await page.evaluate(() => (SDocs.currentMeta.comments || []).length)).toBe(0);
});
test('slide thread replies and resolution persist while presenting', async ({ page }) => {
  await load(page, deck(B));
  await hit(page, 0, 0).click(); await save(page, 'Confirm the budget.');
  await page.locator('.sdoc-slide-present').click();
  await page.locator('.sdoc-present-comment-btn').click();
  const panel = page.locator('.sdoc-present-comment-panel');
  await panel.getByRole('button', { name: 'Reply', exact: true }).click();
  await panel.locator('.sdoc-thread-composer textarea').fill('Checked the workbook.');
  await panel.locator('.sdoc-thread-composer button[aria-label="Save reply"]').click();
  await expect(panel.locator('.sdoc-thread-reply-text')).toHaveText('Checked the workbook.');
  await panel.getByRole('button', { name: 'Resolve comment', exact: true }).click();
  await expect(panel.locator('.sdoc-thread-status')).toHaveText('Resolved');
  await expect(panel.locator('.sdoc-card-edit')).toHaveCount(0);
  const comment = await page.evaluate(() => SDocs.currentMeta.comments[0]);
  expect(comment.resolved).toBe(true);
  expect(comment.replies[0].text).toBe('Checked the workbook.');
});
test('commented slide elements use their saved colour and have a named keyboard target', async ({ page }) => {
  await load(page, deck(B));
  await page.evaluate(() => {
    SDocs.currentMeta = SDocComments.addSlideComment({}, {
      slide: 0, shape: 0, slide_source: document.querySelector('.sdoc-slide').getAttribute('data-dsl'),
      document_hash: SDocComments.documentFingerprint(SDocs.currentBody),
    }, { text: 'Check budget.', color: '#c01030', author: 'Rae' }).meta;
    SDocs.commentsUi.onHostRender();
  });
  const target = page.locator('.sdoc-slide').getByRole('button', { name: 'Comment on “Budget”', exact: true });
  expect(await target.evaluate(el => el.style.getPropertyValue('--sdoc-anchor-color'))).toBe('#c01030');
  await target.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.sdoc-card-edit textarea')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sdoc-card-edit')).toHaveCount(0);
});
