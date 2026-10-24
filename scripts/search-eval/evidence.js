'use strict';

const assert = require('assert/strict');

// These are literal witnesses from the corpus recipe, not production tokens.
// The exceptional forms are deliberately enumerated so changing a tokenizer
// cannot silently redefine the evidence this evaluator accepts.
function witnesses(leaf) {
  if (leaf.match === 'prefix' && leaf.value === 'helios') return ['helios', 'heliosphere'];
  if (leaf.match === 'prefix' && leaf.value === 'operat') return ['Operations'];
  if (leaf.value === 'café') return ['café', 'cafe\u0301'];
  if (leaf.value === 'node.js') return ['node.js', 'node js'];
  if (leaf.value === 'silver compass') return ['silver\n\ncompass'];
  return [leaf.value];
}

function positiveLeaves(expression, negative, result) {
  result = result || [];
  if (!expression) return result;
  if (expression.op === 'not') return positiveLeaves(expression.clause, !negative, result);
  if (expression.clauses) {
    for (const clause of expression.clauses) positiveLeaves(clause, negative, result);
  } else if (!negative) result.push(expression);
  return result;
}

function literalSpans(source, literal) {
  const spans = [];
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const match of source.matchAll(new RegExp(escaped, 'giu'))) {
    const start = match.index;
    const end = start + match[0].length;
    if (/[\p{L}\p{N}\p{M}_]$/u.test(source.slice(0, start)) ||
        /^[\p{L}\p{N}\p{M}_]/u.test(source.slice(end))) continue;
    spans.push({ start, end });
  }
  return spans;
}

function allowedSpans(source, field, scenario) {
  if (scenario.fields && !scenario.fields.includes(field)) return [];
  const spans = [];
  for (const leaf of positiveLeaves(scenario.expression)) {
    if (leaf.field !== 'text' && leaf.field !== field) continue;
    for (const literal of witnesses(leaf)) spans.push(...literalSpans(source, literal));
  }
  // A phrase and one of its terms may share one highlight. Accept the union of
  // overlapping literal witnesses as well as each original literal witness.
  const merged = [];
  for (const span of spans.slice().sort((a, b) => a.start - b.start || b.end - a.end)) {
    const previous = merged[merged.length - 1];
    if (previous && span.start < previous.end) previous.end = Math.max(previous.end, span.end);
    else merged.push({ ...span });
  }
  return spans.concat(merged);
}

function assertEvidence(document, truth, scenario) {
  const id = scenario.id;
  const sources = { title: truth.title, filename: truth.filename,
    tags: truth.tags.join(' '), body: truth.markdown };
  const expected = Object.fromEntries(Object.entries(sources)
    .map(([field, source]) => [field, allowedSpans(source, field, scenario)]));
  assert.ok(Array.isArray(document.matches), `${id}: missing evidence array`);
  const hasWitness = Object.values(expected).some((spans) => spans.length);
  if (hasWitness) assert.ok(document.matches.length, `${id}: positive source evidence is missing`);
  else assert.deepEqual(document.matches, [], `${id}: evidence has no positive query witness`);
  let highlights = 0;
  for (const match of document.matches) {
    assert.ok(Object.hasOwn(sources, match.field), `${id}: unknown snippet field`);
    assert.equal(typeof match.snippet, 'string', `${id}: snippet is not text`);
    assert.ok(match.snippet.length, `${id}: empty snippet`);
    assert.ok(Array.isArray(match.offsets) && match.offsets.length, `${id}: snippet has no highlights`);
    assert.ok(Array.isArray(match.terms), `${id}: snippet has no terms array`);
    for (const offset of match.offsets) {
      assert.ok(Number.isSafeInteger(offset.start) && Number.isSafeInteger(offset.end) &&
        offset.start >= 0 && offset.end > offset.start && offset.end <= match.snippet.length,
      `${id}: snippet highlight is outside the returned text`);
    }
    assert.deepEqual(new Set(match.terms), new Set(match.offsets.map((offset) =>
      match.snippet.slice(offset.start, offset.end))), `${id}: reported terms differ from highlighted source text`);
    const source = sources[match.field];
    const firstHit = Math.min(...match.offsets.map((offset) => offset.start));
    let sourceStart = source.indexOf(match.snippet);
    let found = false;
    while (sourceStart >= 0) {
      const correctSpans = match.offsets.every((offset) => expected[match.field].some((span) =>
        span.start === sourceStart + offset.start && span.end === sourceStart + offset.end));
      const correctLine = match.field === 'body'
        ? source.slice(0, sourceStart + firstHit).split('\n').length === match.line : match.line === null;
      if (correctSpans && correctLine) found = true;
      sourceStart = source.indexOf(match.snippet, sourceStart + 1);
    }
    assert.ok(found, `${id}: snippet, source line, or highlight lacks an authorized positive query witness`);
    highlights += match.offsets.length;
  }
  return { documents: 1, documents_with_positive_evidence: hasWitness ? 1 : 0,
    snippets: document.matches.length, highlights };
}

module.exports = { allowedSpans, assertEvidence, literalSpans, positiveLeaves, witnesses };
