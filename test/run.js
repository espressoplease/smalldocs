/**
 * Test orchestrator for sdocs-dev
 * Usage: node test/run.js
 *
 * Requires all test groups and runs them in sequence.
 */

// Tests use mkdtemp under os.tmpdir() for sandbox isolation. The
// library scanner refuses to index OS scratch dirs by default
// (production rule) - the test runner opts out so fixtures behave
// like real user files.
process.env.SDOCS_ALLOW_THROWAWAY_INDEXING = '1';

const harness = require('./runner');

// ── Unit test groups (synchronous) ──────────────────
require('./test-yaml')(harness);
require('./test-shapes')(harness);
require('./test-slide-resolve')(harness);
require('./test-styles')(harness);
require('./test-contrast')(harness);
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
require('./test-forms')(harness);
require('./test-agent-block')(harness);
require('./test-router')(harness);
require('./test-source')(harness);
require('./test-library-tags')(harness);
require('./test-library-ephemeral')(harness);
require('./test-library-store')(harness);
require('./test-library-index')(harness);
require('./test-library-autostart')(harness);
require('./test-library-deny')(harness);
require('./test-library-ls')(harness);
const runBridge = require('./test-bridge')(harness);

// ── HTTP tests (async, starts server) ──────────────
const runHttp = require('./test-http')(harness);
const runCacheBust = require('./test-cache-bust')(harness);
const runLibraryServer = require('./test-library-server')(harness);

(async () => {
  await runBridge();
  await runHttp();
  await runCacheBust();
  await runLibraryServer();
  harness.report();
})().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
