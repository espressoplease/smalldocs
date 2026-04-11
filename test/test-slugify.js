/**
 * Slugify + TOC tests
 */

module.exports = function(harness) {
  const { assert, test } = harness;

  console.log('\n── Slugify + TOC Tests ────────────────────────\n');

  const { slugify } = require('../public/sdocs-slugify');

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
};
