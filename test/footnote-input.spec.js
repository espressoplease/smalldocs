// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

/**
 * Footnote-format comment input - end-to-end tests.
 *
 * Agents author comments by editing the body with standard markdown
 * footnote markers ([quote][^cN] inline, [^cN] block) plus [^cN]: defs
 * at the end of the document. SDocs lifts those out at load time, merges
 * them with any pre-existing meta.comments, and renders them in comment
 * mode using the same yellow-card UI the human-facing UI produces.
 *
 * These tests load a markdown string through the production loadText path
 * (the same one a dropped file or hash payload goes through) and assert
 * on the rendered DOM. The contract under test:
 *
 *   1. Inline footnotes become inline pills anchored to the quoted span.
 *   2. Block footnotes become sidecar cards under the containing block.
 *   3. The footnote markers are stripped from the rendered body (no
 *      stray superscripts, no leftover "[^cN]" text).
 *   4. Pre-existing meta.comments survives - body markers add to it.
 *   5. [resolved] flag in the def carries through to meta.
 *   6. Non-cN footnote ids are left alone (academic citations etc).
 */

async function enterCommentMode(page) {
  await page.evaluate(() => {
    var btn = document.getElementById('_sd_btn-comment');
    if (!document.body.classList.contains('comment-mode')) btn.click();
  });
  await expect(page.locator('body.comment-mode')).toBeVisible();
}

// Run the doc through the same loadText path the file-drop / URL-hash flows
// use. This exercises the parseFootnotes integration in sdocs-app.js.
async function loadDoc(page, md) {
  await page.evaluate((text) => {
    window.SDocs.loadText(text, 'test.md');
  }, md);
  // loadText runs render() synchronously; give the comments-ui a tick
  // to attach cards.
  await page.waitForTimeout(50);
}

test.beforeEach(async ({ page }) => {
  await page.goto(BASE + '/');
  await page.waitForFunction(() => !!window.SDocs && !!window.SDocs.loadText);
  await enterCommentMode(page);
});

