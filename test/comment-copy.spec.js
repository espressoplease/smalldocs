// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

/**
 * Copy-with-comments end-to-end tests.
 *
 * These tests cover the two output flows specifically and assert the
 * serialized clipboard text — not just rendering. Both bugs they protect
 * against (anchor placed on the wrong occurrence when a quote repeats;
 * comments from a sibling section leaking into a per-section copy) were
 * surfaced from real usage.
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
    window.SDocs.currentMeta = {};
    window.SDocs.render();
    if (window.SDocs.commentsUi && window.SDocs.commentsUi.onHostRender) {
      window.SDocs.commentsUi.onHostRender();
    }
  }, md);
}

// Anchor a comment by clicking inside the rendered DOM and selecting the
// Nth (0-indexed) text-node match of `quote`. This mirrors what the
// composer does — captures prefix/suffix from the rendered DOM, picks the
// containing block — without going through the popover UI.
async function anchorOnNthOccurrence(page, quote, n, text) {
  return page.evaluate(([q, idx, t]) => {
    var SDC = window.SDocComments;
    var root = window.SDocs.renderedEl;
    // Walk text nodes, find the Nth occurrence of `q` and select it.
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var seen = 0, match = null, matchOffset = 0;
    var node;
    while ((node = walker.nextNode()) !== null) {
      var pos = -1, from = 0;
      while ((pos = node.nodeValue.indexOf(q, from)) !== -1) {
        if (seen === idx) { match = node; matchOffset = pos; break; }
        seen++;
        from = pos + q.length;
      }
      if (match) break;
    }
    if (!match) throw new Error('Quote not found at occurrence ' + idx + ': ' + q);
    var range = document.createRange();
    range.setStart(match, matchOffset);
    range.setEnd(match, matchOffset + q.length);
    // Mimic captureContext + nearestTopBlock from sdocs-comments-ui.js.
    var TOP_BLOCK_SEL = 'p, pre, blockquote, ul, ol, h1, h2, h3, h4, h5, h6, table, .sdoc-chart';
    function nearestTopBlock(n) {
      var el = n.nodeType === 1 ? n : n.parentNode;
      while (el && el !== root && el !== document.body) {
        if (el.matches && el.matches(TOP_BLOCK_SEL)) return el;
        el = el.parentNode;
      }
      return null;
    }
    var block = nearestTopBlock(range.startContainer);
    var preR = document.createRange();
    preR.selectNodeContents(block);
    preR.setEnd(range.startContainer, range.startOffset);
    var beforeAll = preR.toString();
    preR.setStart(range.endContainer, range.endOffset);
    preR.setEnd(block, block.childNodes.length);
    var afterAll = preR.toString();
    var prefix = beforeAll.slice(Math.max(0, beforeAll.length - 40));
    var suffix = afterAll.slice(0, 40);
    function blockId(b) {
      var t = b.classList && b.classList.contains('sdoc-chart')
        ? 'chart' : b.tagName.toLowerCase();
      var siblings = root.querySelectorAll(t);
      var pos = -1;
      for (var i = 0; i < siblings.length; i++) {
        if (siblings[i] === b) { pos = i; break; }
        // Only count top-level siblings of that tag (skip nested).
      }
      return pos === -1 ? '' : t + ':' + pos;
    }
    var bid = window.SDocs.commentsUi._computeBlockId(block, root);
    var res = SDC.addSelectionComment(window.SDocs.currentMeta || {}, {
      quote: q, prefix: prefix, suffix: suffix, block: bid,
    }, { author: 'u', color: '#ffbb00', at: '2026-04-24T15:00Z', text: t });
    window.SDocs.currentMeta = res.meta;
    window.SDocs.syncAll('comment');
    return res.id;
  }, [quote, n, text]);
}

// Click a heading's "with comments" companion button, return clipboard text.
async function copySection(page, headingMatcher) {
  // Make sure the section is open so the button exists.
  await page.evaluate((needle) => {
    var hs = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    var h = hs.find(x => x.textContent.indexOf(needle) !== -1);
    if (!h) throw new Error('No heading matches ' + needle);
    var btn = h.querySelector('.sdoc-head-copy-c');
    if (!btn) throw new Error('No copy-with-comments btn on ' + needle);
    btn.click();
  }, headingMatcher);
  // navigator.clipboard.writeText runs in a promise; give it a tick.
  await page.waitForTimeout(50);
  return page.evaluate(() => navigator.clipboard.readText());
}

// Trigger the toolbar "copy doc" button (whole-doc, footnote format).
async function copyWholeDoc(page) {
  await page.evaluate(() => {
    document.getElementById('_sd_comment-copy-doc').click();
  });
  await page.waitForTimeout(50);
  return page.evaluate(() => navigator.clipboard.readText());
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(BASE + '/');
  await page.waitForFunction(() => !!window.SDocs && !!window.SDocs.render);
  await enterCommentMode(page);
});

// ── Bug 1: anchor lands on the right occurrence ──────────────────────────

test.describe('copy-with-comments: occurrence accuracy', () => {
  test('whole-doc copy: comment on second of two SDocs lands on second SDocs', async ({ page }) => {
    // Two `SDocs` mentions in the same paragraph. Comment on the SECOND.
    // Expect: marker on second, first one untouched.
    await setBody(page, 'Run sdoc to wire SDocs into agents. SDocs works best.\n');
    await anchorOnNthOccurrence(page, 'SDocs', 1, 'second occurrence');
    const out = await copyWholeDoc(page);
    // Marker should appear on second SDocs, not the first.
    const idxFirstSDocs = out.indexOf('SDocs');
    const idxMarker = out.indexOf('[SDocs][^c1]');
    expect(idxMarker).toBeGreaterThan(idxFirstSDocs);
    // Only one marker total.
    expect((out.match(/\[\^c1\]/g) || []).length).toBe(2); // 1 ref + 1 def
    // First SDocs must remain plain (no `[SDocs][^c1]` before the marker).
    expect(out.slice(0, idxMarker).indexOf('[SDocs][^c1]')).toBe(-1);
  });

  test('whole-doc copy: comment on first of two SDocs lands on first', async ({ page }) => {
    await setBody(page, 'Run sdoc to wire SDocs into agents. SDocs works best.\n');
    await anchorOnNthOccurrence(page, 'SDocs', 0, 'first occurrence');
    const out = await copyWholeDoc(page);
    const idxFirst = out.indexOf('[SDocs][^c1]');
    expect(idxFirst).toBeGreaterThan(-1);
    // The "second SDocs" raw text should still appear unwrapped after.
    expect(out.indexOf('SDocs works best')).toBeGreaterThan(idxFirst);
  });

  test('whole-doc copy: anchor that crosses **bold** markdown still places marker correctly', async ({ page }) => {
    // Source: Hello **SDocs** world. SDocs is great.
    // Rendered: Hello SDocs world. SDocs is great.
    // Comment on the SECOND SDocs (after "world."). The captured prefix
    // (rendered) won't byte-match the source because of the `**`. The
    // occurrence-index path is the only thing that lets us pick the right
    // one without smashing the formatting.
    await setBody(page, 'Hello **SDocs** world. SDocs is great.\n');
    await anchorOnNthOccurrence(page, 'SDocs', 1, 'second-only');
    const out = await copyWholeDoc(page);
    // The first SDocs sits inside `**...**` — the marker must NOT land
    // there (would break the bold formatting), and it MUST land on the
    // second occurrence which is plain.
    expect(out).toContain('**SDocs**'); // first occurrence preserved
    expect(out).toContain('[SDocs][^c1] is great');
  });

  test('two SDocs in the same <pre>, comment on second: marker on second', async ({ page }) => {
    // Mirrors the screenshot scenario.
    const md = [
      '## First-time install',
      '',
      '```',
      'sdocs-dev installed. Run `sdoc` to wire SDocs into your coding agents.',
      '',
      'SDocs works best in conversation with a CLI coding agent.',
      '```',
      '',
    ].join('\n');
    await setBody(page, md);
    await anchorOnNthOccurrence(page, 'SDocs', 1, 'This allows you to use SDocs naturally.');
    const out = await copyWholeDoc(page);
    // First SDocs still plain; second SDocs wrapped.
    expect(out).toContain('wire SDocs into your coding'); // first untouched
    expect(out).toContain('[SDocs][^c1] works best');     // second wrapped
  });
});

// ── Bug 2: section-scoped copy filters comments correctly ────────────────

test.describe('copy-with-comments: section scoping', () => {
  test('per-section copy: only comments anchored inside that section are emitted', async ({ page }) => {
    const md = [
      '## A',
      '',
      'Para A with target word.',
      '',
      '## B',
      '',
      'Para B has its own target word too.',
      '',
    ].join('\n');
    await setBody(page, md);
    // Open both sections so the rendered subtree includes the paragraphs.
    await page.evaluate(() => {
      document.querySelectorAll('h2').forEach(h => {
        var section = h.closest('.md-section');
        var body = section && section.querySelector(':scope > .md-section-body');
        if (body) body.classList.add('open');
      });
    });
    // Comment A — anchored in section A. Comment B — anchored in section B.
    await anchorOnNthOccurrence(page, 'target word', 0, 'note A');
    await anchorOnNthOccurrence(page, 'target word', 1, 'note B');
    // Copy only section B.
    const out = await copySection(page, 'B');
    // Only c2's footnote definition should be present.
    expect(out).toContain('[^c2]: u - note B');
    expect(out).not.toContain('[^c1]: u - note A');
    // Section A's paragraph should NOT appear.
    expect(out).not.toContain('Para A');
  });

  test('per-section copy: a quote that also exists in another section does NOT bring that section\'s comment along', async ({ page }) => {
    // Direct repro of the user's reported bug. Comment A's quote ("bar")
    // also appears in section B's paragraph, but the comment is anchored
    // in section A. Section B's copy must not include it.
    const md = [
      '## A',
      '',
      'foo and bar.',
      '',
      '## B',
      '',
      'baz and bar too.',
      '',
    ].join('\n');
    await setBody(page, md);
    await page.evaluate(() => {
      document.querySelectorAll('h2').forEach(h => {
        var section = h.closest('.md-section');
        var body = section && section.querySelector(':scope > .md-section-body');
        if (body) body.classList.add('open');
      });
    });
    // Comment A on "bar" inside section A
    await anchorOnNthOccurrence(page, 'bar', 0, 'note A');
    // Comment B on "baz" inside section B
    await anchorOnNthOccurrence(page, 'baz', 0, 'note B');
    const out = await copySection(page, 'B');
    expect(out).toContain('note B');
    expect(out).not.toContain('note A');
    // The "bar" inside section B must be unmarked (no [^c1]).
    expect(out).not.toContain('[bar][^c1]');
  });

  test('per-section copy: meta keys (file, styles) are preserved so the round-trip + header retain context', async ({ page }) => {
    await setBody(page, '## A\n\nPara A.\n\n## B\n\nPara B with target.\n');
    await page.evaluate(() => {
      // Seed file + styles meta as the loader would when opening a doc.
      window.SDocs.currentMeta = Object.assign({}, window.SDocs.currentMeta || {},
        { file: 'demo.md', styles: { fontFamily: 'Lora' } });
      document.querySelectorAll('h2').forEach(h => {
        var section = h.closest('.md-section');
        var body = section && section.querySelector(':scope > .md-section-body');
        if (body) body.classList.add('open');
      });
    });
    await anchorOnNthOccurrence(page, 'target', 0, 'note');
    const out = await copySection(page, 'B');
    // Header must reflect the file name when present.
    expect(out.startsWith('Feedback on demo.md:')).toBe(true);
  });

  test('per-section copy: block comment whose target lives in section A is excluded from section B copy', async ({ page }) => {
    const md = [
      '## A',
      '',
      'Para in A.',
      '',
      '## B',
      '',
      'Para in B.',
      '',
    ].join('\n');
    await setBody(page, md);
    await page.evaluate(() => {
      document.querySelectorAll('h2').forEach(h => {
        var section = h.closest('.md-section');
        var body = section && section.querySelector(':scope > .md-section-body');
        if (body) body.classList.add('open');
      });
    });
    // Block comment on each <p>. Without a comment in section B, the
    // per-heading "with comments" button wouldn't render — so we put a
    // distinct one in B too and assert A's text does not leak in.
    await page.evaluate(() => {
      var SDC = window.SDocComments;
      var meta = window.SDocs.currentMeta || {};
      var r1 = SDC.addBlockComment(meta,
        { block: 'p:0', block_text: 'Para in A' },
        { author: 'u', color: '#ffbb00', at: '2026-04-24T15:00Z', text: 'block on A' });
      var r2 = SDC.addBlockComment(r1.meta,
        { block: 'p:1', block_text: 'Para in B' },
        { author: 'u', color: '#ffbb00', at: '2026-04-24T15:00Z', text: 'block on B' });
      window.SDocs.currentMeta = r2.meta;
      window.SDocs.syncAll('comment');
    });
    const out = await copySection(page, 'B');
    expect(out).toContain('block on B');
    expect(out).not.toContain('block on A');
  });
});
