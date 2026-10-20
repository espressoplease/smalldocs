'use strict';

const assert = require('assert/strict');
const { USERS, createCorpus, defaultMemberships, expectedDocuments, expectedFacets, visible } = require('./corpus');
const { scenarios } = require('./scenarios');
const { retrieval, timingSummary } = require('./measure');
const { assertEvidence } = require('./evidence');

function evidenceChecks(corpus) {
  const makeMatch = (truth, field, literal) => {
    const source = field === 'body' ? truth.markdown : field === 'tags' ? truth.tags.join(' ') : truth[field];
    const offset = source.indexOf(literal);
    assert.ok(offset >= 0, 'Oracle witness must be present in its fixture source');
    return { field, line: field === 'body' ? source.slice(0, offset).split('\n').length : null,
      snippet: literal, terms: [literal], offsets: [{ start: 0, end: literal.length }] };
  };
  const truth = corpus[0];
  const scenario = { id: 'evidence-oracle', expression: { field: 'body', match: 'term', value: 'operations' } };
  const match = makeMatch(truth, 'body', 'Operations');
  const valid = { matches: [match] };
  assert.deepEqual(assertEvidence(valid, truth, scenario), {
    documents: 1, documents_with_positive_evidence: 1, snippets: 1, highlights: 1,
  });
  const rejects = [
    [{}, truth, scenario],
    [{ matches: [] }, truth, scenario],
    [{ matches: [{ ...match, offsets: [] }] }, truth, scenario],
    [{ matches: [{ ...match, line: match.line + 1 }] }, truth, scenario],
    [{ matches: [{ ...match, terms: ['invented'] }] }, truth, scenario],
    [{ matches: [{ ...match, snippet: 'invented', terms: ['invented'] }] }, truth, scenario],
    [{ matches: [makeMatch(truth, 'body', 'checkpoint')] }, truth, scenario],
    [{ matches: [makeMatch(truth, 'body', 'perations')] }, truth, scenario],
    [{ matches: [makeMatch(truth, 'title', 'incident')] }, truth, scenario],
    [valid, truth, { ...scenario, fields: ['title'] }],
    [valid, truth, { ...scenario, expression: { op: 'not', clause: scenario.expression } }],
    [valid, { ...truth, markdown: '# A different authorized source\n' }, scenario],
  ];
  for (const args of rejects) assert.throws(() => assertEvidence(...args), assert.AssertionError);
  const positives = [
    [corpus[2], 'café', 'café', 'term'],
    [corpus[3], 'café', 'cafe\u0301', 'term'],
    [corpus[0], 'node.js', 'node.js', 'phrase'],
    [corpus[1], 'node.js', 'node js', 'phrase'],
    [corpus[10], 'silver compass', 'silver\n\ncompass', 'phrase'],
    [corpus[9], 'helios', 'heliosphere', 'prefix'],
  ];
  for (const [source, value, literal, kind] of positives) {
    assertEvidence({ matches: [makeMatch(source, 'body', literal)] }, source,
      { id: 'literal-witness-oracle', expression: { field: 'body', match: kind, value } });
  }
  const negative = { ...scenario, expression: { op: 'not', clause: scenario.expression } };
  assertEvidence({ matches: [] }, truth, negative);
  assertEvidence(valid, truth, { ...scenario, expression: { op: 'not', clause: negative.expression } });
  return { accepted_source_cases: positives.length + 3, rejected_mutation_cases: rejects.length };
}

function main() {
  const corpus = createCorpus(160);
  const context = { memberships: defaultMemberships() };
  const ids = (scenario) => expectedDocuments(corpus, scenario, context).map((d) => d.ordinal);
  const cases = new Map(scenarios(corpus).map((scenario) => [scenario.id, scenario]));
  assert.deepEqual(ids(cases.get('rare-current-content')), [0]);
  assert.deepEqual(ids(cases.get('phrase-order')), [0, 6, 8, 32, 72, 120, 128, 136]);
  assert.deepEqual(ids(cases.get('negative-hidden-body')), []);
  assert.deepEqual(ids(cases.get('outsider')), []);
  assert.deepEqual(ids(cases.get('unicode-canonical')), [2, 3]);
  assert.deepEqual(ids(cases.get('prefix')), [8, 9]);
  assert.equal(visible({ ...corpus[0], permission: 'private' }, USERS.reader, context.memberships), false);
  assert.equal(visible({ ...corpus[0], workspace: 'closed' }, USERS.reader, context.memberships), false);
  assert.equal(visible({ ...corpus[0], permission: 'private' }, corpus[0].author, context.memberships), true);
  assert.equal(visible({ ...corpus[0], deleted: true }, corpus[0].author, context.memberships), false);
  assert.equal(visible({ ...corpus[0], permission: 'private' }, USERS.owner, context.memberships), false);
  const facets = expectedFacets([corpus[0], corpus[8]]);
  assert.equal(facets.tags.get('incident'), 2);
  assert.equal(facets.tags.get('lisbon'), 1);
  assert.equal(facets.tags.get('berlin'), 1);
  assert.deepEqual(retrieval(['a', 'a', 'wrong'], ['a', 'missed']), {
    expected: 2, actual: 2, true_positives: 1, precision: 0.5, recall: 0.5,
    duplicate_count: 1, false_positives: ['wrong'], false_negatives: ['missed'],
  });
  assert.equal(timingSummary([1, 2, 3, 4, 100]).p95_ms, 100);
  const evidence = evidenceChecks(corpus);
  console.log('Search evaluation oracle checks passed');
  return { pass: true, evidence };
}

if (require.main === module) {
  const report = main();
  const output = process.argv.indexOf('--output');
  if (output >= 0) require('fs').writeFileSync(process.argv[output + 1], JSON.stringify(report, null, 2) + '\n');
}
module.exports = { evidenceChecks, main };
