'use strict';
const data = require('../cli/shared/sdocs-comment-data');
const yaml = require('../cli/shared/sdocs-yaml');
const model = require('../lib/cloud-comments');
const merge = require('../lib/cloud-merge').mergeTargetRevision;
module.exports = function (h) {
  const { test, assert } = h;
  const note = { id: 'c1', kind: 'inline', quote: 'target', text: 'Check it.', author: 'Ana', at: '2026-10-01T00:00:00Z' };
  const actor = { display_name: 'Ben', user_id: 'ben' };
  test('thread mutations preserve the original note and round trip nested replies through the YAML subset', () => {
    const reply = data.mutateComment(note, { action: 'reply', text: 'Reply\nwith a second line.', actor, reply_id: 'rp_1', at: '2026-10-02T00:00:00Z' });
    assert.strictEqual(reply.text, note.text);
    assert.strictEqual(reply.author, note.author);
    assert.strictEqual(reply.at, note.at);
    assert.strictEqual(note.replies, undefined);
    const parsed = yaml.parseFrontMatter(yaml.serializeFrontMatter({ comments: [reply] }));
    assert.strictEqual(data.replies(parsed.meta.comments[0].replies)[0].text, 'Reply\nwith a second line.');
    for (const normalizer of [require('../public/sdocs-comments').normalizeComment, require('../public/sdocs-code-comments').normalize]) {
      const normalized = normalizer({ ...reply, kind: normalizer === require('../public/sdocs-comments').normalizeComment ? 'inline' : 'line', line: 0 });
      assert.strictEqual(data.replies(normalized.replies)[0].author_user_id, 'ben');
    }
  });
  test('simultaneous snapshot replies merge into a single comment rather than duplicate threads', () => {
    const before = yaml.serializeFrontMatter({ comments: [note] }) + '\nThe target.\n';
    const one = data.mutateComment(note, { action: 'reply', text: 'First.', actor, reply_id: 'rp_1', at: '2026-10-02T00:00:00Z' });
    const two = data.mutateComment(note, { action: 'reply', text: 'Second.', actor, reply_id: 'rp_2', at: '2026-10-02T00:00:01Z' });
    const current = yaml.serializeFrontMatter({ comments: [one] }) + '\nThe target.\n';
    const proposed = yaml.serializeFrontMatter({ comments: [two] }) + '\nThe target.\n';
    const result = model.snapshot(merge(before, current, proposed).markdown);
    assert.strictEqual(result.comments.length, 1);
    assert.deepStrictEqual(data.replies(result.comments[0].replies).map(r => r.text), ['First.', 'Second.']);
  });
  test('simultaneous reply and resolution preserve the discussion and resolved state', () => {
    const current = data.mutateComment(note, { action: 'reply', text: 'Context.', actor });
    const proposed = data.mutateComment(note, { action: 'resolve', actor });
    const result = data.mergeComment(note, current, proposed);
    assert.strictEqual(result.resolved, true);
    assert.strictEqual(data.replies(result.replies)[0].text, 'Context.');
    assert.ok(result.uid);
  });
  test('a genuine conflicting root note edit still preserves both comment versions', () => {
    const before = yaml.serializeFrontMatter({ comments: [note] }) + '\nThe target.\n';
    const current = yaml.serializeFrontMatter({ comments: [{ ...note, text: 'First interpretation.' }] }) + '\nThe target.\n';
    const proposed = yaml.serializeFrontMatter({ comments: [{ ...note, text: 'Second interpretation.' }] }) + '\nThe target.\n';
    const result = model.snapshot(merge(before, current, proposed).markdown);
    assert.strictEqual(result.comments.length, 2);
    assert.strictEqual(new Set(result.comments.map(c => c.id)).size, 2);
    assert.deepStrictEqual(result.comments.map(c => c.text), ['First interpretation.', 'Second interpretation.']);
  });
  test('comment-only serialization preserves body bytes and unrelated YAML comments, order and CRLF', () => {
    for (const eol of ['\n', '\r\n']) {
      const source = ['---', '# Keep this', 'title: "Unchanged: title"', 'custom: [one, two]', 'comments:', '  - id: c1', '    kind: inline', '    quote: target', '    text: Check', 'styles:', '  accent: "#abcdef"', '---', '', 'The target.', '', ''].join(eol);
      const state = model.snapshot(source);
      const changed = data.mutateComment(state.comments[0], { action: 'reply', text: 'Received.', actor });
      const result = model.write(state, [changed]);
      assert.ok(result.startsWith(['---', '# Keep this', 'title: "Unchanged: title"', 'custom: [one, two]'].join(eol) + eol));
      assert.ok(result.includes(['styles:', '  accent: "#abcdef"', '---', '', 'The target.', '', ''].join(eol)));
      assert.strictEqual(model.snapshot(result).body, state.body);
      assert.strictEqual(data.replies(model.snapshot(result).comments[0].replies)[0].text, 'Received.');
    }
  });
};
