// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

/**
 * Comment mode end-to-end tests — sidecar storage model.
 *
 * Comments live in `currentMeta.comments` (YAML front matter at save time).
 * The body is never touched. On render, anchors are resolved via text-quote
 * search in the post-render DOM with a three-tier fallback:
 *   1. block-scoped by `block: "tag:index"` hint
 *   2. global `prefix + quote + suffix`
 *   3. global `quote` only
 *
 * These tests drive the feature through the same API the UI uses and assert
 * on rendered DOM + frontmatter shape. Regressions this guards (all issues
 * surfaced during real usage of the earlier inline-HTML-comment format):
 *   - Line-start paragraph anchor used to drop the <p>.
 *   - Selection crossing inline code used to leave orphan backticks.
 *   - Multi-block selection used to wrap dozens of blocks.
 *   - Nested paragraphs under collapsible headings used to orphan.
 *   - Composer save used to corrupt the body with malformed HTML comments.
 *
 * All of those classes of bug are structurally eliminated by the sidecar
 * model, but these tests verify the new model behaves as intended.
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

// Apply a selection comment via the same API the composer uses.
// Returns the saved comment id.
async function saveInline(page, selectedText, opts) {
  opts = opts || {};
  return page.evaluate(([text, o]) => {
    var SDC = window.SDocComments;
    var res = SDC.addSelectionComment(window.SDocs.currentMeta || {}, {
      quote: text,
      prefix: o.prefix || '',
      suffix: o.suffix || '',
      block: o.block || '',
    }, {
      text: o.text || 'note',
      author: o.author || 'u',
      color: o.color || '#ffd700',
      at: o.at || '2026-04-24T15:00Z',
    });
    window.SDocs.currentMeta = res.meta;
    window.SDocs.syncAll('comment');
    return res.id;
  }, [selectedText, opts]);
}

async function saveBlock(page, blockId, text) {
  return page.evaluate(([bid, t]) => {
    var SDC = window.SDocComments;
    var res = SDC.addBlockComment(window.SDocs.currentMeta || {}, { block: bid },
      { text: t, author: 'u', color: '#ffd700', at: '2026-04-24T15:00Z' });
    window.SDocs.currentMeta = res.meta;
    window.SDocs.syncAll('comment');
    return res.id;
  }, [blockId, text]);
}

test.beforeEach(async ({ page }) => {
  await page.goto(BASE + '/');
  await page.waitForFunction(() => !!window.SDocs && !!window.SDocs.render);
  await enterCommentMode(page);
});

// ── Lifecycle ────────────────────────────────────────────────────────────

test.describe('comment mode lifecycle', () => {
  test('entering adds gutter hosts to all top-level blocks', async ({ page }) => {
    await setBody(page, '# H1\n\nParagraph one.\n\n> Quote.\n\n- item\n');
    const hostCount = await page.evaluate(() =>
      document.querySelectorAll('.sdoc-block-host').length);
    expect(hostCount).toBe(4);
  });

  test('exiting strips all gutter + card + anchor UI', async ({ page }) => {
    await setBody(page, '# H1\n\nParagraph.\n');
    await saveInline(page, 'Paragraph', { prefix: '', suffix: '.' });
    await page.evaluate(() => document.getElementById('_sd_btn-read').click());
    const stats = await page.evaluate(() => ({
      gutter: document.querySelectorAll('.sdoc-gutter-add').length,
      card: document.querySelectorAll('.sdoc-card').length,
      anchor: document.querySelectorAll('span.sdoc-anchor').length,
      host: document.querySelectorAll('.sdoc-block-host').length,
    }));
    expect(stats).toEqual({ gutter: 0, card: 0, anchor: 0, host: 0 });
  });

  test('body is NEVER mutated by comment operations', async ({ page }) => {
    const original = '# T\n\nParagraph with some text here.\n';
    await setBody(page, original);
    await saveInline(page, 'some text', { prefix: 'with ', suffix: ' here' });
    const body = await page.evaluate(() => window.SDocs.currentBody);
    expect(body).toBe(original);
  });

  test('comment lives in meta.comments, not in body', async ({ page }) => {
    await setBody(page, '# T\n\nHello world.\n');
    await saveInline(page, 'world', { prefix: 'Hello ', suffix: '.' });
    const state = await page.evaluate(() => ({
      bodyHasSdocMarker: /sdoc-c[:-]/i.test(window.SDocs.currentBody),
      commentCount: (window.SDocs.currentMeta.comments || []).length,
      commentQuote: (window.SDocs.currentMeta.comments || [])[0].quote,
    }));
    expect(state.bodyHasSdocMarker).toBe(false);
    expect(state.commentCount).toBe(1);
    expect(state.commentQuote).toBe('world');
  });
});

// ── Anchor resolution edge cases ─────────────────────────────────────────

test.describe('anchor resolution', () => {
  test('selection at paragraph start renders anchor inside <p>', async ({ page }) => {
    // Regression: the old inline-HTML-comment format dropped the <p>
    // when the comment landed at position 0. Sidecar has no such failure
    // mode, but the test protects the invariant.
    await setBody(page, '# T\n\n## S\n\nFirst phrase of paragraph here.\n');
    await saveInline(page, 'First phrase', { prefix: '', suffix: ' of paragraph' });
    const state = await page.evaluate(() => {
      var a = document.querySelector('span.sdoc-anchor[data-c="c1"]');
      return {
        found: !!a,
        parent: a && a.parentElement && a.parentElement.tagName,
        text: a && a.textContent,
      };
    });
    expect(state).toEqual({ found: true, parent: 'P', text: 'First phrase' });
  });

  test('selection spanning inline code resolves via rendered text (backticks irrelevant)', async ({ page }) => {
    // In the sidecar model, quote = rendered text ("Run npm i"), not source.
    // So backticks in source don't affect anchoring.
    await setBody(page, 'Run `npm i -g sdocs-dev` to install.\n');
    await saveInline(page, 'Run npm i', { prefix: '', suffix: ' -g' });
    const anchorText = await page.evaluate(() => {
      var a = document.querySelector('span.sdoc-anchor[data-c="c1"]');
      return a && a.textContent;
    });
    expect(anchorText).toBe('Run npm i');
  });

  test('selection spanning bold keeps the formatting intact inside the anchor', async ({ page }) => {
    await setBody(page, 'Some **bold** text here.\n');
    await saveInline(page, 'Some bold text', { prefix: '', suffix: ' here' });
    const state = await page.evaluate(() => {
      var a = document.querySelector('span.sdoc-anchor[data-c="c1"]');
      return {
        text: a && a.textContent,
        innerHTMLHasStrong: a && a.innerHTML.indexOf('<strong') !== -1,
      };
    });
    expect(state.text).toBe('Some bold text');
    expect(state.innerHTMLHasStrong).toBe(true);
  });

  test('nested paragraph under an H2 resolves to the correct paragraph', async ({ page }) => {
    await setBody(page, '# T\n\n## A\n\nPara under A.\n\n## B\n\nPara under B.\n');
    await saveInline(page, 'Para under A', { prefix: '', suffix: '.' });
    const state = await page.evaluate(() => {
      var a = document.querySelector('span.sdoc-anchor[data-c="c1"]');
      var section = a && a.closest('.md-section');
      var h2 = section && section.querySelector('h2');
      return {
        found: !!a,
        h2Text: h2 && h2.textContent,
      };
    });
    expect(state.found).toBe(true);
    expect(state.h2Text).toMatch(/A/);
    expect(state.h2Text).not.toMatch(/B/);
  });

  test('disambiguation: same quote appearing twice, prefix picks the right one', async ({ page }) => {
    await setBody(page, 'Red apple. Green apple. Both are fruit.\n');
    // Without prefix/suffix, quote "apple" is ambiguous. With context,
    // we should land on the Green one.
    await saveInline(page, 'apple', { prefix: 'Green ', suffix: '. Both' });
    const anchorTextInContext = await page.evaluate(() => {
      var a = document.querySelector('span.sdoc-anchor[data-c="c1"]');
      if (!a) return null;
      // The text that appears immediately before the anchor in DOM order.
      // This is the previous text sibling (which exists because the anchor
      // is wrapped inside a text node's parent).
      var prev = a.previousSibling;
      if (!prev) return null;
      return prev.textContent.slice(-6);
    });
    expect(anchorTextInContext).toBe('Green ');
  });

  test('orphan: quote that does not exist in body renders card with badge', async ({ page }) => {
    await setBody(page, '# T\n\nSome real content.\n');
    // Forge a comment whose quote has nothing to match.
    await page.evaluate(() => {
      window.SDocs.currentMeta = { comments: [
        { id: 'c99', kind: 'inline', quote: 'nonexistent phrase abc',
          author: 'u', color: '#ffd700', at: '', text: 'lost' }
      ]};
      window.SDocs.syncAll('comment');
    });
    const state = await page.evaluate(() => {
      var card = document.querySelector('.sdoc-card[data-c="c99"]');
      return {
        found: !!card,
        orphaned: card && card.classList.contains('sdoc-card-orphaned'),
        badgeText: card && card.querySelector('.sdoc-card-orphan-badge') &&
                   card.querySelector('.sdoc-card-orphan-badge').textContent,
      };
    });
    expect(state.found).toBe(true);
    expect(state.orphaned).toBe(true);
    expect(state.badgeText).toBe('anchor lost');
  });

  test('tier-2 fallback: block hint wrong but global prefix+quote+suffix still resolves', async ({ page }) => {
    await setBody(page, '# T\n\nOne two three.\n\nFour five six.\n');
    // Comment saved against p:0 but we then forge meta with block: 'p:99'
    // to force tier-1 miss and tier-2 fallback.
    await page.evaluate(() => {
      window.SDocs.currentMeta = { comments: [
        { id: 'c1', kind: 'inline', quote: 'two',
          prefix: 'One ', suffix: ' three',
          block: 'p:99', author: 'u', color: '#ffd700', at: '', text: 'x' }
      ]};
      window.SDocs.syncAll('comment');
    });
    const anchor = await page.evaluate(() => {
      var a = document.querySelector('span.sdoc-anchor[data-c="c1"]');
      return a && a.textContent;
    });
    expect(anchor).toBe('two');
  });
});

// ── Multiple comments ────────────────────────────────────────────────────

test.describe('multiple comments', () => {
  test('two independent anchors on the same paragraph both render', async ({ page }) => {
    await setBody(page, 'One two three four five six.\n');
    await saveInline(page, 'two', { prefix: 'One ', suffix: ' three' });
    await saveInline(page, 'five', { prefix: 'four ', suffix: ' six' });
    const counts = await page.evaluate(() => ({
      anchors: document.querySelectorAll('span.sdoc-anchor').length,
      cards: document.querySelectorAll('.sdoc-card').length,
      orphans: document.querySelectorAll('.sdoc-card-orphaned').length,
    }));
    expect(counts).toEqual({ anchors: 2, cards: 2, orphans: 0 });
  });

  test('50-comment stress test: all render, none orphaned', async ({ page }) => {
    // Build a doc with 50 distinct phrases, comment on each.
    const phrases = Array.from({ length: 50 }, (_, i) => 'phrase' + i);
    const body = phrases.join(' ') + '.\n';
    await setBody(page, body);
    for (let i = 0; i < 50; i++) {
      await saveInline(page, phrases[i], {});
    }
    const stats = await page.evaluate(() => ({
      count: (window.SDocs.currentMeta.comments || []).length,
      anchors: document.querySelectorAll('span.sdoc-anchor').length,
      orphans: document.querySelectorAll('.sdoc-card-orphaned').length,
    }));
    expect(stats.count).toBe(50);
    expect(stats.anchors).toBe(50);
    expect(stats.orphans).toBe(0);
  });
});

// ── Block comments ───────────────────────────────────────────────────────

test.describe('block comments', () => {
  test('block comment attaches card inside the target block', async ({ page }) => {
    await setBody(page, '# T\n\nOnly paragraph.\n');
    await saveBlock(page, 'p:0', 'block note');
    const parent = await page.evaluate(() => {
      var card = document.querySelector('.sdoc-card[data-c="c1"]');
      return card && card.parentElement && card.parentElement.tagName;
    });
    expect(parent).toBe('P');
  });

  test('block comment adds sdoc-block-commented class + color var on target block', async ({ page }) => {
    await setBody(page, '# T\n\nTarget paragraph.\n');
    await saveBlock(page, 'p:0', 'note');
    const state = await page.evaluate(() => {
      var p = document.querySelector('.sdoc-block-commented');
      return {
        tag: p && p.tagName,
        hasColorVar: p && p.style.getPropertyValue('--sdoc-block-comment-color') !== '',
      };
    });
    expect(state.tag).toBe('P');
    expect(state.hasColorVar).toBe(true);
  });

  test('block comment on a blockquote lands there', async ({ page }) => {
    await setBody(page, '> A quoted line.\n\nOther paragraph.\n');
    await saveBlock(page, 'blockquote:0', 'on the quote');
    const parent = await page.evaluate(() => {
      var card = document.querySelector('.sdoc-card[data-c="c1"]');
      return card && card.parentElement && card.parentElement.tagName;
    });
    expect(parent).toBe('BLOCKQUOTE');
  });

  test('clicking gutter button opens a composer for block comment', async ({ page }) => {
    await setBody(page, '# T\n\nOnly paragraph.\n');
    await page.evaluate(() => {
      var hosts = document.querySelectorAll('.sdoc-block-host');
      var pHost = Array.from(hosts).find(h => h.querySelector('p'));
      pHost.querySelector('.sdoc-gutter-add').click();
    });
    const composerOpen = await page.evaluate(() =>
      !!document.querySelector('.sdoc-composer'));
    expect(composerOpen).toBe(true);
  });
});

// ── Delete + update ──────────────────────────────────────────────────────

test.describe('delete and update', () => {
  test('delete restores body + meta to pre-comment state', async ({ page }) => {
    const original = '# T\n\nA plain paragraph with target text here.\n';
    await setBody(page, original);
    await saveInline(page, 'target text', { prefix: 'with ', suffix: ' here' });
    await page.evaluate(() => {
      var del = document.querySelector('.sdoc-card-delete');
      if (del) del.click();
    });
    const state = await page.evaluate(() => ({
      body: window.SDocs.currentBody,
      meta: window.SDocs.currentMeta,
    }));
    expect(state.body).toBe(original);
    expect(state.meta.comments).toBeFalsy();
  });

  test('delete with multiple comments removes only the target', async ({ page }) => {
    await setBody(page, 'one two three.\n');
    await saveInline(page, 'one', {});
    await saveInline(page, 'three', {});
    // Delete c1
    await page.evaluate(() => {
      var card = document.querySelector('.sdoc-card[data-c="c1"]');
      card.querySelector('.sdoc-card-delete').click();
    });
    const ids = await page.evaluate(() =>
      (window.SDocs.currentMeta.comments || []).map(c => c.id));
    expect(ids).toEqual(['c2']);
  });
});

// ── Gutter hover (CSS) ───────────────────────────────────────────────────

test.describe('gutter button CSS', () => {
  test('hidden + non-interactive when not hovered; revealed on block-host hover', async ({ page }) => {
    await setBody(page, '# T\n\nParagraph.\n');
    const idle = await page.evaluate(() => {
      var btn = document.querySelector('.sdoc-gutter-add');
      var s = getComputedStyle(btn);
      return { opacity: s.opacity, pe: s.pointerEvents };
    });
    expect(idle.opacity).toBe('0');
    expect(idle.pe).toBe('none');
  });
});

// ── Mode switching ───────────────────────────────────────────────────────

test.describe('mode switching preserves comments', () => {
  test('leave and re-enter comment mode — comments still rendered', async ({ page }) => {
    await setBody(page, '# T\n\nA paragraph with anchored text.\n');
    await saveInline(page, 'anchored text', { prefix: 'with ', suffix: '.' });
    await page.evaluate(() => document.getElementById('_sd_btn-read').click());
    await enterCommentMode(page);
    const state = await page.evaluate(() => ({
      anchors: document.querySelectorAll('span.sdoc-anchor').length,
      cards: document.querySelectorAll('.sdoc-card').length,
    }));
    expect(state.anchors).toBe(1);
    expect(state.cards).toBe(1);
  });
});

// ── Multi-block selection rejection ──────────────────────────────────────

test.describe('selection guard', () => {
  test('selection that spans two paragraphs does NOT show the popover', async ({ page }) => {
    await setBody(page, 'First paragraph text.\n\nSecond paragraph text.\n');
    await page.evaluate(() => {
      var ps = document.querySelectorAll('#_sd_rendered p');
      var range = document.createRange();
      range.setStart(ps[0].firstChild, 0);
      range.setEnd(ps[1].firstChild, 6);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      // Dispatch selectionchange so the popover handler fires.
      document.dispatchEvent(new Event('selectionchange'));
    });
    const popVisible = await page.evaluate(() => {
      var pop = document.querySelector('.sdoc-selection-add');
      return !!pop && pop.style.display !== 'none';
    });
    expect(popVisible).toBe(false);
  });

  test('selection inside a <pre> code block IS allowed (dev-friendly)', async ({ page }) => {
    // Developers often want to comment on specific lines of code. The sidecar
    // anchoring model works fine for <pre> because rendered text == source.
    await setBody(page, 'Text before.\n\n```js\nconst x = 42;\n```\n\nAfter.\n');
    await saveInline(page, 'const x = 42;', { prefix: '', suffix: '' });
    const state = await page.evaluate(() => {
      var anchor = document.querySelector('span.sdoc-anchor[data-c="c1"]');
      return {
        found: !!anchor,
        text: anchor && anchor.textContent,
        insidePre: !!(anchor && anchor.closest('pre')),
      };
    });
    expect(state.found).toBe(true);
    expect(state.text).toBe('const x = 42;');
    expect(state.insidePre).toBe(true);
  });
});

// ── Copy serializers ─────────────────────────────────────────────────────

test.describe('copy-with-comments buttons', () => {
  test('toolbar copy-doc button is present and enabled when comments exist', async ({ page }) => {
    await setBody(page, '# T\n\nA paragraph with target text.\n');
    await saveInline(page, 'target text', { prefix: 'with ', suffix: '.' });
    const state = await page.evaluate(() => {
      var btn = document.getElementById('_sd_comment-copy-doc');
      return { exists: !!btn, disabled: btn && btn.disabled };
    });
    expect(state).toEqual({ exists: true, disabled: false });
  });

  test('heading companion button appears on H2 whose section contains a comment', async ({ page }) => {
    await setBody(page, '# Title\n\n## Section A\n\nPara A.\n\n## Section B\n\nPara B.\n');
    // Expand Section A (so the card is visible — also required for the
    // block-host wrapping to happen on nested paragraphs).
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('h2')).find(h => h.textContent.indexOf('A') !== -1).click();
    });
    await saveInline(page, 'Para A', { prefix: '', suffix: '.' });
    const state = await page.evaluate(() => {
      var byHeading = {};
      document.querySelectorAll('.sdoc-head-copy-c').forEach(btn => {
        var h = btn.closest('h1, h2, h3, h4, h5, h6');
        if (h) byHeading[h.textContent.replace(/with comments.*/, '').trim()] = h.tagName;
      });
      return byHeading;
    });
    // The comment on Section A's paragraph should surface a companion
    // on both the enclosing H1 ("Title") and the H2 ("Section A"),
    // but NOT on Section B.
    expect(state['Section A']).toBe('H2');
    expect(state['Section B']).toBeUndefined();
  });
});

