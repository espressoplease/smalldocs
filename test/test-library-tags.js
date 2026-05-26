// Library tag merge + CLI parsing unit tests.

const Tags = require('../cli/shared/sdocs-library-tags');

module.exports = function (h) {
  const { test, assert } = h;

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
