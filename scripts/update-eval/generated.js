'use strict';
// Deterministic property checks independent of diff hunk placement.
const assert = require('assert');
const { compare, diffEdits } = require('../../cli/shared/sdocs-text-diff');
const { mergeTargetRevision } = require('../../lib/cloud-merge');
let seed = 192837;
const random = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
for (let i = 0; i < 1000; i += 1) {
  const base = Array.from({ length: random(25) }, () => String(random(9)) + '\n');
  const after = base.slice();
  for (let j = 0; j < 4; j += 1) after.splice(random(after.length + 1), random(3), String(random(9)) + '\n');
  const actual = base.slice();
  for (const edit of diffEdits(base, after).slice().reverse()) actual.splice(edit.start, edit.end - edit.start, ...edit.lines);
  assert.deepStrictEqual(actual, after);
  assert.strictEqual(compare(base.join(''), after.join('')).changed, base.join('') !== after.join(''));
}
for (let i = 0; i < 300; i += 1) {
  const base = 'A ' + i + '\n\nB ' + i + '\n\nC ' + i + '\n';
  const human = base.replace('A ' + i, 'human ' + i), agent = base.replace('C ' + i, 'agent ' + i);
  assert.strictEqual(mergeTargetRevision(base, human, agent).markdown,
    base.replace('A ' + i, 'human ' + i).replace('C ' + i, 'agent ' + i));
}
console.log(JSON.stringify({ passed: true, seed: 192837, diff_reconstruction_cases: 1000, independent_merge_cases: 300 }));
