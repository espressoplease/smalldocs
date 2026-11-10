'use strict';

const assert = require('assert/strict');
const { performance } = require('perf_hooks');

function retrieval(actualIds, expectedIds) {
  const expected = new Set(expectedIds);
  const actual = new Set(actualIds);
  const truePositives = [...actual].filter((id) => expected.has(id)).length;
  const falsePositives = [...actual].filter((id) => !expected.has(id));
  const falseNegatives = [...expected].filter((id) => !actual.has(id));
  return { expected: expected.size, actual: actual.size, true_positives: truePositives,
    precision: actual.size ? truePositives / actual.size : expected.size ? 0 : 1,
    recall: expected.size ? truePositives / expected.size : 1,
    duplicate_count: actualIds.length - actual.size,
    false_positives: falsePositives.slice(0, 10), false_negatives: falseNegatives.slice(0, 10) };
}

function percentile(values, fraction) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] || 0;
}

function timingSummary(values) {
  return { samples: values.length, minimum_ms: Math.round(Math.min(...values) * 100) / 100,
    median_ms: Math.round(percentile(values, 0.5) * 100) / 100,
    p95_ms: Math.round(percentile(values, 0.95) * 100) / 100,
    maximum_ms: Math.round(Math.max(...values) * 100) / 100 };
}

async function timed(operation) {
  const start = performance.now();
  const result = await operation();
  return { result, milliseconds: performance.now() - start };
}

function assertPerfectRetrieval(measurement, id) {
  assert.equal(measurement.precision, 1, `${id}: unauthorized or irrelevant results: ${measurement.false_positives}`);
  assert.equal(measurement.recall, 1, `${id}: missed documents: ${measurement.false_negatives}`);
  assert.equal(measurement.duplicate_count, 0, `${id}: repeated documents across pages`);
}

module.exports = { assertPerfectRetrieval, percentile, retrieval, timed, timingSummary };
