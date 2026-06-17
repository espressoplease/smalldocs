/**
 * sdocs-comments slide-anchored tests.
 *
 * Slide comments attach to a ```slide block (optionally a single shape
 * within it). They store no body anchor - their location rides in the
 * footnote label - so the interesting surfaces are normalizeComment,
 * addSlideComment, serializeFootnotes, and the parseFootnotes round-trip.
 */
const path = require('path');
const SDC = require(path.join(__dirname, '..', 'public', 'sdocs-comments.js'));
const SDShapes = require(path.join(__dirname, '..', 'public', 'sdocs-shapes.js'));
const SDSC = require(path.join(__dirname, '..', 'public', 'sdocs-slide-comments.js'));

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Slide Comments Tests ───────────────────────\n');

  // ── Pure hit-rect geometry ──────────────────────────────────────────────
  const close = (a, b) => Math.abs(a - b) < 1e-6;

  test('computeHitRects: rect maps grid units to percent of the wrap', () => {
    const rects = SDSC.computeHitRects('grid 100 50\nr 10 10 30 20 | Hello', SDShapes);
    const rect = rects.find((r) => r.shapeIdx === 0);
    assert.ok(rect, 'rect overlay present');
    assert.ok(close(rect.leftPct, 10), 'leftPct ' + rect.leftPct);
    assert.ok(close(rect.topPct, 20), 'topPct ' + rect.topPct);
    assert.ok(close(rect.wPct, 30), 'wPct ' + rect.wPct);
    assert.ok(close(rect.hPct, 40), 'hPct ' + rect.hPct);
    assert.strictEqual(rect.text, 'Hello');
  });

  test('computeHitRects: circle bbox derives left/top from cx-r, cy-r', () => {
    const rects = SDSC.computeHitRects('grid 100 50\nc 70 25 10', SDShapes);
    const c = rects.find((r) => r.shapeIdx === 0);
    assert.ok(c, 'circle overlay present');
    assert.ok(close(c.leftPct, 60), 'leftPct ' + c.leftPct);
    assert.ok(close(c.topPct, 30), 'topPct ' + c.topPct);
    assert.ok(close(c.wPct, 20), 'wPct ' + c.wPct);
    assert.ok(close(c.hPct, 40), 'hPct ' + c.hPct);
  });

  test('computeHitRects: one overlay per shape, indices line up with source order', () => {
    const rects = SDSC.computeHitRects('grid 100 50\nr 0 0 50 50 | A\nr 50 0 50 50 | B', SDShapes);
    assert.strictEqual(rects.length, 2);
    assert.deepStrictEqual(rects.map((r) => r.shapeIdx), [0, 1]);
    assert.deepStrictEqual(rects.map((r) => r.text), ['A', 'B']);
  });

  test('computeHitRects: bad / empty DSL returns no overlays (no throw)', () => {
    assert.deepStrictEqual(SDSC.computeHitRects('', SDShapes), []);
    assert.deepStrictEqual(SDSC.computeHitRects(null, SDShapes), []);
  });

  test('shapeText: strips markdown punctuation to a plain hint', () => {
    assert.strictEqual(SDSC.shapeText({ content: '## **Q4** Review' }), 'Q4 Review');
    assert.strictEqual(SDSC.shapeText({ content: '' }), '');
  });

  test('normalizeComment: infers slide kind from a slide index', () => {
    const c = SDC.normalizeComment({ id: 'c1', slide: 2 });
    assert.strictEqual(c.kind, 'slide');
    assert.strictEqual(c.slide, 2);
    assert.ok(!('shape' in c));
  });

  test('normalizeComment: coerces string slide/shape indices to ints', () => {
    const c = SDC.normalizeComment({ id: 'c1', kind: 'slide', slide: '3', shape: '5' });
    assert.strictEqual(c.slide, 3);
    assert.strictEqual(c.shape, 5);
  });

  test('normalizeComment: missing slide index defaults to 0, not dropped', () => {
    const c = SDC.normalizeComment({ id: 'c1', kind: 'slide' });
    assert.strictEqual(c.kind, 'slide');
    assert.strictEqual(c.slide, 0);
  });

  test('normalizeComment: keeps slide_text hint', () => {
    const c = SDC.normalizeComment({ id: 'c1', kind: 'slide', slide: 0, shape: 1, slide_text: 'Q4 Review' });
    assert.strictEqual(c.slide_text, 'Q4 Review');
  });

  test('addSlideComment: whole-slide note (no shape)', () => {
    const { meta, id } = SDC.addSlideComment(
      {}, { slide: 1, slide_text: 'Cover' },
      { author: 'josh', color: '#ffbb00', at: '2026-06-16T10:00Z', text: 'Drop this slide' }
    );
    assert.strictEqual(id, 'c1');
    const c = SDC.getComments(meta)[0];
    assert.strictEqual(c.kind, 'slide');
    assert.strictEqual(c.slide, 1);
    assert.ok(!('shape' in c));
    assert.strictEqual(c.text, 'Drop this slide');
    assert.strictEqual(c.author, 'josh');
  });

  test('addSlideComment: element note carries shape index', () => {
    const { meta } = SDC.addSlideComment(
      {}, { slide: 0, shape: 3, slide_text: 'Q4 Review' },
      { text: 'punchier' }
    );
    const c = SDC.getComments(meta)[0];
    assert.strictEqual(c.shape, 3);
    assert.strictEqual(c.slide_text, 'Q4 Review');
  });

  test('addSlideComment: shape index 0 is preserved (not treated as absent)', () => {
    const { meta } = SDC.addSlideComment({}, { slide: 0, shape: 0 }, { text: 'hi' });
    const c = SDC.getComments(meta)[0];
    assert.strictEqual(c.shape, 0);
  });

  test('addSlideComment: throws without a slide index', () => {
    assert.throws(() => SDC.addSlideComment({}, {}, { text: 'x' }), /slide index/);
  });

  test('serializeFootnotes: whole-slide note emits a 1-based (slide N) label', () => {
    const meta = { comments: [
      SDC.normalizeComment({ id: 'c1', kind: 'slide', slide: 1, text: 'Drop this' }),
    ] };
    const out = SDC.serializeFootnotes(meta, 'Body text.\n');
    assert.ok(/\[\^c1\]: user - Drop this \(slide 2\)/.test(out), out);
  });

  test('serializeFootnotes: element note carries index + quoted text', () => {
    const meta = { comments: [
      SDC.normalizeComment({ id: 'c1', kind: 'slide', slide: 0, shape: 3, slide_text: 'Q4 Review', text: 'punchier' }),
    ] };
    const out = SDC.serializeFootnotes(meta, 'Body.\n');
    assert.ok(/\[\^c1\]: user - punchier \(slide 1, element 3 "Q4 Review"\)/.test(out), out);
  });

  test('serializeFootnotes: slide note does not inject any inline anchor', () => {
    const meta = { comments: [
      SDC.normalizeComment({ id: 'c1', kind: 'slide', slide: 0, text: 'note' }),
    ] };
    const body = 'Just a paragraph.\n';
    const out = SDC.serializeFootnotes(meta, body);
    // Body content is untouched; only a footnote def is appended.
    assert.ok(out.startsWith('Just a paragraph.'), out);
    assert.ok(out.indexOf('[^c1]') !== -1);
  });

  test('serializeFootnotes: slide note sanitizes newlines in text', () => {
    const meta = { comments: [
      SDC.normalizeComment({ id: 'c1', kind: 'slide', slide: 0, text: 'line1\nline2' }),
    ] };
    const out = SDC.serializeFootnotes(meta, 'b\n');
    assert.ok(out.indexOf('line1 line2') !== -1, out);
    // No forged extra footnote lines.
    assert.strictEqual((out.match(/\[\^c1\]/g) || []).length, 1);
  });

  test('parseFootnotes: recovers a whole-slide note', () => {
    const body = 'Body.\n\n[^c1]: josh - Drop this (slide 2)\n';
    const { comments } = SDC.parseFootnotes(body);
    assert.strictEqual(comments.length, 1);
    const c = comments[0];
    assert.strictEqual(c.kind, 'slide');
    assert.strictEqual(c.slide, 1);
    assert.strictEqual(c.text, 'Drop this');
    assert.strictEqual(c.author, 'josh');
    assert.ok(!('shape' in c));
  });

  test('parseFootnotes: recovers an element note with index + text', () => {
    const body = 'Body.\n\n[^c1]: user - punchier (slide 1, element 3 "Q4 Review")\n';
    const { comments } = SDC.parseFootnotes(body);
    const c = comments[0];
    assert.strictEqual(c.kind, 'slide');
    assert.strictEqual(c.slide, 0);
    assert.strictEqual(c.shape, 3);
    assert.strictEqual(c.slide_text, 'Q4 Review');
    assert.strictEqual(c.text, 'punchier');
  });

  test('round-trip: serialize → parse preserves a slide comment', () => {
    const meta = { comments: [
      SDC.normalizeComment({ id: 'c1', kind: 'slide', slide: 2, shape: 4, slide_text: 'Revenue', author: 'amy', text: 'show MoM' }),
    ] };
    const body = SDC.serializeFootnotes(meta, 'Doc.\n');
    const { comments } = SDC.parseFootnotes(body);
    const c = comments[0];
    assert.strictEqual(c.kind, 'slide');
    assert.strictEqual(c.slide, 2);
    assert.strictEqual(c.shape, 4);
    assert.strictEqual(c.slide_text, 'Revenue');
    assert.strictEqual(c.author, 'amy');
    assert.strictEqual(c.text, 'show MoM');
  });

  test('round-trip: mixed inline + slide comments both survive', () => {
    const meta = { comments: [
      SDC.normalizeComment({ id: 'c1', kind: 'inline', quote: 'hello', text: 'hi' }),
      SDC.normalizeComment({ id: 'c2', kind: 'slide', slide: 0, text: 'redo' }),
    ] };
    const body = SDC.serializeFootnotes(meta, 'say hello there\n');
    const { comments } = SDC.parseFootnotes(body);
    assert.strictEqual(comments.length, 2);
    assert.strictEqual(comments[0].kind, 'inline');
    assert.strictEqual(comments[1].kind, 'slide');
  });
};
