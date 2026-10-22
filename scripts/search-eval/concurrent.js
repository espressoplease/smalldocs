#!/usr/bin/env node
'use strict';
// Fresh workers separate search memory from fixture generation and index backfill.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { spawn } = require('child_process');
const { performance } = require('perf_hooks');
const { openFixture } = require('./fixture');
const { USERS } = require('./corpus');
const { timingSummary } = require('./measure');

async function worker(directory, concurrency, kind, rounds = 1) {
  const context = openFixture(directory, { keep: true, omitCorpus: true });
  const store = context.store;
  assert.equal(store.searchIndexStatus({}).ready, true, 'Backfill before measuring search');
  const before = process.memoryUsage();
  const decrypt = store._decryptRevision.bind(store);
  const projectKey = store._projectKey.bind(store);
  // Yield at key-provider boundaries so concurrent requests actually overlap.
  // This models asynchronous I/O, without claiming to measure managed KMS.
  store._projectKey = async (...args) => { await new Promise(setImmediate); return projectKey(...args); };
  let decryptions = 0, active = 0, peakActive = 0;
  store._decryptRevision = async (...args) => { decryptions++; return decrypt(...args); };
  const request = { userId: USERS.reader, workspaceIds: Object.values(context.workspaces),
    limit: 20, facets: ['tags', 'authors', 'libraries'], matchLimit: 2 };
  if (kind === 'rare-literal') request.query = 'quorumneedle';
  if (kind === 'broad-literal') request.query = 'operat';
  if (kind === 'broad-word') request.expression = { field: 'text', match: 'term', value: 'operations' };
  if (kind === 'phrase-literal') request.query = 'incident response';
  if (kind === 'phrase') request.expression = { field: 'text', match: 'phrase', value: 'incident response' };
  if (kind === 'absent-literal') request.query = 'unfindable-canary-769941';
  const expected = kind === 'rare-literal' ? Math.ceil(context.documentCount / 997)
    : kind === 'absent-literal' ? 0 : ['phrase', 'phrase-literal'].includes(kind) ? Math.ceil(context.documentCount / 8) + 1 : context.documentCount;
  const started = performance.now();
  const latencies = [];
  try {
    const memorySamples = [];
    for (let round = 0; round < rounds; round++) {
    await Promise.all(Array.from({ length: concurrency }, async () => {
      active++; peakActive = Math.max(peakActive, active);
      const start = performance.now();
      try {
        const result = kind === 'tags' ? await store.listTags(request) : await store.searchPage(request);
        if (kind === 'tags') assert.ok(result.length > 0);
        else {
          assert.equal(result.total_count, expected);
          assert.equal(result.documents.length, Math.min(expected, request.limit));
          assert.equal(new Set(result.documents.map(doc => doc.id)).size, result.documents.length);
          assert.equal(result.facets.authors.reduce((sum, row) => sum + row.document_count, 0), expected);
          assert.equal(result.facets.libraries.reduce((sum, row) => sum + row.document_count, 0), expected);
        }
      } finally { latencies.push(performance.now() - start); active--; }
    }));
    memorySamples.push(process.memoryUsage());
    }
    const expectedDecryptions = kind === 'tags' || kind === 'absent-literal' ? 0
      : kind === 'phrase-literal' ? concurrency * (expected + Math.min(expected, request.limit)) : concurrency * Math.min(expected, request.limit);
    assert.equal(decryptions, expectedDecryptions * rounds);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM sqlite_temp_master WHERE name LIKE 'cloud_search_scope_%'").get().n, 0);
    return { kind, concurrency, rounds, memory_samples: memorySamples, peak_active_requests: peakActive, document_count: context.documentCount,
      expected_matches_per_request: kind === 'tags' ? null : expected, decryption_count: decryptions,
      elapsed_ms: Math.round(performance.now() - started), ...timingSummary(latencies),
      before, after: process.memoryUsage(), peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
      scope: 'One process and SQLite connection; all fixture documents authorized; asynchronous local key provider; no corpus in JS' };
  } finally { context.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const directory = args[args.indexOf('--fixture') + 1];
  if (!directory || directory === '--fixture') throw new Error('Usage: concurrent.js --fixture DIR [--output FILE]');
  if (args.includes('--worker')) {
    const report = await worker(directory, Number(args[args.indexOf('--concurrency') + 1]), args[args.indexOf('--kind') + 1], args.includes('--rounds') ? Number(args[args.indexOf('--rounds') + 1]) : 1);
    process.stdout.write(JSON.stringify(report) + '\n'); return;
  }
  const output = args.includes('--output') ? path.resolve(args[args.indexOf('--output') + 1]) : null;
  const reports = [];
  for (const kind of (args.includes('--kinds') ? args[args.indexOf('--kinds') + 1].split(',') : ['rare-literal', 'absent-literal', 'broad-word', 'phrase', 'tags', 'broad-literal', 'phrase-literal'])) {
    for (const concurrency of [1, 4, 8]) {
      const report = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [__filename, '--fixture', directory, '--worker', '--concurrency', String(concurrency), '--kind', kind], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', reject);
        child.on('exit', code => { if (code) reject(new Error(stderr || stdout)); else { try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); } } });
      });
      reports.push(report);
      process.stderr.write(`${kind} x${concurrency}: ${Math.round(report.peak_rss_bytes / 1048576)} MiB peak, ${report.elapsed_ms} ms, ${report.decryption_count} decryptions\n`);
      if (output) fs.writeFileSync(output, JSON.stringify({ runtime: process.version, fixture: directory, results: reports }, null, 2) + '\n');
    }
  }
  process.stdout.write(JSON.stringify({ runtime: process.version, fixture: directory, results: reports }, null, 2) + '\n');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { worker };
