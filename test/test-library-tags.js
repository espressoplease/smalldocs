// Library tag extraction + merge unit tests.

const Tags = require('../cli/shared/sdocs-library-tags');

module.exports = function (h) {
  const { test, assert } = h;

  test('extractBodyHashtags: finds simple hashtags', () => {
    const tags = Tags.extractBodyHashtags('a body with #plan and #refactor inside.');
    assert.deepStrictEqual(tags, ['plan', 'refactor']);
  });

  test('extractBodyHashtags: lowercases and dedupes', () => {
    const tags = Tags.extractBodyHashtags('#Plan and #PLAN again.');
    assert.deepStrictEqual(tags, ['plan']);
  });

  test('extractBodyHashtags: ignores markdown headings', () => {
    const body = '# Heading\n\n## Sub\n\nthen a #tag in text.';
    const tags = Tags.extractBodyHashtags(body);
    assert.deepStrictEqual(tags, ['tag']);
  });

  test('extractBodyHashtags: ignores hashes inside fenced code', () => {
    const body = '```\n#nope\n```\nbut #yes in body.';
    const tags = Tags.extractBodyHashtags(body);
    assert.deepStrictEqual(tags, ['yes']);
  });

  test('extractBodyHashtags: ignores hashes inside inline code', () => {
    const body = 'see `#inline` versus #real here.';
    const tags = Tags.extractBodyHashtags(body);
    assert.deepStrictEqual(tags, ['real']);
  });

  test('extractBodyHashtags: skips front matter section', () => {
    const body = '---\ntitle: foo\ntags: [hidden]\n---\n\n#real in body.';
    const tags = Tags.extractBodyHashtags(body);
    assert.deepStrictEqual(tags, ['real']);
  });

  test('extractBodyHashtags: requires a leading letter', () => {
    const tags = Tags.extractBodyHashtags('this has #1234 and #-bad and #plan');
    assert.deepStrictEqual(tags, ['plan']);
  });

  test('mergeTags: dedupes, lowercases, preserves order', () => {
    const out = Tags.mergeTags(['Plan'], ['plan', 'refactor'], ['CLEANUP']);
    assert.deepStrictEqual(out, ['plan', 'refactor', 'cleanup']);
  });

  test('mergeTags: strips leading # and ignores empties', () => {
    const out = Tags.mergeTags(['#foo'], ['', null, '  bar  ']);
    assert.deepStrictEqual(out, ['foo', 'bar']);
  });

  test('parseTagArgs: matches +word, lowercases, skips invalid shapes', () => {
    const out = Tags.parseTagArgs(['+plan', '+proj-x', 'normal', '+1nope', '++nope']);
    assert.deepStrictEqual(out, ['plan', 'proj-x']);
  });

  test('parseTagArgs: rejects the # form (shells eat it as a comment)', () => {
    const out = Tags.parseTagArgs(['#plan', '#refactor']);
    assert.deepStrictEqual(out, []);
  });
};
