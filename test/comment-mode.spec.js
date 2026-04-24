// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

/**
 * Comment mode end-to-end tests.
 *
 * Comment mode stores comments as inline HTML comments in the markdown body
 * (`<!--sdoc-c:cN-->anchor text<!--/sdoc-c:cN-->` + a sibling
 * `<!--sdoc-comment id="cN" ...-->` metadata block). These tests drive the
 * feature the way a user would — entering comment mode, selecting text or
 * using the gutter button, saving via the composer — and then assert on the
 * resulting markdown body AND on the DOM the app re-renders.
 *
 * Regressions these guard:
 *   - Save on a paragraph at the start of a markdown line used to drop the
 *     surrounding <p> (marked parsed the leading comment as a block HTML
 *     fragment). Anchor orphaned.
 *   - Selection crossing inline code (`npm i`) used to wrap only one
 *     backtick, so marked absorbed the closing comment into code text.
 *   - Gutter button used to fade before the cursor reached it.
 *   - Entering comment mode on a doc with nested headings under an
 *     expanded collapsible section must still find the paragraph.
 */

async function enterCommentMode(page) {
  await page.evaluate(() => {
    var btn = document.getElementById('_sd_btn-comment');
    if (!document.body.classList.contains('comment-mode')) btn.click();
  });
  await expect(page.locator('body.comment-mode')).toBeVisible();
}

async function setBody(page, md) {
  await page.evaluate((body) => {
    window.SDocs.currentBody = body;
    window.SDocs.render();
    if (window.SDocs.commentsUi && window.SDocs.commentsUi.onHostRender) {
      window.SDocs.commentsUi.onHostRender();
    }
  }, md);
}

// Helper: run addSelectionComment end-to-end through the save path the UI uses.
async function saveSelectionComment(page, selectedText, context, text) {
  return page.evaluate(([sel, ctx, msg]) => {
    var SDC = window.SDocComments;
    var res = SDC.addSelectionComment(window.SDocs.currentBody, {
      selectedText: sel, before: ctx.before || '', after: ctx.after || '',
    }, { text: msg, author: 'u', color: '#ffd700', at: '' });
    window.SDocs.currentBody = res.md;
    window.SDocs.syncAll('comment');
    return res.id;
  }, [selectedText, context, text]);
}

test.beforeEach(async ({ page }) => {
  await page.goto(BASE + '/');
  await page.waitForFunction(() => !!window.SDocs && !!window.SDocs.render);
  await enterCommentMode(page);
});

test.describe('comment mode lifecycle', () => {
  test('entering comment mode adds gutter hosts to all top-level blocks', async ({ page }) => {
    await setBody(page, '# H1\n\nParagraph one.\n\n> Quote.\n\n- item\n');
    const hostCount = await page.evaluate(() => {
      return document.querySelectorAll('.sdoc-block-host').length;
    });
    // H1 + paragraph + blockquote + ul = 4 hosts
    expect(hostCount).toBe(4);
  });

  test('exiting comment mode strips all gutter + card + anchor UI', async ({ page }) => {
    await setBody(page, '# H1\n\nParagraph.\n');
    await saveSelectionComment(page, 'Paragraph', { before: '', after: '.' }, 'x');
    // Leave comment mode
    await page.evaluate(() => { document.getElementById('_sd_btn-read').click(); });
    const stats = await page.evaluate(() => ({
      gutter: document.querySelectorAll('.sdoc-gutter-add').length,
      card: document.querySelectorAll('.sdoc-card').length,
      anchor: document.querySelectorAll('span.sdoc-anchor').length,
      host: document.querySelectorAll('.sdoc-block-host').length,
    }));
    expect(stats).toEqual({ gutter: 0, card: 0, anchor: 0, host: 0 });
  });
});

