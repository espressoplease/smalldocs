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
require('./test-slides-verify')(harness);
require('./test-sdk-docs')(harness);
require('./test-parity')(harness);
require('./test-prose-reader')(harness);
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
require('./test-cells-controller')(harness);
require('./test-cells-xlsx')(harness);
require('./test-cells-transclude')(harness);
require('./test-cells-verify')(harness);
require('./test-code-langs')(harness);
require('./test-code-structural')(harness);
require('./test-code-comments')(harness);
require('./test-codewalk')(harness);
require('./test-docwalk')(harness);
require('./test-file-wrap')(harness);
require('./test-agent-block')(harness);
require('./test-skill-evals')(harness);
require('./test-router')(harness);
require('./test-update-check')(harness);
require('./test-source')(harness);
const runCloudAuth = require('./test-cloud-auth')(harness);
const runCloudCliRecovery = require('./test-cloud-cli-recovery')(harness);
const runCloudReleaseRecovery = require('./test-cloud-release-recovery')(harness);
require('./test-cloud-auth-linking')(harness);
const runCloudBilling = require('./test-cloud-billing')(harness);
require('./test-cloud-trial-policy')(harness);
require('./test-cloud-manual-access')(harness);
const runCloudBillingLifecycle = require('./test-cloud-billing-lifecycle')(harness);
require('./test-cloud-account-selection')(harness);
require('./test-cloud-collaboration-metrics')(harness);
const runCloudStripe = require('./test-cloud-stripe')(harness);
const runCloudSeatSync = require('./test-cloud-seat-sync')(harness);
const runCloudKms = require('./test-cloud-kms')(harness);
const runCloudAwsKms = require('./test-cloud-aws-kms')(harness);
const runCloudJobs = require('./test-cloud-jobs')(harness);
const runCloudOAuth = require('./test-cloud-oauth')(harness);
require('./test-cloud-cursor')(harness);
const runCloudDeploymentConfig = require('./test-cloud-deployment-config')(harness);
const runCloudSingleBilling = require('./test-cloud-single-billing')(harness);
const runCloudLibraryCli = require('./test-cloud-library-cli')(harness);
const runCloudSinglePlan = require('./test-cloud-single-plan')(harness);
const runCloudAgentManagement = require('./test-cloud-agent-management')(harness);
const runCloudLibraryUpgrade = require('./test-cloud-library-upgrade')(harness);
const runCloudOnboardingReal = require('./test-cloud-onboarding-real')(harness);
const runCloudCliOnboarding = require('./test-cloud-cli-onboarding')(harness);
const runCloudSignupReadiness = require('./test-cloud-signup-readiness')(harness);
const runCloudJoinRequests = require('./test-cloud-join-requests')(harness);
const runCloudStore = require('./test-cloud-store')(harness);
const runCloudRevisionRetention = require('./test-cloud-revision-retention')(harness);
require('./test-cloud-search-query')(harness);
const runCloudSearch = require('./test-cloud-search')(harness);
const runCloudSearchApi = require('./test-cloud-search-api')(harness);
const runCloudSearchIsolation = require('./test-cloud-search-isolation')(harness);
const runCloudLegacyReadIsolation = require('./test-cloud-legacy-read-isolation')(harness);
const runCloudUpdatePreview = require('./test-cloud-update-preview')(harness);
const runCloudDirectEdit = require('./test-cloud-direct-edit')(harness);
const runCloudEditCli = require('./test-cloud-edit-cli')(harness);
const runCloudCommentsApi = require('./test-cloud-comments-api')(harness);
const runCloudCommentsCli = require('./test-cloud-comments-cli')(harness);
const runCloudSourceFile = require('./test-cloud-source-file')(harness);
require('./test-cloud-comment-context')(harness);
require('./test-cloud-comment-data')(harness);
require('./test-cloud-comment-rebase')(harness);
require('./test-cloud-text-edit')(harness)();
const runCloudCli = require('./test-cloud-cli')(harness);
const runCloudStagingSeed = require('./test-cloud-staging-seed')(harness);
require('./test-library-tags')(harness);
require('./test-library-ephemeral')(harness);
require('./test-library-store')(harness);
require('./test-library-index')(harness);
require('./test-library-autostart')(harness);
require('./test-library-deny')(harness);
require('./test-library-ls')(harness);
require('./test-sidebar-data')(harness);
const runBridge = require('./test-bridge')(harness);

// ── Async test groups (no server) ───────────────────
const runSetupScenarios = require('./test-setup-scenarios')(harness);
const runInstallChannel = require('./test-install-channel')(harness);
const runBackupHeartbeat = require('./test-backup-heartbeat')(harness);
const runProductionMonitor = require('./test-production-monitor')(harness);
const runTeams = require('./test-teams')(harness);
const runEmail = require('./test-email')(harness);
const runCloudAuthHttp = require('./test-cloud-auth-http')(harness);
const runStagingCliPackage = require('./test-staging-cli-package')(harness);

// ── HTTP tests (async, starts server) ──────────────
const runHttp = require('./test-http')(harness);
const runCacheBust = require('./test-cache-bust')(harness);
const runLibraryServer = require('./test-library-server')(harness);

(async () => {
  await runCloudAuth();
  await runCloudCliRecovery();
  await runCloudReleaseRecovery();
  await runCloudBilling();
  await runCloudBillingLifecycle();
  await runCloudStripe();
  await runCloudJobs();
  await runCloudDeploymentConfig();
  await runStagingCliPackage();
  await runCloudKms();
  await runCloudAwsKms();
  await runCloudOAuth();
  await runCloudJoinRequests();
  await runCloudOnboardingReal();
  await runCloudCliOnboarding();
  await runCloudSignupReadiness();
  await runCloudLibraryUpgrade();
  await runCloudSinglePlan();
  await runCloudAgentManagement();
  await runCloudSingleBilling();
  await runCloudLibraryCli();
  await runCloudStore();
  await runCloudRevisionRetention();
  await runCloudSearch();
  await runCloudSearchApi();
  await runCloudSearchIsolation();
  await runCloudLegacyReadIsolation();
  await runCloudUpdatePreview();
  await runCloudDirectEdit();
  await runCloudEditCli();
  await runCloudCommentsApi();
  await runCloudCommentsCli();
  await runCloudSourceFile();
  await runCloudCli();
  await runCloudStagingSeed();
  await runCloudSeatSync();
  await runBridge();
  await runInstallChannel();
  await runSetupScenarios();
  await runBackupHeartbeat();
  await runProductionMonitor();
  await runTeams();
  await runEmail();
  await runCloudAuthHttp();
  await runHttp();
  await runCacheBust();
  await runLibraryServer();
  harness.report();
})().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
