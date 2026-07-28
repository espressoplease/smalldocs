/**
 * Slugify + TOC tests
 */

module.exports = function(harness) {
  const { assert, test } = harness;

  console.log('\n── Slugify + TOC Tests ────────────────────────\n');

  const { slugify, anchorCandidates } = require('../cli/shared/sdocs-slugify');

  test('slugify: basic text', () => {
    assert.strictEqual(slugify('Getting Started'), 'getting-started');
  });

  test('slugify: strips special characters', () => {
    assert.strictEqual(slugify("What's New?"), 'whats-new');
  });

  test('slugify: collapses multiple spaces and hyphens', () => {
    assert.strictEqual(slugify('foo   bar--baz'), 'foo-bar-baz');
  });

  test('slugify: handles numbers', () => {
    assert.strictEqual(slugify('Step 1: Install'), 'step-1-install');
  });

  test('slugify: trims leading/trailing hyphens', () => {
    assert.strictEqual(slugify('  --hello--  '), 'hello');
  });

  test('slugify: empty string', () => {
    assert.strictEqual(slugify(''), '');
  });

  test('slugify: unicode stripped to ascii', () => {
    assert.strictEqual(slugify('Café Résumé'), 'caf-rsum');
  });

  test('slugify: deduplication logic', () => {
    const headings = ['Setup', 'Usage', 'Setup', 'Setup'];
    const slugCounts = {};
    const results = [];
    headings.forEach(text => {
      let slug = slugify(text);
      if (!slug) slug = 'section';
      if (slugCounts[slug] != null) {
        slugCounts[slug]++;
        slug = slug + '-' + slugCounts[slug];
      } else {
        slugCounts[slug] = 0;
      }
      results.push(slug);
    });
    assert.deepStrictEqual(results, ['setup', 'usage', 'setup-1', 'setup-2']);
  });

  test('anchorCandidates: literal fragment comes first', () => {
    assert.strictEqual(anchorCandidates('getting-started')[0], 'getting-started');
  });

  test('anchorCandidates: an exact match yields no extra work', () => {
    assert.deepStrictEqual(anchorCandidates('getting-started'), ['getting-started']);
  });

  test('anchorCandidates: GitHub doubled hyphens fall back to our slug', () => {
    assert.deepStrictEqual(anchorCandidates('step-1--setup'),
      ['step-1--setup', 'step-1-setup']);
  });

  test('anchorCandidates: GitHub underscores fall back to our slug', () => {
    assert.deepStrictEqual(anchorCandidates('my_heading'),
      ['my_heading', 'myheading']);
  });

  test('anchorCandidates: mixed case fragment normalises', () => {
    assert.deepStrictEqual(anchorCandidates('Getting-Started'),
      ['Getting-Started', 'getting-started']);
  });

  test('anchorCandidates: underscore plus doubled hyphen offers both shapes', () => {
    assert.deepStrictEqual(anchorCandidates('a_b--c'),
      ['a_b--c', 'ab-c', 'a_b-c']);
  });

  test('anchorCandidates: empty fragment yields nothing', () => {
    assert.deepStrictEqual(anchorCandidates(''), []);
  });
};
