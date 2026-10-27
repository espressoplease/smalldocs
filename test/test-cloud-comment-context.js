'use strict';

const { project, locateInline, sourceLocations } = require('../lib/cloud-comment-context');

module.exports = function (h) {
  const { test, assert } = h;
  const read = (markdown, comment, context = 'snippet') => project(markdown, [comment], { context })[0];

  test('comment source context matches rendered formatting and keeps original YAML line coordinates', () => {
    const markdown = '---\ntitle: Plan\ncomments:\n  - quote: Metadata only\n---\n# Launch\n\nUse **ten** [workers](https://example.org) &amp; `retry`.\n';
    const comment = { id: 'c1', kind: 'inline', quote: 'ten workers & retry', block: 'p:0', prefix: 'Use ', text: 'Clarify', author: 'A' };
    const result = read(markdown, comment);
    assert.strictEqual(result.anchor.match_status, 'exact');
    assert.strictEqual(result.anchor.source_status, 'matched');
    assert.strictEqual(result.context.section, 'Launch');
    assert.strictEqual(result.context.line_basis, 'document');
    assert.deepStrictEqual([result.context.start_line, result.context.end_line], [8, 8]);
    assert.strictEqual(result.context.markdown, markdown.split('\n')[7] + '\n');
    assert.strictEqual(read(markdown, { kind: 'inline', quote: 'Metadata only' }).anchor.match_status, 'lost');
  });

  test('comment context preserves CRLF bytes while using full-document line numbers', () => {
    const markdown = '---\r\ntitle: Test\r\n---\r\n# Top\r\n\r\nThe **important** phrase.\r\n';
    const result = read(markdown, { kind: 'inline', quote: 'important phrase' });
    assert.strictEqual(result.context.start_line, 6);
    assert.strictEqual(result.context.markdown, 'The **important** phrase.\r\n');
  });

  test('source matches preserve original anchors and never mutate the canonical comments', () => {
    const comment = { id: 'c3', uid: 'stable', kind: 'inline', quote: 'target', block: 'p:8',
      future_hint: { values: [1, 2] }, resolved: true, text: 'keep me', replies: [{ id: 'r1', text: 'Reply' }] };
    const before = JSON.stringify(comment);
    const result = read('# A\n\nThe target.\n', comment);
    assert.strictEqual(result.anchor.block, 'p:8');
    assert.deepStrictEqual(result.anchor.future_hint, comment.future_hint);
    result.anchor.future_hint.values.push(3);
    assert.strictEqual(JSON.stringify(comment), before);
    assert.ok(!('text' in result.anchor));
    assert.ok(!('replies' in result.anchor));
    assert.strictEqual(result.anchor.match_status, 'relocated');
  });

  test('repeated quotes stay ambiguous even when a stored paragraph ordinal still exists', () => {
    const result = read('A **shared** phrase.\n\nA shared phrase.\n', { kind: 'inline', quote: 'shared phrase', block: 'p:0' });
    assert.strictEqual(result.anchor.match_status, 'ambiguous');
    assert.strictEqual(result.context, null);
  });

  test('prefix, suffix and block text can disambiguate repeated rendered phrases', () => {
    const markdown = 'First shared phrase ends.\n\nSecond **shared** phrase continues.\n';
    const byPrefix = read(markdown, { kind: 'inline', quote: 'shared phrase', prefix: 'Second ', block: 'p:0' });
    assert.strictEqual(byPrefix.anchor.match_status, 'relocated');
    assert.strictEqual(byPrefix.context.start_line, 3);
    const bySuffix = read(markdown, { kind: 'inline', quote: 'shared phrase', suffix: ' ends.' });
    assert.strictEqual(bySuffix.context.start_line, 1);
    const byBlock = read(markdown, { kind: 'inline', quote: 'shared phrase', block_text: 'Second shared' });
    assert.strictEqual(byBlock.context.start_line, 3);
  });

  test('nested heading paths and selectors identify the requested occurrence', () => {
    const markdown = '# A\n## Notes\nOne target.\n# B\n## Notes\nAnother target.\n';
    const bySection = read(markdown, { kind: 'inline', quote: 'target', section: 'B > Notes' });
    assert.strictEqual(bySection.context.section, 'B > Notes');
    assert.strictEqual(bySection.context.start_line, 6);
    assert.strictEqual(read(markdown, { kind: 'inline', quote: 'target', section: 'Notes' }).anchor.match_status, 'ambiguous');
    const byLines = read(markdown, { kind: 'inline', quote: 'target', lines: '3:3' });
    assert.strictEqual(byLines.context.start_line, 3);
  });

  test('deleted quote remains in the result as lost without invented context', () => {
    const result = read('# Changed\nThe replacement.\n', { id: 'c1', kind: 'inline', quote: 'deleted words', block: 'p:0' });
    assert.strictEqual(result.anchor.quote, 'deleted words');
    assert.strictEqual(result.anchor.match_status, 'lost');
    assert.strictEqual(result.anchor.source_status, 'not_found');
    assert.strictEqual(result.context, null);
  });

  test('block hints relocate a prose block while ordinal-only locations remain unverified', () => {
    const markdown = 'Inserted paragraph.\n\nTarget **block** content.\n';
    const hinted = read(markdown, { kind: 'block', block: 'p:0', block_text: 'Target block' });
    assert.strictEqual(hinted.anchor.match_status, 'relocated');
    assert.strictEqual(hinted.context.start_line, 3);
    const ordinal = read(markdown, { kind: 'block', block: 'p:0' });
    assert.strictEqual(ordinal.anchor.match_status, 'unverified');
    assert.strictEqual(ordinal.anchor.source_status, 'ordinal_only');
  });

  test('code line anchors follow shifted fences and shifted source lines', () => {
    const markdown = '# Code\n\n```js\nunrelated();\n```\n\n```js\n// inserted\nfunction run() {\n  return value;\n}\n```\n';
    const result = read(markdown, { kind: 'line', block: 'pre:0', line: 1, anchorText: '  return value;' });
    assert.strictEqual(result.anchor.match_status, 'relocated');
    assert.strictEqual(result.context.section, 'Code');
    assert.ok(result.context.start_line <= 10 && result.context.end_line >= 10);
    assert.ok(result.context.markdown.includes('  return value;'));
  });

  test('code context uses line context and full block hints without trusting repeated ordinals', () => {
    const markdown = '```js\nalpha();\nreturn value;\n}\n```\n\n```js\nbeta();\nreturn value;\n}\n```\n';
    const comment = { kind: 'method', block: 'pre:0', line: 1, endLine: 2, anchorText: 'return value;' };
    assert.strictEqual(read(markdown, comment).anchor.match_status, 'ambiguous');
    const contextual = read(markdown, Object.assign({}, comment, { line_prefix: 'beta();', line_suffix: '}' }));
    assert.strictEqual(contextual.anchor.match_status, 'relocated');
    assert.ok(contextual.context.markdown.includes('beta();'));
    const fingerprint = read(markdown, Object.assign({}, comment, { block_text: 'alpha();\nreturn value;\n}' }));
    assert.strictEqual(fingerprint.anchor.match_status, 'exact');
    assert.ok(fingerprint.context.markdown.includes('alpha();'));
  });

  test('token anchors detect deleted tokens and repeated tokens within one source line', () => {
    const markdown = '```js\nreturn value + value;\n```\n';
    const anchor = { kind: 'token', block: 'pre:0', line: 0, anchorText: 'return value + value;', quote: 'value' };
    assert.strictEqual(read(markdown, anchor).anchor.match_status, 'ambiguous');
    const exact = read(markdown, Object.assign({}, anchor, { quote_prefix: 'return ', quote_suffix: ' + value;' }));
    assert.strictEqual(exact.anchor.match_status, 'exact');
    assert.strictEqual(read(markdown, Object.assign({}, anchor, { quote: 'removed' })).anchor.match_status, 'lost');
  });

  test('code headings do not become section headings and indented code has original source coordinates', () => {
    const markdown = '# Real\n\n```md\n# Hidden\n```\n\n    first();\n    target();\n';
    const result = read(markdown, { kind: 'line', block: 'pre:1', line: 1, anchorText: 'target();' });
    assert.strictEqual(result.context.section, 'Real');
    assert.ok(result.context.start_line <= 8 && result.context.end_line >= 8);
    assert.ok(result.context.markdown.includes('    target();'));
  });

  test('table row and column fingerprints follow reordered source cells', () => {
    const markdown = '# Stock\n\n| Count | Name |\n| --- | --- |\n| 7 | Beta |\n| 3 | **Alpha** |\n';
    const result = read(markdown, { kind: 'table', block: 'table:0', table_scope: 'cell', table_row: 0, table_column: 0,
      row_text: 'Alpha', column_text: 'Name', cell_text: 'Alpha' });
    assert.strictEqual(result.anchor.match_status, 'relocated');
    assert.ok(result.context.start_line <= 6 && result.context.end_line >= 6);
    assert.ok(result.context.markdown.includes('| 3 | **Alpha** |'));
    assert.strictEqual(read(markdown, { kind: 'table', block: 'table:0', table_scope: 'column', table_column: 0 }).anchor.match_status, 'unverified');
  });

  test('repeated table row hints remain ambiguous', () => {
    const markdown = '| Name | Count |\n| - | - |\n| Same | 1 |\n| Same | 1 |\n';
    assert.strictEqual(read(markdown, { kind: 'table', block: 'table:0', table_scope: 'row', table_row: 0, row_text: 'Same | 1' }).anchor.match_status, 'ambiguous');
  });

  test('list text projects to its original source while structural element paths remain unverified', () => {
    const markdown = '# Work\n\n- Parent\n  - **Child** target\n- Next\n';
    const result = read(markdown, { kind: 'element', block: 'ul:0', element: 'li:0/ul:0/li:0',
      element_text: 'Child target', element_scope: 'branch' });
    assert.strictEqual(result.anchor.match_status, 'unverified');
    assert.strictEqual(result.anchor.source_status, 'element_source_only');
    assert.strictEqual(result.context.section, 'Work');
    assert.ok(result.context.markdown.includes('**Child** target'));
  });

  test('slide source follows moved slides but visual shape indices are never claimed as verified', () => {
    const source = 'text "Revenue" at 10 10';
    const markdown = '# Deck\n\n```slide\ntext "New" at 10 10\n```\n\n```slide\n' + source + '\n```\n';
    const whole = read(markdown, { kind: 'slide', slide: 0, slide_source: source });
    assert.strictEqual(whole.anchor.match_status, 'relocated');
    assert.ok(whole.context.markdown.includes('Revenue'));
    const shape = read(markdown, { kind: 'slide', slide: 0, shape: 2, slide_source: source, slide_text: 'Revenue' });
    assert.strictEqual(shape.anchor.match_status, 'unverified');
    assert.strictEqual(shape.anchor.source_status, 'slide_source_only');
  });

  test('unknown visual anchors retain hints without fabricated source locations', () => {
    const result = read('# A\nSomething.\n', { kind: 'canvas', x: 25, y: 40, object: 'shape1' });
    assert.strictEqual(result.anchor.match_status, 'unverified');
    assert.strictEqual(result.anchor.object, 'shape1');
    assert.strictEqual(result.context, null);
  });

  test('snippet budgets stay bounded and keep a quote near the end of a very long source line', () => {
    const markdown = '# Huge\n\n' + 'before '.repeat(1500) + '**unique target** ' + 'after '.repeat(1500) + '\n';
    const result = read(markdown, { kind: 'inline', quote: 'unique target' });
    assert.ok(result.context.markdown.length <= 2000);
    assert.ok(result.context.markdown.includes('**unique target**'));
    assert.strictEqual(result.context.start_line, 3);
    assert.strictEqual(result.context.end_line, 3);
    assert.strictEqual(result.context.truncated, true);
  });

  test('multiline snippet caps preserve line-coordinate provenance and hide unrelated paragraphs', () => {
    const code = Array.from({ length: 100 }, (_, i) => 'line_' + i + '();').join('\n');
    const markdown = 'Unrelated secret paragraph.\n\n```js\n' + code + '\n```\n';
    const result = read(markdown, { kind: 'method', block: 'pre:0', line: 40, endLine: 90, anchorText: 'line_40();' });
    assert.ok(result.context.markdown.split('\n').filter(Boolean).length <= 12);
    assert.ok(result.context.markdown.includes('line_40();'));
    assert.ok(!result.context.markdown.includes('Unrelated secret'));
    assert.strictEqual(result.context.truncated, true);
    const sourceLines = markdown.match(/[^\n]*\n|[^\n]+$/g);
    assert.strictEqual(result.context.markdown, sourceLines.slice(result.context.start_line - 1, result.context.end_line).join(''));
  });

  test('context none still diagnoses anchors without returning Markdown', () => {
    const result = read('The target.\n', { kind: 'inline', quote: 'target' }, 'none');
    assert.strictEqual(result.anchor.match_status, 'exact');
    assert.strictEqual(result.context, null);
  });

  test('stale production context cannot reattach to the only remaining sandbox quote', () => {
    const markdown = 'Production retry window: 45 minutes.\n\nSandbox retry window: 10 minutes.\n';
    const anchor = { kind: 'inline', quote: '10 minutes', prefix: 'Production retry window: ', suffix: '.',
      block: 'p:0', block_text: 'Production retry window: 10 minutes.' };
    const result = read(markdown, anchor);
    assert.strictEqual(result.anchor.match_status, 'lost');
    assert.strictEqual(result.context, null);
    assert.throws(() => locateInline(markdown, anchor), error => error.code === 'edit_no_match');
  });

  test('document fingerprints verify unchanged duplicate offsets and explicit unplaced flags suppress source fallback', () => {
    const markdown = 'Same target.\n\nSame target.\n';
    const anchor = { kind: 'inline', quote: 'target', block: 'p:1', block_text: 'Same target.', quote_offset: 5,
      document_hash: require('../public/sdocs-comments').documentFingerprint(markdown) };
    assert.strictEqual(read(markdown, anchor).context.start_line, 3);
    assert.strictEqual(read(markdown + '\nChanged.\n', anchor).anchor.match_status, 'ambiguous');
    assert.strictEqual(read(markdown, { ...anchor, anchor_status: 'orphaned' }).anchor.match_status, 'lost');
    assert.strictEqual(read(markdown, { ...anchor, anchor_status: 'ambiguous' }).context, null);
  });

  test('unchanged code block fingerprints retain repeated source rows and quote offsets', () => {
    const source = 'return value + value;\nreturn value + value;';
    const markdown = '```js\n' + source + '\n```\n';
    const anchor = { kind: 'token', block: 'pre:0', line: 1, anchorText: 'return value + value;', block_text: source,
      quote: 'value', quote_offset: 15 };
    const result = read(markdown, anchor);
    assert.strictEqual(result.anchor.match_status, 'exact');
    assert.ok(result.context.start_line <= 3 && result.context.end_line >= 3);
  });

  test('official portable inline exports project cleaned anchors against original source snippets', () => {
    const prose = require('../public/sdocs-comments');
    const note = { id: 'c1', kind: 'inline', quote: 'target', prefix: 'A ', suffix: '.', text: 'Check this.', author: 'A' };
    const raw = prose.serializeFootnotes({ comments: [note] }, 'A target.\n');
    const imported = prose.parseFootnotes(raw.replace(/\r\n/g, '\n')).comments;
    const result = project(raw, imported, { context: 'snippet' })[0];
    assert.strictEqual(result.anchor.match_status, 'exact');
    assert.strictEqual(result.context.start_line, 1);
    assert.strictEqual(result.context.end_line, 1);
    assert.strictEqual(result.context.markdown, 'A [target][^c1].\n');
    const location = sourceLocations(raw, imported)[0];
    assert.strictEqual(raw.slice(location.start, location.end), 'target');
    const spanning = sourceLocations(raw, [{ kind: 'inline', quote: 'A target.' }])[0];
    assert.strictEqual(spanning.status, 'unverified');
  });

  test('portable definitions and block markers keep original CRLF coordinates while fenced and other footnotes stay literal', () => {
    const prose = require('../public/sdocs-comments');
    const raw = '# First\r\n\r\nA target[^c1].\r\n\r\n[^c1]: A - Check the paragraph.\r\n\r\n# Later\r\n\r\nB [another][^c2].\r\n\r\n[^c2]: B - Check this phrase.\r\n\r\n```md\r\nLiteral [example][^c2].\r\n[^c9]: Not a comment\r\n```\r\n\r\nOrdinary [citation][^paper].\r\n[^paper]: A source\r\n';
    const imported = prose.parseFootnotes(raw.replace(/\r\n/g, '\n')).comments;
    assert.strictEqual(imported.length, 2);
    const results = project(raw, imported, { context: 'snippet' });
    assert.strictEqual(results[0].anchor.match_status, 'exact');
    assert.strictEqual(results[0].context.start_line, 3);
    assert.strictEqual(results[0].context.markdown, 'A target[^c1].\r\n');
    assert.strictEqual(results[1].context.start_line, 9);
    assert.strictEqual(results[1].context.section, 'Later');
    assert.strictEqual(results[1].context.markdown, 'B [another][^c2].\r\n');
    const literal = read(raw, { kind: 'inline', quote: 'Literal [example][^c2].' });
    assert.strictEqual(literal.anchor.match_status, 'exact');
    const ordinary = read(raw, { kind: 'inline', quote: 'Ordinary [citation][^paper].' });
    assert.strictEqual(ordinary.anchor.match_status, 'exact');
    assert.ok(ordinary.context.markdown.includes('[citation][^paper]'));
  });

  test('locateInline generates source-backed anchors for formatted prose and selected repeated text', () => {
    const markdown = '# One\nFirst **target**.\n\n# Two\nAnother [target](https://example.org).\n';
    const anchor = locateInline(markdown, { kind: 'inline', quote: 'target', section: 'Two' });
    assert.strictEqual(anchor.block, 'p:1');
    assert.strictEqual(anchor.block_text, 'Another target.');
    assert.strictEqual(anchor.prefix, 'Another ');
    assert.strictEqual(anchor.suffix, '.');
    assert.strictEqual(anchor.section, 'Two');
    assert.strictEqual(read(markdown, anchor).anchor.match_status, 'exact');
    assert.strictEqual(locateInline(markdown, { quote: 'target', lines: '2:2' }).block, 'p:0');
  });

  test('locateInline reports bounded ambiguity, missing quotes, selectors and invalid input', () => {
    const markdown = Array.from({ length: 20 }, () => 'Same target.').join('\n\n');
    assert.throws(() => locateInline(markdown, { quote: 'target' }), error => {
      assert.strictEqual(error.code, 'edit_ambiguous');
      assert.strictEqual(error.details.field, 'comments');
      assert.strictEqual(error.details.match_count, 20);
      assert.strictEqual(error.details.candidates.length, 8);
      assert.strictEqual(error.details.candidates_truncated, true);
      return true;
    });
    assert.throws(() => locateInline(markdown, { quote: 'gone' }), error => error.code === 'edit_no_match');
    assert.throws(() => locateInline(markdown, { quote: 'target', section: 'Gone' }), error => error.code === 'edit_no_match');
    assert.throws(() => locateInline(markdown, { quote: 'target', lines: '0:100' }), error => error.code === 'invalid_request');
    assert.throws(() => locateInline(markdown, { quote: ' ' }), error => error.code === 'invalid_request');
  });

  test('one indexed source scan handles many distinct short quotes and repeated comments consistently', () => {
    const markdown = Array.from({ length: 300 }, (_, i) => 'Paragraph needle_' + i + ' has **formatted** words.').join('\n\n');
    const comments = Array.from({ length: 300 }, (_, i) => ({ kind: 'inline', quote: 'needle_' + i + ' has' }));
    const results = project(markdown, comments, { context: 'snippet' });
    assert.strictEqual(results.length, 300);
    assert.ok(results.every(result => result.anchor.match_status === 'exact'));
    assert.strictEqual(results[299].context.start_line, 599);
  });
};
