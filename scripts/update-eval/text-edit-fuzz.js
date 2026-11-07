'use strict';
// Reproducible differential checks, separate from the short regression suite.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const engine = require('../../cli/shared/sdocs-text-edit');
let seed = 28741;
const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
const vocabulary = ['alpha', 'beta', 'repeat', 'repeat', 'cafe', '🐟', '東京', ''];
function document() {
  return Array.from({ length: 1 + random(30) }, () => vocabulary[random(vocabulary.length)] +
    (random(5) === 0 ? '\r\n' : '\n')).join('');
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-direct-edit-fuzz-'));
let exact = 0, patches = 0, ambiguous = 0;
try {
  for (let i = 0; i < 1000; i++) {
    const source = document();
    const start = random(source.length);
    const old = source.slice(start, start + 1 + random(Math.min(10, source.length - start)));
    const replacement = vocabulary[random(vocabulary.length)];
    const positions = [];
    for (let at = source.indexOf(old); at !== -1; at = source.indexOf(old, at + 1)) positions.push(at);
    const occurrence = 1 + random(positions.length);
    const position = positions[occurrence - 1];
    const request = { edits: [{ old_text: old, new_text: replacement, occurrence }] };
    const expected = source.slice(0, position) + replacement + source.slice(position + old.length);
    assert.strictEqual(engine.applyEdits(source, request).markdown, expected);
    const bytes = Buffer.byteLength(expected);
    assert.strictEqual(engine.applyEdits(source, request, { maxBytes: bytes }).markdown, expected);
    if (bytes) assert.throws(() => engine.applyEdits(source, request, { maxBytes: bytes - 1 }),
      error => error.code === 'file_too_large');
    exact++;
  }
  for (let i = 0; i < 300; i++) {
    const before = document(), after = document();
    fs.writeFileSync(path.join(dir, 'before.md'), before);
    fs.writeFileSync(path.join(dir, 'after.md'), after);
    const diff = spawnSync('diff', ['-u', path.join(dir, 'before.md'), path.join(dir, 'after.md')], { encoding: 'utf8' });
    if (diff.error || diff.status > 1) throw diff.error || new Error(diff.stderr);
    if (!diff.stdout) continue;
    try {
      assert.strictEqual(engine.applyEdits(before, { patch: diff.stdout }).markdown, after);
      assert.strictEqual(engine.applyEdits(before, { patch: diff.stdout }, { maxBytes: Buffer.byteLength(after) }).markdown, after);
      patches++;
    } catch (error) {
      // Repeated context must refuse rather than trusting a guessed line offset.
      if (error.code !== 'edit_ambiguous') throw error;
      ambiguous++;
    }
  }
  console.log(JSON.stringify({ seed: 28741, exact_replacements: exact, exact_patches: patches, ambiguous_patches_refused: ambiguous }));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
