// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

/**
 * Slide comment mode end-to-end.
 *
 * In comment mode every rendered slide gets a hit layer (one overlay per
 * shape) plus a whole-slide button. Clicking opens a composer; saving stores
 * a kind:'slide' comment in currentMeta.comments. The same machinery runs in
 * the fullscreen present view behind its topbar "Comment" toggle. Copy-with-
 * comments emits the notes as footnote definitions.
 */

const DECK = [
  'grid 100 56.25\nr 5 5 90 18 fill=#1e40af color=#fff text=title | Q4 Review\nr 5 28 90 22 align=left | Revenue up. Costs flat.',
  'grid 100 56.25\nr 5 5 90 40 fill=#059669 color=#fff | Thank you',
].map((dsl) => '```slide\n' + dsl + '\n```').join('\n\nbetween the slides\n\n');

async function enterCommentMode(page) {
  await page.evaluate(() => {
    var btn = document.getElementById('_sd_btn-comment');
    if (!document.body.classList.contains('comment-mode')) btn.click();
  });
  await expect(page.locator('body.comment-mode')).toBeVisible();
}

async function loadDeck(page, md) {
  await page.evaluate((body) => {
    window.SDocs.currentBody = body;
    window.SDocs.currentMeta = {};
    window.SDocs.render();
    if (window.SDocs.commentsUi && window.SDocs.commentsUi.onHostRender) {
      window.SDocs.commentsUi.onHostRender();
    }
  }, md || DECK);
  await page.waitForTimeout(150);
}

function slideComments(page) {
  return page.evaluate(() => (window.SDocs.currentMeta.comments || [])
    .filter((c) => c.kind === 'slide'));
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(BASE + '/');
  await page.waitForFunction(() => !!window.SDocs && !!window.SDocs.render && !!window.SDocSlideComments);
});

// ── Inline slides ─────────────────────────────────────────────────────────

