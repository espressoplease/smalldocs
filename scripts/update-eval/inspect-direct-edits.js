'use strict';
// Run outside agent workspaces. Fixtures retain all evaluation answers here.
const fs = require('fs');
const path = require('path');
const yaml = require('../../cli/shared/sdocs-yaml');
async function inspect(root, ids, options = {}) {
  const control = JSON.parse(fs.readFileSync(path.join(root, 'control.json'), 'utf8'));
  const summaries = [];
  for (const id of ids) {
    const response = await fetch(control.origin + '/inspect', { method: 'POST',
      headers: { Authorization: 'Bearer ' + control.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: id }) });
    if (!response.ok) throw new Error('Cannot inspect ' + id + ': ' + response.status);
    const result = await response.json();
    fs.writeFileSync(path.join(root, id + '-result.json'), JSON.stringify(result, null, 2));
    let expected = result.oracle.initial_markdown;
    const saved = !['review', 'revoked'].includes(id);
    if (saved) expected = expected.replace(/Maximum retry window: \d+ minutes\./,
      'Maximum retry window: ' + result.oracle.intended_limit + ' minutes.');
    if (id === 'targeted' && result.commands.some(command => command.result &&
      command.result.diff && command.result.diff.added_lines === 2)) expected = expected.replace('180 seconds', '240 seconds');
    if (result.injected && result.interference === 'independent') expected += '\nOperator note: page the on-call lead before disabling retries.\n';
    if (result.injected && result.interference === 'overlap') expected += '\nSecurity owner note: the revised cap needs a joint review.\n';
    if (options.keepOverlaps && result.injected && result.interference === 'overlap') {
      const old = /Maximum retry window: (\d+) minutes\./.exec(result.oracle.initial_markdown);
      expected = expected.replace('Maximum retry window: ' + result.oracle.intended_limit + ' minutes.',
        'Maximum retry window: ' + (Number(old[1]) + 3) + ' minutes.\nMaximum retry window: ' + result.oracle.intended_limit + ' minutes.');
    }
    const before = yaml.parseFrontMatter(expected), after = yaml.parseFrontMatter(result.current.markdown);
    const results = result.commands.map(command => command.result).filter(Boolean);
    summaries.push({ id, exact_expected_markdown: expected === result.current.markdown,
      expected_body: before.body === after.body,
      metadata_preserved: JSON.stringify(before.meta) === JSON.stringify(after.meta),
      decoys_unchanged: result.decoys_unchanged,
      revisions: result.revisions.length,
      commands: result.commands.length,
      output_bytes: result.commands.reduce((sum, command) => sum + Buffer.byteLength(JSON.stringify(command.result || command.stdout || '')), 0),
      partial_reads: results.filter(value => value.command === 'cloud.read' && value.selection).length,
      errors: results.filter(value => value.ok === false).map(value => value.error),
      overlap_receipts: results.filter(value => value.overlapping_edits_preserved).length,
      injected: result.injected,
    });
  }
  return summaries;
}
if (require.main === module) inspect(process.argv[2], process.argv.slice(3).filter(id => id !== '--keep-overlaps'),
  { keepOverlaps: process.argv.includes('--keep-overlaps') }).then(result => {
  console.log(JSON.stringify(result, null, 2));
}).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { inspect };
