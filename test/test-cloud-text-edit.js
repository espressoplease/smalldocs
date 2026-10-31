'use strict';

const textEdit = require('../cli/shared/sdocs-text-edit');

module.exports = function (h) {
  const { assert, test } = h;
  return function () {
    function rejects(code, fn, check) {
      assert.throws(fn, error => {
        assert.strictEqual(error.code, code, error.message);
        assert.ok(error.details && typeof error.details === 'object');
        if (check) check(error.details);
        return true;
      });
    }
    function edit(markdown, operations, options) { return textEdit.applyEdits(markdown, { edits: operations }, options); }
    function patch(markdown, unified, options) { return textEdit.applyEdits(markdown, { patch: unified }, options); }

    test('text edit outline gives nested paths and inclusive original section ranges', () => {
      const markdown = '# Report\nIntro\n## Plan\nText\n### Detail\nMore\n## Risks\nRisk\n# Next\n';
      const entries = textEdit.outline(markdown);
      assert.deepStrictEqual(entries.map(entry => [entry.title, entry.path, entry.level, entry.start_line, entry.end_line]), [
        ['Report', 'Report', 1, 1, 8], ['Plan', 'Report > Plan', 2, 3, 6],
        ['Detail', 'Report > Plan > Detail', 3, 5, 6], ['Risks', 'Report > Risks', 2, 7, 8], ['Next', 'Next', 1, 9, 9],
      ]);
      assert.strictEqual(entries[1].heading, 'Plan');
    });

    test('text edit outline recognizes ATX and multiline setext headings outside fences', () => {
      const markdown = 'Title\ncontinued\n=======\n\n```md\n# Hidden\n```\n~~~\nHidden too\n---\n~~~\n\n  ## Visible ##\nbody\n\nSubtitle\n---\n    # Indented code\n####### Not a heading\n#No-space\n';
      assert.deepStrictEqual(textEdit.outline(markdown).map(entry => [entry.title, entry.level, entry.start_line, entry.heading_end_line]), [
        ['Title continued', 1, 1, 3], ['Visible', 2, 13, 13], ['Subtitle', 2, 16, 17],
      ]);
    });

    test('text edit outline ignores front matter and mismatched fence closers', () => {
      const markdown = '---\ntitle: Test\n# YAML comment\n---\n# Real\n````js\n```\n# Still hidden\n````\n## Child\n';
      assert.deepStrictEqual(textEdit.outline(markdown).map(entry => entry.path), ['Real', 'Real > Child']);
    });

    test('text edit selection preserves CRLF, Unicode and exact final newline shape', () => {
      const markdown = '# Résumé 😀\r\nαβγ\r\nlast';
      assert.deepStrictEqual(textEdit.select(markdown, { lines: '2:3' }), {
        markdown: 'αβγ\r\nlast', start_line: 2, end_line: 3, total_lines: 3,
      });
      assert.strictEqual(textEdit.select('a\n', { lines: '1:1' }).total_lines, 1);
      assert.strictEqual(textEdit.select('a\n\n', {}).total_lines, 2);
      assert.deepStrictEqual(textEdit.select(''), { markdown: '', start_line: 1, end_line: 0, total_lines: 0 });
    });

    test('text edit selection includes a section heading and nested sections', () => {
      const markdown = '# A\nIntro\n## Child\nChild body\n# B\nEnd';
      const selection = textEdit.select(markdown, { section: 'A', outline: true });
      assert.strictEqual(selection.markdown, '# A\nIntro\n## Child\nChild body\n');
      assert.deepStrictEqual([selection.start_line, selection.end_line, selection.total_lines], [1, 4, 6]);
      assert.strictEqual(selection.outline.length, 3);
      assert.strictEqual(textEdit.select(markdown, { section: 'A > Child' }).markdown, '## Child\nChild body\n');
    });

    test('text edit duplicate heading diagnostics identify full paths and original lines', () => {
      const markdown = '# One\n## Notes\nFirst\n# Two\n## Notes\nSecond\n';
      rejects('section_ambiguous', () => textEdit.select(markdown, { section: 'Notes' }), details => {
        assert.strictEqual(details.match_count, 2);
        assert.deepStrictEqual(details.candidates.map(entry => [entry.line, entry.section]), [[2, 'One > Notes'], [5, 'Two > Notes']]);
      });
      assert.strictEqual(textEdit.select(markdown, { section: 'Two > Notes' }).markdown, '## Notes\nSecond\n');
      rejects('section_not_found', () => textEdit.select(markdown, { section: 'Missing' }), details => {
        assert.strictEqual(details.match_count, 0);
        assert.ok(details.candidates.length);
      });
    });

    test('text edit line scopes can disambiguate repeated full section paths', () => {
      const markdown = '# A\n## Notes\nFirst\n## Notes\nSecond\n';
      rejects('section_ambiguous', () => textEdit.select(markdown, { section: 'A > Notes' }));
      const selection = textEdit.select(markdown, { section: 'A > Notes', lines: '5:5' });
      assert.strictEqual(selection.markdown, 'Second\n');
      assert.strictEqual(selection.start_line, 5);
    });

    test('text edit rejects malformed selectors and ranges instead of clipping them', () => {
      for (const selector of [null, [], { lines: '0:1' }, { lines: '2:1' }, { lines: '1:3' }, { lines: '1' }, { lines: [1, 2] }, { section: '' }]) {
        rejects('invalid_request', () => textEdit.select('one\ntwo', selector), details => assert.strictEqual(details.field, 'edit'));
      }
      rejects('invalid_request', () => textEdit.select('', { lines: '1:1' }));
    });

    test('text edit replaces exact Unicode text and deletes with empty new_text', () => {
      const result = edit('Before café 😀 after\r\nremove\r\n', [
        { old_text: 'café 😀', new_text: '東京' }, { old_text: 'remove\r\n', new_text: '' },
      ]);
      assert.strictEqual(result.markdown, 'Before 東京 after\r\n');
      assert.strictEqual(result.matched_count, 2);
      assert.deepStrictEqual(result.applied_edits.map(entry => entry.changed_count), [1, 1]);
    });

    test('text edit duplicate text is ambiguous even when a match is on the same line', () => {
      rejects('edit_ambiguous', () => edit('# Notes\nrepeat repeat\n', [{ old_text: 'repeat', new_text: 'new' }]), details => {
        assert.strictEqual(details.operation_index, 0);
        assert.strictEqual(details.match_count, 2);
        assert.strictEqual(details.candidates[0].line, 2);
        assert.strictEqual(details.candidates[0].section, 'Notes');
      });
    });

    test('text edit occurrence and all choose explicit repeated matches', () => {
      assert.strictEqual(edit('one one one', [{ old_text: 'one', new_text: 'two', occurrence: 2 }]).markdown, 'one two one');
      const result = edit('one one one', [{ old_text: 'one', new_text: 'two', all: true }]);
      assert.strictEqual(result.markdown, 'two two two');
      assert.strictEqual(result.matched_count, 3);
      assert.strictEqual(result.applied_edits[0].changed_count, 3);
      rejects('edit_no_match', () => edit('one one', [{ old_text: 'one', new_text: 'two', occurrence: 3 }]), details => {
        assert.strictEqual(details.match_count, 2);
      });
    });

    test('text edit matching context is exact and adjacent to the selected text', () => {
      const markdown = 'first: same. second: same!';
      assert.strictEqual(edit(markdown, [{ old_text: 'same', new_text: 'new', context_before: 'second: ', context_after: '!' }]).markdown,
        'first: same. second: new!');
      rejects('edit_no_match', () => edit(markdown, [{ old_text: 'same', new_text: 'new', context_before: 'first:', context_after: '.' }]));
    });

    test('text edit sections and line ranges scope exact replacements to original text', () => {
      const markdown = '# A\nsame\n# B\nsame\n';
      assert.strictEqual(edit(markdown, [{ old_text: 'same', new_text: 'new', section: 'B' }]).markdown, '# A\nsame\n# B\nnew\n');
      assert.strictEqual(edit(markdown, [{ old_text: 'same', new_text: 'new', lines: '2:2' }]).markdown, '# A\nnew\n# B\nsame\n');
      rejects('edit_no_match', () => edit(markdown, [{ old_text: 'same\n# B', new_text: 'new', lines: '2:2' }]));
    });

    test('text edit every batch operation matches the original revision before replacements', () => {
      assert.strictEqual(edit('A B', [{ old_text: 'A', new_text: 'B' }, { old_text: 'B', new_text: 'C' }]).markdown, 'B C');
      const markdown = '# Old\nkeep\n# Other\nend\n';
      assert.strictEqual(edit(markdown, [
        { old_text: '# Old', new_text: '# Renamed\nextra' },
        { old_text: 'keep', new_text: 'updated', section: 'Old', lines: '2:2' },
      ]).markdown, '# Renamed\nextra\nupdated\n# Other\nend\n');
      rejects('edit_no_match', () => edit('A', [{ old_text: 'A', new_text: 'B' }, { old_text: 'B', new_text: 'C' }]), details => {
        assert.strictEqual(details.operation_index, 1);
      });
    });

    test('text edit overlapping replacement ranges fail atomically with operation diagnostics', () => {
      rejects('overlapping_edits', () => edit('abcdef', [{ old_text: 'abc', new_text: 'x' }, { old_text: 'cde', new_text: 'y' }]), details => {
        assert.strictEqual(details.operation_index, 1);
        assert.strictEqual(details.conflicting_operation_index, 0);
        assert.strictEqual(details.candidates.length, 2);
      });
      rejects('overlapping_edits', () => edit('aaa', [{ old_text: 'aa', new_text: 'b', all: true }]));
      assert.strictEqual(edit('abcdef', [{ old_text: 'abc', new_text: 'x' }, { old_text: 'def', new_text: 'y' }]).markdown, 'xy');
    });

    test('text edit unchanged replacements and empty batches preserve exact bytes', () => {
      const markdown = '# Same\r\nunchanged 😀';
      const result = edit(markdown, [{ old_text: 'unchanged 😀', new_text: 'unchanged 😀' }]);
      assert.strictEqual(result.markdown, markdown);
      assert.strictEqual(result.matched_count, 1);
      assert.strictEqual(result.applied_edits[0].changed_count, 0);
      assert.strictEqual(edit(markdown, []).markdown, markdown);
      assert.strictEqual(edit('aa', [{ old_text: 'aa', new_text: 'aa' }, { old_text: 'a', new_text: 'b', occurrence: 1 }]).markdown, 'ba');
      rejects('edit_ambiguous', () => edit('same same', [{ old_text: 'same', new_text: 'same' }]));
    });

    test('text edit append and prepend insert exact text at scoped document boundaries', () => {
      assert.strictEqual(edit('', [{ op: 'append', text: 'first' }]).markdown, 'first');
      assert.strictEqual(edit('last', [{ op: 'append', text: '\nnext\n' }]).markdown, 'last\nnext\n');
      assert.strictEqual(edit('last\n', [{ op: 'prepend', text: 'first\n' }]).markdown, 'first\nlast\n');
      assert.strictEqual(edit('# A\nbody\n# B\nend', [{ op: 'append', section: 'A', text: 'extra\n' }]).markdown,
        '# A\nbody\nextra\n# B\nend');
      assert.strictEqual(edit('one\ntwo\n', [{ op: 'prepend', lines: '2:2', text: 'between\n' }]).markdown, 'one\nbetween\ntwo\n');
    });

    test('text edit insertions allow replacement boundaries but reject ambiguous shared insertion points', () => {
      assert.strictEqual(edit('old', [{ old_text: 'old', new_text: 'new' }, { op: 'append', text: '!' }, { op: 'prepend', text: '<' }]).markdown, '<new!');
      rejects('overlapping_edits', () => edit('x', [{ op: 'append', text: 'one' }, { op: 'append', text: 'two' }]));
      rejects('overlapping_edits', () => edit('one\ntwo\n', [
        { old_text: 'one\ntwo', new_text: 'new' }, { op: 'prepend', lines: '2:2', text: 'inside' },
      ]));
      assert.strictEqual(edit('x', [{ op: 'append', text: '' }]).applied_edits[0].changed_count, 0);
    });

    test('text edit validates request fields before producing any result', () => {
      for (const request of [null, [], {}, { edits: {} }, { edits: [], patch: 'x' }]) {
        rejects('invalid_request', () => textEdit.applyEdits('a', request));
      }
      for (const operation of [null, [], {}, { old_text: '', new_text: 'a' }, { old_text: 'a' },
        { old_text: 'a', new_text: 'b', occurrence: 0 }, { old_text: 'a', new_text: 'b', occurrence: 1.5 },
        { old_text: 'a', new_text: 'b', all: 'true' }, { old_text: 'a', new_text: 'b', all: true, occurrence: 1 },
        { old_text: 'a', new_text: 'b', context_before: null }, { op: 'append', text: 1 },
        { op: 'prepend', text: 'x', old_text: 'a' }, { op: 'unknown', old_text: 'a', new_text: 'b' }]) {
        rejects('invalid_request', () => edit('a', [operation]), details => {
          assert.strictEqual(details.operation_index, 0);
          assert.strictEqual(details.field, 'edit');
        });
      }
    });

    test('text edit rejects unknown schema fields rather than broadening a mistyped scope', () => {
      rejects('invalid_request', () => textEdit.select('# A\nvalue\n', { secton: 'Missing' }), details => {
        assert.deepStrictEqual(details.unknown_fields, ['secton']);
      });
      rejects('invalid_request', () => textEdit.select('# A\n', { outline: 'true' }));
      rejects('invalid_request', () => edit('# A\nvalue\n', [{ old_text: 'value', new_text: 'changed', secton: 'Missing' }]), details => {
        assert.strictEqual(details.operation_index, 0);
        assert.deepStrictEqual(details.unknown_fields, ['secton']);
      });
      rejects('invalid_request', () => textEdit.applyEdits('value', { edits: [], unexpected: true }));
      rejects('invalid_request', () => edit('value', [{ old_text: 'value', new_text: 'changed', text: 'ignored' }]));
      rejects('invalid_request', () => edit('value', new Array(1)));
    });

    test('text edit exact matching preserves paired and unpaired surrogate strings', () => {
      let seed = 913;
      function random(max) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; }
      const tokens = ['same', '😀', '\r\n', '\n', 'é', 'é', '東京', 'x', ' '];
      for (let trial = 0; trial < 200; trial += 1) {
        const markdown = Array.from({ length: 1 + random(25) }, () => tokens[random(tokens.length)]).join('');
        // Arbitrary UTF-16 offsets include a single half of a surrogate pair.
        const start = random(markdown.length);
        const oldText = markdown.slice(start, start + 1 + random(Math.min(8, markdown.length - start)));
        const replacement = tokens[random(tokens.length)];
        const matches = [];
        for (let at = 0; (at = markdown.indexOf(oldText, at)) >= 0; at += 1) matches.push(at);
        const occurrence = random(matches.length);
        const at = matches[occurrence];
        assert.strictEqual(edit(markdown, [{ old_text: oldText, new_text: replacement, occurrence: occurrence + 1 }]).markdown,
          markdown.slice(0, at) + replacement + markdown.slice(at + oldText.length));
      }
    });

    test('text edit bounds diagnostics without limiting matches or changed text', () => {
      const markdown = ('# ' + 'Heading'.repeat(100) + '\n') + Array(25).fill('repeat ' + 'body'.repeat(100)).join('\n');
      rejects('edit_ambiguous', () => edit(markdown, [{ old_text: 'repeat', new_text: 'new' }]), details => {
        assert.strictEqual(details.match_count, 25);
        assert.strictEqual(details.candidates.length, 8);
        assert.strictEqual(details.candidates_truncated, true);
        assert.ok(details.candidates.every(entry => entry.excerpt.length <= 120 && entry.section.length <= 240));
      });
      const result = edit(markdown, [{ old_text: 'repeat', new_text: 'new', all: true }]);
      assert.strictEqual(result.matched_count, 25);
      assert.strictEqual(result.applied_edits[0].locations.length, 8);
      assert.strictEqual(result.applied_edits[0].locations_truncated, true);
      assert.strictEqual((result.markdown.match(/new/g) || []).length, 25);
      const occurrence = edit(markdown, [{ old_text: 'repeat', new_text: 'last', occurrence: 25 }]);
      assert.strictEqual(occurrence.applied_edits[0].locations[0].start_line, 26);
      const noop = edit(markdown, [{ old_text: 'repeat', new_text: 'repeat', all: true }]);
      assert.strictEqual(noop.markdown, markdown);
      assert.strictEqual(noop.matched_count, 25);
      assert.strictEqual(noop.applied_edits[0].changed_count, 0);
    });

    test('text edit enforces the supplied UTF-8 result limit before materialization', () => {
      const markdown = '# 😀\r\nold\n';
      const operations = [{ old_text: 'old', new_text: 'é€' }];
      const expected = '# 😀\r\né€\n';
      const bytes = Buffer.byteLength(expected);
      assert.strictEqual(edit(markdown, operations, { maxBytes: bytes }).markdown, expected);
      rejects('file_too_large', () => edit(markdown, operations, { maxBytes: bytes - 1 }), details => {
        assert.strictEqual(details.max_bytes, bytes - 1);
      });
      rejects('file_too_large', () => edit('é', [], { maxBytes: 1 }));
      assert.strictEqual(edit('é', [{ old_text: 'é', new_text: '' }], { maxBytes: 0 }).markdown, '');
      for (const maxBytes of [-1, 1.5, '10', NaN, Infinity]) {
        rejects('invalid_request', () => edit('a', [], { maxBytes }));
      }
    });

    test('text edit later deletions offset expansions in either request order', () => {
      const removed = 'x'.repeat(4096);
      const added = 'z'.repeat(4096);
      const operations = [{ old_text: 'A', new_text: added }, { old_text: removed, new_text: '' }];
      assert.strictEqual(edit('A' + removed, operations, { maxBytes: 4096 }).markdown, added);
      assert.strictEqual(edit('A' + removed, operations.slice().reverse(), { maxBytes: 4096 }).markdown, added);
      const all = [{ old_text: 'a', new_text: 'bb', all: true }, { old_text: 'Z'.repeat(500), new_text: '' }];
      assert.strictEqual(edit('a'.repeat(100) + 'Z'.repeat(500), all, { maxBytes: 200 }).markdown, 'bb'.repeat(100));
      assert.strictEqual(edit('x'.repeat(100), [{ old_text: 'x', new_text: '', all: true }], { maxBytes: 0 }).markdown, '');
    });

    test('text edit result sizing accounts for surrogate pairs joined by deletion or separate edits', () => {
      assert.strictEqual(edit('\ud83dX\ude00', [{ old_text: 'X', new_text: '' }], { maxBytes: 4 }).markdown, '😀');
      rejects('file_too_large', () => edit('\ud83dX\ude00', [{ old_text: 'X', new_text: '' }], { maxBytes: 3 }));
      const operations = [{ old_text: 'A', new_text: '\ud83d' }, { old_text: 'B', new_text: '\ude00' }];
      assert.strictEqual(edit('AB', operations, { maxBytes: 4 }).markdown, '😀');
      rejects('file_too_large', () => edit('AB', operations, { maxBytes: 3 }));
      let seed = 31;
      function random(max) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; }
      const tokens = ['', 'a', 'é', '€', '😀', '\ud83d', '\ude00', '\ud83d\ud83d', '\ude00\ud83d'];
      for (let trial = 0; trial < 300; trial += 1) {
        const operations = ['A', 'B', 'C'].map(old_text => ({ old_text, new_text: tokens[random(tokens.length)] }));
        const expected = operations.map(operation => operation.new_text).join('');
        const bytes = Buffer.byteLength(expected);
        assert.strictEqual(edit('ABC', operations, { maxBytes: bytes }).markdown, expected);
        if (bytes) rejects('file_too_large', () => edit('ABC', operations, { maxBytes: bytes - 1 }));
      }
    });

    test('text edit all-match streams merge with ordinary edits and other original-base streams', () => {
      assert.strictEqual(edit('a b a b', [
        { old_text: 'a', new_text: 'x', all: true }, { old_text: 'b', new_text: 'y', all: true },
        { old_text: ' ', new_text: '', occurrence: 2 },
      ], { maxBytes: 6 }).markdown, 'x yx y');
      assert.strictEqual(edit('aa', [{ old_text: 'a', new_text: 'b', all: true },
        { op: 'prepend', text: '<' }, { op: 'append', text: '!' }], { maxBytes: 4 }).markdown, '<bb!');
      assert.strictEqual(edit('xa ya xa', [{ old_text: 'a', new_text: '$&', context_before: 'x', all: true }], { maxBytes: 10 }).markdown,
        'x$& ya x$&');
      rejects('overlapping_edits', () => edit('a b a b', [
        { old_text: 'a', new_text: 'x', all: true }, { old_text: 'a b', new_text: 'z', occurrence: 1 },
      ], { maxBytes: 20 }));
    });

    test('text edit rejects impossible expansion and handles ten million matches within a bounded heap', () => {
      const { execFileSync } = require('child_process');
      const modulePath = require.resolve('../cli/shared/sdocs-text-edit');
      const script = `
        const assert = require('assert');
        const engine = require(${JSON.stringify(modulePath)});
        const megabyte = 1024 * 1024;
        assert.throws(() => engine.applyEdits('a'.repeat(megabyte), {
          edits: [{ old_text: 'a', new_text: 'b'.repeat(megabyte), all: true }]
        }, { maxBytes: megabyte }), error => error.code === 'file_too_large');
        const count = 10 * megabyte;
        const result = engine.applyEdits('a'.repeat(count), {
          edits: [{ old_text: 'a', new_text: 'b', all: true }]
        }, { maxBytes: count });
        assert.strictEqual(result.markdown.length, count);
        assert.strictEqual(result.markdown, 'b'.repeat(count));
        assert.strictEqual(result.matched_count, count);
        assert.strictEqual(result.applied_edits[0].locations.length, 8);
        const mixed = engine.applyEdits('ab'.repeat(megabyte), { edits: [
          { old_text: 'a', new_text: 'x', all: true },
          { old_text: 'b', new_text: 'y', all: true }
        ] }, { maxBytes: 2 * megabyte });
        assert.strictEqual(mixed.markdown, 'xy'.repeat(megabyte));
      `;
      execFileSync(process.execPath, ['--max-old-space-size=96', '-e', script], { timeout: 15000, stdio: 'pipe' });
    });

    test('text edit line-dense allowed documents use a compact index for edits, outline and selection', () => {
      const { execFileSync } = require('child_process');
      const modulePath = require.resolve('../cli/shared/sdocs-text-edit');
      const script = `
        const assert = require('assert');
        const engine = require(${JSON.stringify(modulePath)});
        const maxBytes = 10 * 1024 * 1024;
        const blanks = maxBytes - 11;
        const markdown = '\\n'.repeat(blanks) + '# Tail\\nold\\n';
        const bodyLine = blanks + 2;
        const edited = engine.applyEdits(markdown, { edits: [
          { old_text: 'old', new_text: 'new', lines: bodyLine + ':' + bodyLine }
        ] }, { maxBytes });
        assert.strictEqual(edited.markdown.length, maxBytes);
        assert.strictEqual(edited.markdown.slice(-11), '# Tail\\nnew\\n');
        assert.strictEqual(edited.applied_edits[0].locations[0].start_line, bodyLine);
        global.gc();
        const entries = engine.outline(markdown);
        assert.strictEqual(entries.length, 1);
        assert.strictEqual(entries[0].path, 'Tail');
        assert.strictEqual(entries[0].start_line, blanks + 1);
        assert.strictEqual(entries[0].end_line, bodyLine);
        global.gc();
        const selected = engine.select(markdown, { section: 'Tail', lines: bodyLine + ':' + bodyLine });
        assert.strictEqual(selected.markdown, 'old\\n');
        assert.strictEqual(selected.total_lines, bodyLine);
      `;
      execFileSync(process.execPath, ['--max-old-space-size=96', '--expose-gc', '-e', script], { timeout: 20000, stdio: 'pipe' });
    });

    test('text edit compact line indexes preserve mixed Unicode lines across index chunks', () => {
      const lines = Array.from({ length: 5000 }, (_, index) => 'row ' + index + ' 😀' + (index % 2 ? '\r\n' : '\n'));
      lines[4095] = '# Boundary\r\n';
      lines[4096] = '## Child\n';
      const markdown = lines.join('');
      assert.strictEqual(textEdit.select(markdown, { lines: '4095:4098' }).markdown, lines.slice(4094, 4098).join(''));
      assert.deepStrictEqual(textEdit.outline(markdown).map(entry => [entry.path, entry.start_line, entry.end_line]),
        [['Boundary', 4096, 5000], ['Boundary > Child', 4097, 5000]]);
      const edited = edit(markdown, [{ old_text: 'row 4097 😀', new_text: 'changed', section: 'Boundary > Child', lines: '4098:4098' }]);
      assert.strictEqual(edited.applied_edits[0].locations[0].start_line, 4098);
      assert.strictEqual(textEdit.select(edited.markdown, { lines: '4098:4098' }).markdown, 'changed\r\n');
    });

    test('text patch verifies context and reanchors unique hunks when line numbers are stale', () => {
      const markdown = '# Added\nextra\n# Plan\nbefore\nold\nafter\n';
      const result = patch(markdown, '--- a/doc.md\n+++ b/doc.md\n@@ -2,3 +2,3 @@\n before\n-old\n+new\n after\n');
      assert.strictEqual(result.markdown, '# Added\nextra\n# Plan\nbefore\nnew\nafter\n');
      assert.strictEqual(result.applied_edits[0].locations[0].start_line, 4);
      assert.strictEqual(result.matched_count, 1);
    });

    test('text patch repeated context remains ambiguous even when the header names a matching line', () => {
      const markdown = '# One\nbefore\nold\nafter\n# Two\nbefore\nold\nafter\n';
      rejects('edit_ambiguous', () => patch(markdown, '@@ -2,3 +2,3 @@\n before\n-old\n+new\n after\n'), details => {
        assert.strictEqual(details.match_count, 2);
        assert.deepStrictEqual(details.candidates.map(entry => [entry.line, entry.section]), [[2, 'One'], [6, 'Two']]);
      });
      rejects('edit_no_match', () => patch(markdown, '@@ -2,3 +2,3 @@\n changed\n-old\n+new\n after\n'));
    });

    test('text patch multiple hunks read original context and can share unchanged lines', () => {
      const markdown = 'a\nb\nc\nd\n';
      const unified = '@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n@@ -2,3 +2,3 @@\n b\n-c\n+C\n d\n';
      assert.strictEqual(patch(markdown, unified).markdown, 'a\nB\nC\nd\n');
      rejects('overlapping_edits', () => patch(markdown, '@@ -1,2 +1,2 @@\n a\n-b\n+B\n@@ -2,2 +2,2 @@\n-b\n+Other\n c\n'));
    });

    test('text patch long repeated context finds the unique suffix and detects overlapping repeated patterns', () => {
      const markdown = Array(2000).fill('same').join('\n') + '\nunique\n';
      const unified = '@@ -1901,101 +1901,101 @@\n' + Array(100).fill(' same').join('\n') + '\n-unique\n+changed\n';
      assert.strictEqual(patch(markdown, unified).markdown, markdown.slice(0, -'unique\n'.length) + 'changed\n');
      rejects('edit_ambiguous', () => patch('a\nb\na\nb\na\n', '@@ -1,3 +1,3 @@\n a\n-b\n+B\n a\n'), details => {
        assert.strictEqual(details.match_count, 2);
        assert.deepStrictEqual(details.candidates.map(entry => entry.line), [1, 3]);
      });
      rejects('edit_ambiguous', () => patch(Array(25).fill('same\n').join(''), '@@ -1 +1 @@\n-same\n+changed\n'), details => {
        assert.strictEqual(details.match_count, 25);
        assert.strictEqual(details.candidates.length, 8);
        assert.strictEqual(details.candidates_truncated, true);
      });
    });

    test('text patch adds and deletes lines within unchanged context', () => {
      const unified = '@@ -1,4 +1,4 @@\n start\n-delete\n keep\n+insert\n end\n';
      assert.strictEqual(patch('start\ndelete\nkeep\nend\n', unified).markdown, 'start\nkeep\ninsert\nend\n');
      assert.strictEqual(patch('only\n', '@@ -1 +0,0 @@\n-only\n').markdown, '');
    });

    test('text patch supports empty-document, beginning and end insertions', () => {
      assert.strictEqual(patch('', '@@ -0,0 +1,2 @@\n+first\n+second\n').markdown, 'first\nsecond\n');
      assert.strictEqual(patch('last\n', '@@ -0,0 +1 @@\n+first\n').markdown, 'first\nlast\n');
      assert.strictEqual(patch('first\n', '@@ -1,0 +2 @@\n+last\n').markdown, 'first\nlast\n');
      rejects('invalid_patch', () => patch('one\ntwo\n', '@@ -1,0 +2 @@\n+inside\n'));
      rejects('invalid_patch', () => patch('unterminated', '@@ -1,0 +2 @@\n+last\n'));
    });

    test('text patch applies standard no-newline markers and deliberate newline changes', () => {
      assert.strictEqual(patch('old', '@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n').markdown, 'new');
      assert.strictEqual(patch('old', '@@ -1 +1,2 @@\n-old\n\\ No newline at end of file\n+old\n+last\n').markdown, 'old\nlast\n');
      assert.strictEqual(patch('old\n', '@@ -1 +1 @@\n-old\n+old\n\\ No newline at end of file\n').markdown, 'old');
      assert.strictEqual(patch('', '@@ -0,0 +1 @@\n+new\n\\ No newline at end of file\n').markdown, 'new');
      rejects('edit_no_match', () => patch('old', '@@ -1 +1 @@\n-old\n+new\n'));
    });

    test('text patch preserves CRLF and Unicode including unchanged replacement content', () => {
      assert.strictEqual(patch('α\r\nold 😀\r\nω\r\n', '@@ -1,3 +1,3 @@\n α\n-old 😀\n+new 東京\n ω\n').markdown,
        'α\r\nnew 東京\r\nω\r\n');
      const same = patch('α\r\nβ\r\n', '@@ -1,2 +1,2 @@\r\n α\r\n-β\r\n+β\r\n');
      assert.strictEqual(same.markdown, 'α\r\nβ\r\n');
      assert.strictEqual(same.applied_edits[0].changed_count, 0);
      assert.strictEqual(patch('one\r\ntwo\n', '@@ -1 +1 @@\n-one\n+one\n').markdown, 'one\r\ntwo\n');
    });

    test('text patch preserves explicit content CRLF and intentional newline conversions from diff output', () => {
      assert.strictEqual(patch('one\r\n', '--- a\n+++ b\n@@ -1 +1 @@\n-one\r\n+one\n').markdown, 'one\n');
      assert.strictEqual(patch('one\n', '--- a\n+++ b\n@@ -1 +1 @@\n-one\n+one\r\n').markdown, 'one\r\n');
      assert.strictEqual(patch('one\r\ntwo\n', '@@ -1,2 +1,2 @@\n-one\r\n+ONE\n two\n').markdown, 'ONE\ntwo\n');
      assert.strictEqual(patch('one\r', '@@ -1 +1 @@\n-one\r\n\\ No newline at end of file\n+two\r\n\\ No newline at end of file\n').markdown, 'two\r');
      assert.strictEqual(patch('', '@@ -0,0 +1 @@\n+one\r\n').markdown, 'one\r\n');
      const mixed = Array(10).fill('earlier\r\n').join('') + 'local1\nlocal2\nlocal3\n';
      assert.strictEqual(patch(mixed, '@@ -11,3 +11,4 @@\n local1\n local2\n local3\n+added\n').markdown, mixed + 'added\n');
    });

    test('text patch context-only and identical replacements are no-ops', () => {
      const unchanged = patch('one\ntwo\n', '@@ -1,2 +1,2 @@\n one\n two\n');
      assert.strictEqual(unchanged.markdown, 'one\ntwo\n');
      assert.strictEqual(unchanged.applied_edits[0].changed_count, 0);
      assert.strictEqual(patch('same\n', '@@ -1 +1 @@\n-same\n+same\n').markdown, 'same\n');
    });

    test('text patch shares the result-byte budget and accounts for deletions and unchanged hunks', () => {
      const added = 'z'.repeat(256);
      const removed = 'x'.repeat(256);
      const unified = '@@ -1,2 +1 @@\n-A\n-' + removed + '\n+' + added + '\n';
      assert.strictEqual(patch('A\n' + removed + '\n', unified, { maxBytes: 257 }).markdown, added + '\n');
      rejects('file_too_large', () => patch('A\n' + removed + '\n', unified, { maxBytes: 256 }));
      const noopThenDelete = '@@ -2 +2 @@\n-' + removed + '\n+' + removed + '\n' +
        '@@ -1,3 +1,2 @@\n keep\n-' + removed + '\n end\n';
      assert.strictEqual(patch('keep\n' + removed + '\nend\n', noopThenDelete, { maxBytes: 9 }).markdown, 'keep\nend\n');
    });

    test('text patch validates hunk counts, markers, headers and single-document shape', () => {
      for (const unified of ['', 'not a patch', '@@ -1,2 +1 @@\n-old\n+new\n', '@@ -1 +1 @@\n-old\n+new\n+extra\n',
        '@@ -0 +1 @@\n-old\n+new\n', '@@ -1,0 +1,0 @@\n', '--- a\n@@ -1 +1 @@\n-old\n+new\n',
        '@@ -1 +1 @@\n\\ No newline at end of file\n-old\n+new\n',
        '@@ -1,2 +1,2 @@\n-old\n\\ No newline at end of file\n-next\n+new\n+next\n',
        '@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n',
        '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n--- c\n+++ d\n@@ -1 +1 @@\n-old\n+new\n']) {
        rejects('invalid_patch', () => patch('old\nnext\n', unified));
      }
    });

    test('text patch a later unmatched hunk rejects the whole planned batch', () => {
      rejects('edit_no_match', () => patch('one\ntwo\n', '@@ -1 +1 @@\n-one\n+ONE\n@@ -2 +2 @@\n-missing\n+TWO\n'), details => {
        assert.strictEqual(details.operation_index, 1);
        assert.strictEqual(details.match_count, 0);
      });
    });
  };
};
