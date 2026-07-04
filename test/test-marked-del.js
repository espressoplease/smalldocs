// Strikethrough tokenizer override (public/sdocs-marked-del.js).
//
// marked's default GFM del rule matches a single-tilde pair, so prose
// like "~$14,527 ... ~316k t ... ~17-year" grows accidental
// strikethrough spans that can also swallow a ** marker and break bold
// for the rest of the paragraph. The override pins del to double
// tildes. These tests run the REAL shipped module against the REAL
// vendored marked build - the same pair the browser executes.
module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Marked del (strikethrough) Tests ───────────\n');

  // A fresh marked instance per run is not possible with the vendored
  // UMD singleton, but apply() is idempotent for these assertions: the
  // override fully shadows the default and never falls back.
  const marked = require('../public/vendor/marked.min.js');
  const markedDel = require('../public/sdocs-marked-del.js');
  markedDel.apply(marked);

  test('single-tilde pair stays literal text', () => {
    const html = marked.parse('costs ~5 dollars and ~10 cents');
    assert.ok(!html.includes('<del>'), 'no del element: ' + html);
    assert.ok(html.includes('~5'), 'tildes preserved: ' + html);
    assert.ok(html.includes('~10'), 'tildes preserved: ' + html);
  });

  test('double-tilde strikethrough still renders', () => {
    const html = marked.parse('a ~~struck~~ b');
    assert.ok(html.includes('<del>struck</del>'), html);
  });

  test('inline formatting still parses inside ~~...~~', () => {
    const html = marked.parse('x ~~del with **bold**~~ y');
    assert.ok(html.includes('<del>del with <strong>bold</strong></del>'), html);
  });

  test('approx-tilde prose keeps its bold intact (regression)', () => {
    // The reported document: two bare ~ marks used as "approximately"
    // struck through everything between them and ate the ** opener.
    const md = '**LME copper hit a record ~$14,527/t (Jan 2026)**; ' +
      'a refined deficit projected to widen to ~316k t in 2026; ' +
      'a **~17-year discovery-to-production lead time** means supply ' +
      "can't respond this cycle.";
    const html = marked.parse(md);
    assert.ok(!html.includes('<del>'), 'no accidental strikethrough: ' + html);
    assert.ok(html.includes('<strong>~17-year discovery-to-production lead time</strong>'),
      'bold survives: ' + html);
    assert.ok(!html.includes('**'), 'no leaked ** markers: ' + html);
  });

  test('escaped tildes and code spans unaffected', () => {
    const html = marked.parse('use `~home~` and \\~literal\\~');
    assert.ok(!html.includes('<del>'), html);
    assert.ok(html.includes('<code>~home~</code>'), html);
  });

  test('triple tilde does not open strikethrough', () => {
    const html = marked.parse('a ~~~not struck~~~ b');
    assert.ok(!html.includes('<del>'), html);
  });
};
