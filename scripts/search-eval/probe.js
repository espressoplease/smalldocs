#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { createAdapter } = require('./adapter');
const { openFixture } = require('./fixture');
const { timingSummary } = require('./measure');
const assert = require('assert/strict');

const QUERIES = {
  broad: { field: 'text', match: 'term', value: 'operations' },
  rare: { field: 'text', match: 'term', value: 'quorumneedle' },
  phrase: { field: 'text', match: 'phrase', value: 'incident response' },
  prefix: { field: 'text', match: 'prefix', value: 'operat' },
};

function profileSql(database) {
  const groups = new Map();
  const prepare = database.prepare.bind(database);
  const exec = database.exec.bind(database);
  const normalize = (sql) => sql.replace(/cloud_search_scope_[0-9a-f]+/g, 'cloud_search_scope').replace(/\s+/g, ' ').trim();
  function observe(sql, operation, action) {
    const start = performance.now();
    try { return action(); }
    finally {
      const key = operation + ':' + normalize(sql);
      const existing = groups.get(key) || { operation, sql: normalize(sql), calls: 0, milliseconds: 0 };
      existing.calls += 1;
      existing.milliseconds += performance.now() - start;
      groups.set(key, existing);
    }
  }
  database.exec = (sql) => observe(sql, 'exec', () => exec(sql));
  database.prepare = (sql) => {
    const statement = observe(sql, 'prepare', () => prepare(sql));
    for (const method of ['all', 'get', 'run']) {
      const execute = statement[method].bind(statement);
      statement[method] = (...args) => observe(sql, method, () => execute(...args));
    }
    return statement;
  };
  return () => [...groups.values()].sort((a, b) => b.milliseconds - a.milliseconds)
    .map((group) => ({ ...group, milliseconds: Math.round(group.milliseconds * 100) / 100 }));
}

async function main() {
  let directory, output, kinds = ['broad', 'rare', 'phrase'], repetitions = 1, sql = false, tempMemory = false;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === '--fixture') directory = path.resolve(process.argv[++index]);
    else if (arg === '--output') output = path.resolve(process.argv[++index]);
    else if (arg === '--kinds') kinds = process.argv[++index].split(',');
    else if (arg === '--repetitions') repetitions = Number(process.argv[++index]);
    else if (arg === '--sql-profile') sql = true;
    else if (arg === '--temp-memory') tempMemory = true;
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!directory || !Number.isSafeInteger(repetitions) || repetitions < 1 || kinds.some((kind) => !QUERIES[kind])) {
    throw new Error('Usage: node scripts/search-eval/probe.js --fixture DIR [--kinds broad,rare,phrase,prefix] [--repetitions 1] [--sql-profile] [--output FILE]');
  }
  const before = process.memoryUsage();
  const openStart = performance.now();
  const context = openFixture(directory, { omitCorpus: true });
  if (tempMemory) context.store.db.pragma('temp_store = MEMORY');
  const opened = process.memoryUsage();
  const adapter = createAdapter(context);
  const sqlReport = sql ? profileSql(context.store.db) : null;
  const report = { fixture: directory, document_count: context.documentCount,
    description: 'Existing encrypted fixture, no seeding and no in-memory corpus/oracle generation',
    store_open_ms: Math.round((performance.now() - openStart) * 100) / 100,
    temp_store: context.store.db.pragma('temp_store', { simple: true }),
    before, after_open: opened, queries: [] };
  try {
    for (const kind of kinds) {
      const values = [];
      let result;
      for (let index = 0; index < repetitions; index += 1) {
        const start = performance.now();
        result = await adapter.search(adapter.requestFor({ expression: QUERIES[kind] }));
        values.push(performance.now() - start);
      }
      const measurement = { kind, ...timingSummary(values), total_count: result.total_count,
        first_query_ms: Math.round(values[0] * 100) / 100,
        samples_ms: values.map((value) => Math.round(value * 100) / 100),
        returned_documents: result.documents.length, memory: process.memoryUsage() };
      if (context.allVisible) {
        const count = context.documentCount;
        const expected = kind === 'rare' ? Math.ceil(count / 997)
          : kind === 'phrase' ? Math.ceil(count / 8) + 1 : count;
        assert.equal(result.total_count, expected, `${kind}: optimization changed the expected matching set`);
        assert.equal(result.facets.authors.reduce((sum, row) => sum + row.document_count, 0), expected);
        assert.equal(result.facets.libraries.reduce((sum, row) => sum + row.document_count, 0), expected);
        measurement.expected_total = expected;
      }
      report.queries.push(measurement);
      process.stderr.write(`${kind}: median ${measurement.median_ms} ms, ${result.total_count} matches\n`);
    }
    if (sqlReport) report.sql = sqlReport();
    report.peak_rss_bytes = process.resourceUsage().maxRSS * 1024;
    if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } finally { context.close(); }
}

if (require.main === module) main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
module.exports = { profileSql };