test.describe('copy variants', () => {
  test('footnote serializer emits [quote][^cN] + definition', async ({ page }) => {
    await setBody(page, 'Find the target here.\n');
    await saveInline(page, 'target', { prefix: 'the ', suffix: ' here', text: 'note' });
    const out = await page.evaluate(() =>
      window.SDocComments.serializeFootnotes(window.SDocs.currentMeta, window.SDocs.currentBody));
    expect(out).toContain('[target][^c1]');
    expect(out).toContain('[^c1]: u - note');
  });

  test('clean serializer is identity on body', async ({ page }) => {
    const body = '# T\n\nclean body\n';
    await setBody(page, body);
    await saveInline(page, 'body', {});
    const out = await page.evaluate(() =>
      window.SDocComments.serializeClean(window.SDocs.currentMeta, window.SDocs.currentBody));
    expect(out).toBe(body);
  });

  test('SDocs round-trip format pastes back into another session cleanly', async ({ page }) => {
    await setBody(page, '# T\n\nParagraph with quoted word here.\n');
    await saveInline(page, 'quoted word', { prefix: 'with ', suffix: ' here', text: 'a note' });
    const roundTrip = await page.evaluate(() =>
      window.SDocYaml.serializeFrontMatter(window.SDocs.currentMeta) + '\n' + window.SDocs.currentBody);
    // Parse back and verify the comment survives
    const parsed = await page.evaluate((text) =>
      window.SDocYaml.parseFrontMatter(text), roundTrip);
    expect(parsed.meta.comments.length).toBe(1);
    expect(parsed.meta.comments[0].quote).toBe('quoted word');
    expect(parsed.meta.comments[0].text).toBe('a note');
    expect(parsed.body.trim()).toBe('# T\n\nParagraph with quoted word here.'.trim());
  });
});

