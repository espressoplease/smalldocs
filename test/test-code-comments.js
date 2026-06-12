/**
 * code-comments data-model tests - public/sdocs-code-comments.js.
 *
 * The pure model behind annotating a source file in the fullscreen code view:
 * add / remove / update comments, sanitise colour + text, re-anchor a comment
 * to its line after the file shifts, and round-trip through the localStorage
 * JSON string. No DOM, no storage - those live in sdocs-code-focus.js.
 */

const CC = require('../public/sdocs-code-comments.js');

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Code Comment Model Tests ───────────────────\n');

  // ── ids ──────────────────────────────────────────────────────────────────

  test('nextId starts at c1 and increments past the highest existing id', () => {
    assert.strictEqual(CC.nextId([]), 'c1');
    assert.strictEqual(CC.nextId([{ id: 'c1' }, { id: 'c4' }, { id: 'c2' }]), 'c5');
  });

  test('isValidId only accepts cN', () => {
    assert.ok(CC.isValidId('c1'));
    assert.ok(CC.isValidId('c42'));
    assert.ok(!CC.isValidId('x1'));
    assert.ok(!CC.isValidId('c1; drop'));
    assert.ok(!CC.isValidId(''));
  });

  // ── add ──────────────────────────────────────────────────────────────────

  test('addComment appends a normalised line comment', () => {
    const { list, id } = CC.addComment([], { kind: 'line', line: 3, anchorText: 'return x' },
      { text: 'why?', author: 'jo' });
    assert.strictEqual(id, 'c1');
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].kind, 'line');
    assert.strictEqual(list[0].line, 3);
    assert.strictEqual(list[0].anchorText, 'return x');
    assert.strictEqual(list[0].text, 'why?');
    assert.strictEqual(list[0].author, 'jo');
    assert.ok(list[0].at, 'should stamp a timestamp');
  });

  test('addComment keeps endLine for a method comment, drops it for a line comment', () => {
    const m = CC.addComment([], { kind: 'method', line: 2, endLine: 9, anchorText: 'def run' }, {});
    assert.strictEqual(m.list[0].kind, 'method');
    assert.strictEqual(m.list[0].endLine, 9);
    const l = CC.addComment([], { kind: 'line', line: 2, anchorText: 'x = 1' }, {});
    assert.ok(!('endLine' in l.list[0]), 'line comment must not carry endLine');
  });

  test('addComment does not mutate the input array', () => {
    const start = [];
    const { list } = CC.addComment(start, { kind: 'line', line: 0, anchorText: 'a' }, {});
    assert.strictEqual(start.length, 0);
    assert.strictEqual(list.length, 1);
  });

  test('addComment throws without a line index', () => {
    assert.throws(() => CC.addComment([], { kind: 'line', anchorText: 'a' }, {}));
  });

  test('method endLine below the header is clamped up to the header line', () => {
    const { list } = CC.addComment([], { kind: 'method', line: 5, endLine: 2, anchorText: 'def x' }, {});
    assert.strictEqual(list[0].endLine, 5);
  });

  // ── remove / update ───────────────────────────────────────────────────────

  test('removeComment drops the matching id only', () => {
    let list = CC.addComment([], { kind: 'line', line: 0, anchorText: 'a' }, {}).list;
    list = CC.addComment(list, { kind: 'line', line: 1, anchorText: 'b' }, {}).list;
    const after = CC.removeComment(list, 'c1');
    assert.strictEqual(after.length, 1);
    assert.strictEqual(after[0].id, 'c2');
  });

  test('updateComment patches text and returns a new array', () => {
    const { list } = CC.addComment([], { kind: 'line', line: 0, anchorText: 'a' }, { text: 'old' });
    const after = CC.updateComment(list, 'c1', { text: 'new' });
    assert.notStrictEqual(after, list, 'should be a fresh array');
    assert.strictEqual(after[0].text, 'new');
  });

  test('updateComment on an unknown id is a reference-equal no-op', () => {
    const { list } = CC.addComment([], { kind: 'line', line: 0, anchorText: 'a' }, {});
    const after = CC.updateComment(list, 'c99', { text: 'x' });
    assert.strictEqual(after, list);
  });

  test('updateComment can mark a comment resolved', () => {
    const { list } = CC.addComment([], { kind: 'line', line: 0, anchorText: 'a' }, {});
    const after = CC.updateComment(list, 'c1', { resolved: true });
    assert.strictEqual(after[0].resolved, true);
  });

  // ── sanitisation ──────────────────────────────────────────────────────────

  test('a non-hex colour falls back to the default', () => {
    const { list } = CC.addComment([], { kind: 'line', line: 0, anchorText: 'a' },
      { color: 'url(https://evil/p.gif)' });
    assert.strictEqual(list[0].color, CC.DEFAULT_COLOR);
  });

  test('a valid hex colour is kept', () => {
    const { list } = CC.addComment([], { kind: 'line', line: 0, anchorText: 'a' }, { color: '#3b82f6' });
    assert.strictEqual(list[0].color, '#3b82f6');
  });

  test('control and bidi characters are stripped from text, newlines kept', () => {
    const dirty = 'line one\nline two‮reversed';
    assert.strictEqual(CC.sanitizeText(dirty), 'line one\nline tworeversed');
  });

  // ── anchor resolution ─────────────────────────────────────────────────────

  const SRC = ['class A', '  def one', '    return 1', '  end', '  def two', '    return 2', '  end', 'end'];

  test('resolveLine returns the stored index when the line still matches', () => {
    const c = { id: 'c1', kind: 'line', line: 4, anchorText: 'def two' };
    assert.strictEqual(CC.resolveLine(c, SRC), 4);
  });

  test('resolveLine re-finds a line after content is inserted above it', () => {
    const shifted = ['# header', '# added'].concat(SRC); // def two now at index 6
    const c = { id: 'c1', kind: 'line', line: 4, anchorText: 'def two' };
    assert.strictEqual(CC.resolveLine(c, shifted), 6);
  });

  test('resolveLine picks the nearest match when the anchor text repeats', () => {
    const src = ['return 1', 'x', 'return 1', 'y', 'return 1'];
    const c = { id: 'c1', kind: 'line', line: 3, anchorText: 'return 1' };
    // index 3 (y) does not match; nearest "return 1" to 3 is index 2 or 4 (tie);
    // the spiral checks lo before hi, so 2 wins.
    assert.strictEqual(CC.resolveLine(c, src), 2);
  });

  test('resolveLine returns -1 when the anchor is gone (orphan)', () => {
    const c = { id: 'c1', kind: 'line', line: 4, anchorText: 'def vanished' };
    assert.strictEqual(CC.resolveLine(c, SRC), -1);
  });

  test('resolveLine trusts the stored index when anchorText is empty', () => {
    const c = { id: 'c1', kind: 'line', line: 2, anchorText: '' };
    assert.strictEqual(CC.resolveLine(c, SRC), 2);
    const oob = { id: 'c1', kind: 'line', line: 99, anchorText: '' };
    assert.strictEqual(CC.resolveLine(oob, SRC), -1);
  });

  // ── serialize / parse ─────────────────────────────────────────────────────

  test('serialize then parse round-trips a list', () => {
    let list = CC.addComment([], { kind: 'line', line: 1, anchorText: 'def one' }, { text: 'a' }).list;
    list = CC.addComment(list, { kind: 'method', line: 4, endLine: 6, anchorText: 'def two' }, { text: 'b' }).list;
    const back = CC.parse(CC.serialize(list));
    assert.strictEqual(back.length, 2);
    assert.strictEqual(back[0].text, 'a');
    assert.strictEqual(back[1].kind, 'method');
    assert.strictEqual(back[1].endLine, 6);
  });

  test('parse degrades to [] on garbage and drops invalid entries', () => {
    assert.deepStrictEqual(CC.parse('not json'), []);
    assert.deepStrictEqual(CC.parse('{}'), []);
    assert.deepStrictEqual(CC.parse(''), []);
    // mixed valid + invalid: only the valid one survives
    const mixed = JSON.stringify([{ id: 'c1', kind: 'line', line: 0, anchorText: 'a' }, { id: 'bad' }, { line: 2 }]);
    const out = CC.parse(mixed);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].id, 'c1');
  });

  test('parse re-sanitises a stored hostile colour', () => {
    const hostile = JSON.stringify([{ id: 'c1', kind: 'line', line: 0, anchorText: 'a', color: 'url(x)' }]);
    assert.strictEqual(CC.parse(hostile)[0].color, CC.DEFAULT_COLOR);
  });

  // ── serializeAnnotations (copy with comments) ──────────────────────────────

  const ASRC = ['class A', '  def one', '    x = 1', '  end', '  def two', '    y = 2', '  end', 'end'];

  test('serializeAnnotations fences the code and lists notes by line', () => {
    let list = CC.addComment([], { kind: 'line', line: 2, anchorText: 'x = 1' }, { text: 'why?', author: 'jo' }).list;
    list = CC.addComment(list, { kind: 'method', line: 4, endLine: 6, anchorText: 'def two' }, { text: 'rename', author: 'jo' }).list;
    const out = CC.serializeAnnotations(list, ASRC, { fileName: 'a.rb', lang: 'ruby' });
    assert.ok(out.indexOf('Comments on a.rb') === 0, 'leads with the filename');
    assert.ok(out.indexOf('```ruby\nclass A') !== -1, 'fences the code with the language');
    assert.ok(out.indexOf('\nNotes:\n') !== -1, 'has a Notes section');
    assert.ok(/\[1\] line 3 `x = 1` - jo: why\?/.test(out), 'line note with 1-based line and anchor');
    assert.ok(/\[2\] method `def two` \(lines 5-7\) - jo: rename/.test(out), 'method note with range');
  });

  test('serializeAnnotations orders notes by resolved line', () => {
    let list = CC.addComment([], { kind: 'line', line: 5, anchorText: 'y = 2' }, { text: 'second' }).list;
    list = CC.addComment(list, { kind: 'line', line: 2, anchorText: 'x = 1' }, { text: 'first' }).list;
    const out = CC.serializeAnnotations(list, ASRC, { fileName: 'a.rb', lang: 'ruby' });
    assert.ok(out.indexOf('first') < out.indexOf('second'), 'earlier line listed first');
  });

  test('serializeAnnotations lineOffset shifts the printed numbers, not the anchoring', () => {
    // A section copy fences only the slice but cites the file's real lines: the
    // slice here stands for lines 12-15 of a file, so lineOffset is 11.
    let list = CC.addComment([], { kind: 'method', line: 0, endLine: 3, anchorText: 'class A' }, { text: 'dfs' }).list;
    list = CC.addComment(list, { kind: 'line', line: 2, anchorText: 'x = 1' }, { text: 'why?' }).list;
    const out = CC.serializeAnnotations(list, ASRC, { fileName: 'a.rb', lang: 'ruby', lineOffset: 11 });
    assert.ok(/method `class A` \(lines 12-15\)/.test(out), 'method note cites file lines, not slice lines');
    assert.ok(/line 14 `x = 1`/.test(out), 'line note cites the file line');
    assert.ok(out.indexOf('(lines 1-4)') === -1, 'no slice-relative range leaks through');
  });

  test('serializeAnnotations omits the Notes section when there are no notes', () => {
    const out = CC.serializeAnnotations([], ASRC, { fileName: 'a.rb', lang: 'ruby' });
    assert.ok(out.indexOf('Notes:') === -1);
    assert.ok(out.indexOf('```ruby') !== -1);
  });

  test('serializeAnnotations drops a note whose anchor is gone', () => {
    const list = CC.addComment([], { kind: 'line', line: 1, anchorText: 'NOT PRESENT' }, { text: 'lost' }).list;
    const out = CC.serializeAnnotations(list, ASRC, { fileName: 'a.rb', lang: 'ruby' });
    assert.ok(out.indexOf('Notes:') === -1, 'no resolvable notes, so no Notes section');
  });

  test('serializeAnnotations uses plain hyphens, never em or en dashes', () => {
    const list = CC.addComment([], { kind: 'line', line: 2, anchorText: 'x = 1' }, { text: 'hi' }).list;
    const out = CC.serializeAnnotations(list, ASRC, { fileName: 'a.rb', lang: 'ruby' });
    assert.ok(out.indexOf('—') === -1 && out.indexOf('–') === -1, 'no em/en dashes');
  });
};
