'use strict';

const reader = require('../public/sdocs-prose-reader');

module.exports = function ({ assert, test }) {
  test('prose reader section source includes nested headings and stops at a peer', () => {
    const markdown = '# Report\n\n## One\n\nFirst.\n\n### Detail\n\nNested.\n\n## Two\n\nSecond.';
    assert.equal(reader.sectionMarkdown(markdown, 1), '## One\n\nFirst.\n\n### Detail\n\nNested.');
  });

  test('prose reader section source ignores headings inside backtick and tilde fences', () => {
    const markdown = '# Report\n\n## One\n\n```md\n## Not a heading\n```\n\n~~~md\n## Still not a heading\n~~~\n\n## Two';
    assert.equal(reader.sectionMarkdown(markdown, 1),
      '## One\n\n```md\n## Not a heading\n```\n\n~~~md\n## Still not a heading\n~~~');
  });

  test('prose reader section source returns an empty string for a missing heading', () => {
    assert.equal(reader.sectionMarkdown('# Report', 4), '');
  });
};
