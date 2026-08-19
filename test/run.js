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
require('./test-service-worker')(harness);
require('./test-chart-replace')(harness);
require('./test-mermaid')(harness);
require('./test-marked-del')(harness);
require('./test-video')(harness);
require('./test-zoom-math')(harness);
require('./test-update')(harness);
require('./test-analytics')(harness);
require('./test-short-links')(harness);
require('./test-chrome')(harness);
require('./test-comments')(harness);
require('./test-slide-comments')(harness);
require('./test-forms')(harness);
require('./test-cells')(harness);
require('./test-cells-formula')(harness);
require('./test-cells-groups')(harness);
require('./test-cells-xlsx')(harness);
require('./test-cells-transclude')(harness);
require('./test-cells-verify')(harness);
require('./test-code-langs')(harness);
require('./test-code-structural')(harness);
require('./test-code-comments')(harness);
require('./test-codewalk')(harness);
require('./test-file-wrap')(harness);
require('./test-agent-block')(harness);
require('./test-router')(harness);
require('./test-update-check')(harness);
require('./test-source')(harness);
require('./test-cloud-auth')(harness);
require('./test-cloud-billing')(harness);
require('./test-cloud-stripe')(harness);
const runCloudSeatSync = require('./test-cloud-seat-sync')(harness);
const runCloudKms = require('./test-cloud-kms')(harness);
const runCloudAwsKms = require('./test-cloud-aws-kms')(harness);
require('./test-cloud-jobs')(harness);
const runCloudOAuth = require('./test-cloud-oauth')(harness);
require('./test-cloud-cursor')(harness);
const runCloudDeploymentConfig = require('./test-cloud-deployment-config')(harness);
const runCloudStore = require('./test-cloud-store')(harness);
const runCloudCli = require('./test-cloud-cli')(harness);
const runCloudCheckout = require('./test-cloud-checkout')(harness);
require('./test-library-tags')(harness);
require('./test-library-ephemeral')(harness);
require('./test-library-store')(harness);
require('./test-library-index')(harness);
require('./test-library-autostart')(harness);
require('./test-library-deny')(harness);
require('./test-library-ls')(harness);
const runBridge = require('./test-bridge')(harness);

// ── Async test groups (no server) ───────────────────
const runSetupScenarios = require('./test-setup-scenarios')(harness);
const runTeams = require('./test-teams')(harness);
const runCloudAuthHttp = require('./test-cloud-auth-http')(harness);

// ── HTTP tests (async, starts server) ──────────────
const runHttp = require('./test-http')(harness);
const runCacheBust = require('./test-cache-bust')(harness);
const runLibraryServer = require('./test-library-server')(harness);

(async () => {
  await runCloudDeploymentConfig();
  await runCloudKms();
  await runCloudAwsKms();
  await runCloudOAuth();
  await runCloudStore();
  await runCloudCli();
  await runCloudCheckout();
  await runCloudSeatSync();
  await runBridge();
  await runSetupScenarios();
  await runTeams();
  await runCloudAuthHttp();
  await runHttp();
  await runCacheBust();
  await runLibraryServer();
  harness.report();
})().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
