'use strict';

// Seeded combinations exercise Boolean composition. Every leaf is paired with a
// fact predicate, so neither parsing nor tokenization is used to compute truth.
function generatedScenarios(count, seed) {
  let state = seed == null ? 481516 : seed;
  function random(maximum) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) % maximum;
  }
  const atoms = [
    { expression: { field: 'text', match: 'term', value: 'incident' }, matches: (d) => d.topic === 'incident' || d.special === 'quotes' },
    { expression: { field: 'text', match: 'term', value: 'release' }, matches: (d) => d.topic === 'release' },
    { expression: { field: 'text', match: 'term', value: 'Lisbon' }, matches: (d) => d.region === 'lisbon' },
    { expression: { field: 'text', match: 'term', value: 'approved' }, matches: (d) => d.stage === 'approved' },
    { expression: { field: 'tags', match: 'term', value: 'draft' }, matches: (d) => d.stage === 'draft' },
    { expression: { field: 'body', match: 'term', value: 'quorumneedle' }, matches: (d) => d.rare },
    { expression: { field: 'title', match: 'term', value: 'headlinebeacon' }, matches: (d) => d.titleMarker },
    { expression: { field: 'filename', match: 'term', value: 'pathbeacon' }, matches: (d) => d.fileMarker },
    { expression: { field: 'text', match: 'phrase', value: 'release readiness' }, matches: (d) => d.topic === 'release' },
  ];
  function expression(depth) {
    if (!depth || random(4) === 0) return atoms[random(atoms.length)];
    const left = expression(depth - 1);
    if (random(4) === 0) {
      return { expression: { op: 'not', clause: left.expression }, matches: (d) => !left.matches(d) };
    }
    const right = expression(depth - 1);
    if (random(2)) return { expression: { op: 'and', clauses: [left.expression, right.expression] },
      matches: (d) => left.matches(d) && right.matches(d) };
    return { expression: { op: 'or', clauses: [left.expression, right.expression] },
      matches: (d) => left.matches(d) || right.matches(d) };
  }
  return Array.from({ length: count }, (_, ordinal) => {
    const result = expression(3);
    return { id: `generated-${String(ordinal + 1).padStart(3, '0')}`, ...result,
      query: JSON.stringify(result.expression) };
  });
}

module.exports = { generatedScenarios };