test.describe('inline slide comments', () => {
  test('comment mode adds one hit overlay per shape', async ({ page }) => {
    await enterCommentMode(page);
    await loadDeck(page);
    const firstSlide = page.locator('.sdoc-slide[data-slide-index="0"]');
    await expect(firstSlide.locator('.sdoc-slide-hit')).toHaveCount(2);
    await expect(firstSlide.locator('.sdoc-slide-comment-btn')).toHaveCount(1);
  });

  test('no hit layer outside comment mode', async ({ page }) => {
    await loadDeck(page);
    await expect(page.locator('.sdoc-slide-hit')).toHaveCount(0);
  });

  test('clicking an element overlay composes and stores a slide comment', async ({ page }) => {
    await enterCommentMode(page);
    await loadDeck(page);
    await page.locator('.sdoc-slide[data-slide-index="0"] .sdoc-slide-hit[data-shape-idx="0"]').click();
    const composer = page.locator('.sdoc-slide-card.sdoc-card-edit');
    await expect(composer).toHaveCount(1);
    await expect(composer.locator('.sdoc-slide-card-target')).toContainText('Q4 Review');
    await composer.locator('.sdoc-card-input').fill('make this punchier');
    await composer.locator('.sdoc-card-save').click();
    await page.waitForTimeout(100);

    const cs = await slideComments(page);
    expect(cs.length).toBe(1);
    expect(cs[0].slide).toBe(0);
    expect(cs[0].shape).toBe(0);
    expect(cs[0].text).toBe('make this punchier');
    expect(cs[0].slide_text).toContain('Q4 Review');
  });

  test('saved element comment shows a numbered dot + a card below the slide', async ({ page }) => {
    await enterCommentMode(page);
    await loadDeck(page);
    await page.locator('.sdoc-slide[data-slide-index="0"] .sdoc-slide-hit[data-shape-idx="1"]').click();
    await page.locator('.sdoc-slide-card.sdoc-card-edit .sdoc-card-input').fill('trim this');
    await page.locator('.sdoc-slide-card.sdoc-card-edit .sdoc-card-save').click();
    await page.waitForTimeout(120);

    const slide = page.locator('.sdoc-slide[data-slide-index="0"]');
    await expect(slide.locator('.sdoc-slide-hit[data-shape-idx="1"].is-commented')).toHaveCount(1);
    await expect(slide.locator('.sdoc-slide-hit[data-shape-idx="1"] .sdoc-slide-hit-dot')).toHaveText('1');
    await expect(page.locator('.sdoc-slide-comment-list .sdoc-slide-card').first()).toContainText('trim this');
  });

  test('whole-slide button stores a comment with no shape index', async ({ page }) => {
    await enterCommentMode(page);
    await loadDeck(page);
    await page.locator('.sdoc-slide[data-slide-index="1"] .sdoc-slide-comment-btn').click();
    const composer = page.locator('.sdoc-slide-card.sdoc-card-edit');
    await expect(composer.locator('.sdoc-slide-card-target')).toContainText('whole slide');
    await composer.locator('.sdoc-card-input').fill('Drop this slide');
    await composer.locator('.sdoc-card-save').click();
    await page.waitForTimeout(100);

    const cs = await slideComments(page);
    expect(cs.length).toBe(1);
    expect(cs[0].slide).toBe(1);
    expect('shape' in cs[0]).toBe(false);
    expect(cs[0].text).toBe('Drop this slide');
  });

  test('deleting a slide comment removes it', async ({ page }) => {
    await enterCommentMode(page);
    await loadDeck(page);
    await page.locator('.sdoc-slide[data-slide-index="0"] .sdoc-slide-hit[data-shape-idx="0"]').click();
    await page.locator('.sdoc-slide-card.sdoc-card-edit .sdoc-card-input').fill('temp');
    await page.locator('.sdoc-slide-card.sdoc-card-edit .sdoc-card-save').click();
    await page.waitForTimeout(120);
    expect((await slideComments(page)).length).toBe(1);

    await page.locator('.sdoc-slide-comment-list .sdoc-card-delete').first().click();
    await page.waitForTimeout(120);
    expect((await slideComments(page)).length).toBe(0);
  });

  test('copy-with-comments includes the slide note as a footnote', async ({ page }) => {
    await enterCommentMode(page);
    await loadDeck(page);
    await page.locator('.sdoc-slide[data-slide-index="0"] .sdoc-slide-hit[data-shape-idx="0"]').click();
    await page.locator('.sdoc-slide-card.sdoc-card-edit .sdoc-card-input').fill('punchier please');
    await page.locator('.sdoc-slide-card.sdoc-card-edit .sdoc-card-save').click();
    await page.waitForTimeout(120);

    await page.evaluate(() => document.getElementById('_sd_comment-copy-doc').click());
    await page.waitForTimeout(80);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toMatch(/\[\^c1\]:.*punchier please \(slide 1, element 0 "Q4 Review"\)/);
  });

  test('a commented slide shows both copy triggers above its cards', async ({ page }) => {
    await enterCommentMode(page);
    await loadDeck(page);
    // No actions row before any comment exists.
    await expect(page.locator('.sdoc-slide-comment-actions')).toHaveCount(0);
    await page.locator('.sdoc-slide[data-slide-index="0"] .sdoc-slide-hit[data-shape-idx="0"]').click();
    await page.locator('.sdoc-slide-card.sdoc-card-edit .sdoc-card-input').fill('note');
    await page.locator('.sdoc-slide-card.sdoc-card-edit .sdoc-card-save').click();
    await page.waitForTimeout(120);
    const actions = page.locator('.sdoc-slide-comment-list[data-for="0"] .sdoc-slide-comment-actions');
    await expect(actions).toHaveCount(1);
    await expect(actions.locator('.sdoc-slide-copy-c')).toHaveCount(2);
    await expect(actions.locator('.sdoc-slide-copy-c').first()).toContainText('slide with comments');
    await expect(actions.locator('.sdoc-slide-copy-c').nth(1)).toContainText('with comments');
  });

  test('"slide with comments" copies that slide source + its notes', async ({ page }) => {
    await enterCommentMode(page);
    await loadDeck(page);
    await page.locator('.sdoc-slide[data-slide-index="0"] .sdoc-slide-hit[data-shape-idx="0"]').click();
    await page.locator('.sdoc-slide-card.sdoc-card-edit .sdoc-card-input').fill('punchier');
    await page.locator('.sdoc-slide-card.sdoc-card-edit .sdoc-card-save').click();
    await page.waitForTimeout(120);
    await page.locator('.sdoc-slide-comment-list[data-for="0"] .sdoc-slide-copy-c').first().click();
    await page.waitForTimeout(80);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('Feedback on slide 1:');
    expect(clip).toContain('~~~slide');
    expect(clip).toMatch(/\[\^c1\]:.*punchier \(slide 1, element 0 "Q4 Review"\)/);
    // It should be just this slide - the second slide's "Thank you" must not leak in.
    expect(clip).not.toContain('Thank you');
  });

  test('"with comments" from a slide copies the whole document with comments', async ({ page }) => {
    await enterCommentMode(page);
    await loadDeck(page);
    await page.locator('.sdoc-slide[data-slide-index="1"] .sdoc-slide-comment-btn').click();
    await page.locator('.sdoc-slide-card.sdoc-card-edit .sdoc-card-input').fill('drop this');
    await page.locator('.sdoc-slide-card.sdoc-card-edit .sdoc-card-save').click();
    await page.waitForTimeout(120);
    await page.locator('.sdoc-slide-comment-list[data-for="1"] .sdoc-slide-copy-c').nth(1).click();
    await page.waitForTimeout(80);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    // Whole-doc copy: includes the prose body AND the slide note footnote.
    expect(clip).toContain('between the slides');
    expect(clip).toMatch(/\[\^c1\]:.*drop this \(slide 2/);
  });

  test('slide comments are not counted as orphaned text comments', async ({ page }) => {
    await enterCommentMode(page);
    await loadDeck(page);
    await page.locator('.sdoc-slide[data-slide-index="0"] .sdoc-slide-hit[data-shape-idx="0"]').click();
    await page.locator('.sdoc-slide-card.sdoc-card-edit .sdoc-card-input').fill('note');
    await page.locator('.sdoc-slide-card.sdoc-card-edit .sdoc-card-save').click();
    await page.waitForTimeout(120);
    // No "N orphaned" badge, and no orphaned text-comment cards in the body.
    await expect(page.locator('#_sd_comment-orphan')).toBeHidden();
    await expect(page.locator('.sdoc-card-orphaned')).toHaveCount(0);
  });

  test('leaving comment mode tears down the hit layer', async ({ page }) => {
    await enterCommentMode(page);
    await loadDeck(page);
    await expect(page.locator('.sdoc-slide-hit').first()).toBeVisible();
    await page.evaluate(() => document.getElementById('_sd_btn-read').click());
    await page.waitForTimeout(100);
    await expect(page.locator('.sdoc-slide-hit')).toHaveCount(0);
    await expect(page.locator('.sdoc-slide-comment-btn')).toHaveCount(0);
  });
});

// ── Present mode ────────────────────────────────────────────────────────────

test.describe('present-mode slide comments', () => {
  test('topbar comment toggle reveals the hit layer on the active slide', async ({ page }) => {
    await loadDeck(page);
    await page.locator('.sdoc-slide-present').first().click();
    await expect(page.locator('.sdoc-present')).toHaveCount(1);
    await expect(page.locator('.sdoc-present .sdoc-slide-hit')).toHaveCount(0);

    await page.locator('.sdoc-present-comment-btn').click();
    await expect(page.locator('.sdoc-present .sdoc-slide-hit').first()).toBeVisible();
    await expect(page.locator('.sdoc-present-comment-panel')).toHaveCount(1);
  });

  test('commenting on an element while presenting stores it', async ({ page }) => {
    await loadDeck(page);
    await page.locator('.sdoc-slide-present').first().click();
    await page.locator('.sdoc-present-comment-btn').click();
    await page.locator('.sdoc-present .sdoc-slide-hit[data-shape-idx="0"]').click();
    const composer = page.locator('.sdoc-present-comment-panel .sdoc-card-edit');
    await expect(composer).toHaveCount(1);
    await composer.locator('.sdoc-card-input').fill('about the last six months');
    await composer.locator('.sdoc-card-save').click();
    await page.waitForTimeout(150);

    const cs = await slideComments(page);
    expect(cs.length).toBe(1);
    expect(cs[0].slide).toBe(0);
    expect(cs[0].shape).toBe(0);
    expect(cs[0].text).toBe('about the last six months');
  });

  test('present comment panel surfaces the copy-with-comments buttons', async ({ page }) => {
    await loadDeck(page);
    await page.locator('.sdoc-slide-present').first().click();
    await page.locator('.sdoc-present-comment-btn').click();
    await page.locator('.sdoc-present .sdoc-slide-hit[data-shape-idx="0"]').click();
    const composer = page.locator('.sdoc-present-comment-panel .sdoc-card-edit');
    await composer.locator('.sdoc-card-input').fill('tighten the title');
    await composer.locator('.sdoc-card-save').click();
    await page.waitForTimeout(150);
    const actions = page.locator('.sdoc-present-comment-panel .sdoc-slide-comment-actions');
    await expect(actions.locator('.sdoc-slide-copy-c')).toHaveCount(2);
    // The whole-doc "with comments" trigger works from inside present too.
    await actions.locator('.sdoc-slide-copy-c').nth(1).click();
    await page.waitForTimeout(80);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toMatch(/\[\^c1\]:.*tighten the title \(slide 1, element 0/);
  });

  test('present comment panel lists the active slide notes', async ({ page }) => {
    await loadDeck(page);
    await page.locator('.sdoc-slide-present').first().click();
    await page.locator('.sdoc-present-comment-btn').click();
    await page.locator('.sdoc-present .sdoc-slide-comment-btn').click();
    const composer = page.locator('.sdoc-present-comment-panel .sdoc-card-edit');
    await composer.locator('.sdoc-card-input').fill('reorder this deck');
    await composer.locator('.sdoc-card-save').click();
    await page.waitForTimeout(150);
    await expect(page.locator('.sdoc-present-comment-panel .sdoc-slide-card')).toContainText('reorder this deck');
  });
});
