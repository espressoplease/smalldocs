/**
 * sdocs-comments tests — sidecar model.
 *
 * Comments live in front-matter meta.comments. These tests exercise the
 * data-model mutations; anchor resolution (DOM-level text search) is
 * covered by the Playwright suite in test/comment-mode.spec.js.
 */
const path = require('path');
const SDC = require(path.join(__dirname, '..', 'public', 'sdocs-comments.js'));

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Comments Tests ─────────────────────────────\n');

  test('getComments: no meta → empty list', () => {
    assert.deepStrictEqual(SDC.getComments(null), []);
    assert.deepStrictEqual(SDC.getComments({}), []);
    assert.deepStrictEqual(SDC.getComments({ comments: null }), []);
  });

  test('getComments: returns a copy (mutating the result does not affect meta)', () => {
    const meta = { comments: [{ id: 'c1', text: 'x' }] };
    const list = SDC.getComments(meta);
    list.push({ id: 'c99' });
    assert.strictEqual(meta.comments.length, 1);
  });

  test('nextId: empty → c1', () => {
    assert.strictEqual(SDC.nextId({}), 'c1');
    assert.strictEqual(SDC.nextId(null), 'c1');
  });

  test('nextId: picks max+1, handles gaps', () => {
    const meta = { comments: [{ id: 'c3' }, { id: 'c1' }, { id: 'c7' }] };
    assert.strictEqual(SDC.nextId(meta), 'c8');
  });

  test('nextId: ignores non-cN ids', () => {
    const meta = { comments: [{ id: 'weird' }, { id: 'c2' }] };
    assert.strictEqual(SDC.nextId(meta), 'c3');
  });

  test('addSelectionComment: stores anchor + note fields', () => {
    const meta = { styles: { fontFamily: 'Lora' } };
    const { meta: out, id } = SDC.addSelectionComment(
      meta,
      { quote: 'hello world', prefix: 'say ', suffix: ' today', block: 'p:0' },
      { author: 'josh', color: '#ffd700', at: '2026-04-24T15:00Z', text: 'nice' }
    );
    assert.strictEqual(id, 'c1');
    const list = SDC.getComments(out);
    assert.strictEqual(list.length, 1);
    const c = list[0];
    assert.strictEqual(c.kind, 'inline');
    assert.strictEqual(c.quote, 'hello world');
    assert.strictEqual(c.prefix, 'say ');
    assert.strictEqual(c.suffix, ' today');
    assert.strictEqual(c.block, 'p:0');
    assert.strictEqual(c.author, 'josh');
    assert.strictEqual(c.text, 'nice');
    // Original meta is untouched (pure function)
    assert.deepStrictEqual(meta, { styles: { fontFamily: 'Lora' } });
  });

  test('addSelectionComment: preserves other meta keys (styles)', () => {
    const meta = { styles: { fontFamily: 'Lora' } };
    const { meta: out } = SDC.addSelectionComment(
      meta,
      { quote: 'x' },
      { text: 'y' }
    );
    assert.deepStrictEqual(out.styles, { fontFamily: 'Lora' });
    assert.ok(Array.isArray(out.comments));
  });

  test('addSelectionComment: throws on empty quote', () => {
    assert.throws(
      () => SDC.addSelectionComment({}, { quote: '' }, {}),
      /non-empty quote/
    );
  });

  test('addSelectionComment: consecutive adds get c1, c2, c3', () => {
    let meta = {};
    ({ meta } = SDC.addSelectionComment(meta, { quote: 'a' }, { text: 'A' }));
    ({ meta } = SDC.addSelectionComment(meta, { quote: 'b' }, { text: 'B' }));
    ({ meta } = SDC.addSelectionComment(meta, { quote: 'c' }, { text: 'C' }));
    const ids = SDC.getComments(meta).map(c => c.id);
    assert.deepStrictEqual(ids, ['c1', 'c2', 'c3']);
  });

  test('addBlockComment: stores block target + note fields', () => {
    const { meta, id } = SDC.addBlockComment(
      {},
      { block: 'blockquote:0' },
      { author: 'u', text: 'thoughts' }
    );
    assert.strictEqual(id, 'c1');
    const c = SDC.getComments(meta)[0];
    assert.strictEqual(c.kind, 'block');
    assert.strictEqual(c.block, 'blockquote:0');
    assert.strictEqual(c.text, 'thoughts');
    assert.strictEqual(c.quote, undefined);
  });

  test('addBlockComment: throws on missing block id', () => {
    assert.throws(
      () => SDC.addBlockComment({}, {}, { text: 'x' }),
      /requires a block id/
    );
  });

  test('removeComment: deletes by id, leaves others', () => {
    let meta = {};
    ({ meta } = SDC.addSelectionComment(meta, { quote: 'a' }, { text: 'A' }));
    ({ meta } = SDC.addSelectionComment(meta, { quote: 'b' }, { text: 'B' }));
    meta = SDC.removeComment(meta, 'c1');
    const list = SDC.getComments(meta);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, 'c2');
  });

  test('removeComment: unknown id is a no-op', () => {
    const meta = { comments: [{ id: 'c1', text: 'x' }] };
    const out = SDC.removeComment(meta, 'c99');
    assert.deepStrictEqual(SDC.getComments(out), SDC.getComments(meta));
  });

  test('removeComment: last comment → meta.comments key deleted', () => {
    let meta = {};
    ({ meta } = SDC.addSelectionComment(meta, { quote: 'a' }, { text: 'A' }));
    meta = SDC.removeComment(meta, 'c1');
    assert.strictEqual(meta.comments, undefined);
  });

  test('updateComment: patches the text field only', () => {
    let meta = {};
    ({ meta } = SDC.addSelectionComment(meta, { quote: 'a', prefix: 'PF' }, { text: 'old' }));
    meta = SDC.updateComment(meta, 'c1', { text: 'new' });
    const c = SDC.getComments(meta)[0];
    assert.strictEqual(c.text, 'new');
    assert.strictEqual(c.quote, 'a');
    assert.strictEqual(c.prefix, 'PF');
  });

  test('updateComment: unknown id is a no-op', () => {
    const meta = { comments: [{ id: 'c1', text: 'x' }] };
    const out = SDC.updateComment(meta, 'c99', { text: 'y' });
    assert.strictEqual(out, meta);
  });

  test('normalizeComment: assigns defaults', () => {
    const c = SDC.normalizeComment({ id: 'c1', quote: 'x' });
    assert.strictEqual(c.kind, 'inline');
    assert.strictEqual(c.author, 'user');
    assert.strictEqual(c.color, '#ffd700');
    assert.ok(c.at); // timestamp filled in
    assert.strictEqual(c.text, '');
  });

  test('normalizeComment: block kind inferred when no quote', () => {
    const c = SDC.normalizeComment({ id: 'c1', block: 'p:0' });
    assert.strictEqual(c.kind, 'block');
    assert.strictEqual(c.quote, undefined);
  });

  test('round-trip via YAML: meta.comments serializes and parses back', () => {
    const YAML = require(path.join(__dirname, '..', 'public', 'sdocs-yaml.js'));
    let meta = {};
    ({ meta } = SDC.addSelectionComment(
      meta,
      { quote: 'a "quoted" phrase', prefix: 'say ', suffix: ' today', block: 'p:3' },
      { author: 'j', color: '#ff0', at: '2026-04-24T15:00:00Z', text: 'a note: with colon' }
    ));
    ({ meta } = SDC.addBlockComment(
      meta,
      { block: 'blockquote:0' },
      { author: 'j', text: 'plain' }
    ));
    const serialized = YAML.serializeFrontMatter(meta) + '\n\nbody\n';
    const parsed = YAML.parseFrontMatter(serialized);
    const list = SDC.getComments(parsed.meta);
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].quote, 'a "quoted" phrase');
    assert.strictEqual(list[0].text, 'a note: with colon');
    assert.strictEqual(list[0].block, 'p:3');
    assert.strictEqual(list[1].block, 'blockquote:0');
  });

  test('serializeFootnotes: replaces quote with [quote][^cN] and appends footnote', () => {
    const meta = { comments: [
      { id: 'c1', kind: 'inline', quote: 'target', prefix: 'the ', suffix: ' here', author: 'j', text: 'note' },
    ] };
    const body = 'Find the target here.\n';
    const out = SDC.serializeFootnotes(meta, body);
    assert.ok(out.indexOf('[target][^c1]') !== -1, 'inline ref inserted');
    assert.ok(out.indexOf('[^c1]: j - note') !== -1, 'footnote definition appended');
  });

  test('serializeFootnotes: falls back to quote-only when prefix/suffix does not match', () => {
    const meta = { comments: [
      { id: 'c1', kind: 'inline', quote: 'codehere', prefix: 'nonexistent ', suffix: ' text', author: 'j', text: 'x' },
    ] };
    const body = 'Before codehere after.\n';
    const out = SDC.serializeFootnotes(meta, body);
    assert.ok(out.indexOf('[codehere][^c1]') !== -1);
  });

  test('serializeFootnotes: multiple comments all land', () => {
    const meta = { comments: [
      { id: 'c1', kind: 'inline', quote: 'one', author: 'a', text: 'first' },
      { id: 'c2', kind: 'inline', quote: 'three', author: 'a', text: 'third' },
    ] };
    const body = 'one two three four.\n';
    const out = SDC.serializeFootnotes(meta, body);
    assert.ok(out.indexOf('[one][^c1]') !== -1);
    assert.ok(out.indexOf('[three][^c2]') !== -1);
    assert.ok(out.indexOf('[^c1]: a - first') !== -1);
    assert.ok(out.indexOf('[^c2]: a - third') !== -1);
  });

  test('serializeFootnotes: block comment becomes end-of-doc footnote with (block X)', () => {
    const meta = { comments: [
      { id: 'c1', kind: 'block', block: 'blockquote:0', author: 'j', text: 'on the quote' },
    ] };
    const body = '> some quote\n';
    const out = SDC.serializeFootnotes(meta, body);
    assert.ok(out.indexOf('[^c1]: j - on the quote (block blockquote:0)') !== -1);
  });

  test('serializeFootnotes: body with no comments returned unchanged', () => {
    const out = SDC.serializeFootnotes({}, 'plain body\n');
    assert.strictEqual(out, 'plain body\n');
  });

  test('serializeClean: identity on body, comments ignored', () => {
    const meta = { comments: [{ id: 'c1', kind: 'inline', quote: 'x', text: 'y' }] };
    const body = 'clean body text\n';
    assert.strictEqual(SDC.serializeClean(meta, body), body);
  });

  test('round-trip via YAML: unicode + emoji + newline in text', () => {
    const YAML = require(path.join(__dirname, '..', 'public', 'sdocs-yaml.js'));
    let meta = {};
    ({ meta } = SDC.addSelectionComment(
      meta,
      { quote: 'x' },
      { text: 'emoji 🎉\nwith newline — and em-dash' }
    ));
    const serialized = YAML.serializeFrontMatter(meta) + '\n\nbody\n';
    const parsed = YAML.parseFrontMatter(serialized);
    const c = SDC.getComments(parsed.meta)[0];
    assert.strictEqual(c.text, 'emoji 🎉\nwith newline — and em-dash');
  });
};
