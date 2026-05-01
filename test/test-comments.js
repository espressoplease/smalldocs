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

  test('addBlockComment: stores block_text survival hint when supplied', () => {
    const { meta } = SDC.addBlockComment(
      {},
      { block: 'p:3', block_text: 'Reliability is the through-line for Q2' },
      { author: 'u', text: 'too vague' }
    );
    const c = SDC.getComments(meta)[0];
    assert.strictEqual(c.block_text, 'Reliability is the through-line for Q2');
  });

  test('addBlockComment: omits block_text when not supplied', () => {
    const { meta } = SDC.addBlockComment(
      {},
      { block: 'p:3' },
      { author: 'u', text: 'note' }
    );
    const c = SDC.getComments(meta)[0];
    assert.strictEqual(c.block_text, undefined);
  });

  test('normalizeComment: preserves resolved as boolean', () => {
    const c = SDC.normalizeComment({
      id: 'c1', kind: 'block', block: 'p:0', text: 'x', resolved: true,
    });
    assert.strictEqual(c.resolved, true);
  });

  test('normalizeComment: coerces "true" string from YAML round-trip to boolean', () => {
    const c = SDC.normalizeComment({
      id: 'c1', kind: 'block', block: 'p:0', text: 'x', resolved: 'true',
    });
    assert.strictEqual(c.resolved, true);
  });

  test('normalizeComment: omits resolved when falsy', () => {
    const c = SDC.normalizeComment({
      id: 'c1', kind: 'block', block: 'p:0', text: 'x',
    });
    assert.strictEqual(c.resolved, undefined);
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

  // ── Color sanitization ────────────────────────────────────────────
  // Comment colors are written into CSS custom properties unsanitized
  // by the UI module. Without a gate at normalize time, a crafted
  // shared URL could ship a colour like `url(https://attacker/...)` and
  // every viewer's browser would issue that request on render. We
  // restrict to hex tokens (the only shape the colour <input> emits).

  test('normalizeComment: rejects non-hex color, falls back to default', () => {
    const c = SDC.normalizeComment({ id: 'c1', quote: 'x', color: 'url(https://evil/p.gif)' });
    assert.strictEqual(c.color, '#ffd700');
  });

  test('normalizeComment: rejects color with trailing CSS tokens', () => {
    const c = SDC.normalizeComment({ id: 'c1', quote: 'x', color: '#ff0; background: url(x)' });
    assert.strictEqual(c.color, '#ffd700');
  });

  test('normalizeComment: accepts #rgb / #rgba / #rrggbb / #rrggbbaa', () => {
    assert.strictEqual(SDC.normalizeComment({ id: 'c1', quote: 'x', color: '#fff' }).color, '#fff');
    assert.strictEqual(SDC.normalizeComment({ id: 'c1', quote: 'x', color: '#ffff' }).color, '#ffff');
    assert.strictEqual(SDC.normalizeComment({ id: 'c1', quote: 'x', color: '#22c55e' }).color, '#22c55e');
    assert.strictEqual(SDC.normalizeComment({ id: 'c1', quote: 'x', color: '#22c55eaa' }).color, '#22c55eaa');
  });

  // ── ID format gate ───────────────────────────────────────────────
  // querySelector breaks on crafted `data-c="..."` if `id` contains
  // unescaped quotes or brackets. The writer always produces `cN`
  // (digits), so any other shape comes from a malicious URL. Reject
  // at normalize time so the UI never sees a bad id.

  test('normalizeComment: keeps cN ids', () => {
    assert.strictEqual(SDC.normalizeComment({ id: 'c1', quote: 'x' }).id, 'c1');
    assert.strictEqual(SDC.normalizeComment({ id: 'c42', quote: 'x' }).id, 'c42');
  });

  test('normalizeComment: returns null for malformed ids', () => {
    // Crafted id with selector-breaking chars
    assert.strictEqual(SDC.normalizeComment({ id: 'x"]', quote: 'x' }), null);
    assert.strictEqual(SDC.normalizeComment({ id: '../etc/passwd', quote: 'x' }), null);
    // Missing id (load-time path: caller must filter)
    assert.strictEqual(SDC.normalizeComment({ quote: 'x' }), null);
    // Numeric / non-string
    assert.strictEqual(SDC.normalizeComment({ id: 1, quote: 'x' }), null);
  });

  test('sanitizeColor: exposed helper for the UI prefs path', () => {
    assert.strictEqual(typeof SDC.sanitizeColor, 'function');
    assert.strictEqual(SDC.sanitizeColor('#22c55e'), '#22c55e');
    assert.strictEqual(SDC.sanitizeColor('javascript:alert(1)'), '#ffd700');
    assert.strictEqual(SDC.sanitizeColor(undefined), '#ffd700');
    assert.strictEqual(SDC.sanitizeColor(''), '#ffd700');
    assert.strictEqual(SDC.sanitizeColor(null), '#ffd700');
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

  // ── Clipboard-output sanitization ────────────────────────────────
  // "Copy with comments" output is meant to be pasted into agents,
  // Slack, and other downstream tools. A crafted shared URL whose
  // comment text contains an embedded newline can forge additional
  // footnote definitions; bidi format characters (U+202A-U+202E,
  // U+2066-U+2069) can make the rendered card look one way while the
  // copied bytes carry another. Strip both at serialization time.

  test('serializeFootnotes: strips embedded newlines from text', () => {
    const meta = { comments: [
      { id: 'c1', kind: 'inline', quote: 'q', author: 'a', text: 'safe\n[^c2]: forged - injection' },
    ] };
    const out = SDC.serializeFootnotes(meta, 'q\n');
    // Markdown only treats `[^id]:` as a footnote definition when it sits
    // at the start of a line. The c1 line is the only legit definition;
    // the smuggled `[^c2]:` ended up mid-line so no parser will pick it
    // up. Both checks: exactly one line-leading definition, and the
    // forged label is mid-line (not line-leading).
    assert.strictEqual(out.match(/^\[\^c\d+\]:/gm).length, 1);
    assert.strictEqual(out.match(/^\[\^c2\]:/m), null);
  });

  test('serializeFootnotes: strips bidi format chars from author and text', () => {
    const RLO = '‮', PDF = '‬';
    const meta = { comments: [
      { id: 'c1', kind: 'inline', quote: 'q', author: 'a' + RLO + 'tt', text: 'hi' + PDF + 'there' },
    ] };
    const out = SDC.serializeFootnotes(meta, 'q\n');
    assert.strictEqual(out.indexOf(RLO), -1);
    assert.strictEqual(out.indexOf(PDF), -1);
    assert.ok(out.indexOf('att') !== -1, 'visible chars preserved');
  });

  test('serializeFootnotes: strips C0 control chars except tab', () => {
    const meta = { comments: [
      { id: 'c1', kind: 'inline', quote: 'q', author: 'a\x07b', text: 'hi\x00there' },
    ] };
    const out = SDC.serializeFootnotes(meta, 'q\n');
    assert.strictEqual(out.indexOf('\x07'), -1);
    assert.strictEqual(out.indexOf('\x00'), -1);
    assert.ok(out.indexOf('ab') !== -1);
    assert.ok(out.indexOf('hithere') !== -1);
  });

  test('serializeFootnotes: strips bidi from block_text too', () => {
    const RLO = '‮';
    const meta = { comments: [
      { id: 'c1', kind: 'block', block: 'p:0', block_text: 'hello' + RLO + 'world', author: 'a', text: 'note' },
    ] };
    const out = SDC.serializeFootnotes(meta, 'p\n');
    assert.strictEqual(out.indexOf(RLO), -1);
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

  // ── parseFootnotes ────────────────────────────────────────────────────

  test('parseFootnotes: returns body unchanged when no markers present', () => {
    const r = SDC.parseFootnotes('just a plain body\n\nwith two paragraphs.\n');
    assert.deepStrictEqual(r.comments, []);
    assert.strictEqual(r.body, 'just a plain body\n\nwith two paragraphs.\n');
  });

  test('parseFootnotes: extracts an inline comment and unwraps the quote', () => {
    const body = 'Q1 closed strong: every committed feature [shipped on time][^c1] and within budget.\n\n[^c1]: agent - auth migration slipped 2 weeks';
    const r = SDC.parseFootnotes(body);
    assert.strictEqual(r.comments.length, 1);
    const c = r.comments[0];
    assert.strictEqual(c.id, 'c1');
    assert.strictEqual(c.kind, 'inline');
    assert.strictEqual(c.quote, 'shipped on time');
    assert.strictEqual(c.author, 'agent');
    assert.strictEqual(c.text, 'auth migration slipped 2 weeks');
    assert.ok(r.body.indexOf('[^c1]') === -1, 'marker stripped from body');
    assert.ok(r.body.indexOf('shipped on time') >= 0, 'quote restored in body');
  });

  test('parseFootnotes: extracts a block comment using surrounding paragraph as block_text', () => {
    const body = 'The plan to decommission the legacy queue moves to its terminal phase in week 4.[^c2]\n\n[^c2]: agent - finance pushed back on this number';
    const r = SDC.parseFootnotes(body);
    assert.strictEqual(r.comments.length, 1);
    const c = r.comments[0];
    assert.strictEqual(c.id, 'c2');
    assert.strictEqual(c.kind, 'block');
    assert.ok(c.block_text.startsWith('The plan to decommission the legacy queue'));
    assert.strictEqual(c.text, 'finance pushed back on this number');
  });

  test('parseFootnotes: recovers `(block tag:n)` hint from definition text', () => {
    const body = 'A paragraph here.[^c3]\n\n[^c3]: user - too long (block p:0)';
    const r = SDC.parseFootnotes(body);
    const c = r.comments[0];
    assert.strictEqual(c.block, 'p:0');
    assert.strictEqual(c.text, 'too long');
  });

  test('parseFootnotes: ignores non-cN footnote ids (academic citations stay intact)', () => {
    const body = 'See the seminal paper[^citation1] for context.\n\n[^citation1]: Smith et al., 1998.';
    const r = SDC.parseFootnotes(body);
    assert.deepStrictEqual(r.comments, []);
    assert.ok(r.body.indexOf('[^citation1]') >= 0, 'citation marker preserved');
    assert.ok(r.body.indexOf('Smith et al., 1998') >= 0, 'citation def preserved');
  });

  test('parseFootnotes: definition with [resolved] flag sets resolved=true', () => {
    const body = 'Some block.[^c1]\n\n[^c1]: priya [resolved] - already addressed';
    const r = SDC.parseFootnotes(body);
    const c = r.comments[0];
    assert.strictEqual(c.resolved, true);
    assert.strictEqual(c.text, 'already addressed');
  });

  test('parseFootnotes: round-trips with serializeFootnotes (no information lost)', () => {
    const meta = {
      comments: [
        { id: 'c1', kind: 'inline', quote: 'on time', text: 'slipped 2 weeks', author: 'agent' },
        { id: 'c2', kind: 'block', block: 'p:1', text: 'too long', author: 'priya' },
      ],
    };
    const body = 'It shipped on time. Mostly.\n\nA second paragraph.\n';
    const serialized = SDC.serializeFootnotes(meta, body);
    const parsed = SDC.parseFootnotes(serialized);
    assert.strictEqual(parsed.comments.length, 2);
    const inline = parsed.comments.find(c => c.id === 'c1');
    const block = parsed.comments.find(c => c.id === 'c2');
    assert.strictEqual(inline.quote, 'on time');
    assert.strictEqual(inline.text, 'slipped 2 weeks');
    assert.strictEqual(block.kind, 'block');
    assert.strictEqual(block.block, 'p:1');
    assert.strictEqual(block.text, 'too long');
  });
};
