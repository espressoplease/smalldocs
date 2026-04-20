/**
 * Test orchestrator for sdocs-dev
 * Usage: node test/run.js
 *
 * Requires all test groups and runs them in sequence.
 */

const harness = require('./runner');

// ── Unit test groups (synchronous) ──────────────────
require('./test-yaml')(harness);
require('./test-shapes')(harness);
require('./test-styles')(harness);
require('./test-cli')(harness);
require('./test-slugify')(harness);
require('./test-base64')(harness);
require('./test-files')(harness);
require('./test-chart-replace')(harness);
require('./test-mermaid')(harness);
require('./test-analytics')(harness);
require('./test-short-links')(harness);
require('./test-chrome')(harness);
require('./test-comments')(harness);
require('./test-agent-block')(harness);

// ── HTTP tests (async, starts server) ──────────────
const runHttp = require('./test-http')(harness);
const runCacheBust = require('./test-cache-bust')(harness);

(async () => {
  await runHttp();
  await runCacheBust();
  harness.report();
})().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
