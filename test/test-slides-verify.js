const SlidesVerify = require('../cli/lib/slides-verify');

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n-- Slides Verify Tests -------------------------\n');

  test('scanSlideBlocks finds backtick and tilde slide fences', () => {
    const blocks = SlidesVerify.scanSlideBlocks([
      '# Deck',
      '',
      '```slide',
      'grid 16 9',
      'r 1 1 14 7 | One',
      '```',
      '',
      '~~~slide',
      'grid 16 9',
      'r 1 1 14 7 | Two',
      '~~~',
    ].join('\n'));
    assert.strictEqual(blocks.length, 2);
    assert.match(blocks[1], /Two/);
  });

  test('verifySlides reports clean slide geometry', () => {
    const report = SlidesVerify.verifySlides([
      '~~~slide',
      'grid 100 56.25',
      'r 8 8 84 40 | Clean',
      '~~~',
    ].join('\n'));
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.slideCount, 1);
    assert.strictEqual(report.errors.length, 0);
  });

  test('verifySlides reports unacknowledged bounds errors', () => {
    const report = SlidesVerify.verifySlides([
      '~~~slide',
      'grid 100 56.25',
      'c 84 10 18',
      '~~~',
    ].join('\n'));
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.errors.length, 1);
    assert.strictEqual(report.errors[0].slide, 1);
    assert.match(report.errors[0].message, /outside grid/);
  });

  test('verifySlides accepts intentional bleed without hiding other errors', () => {
    const report = SlidesVerify.verifySlides([
      '~~~slide',
      'grid 100 56.25',
      'c 84 10 18 bleed=allow',
      'r 10 10 80 70 | still wrong',
      '~~~',
    ].join('\n'));
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.errors.length, 1);
    assert.strictEqual(report.errors[0].line, 3);
  });

  test('verifySlides resolves built-in templates before validation', () => {
    const report = SlidesVerify.verifySlides([
      '~~~slide',
      '@extends cover',
      '#title: Verified cover',
      '~~~',
    ].join('\n'));
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.slideCount, 1);
  });
};
