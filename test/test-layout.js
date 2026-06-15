const path = require('path');

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Layout Container Tests ───────────────────────\n');

  const layout = require(path.join(__dirname, '..', 'public', 'sdocs-layout.js'));

  // The vendored browser marked, required directly so the integration tests
  // exercise the exact parser the app ships - not a possibly-divergent npm copy.
  let marked = require(path.join(__dirname, '..', 'public', 'vendor', 'marked.min.js'));
  if (marked && marked.marked) marked = marked.marked;
  layout.register(marked);

  // ── parseAttrs: strict allowlist ──

  test('parseAttrs: reads cols/gap/align/span', () => {
    const a = layout.parseAttrs('cols=3 gap=lg align=center span=2');
    assert.deepStrictEqual(a, { cols: '3', gap: 'lg', align: 'center', span: '2' });
  });

  test('parseAttrs: drops unknown keys and bad values', () => {
    const a = layout.parseAttrs('cols=99 gap=huge onclick=alert(1) foo=bar');
    // cols=99 is out of 1..12 range, gap=huge not in enum, others unknown.
    assert.deepStrictEqual(a, {});
  });

  test('parseAttrs: tolerates quotes and extra whitespace', () => {
    const a = layout.parseAttrs('  cols = "2"   gap=\'sm\' ');
    assert.deepStrictEqual(a, { cols: '2', gap: 'sm' });
  });

  test('parseAttrs: empty tail yields empty object', () => {
    assert.deepStrictEqual(layout.parseAttrs(''), {});
    assert.deepStrictEqual(layout.parseAttrs(undefined), {});
  });

  // ── scanContainer: balanced, fence-aware ──

  test('scanContainer: returns null for non-container source', () => {
    assert.strictEqual(layout.scanContainer('# just a heading\n'), null);
    assert.strictEqual(layout.scanContainer(':::notathing\nx\n:::\n'), null);
  });

  test('scanContainer: captures name, attrs, inner, raw', () => {
    const src = ':::grid cols=2\nhello\n:::\nTRAILING';
    const c = layout.scanContainer(src);
    assert.strictEqual(c.name, 'grid');
    assert.deepStrictEqual(c.attrs, { cols: '2' });
    assert.strictEqual(c.inner.trim(), 'hello');
    assert.ok(c.raw.endsWith(':::\n'), 'raw stops at the closing fence');
    assert.ok(!c.raw.includes('TRAILING'), 'raw does not over-consume');
  });

  test('scanContainer: ignores ::: inside a code fence', () => {
    const src = ':::card\n```text\n:::\n:::grid\n```\nstill inside\n:::\nAFTER';
    const c = layout.scanContainer(src);
    assert.strictEqual(c.name, 'card');
    assert.ok(c.inner.includes('still inside'), 'fenced ::: did not close early');
    assert.ok(!c.raw.includes('AFTER'));
  });

  test('scanContainer: unterminated container returns null', () => {
    assert.strictEqual(layout.scanContainer(':::grid\nno close here'), null);
  });

  test('scanContainer: nested containers balance by depth', () => {
    const src = ':::grid\n:::col\na\n:::\n:::col\nb\n:::\n:::\nDONE';
    const c = layout.scanContainer(src);
    assert.strictEqual(c.name, 'grid');
    assert.ok(c.inner.includes(':::col'), 'inner keeps the nested opens');
    assert.ok(!c.raw.includes('DONE'), 'outer close matched, not an inner one');
  });

  // ── full marked integration (vendored parser) ──

  function parse(md) { return marked.parse(md); }

  test('grid renders a div.sdoc-grid with data-cols', () => {
    const out = parse(':::grid cols=3\n:::card\nx\n:::\n:::\n');
    assert.ok(/<div class="sdoc-grid" data-cols="3">/.test(out));
  });

  test('card renders div.sdoc-col.sdoc-card', () => {
    const out = parse(':::grid\n:::card\nx\n:::\n:::\n');
    assert.ok(/<div class="sdoc-col sdoc-card">/.test(out));
  });

  test('col renders bare div.sdoc-col', () => {
    const out = parse(':::grid\n:::col\nx\n:::\n:::\n');
    assert.ok(/<div class="sdoc-col">/.test(out));
  });

  test('nested fenced blocks survive as language-* code', () => {
    const md = [
      ':::grid cols=2',
      ':::card',
      '```mermaid',
      'graph TD; A-->B',
      '```',
      ':::',
      ':::card',
      '```cells',
      'a,b',
      '1,2',
      '```',
      ':::',
      ':::',
    ].join('\n');
    const out = parse(md);
    assert.ok(/language-mermaid/.test(out), 'mermaid fence intact for the DOM processor');
    assert.ok(/language-cells/.test(out), 'cells fence intact for the DOM processor');
  });

  test('markdown inside a column is parsed (not left raw)', () => {
    const out = parse(':::grid\n:::col\n**bold** and a [link](https://x.com)\n:::\n:::\n');
    assert.ok(/<strong>bold<\/strong>/.test(out));
    assert.ok(/<a href="https:\/\/x.com">link<\/a>/.test(out));
  });

  test('content after the container resumes normal parsing', () => {
    const out = parse(':::grid\n:::col\nx\n:::\n:::\n\nAfter.\n');
    assert.ok(/<p>After.<\/p>/.test(out));
  });

  test('nested grids produce two grid wrappers', () => {
    const md = ':::grid\n:::col\n:::grid cols=2\n:::col\na\n:::\n:::col\nb\n:::\n:::\n:::\n:::\n';
    const out = parse(md);
    assert.strictEqual((out.match(/sdoc-grid/g) || []).length, 2);
  });

  test('attributes never emit a non-allowlisted data attribute', () => {
    // A would-be injection in the attribute tail must not reach the HTML.
    const out = parse(':::grid cols=2 onmouseover=alert(1) style=evil\n:::col\nx\n:::\n:::\n');
    assert.ok(!/onmouseover/.test(out), 'no event handler leaked');
    assert.ok(!/style=/.test(out), 'no style attribute leaked');
    assert.ok(/data-cols="2"/.test(out), 'allowlisted attr still present');
  });
};
