'use strict';

const comments = require('../lib/cloud-comments');
const { reanchor } = require('../lib/cloud-comment-rebase');
const { locateInline, project } = require('../lib/cloud-comment-context');

module.exports = function (h) {
  const { test, assert } = h;
  function document(body, notes) {
    return comments.write(comments.snapshot('---\ntitle: "Keep these quotes"\n# Keep this metadata comment\ntags: [operations, policy]\n---\n' + body), notes);
  }
  function note(body, anchor = { quote: '10 minutes' }) {
    return { ...locateInline(body, { kind: 'inline', quote: '10 minutes', ...anchor }), id: 'c1', uid: 'stable-uid', text: 'Review this limit.',
      author: 'Editor', color: '#ffbb00', at: '2026-10-01T12:00:00Z' };
  }
  function changed(before, body, notes = comments.snapshot(before).comments) {
    return comments.write({ ...comments.snapshot(before), body }, notes);
  }
  function only(markdown) { return comments.snapshot(markdown).comments[0]; }

  test('rebase follows the changed production quote instead of the surviving sandbox quote', () => {
    const body = '# Policy\n\nProduction retry window: 10 minutes.\n\nSandbox retry window: 10 minutes.\n';
    const anchor = note(body, { quote: '10 minutes', section: 'Policy', prefix: 'Production retry window: ', suffix: '.' });
    const before = document(body, [anchor]);
    const newBody = body.replace('Production retry window: 10', 'Production retry window: 45');
    const after = reanchor(before, changed(before, newBody));
    const updated = only(after);
    assert.strictEqual(updated.quote, '45 minutes');
    assert.strictEqual(updated.prefix, 'Production retry window: ');
    assert.strictEqual(updated.block, 'p:0');
    assert.strictEqual(updated.anchor_status, undefined);
    assert.strictEqual(updated.text, anchor.text);
    assert.strictEqual(updated.uid, anchor.uid);
    const projected = project(after, [updated], { context: 'snippet' })[0];
    assert.strictEqual(projected.anchor.match_status, 'exact');
    assert.ok(projected.context.markdown.includes('Production retry window: 45 minutes.'));
  });

  test('rebase maps several independent edits and insertions before the target', () => {
    const body = '# Policy\n\nOwner: Ana. Production retry window: 10 minutes. Contact: Lee.\n\nSandbox retry window: 10 minutes.\n';
    const before = document(body, [note(body, { quote: '10 minutes', prefix: 'Owner: Ana. Production retry window: ', suffix: '. Contact: Lee.' })]);
    const newBody = '# Added\n\nA new introduction.\n\n' + body.replace('Owner: Ana.', 'Owner: Ben.').replace('window: 10 minutes. Contact: Lee.', 'window: 25 minutes. Contact: Sam.');
    const result = only(reanchor(before, changed(before, newBody)));
    assert.strictEqual(result.quote, '25 minutes');
    assert.strictEqual(result.block, 'p:1');
    assert.ok(result.prefix.includes('Owner: Ben.'));
    assert.ok(result.suffix.includes('Contact: Sam.'));
  });

  test('rebase updates source positions after insertion and deletion while preserving the quote', () => {
    const body = 'Remove this paragraph.\n\n# Policy\n\nProduction retry window: 10 minutes.\n';
    const before = document(body, [note(body)]);
    const afterBody = '# Introduction\n\nInserted first.\n\nInserted second.\n\n' + body.replace('Remove this paragraph.\n\n', '');
    const result = only(reanchor(before, changed(before, afterBody)));
    assert.strictEqual(result.quote, '10 minutes');
    assert.strictEqual(result.block, 'p:2');
    assert.strictEqual(result.document_hash, require('../public/sdocs-comments').documentFingerprint(afterBody));
  });

  test('rebase marks deleted production feedback orphaned without attaching it to sandbox', () => {
    const body = '# Policy\n\nProduction retry window: 10 minutes.\n\nSandbox retry window: 10 minutes.\n';
    const original = note(body, { prefix: 'Production retry window: ', suffix: '.' });
    const before = document(body, [original]);
    const afterBody = body.replace('Production retry window: 10 minutes.\n\n', '');
    const after = reanchor(before, changed(before, afterBody));
    const result = only(after);
    assert.strictEqual(result.anchor_status, 'orphaned');
    assert.strictEqual(result.quote, original.quote);
    assert.strictEqual(result.prefix, original.prefix);
    assert.strictEqual(result.block_text, original.block_text);
    assert.strictEqual(project(after, [result], { context: 'snippet' })[0].context, null);
  });

  test('deleting only the selected quote preserves its old evidence and leaves it unplaced', () => {
    const body = 'Production retry window: 10 minutes.\n';
    const original = note(body);
    const before = document(body, [original]);
    const result = only(reanchor(before, changed(before, body.replace('10 minutes', ''))));
    assert.strictEqual(result.quote, '10 minutes');
    assert.strictEqual(result.anchor_status, 'orphaned');
    assert.strictEqual(result.text, original.text);
  });

  test('identical deleted passages stay ambiguous even when a diff can align either surviving copy', () => {
    const body = 'Same target.\n\nSame target.\n';
    const original = { id: 'c1', kind: 'inline', quote: 'target', block: 'p:0', block_text: 'Same target.', quote_offset: 5,
      document_hash: require('../public/sdocs-comments').documentFingerprint(body), text: 'Which occurrence?' };
    const before = document(body, [original]);
    const result = only(reanchor(before, changed(before, 'Same target.\n')));
    assert.strictEqual(result.anchor_status, 'ambiguous');
    assert.strictEqual(result.quote, 'target');
    assert.strictEqual(result.block, 'p:0');
  });

  test('intentionally edited caller anchors are preserved instead of being automatically rewritten', () => {
    const body = 'Production retry window: 10 minutes.\n\nSandbox retry window: 15 minutes.\n';
    const before = document(body, [note(body)]);
    const explicit = { ...only(before), ...locateInline(body, { kind: 'inline', quote: '15 minutes' }) };
    const after = changed(before, body.replace('10 minutes', '45 minutes'), [explicit]);
    assert.strictEqual(reanchor(before, after), after);
  });

  test('concurrent replies, comment text and resolution survive automatic retargeting', () => {
    const body = 'Production retry window: 10 minutes.\n';
    const before = document(body, [note(body)]);
    const updated = { ...only(before), text: 'A collaborator clarified this note.', resolved: true,
      resolved_at: '2026-10-28T12:00:00Z', replies: [{ id: 'rp1', author: 'Other', at: '2026-10-28T12:00:00Z', text: 'Reviewed.' }] };
    const after = reanchor(before, changed(before, body.replace('10', '45'), [updated]));
    const result = only(after);
    assert.strictEqual(result.quote, '45 minutes');
    assert.strictEqual(result.text, updated.text);
    assert.ok(result.resolved === true || result.resolved === 'true');
    assert.deepStrictEqual(require('../cli/shared/sdocs-comment-data').replies(result.replies), updated.replies);
    assert.strictEqual(result.resolved_at, updated.resolved_at);
  });

  test('new, deleted, duplicated-ID and replacement-UID comments are never matched to an old note', () => {
    const body = 'The 10 minutes limit.\n';
    const original = note(body);
    const before = document(body, [original]);
    const replacements = [{ ...original, uid: 'different-identity' }, { ...original, id: 'c2' }];
    const after = changed(before, body.replace('10', '45'), replacements);
    assert.strictEqual(reanchor(before, after), after);
    const duplicates = changed(before, body.replace('10', '45'), [original, { ...original }]);
    assert.strictEqual(reanchor(before, duplicates), duplicates);
  });

  test('body and unrelated YAML bytes remain exactly as supplied, including CRLF and metadata comments', () => {
    const body = '# Policy\r\n\r\nThe limit is 10 minutes.\r\n';
    const before = document(body, [note(body)]).replace(/(?<!\r)\n/g, '\r\n');
    const afterBody = body.replace('10', '45');
    const after = changed(before, afterBody);
    const rebased = reanchor(before, after);
    assert.strictEqual(comments.snapshot(rebased).body, afterBody);
    assert.ok(rebased.startsWith('---\r\ntitle: "Keep these quotes"\r\n# Keep this metadata comment\r\ntags: [operations, policy]\r\n'));
    assert.strictEqual(only(rebased).quote, '45 minutes');
  });

  test('formatted source is supported when the selected phrase is verbatim inside its formatting', () => {
    const body = 'Production retry window: **10 minutes**.\n';
    const before = document(body, [note(body)]);
    const after = reanchor(before, changed(before, body.replace('10 minutes', '45 minutes')));
    assert.strictEqual(only(after).quote, '45 minutes');
    assert.strictEqual(only(after).block_text, 'Production retry window: 45 minutes.');
  });

  test('selections spanning Markdown formatting are left conservative without rewriting source or notes', () => {
    const body = 'Production **retry window**: 10 minutes.\n';
    const before = document(body, [note(body, { quote: 'Production retry window: 10 minutes' })]);
    const after = changed(before, body.replace('10', '45'));
    assert.strictEqual(reanchor(before, after), after);
  });

  test('source code tokens follow renamed text and refresh precise row context', () => {
    const body = '# Code\n\n```js\nfunction run() {\n  return oldValue;\n}\n```\n';
    const source = 'function run() {\n  return oldValue;\n}';
    const original = { id: 'c1', kind: 'token', block: 'pre:0', line: 1, anchorText: '  return oldValue;', quote: 'oldValue',
      quote_offset: 9, block_text: source, line_prefix: 'function run() {', line_suffix: '}', text: 'Name this value.' };
    const before = document(body, [original]);
    const after = reanchor(before, changed(before, body.replace('oldValue', 'newValue')));
    const result = only(after);
    assert.strictEqual(result.quote, 'newValue');
    assert.strictEqual(result.anchorText, '  return newValue;');
    assert.strictEqual(result.line, 1);
    assert.strictEqual(result.quote_offset, 9);
    assert.ok(result.block_text.includes('newValue'));
    assert.strictEqual(result.text, original.text);
  });

  test('code line and method anchors follow inserted lines and retain method source extent', () => {
    const body = '```js\nfunction run() {\n  return 10;\n}\n```\n';
    const source = 'function run() {\n  return 10;\n}';
    const original = { id: 'c1', kind: 'method', block: 'pre:0', line: 0, endLine: 2, anchorText: 'function run() {', block_text: source, text: 'Review this method.' };
    const before = document(body, [original]);
    const afterBody = body.replace('function run()', '// Header\nfunction execute()').replace('  return 10;', '  const count = 45;\n  return count;');
    const result = only(reanchor(before, changed(before, afterBody)));
    assert.strictEqual(result.anchorText, 'function execute() {');
    assert.strictEqual(result.line, 1);
    assert.strictEqual(result.endLine, 4);
  });

  test('existing unplaced flags stay unplaced until an explicit reattach', () => {
    const body = 'Production retry window: 10 minutes.\n';
    const before = document(body, [{ ...note(body), anchor_status: 'orphaned' }]);
    const after = changed(before, body.replace('10', '45'));
    assert.strictEqual(reanchor(before, after), after);
  });

  test('rebase is a byte-preserving no-op when only metadata or comment threads change', () => {
    const body = 'The limit is 10 minutes.\n';
    const before = document(body, [note(body)]);
    const after = changed(before, body, [{ ...only(before), text: 'New note text.' }]).replace('title: "Keep these quotes"', 'title: Changed');
    assert.strictEqual(reanchor(before, after), after);
    assert.strictEqual(reanchor(before, before), before);
  });
};