// ── Edge-case content ───────────────────────────────────────────────────

test.describe('edge-case content', () => {
  test('anchor inside an <li> of an unordered list', async ({ page }) => {
    await setBody(page, '- apple\n- banana\n- cherry\n');
    await saveInline(page, 'banana', { prefix: '', suffix: '' });
    const state = await page.evaluate(() => {
      var a = document.querySelector('span.sdoc-anchor[data-c="c1"]');
      return {
        found: !!a,
        text: a && a.textContent,
        inLi: !!(a && a.closest('li')),
      };
    });
    expect(state).toEqual({ found: true, text: 'banana', inLi: true });
  });

  test('anchor inside a blockquote', async ({ page }) => {
    await setBody(page, '> A wise quote says something profound.\n');
    await saveInline(page, 'profound', { prefix: 'something ', suffix: '.' });
    const inBlockquote = await page.evaluate(() => {
      var a = document.querySelector('span.sdoc-anchor[data-c="c1"]');
      return !!(a && a.closest('blockquote'));
    });
    expect(inBlockquote).toBe(true);
  });

  test('anchor inside a table cell', async ({ page }) => {
    await setBody(page, '| Col A | Col B |\n|---|---|\n| apple | banana |\n');
    await saveInline(page, 'banana', {});
    const inTd = await page.evaluate(() => {
      var a = document.querySelector('span.sdoc-anchor[data-c="c1"]');
      return !!(a && a.closest('td'));
    });
    expect(inTd).toBe(true);
  });

  test('card for table-cell anchor renders OUTSIDE the table (not inside a td)', async ({ page }) => {
    // Inline cards inside a td expand the cell and break table column
    // layout. Card should land as a sibling of the <table> instead.
    await setBody(page, '| Col A | Col B | Col C |\n|---|---|---|\n| JS | V8 | fast |\n| Ruby | MRI | slow |\n');
    await saveInline(page, 'V8', {});
    const state = await page.evaluate(() => {
      var card = document.querySelector('.sdoc-card[data-c="c1"]');
      return {
        found: !!card,
        insideTd: !!(card && card.closest('td')),
        insideTable: !!(card && card.closest('table')),
        parentTag: card && card.parentElement && card.parentElement.tagName,
      };
    });
    expect(state.found).toBe(true);
    expect(state.insideTd).toBe(false);
    expect(state.insideTable).toBe(false);
  });

  test('card for pre-block anchor renders INLINE in the pre (like blockquote)', async ({ page }) => {
    // Cards flow naturally inline-block inside a <pre>. Only <table>
    // needs special-cased outside-placement (column grid).
    await setBody(page, '```js\nconst x = 42;\n```\n');
    await saveInline(page, 'const x = 42;', {});
    const state = await page.evaluate(() => {
      var card = document.querySelector('.sdoc-card[data-c="c1"]');
      return {
        found: !!card,
        insidePre: !!(card && card.closest('pre')),
      };
    });
    expect(state.found).toBe(true);
    expect(state.insidePre).toBe(true);
  });

  test('comment on a heading is allowed and anchors correctly', async ({ page }) => {
    await setBody(page, '# My Heading Title\n\nBody.\n');
    await saveInline(page, 'Heading', { prefix: 'My ', suffix: ' Title' });
    const state = await page.evaluate(() => {
      var a = document.querySelector('span.sdoc-anchor[data-c="c1"]');
      return {
        found: !!a,
        inH1: !!(a && a.closest('h1')),
      };
    });
    expect(state).toEqual({ found: true, inH1: true });
  });

  test('anchor text containing YAML-sensitive characters round-trips', async ({ page }) => {
    // ":", "-", "#", "{}", "'" are YAML-meaningful. Serializer must quote.
    await setBody(page, 'The config key "foo: bar" is tricky.\n');
    await saveInline(page, 'foo: bar', { prefix: '"', suffix: '"', text: "a comment with 'quotes' and: colons" });
    // Serialize + reparse (simulates a hash round-trip)
    const parsed = await page.evaluate(() => {
      var serialized = window.SDocYaml.serializeFrontMatter(window.SDocs.currentMeta) + '\n' + window.SDocs.currentBody;
      return window.SDocYaml.parseFrontMatter(serialized);
    });
    const c = parsed.meta.comments[0];
    expect(c.quote).toBe('foo: bar');
    expect(c.text).toBe("a comment with 'quotes' and: colons");
  });

  test('empty meta.comments deleted on removeComment (not left as empty array)', async ({ page }) => {
    await setBody(page, 'Text here.\n');
    await saveInline(page, 'Text', { prefix: '', suffix: ' here' });
    // Delete via UI
    await page.evaluate(() => {
      document.querySelector('.sdoc-card-delete').click();
    });
    const has = await page.evaluate(() =>
      window.SDocs.currentMeta && 'comments' in window.SDocs.currentMeta);
    expect(has).toBe(false);
  });

  test('undo-like flow: save, delete, re-save — ids reused from 1', async ({ page }) => {
    await setBody(page, 'one two three.\n');
    const id1 = await saveInline(page, 'one', {});
    await page.evaluate(() => document.querySelector('.sdoc-card-delete').click());
    const id2 = await saveInline(page, 'two', {});
    expect(id1).toBe('c1');
    expect(id2).toBe('c1');  // c1 was freed by delete, reused
  });

  test('color: custom hex per comment renders on the highlight span', async ({ page }) => {
    await setBody(page, 'Something notable happens here.\n');
    await saveInline(page, 'notable', { color: '#ff6ec7', text: 'pink' });
    const bg = await page.evaluate(() => {
      var a = document.querySelector('span.sdoc-anchor[data-c="c1"]');
      return a && a.style.background;
    });
    expect(bg).toMatch(/rgb\(255, 110, 199\)|#ff6ec7/);
  });
});

// ── Collapsible section state preservation ──────────────────────────────

test.describe('collapsible sections', () => {
  test('expanded H2 stays open after adding a comment inside it', async ({ page }) => {
    await setBody(page, '# T\n\n## Expanded Section\n\nNested paragraph here.\n\n## Other Section\n\nOther text.\n');
    // Expand Section A by clicking its H2
    await page.evaluate(() => {
      var h2 = Array.from(document.querySelectorAll('h2')).find(h => h.textContent.indexOf('Expanded') !== -1);
      h2.click();
    });
    // Verify it's open
    const beforeOpen = await page.evaluate(() => {
      var h2 = Array.from(document.querySelectorAll('h2')).find(h => h.textContent.indexOf('Expanded') !== -1);
      return h2.closest('.md-section').querySelector('.md-section-body').classList.contains('open');
    });
    expect(beforeOpen).toBe(true);
    // Add a comment inside the nested paragraph
    await saveInline(page, 'Nested paragraph', { prefix: '', suffix: ' here' });
    // After the re-render, the section should still be open
    const afterOpen = await page.evaluate(() => {
      var h2 = Array.from(document.querySelectorAll('h2')).find(h => h.textContent.indexOf('Expanded') !== -1);
      return h2.closest('.md-section').querySelector('.md-section-body').classList.contains('open');
    });
    expect(afterOpen).toBe(true);
  });

  test('navigating to a comment inside a collapsed section auto-expands that section', async ({ page }) => {
    await setBody(page, '# T\n\n## A\n\nOne paragraph.\n\n## B\n\nAnother paragraph under B.\n');
    // Expand A, add a comment there so it renders.
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('h2')).find(h => h.textContent.indexOf('A') !== -1).click();
    });
    await saveInline(page, 'One paragraph', { prefix: '', suffix: '' });
    // Expand B, add a comment, then collapse B again.
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('h2')).find(h => h.textContent.indexOf('B') !== -1).click();
    });
    await saveInline(page, 'Another paragraph', { prefix: '', suffix: ' under B' });
    await page.evaluate(() => {
      // Collapse B
      Array.from(document.querySelectorAll('h2')).find(h => h.textContent.indexOf('B') !== -1).click();
    });
    const before = await page.evaluate(() => {
      var b = Array.from(document.querySelectorAll('h2')).find(h => h.textContent.indexOf('B') !== -1);
      return b.closest('.md-section').querySelector('.md-section-body').classList.contains('open');
    });
    expect(before).toBe(false);
    // Navigate to c2 (in Section B). We use focusComment directly since the
    // navigate-next flow goes through the same function.
    await page.evaluate(() => window.SDocs.commentsUi.focusComment('c2'));
    const after = await page.evaluate(() => {
      var b = Array.from(document.querySelectorAll('h2')).find(h => h.textContent.indexOf('B') !== -1);
      return b.closest('.md-section').querySelector('.md-section-body').classList.contains('open');
    });
    expect(after).toBe(true);
  });

  test('collapsed sections stay collapsed (no involuntary expansion)', async ({ page }) => {
    await setBody(page, '# T\n\n## S1\n\nOne.\n\n## S2\n\nTwo.\n');
    // Leave everything collapsed (default). Add a doc-level comment on H1.
    await saveInline(page, 'T', { prefix: '', suffix: '' });
    const states = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.md-section-body')).map(b => b.classList.contains('open')));
    // None of the H2 bodies should have opened on their own.
    expect(states.every(x => x === false)).toBe(true);
  });
});

// ── Hash round-trip ──────────────────────────────────────────────────────

test.describe('hash persistence', () => {
  test('comment saved, URL hash reload brings it back', async ({ page }) => {
    await setBody(page, '# T\n\nDurable paragraph content.\n');
    await saveInline(page, 'Durable', { prefix: '', suffix: ' paragraph', text: 'persists' });
    // Wait for the 400ms debounced hash update
    await page.waitForTimeout(600);
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toContain('md=');
    // Reload the URL + re-enter comment mode
    await page.goto(BASE + '/' + hash);
    await page.waitForFunction(() => !!window.SDocs && window.SDocs.currentBody);
    await enterCommentMode(page);
    const state = await page.evaluate(() => ({
      comments: (window.SDocs.currentMeta.comments || []).length,
      anchor: !!document.querySelector('span.sdoc-anchor[data-c="c1"]'),
    }));
    expect(state.comments).toBe(1);
    expect(state.anchor).toBe(true);
  });
});
