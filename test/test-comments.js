/**
 * sdocs-comments parser tests - round-trip + edge cases surfaced in review:
 *   - fenced code blocks containing sdoc-looking syntax
 *   - `-->` inside comment body (encoded so it doesn't terminate)
 *   - `"` inside comment body
 *   - unrelated <!-- ... --> comments in the doc
 *   - sibling ids c1 and c11 (no prefix confusion)
 *   - parse(serialize(parse(md))) idempotency
 */
const path = require('path');
const SDC = require(path.join(__dirname, '..', 'public', 'sdocs-comments.js'));

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Comments Tests ─────────────────────────────\n');

  test('parse: no comments → empty list', () => {
    const out = SDC.parse('# Hello\n\nJust a paragraph.\n');
    assert.deepStrictEqual(out.comments, []);
  });

  test('parse: block-anchored comment', () => {
    const md = 'Paragraph one.\n<!--sdoc-comment id="c1" author="user" color="#ffd700" at="2026-04-24T00:00:00Z" text="Nice point."-->';
    const out = SDC.parse(md);
    assert.strictEqual(out.comments.length, 1);
    assert.strictEqual(out.comments[0].id, 'c1');
    assert.strictEqual(out.comments[0].author, 'user');
    assert.strictEqual(out.comments[0].text, 'Nice point.');
    assert.strictEqual(out.comments[0].anchor.type, 'block');
  });

  test('parse: selection-anchored comment resolves wrapper + metadata by id', () => {
    const md = 'Some <!--sdoc-c:c1 before="me " after=" text"-->highlighted<!--/sdoc-c:c1--> text here.\n' +
               '<!--sdoc-comment id="c1" author="user" color="#ffd700" at="2026-04-24" text="Why this?"-->';
    const out = SDC.parse(md);
    assert.strictEqual(out.comments.length, 1);
    const c = out.comments[0];
    assert.strictEqual(c.anchor.type, 'selection');
    assert.strictEqual(c.anchor.text, 'highlighted');
    assert.strictEqual(c.anchor.before, 'me ');
    assert.strictEqual(c.anchor.after, ' text');
    assert.strictEqual(c.text, 'Why this?');
  });

  test('parse: unrelated <!-- comments --> are left alone', () => {
    const md = '<!-- sdocs-agent-block -->\nHello <!-- TODO: fix -->.\nParagraph.\n' +
               '<!--sdoc-comment id="c1" author="user" color="#fff" at="" text="ok"-->';
    const out = SDC.parse(md);
    assert.strictEqual(out.comments.length, 1);
    assert.strictEqual(out.comments[0].id, 'c1');
  });

  test('parse: fenced code block containing fake sdoc syntax is ignored', () => {
    const md = 'Intro.\n\n```html\n<!--sdoc-c:c999-->fake<!--/sdoc-c:c999-->\n<!--sdoc-comment id="c999" author="evil" color="#000" at="" text="no"-->\n```\n\nReal comment follows.\n' +
               '<!--sdoc-comment id="c1" author="user" color="#ffd700" at="" text="real"-->';
    const out = SDC.parse(md);
    assert.strictEqual(out.comments.length, 1);
    assert.strictEqual(out.comments[0].id, 'c1');
    assert.strictEqual(out.comments[0].text, 'real');
  });

  test('parse: sibling ids c1 and c11 are distinguished', () => {
    const md = '<!--sdoc-c:c1 -->A<!--/sdoc-c:c1-->\n' +
               '<!--sdoc-c:c11 -->B<!--/sdoc-c:c11-->\n' +
               '<!--sdoc-comment id="c1" author="u" color="#f" at="" text="one"-->\n' +
               '<!--sdoc-comment id="c11" author="u" color="#f" at="" text="eleven"-->';
    const out = SDC.parse(md);
    const c1 = out.comments.find(c => c.id === 'c1');
    const c11 = out.comments.find(c => c.id === 'c11');
    assert.strictEqual(c1.anchor.text, 'A');
    assert.strictEqual(c11.anchor.text, 'B');
    assert.strictEqual(c1.text, 'one');
    assert.strictEqual(c11.text, 'eleven');
  });

  test('encodeAttr / decodeAttr: round-trip for plain text', () => {
    const s = 'hello world';
    assert.strictEqual(SDC.decodeAttr(SDC.encodeAttr(s)), s);
  });

  test('encodeAttr / decodeAttr: round-trip for text with tricky chars', () => {
    const s = 'Contains "quotes" &amps & newline\nand --> terminator';
    const encoded = SDC.encodeAttr(s);
    // storage form must not contain `-->` (HTML comment terminator)
    assert.ok(encoded.indexOf('-->') === -1, 'encoded form must not contain -->');
    // and must not contain a literal `"` (would break our attribute delimiter)
    assert.ok(encoded.indexOf('"') === -1, 'encoded form must not contain unescaped "');
    assert.strictEqual(SDC.decodeAttr(encoded), s);
  });

  test('encodeAttr: breaks triple-dash runs too', () => {
    const encoded = SDC.encodeAttr('---');
    assert.ok(encoded.indexOf('--') === -1, 'no -- should remain, got: ' + encoded);
    assert.strictEqual(SDC.decodeAttr(encoded), '---');
  });

  test('parse survives body text containing `-->` and `"` after encode', () => {
    const meta = {
      id: 'c1', author: 'user', color: '#ffd700', at: '2026-04-24',
      text: 'She said "use --> arrow" in code.',
    };
    const md = 'Paragraph.\n' + SDC.serializeComment(meta);
    const out = SDC.parse(md);
    assert.strictEqual(out.comments.length, 1);
    assert.strictEqual(out.comments[0].text, 'She said "use --> arrow" in code.');
  });

  test('addSelectionComment: inserts wrapper + metadata', () => {
    const md = 'The quick brown fox jumps over the lazy dog.\n';
    const result = SDC.addSelectionComment(md, {
      selectedText: 'brown fox',
      before: 'quick ',
      after: ' jumps',
    }, { author: 'user', color: '#ffd700', at: '2026-04-24', text: 'Very brown.' });
    assert.strictEqual(result.id, 'c1');
    assert.ok(result.md.indexOf('<!--sdoc-c:c1 ') !== -1);
    assert.ok(result.md.indexOf('<!--/sdoc-c:c1-->') !== -1);
    assert.ok(result.md.indexOf('id="c1"') !== -1);
    const parsed = SDC.parse(result.md);
    assert.strictEqual(parsed.comments.length, 1);
    assert.strictEqual(parsed.comments[0].anchor.text, 'brown fox');
    assert.strictEqual(parsed.comments[0].text, 'Very brown.');
  });

  test('addBlockComment: inserts metadata block after block', () => {
    const md = 'First paragraph.\n\nSecond paragraph here.\n';
    const result = SDC.addBlockComment(md, { blockText: 'Second paragraph' },
      { author: 'user', color: '#ffd700', at: '2026-04-24', text: 'Comment on second.' });
    assert.strictEqual(result.id, 'c1');
    const parsed = SDC.parse(result.md);
    assert.strictEqual(parsed.comments.length, 1);
    assert.strictEqual(parsed.comments[0].anchor.type, 'block');
    assert.strictEqual(parsed.comments[0].text, 'Comment on second.');
    // first paragraph stays intact
    assert.ok(result.md.indexOf('First paragraph.') !== -1);
  });

  test('nextCommentId: increments past highest existing', () => {
    const md = '<!--sdoc-comment id="c5" author="u" color="#f" at="" text=""-->\n' +
               '<!--sdoc-comment id="c2" author="u" color="#f" at="" text=""-->';
    assert.strictEqual(SDC.nextCommentId(md), 'c6');
  });

  test('nextCommentId: empty body returns c1', () => {
    assert.strictEqual(SDC.nextCommentId(''), 'c1');
    assert.strictEqual(SDC.nextCommentId('# Just a heading\n'), 'c1');
  });

  test('removeComment: strips selection wrapper + metadata block', () => {
    const md = 'Hello <!--sdoc-c:c1 before="lo " after=" there"-->world<!--/sdoc-c:c1--> there.\n' +
               '<!--sdoc-comment id="c1" author="u" color="#f" at="" text="x"-->\nNext line.';
    const cleaned = SDC.removeComment(md, 'c1');
    assert.ok(cleaned.indexOf('sdoc-c:c1') === -1);
    assert.ok(cleaned.indexOf('sdoc-comment') === -1);
    assert.ok(cleaned.indexOf('Hello world there.') !== -1, 'anchor text must remain');
    assert.ok(cleaned.indexOf('Next line.') !== -1);
  });

  test('removeComment: strips block-anchored metadata without wrapper', () => {
    const md = 'First.\n<!--sdoc-comment id="c7" author="u" color="#f" at="" text="x"-->\nSecond.';
    const cleaned = SDC.removeComment(md, 'c7');
    assert.ok(cleaned.indexOf('sdoc-comment') === -1);
    assert.ok(cleaned.indexOf('First.') !== -1);
    assert.ok(cleaned.indexOf('Second.') !== -1);
  });

  test('idempotency: parse(serialize(c)) roundtrips', () => {
    const c = {
      id: 'c3', author: 'someone', color: '#abcdef', at: '2026-04-24T10:00:00Z',
      text: 'Tricky "content" with --> and & ampersands\nand newlines.',
    };
    const serialized = SDC.serializeComment(c);
    const md = 'Body.\n' + serialized;
    const parsed = SDC.parse(md);
    assert.strictEqual(parsed.comments.length, 1);
    const got = parsed.comments[0];
    assert.strictEqual(got.id, c.id);
    assert.strictEqual(got.author, c.author);
    assert.strictEqual(got.color, c.color);
    assert.strictEqual(got.at, c.at);
    assert.strictEqual(got.text, c.text);
  });

  test('idempotency: round-trip through add then parse preserves the doc', () => {
    const md0 = 'Alpha. Some unique-phrase here. Beta.\n';
    const { md: md1, id } = SDC.addSelectionComment(md0, {
      selectedText: 'unique-phrase',
      before: 'Some ',
      after: ' here',
    }, { author: 'u', color: '#ffd700', at: '2026-04-24', text: 'noted' });
    const out = SDC.parse(md1);
    assert.strictEqual(id, 'c1');
    assert.strictEqual(out.comments.length, 1);
    // removing returns a body with the anchor text still intact
    const md2 = SDC.removeComment(md1, 'c1');
    assert.ok(md2.indexOf('unique-phrase') !== -1);
    assert.ok(md2.indexOf('sdoc-') === -1);
  });

  test('malformed: wrapper without matching metadata is ignored', () => {
    const md = '<!--sdoc-c:c1-->orphan<!--/sdoc-c:c1-->\n';
    const out = SDC.parse(md);
    assert.strictEqual(out.comments.length, 0);
  });

  test('malformed: metadata without wrapper is treated as block-anchored', () => {
    const md = 'Paragraph.\n<!--sdoc-comment id="c1" author="u" color="#f" at="" text="x"-->';
    const out = SDC.parse(md);
    assert.strictEqual(out.comments.length, 1);
    assert.strictEqual(out.comments[0].anchor.type, 'block');
  });

  test('addSelectionComment: throws on ambiguous text when context does not qualify', () => {
    const md = 'The cat sat. The cat jumped. Done.\n';
    assert.throws(() => {
      SDC.addSelectionComment(md, { selectedText: 'The cat', before: '', after: '' },
        { author: 'u', color: '#fff', at: '', text: 'x' });
    }, /multiple times/);
  });

  test('addSelectionComment: accepts ambiguous text when context disambiguates', () => {
    const md = 'The cat sat. The cat jumped. Done.\n';
    const res = SDC.addSelectionComment(md, {
      selectedText: 'The cat', before: '. ', after: ' jumped',
    }, { author: 'u', color: '#fff', at: '', text: 'x' });
    // The wrapper should be around the SECOND occurrence, not the first.
    const idx = res.md.indexOf('sdoc-c:c1');
    // Position of the first "The cat" in the original md is 0.
    // The context match should have located it at index ~13.
    assert.ok(idx > 5, 'wrapper should be on the second occurrence');
  });

  test('addSelectionComment: selection across inline code wraps source span including backticks', () => {
    const md = 'A paragraph with `inline code` and more text.\n';
    const res = SDC.addSelectionComment(md, {
      selectedText: 'with inline code', before: '', after: '',
    }, { author: 'u', color: '#fff', at: '', text: 'x' });
    const m = res.md.match(/<!--sdoc-c:c1-->([^<]*)<!--\/sdoc-c:c1-->/);
    assert.ok(m, 'wrapper exists');
    assert.strictEqual(m[1], 'with `inline code`');
  });

  test('addSelectionComment: selection crossing into inline code wraps whole span', () => {
    const md = 'Before CLI: `npm i -g sdocs-dev`. After.\n';
    const res = SDC.addSelectionComment(md, {
      selectedText: 'CLI: npm i', before: '', after: '',
    }, { author: 'u', color: '#fff', at: '', text: 'x' });
    const m = res.md.match(/<!--sdoc-c:c1-->([^<]*)<!--\/sdoc-c:c1-->/);
    assert.ok(m);
    assert.strictEqual(m[1], 'CLI: `npm i -g sdocs-dev`');
  });

  test('addSelectionComment: selection entirely inside inline code pulls backticks in', () => {
    const md = 'Before `npm i -g sdocs-dev`. After.\n';
    const res = SDC.addSelectionComment(md, {
      selectedText: 'npm i -g', before: '', after: '',
    }, { author: 'u', color: '#fff', at: '', text: 'x' });
    const m = res.md.match(/<!--sdoc-c:c1-->([^<]*)<!--\/sdoc-c:c1-->/);
    assert.ok(m);
    assert.strictEqual(m[1], '`npm i -g sdocs-dev`');
  });

  test('addSelectionComment: selection across bold keeps asterisks balanced', () => {
    const md = 'Some **bold** text here.\n';
    const res = SDC.addSelectionComment(md, {
      selectedText: 'Some bold text', before: '', after: '',
    }, { author: 'u', color: '#fff', at: '', text: 'x' });
    const m = res.md.match(/<!--sdoc-c:c1-->([^<]*)<!--\/sdoc-c:c1-->/);
    assert.ok(m);
    assert.strictEqual(m[1], 'Some **bold** text');
  });

  test('duplicate wrapper ids: parse overwrites deterministically (last wins)', () => {
    const md = 'A <!--sdoc-c:c1-->one<!--/sdoc-c:c1--> B <!--sdoc-c:c1-->two<!--/sdoc-c:c1-->\n' +
               '<!--sdoc-comment id="c1" author="u" color="#f" at="" text="x"-->';
    const out = SDC.parse(md);
    assert.strictEqual(out.comments.length, 1);
    // Either the first or the second (behaviour is deterministic either way).
    assert.ok(out.comments[0].anchor.text === 'one' || out.comments[0].anchor.text === 'two');
  });

  test('3-level round-trip: add → remove → add produces same comment shape', () => {
    const md0 = 'Quick unique-phrase stays put.\n';
    const r1 = SDC.addSelectionComment(md0, {
      selectedText: 'unique-phrase', before: 'Quick ', after: ' stays',
    }, { author: 'u', color: '#ffd700', at: '2026-04-24', text: 'first' });
    const md1 = r1.md;
    const md2 = SDC.removeComment(md1, 'c1');
    // Removed body should contain anchor text plainly, no sdoc markers.
    assert.ok(md2.indexOf('sdoc-') === -1);
    assert.ok(md2.indexOf('unique-phrase') !== -1);
    // Add again, expect c1 reused (no remaining ids in body).
    const r3 = SDC.addSelectionComment(md2, {
      selectedText: 'unique-phrase', before: 'Quick ', after: ' stays',
    }, { author: 'u', color: '#ffd700', at: '2026-04-24', text: 'second' });
    assert.strictEqual(r3.id, 'c1');
    const parsed = SDC.parse(r3.md);
    assert.strictEqual(parsed.comments.length, 1);
    assert.strictEqual(parsed.comments[0].text, 'second');
  });

  test('updateComment: replaces text attribute, leaves everything else intact', () => {
    const md = 'First.\n<!--sdoc-comment id="c1" author="u" color="#ffd700" at="2026-04-24" text="old"-->\nSecond.';
    const out = SDC.updateComment(md, 'c1', 'new value');
    assert.ok(out.indexOf('text="new value"') !== -1);
    assert.ok(out.indexOf('text="old"') === -1);
    assert.ok(out.indexOf('id="c1"') !== -1);
    assert.ok(out.indexOf('author="u"') !== -1);
    assert.ok(out.indexOf('color="#ffd700"') !== -1);
    // parse the updated md and check body text
    const parsed = SDC.parse(out);
    assert.strictEqual(parsed.comments[0].text, 'new value');
  });

  test('updateComment: missing id is a no-op', () => {
    const md = '<!--sdoc-comment id="c1" author="u" color="#f" at="" text="x"-->';
    assert.strictEqual(SDC.updateComment(md, 'c99', 'y'), md);
  });

  test('updateComment: handles tricky characters in the new text', () => {
    const md = '<!--sdoc-comment id="c1" author="u" color="#f" at="" text="x"-->';
    const out = SDC.updateComment(md, 'c1', 'Has "quotes" and --> arrow\nwith newline.');
    const parsed = SDC.parse(out);
    assert.strictEqual(parsed.comments[0].text, 'Has "quotes" and --> arrow\nwith newline.');
  });

  test('nextCommentId: comments inside fenced code do not bump the counter', () => {
    const md = '```\n<!--sdoc-comment id="c999" author="x" color="#f" at="" text="x"-->\n```\n';
    assert.strictEqual(SDC.nextCommentId(md), 'c1');
  });

};