test.describe('saving comments', () => {
  test('selection at the very start of a paragraph keeps the <p> intact', async ({ page }) => {
    // Regression: leading HTML comment at line start made marked emit block
    // HTML, not a paragraph. Anchor ended up as a direct child of
    // #_sd_rendered and the toolbar showed "anchor lost".
    await setBody(page, '# T\n\n## S\n\nFirst paragraph inside section.\n');
    await saveSelectionComment(page, 'First paragraph', { before: '', after: ' inside' }, 'hi');
    const state = await page.evaluate(() => {
      var anchor = document.querySelector('span.sdoc-anchor[data-c="c1"]');
      var card = document.querySelector('.sdoc-card[data-c="c1"]');
      return {
        anchorFound: !!anchor,
        anchorParent: anchor && anchor.parentElement && anchor.parentElement.tagName,
        cardOrphaned: card && card.classList.contains('sdoc-card-orphaned'),
      };
    });
    expect(state.anchorFound).toBe(true);
    expect(state.anchorParent).toBe('P');
    expect(state.cardOrphaned).toBe(false);
  });

  test('selection across inline code wraps the whole code span', async ({ page }) => {
    // Regression: wrapper included opening backtick but not closing,
    // leaving marked to absorb the close wrapper as code text.
    await setBody(page, 'Run `npm i -g sdocs-dev` to install.\n');
    await saveSelectionComment(page, 'Run npm i', { before: '', after: ' -g' }, 'x');
    const body = await page.evaluate(() => window.SDocs.currentBody);
    // Anchor must include both backticks (context attrs may appear on the open tag)
    expect(body).toMatch(/<!--sdoc-c:c1[^>]*-->Run `npm i -g sdocs-dev`<!--\/sdoc-c:c1-->/);
    // And the resulting paragraph must still render as a single <p>
    const pCount = await page.evaluate(() => document.querySelectorAll('#_sd_rendered p').length);
    expect(pCount).toBe(1);
  });

  test('selection entirely inside inline code pulls the backticks in', async ({ page }) => {
    await setBody(page, 'Before `npm i -g sdocs-dev`. After.\n');
    await saveSelectionComment(page, 'npm i -g', { before: '`', after: ' sdocs-dev' }, 'x');
    const body = await page.evaluate(() => window.SDocs.currentBody);
    expect(body).toMatch(/<!--sdoc-c:c1[^>]*-->`npm i -g sdocs-dev`<!--\/sdoc-c:c1-->/);
  });

  test('selection across bold keeps asterisks balanced', async ({ page }) => {
    await setBody(page, 'Some **bold** text here.\n');
    await saveSelectionComment(page, 'Some bold text', { before: '', after: ' here' }, 'x');
    const body = await page.evaluate(() => window.SDocs.currentBody);
    expect(body).toMatch(/<!--sdoc-c:c1[^>]*-->Some \*\*bold\*\* text<!--\/sdoc-c:c1-->/);
  });

  test('multiple comments on the same paragraph render independent anchors', async ({ page }) => {
    await setBody(page, 'One two three four five six.\n');
    await saveSelectionComment(page, 'two', { before: 'One ', after: ' three' }, 'a');
    await saveSelectionComment(page, 'five', { before: 'four ', after: ' six' }, 'b');
    const counts = await page.evaluate(() => ({
      anchors: document.querySelectorAll('span.sdoc-anchor').length,
      cards: document.querySelectorAll('.sdoc-card').length,
      orphans: document.querySelectorAll('.sdoc-card-orphaned').length,
    }));
    expect(counts).toEqual({ anchors: 2, cards: 2, orphans: 0 });
  });
});

test.describe('nested content under collapsible headings', () => {
  test('commenting on a paragraph under an H2 keeps it anchored after re-render', async ({ page }) => {
    // Regression: user selected text in a paragraph they had expanded from
    // an H2 collapsible. Save appeared to do nothing; card rendered at the
    // document foot with "anchor lost".
    await setBody(page, '# T\n\n## A\n\nPara under A.\n\n## B\n\nOther.\n');
    await saveSelectionComment(page, 'Para under A', { before: '', after: '.' }, 'note');
    const state = await page.evaluate(() => {
      var anchor = document.querySelector('span.sdoc-anchor[data-c="c1"]');
      if (!anchor) return { anchorFound: false };
      var sectionBody = anchor.closest('.md-section-body');
      var section = anchor.closest('.md-section');
      var h2 = section && section.querySelector('h2');
      return {
        anchorFound: true,
        insideSectionBody: !!sectionBody,
        h2Text: h2 && h2.textContent,
      };
    });
    expect(state.anchorFound).toBe(true);
    expect(state.insideSectionBody).toBe(true);
    expect(state.h2Text).toMatch(/A/);
  });
});

test.describe('removing comments', () => {
  test('delete restores the body to its pre-comment shape', async ({ page }) => {
    const original = '# T\n\nA plain paragraph with target text here.\n';
    await setBody(page, original);
    await saveSelectionComment(page, 'target text', { before: 'with ', after: ' here' }, 'x');
    await page.evaluate(() => {
      var del = document.querySelector('.sdoc-card-delete');
      if (del) del.click();
    });
    const body = await page.evaluate(() => window.SDocs.currentBody);
    // Wrapper and metadata gone; ZWS (if any was inserted) gone too.
    expect(body).not.toContain('sdoc-c:');
    expect(body).not.toContain('sdoc-comment');
    expect(body).not.toContain('​');
    expect(body).toContain('target text');
  });
});

test.describe('gutter button hover behavior', () => {
  test('has forgiving fade-out delay so mouse can reach it', async ({ page }) => {
    await setBody(page, '# T\n\nParagraph one.\n');
    const delays = await page.evaluate(() => {
      var btn = document.querySelector('.sdoc-gutter-add');
      var s = getComputedStyle(btn);
      return {
        pointerEvents: s.pointerEvents,
        delay: s.transitionDelay,
      };
    });
    // Button must stay interactive (pointer-events auto) even at opacity 0,
    // and opacity must have a >0 fade-out delay so transit from block to
    // button doesn't blip.
    expect(delays.pointerEvents).toBe('auto');
    const firstDelay = delays.delay.split(',')[0].trim();
    const seconds = parseFloat(firstDelay);
    expect(seconds).toBeGreaterThan(0);
  });
});

test.describe('block comment via gutter button', () => {
  test('clicking the gutter button opens a composer attached to that block', async ({ page }) => {
    await setBody(page, '# T\n\nOnly paragraph.\n');
    await page.evaluate(() => {
      var hosts = document.querySelectorAll('.sdoc-block-host');
      var pHost = Array.from(hosts).find(h => h.querySelector('p'));
      var btn = pHost.querySelector('.sdoc-gutter-add');
      btn.click();
    });
    const composerOpen = await page.evaluate(() => !!document.querySelector('.sdoc-composer'));
    expect(composerOpen).toBe(true);
  });
});