test.describe('footnote-format input', () => {
  test('inline footnote renders as an inline pill on the quoted span', async ({ page }) => {
    await loadDoc(page, [
      '# Project Update',
      '',
      '## Status',
      '',
      'We hit one snag: the [rate-limit changes][^c1] broke a downstream service.',
      '',
      '[^c1]: agent - which limits specifically?',
      '',
    ].join('\n'));

    const state = await page.evaluate(() => {
      const meta = window.SDocs.currentMeta || {};
      const comments = meta.comments || [];
      const inlinePills = Array.from(document.querySelectorAll('.sdoc-card-pill'));
      const sidecarCards = Array.from(document.querySelectorAll('.sdoc-card-sidecar'));
      const anchor = document.querySelector('span.sdoc-anchor[data-c="c1"]');
      return {
        commentsLen: comments.length,
        kind: comments[0] && comments[0].kind,
        quote: comments[0] && comments[0].quote,
        text: comments[0] && comments[0].text,
        author: comments[0] && comments[0].author,
        pillCount: inlinePills.length,
        sidecarCount: sidecarCards.length,
        anchorText: anchor && anchor.textContent,
      };
    });

    expect(state.commentsLen).toBe(1);
    expect(state.kind).toBe('inline');
    expect(state.quote).toBe('rate-limit changes');
    expect(state.text).toBe('which limits specifically?');
    expect(state.author).toBe('agent');
    expect(state.pillCount).toBe(1);
    expect(state.sidecarCount).toBe(0);
    expect(state.anchorText).toBe('rate-limit changes');
  });

  test('block footnote renders as a sidecar card under the right block', async ({ page }) => {
    await loadDoc(page, [
      '# Project Update',
      '',
      '## Status',
      '',
      'We are on track to ship v2.4 in week 6.[^c1]',
      '',
      'Some unrelated paragraph.',
      '',
      '[^c1]: agent - actually slipped to week 8',
      '',
    ].join('\n'));

    const state = await page.evaluate(() => {
      const meta = window.SDocs.currentMeta || {};
      const comments = meta.comments || [];
      const sidecar = document.querySelector('.sdoc-card-sidecar');
      const host = sidecar && sidecar.closest('.sdoc-block-host');
      const block = host && host.querySelector('p, h1, h2, h3, h4, ul, ol, pre, blockquote, table');
      return {
        commentsLen: comments.length,
        kind: comments[0] && comments[0].kind,
        text: comments[0] && comments[0].text,
        sidecarPresent: !!sidecar,
        sidecarText: sidecar && sidecar.textContent.trim(),
        blockText: block && block.textContent.trim(),
      };
    });

    expect(state.commentsLen).toBe(1);
    expect(state.kind).toBe('block');
    expect(state.sidecarPresent).toBe(true);
    expect(state.sidecarText).toContain('actually slipped to week 8');
    expect(state.blockText).toBe('We are on track to ship v2.4 in week 6.');
  });

  test('strips footnote markers from the rendered body', async ({ page }) => {
    await loadDoc(page, [
      '# Doc',
      '',
      'A paragraph with [an inline anchor][^c1] in it.[^c2]',
      '',
      '[^c1]: agent - inline note',
      '[^c2]: agent - block note',
      '',
    ].join('\n'));

    const renderedText = await page.evaluate(() =>
      document.getElementById('_sd_rendered').textContent
    );
    expect(renderedText).not.toMatch(/\[\^c\d+\]/);
    // Definition lines must also be gone from the rendered body.
    expect(renderedText).not.toMatch(/\[\^c\d+\]:/);
    // The body string the app holds must also be clean - round-trip safety.
    const storedBody = await page.evaluate(() => window.SDocs.currentBody);
    expect(storedBody).not.toMatch(/\[\^c\d+\]/);
  });

  test('merges body footnote comments with pre-existing YAML comments', async ({ page }) => {
    await loadDoc(page, [
      '---',
      'title: "Hybrid"',
      'comments:',
      '  - id: c1',
      '    kind: block',
      '    block: "h2:0"',
      '    block_text: "Status"',
      '    author: human',
      '    at: "2026-04-22T09:00:00Z"',
      '    text: "human-written"',
      '---',
      '',
      '# Doc',
      '',
      '## Status',
      '',
      'A paragraph with [an inline][^c2] from the agent.',
      '',
      '[^c2]: agent - agent-written',
      '',
    ].join('\n'));

    const ids = await page.evaluate(() =>
      ((window.SDocs.currentMeta || {}).comments || []).map(c => ({ id: c.id, author: c.author }))
    );
    expect(ids).toEqual([
      { id: 'c1', author: 'human' },
      { id: 'c2', author: 'agent' },
    ]);
  });

  test('[resolved] flag in def carries through to meta.comments', async ({ page }) => {
    await loadDoc(page, [
      '# Doc',
      '',
      'A paragraph here.[^c1]',
      '',
      '[^c1]: priya [resolved] - already addressed',
      '',
    ].join('\n'));

    const state = await page.evaluate(() => {
      const c = ((window.SDocs.currentMeta || {}).comments || [])[0];
      return c ? { resolved: c.resolved, author: c.author, text: c.text } : null;
    });
    expect(state).toEqual({ resolved: true, author: 'priya', text: 'already addressed' });
  });

  test('non-cN footnote ids pass through untouched', async ({ page }) => {
    await loadDoc(page, [
      '# Doc',
      '',
      'See the seminal paper[^citation1] for context. Also [a comment][^c1] here.',
      '',
      '[^citation1]: Smith et al., 1998.',
      '[^c1]: agent - check this',
      '',
    ].join('\n'));

    const state = await page.evaluate(() => ({
      commentsLen: ((window.SDocs.currentMeta || {}).comments || []).length,
      bodyHasCitation: window.SDocs.currentBody.indexOf('citation1') >= 0,
      renderedHasCitation: document.getElementById('_sd_rendered').textContent.indexOf('Smith et al') >= 0,
    }));
    expect(state.commentsLen).toBe(1);  // only c1, citation1 is left alone
    expect(state.bodyHasCitation).toBe(true);
    expect(state.renderedHasCitation).toBe(true);
  });

  test('round-trips through serializeFootnotes without losing comments', async ({ page }) => {
    const original = [
      '# Doc',
      '',
      'Paragraph one with [a span][^c1] anchored.',
      '',
      'Paragraph two carries a block comment.[^c2]',
      '',
      '[^c1]: agent - inline note',
      '[^c2]: agent - block note',
      '',
    ].join('\n');
    await loadDoc(page, original);

    // Serialize back to footnote format using the production exporter.
    const reSerialized = await page.evaluate(() => {
      var SDC = window.SDocComments;
      return SDC.serializeFootnotes(window.SDocs.currentMeta, window.SDocs.currentBody);
    });
    // Re-load that output. The comments should still be present with the
    // same ids and texts.
    await loadDoc(page, reSerialized);
    const state = await page.evaluate(() =>
      ((window.SDocs.currentMeta || {}).comments || [])
        .map(c => ({ id: c.id, kind: c.kind, text: c.text }))
        .sort((a, b) => a.id.localeCompare(b.id))
    );
    expect(state).toEqual([
      { id: 'c1', kind: 'inline', text: 'inline note' },
      { id: 'c2', kind: 'block', text: 'block note' },
    ]);
  });
});
