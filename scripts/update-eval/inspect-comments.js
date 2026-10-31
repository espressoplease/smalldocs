'use strict';
const fs = require('fs');
const path = require('path');
const comments = require('../../lib/cloud-comments');
const threads = require('../../cli/shared/sdocs-comment-data');

async function inspect(root, ids) {
  const control = JSON.parse(fs.readFileSync(path.join(root, 'control.json'), 'utf8'));
  const summaries = [];
  for (const id of ids) {
    const response = await fetch(control.origin + '/inspect', { method: 'POST',
      headers: { Authorization: 'Bearer ' + control.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: id }) });
    if (!response.ok) throw new Error('Cannot inspect ' + id + ': ' + response.status);
    const result = await response.json();
    fs.writeFileSync(path.join(root, id + '-comment-result.json'), JSON.stringify(result, null, 2));
    const state = comments.snapshot(result.current.markdown);
    const untouched = ['review', 'revoked'].includes(id);
    let expected = comments.snapshot(result.oracle.initial_markdown).body;
    if (!untouched) expected = expected.replace('Production retry window: 10 minutes.', 'Production retry window: ' + result.oracle.approved + ' minutes.');
    if (result.injected && result.interference === 'independent') expected += '\nOperator note: page the on-call lead before disabling retries.\n';
    const note = key => comments.canonical(state.comments.find(comment => comment.id === key) || {});
    const bodyExpected = state.body === expected;
    const originalNotes = result.oracle.comments;
    const preserved = originalNotes.every(original => {
      const current = note(original.id);
      const expectedResolved = original.id === 'c1' && !untouched ? true : Boolean(comments.canonical(original).resolved);
      return current.id === original.id && current.text === original.text && current.author === original.author && Boolean(current.resolved) === expectedResolved;
    });
    summaries.push({ id, expected_body: bodyExpected, notes_preserved: preserved,
      exact_untouched_document: untouched ? result.current.markdown === result.oracle.initial_markdown : null,
      decoys_unchanged: result.decoys_unchanged, comment_count: state.comments.length,
      c1_quote: note('c1').quote, c1_resolved: Boolean(note('c1').resolved),
      c4_open: !note('c4').resolved, c4_replies: threads.replies(note('c4').replies).length,
      source_anchor: comments.project(result.current, 'http://fixture.invalid', { comments: [note('c1')], context: 'none' }).comments[0].anchor.match_status,
      injected: result.injected, revisions: result.revisions.length,
      commands: result.commands.length,
      full_reads: result.commands.filter(command => command.args[1] === 'read' && !command.args.some(arg => ['--section', '--lines', '--outline'].includes(arg))).length,
      output_bytes: result.commands.reduce((sum, command) => sum + Buffer.byteLength(JSON.stringify(command.result || command.stdout || '')), 0),
      errors: result.commands.filter(command => command.result && command.result.ok === false).map(command => command.result.error),
    });
  }
  return summaries;
}
if (require.main === module) inspect(process.argv[2], process.argv.slice(3)).then(value => console.log(JSON.stringify(value, null, 2)))
  .catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { inspect };
