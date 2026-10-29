const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createCursorCodec, normalizeLimit } = require('./lib/cloud-cursor');
const cloudSearchQuery = require('./cli/shared/sdocs-search-query');
const { syncTeamSeatQuantity: syncStripeTeamSeatQuantity } = require('./lib/cloud-seat-sync');
const cloudBillingLifecycle = require('./lib/cloud-billing-lifecycle');
const { CURRENT_TERMS_VERSION, CURRENT_TERMS_LABEL } = require('./lib/cloud-terms');
const smallDocsAgentSkill = require('./cli/lib/agent-block');

function integerEnvironmentSetting(name, fallback, minimum) {
  if (process.env[name] == null || process.env[name] === '') return fallback;
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(name + ' must be an integer of at least ' + minimum);
  }
  return value;
}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const CLOUD_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const CLOUD_DOCUMENT_JSON_MAX_BYTES = 24 * 1024 * 1024;
const CLOUD_REVISION_RETENTION_DAYS = integerEnvironmentSetting(
  'CLOUD_REVISION_RETENTION_DAYS', 90, 1);
const CLOUD_REVISION_MINIMUM_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const CLOUD_REVISION_RETENTION_MS = Math.max(CLOUD_REVISION_MINIMUM_RETENTION_MS,
  CLOUD_REVISION_RETENTION_DAYS * 24 * 60 * 60 * 1000);

function cloudRevisionRetentionMs(value) {
  const duration = Number(value);
  return Math.max(CLOUD_REVISION_MINIMUM_RETENTION_MS,
    Number.isSafeInteger(duration) && duration > 0 ? duration : CLOUD_REVISION_RETENTION_MS);
}
const CLOUD_DOCUMENT_RESTORE_WINDOW_MS = integerEnvironmentSetting(
  'CLOUD_DOCUMENT_RESTORE_WINDOW_MS', 30 * 24 * 60 * 60 * 1000, 1);
const CLOUD_PAYMENT_GRACE_MS = integerEnvironmentSetting(
  'CLOUD_PAYMENT_GRACE_MS', 7 * 24 * 60 * 60 * 1000, 1);
const CLOUD_FAILED_PAYMENT_RETENTION_MS = integerEnvironmentSetting(
  'CLOUD_FAILED_PAYMENT_RETENTION_MS', 60 * 24 * 60 * 60 * 1000, 1);
const CLOUD_CANCELLATION_RETENTION_MS = integerEnvironmentSetting(
  'CLOUD_CANCELLATION_RETENTION_MS', 30 * 24 * 60 * 60 * 1000, 1);
const CLOUD_BILLING_DELETION_WARNING_MS = integerEnvironmentSetting(
  'CLOUD_BILLING_DELETION_WARNING_MS', 7 * 24 * 60 * 60 * 1000, 1);
const CLOUD_OAUTH_PROVIDER_TIMEOUT_MS = integerEnvironmentSetting(
  'CLOUD_OAUTH_PROVIDER_TIMEOUT_MS', 10 * 1000, 1000);
const CLOUD_COLLABORATION_METRICS_INTERVAL_MS = integerEnvironmentSetting(
  'CLOUD_COLLABORATION_METRICS_INTERVAL_MS', 60 * 1000, 1000);
const CLOUD_DEPLOYMENT = require('./lib/cloud-deployment-config')
  .validateCloudDeploymentConfig(process.env);
const DEV_MODE = process.env.SDOCS_DEV === '1' || process.env.NODE_ENV === 'development';
const CLOUD_UI_LAB_ENABLED = CLOUD_DEPLOYMENT.publicEnabled &&
  CLOUD_DEPLOYMENT.mode !== 'production';
const ANALYTICS_ENABLED = process.env.ANALYTICS_ENABLED === '1';
const analytics = ANALYTICS_ENABLED ? require('./analytics/db') : null;
const cloudCollaborationMetrics = require('./lib/cloud-collaboration-metrics')
  .createCloudCollaborationMetrics();
const cloudCollaborationMetricsTimer = setInterval(() => {
  cloudCollaborationMetrics.flush((snapshot) => {
    console.log('[cloud-collaboration] ' + JSON.stringify(snapshot));
  });
}, CLOUD_COLLABORATION_METRICS_INTERVAL_MS);
if (cloudCollaborationMetricsTimer.unref) cloudCollaborationMetricsTimer.unref();

const shortLinks = require('./short-links/db');
const shortLinksRateLimit = require('./short-links/rate-limit');
const SHORT_LINKS_MAX_BYTES = 256 * 1024;       // 256 KB ciphertext cap
const SHORT_LINKS_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
shortLinksRateLimit.startCleanup();

// ── Latest sdocs-dev release (powers the reader footer's "update" hint) ──────
// The browser cannot see whether a visitor has the CLI installed, so on a doc
// page the footer instead shows the newest published release and how long ago
// it shipped. We read the npm packument, keep it in memory, and refresh at most
// once an hour so a busy site never hammers the registry. A failed lookup keeps
// any prior value rather than going blank.
const CLI_PKG = 'sdocs-dev';
const CLI_LATEST_TTL_MS = 60 * 60 * 1000;        // 1 hour
const CLI_PACKUMENT_MAX_BYTES = 5 * 1024 * 1024; // guard against a runaway body
let cliLatestCache = null;                        // { version, time } once resolved
let cliLatestFetchedAt = 0;
let cliLatestInflight = null;

function fetchCliLatest() {
  return new Promise((resolve, reject) => {
    const req = https.get('https://registry.npmjs.org/' + CLI_PKG, {
      headers: { 'Accept': 'application/json' },
      timeout: 5000,
    }, (resp) => {
      if (resp.statusCode !== 200) { resp.resume(); reject(new Error('npm ' + resp.statusCode)); return; }
      let body = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => {
        body += c;
        if (body.length > CLI_PACKUMENT_MAX_BYTES) { req.destroy(); reject(new Error('packument too large')); }
      });
      resp.on('end', () => {
        try {
          const doc = JSON.parse(body);
          const version = doc['dist-tags'] && doc['dist-tags'].latest;
          const time = version && doc.time && doc.time[version];
          if (!version || !time) { reject(new Error('no latest version/time')); return; }
          resolve({ version: version, time: time });
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('npm timeout')); });
    req.on('error', reject);
  });
}

function getCliLatest() {
  const fresh = cliLatestCache && (Date.now() - cliLatestFetchedAt) < CLI_LATEST_TTL_MS;
  if (fresh) return Promise.resolve(cliLatestCache);
  if (cliLatestInflight) return cliLatestInflight;
  cliLatestInflight = fetchCliLatest().then((res) => {
    cliLatestCache = res;
    cliLatestFetchedAt = Date.now();
    cliLatestInflight = null;
    return res;
  }).catch((err) => {
    cliLatestInflight = null;
    if (cliLatestCache) return cliLatestCache;   // serve stale through a transient failure
    throw err;
  });
  return cliLatestInflight;
}
// Kick off one cleanup on boot, then once per day
setImmediate(() => { try { shortLinks.cleanupExpired(); } catch (_) {} });
const _shortLinksCleanupTimer = setInterval(() => {
  try { shortLinks.cleanupExpired(); } catch (_) {}
}, SHORT_LINKS_CLEANUP_INTERVAL_MS);
if (_shortLinksCleanupTimer.unref) _shortLinksCleanupTimer.unref();

const feedback = require('./feedback/db');
const feedbackRateLimit = require('./feedback/rate-limit');
const FEEDBACK_MAX_BYTES = 4 * 1024;            // 4 KB message cap
feedback.init();
feedbackRateLimit.startCleanup();

// Business-interest contact form. SmallCRM is the system of record; an email
// ping still fires when SMTP env vars are set (see teams/notify.js).
// The same feedback rate limiter keeps automated submissions cheap to refuse.
const teamsNotify = require('./teams/notify');
const emailTemplates = require('./lib/email-templates');
const SMALLCRM_TEAMS_FORM_ACTION = process.env.SMALLCRM_TEAMS_FORM_ACTION ||
  'https://smallcrm.org/w/smalldocs-ws_fc6d0a62-5f2c-4716-9487-df0801230386/f/' +
  'teams-interest-bb3de684-19c7-47d2-8fd6-4a95d5be6af3';
const SMALLCRM_TEAMS_FORM_PUBLIC_ID =
  new URL(SMALLCRM_TEAMS_FORM_ACTION).pathname.split('/').filter(Boolean).pop();
const SMALLCRM_INSTALL_FORM_ACTION = process.env.SMALLCRM_INSTALL_FORM_ACTION ||
  'https://smallcrm.org/w/smalldocs-ws_fc6d0a62-5f2c-4716-9487-df0801230386/f/' +
  'install-interest-d747aa39-73c3-4d51-98be-e78ccda4aae9';

// Cloud authentication is enabled only when a stable server-side pepper is
// configured. The sign-in page remains available without it, but auth APIs
// fail closed. Tests and local development use an isolated database path.
const cloudAuthHttp = require('./cloud/auth/http');
const CLOUD_AUTH_PEPPER = process.env.CLOUD_AUTH_PEPPER || '';
let CLOUD_AUTH_PUBLIC_ORIGIN;
try {
  CLOUD_AUTH_PUBLIC_ORIGIN = cloudAuthHttp.parsePublicOrigin(
    process.env.CLOUD_AUTH_PUBLIC_ORIGIN || `http://localhost:${PORT}`
  );
} catch (_) {
  throw new Error('CLOUD_AUTH_PUBLIC_ORIGIN must be a valid HTTP or HTTPS origin');
}
const CLOUD_AUTH_DEV_LOG_CODES = cloudAuthHttp.canLogDevCodes({
  enabled: process.env.CLOUD_AUTH_DEV_LOG_CODES === '1',
  nodeEnv: process.env.NODE_ENV,
  publicOrigin: CLOUD_AUTH_PUBLIC_ORIGIN,
});
const CLOUD_TEST_LOGIN_ENABLED = CLOUD_DEPLOYMENT.mode === 'staging' &&
  process.env.CLOUD_TEST_LOGIN_ENABLED === '1';
const CLOUD_TEST_LOGIN_EMAILS = new Set(String(process.env.CLOUD_TEST_LOGIN_EMAILS || '')
  .split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));
let CLOUD_TEST_LOGIN_SECRET = '';
if (CLOUD_TEST_LOGIN_ENABLED) {
  CLOUD_TEST_LOGIN_SECRET = fs.readFileSync(process.env.CLOUD_TEST_LOGIN_SECRET_FILE, 'utf8').trim();
  if (CLOUD_TEST_LOGIN_SECRET.length < 32) {
    throw new Error('CLOUD_TEST_LOGIN_SECRET_FILE must contain at least 32 characters');
  }
}
let cloudAuth = null;
let cloudOAuthTransactions = null;
let cloudGoogleOAuth = null;
let cloudGitHubOAuth = null;
let cloudIdentityLinking = null;
if (CLOUD_AUTH_PEPPER) {
  const { createAuthStore } = require('./lib/cloud-auth');
  cloudAuth = createAuthStore({
    dbPath: process.env.CLOUD_AUTH_DB || path.join(__dirname, 'cloud_auth.db'),
    pepper: CLOUD_AUTH_PEPPER,
  });
  cloudIdentityLinking = new (require('./lib/cloud-auth-linking').IdentityLinking)(cloudAuth, {
    recentAuthMs: Number(process.env.CLOUD_RECENT_AUTH_MS) || 30 * 60 * 1000,
  });
  const { createOAuthTransactionStore, createGoogleOAuth, createGitHubOAuth } = require('./lib/cloud-oauth');
  cloudOAuthTransactions = createOAuthTransactionStore({
    dbPath: process.env.CLOUD_OAUTH_DB || process.env.CLOUD_AUTH_DB || path.join(__dirname, 'cloud_auth.db'),
    pepper: CLOUD_AUTH_PEPPER,
  });
  if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    cloudGoogleOAuth = createGoogleOAuth({ clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri: CLOUD_AUTH_PUBLIC_ORIGIN + '/api/cloud/auth/oauth/google/callback',
      transactions: cloudOAuthTransactions,
      providerTimeoutMs: CLOUD_OAUTH_PROVIDER_TIMEOUT_MS });
  }
  if (process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET) {
    cloudGitHubOAuth = createGitHubOAuth({ clientId: process.env.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
      redirectUri: CLOUD_AUTH_PUBLIC_ORIGIN + '/api/cloud/auth/oauth/github/callback',
      transactions: cloudOAuthTransactions,
      providerTimeoutMs: CLOUD_OAUTH_PROVIDER_TIMEOUT_MS });
  }
}
const cloudJoinRequests = cloudAuth ? new (require('./lib/cloud-join-requests').JoinRequests)({
  dbPath: process.env.CLOUD_AUTH_DB || path.join(__dirname, 'cloud_auth.db'), secret: CLOUD_AUTH_PEPPER,
}) : null;
setImmediate(() => {
  if (cloudAuth) cloudAuth.cleanupExpired();
  if (cloudOAuthTransactions) cloudOAuthTransactions.cleanupExpired();
});
const cloudAuthCleanupTimer = setInterval(() => {
  if (cloudAuth) cloudAuth.cleanupExpired();
  if (cloudOAuthTransactions) cloudOAuthTransactions.cleanupExpired();
}, 24 * 60 * 60 * 1000);
if (cloudAuthCleanupTimer.unref) cloudAuthCleanupTimer.unref();

// Cloud document storage is configured separately from authentication. The
// local key provider is for development and tests; production must supply the
// same interface through a managed key service before accepting customer data.
let cloudStore = null;
let cloudKeyProvider = null;
let cloudManagedKmsClient = null;
let cloudCursor = null;
if (process.env.CLOUD_KMS_KEY_ID) {
  if (process.env.CLOUD_KMS_CLIENT_MODULE) {
    const kmsModulePath = path.resolve(process.env.CLOUD_KMS_CLIENT_MODULE);
    const kmsModule = require(kmsModulePath);
    cloudManagedKmsClient = typeof kmsModule.createKmsClient === 'function'
      ? kmsModule.createKmsClient({ environment: process.env.CLOUD_ENVIRONMENT || 'production' })
      : kmsModule;
  } else {
    cloudManagedKmsClient = require('./lib/cloud-aws-kms').createAwsKmsClient({
      region: process.env.CLOUD_KMS_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
      maxAttempts: process.env.CLOUD_KMS_MAX_ATTEMPTS == null
        ? undefined : Number(process.env.CLOUD_KMS_MAX_ATTEMPTS),
      connectionTimeoutMs: process.env.CLOUD_KMS_CONNECTION_TIMEOUT_MS == null
        ? undefined : Number(process.env.CLOUD_KMS_CONNECTION_TIMEOUT_MS),
      requestTimeoutMs: process.env.CLOUD_KMS_REQUEST_TIMEOUT_MS == null
        ? undefined : Number(process.env.CLOUD_KMS_REQUEST_TIMEOUT_MS),
      operationTimeoutMs: process.env.CLOUD_KMS_OPERATION_TIMEOUT_MS == null
        ? undefined : Number(process.env.CLOUD_KMS_OPERATION_TIMEOUT_MS),
    });
  }
  cloudKeyProvider = require('./lib/cloud-kms').createManagedKmsKeyProvider({ kmsClient: cloudManagedKmsClient,
    keyId: process.env.CLOUD_KMS_KEY_ID,
    environment: process.env.CLOUD_ENVIRONMENT || 'production' });
} else if (process.env.CLOUD_MASTER_KEY) {
  const { createLocalKeyProvider } = require('./lib/cloud-store');
  cloudKeyProvider = createLocalKeyProvider({
    masterKey: process.env.CLOUD_MASTER_KEY,
    environment: process.env.CLOUD_ENVIRONMENT || 'development',
    reference: process.env.CLOUD_KEY_REFERENCE || 'local-development-key',
  });
}
if (cloudKeyProvider) {
  const { createCloudStore } = require('./lib/cloud-store');
  cloudStore = createCloudStore({
    dbPath: process.env.CLOUD_DB || path.join(__dirname, 'cloud.db'),
    keyProvider: cloudKeyProvider,
    idempotencySecret: process.env.CLOUD_IDEMPOTENCY_SECRET || CLOUD_AUTH_PEPPER,
  });
  cloudCursor = createCursorCodec({
    secret: process.env.CLOUD_CURSOR_SECRET || process.env.CLOUD_IDEMPOTENCY_SECRET || CLOUD_AUTH_PEPPER,
  });
}

let cloudBilling = null;
let cloudStripe = null;
let stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
if (process.env.STRIPE_WEBHOOK_SECRET_FILE) {
  stripeWebhookSecret = fs.readFileSync(process.env.STRIPE_WEBHOOK_SECRET_FILE, 'utf8').trim();
  if (!stripeWebhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET_FILE is empty');
}
if (process.env.CLOUD_BILLING_DB) {
  const { createBillingStore } = require('./lib/cloud-billing');
  let planLimits = cloudBillingLifecycle.DEFAULT_PLAN_LIMITS;
  if (process.env.CLOUD_PLAN_LIMITS_JSON) {
    try { planLimits = JSON.parse(process.env.CLOUD_PLAN_LIMITS_JSON); }
    catch (_) { throw new Error('CLOUD_PLAN_LIMITS_JSON must contain valid JSON'); }
  }
  cloudBilling = createBillingStore({ dbPath: process.env.CLOUD_BILLING_DB, planLimits, trialIdentitySecret: CLOUD_AUTH_PEPPER });
  let stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
  if (process.env.STRIPE_SECRET_KEY_FILE) {
    stripeSecretKey = fs.readFileSync(process.env.STRIPE_SECRET_KEY_FILE, 'utf8').trim();
    if (!stripeSecretKey) throw new Error('STRIPE_SECRET_KEY_FILE is empty');
  }
  if (stripeSecretKey) {
    cloudStripe = require('./lib/cloud-stripe').createStripeClient({
      secretKey: stripeSecretKey,
      webhookSecret: stripeWebhookSecret,
      apiVersion: process.env.STRIPE_API_VERSION || undefined,
      apiBase: process.env.NODE_ENV === 'test' ? process.env.SDOCS_STRIPE_TEST_API_BASE : undefined,
    });
  }
}

const SINGLE_PLAN_ENABLED = process.env.CLOUD_SINGLE_PLAN_ENABLED === '1';
const cloudSinglePlan = SINGLE_PLAN_ENABLED && cloudBilling && cloudStore
  ? new (require('./lib/cloud-single-plan').SinglePlan)({ billing: cloudBilling, store: cloudStore }) : null;

let cloudJobs = null;
const CLOUD_JOB_WORKER_ID = 'cloud-server-' + process.pid;
if (process.env.CLOUD_JOBS_DB) {
  cloudJobs = require('./lib/cloud-jobs').createCloudJobs({ dbPath: process.env.CLOUD_JOBS_DB });
}

function enqueueCloudJob(input) {
  if (!cloudJobs) return null;
  return cloudJobs.enqueue(input);
}

function scheduleRevisionPrune(document, entitlements) {
  if (!cloudJobs || !document) return;
  const configuredDays = entitlements && entitlements.limits &&
    entitlements.limits.revisionRetentionDays;
  const retentionMs = cloudRevisionRetentionMs(configuredDays == null
    ? CLOUD_REVISION_RETENTION_MS : configuredDays * 24 * 60 * 60 * 1000);
  enqueueCloudJob({ type: 'revision_prune',
    idempotencyKey: document.id + ':' + document.current_revision_id + ':age-only-v1',
    payload: { documentId: document.id, retentionMs } });
}

function scheduleTeamSeatSync(workspaceId, seatChangeId) {
  if (!cloudJobs) return;
  enqueueCloudJob({ type: 'team_seat_sync',
    idempotencyKey: workspaceId + ':' + seatChangeId,
    payload: { workspaceId, seatChangeId }, maxAttempts: 20 });
}

const CLOUD_BILLING_POLICY = Object.freeze({
  paymentGraceMs: CLOUD_PAYMENT_GRACE_MS,
  failedPaymentRetentionMs: CLOUD_FAILED_PAYMENT_RETENTION_MS,
  cancellationRetentionMs: CLOUD_CANCELLATION_RETENTION_MS,
  deletionWarningMs: CLOUD_BILLING_DELETION_WARNING_MS,
});

function billingJobPayload(subscription, type, availableAtMs, recipientUserId) {
  return {
    workspaceId: subscription.workspaceId,
    type,
    recipientUserId: recipientUserId || null,
    providerSubscriptionId: subscription.providerSubscriptionId,
    currentPeriodEndMs: subscription.currentPeriodEndMs,
    graceEndsAtMs: subscription.graceEndsAtMs,
    retentionEndsAtMs: subscription.retentionEndsAtMs,
    availableAtMs,
  };
}

function billingJobAnchor(subscription, type, availableAtMs) {
  return [subscription.workspaceId, subscription.providerSubscriptionId || 'subscription', type,
    availableAtMs, subscription.retentionEndsAtMs, subscription.graceEndsAtMs].join(':');
}

function scheduleBillingLifecycleJobs(change) {
  if (!cloudJobs || !cloudStore || !change || !change.after) return;
  const subscription = change.after;
  const billingOwner = cloudSinglePlan && cloudSinglePlan.db.prepare('SELECT owner_user_id FROM cloud_single_accounts WHERE id=?').get(subscription.workspaceId);
  const owners = cloudSinglePlan ? (billingOwner ? [billingOwner.owner_user_id] : [])
    : cloudStore.listWorkspaceOwnerUserIds(subscription.workspaceId);
  const immediateAtMs = subscription.providerEventCreatedMs || subscription.updatedAtMs;
  for (const type of cloudBillingLifecycle.transitionTypes(change.before, subscription)) {
    for (const ownerUserId of owners) {
      enqueueCloudJob({ type: 'billing_state_email',
        idempotencyKey: billingJobAnchor(subscription, type, immediateAtMs) + ':' + ownerUserId,
        payload: billingJobPayload(subscription, type, immediateAtMs, ownerUserId) });
    }
  }
  for (const event of cloudBillingLifecycle.scheduledBillingEvents(
    subscription, CLOUD_BILLING_POLICY)) {
    if (cloudSinglePlan && ['deletion_warning', 'retention_expire'].includes(event.type)) continue;
    const payload = billingJobPayload(subscription, event.type, event.availableAtMs, null);
    if (event.type === 'retention_expire') {
      enqueueCloudJob({ type: 'billing_retention_expire',
        idempotencyKey: billingJobAnchor(subscription, event.type, event.availableAtMs),
        payload, availableAtMs: event.availableAtMs });
      continue;
    }
    for (const ownerUserId of owners) {
      const ownerPayload = Object.assign({}, payload, { recipientUserId: ownerUserId });
      enqueueCloudJob({ type: 'billing_state_email',
        idempotencyKey: billingJobAnchor(subscription, event.type, event.availableAtMs) + ':' +
          ownerUserId,
        payload: ownerPayload, availableAtMs: event.availableAtMs });
    }
  }
}

function formatBillingDate(timestamp) {
  if (!Number.isSafeInteger(timestamp)) return '';
  const value = new Date(timestamp);
  const date = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(value);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
  }).format(value);
  return date + ' at ' + time + ' UTC';
}

async function processCloudJob(job) {
  if (job.type === 'workspace_purge') {
    if (cloudStore) cloudStore.purgeDeletedWorkspaces({
      workspaceId: job.payload.workspaceId, beforeMs: Date.now(),
    });
    return;
  }
  if (job.type === 'document_purge') {
    if (cloudStore) cloudStore.purgeDeletedDocuments({ beforeMs: Date.now(), actorUserId: 'system' });
    return;
  }
  if (job.type === 'revision_prune') {
    if (cloudStore) {
      // Older queued jobs can carry a count cap or a shorter retention window.
      const retentionMs = cloudRevisionRetentionMs(job.payload.retentionMs);
      const result = cloudStore.pruneRevisions({ documentId: job.payload.documentId,
        retainAfterMs: Math.max(0, Date.now() - retentionMs) });
      if (result.oldest_retained_previous_created_at_ms != null) {
        const expiresAtMs = result.oldest_retained_previous_created_at_ms +
          retentionMs + 1;
        enqueueCloudJob({ type: 'revision_prune',
          idempotencyKey: result.document_id + ':' + result.current_revision_id + ':age-only-v1:' + expiresAtMs,
          payload: { documentId: result.document_id, retentionMs },
          availableAtMs: Math.max(Date.now(), expiresAtMs) });
      }
    }
    return;
  }
  if (job.type === 'team_seat_sync') {
    await syncTeamSeatQuantity(job.payload.workspaceId, job.id);
    return;
  }
  if (job.type === 'auth_cleanup') {
    if (cloudAuth) cloudAuth.cleanupExpired();
    if (cloudOAuthTransactions) cloudOAuthTransactions.cleanupExpired();
    return;
  }
  if (job.type === 'invitation_email') {
    if (!teamsNotify.isConfigured()) throw Object.assign(new Error('email_delivery_not_configured'),
      { code: 'email_delivery_not_configured' });
    const message = emailTemplates.workspaceInvitation({ acceptUrl: job.payload.acceptUrl,
      inviter: job.payload.inviter, accountName: job.payload.accountName });
    const delivered = await teamsNotify.sendTo(job.payload.email, message.subject,
      message.text, message.html);
    if (!delivered.ok) throw Object.assign(new Error('email_delivery_failed'), { code: 'email_delivery_failed' });
    return;
  }
  if (job.type === 'document_notification_email') {
    if (!cloudStore || !cloudAuth) throw Object.assign(new Error('temporary_service_failure'),
      { code: 'temporary_service_failure' });
    const delivery = await cloudStore.getDocumentNotificationDelivery({
      batchId: job.payload.batchId,
      recipientUserId: job.payload.recipientUserId,
    });
    if (delivery.skipped) return;
    const recipient = verifiedCloudEmail(delivery.recipient_user_id);
    if (!recipient) return;
    if (!teamsNotify.isConfigured()) throw Object.assign(new Error('email_delivery_not_configured'),
      { code: 'email_delivery_not_configured' });
    const actor = cloudActorLabel(delivery.actor_user_id);
    const message = emailTemplates.documentNotification({ actor, note: delivery.note,
      documents: delivery.documents.map((document) => ({ title: document.title,
        url: CLOUD_AUTH_PUBLIC_ORIGIN + '/docs?cloud-document=' +
          encodeURIComponent(document.id) })) });
    const delivered = await teamsNotify.sendTo(recipient, message.subject,
      message.text, message.html);
    if (!delivered.ok) throw Object.assign(new Error('email_delivery_failed'),
      { code: 'email_delivery_failed' });
    return;
  }
  if (job.type === 'billing_state_email') {
    if (cloudSinglePlan && job.payload.type === 'deletion_warning') return;
    if (!cloudStore || !cloudAuth || !cloudBilling) {
      throw Object.assign(new Error('temporary_service_failure'),
        { code: 'temporary_service_failure' });
    }
    let subscription = cloudBilling.getSubscription(job.payload.workspaceId);
    if (!cloudBillingLifecycle.billingEventApplies(subscription, job.payload, Date.now())) return;
    const billingOwner = cloudSinglePlan && cloudSinglePlan.db.prepare('SELECT owner_user_id FROM cloud_single_accounts WHERE id=?').get(job.payload.workspaceId);
    const context = cloudSinglePlan
      ? billingOwner && { name: 'your SmallDocs subscription', ownerUserIds: [billingOwner.owner_user_id] }
      : await cloudStore.getWorkspaceBillingContext(job.payload.workspaceId);
    if (!context || !context.ownerUserIds.includes(job.payload.recipientUserId)) return;
    const recipient = verifiedCloudEmail(job.payload.recipientUserId);
    if (!recipient) return;
    subscription = cloudBilling.getSubscription(job.payload.workspaceId);
    if (!cloudBillingLifecycle.billingEventApplies(subscription, job.payload, Date.now())) return;
    if (!teamsNotify.isConfigured()) throw Object.assign(new Error('email_delivery_not_configured'),
      { code: 'email_delivery_not_configured' });
    const message = emailTemplates.billingState({
      type: job.payload.type,
      accountName: context.name,
      accessEndsAt: formatBillingDate(job.payload.type === 'payment_failed'
        ? subscription.graceEndsAtMs : subscription.currentPeriodEndMs),
      retainDocuments: Boolean(cloudSinglePlan),
      deletionDate: cloudSinglePlan ? '' : formatBillingDate(subscription.retentionEndsAtMs),
      billingUrl: CLOUD_AUTH_PUBLIC_ORIGIN + '/cloud/admin?panel=billing&workspace_id=' +
        encodeURIComponent(subscription.workspaceId),
      termsUrl: CLOUD_AUTH_PUBLIC_ORIGIN + '/legal',
      cancellationUrl: CLOUD_AUTH_PUBLIC_ORIGIN + '/cancellation',
    });
    const delivered = await teamsNotify.sendTo(recipient, message.subject,
      message.text, message.html);
    if (!delivered.ok) throw Object.assign(new Error('email_delivery_failed'),
      { code: 'email_delivery_failed' });
    return;
  }
  if (job.type === 'billing_retention_expire') {
    // Unpaid libraries are retained until a new deletion policy is agreed.
    if (cloudSinglePlan) return;
    if (!cloudStore || !cloudBilling) return;
    const subscription = cloudBilling.getSubscription(job.payload.workspaceId);
    if (!cloudBillingLifecycle.billingEventApplies(subscription, job.payload, Date.now())) return;
    cloudStore.purgeWorkspaceForBilling({ workspaceId: job.payload.workspaceId });
    return;
  }
  throw new Error('unknown_cloud_job_type');
}

let cloudJobWorkerBusy = false;
async function runCloudJobWorker() {
  if (!cloudJobs || cloudJobWorkerBusy) return;
  cloudJobWorkerBusy = true;
  try {
    const job = cloudJobs.claim({ workerId: CLOUD_JOB_WORKER_ID, leaseMs: 60 * 1000 });
    if (!job) return;
    try {
      await processCloudJob(job);
      cloudJobs.complete({ jobId: job.id, workerId: CLOUD_JOB_WORKER_ID });
    } catch (error) {
      cloudJobs.retry({ jobId: job.id, workerId: CLOUD_JOB_WORKER_ID,
        error: { code: error && error.code ? error.code : 'job_failed' } });
    }
  } finally {
    cloudJobWorkerBusy = false;
  }
}
const cloudJobTimer = setInterval(runCloudJobWorker,
  Math.max(250, Number(process.env.CLOUD_JOB_POLL_MS) || 1000));
if (cloudJobTimer.unref) cloudJobTimer.unref();
setImmediate(runCloudJobWorker);

// Auto-version: hash all non-font files in public/ at startup.
// Any file change = new hash = clients purge their SW cache.
// The per-file SHA-256 list (served at /trust/manifest) is built by the same
// walk so the two can't drift. Walk logic lives in scripts/build-manifest.js
// and is shared with the GitHub Action that publishes the authoritative list.
const { walkPublic } = require('./scripts/build-manifest');
const PUBLIC_ROOT = path.join(__dirname, 'public');
const { files: trustFiles, buffers: publicBuffers } = walkPublic(PUBLIC_ROOT, { keepBuffers: true });
const appHash = crypto.createHash('md5');
for (const file of trustFiles) {
  appHash.update(path.basename(file.path));
  appHash.update(publicBuffers.get(file.path));
}
const APP_VERSION = appHash.digest('hex').slice(0, 10);

// Capture the git commit running on this server. Read once at startup from
// .git/HEAD so we don't shell out on every request and still work in
// sandboxed deploys where `git` may not be on PATH.
function readRunningCommit() {
  try {
    const head = fs.readFileSync(path.join(__dirname, '.git', 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref: ')) {
      const refPath = head.slice(5).trim();
      return fs.readFileSync(path.join(__dirname, '.git', refPath), 'utf8').trim();
    }
    return head;
  } catch (_) {
    return process.env.SDOCS_COMMIT || 'unknown';
  }
}
const RUNNING_COMMIT = readRunningCommit();
const BUILT_AT = new Date().toISOString();
const TRUST_MANIFEST = {
  commit: RUNNING_COMMIT,
  builtAt: BUILT_AT,
  repo: 'https://github.com/espressoplease/smalldocs',
  files: trustFiles,
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.json': 'application/json',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/plain',
  '.smd':  'text/plain',
  '.sh':   'text/x-shellscript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.wasm':  'application/wasm',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.mp4':  'video/mp4',
};

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico']);

function cacheHeader(ext) {
  if (DEV_MODE) return 'no-store';
  if (ext === '.html') return 'no-cache';
  if (ext === '.woff2') return 'public, max-age=31536000, immutable';
  if (ext === '.css' || ext === '.js') return 'public, max-age=86400';
  if (IMAGE_EXTS.has(ext)) return 'public, max-age=86400';
  return 'no-cache';
}

// Serve a file from disk, honouring HTTP Range requests so video/audio
// elements can stream in chunks instead of downloading the whole body up
// front. Without Range support a <video> tag sees a 200 (not 206), assumes
// the server can't seek, and blocks playback (and the page's load event)
// until the entire file has buffered - which is why the homepage hero
// video stalled the tab loading indicator.
function serveFile(req, res, filePath, extraHeaders) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath);
    const baseHeaders = Object.assign({
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheHeader(ext),
      'Accept-Ranges': 'bytes',
    }, extraHeaders || {});

    const rangeHeader = req && req.headers && req.headers.range;
    if (rangeHeader) {
      // Single-range form only: bytes=START-END, bytes=START-, or bytes=-SUFFIX.
      // Multi-range (comma-separated) is rare for media playback and we don't
      // bother supporting it; falling through to the unparsed branch sends the
      // full body, which is the same fallback any plain GET gets.
      const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (m) {
        const hasStart = m[1] !== '';
        const hasEnd = m[2] !== '';
        let start, end;
        if (!hasStart && hasEnd) {
          // Suffix: last N bytes.
          const suffix = parseInt(m[2], 10);
          start = Math.max(0, stat.size - suffix);
          end = stat.size - 1;
        } else if (hasStart) {
          start = parseInt(m[1], 10);
          end = hasEnd ? parseInt(m[2], 10) : stat.size - 1;
        } else {
          // bytes=- with nothing on either side: unsatisfiable.
          res.writeHead(416, Object.assign({}, baseHeaders, {
            'Content-Range': 'bytes */' + stat.size,
          }));
          res.end();
          return;
        }
        if (start < 0 || end >= stat.size || start > end) {
          res.writeHead(416, Object.assign({}, baseHeaders, {
            'Content-Range': 'bytes */' + stat.size,
          }));
          res.end();
          return;
        }
        res.writeHead(206, Object.assign({}, baseHeaders, {
          'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
          'Content-Length': end - start + 1,
        }));
        const stream = fs.createReadStream(filePath, { start, end });
        stream.on('error', () => res.end());
        stream.pipe(res);
        return;
      }
    }

    res.writeHead(200, Object.assign({}, baseHeaders, {
      'Content-Length': stat.size,
    }));
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.end());
    stream.pipe(res);
  });
}

// Asset cache-busting: append ?v=APP_VERSION to every same-origin /public/
// asset URL in <script src=...> and <link rel="stylesheet" href=...>. URLs
// already carrying any query string are left alone (the path-capturing
// character class stops at `?`, so the `\2` closing-quote anchor fails on
// pre-versioned URLs and the whole match falls through). Cross-origin URLs
// (CDN scripts, Google Fonts) don't start with `/public/` and are skipped.
//
// This exists so contributors don't have to remember to add `?v=` by hand
// in HTML. Without it, returning users get the new HTML but the browser's
// HTTP cache serves stale CSS/JS at unchanged URLs.
//
// Assumptions the regexes rely on - keep your HTML compliant:
//   1. Each tag's `src=` / `href=` attribute lives on the same line as the
//      opening `<script` / `<link`. Multi-line attribute splits would miss.
//   2. Attribute values do not contain a literal `>` character. The greedy
//      stop-at-`>` logic would terminate early and leave the URL unrewritten.
// Both hold across every HTML we ship today.
const SCRIPT_PUBLIC_RE = /(<script\b[^>]*?\s+src=)(["'])(\/public\/[^"'?#]+)\2/gi;
const LINK_TAG_RE = /<link\b([^>]*)>/gi;
const LINK_HAS_STYLESHEET_RE = /\s+rel=["']stylesheet["']/i;
const LINK_HREF_PUBLIC_RE = /(\s+href=)(["'])(\/public\/[^"'?#]+)\2/i;

function rewriteAssets(html) {
  html = html.replace(SCRIPT_PUBLIC_RE, (_, prefix, q, src) =>
    prefix + q + src + '?v=' + APP_VERSION + q
  );
  html = html.replace(LINK_TAG_RE, (match, attrs) => {
    if (!LINK_HAS_STYLESHEET_RE.test(attrs)) return match;
    const rewritten = attrs.replace(LINK_HREF_PUBLIC_RE, (_, prefix, q, href) =>
      prefix + q + href + '?v=' + APP_VERSION + q
    );
    return '<link' + rewritten + '>';
  });
  return html;
}

// Read an HTML file, apply optional template substitutions, run the asset
// rewriter, and send. Every HTML route in this server goes through here so
// the asset-versioning pass cannot be forgotten on a new entry point.
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function serveHtmlWithRewrite(res, filePath, subs, extraHeaders, statusCode = 200) {
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    if (subs) {
      for (const key of Object.keys(subs)) {
        html = html.replace(new RegExp(escapeRegExp(key), 'g'), subs[key]);
      }
    }
    html = rewriteAssets(html);
    const headers = Object.assign({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    }, extraHeaders || {});
    res.writeHead(statusCode, headers);
    res.end(html);
  });
}

function getClientIp(req) {
  return cloudAuthHttp.getClientIp(req, process.env.TRUST_PROXY === '1');
}

function sendJson(res, status, obj, extraHeaders) {
  if (res.cloudSubscription && obj && typeof obj === 'object' &&
      (status < 400 || obj.error === 'trial_payment_required')) {
    const subscription = res.cloudSubscription();
    obj = Object.assign({}, obj, { subscription });
    if (subscription.notices.length) obj.notices = subscription.notices;
  }
  const headers = Object.assign(
    { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    extraHeaders || {}
  );
  res.writeHead(status, headers);
  res.end(JSON.stringify(obj));
}

function handleShortLinkPost(req, res) {
  const ip = getClientIp(req);
  if (!shortLinksRateLimit.check(ip)) {
    sendJson(res, 429, { error: 'rate_limited' });
    return;
  }
  let bytes = 0;
  const chunks = [];
  let aborted = false;
  req.on('data', (chunk) => {
    if (aborted) return;
    bytes += chunk.length;
    if (bytes > SHORT_LINKS_MAX_BYTES + 1024) {  // small JSON overhead tolerance
      aborted = true;
      sendJson(res, 413, { error: 'payload_too_large' });
      // Let the client finish sending; just ignore the rest. Destroying the
      // request socket mid-write causes EPIPE on the client and, more
      // importantly, can poison HTTP keep-alive pools.
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) return;
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (_) {
      sendJson(res, 400, { error: 'invalid_json' });
      return;
    }
    const ct = body && body.ciphertext;
    if (typeof ct !== 'string' || !ct.length) {
      sendJson(res, 400, { error: 'missing_ciphertext' });
      return;
    }
    if (ct.length > SHORT_LINKS_MAX_BYTES) {
      sendJson(res, 413, { error: 'payload_too_large' });
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(ct)) {
      sendJson(res, 400, { error: 'invalid_ciphertext' });
      return;
    }
    try {
      const id = shortLinks.insert(ct);
      sendJson(res, 201, { id: id });
    } catch (e) {
      sendJson(res, 500, { error: 'db_error' });
    }
  });
  req.on('error', () => {
    if (!aborted) sendJson(res, 400, { error: 'request_error' });
  });
}

function handleFeedbackPost(req, res) {
  const ip = getClientIp(req);
  if (!feedbackRateLimit.check(ip)) {
    sendJson(res, 429, { error: 'rate_limited' });
    return;
  }
  let bytes = 0;
  const chunks = [];
  let aborted = false;
  req.on('data', (chunk) => {
    if (aborted) return;
    bytes += chunk.length;
    if (bytes > FEEDBACK_MAX_BYTES + 1024) {
      aborted = true;
      sendJson(res, 413, { error: 'payload_too_large' });
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) return;
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (_) {
      sendJson(res, 400, { error: 'invalid_json' });
      return;
    }
    const msg = body && typeof body.message === 'string' ? body.message.trim() : '';
    if (!msg.length) {
      sendJson(res, 400, { error: 'missing_message' });
      return;
    }
    if (msg.length > FEEDBACK_MAX_BYTES) {
      sendJson(res, 413, { error: 'payload_too_large' });
      return;
    }
    try {
      feedback.insert(msg);
    } catch (e) {
      sendJson(res, 500, { error: 'db_error' });
      return;
    }
    sendJson(res, 201, { ok: true });
  });
  req.on('error', () => {
    if (!aborted) sendJson(res, 400, { error: 'request_error' });
  });
}

// Teams-interest submissions. Email is required (it is the reply channel);
// company and message are optional. A hidden "website" field acts as a
// honeypot: humans never see it, naive bots fill it, and a filled value gets
// a 201 with nothing stored so the bot learns nothing. Valid submissions are
// relayed to SmallCRM's public write-only form receiver.
const CONTACT_EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,24}$/;

async function submitTeamsInterestToSmallCrm({ name, email, company, message }, installRequest = false) {
  const action = installRequest ? SMALLCRM_INSTALL_FORM_ACTION : SMALLCRM_TEAMS_FORM_ACTION;
  const form = new URLSearchParams();
  form.set('_scrm_form', installRequest
    ? new URL(action).pathname.split('/').filter(Boolean).pop() : SMALLCRM_TEAMS_FORM_PUBLIC_ID);
  form.set('inbound_leads.email', email);
  if (installRequest) {
    form.set('inbound_leads.source', 'homepage_install');
    form.set('inbound_leads.status', 'new');
  }
  if (name) form.set('inbound_leads.name', name);
  if (company) form.set('inbound_leads.company', company);
  if (message) form.set('inbound_leads.message', message);
  const response = await fetch(action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: form.toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('SmallCRM form returned ' + response.status);
}

function handleTeamsInterestPost(req, res, installRequest = false) {
  const ip = getClientIp(req);
  if (!feedbackRateLimit.check(ip)) {
    sendJson(res, 429, { error: 'rate_limited' });
    return;
  }
  let bytes = 0;
  const chunks = [];
  let aborted = false;
  req.on('data', (chunk) => {
    if (aborted) return;
    bytes += chunk.length;
    if (bytes > FEEDBACK_MAX_BYTES + 1024) {
      aborted = true;
      sendJson(res, 413, { error: 'payload_too_large' });
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', async () => {
    if (aborted) return;
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (_) {
      sendJson(res, 400, { error: 'invalid_json' });
      return;
    }
    if (body && typeof body.website === 'string' && body.website.trim().length) {
      sendJson(res, 201, { ok: true });
      return;
    }
    const email = body && typeof body.email === 'string' ? body.email.trim() : '';
    if (!CONTACT_EMAIL_RE.test(email)) {
      sendJson(res, 400, { error: 'invalid_email' });
      return;
    }
    const name = body && typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
    const company = body && typeof body.company === 'string' ? body.company.trim().slice(0, 200) : '';
    const message = body && typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : '';
    try {
      await submitTeamsInterestToSmallCrm({ name, email, company, message }, installRequest);
    } catch (error) {
      console.error('[teams-interest] SmallCRM submission failed:', error.message);
      sendJson(res, 502, { error: 'submission_failed' });
      return;
    }
    sendJson(res, 201, { ok: true });
    if (installRequest) return;
    teamsNotify.send(
      'SmallDocs Teams interest: ' + email,
      'New Teams-interest submission on smalldocs.org\n\n' +
      'Name:    ' + (name || '-') + '\n' +
      'Email:   ' + email + '\n' +
      'Company: ' + (company || '-') + '\n' +
      'Message: ' + (message || '-') + '\n\n' +
      'All submissions: SmallCRM inbound_leads.'
    );
  });
  req.on('error', () => {
    if (!aborted) sendJson(res, 400, { error: 'request_error' });
  });
}

function handleShortLinkGet(res, id) {
  // Accept both legacy 8-char ids and current 22-char ids. Never narrow this
  // range, or short links minted before the id-length bump stop resolving.
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
    sendJson(res, 400, { error: 'invalid_id' });
    return;
  }
  try {
    const ct = shortLinks.fetch(id);
    if (!ct) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    sendJson(res, 200, { ciphertext: ct });
  } catch (e) {
    sendJson(res, 500, { error: 'db_error' });
  }
}

function cloudAuthReady(res) {
  if (cloudAuth) return true;
  sendJson(res, 503, { ok: false, error: 'authentication_not_configured' });
  return false;
}

function cloudAuthPostAllowed(req, res) {
  if (cloudAuthHttp.sameOrigin(req, CLOUD_AUTH_PUBLIC_ORIGIN)) return true;
  sendJson(res, 403, { ok: false, error: 'invalid_origin' });
  return false;
}

function cloudAuthSession(req) {
  if (!cloudAuth) return { ok: false, reason: 'not_configured' };
  const secure = new URL(CLOUD_AUTH_PUBLIC_ORIGIN).protocol === 'https:';
  const token = cloudAuthHttp.sessionTokenFromCookies(req.headers.cookie, secure);
  return cloudAuth.authenticateSession(token);
}

function cloudTermsAccepted(user) {
  return Boolean(user && user.termsVersion === CURRENT_TERMS_VERSION &&
    Number.isSafeInteger(user.termsAcceptedAtMs));
}

function cloudTermsLocation(returnTo) {
  return '/cloud/terms?return=' + encodeURIComponent(
    cloudAuthHttp.safeReturnPath(returnTo));
}

function redirectForCloudTerms(res, authenticated, returnTo) {
  if (!authenticated || !authenticated.ok || cloudTermsAccepted(authenticated.user)) return false;
  res.writeHead(303, { Location: cloudTermsLocation(returnTo), 'Cache-Control': 'no-store' });
  res.end();
  return true;
}

const HOMEPAGE_NAV_ICONS = Object.freeze({
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
  signIn: '<path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/>' +
    '<path d="m16 19 2 2 4-4"/>',
  settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 ' +
    '2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 ' +
    '2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 ' +
    '2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051 ' +
    '2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
  signOut: '<path d="m19 16-3 3"/><path d="M2 21a8 8 0 0 1 12.664-6.5"/>' +
    '<path d="M22 19h-6l3 3"/><circle cx="10" cy="8" r="5"/>',
});

function homepageNavIcon(name) {
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    HOMEPAGE_NAV_ICONS[name] + '</svg>';
}

function homepageNavLink(className, href, icon, label, attributes) {
  return '<a' + (className ? ' class="' + className + '"' : '') + ' href="' + href + '"' +
    (attributes || '') + '>' + homepageNavIcon(icon) + label + '</a>';
}

function homepageNavigation(req) {
  let authenticated = null;
  if (CLOUD_DEPLOYMENT.publicEnabled) {
    const session = cloudAuthSession(req);
    if (session.ok) authenticated = session;
  }

  const actions = [];
  let menuBefore = '';
  let menuAfter = '';
  if (authenticated) {
    actions.push(homepageNavLink('btn-gh', '/library?scope=cloud', 'library', 'Open library'));
    menuBefore = homepageNavLink('', '/cloud/admin', 'settings', 'Cloud settings', ' role="menuitem"') +
      '<div class="nav-menu-separator" role="separator"></div>';
    menuAfter = '<div class="nav-menu-separator" role="separator"></div>' +
      '<form method="post" action="/api/cloud/auth/logout" role="none">' +
      '<button type="submit" role="menuitem">' + homepageNavIcon('signOut') + 'Sign out</button></form>';
  } else {
    if (CLOUD_DEPLOYMENT.publicEnabled) {
      actions.push(homepageNavLink('btn-gh nav-signin-wide',
        '/cloud/sign-in?return=%2Flibrary%3Fscope%3Dcloud', 'signIn', 'Sign in'));
    }
    actions.push('<a class="btn-gh nav-cloud" href="#install">' +
      '<span class="nav-install-label-long">Install SmallDocs</span>' +
      '<span class="nav-install-label-short">Install</span></a>');
    menuBefore = homepageNavLink('nav-menu-mobile-only', '/library', 'library', 'Library',
      ' role="menuitem"');
  }

  return {
    authenticated: Boolean(authenticated),
    legacyLibrary: !SINGLE_PLAN_ENABLED || Boolean(authenticated && authenticated.user.legacyLibraryEnabled),
    termsAccepted: Boolean(authenticated && cloudTermsAccepted(authenticated.user)),
    menuBefore,
    menuAfter,
    substitutions: {
      '<!--__HOME_NAV_ACTIONS__-->': actions.join(''),
      '<!--__HOME_NAV_MENU_CLASS__-->': authenticated ? 'nav-menu-account' : 'nav-menu-guest',
      '<!--__HOME_NAV_CLOUD_LINK__-->': CLOUD_DEPLOYMENT.publicEnabled
        ? '<a class="nav-link" href="/cloud">Cloud</a>' : '',
      '<!--__HOME_NAV_CLOUD_MOBILE_LINK__-->': CLOUD_DEPLOYMENT.publicEnabled
        ? '<a class="nav-menu-static-mobile" href="/cloud" role="menuitem">Cloud</a>' : '',
      '<!--__HOME_NAV_MENU_BEFORE__-->': menuBefore,
      '<!--__HOME_NAV_MENU_AFTER__-->': menuAfter,
    },
  };
}

function documentNavigation(req) {
  const navigation = homepageNavigation(req);
  return {
    authenticated: navigation.authenticated,
    termsAccepted: navigation.termsAccepted,
    substitutions: {
      '__DOCUMENT_LIBRARY_HREF__': navigation.legacyLibrary ? '/library' : '/library?scope=cloud',
      '__DOCUMENT_LEGACY_LIBRARY__': navigation.legacyLibrary ? 'true' : 'false',
      '__DOCUMENT_CLOUD_AUTHENTICATED__': navigation.authenticated ? 'true' : 'false',
      '__DOCUMENT_CLOUD_TERMS_ACCEPTED__': navigation.termsAccepted ? 'true' : 'false',
      '__DOCUMENT_NAV_MENU_HIDDEN__': navigation.authenticated ? '' : 'hidden',
      '<!--__DOCUMENT_NAV_MENU_BEFORE__-->': navigation.menuBefore,
      '<!--__DOCUMENT_NAV_MENU_AFTER__-->': navigation.menuAfter,
    },
  };
}

function documentCsp(nonce, frameAncestors) {
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'nonce-" + nonce + "' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "img-src 'self' data: https:",
    // These loopback origins support the local Bridge and Library agents.
    // Their session and connection checks remain active in the embedded shell.
    "connect-src 'self' https://cdn.jsdelivr.net https://raw.githubusercontent.com ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:*",
    "frame-src 'self' https://www.youtube-nocookie.com",
    "object-src 'none'",
  ];
  if (frameAncestors) policy.push('frame-ancestors ' + frameAncestors);
  return policy.join('; ');
}

function parseEmbedParentOrigin(value) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch (_) {
    return null;
  }
}

function cloudApiError(res, error) {
  const code = error && error.name === 'KmsKeyProviderError'
    ? 'temporary_service_failure'
    : error && error.code ? error.code : 'temporary_service_failure';
  const statuses = {
    invalid_request: 400,
    edit_no_match: 409,
    edit_ambiguous: 409,
    section_not_found: 409,
    section_ambiguous: 409,
    invalid_patch: 400,
    overlapping_edits: 400,
    comment_changed: 409,
    comment_unavailable: 404,
    profile_required: 409,
    public_email_domain: 400,
    login_required: 401,
    permission_denied: 403,
    resource_unavailable: 404,
    account_required: 404,
    account_selection_required: 409,
    revision_conflict: 409,
    target_too_old: 409,
    idempotency_mismatch: 409,
    final_owner_required: 409,
    personal_workspace_cannot_be_deleted: 409,
    personal_library_private: 409,
    subscription_required: 402,
    subscription_read_only: 402,
    trial_payment_required: 402,
    payment_grace_expired: 402,
    file_too_large: 413,
    storage_limit_exceeded: 409,
    project_limit_reached: 409,
    member_limit_reached: 409,
    search_limit_reached: 429,
    search_index_building: 503,
    billing_not_configured: 503,
    notification_delivery_not_configured: 503,
    subscription_exists: 409,
    subscription_pending: 409,
    trial_already_used: 409,
    upgrade_preview_changed: 409,
    upgrade_in_progress: 409,
    billing_update_required: 409,
    already_covered: 409,
    active_subscription_requires_cancellation: 409,
    rate_limited: 429,
    invalid_token: 401,
    terms_acceptance_required: 403,
    recent_auth_required: 401,
    token_reuse: 401,
    temporary_service_failure: 503,
  };
  const body = { ok: false, error: code };
  if (code === 'personal_library_private') {
    body.message = 'Personal libraries are private. Create a team library to invite people.';
    body.settings_url = CLOUD_AUTH_PUBLIC_ORIGIN + '/cloud/admin?panel=libraries';
  }
  if (code === 'recent_auth_required') {
    body.message = 'Sign in again to continue. Your changes have not been submitted.';
    body.sign_in_url = '/cloud/sign-in';
  }
  if (code === 'account_selection_required' && Array.isArray(error.accounts)) {
    body.accounts = error.accounts;
  }
  if (code === 'revision_conflict') {
    body.document_id = error.documentId;
    body.base_revision_id = error.baseRevisionId;
    body.current_revision_id = error.currentRevisionId;
    if (error.reason) body.reason = error.reason;
    if (error.expectedCurrentRevisionId) body.expected_current_revision_id = error.expectedCurrentRevisionId;
    if (Array.isArray(error.conflicts)) {
      body.conflicts = error.conflicts;
      body.conflict_count = error.conflictCount;
    }
  }
  if (code === 'target_too_old') {
    body.document_id = error.documentId;
    body.target_revision_id = error.targetRevisionId;
    body.current_revision_id = error.currentRevisionId;
  }
  if (code === 'comment_changed' || code === 'comment_unavailable') {
    body.message = error.message;
    body.document_id = error.documentId;
    body.current_revision_id = error.currentRevisionId;
    if (error.currentComment) body.current_comment = error.currentComment;
  }
  if (code === 'terms_acceptance_required') {
    body.terms_version = CURRENT_TERMS_VERSION;
    body.terms_url = '/legal';
    body.acceptance_url = '/cloud/terms';
  }
  if (code === 'invalid_request' && error.details && error.details.field === 'search') {
    body.message = error.message;
    body.details = error.details;
  }
  if (['edit_no_match', 'edit_ambiguous', 'section_not_found', 'section_ambiguous',
    'invalid_patch', 'overlapping_edits'].includes(code) ||
    (code === 'invalid_request' && error.details && ['edit', 'comments'].includes(error.details.field))) {
    body.message = error.message;
    body.details = error.details;
  }
  if (code === 'search_index_building') {
    body.message = 'Search is preparing older documents. Retry this request shortly.';
    body.retry_after_ms = 1000;
  }
  if (error && Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0) body.retry_after_ms = error.retryAfterMs;
  const retry = body.retry_after_ms ? { 'Retry-After': String(Math.max(1, Math.ceil(body.retry_after_ms / 1000))) } : undefined;
  sendJson(res, statuses[code] || 500, body, retry);
}

function cloudSubscriptionState(userId) {
  const { applyTrialPolicy, trialStatus } = require('./lib/cloud-trial-policy');
  const own = cloudSinglePlan.ownAccount(userId);
  const sponsor = cloudSinglePlan.coverage(userId);
  const payer = sponsor && cloudSinglePlan.hasSponsoredMembership(userId, sponsor.account_id)
    ? sponsor.account_id : own && own.id;
  const original = cloudBilling.db.prepare('SELECT starts_at_ms, ends_at_ms FROM cloud_billing_personal_trials WHERE user_id=?').get(userId);
  const access = applyTrialPolicy(cloudBilling.computeEntitlements(payer || '__none__'),
    cloudBilling.now(), original && original.ends_at_ms);
  const status = trialStatus(access, cloudBilling.now(), CLOUD_AUTH_PUBLIC_ORIGIN);
  const trial = status.trial_ends_at_ms && original && original.ends_at_ms === status.trial_ends_at_ms
    ? original : status.trial_ends_at_ms && cloudBilling.db.prepare(
      'SELECT starts_at_ms FROM cloud_billing_personal_trials WHERE workspace_id=? AND ends_at_ms=?'
    ).get(payer, status.trial_ends_at_ms);
  return { ...status, trial_starts_at_ms: trial ? trial.starts_at_ms : null };
}

function redirectForTrialPayment(res, authenticated) {
  if (!cloudSinglePlan || !authenticated.ok || cloudSubscriptionState(authenticated.user.id).phase !== 'payment_required') return false;
  res.writeHead(303, { Location: '/cloud/subscribe', 'Cache-Control': 'no-store' });
  res.end(); return true;
}

function cloudApiPrincipal(req, res) {
  if (!cloudStore) {
    sendJson(res, 503, { ok: false, error: 'cloud_storage_not_configured' });
    return null;
  }
  const authorization = String(req.headers.authorization || '');
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
  const authenticated = bearer ? cloudAuth.authenticateAccessToken(bearer[1]) : cloudAuthSession(req);
  if (!authenticated.ok) {
    sendJson(res, 401, { ok: false, error: 'login_required' });
    return null;
  }
  if (!cloudTermsAccepted(authenticated.user)) {
    sendJson(res, 403, { ok: false, error: 'terms_acceptance_required',
      terms_version: CURRENT_TERMS_VERSION, terms_url: '/legal',
      acceptance_url: '/cloud/terms' });
    return null;
  }
  if (cloudSinglePlan) res.cloudSubscription = () => cloudSubscriptionState(authenticated.user.id);
  return { user: authenticated.user, credential: authenticated.credential || null,
    session: authenticated.session || null };
}

function requireRecentBrowser(principal) {
  const maxAgeMs = Number(process.env.CLOUD_RECENT_AUTH_MS) || 30 * 60 * 1000;
  if (!principal || principal.credential || !principal.session ||
      Date.now() - principal.session.createdAtMs > maxAgeMs) {
    throw Object.assign(new Error('recent_auth_required'), { code: 'recent_auth_required' });
  }
}

function requireAccountManager(principal) {
  if (!principal.credential) requireRecentBrowser(principal);
}

function cloudApiMutationAllowed(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  if (/^Bearer\s+/i.test(String(req.headers.authorization || ''))) return true;
  return cloudAuthPostAllowed(req, res);
}

function requireCloudEntitlement(userId, workspaceId, operation, extra) {
  if (!cloudBilling) return null;
  if (cloudSinglePlan) {
    const role = cloudStore._requireWorkspaceRole(userId, workspaceId, ['owner', 'admin', 'member']);
    if (role === 'owner') cloudSinglePlan.initialize(userId, workspaceId, verifiedCloudEmail(userId));
    else cloudSinglePlan.claim(userId, workspaceId);
  }
  const usage = cloudWorkspaceUsage(userId, workspaceId);
  const input = Object.assign({ operation, usage }, extra || {});
  const result = cloudSinglePlan ? cloudSinglePlan.check(userId, workspaceId, input) : cloudBilling.checkOperation(workspaceId, input);
  if (!result.allowed) throw Object.assign(new Error(result.reason), { code: result.reason });
  return result.entitlements;
}

function cloudOnboardingDestination(requestedReturn) {
  let target = cloudAuthHttp.safeReturnPath(requestedReturn);
  const seen = new Set();
  while (!seen.has(target)) {
    seen.add(target);
    const page = new URL(target, CLOUD_AUTH_PUBLIC_ORIGIN);
    if (!['/cloud/start', '/cloud/profile', '/cloud/terms'].includes(page.pathname) || !page.searchParams.has('return')) break;
    target = cloudAuthHttp.safeReturnPath(page.searchParams.get('return'), '/cloud/start');
  }
  return target;
}

function cloudSetupLocation(returnTo) {
  return '/cloud/start?return=' + encodeURIComponent(cloudAuthHttp.safeReturnPath(returnTo));
}

function serveCloudSetupError(res, error, returnTo) {
  const used = error.code === 'trial_already_used';
  serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-setup-error.html'), {
    '__SETUP_TITLE__': used ? 'Your trial has already started' : 'Setup could not be completed',
    '__SETUP_ACTION__': used ? 'Sign in to your account' : 'Try again',
    '__SETUP_URL__': used ? '/cloud/sign-in?return=%2Fcloud%2Fstart' : cloudSetupLocation(returnTo),
    '__SETUP_COPY__': used ? 'This email address has already used a free trial. Sign in with your original method to open your existing library, or view subscription options.'
      : 'Your library could not be prepared. Try again in a moment.',
  }, { 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'" }, used ? 409 : 503);
}

async function completeCloudOnboarding(user) {
      if (cloudBilling) await require('./lib/cloud-library-upgrade').recoverLocal({ billing: cloudBilling, store: cloudStore, userId: user.id });
      if (!user.firstName || !user.lastName) throw Object.assign(new Error('profile_required'), { code: 'profile_required' });
      let workspaces = await cloudStore.listWorkspaces(user.id);
      if (cloudSinglePlan) {
        if (!cloudBilling) throw Object.assign(new Error('billing_not_configured'), { code: 'billing_not_configured' });
        // Attach existing libraries first to preserve the payer and trial deadline.
        for (const workspace of workspaces) {
          if (workspace.role === 'owner') cloudSinglePlan.initialize(user.id, workspace.id, verifiedCloudEmail(user.id));
          else cloudSinglePlan.claim(user.id, workspace.id);
        }
        const personal = await cloudStore.ensurePersonalWorkspace(user.id, 'Personal');
        if (!workspaces.some(workspace => workspace.id === personal.workspaceId)) {
          cloudSinglePlan.initialize(user.id, personal.workspaceId, verifiedCloudEmail(user.id));
        }
        workspaces = await cloudStore.listWorkspaces(user.id);
      } else if (!workspaces.length) {
        if (!cloudBilling) throw Object.assign(new Error('billing_not_configured'), { code: 'billing_not_configured' });
        await cloudStore.ensurePersonalWorkspace(user.id, user.firstName + ' ' + user.lastName);
        workspaces = await cloudStore.listWorkspaces(user.id);
      }
      const personal = workspaces.find(workspace => workspace.kind === 'personal' && workspace.role === 'owner');
      if (personal && cloudBilling && !cloudSinglePlan) cloudBilling.ensurePersonalTrial({ userId: user.id, workspaceId: personal.id, verifiedEmail: verifiedCloudEmail(user.id) });
      return workspaces;
}

function cloudNeedsOnboarding(user) {
  if (!cloudStore || !cloudSinglePlan) return true;
  if (!user.firstName || !user.lastName) return true;
  const memberships = cloudStore.listWorkspaceMemberships(user.id);
  if (!memberships.length) return true;
  if (!memberships.some(workspace => workspace.kind === 'personal' && workspace.role === 'owner')) return true;
  return memberships.some(workspace => {
    const account = cloudSinglePlan.account(workspace.id);
    if (!account) return true;
    return account.owner_user_id === user.id && !cloudBilling.getSubscription(account.id) &&
      !cloudBilling.db.prepare('SELECT 1 FROM cloud_billing_personal_trials WHERE workspace_id=?').get(account.id);
  });
}

async function prepareCloudAccount(user) {
  if (SINGLE_PLAN_ENABLED && cloudNeedsOnboarding(user)) await completeCloudOnboarding(user);
}

async function cloudSignInContinuation(user, requestedReturn) {
  const target = cloudOnboardingDestination(requestedReturn);
  if (!cloudTermsAccepted(user)) return { return_to: cloudTermsLocation(target), onboarding_complete: false };
  if (!SINGLE_PLAN_ENABLED) return { return_to: target };
  if (!user.firstName || !user.lastName) {
    return { return_to: '/cloud/profile?return=' + encodeURIComponent(target), onboarding_complete: false };
  }
  try {
    await prepareCloudAccount(user);
    return { return_to: target, onboarding_complete: true };
  } catch (_) {
    // Authentication remains valid if storage or billing is temporarily down.
    // Setup retries with this session rather than consuming another email code.
    return { return_to: cloudSetupLocation(target), onboarding_complete: false };
  }
}

function redirectForCloudSetup(res, authenticated, returnTo) {
  if (!SINGLE_PLAN_ENABLED || !authenticated.ok || !cloudNeedsOnboarding(authenticated.user)) return false;
  res.writeHead(303, { Location: cloudSetupLocation(returnTo), 'Cache-Control': 'no-store' });
  res.end(); return true;
}

function requireCloudInvitationRate(req, userId, workspaceId) {
  const sourceRate = cloudAuth.consumeRateLimit({ action: 'cloud_invitation_source',
    key: getClientIp(req), limit: Number(process.env.CLOUD_INVITATION_SOURCE_LIMIT) || 30,
    windowMs: Number(process.env.CLOUD_INVITATION_SOURCE_WINDOW_MS) || 60 * 60 * 1000 });
  const workspaceRate = cloudAuth.consumeRateLimit({ action: 'cloud_invitation_workspace',
    key: userId + ':' + workspaceId,
    limit: Number(process.env.CLOUD_INVITATION_WORKSPACE_LIMIT) || 100,
    windowMs: Number(process.env.CLOUD_INVITATION_WORKSPACE_WINDOW_MS) || 24 * 60 * 60 * 1000 });
  if (!sourceRate.allowed || !workspaceRate.allowed) {
    throw Object.assign(new Error('rate_limited'), { code: 'rate_limited' });
  }
}

function requireInvitationEntitlement(userId, workspaceId) {
  if (!cloudSinglePlan) return requireCloudEntitlement(userId, workspaceId, 'add_member');
  const account = cloudSinglePlan.resolveLibrary(workspaceId);
  const covered = cloudSinglePlan.coverage(userId);
  const canJoin = account && cloudSinglePlan.subscriptionAccess(account.id).access.write ||
    covered && cloudSinglePlan.hasSponsoredMembership(userId, covered.account_id) && cloudSinglePlan.subscriptionAccess(covered.account_id).access.write;
  if (!canJoin) throw Object.assign(new Error('subscription_required'), { code: 'subscription_required' });
}

function cloudWorkspaceUsage(userId, workspaceId) {
  const usage = cloudStore.getWorkspaceUsage({ userId, workspaceId, skipAccess: true });
  if (!cloudBilling || !cloudAuth) return usage;
  const entitlements = cloudBilling.computeEntitlements(workspaceId, usage);
  const searchLimits = entitlements && entitlements.limits && entitlements.limits.search;
  if (searchLimits && searchLimits.windowMs) {
    usage.searchRequestsInWindow = cloudAuth.countRateLimit({ action: 'cloud_search_workspace',
      key: userId + ':' + workspaceId, windowMs: searchLimits.windowMs });
  }
  return usage;
}

function cloudMarkdownBytes(markdown) {
  const bytes = Buffer.byteLength(typeof markdown === 'string' ? markdown : '', 'utf8');
  if (bytes > CLOUD_DOCUMENT_MAX_BYTES) {
    throw Object.assign(new Error('file_too_large'), { code: 'file_too_large' });
  }
  return bytes;
}

const seatSyncQueues = new Map();
async function syncTeamSeatQuantity(workspaceId, seatChangeId) {
  const account = cloudSinglePlan && (cloudSinglePlan.account(workspaceId) || cloudSinglePlan.db.prepare('SELECT * FROM cloud_single_accounts WHERE id=?').get(workspaceId));
  const accountId = account ? account.id : workspaceId;
  const prior = seatSyncQueues.get(accountId) || Promise.resolve();
  const next = prior.catch(() => {}).then(() => syncTeamSeatQuantityLocked(accountId, seatChangeId));
  seatSyncQueues.set(accountId, next);
  try { return await next; } finally { if (seatSyncQueues.get(accountId) === next) seatSyncQueues.delete(accountId); }
}

async function syncTeamSeatQuantityLocked(workspaceId, seatChangeId) {
  const changeId = String(seatChangeId || '').trim();
  if (!changeId) throw new Error('seat synchronization change ID is required');
  const account = cloudSinglePlan && (cloudSinglePlan.account(workspaceId) || cloudSinglePlan.db.prepare('SELECT * FROM cloud_single_accounts WHERE id=?').get(workspaceId));
  return syncStripeTeamSeatQuantity({ billing: cloudBilling, stripe: cloudStripe,
    store: cloudStore, workspaceId: account ? account.id : workspaceId,
    quantityOverride: account ? cloudSinglePlan.seatCount(account.id) : undefined,
    idempotencyKey: 'workspace-seats-' + workspaceId + '-' + changeId });
}

function cloudMemberProfile(member) {
  let account = null;
  try { account = cloudAuth.getUser(member.user_id); } catch (_) {}
  const identity = account && account.identities.find((item) => item.verifiedEmail);
  const email = identity ? identity.verifiedEmail : null;
  const name = account && account.firstName && account.lastName
    ? account.firstName + ' ' + account.lastName : email || 'Member';
  const nameParts = name.split(/[._+\-\s]+/).filter(Boolean);
  const firstName = account && account.firstName ? account.firstName : nameParts[0];
  const explicitLastParts = account && account.lastName
    ? account.lastName.split(/\s+/).filter(Boolean) : [];
  const lastName = explicitLastParts.length
    ? explicitLastParts[explicitLastParts.length - 1]
    : (account && account.firstName ? null : nameParts[1]);
  const initials = [firstName, lastName].filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase()).join('') || '?';
  return Object.assign({}, member, { email, name, initials });
}

function cloudUserProfile(user, email) {
  const profile = {
    id: user.id,
    first_name: user.firstName,
    last_name: user.lastName,
    legacy_library_enabled: user.legacyLibraryEnabled,
  };
  if (email !== undefined) profile.email = email;
  return profile;
}

function verifiedCloudEmail(userId) {
  let user = null;
  try { user = cloudAuth.getUser(userId); } catch (_) {}
  const identity = user && user.identities.find((item) => item.verifiedEmail);
  return identity ? identity.verifiedEmail : null;
}

function verifiedCompanyEmails(userId) {
  const { companyDomain } = require('./lib/cloud-join-requests');
  const user = cloudAuth.getUser(userId);
  return [...new Set(user.identities.map(item => item.verifiedEmail).filter(email => companyDomain(email)))];
}

function cloudActorLabel(userId) {
  let user = null;
  try { user = cloudAuth.getUser(userId); } catch (_) {}
  if (user && user.firstName && user.lastName) return user.firstName + ' ' + user.lastName;
  return verifiedCloudEmail(userId) || 'A SmallDocs account member';
}

function cloudReadUnavailable() {
  return Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
}

function cloudRequireDocumentRead(userId, document, options = {}) {
  const projectId = document.project_id || document.project && document.project.id ||
    options.source && options.source.projectId;
  const project = projectId && cloudStore.db.prepare('SELECT workspace_id FROM cloud_projects WHERE id = ?').get(projectId);
  const workspaceId = document.workspace_id || project && project.workspace_id;
  if (!projectId || !workspaceId || options.workspaceId && options.workspaceId !== workspaceId ||
      options.projectId && options.projectId !== projectId || options.source &&
      (options.source.workspaceId !== workspaceId || options.source.projectId !== projectId)) throw cloudReadUnavailable();
  const snapshot = { document_id: document.id, workspace_id: workspaceId, project_id: projectId,
    current_revision_id: document.current_revision_id,
    deleted_at_ms: document.deleted_at == null ? null : Date.parse(document.deleted_at),
    purge_after_ms: document.purge_after == null ? null : Date.parse(document.purge_after) };
  if (!cloudStore._documentReadIsCurrent(userId, snapshot, { includeDeleted: options.includeDeleted,
    onlyDeleted: options.onlyDeleted, requireHead: !options.revisionId,
    revisionId: options.revisionId || document.current_revision_id })) throw cloudReadUnavailable();
  requireCloudEntitlement(userId, workspaceId, 'read');
  return document;
}

async function cloudAccountContext(userId, requestedId) {
  if (SINGLE_PLAN_ENABLED) await prepareCloudAccount(cloudAuth.getUser(userId));
  const workspaces = await cloudStore.listWorkspaces(userId);
  const workspaceRows = new Map(workspaces.map(workspace => [workspace.id,
    cloudStore.db.prepare('SELECT * FROM cloud_workspaces WHERE id = ?').get(workspace.id)]));
  let accounts = [];
  for (const workspace of workspaces) {
    if (cloudSinglePlan && workspace.role === 'owner') cloudSinglePlan.initialize(userId, workspace.id, verifiedCloudEmail(userId));
    if (cloudSinglePlan && cloudSinglePlan.resolveLibrary(workspace.id)) cloudSinglePlan.claim(userId, workspace.id);
    const projects = await cloudStore.listProjects(userId, workspace.id);
    const projectRows = new Map(projects.map(project => [project.id,
      cloudStore.db.prepare('SELECT * FROM cloud_projects WHERE id = ?').get(project.id)]));
    accounts.push({ workspace, projects, projectRows });
  }
  // No awaited work follows this proof of every accumulated account and project.
  accounts = accounts.flatMap(({ workspace, projects, projectRows }) => {
    const current = cloudStore.db.prepare('SELECT * FROM cloud_workspaces WHERE id = ? AND deleted_at_ms IS NULL').get(workspace.id);
    const role = cloudStore._workspaceRole(userId, workspace.id);
    if (!role || !cloudStore._sameReadName(current, workspaceRows.get(workspace.id)) || current.kind !== workspace.kind) return [];
    const project = projects.find(value => projectRows.get(value.id) && cloudStore._projectReadIsCurrent(projectRows.get(value.id)) &&
      cloudStore._projectAccess(userId, workspace.id, value.id) === 'editor');
    const defaultProject = project ? { ...project, role: 'editor' } : null;
    const usage = cloudWorkspaceUsage(userId, workspace.id);
    const billing = cloudSinglePlan ? cloudSinglePlan.entitlements(userId, workspace.id, usage) : cloudBilling ? cloudBilling.computeEntitlements(workspace.id, usage) : null;
    return [{ workspace: { ...workspace, role }, billing, defaultProject }];
  });
  let selected = requestedId ? accounts.find((item) => item.workspace.id === requestedId) : null;
  if (requestedId && !selected) {
    throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
  }
  if (!selected && accounts.length === 1) selected = accounts[0];
  if (!selected && accounts.length > 1) {
    throw Object.assign(new Error('account_selection_required'), {
      code: 'account_selection_required',
      accounts: accounts.map((item) => ({
        id: item.workspace.id,
        name: item.workspace.name,
        can_write: Boolean(item.defaultProject && (!cloudBilling ||
          (item.billing && item.billing.access.write))),
      })),
    });
  }
  if (!selected) throw Object.assign(new Error('account_required'), { code: 'account_required' });
  return {
    selected,
    accounts: accounts.map((item) => ({
      id: item.workspace.id,
      kind: item.workspace.kind,
      name: item.workspace.name,
      role: item.workspace.role,
      plan: item.billing && item.billing.plan,
      subscription_status: item.billing && item.billing.subscriptionStatus,
      can_read: cloudBilling ? Boolean(item.billing && item.billing.access.read) : true,
      can_write: Boolean(item.defaultProject && (!cloudBilling || (item.billing && item.billing.access.write))),
    })),
  };
}

async function cloudJoinReview(user, token) {
  const row = cloudJoinRequests.resolve(token);
  const requesterEmail = verifiedCompanyEmails(row.user_id).find(email => (!row.email || row.email === email) &&
    require('./lib/cloud-join-requests').companyDomain(email) === row.domain);
  const reviewerEmail = verifiedCompanyEmails(user.id).find(email =>
    require('./lib/cloud-join-requests').companyDomain(email) === row.domain);
  const { companyDomain } = require('./lib/cloud-join-requests');
  if (companyDomain(requesterEmail) !== row.domain || companyDomain(reviewerEmail) !== row.domain) {
    throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
  }
  const workspaces = (await cloudStore.listWorkspaces(user.id)).filter(workspace =>
    workspace.kind === 'team' && ['owner', 'admin'].includes(workspace.role));
  if (!workspaces.length) throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
  return { row, workspaces, requesterEmail };
}

async function handleCloudApi(req, res, url) {
  const pathname = url.pathname;
  const base = '/api/cloud/v1';
  try {
    if (req.method === 'POST' && pathname === base + '/cli/device-authorizations') {
      if (!cloudAuthReady(res)) return;
      const body = await cloudAuthHttp.readJson(req);
      const rate = cloudAuth.consumeRateLimit({ action: 'cli_device_issue', key: getClientIp(req),
        limit: 10, windowMs: 15 * 60 * 1000 });
      if (!rate.allowed) return sendJson(res, 429, { ok: false, error: 'rate_limited' });
      const issued = cloudAuth.issueDeviceAuthorization({ displayName: body.display_name });
      sendJson(res, 201, { ok: true, device_code: issued.deviceCode, user_code: issued.userCode,
        verification_uri: CLOUD_AUTH_PUBLIC_ORIGIN + '/cloud/authorize',
        verification_uri_complete: CLOUD_AUTH_PUBLIC_ORIGIN + '/cloud/authorize?user_code=' + encodeURIComponent(issued.userCode),
        expires_in: Math.max(1, Math.floor((issued.expiresAtMs - Date.now()) / 1000)), interval: 2 });
      return;
    }
    if (req.method === 'POST' && pathname === base + '/cli/device-authorizations/token') {
      if (!cloudAuthReady(res)) return;
      const body = await cloudAuthHttp.readJson(req);
      const result = cloudAuth.pollDeviceAuthorization({ deviceCode: body.device_code });
      if (!result.ok) {
        const status = result.reason === 'authorization_pending' ? 428
          : result.reason === 'terms_acceptance_required' ? 403 : 400;
        return sendJson(res, status, { ok: false, error: result.reason });
      }
      sendJson(res, 200, { ok: true, credential_id: result.credentialId, user_id: result.userId,
        access_token: result.accessToken, access_token_expires_at: new Date(result.accessExpiresAtMs).toISOString(),
        refresh_token: result.refreshToken, token_type: 'Bearer' });
      return;
    }
    if (req.method === 'POST' && pathname === base + '/cli/token/refresh') {
      if (!cloudAuthReady(res)) return;
      const body = await cloudAuthHttp.readJson(req);
      const result = cloudAuth.refreshCliCredential({ refreshToken: body.refresh_token, requestId: body.refresh_request_id });
      sendJson(res, 200, { ok: true, credential_id: result.credentialId, user_id: result.userId,
        access_token: result.accessToken, access_token_expires_at: new Date(result.accessExpiresAtMs).toISOString(),
        refresh_token: result.refreshToken, token_type: 'Bearer' });
      return;
    }

    const principal = cloudApiPrincipal(req, res);
    if (!principal || !cloudApiMutationAllowed(req, res)) return;
    const user = principal.user;
    if (req.method === 'POST' && pathname === base + '/trial-feedback') {
      if (!cloudBilling) throw Object.assign(new Error('billing_not_configured'), { code: 'billing_not_configured' });
      const body = await cloudAuthHttp.readJson(req);
      if (typeof body.comment !== 'string' || !body.comment.trim() || body.comment.length > 10000) {
        throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
      }
      const feedback = cloudBilling.recordTrialFeedback({ userId: user.id, comment: body.comment, rating: body.rating });
      sendJson(res, 200, { ok: true, feedback });
      return;
    }
    if (cloudSinglePlan && /^\/api\/cloud\/v1\/(?:documents|search|projects|account\/(?:documents|tags|permission-groups))(?:\/|$)/.test(pathname) &&
        cloudSubscriptionState(user.id).phase === 'payment_required') {
      throw Object.assign(new Error('trial_payment_required'), { code: 'trial_payment_required' });
    }
    const credentialId = principal.credential && principal.credential.id;

    if (req.method === 'GET' && pathname === base + '/cli/device-authorizations/lookup') {
      const authorization = cloudAuth.getDeviceAuthorization(url.searchParams.get('user_code'));
      if (!authorization) throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
      sendJson(res, 200, { ok: true, authorization: {
        user_code: authorization.userCode, display_name: authorization.displayName,
        expires_at: new Date(authorization.expiresAtMs).toISOString(),
      } });
      return;
    }
    if (req.method === 'POST' && pathname === base + '/cli/device-authorizations/approve') {
      const body = await cloudAuthHttp.readJson(req);
      if (SINGLE_PLAN_ENABLED) {
        const authorization = cloudAuth.getDeviceAuthorization(body.user_code);
        if (!authorization || authorization.approved || authorization.denied || authorization.consumed) {
          throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
        }
        await completeCloudOnboarding(user);
      }
      cloudAuth.approveDeviceAuthorization({ userCode: body.user_code, userId: user.id });
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/cli/credentials') {
      sendJson(res, 200, { ok: true, credentials: cloudAuth.listCliCredentials(user.id).map(c => ({ ...c, default_library_id: cloudStore.machineLibraryDefault(user.id, c.id) })) });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/library-settings') {
      await prepareCloudAccount(user);
      sendJson(res, 200, { ok: true, single_plan: SINGLE_PLAN_ENABLED,
        libraries: await cloudStore.listWorkspaces(user.id),
        machines: cloudAuth.listCliCredentials(user.id).filter(c => c.revokedAtMs == null).map(c => ({ id: c.id,
          display_name: c.displayName, default_library_id: cloudStore.machineLibraryDefault(user.id, c.id) })) }); return;
    }
    if (req.method === 'GET' && pathname === base + '/cli/library-default') {
      if (!credentialId) throw Object.assign(new Error('permission_denied'), { code: 'permission_denied' });
      sendJson(res, 200, { ok: true, workspace_id: cloudStore.machineLibraryDefault(user.id, credentialId) }); return;
    }
    const defaultMatch = pathname.match(/^\/api\/cloud\/v1\/cli\/credentials\/([^/]+)\/library-default$/);
    if (defaultMatch && req.method === 'PATCH') {
      const machine = cloudAuth.listCliCredentials(user.id).find(c => c.id === defaultMatch[1] && c.revokedAtMs == null);
      if (!machine) throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
      const body = await cloudAuthHttp.readJson(req);
      const workspaceId = cloudStore.setMachineLibraryDefault(user.id, machine.id, body.workspace_id || null);
      sendJson(res, 200, { ok: true, workspace_id: workspaceId }); return;
    }
    const moveMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/library$/);
    if (moveMatch && req.method === 'POST') {
      const source = cloudStore.getDocumentContext({ userId: user.id, documentId: moveMatch[1], requiredRole: 'editor' });
      const body = await cloudAuthHttp.readJson(req);
      const context = await cloudAccountContext(user.id, body.workspace_id);
      const project = context.selected.defaultProject;
      if (!body.workspace_id || !project) throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
      const bytes = cloudStore.db.prepare('SELECT COALESCE(SUM(compressed_size + length(metadata_ciphertext)),0) AS n FROM cloud_document_revisions WHERE document_id=?').get(moveMatch[1]).n;
      const check = () => {
        requireCloudEntitlement(user.id, source.workspaceId, 'read');
        requireCloudEntitlement(user.id, context.selected.workspace.id, 'store_revision', { fileBytes: 0, storedBytesDelta: bytes });
      };
      check();
      const document = await cloudStore.moveDocument({ userId: user.id, documentId: moveMatch[1], projectId: project.id,
        expectedHeadRevisionId: body.expected_head_revision_id, beforeCommit: check });
      sendJson(res, 200, { ok: true, document, permission: cloudStore.getDocumentPermission({ userId: user.id, documentId: document.id }) }); return;
    }
    const credentialMatch = pathname.match(/^\/api\/cloud\/v1\/cli\/credentials\/([^/]+)$/);
    if (credentialMatch && req.method === 'DELETE') {
      cloudAuth.revokeCliCredential({ userId: user.id, credentialId: credentialMatch[1] });
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/onboarding') {
      if (cloudBilling) await require('./lib/cloud-library-upgrade').recoverLocal({ billing: cloudBilling, store: cloudStore, userId: user.id });
      const row = cloudJoinRequests.own(user.id);
      const request = row && cloudJoinRequests.view(row);
      if (request && request.status === 'pending') request.handoff_url = CLOUD_AUTH_PUBLIC_ORIGIN + '/cloud/join-request?token=' + encodeURIComponent(cloudJoinRequests.token(row));
      sendJson(res, 200, { ok: true, user: cloudUserProfile(user, verifiedCloudEmail(user.id)),
        workspaces: await cloudStore.listWorkspaces(user.id),
        company_domain: require('./lib/cloud-join-requests').companyDomain(verifiedCompanyEmails(user.id)[0]),
        company_emails: verifiedCompanyEmails(user.id), request });
      return;
    }
    if (req.method === 'POST' && pathname === base + '/onboarding/complete') {
      const workspaces = await completeCloudOnboarding(user);
      sendJson(res, 200, { ok: true, single_plan: SINGLE_PLAN_ENABLED, workspaces });
      return;
    }
    if (req.method === 'POST' && (pathname === base + '/team-upgrade/preview' || pathname === base + '/team-upgrade/confirm')) {
      requireRecentBrowser(principal);
      if (!cloudBilling) throw Object.assign(new Error('billing_not_configured'), { code: 'billing_not_configured' });
      const body = await cloudAuthHttp.readJson(req);
      if (cloudSinglePlan) throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
      const upgrade = require('./lib/cloud-library-upgrade');
      const result = await upgrade[pathname.endsWith('/preview') ? 'preview' : 'confirm']({
        billing: cloudBilling, store: cloudStore, stripe: cloudStripe,
        workspaceId: body.workspace_id, name: body.name, operationId: body.operation_id,
        teamPriceId: process.env.STRIPE_TEAM_PRICE_ID, userId: user.id,
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    if (req.method === 'POST' && pathname === base + '/onboarding/personal') {
      requireRecentBrowser(principal);
      if (!user.firstName || !user.lastName) throw Object.assign(new Error('profile_required'), { code: 'profile_required' });
      if (!cloudBilling) throw Object.assign(new Error('billing_not_configured'), { code: 'billing_not_configured' });
      const workspace = await cloudStore.ensurePersonalWorkspace(user.id, user.firstName + ' ' + user.lastName);
      const trial = cloudBilling.ensurePersonalTrial({ userId: user.id, workspaceId: workspace.workspaceId, verifiedEmail: verifiedCloudEmail(user.id) });
      sendJson(res, 200, { ok: true, workspace_id: workspace.workspaceId, trial_ends_at_ms: trial.endsAtMs });
      return;
    }
    if (req.method === 'POST' && pathname === base + '/join-requests') {
      requireRecentBrowser(principal);
      if (!user.firstName || !user.lastName) throw Object.assign(new Error('profile_required'), { code: 'profile_required' });
      const body = await cloudAuthHttp.readJson(req);
      const rate = cloudAuth.consumeRateLimit({ action: 'join_request', key: user.id, limit: 10, windowMs: 60 * 60 * 1000 });
      if (!rate.allowed) throw Object.assign(new Error('rate_limited'), { code: 'rate_limited' });
      const companyEmails = verifiedCompanyEmails(user.id);
      const email = body.email ? String(body.email).trim().toLowerCase() : companyEmails.length === 1 ? companyEmails[0] : null;
      if (!email || !companyEmails.includes(email)) throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
      const request = cloudJoinRequests.create({ userId: user.id, email,
        consented: body.consented === true, note: body.note });
      request.handoff_url = CLOUD_AUTH_PUBLIC_ORIGIN + '/cloud/join-request?token=' + encodeURIComponent(request.token);
      delete request.token;
      sendJson(res, 200, { ok: true, request });
      return;
    }
    const cancelJoin = pathname.match(/^\/api\/cloud\/v1\/join-requests\/([^/]+)$/);
    if (cancelJoin && req.method === 'DELETE') {
      cloudJoinRequests.cancel(user.id, cancelJoin[1]);
      sendJson(res, 200, { ok: true }); return;
    }
    if (req.method === 'GET' && pathname === base + '/join-requests/review') {
      const review = await cloudJoinReview(user, url.searchParams.get('token'));
      const requester = cloudAuth.getUser(review.row.user_id);
      sendJson(res, 200, { ok: true, request: { name: [requester.firstName, requester.lastName].filter(Boolean).join(' '),
        email: review.requesterEmail, note: review.row.note },
        workspaces: review.workspaces.map(workspace => ({ id: workspace.id, name: workspace.name })) });
      return;
    }
    if (req.method === 'POST' && pathname === base + '/join-requests/invite') {
      requireRecentBrowser(principal);
      const body = await cloudAuthHttp.readJson(req);
      const review = await cloudJoinReview(user, body.token);
      const workspace = review.workspaces.find(item => item.id === body.workspace_id);
      if (!workspace) throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
      const project = (await cloudStore.listProjects(user.id, workspace.id)).find(item => item.role === 'editor');
      if (!project) throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
      requireCloudEntitlement(user.id, workspace.id, 'manage');
      const invitation = await cloudStore.createInvitation({ userId: user.id, workspaceId: workspace.id,
        email: review.requesterEmail, role: 'member', requestKey: review.row.id,
        projectGrants: [{ projectId: project.id, role: 'editor' }],
        beforeCommit: () => {
          cloudJoinRequests.resolve(body.token);
          const companyDomain = require('./lib/cloud-join-requests').companyDomain;
          if (!verifiedCompanyEmails(user.id).some(email => companyDomain(email) === review.row.domain) ||
              !verifiedCompanyEmails(review.row.user_id).includes(review.requesterEmail)) {
            throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
          }
          requireCloudEntitlement(user.id, workspace.id, 'manage');
        } });
      cloudJoinRequests.recordInvitation(review.row.id, workspace.id, invitation.id);
      const acceptUrl = CLOUD_AUTH_PUBLIC_ORIGIN + '/cloud/invite?token=' + encodeURIComponent(invitation.token);
      if (cloudJobs) enqueueCloudJob({ type: 'invitation_email', idempotencyKey: invitation.id,
        payload: { email: invitation.email, acceptUrl, inviter: cloudActorLabel(user.id), accountName: workspace.name } });
      sendJson(res, 200, { ok: true, invitation: { id: invitation.id, accept_url: acceptUrl,
        notification_scheduled: Boolean(cloudJobs) } });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/workspaces') {
      await prepareCloudAccount(user);
      sendJson(res, 200, { ok: true, single_plan: SINGLE_PLAN_ENABLED, workspaces: await cloudStore.listWorkspaces(user.id),
        user: cloudUserProfile(user) });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/workspaces/deleted') {
      sendJson(res, 200, { ok: true, workspaces: await cloudStore.listDeletedWorkspaces(user.id) });
      return;
    }
    if (req.method === 'POST' && pathname === base + '/workspaces') {
      const sourceRate = cloudAuth.consumeRateLimit({ action: 'cloud_workspace_create_source',
        key: getClientIp(req), limit: Number(process.env.CLOUD_WORKSPACE_CREATE_SOURCE_LIMIT) || 10,
        windowMs: Number(process.env.CLOUD_WORKSPACE_CREATE_SOURCE_WINDOW_MS) || 60 * 60 * 1000 });
      const userRate = cloudAuth.consumeRateLimit({ action: 'cloud_workspace_create_user',
        key: user.id, limit: Number(process.env.CLOUD_WORKSPACE_CREATE_USER_LIMIT) || 5,
        windowMs: Number(process.env.CLOUD_WORKSPACE_CREATE_USER_WINDOW_MS) || 24 * 60 * 60 * 1000 });
      if (!sourceRate.allowed || !userRate.allowed) {
        throw Object.assign(new Error('rate_limited'), { code: 'rate_limited' });
      }
      const body = await cloudAuthHttp.readJson(req);
      const kind = cloudSinglePlan ? 'team' : body.kind === 'personal' || body.kind === 'team' ? body.kind : null;
      if (!kind) throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
      if (kind === 'personal') {
        const profileName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Cloud';
        const workspace = await cloudStore.ensurePersonalWorkspace(user.id, profileName);
        sendJson(res, workspace.created ? 201 : 200, { ok: true, workspace });
        return;
      }
      const identity = user.identities.find((item) => item.verifiedEmail) || null;
      const { defaultInviteDomainFromEmail } = require('./lib/cloud-store');
      const inviteDomain = defaultInviteDomainFromEmail(
        identity ? identity.verifiedEmail : null);
      const workspace = await cloudStore.createTeamWorkspace({
        userId: user.id, name: body.name, projectName: body.project_name || 'Documents',
        inviteDomains: inviteDomain ? [inviteDomain] : [],
      });
      if (cloudSinglePlan) cloudSinglePlan.initialize(user.id, workspace.workspaceId, verifiedCloudEmail(user.id));
      sendJson(res, 201, { ok: true, workspace });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/me') {
      const identity = user.identities.find((item) => item.verifiedEmail) || null;
      sendJson(res, 200, { ok: true,
        single_plan: SINGLE_PLAN_ENABLED, google_enabled: Boolean(cloudGoogleOAuth),
        sign_in_methods: user.identities.map(item => ({ provider: item.provider, email: item.verifiedEmail })),
        user: cloudUserProfile(user, identity ? identity.verifiedEmail : null) });
      return;
    }
    if (req.method === 'PATCH' && pathname === base + '/me/preferences') {
      const body = await cloudAuthHttp.readJson(req);
      const updated = cloudAuth.updateLibraryPreference(user.id, body.legacy_library_enabled);
      sendJson(res, 200, { ok: true, user: cloudUserProfile(updated) });
      return;
    }
    if (req.method === 'PATCH' && pathname === base + '/me') {
      const body = await cloudAuthHttp.readJson(req);
      const updated = cloudAuth.updateUserProfile({ userId: user.id,
        firstName: body.first_name, lastName: body.last_name });
      const continuation = await cloudSignInContinuation(updated, body.return_to || '/cloud/start');
      sendJson(res, 200, { ok: true, user: cloudUserProfile(updated), ...continuation });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/account') {
      const context = await cloudAccountContext(user.id, url.searchParams.get('account_id') || (credentialId && cloudStore.machineLibraryDefault(user.id, credentialId)) || null);
      const selected = context.selected;
      const identity = user.identities.find((item) => item.verifiedEmail) || null;
      sendJson(res, 200, { ok: true, account: {
        id: selected.workspace.id,
        kind: selected.workspace.kind,
        name: selected.workspace.name,
        role: selected.workspace.role,
        plan: selected.billing && selected.billing.plan,
        subscription_status: selected.billing && selected.billing.subscriptionStatus,
        can_read: cloudBilling ? Boolean(selected.billing && selected.billing.access.read) : true,
        can_write: Boolean(selected.defaultProject && (!cloudBilling ||
          (selected.billing && selected.billing.access.write))),
        can_create_document: Boolean(selected.defaultProject && (!cloudBilling ||
          (selected.billing && selected.billing.access.write))),
        write_entitlement: !cloudBilling || Boolean(selected.billing && selected.billing.access.write),
        can_edit_shared_documents: Boolean((!cloudBilling ||
          (selected.billing && selected.billing.access.write)) &&
          cloudStore.canEditSharedDocuments(user.id, selected.workspace.id)),
      }, accounts: context.accounts,
      single_plan: SINGLE_PLAN_ENABLED, user: cloudUserProfile(user, identity ? identity.verifiedEmail : null) });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/account/members') {
      const context = await cloudAccountContext(user.id, url.searchParams.get('account_id'));
      const members = cloudStore.listAccountMembers({ userId: user.id,
        workspaceId: context.selected.workspace.id }).map(cloudMemberProfile);
      sendJson(res, 200, { ok: true, account_id: context.selected.workspace.id, members });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/account/tags') {
      const context = await cloudAccountContext(user.id, url.searchParams.get('account_id'));
      const tags = await cloudStore.listTags({ userId: user.id,
        workspaceId: context.selected.workspace.id,
        beforeReturn: () => requireCloudEntitlement(user.id, context.selected.workspace.id, 'read') });
      sendJson(res, 200, { ok: true, account_id: context.selected.workspace.id, tags });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/account/permission-groups') {
      const context = await cloudAccountContext(user.id, url.searchParams.get('account_id'));
      const groups = cloudStore.listPermissionGroups({ userId: user.id,
        workspaceId: context.selected.workspace.id });
      sendJson(res, 200, { ok: true, account_id: context.selected.workspace.id,
        permission_groups: groups });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/account/invite-policy') {
      const context = await cloudAccountContext(user.id, url.searchParams.get('account_id'));
      if ((!cloudSinglePlan && context.selected.workspace.kind !== 'team')) {
        throw Object.assign(new Error('permission_denied'), { code: 'permission_denied' });
      }
      const policy = cloudStore.getWorkspaceInvitePolicy({ userId: user.id,
        workspaceId: context.selected.workspace.id });
      sendJson(res, 200, { ok: true, account_id: context.selected.workspace.id, policy });
      return;
    }
    if (req.method === 'PATCH' && pathname === base + '/account/invite-policy') {
      requireRecentBrowser(principal);
      const body = await cloudAuthHttp.readJson(req);
      const context = await cloudAccountContext(user.id, body.account_id || null);
      if ((!cloudSinglePlan && context.selected.workspace.kind !== 'team')) {
        throw Object.assign(new Error('permission_denied'), { code: 'permission_denied' });
      }
      requireCloudEntitlement(user.id, context.selected.workspace.id, 'manage');
      const policy = cloudStore.setWorkspaceInviteDomains({ userId: user.id,
        workspaceId: context.selected.workspace.id, domains: body.domains,
        beforeCommit: () => requireCloudEntitlement(
          user.id, context.selected.workspace.id, 'manage'),
      });
      sendJson(res, 200, { ok: true, account_id: context.selected.workspace.id, policy });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/account/invitations') {
      const context = await cloudAccountContext(user.id, url.searchParams.get('account_id'));
      if ((!cloudSinglePlan && context.selected.workspace.kind !== 'team')) {
        throw Object.assign(new Error('permission_denied'), { code: 'permission_denied' });
      }
      requireCloudEntitlement(user.id, context.selected.workspace.id, 'manage');
      const invitations = await cloudStore.listWorkspaceInvitations({
        userId: user.id, workspaceId: context.selected.workspace.id,
      });
      requireCloudEntitlement(user.id, context.selected.workspace.id, 'manage');
      sendJson(res, 200, { ok: true, account_id: context.selected.workspace.id, invitations });
      return;
    }
    if (req.method === 'POST' && pathname === base + '/account/documents') {
      const body = await cloudAuthHttp.readJson(req, CLOUD_DOCUMENT_JSON_MAX_BYTES);
      const defaultId = credentialId ? cloudStore.machineLibraryDefault(user.id, credentialId) : null;
      const context = await cloudAccountContext(user.id, body.account_id || defaultId || null);
      const selected = context.selected;
      if (!selected.defaultProject) {
        throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
      }
      const entitlements = requireCloudEntitlement(user.id, selected.workspace.id, 'store_revision', {
        fileBytes: cloudMarkdownBytes(body.markdown),
      });
      const document = await cloudStore.createDocument({
        userId: user.id, projectId: selected.defaultProject.id, filename: body.filename, sourceFile: body.source_file,
        markdown: body.markdown, idempotencyKey: body.idempotency_key, credentialId,
        beforeCommit: () => requireCloudEntitlement(user.id, selected.workspace.id, 'store_revision', {
          fileBytes: cloudMarkdownBytes(body.markdown),
        }),
      });
      scheduleRevisionPrune(document, entitlements);
      const permission = cloudStore.getDocumentPermission({ userId: user.id, documentId: document.id });
      sendJson(res, 201, { ok: true, account: { id: selected.workspace.id,
        kind: selected.workspace.kind, name: selected.workspace.name }, document, permission });
      return;
    }
    if (req.method === 'POST' && pathname === base + '/account/invitations') {
      requireAccountManager(principal);
      const body = await cloudAuthHttp.readJson(req);
      const context = await cloudAccountContext(user.id, body.account_id || null);
      const selected = context.selected;
      if ((!cloudSinglePlan && selected.workspace.kind !== 'team') || !selected.defaultProject) {
        throw Object.assign(new Error('permission_denied'), { code: 'permission_denied' });
      }
      requireCloudInvitationRate(req, user.id, selected.workspace.id);
      requireCloudEntitlement(user.id, selected.workspace.id, 'manage');
      const invitation = await cloudStore.createInvitation({
        userId: user.id, workspaceId: selected.workspace.id, email: body.email,
        role: body.role || 'member',
        allowMemberInvite: true,
        projectGrants: [{ projectId: selected.defaultProject.id, role: 'editor' }],
        beforeCommit: () => requireCloudEntitlement(user.id, selected.workspace.id, 'manage'),
      });
      const acceptUrl = CLOUD_AUTH_PUBLIC_ORIGIN + '/cloud/invite?token=' + encodeURIComponent(invitation.token);
      if (cloudJobs) enqueueCloudJob({ type: 'invitation_email', idempotencyKey: invitation.id,
        payload: { email: invitation.email, acceptUrl, inviter: cloudActorLabel(user.id),
          accountName: selected.workspace.name } });
      sendJson(res, 201, { ok: true, invitation: { id: invitation.id,
        email: invitation.email, role: invitation.role,
        expires_at: new Date(invitation.expiresAtMs).toISOString(),
        notification_scheduled: Boolean(cloudJobs), accept_url: acceptUrl } });
      return;
    }
    const accountInvitationMatch = pathname.match(
      /^\/api\/cloud\/v1\/account\/invitations\/([^/]+)$/);
    if (accountInvitationMatch && req.method === 'DELETE') {
      requireAccountManager(principal);
      const body = await cloudAuthHttp.readJson(req);
      const context = await cloudAccountContext(user.id, body.account_id || null);
      if ((!cloudSinglePlan && context.selected.workspace.kind !== 'team')) {
        throw Object.assign(new Error('permission_denied'), { code: 'permission_denied' });
      }
      requireCloudEntitlement(user.id, context.selected.workspace.id, 'manage');
      const invitation = cloudStore.revokeWorkspaceInvitation({ userId: user.id,
        workspaceId: context.selected.workspace.id, invitationId: accountInvitationMatch[1] });
      sendJson(res, 200, { ok: true, invitation });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/projects') {
      const workspaceId = url.searchParams.get('workspace_id');
      sendJson(res, 200, { ok: true, projects: await cloudStore.listProjects(user.id, workspaceId) });
      return;
    }
    const workspaceProjectsMatch = pathname.match(/^\/api\/cloud\/v1\/workspaces\/([^/]+)\/projects$/);
    if (workspaceProjectsMatch && req.method === 'GET') {
      sendJson(res, 200, { ok: true,
        projects: await cloudStore.listProjects(user.id, workspaceProjectsMatch[1]) });
      return;
    }
    const workspaceBillingMatch = pathname.match(/^\/api\/cloud\/v1\/workspaces\/([^/]+)\/billing$/);
    if (workspaceBillingMatch && req.method === 'GET') {
      const role = (await cloudStore.listWorkspaces(user.id)).find((workspace) =>
        workspace.id === workspaceBillingMatch[1]);
      if (!role) throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
      const usage = cloudWorkspaceUsage(user.id, workspaceBillingMatch[1]);
      const entitlements = cloudSinglePlan ? cloudSinglePlan.entitlements(user.id, workspaceBillingMatch[1], usage) : cloudBilling ? cloudBilling.computeEntitlements(workspaceBillingMatch[1], usage) : null;
      const ownAccount = cloudSinglePlan && cloudSinglePlan.ownAccount(user.id);
      const subscription = cloudBilling && cloudBilling.getSubscription(cloudSinglePlan ? ownAccount && ownAccount.id || '__none__' : workspaceBillingMatch[1]);
      const billing = entitlements && Object.assign({}, entitlements, {
        single_plan: SINGLE_PLAN_ENABLED, covered: entitlements.covered,
        sponsored_seats: ownAccount ? cloudSinglePlan.seatCount(ownAccount.id) : null,
        legacy_price: Boolean(cloudSinglePlan && subscription && subscription.provider === 'stripe' &&
          ownAccount.standard_subscription_id !== subscription.providerSubscriptionId),
        canManagePayment: Boolean(subscription && subscription.providerCustomerId),
      });
      sendJson(res, 200, { ok: true, billing });
      return;
    }
    const workspaceBillingPortalMatch = pathname.match(/^\/api\/cloud\/v1\/workspaces\/([^/]+)\/billing\/portal$/);
    if (workspaceBillingPortalMatch && req.method === 'POST') {
      requireRecentBrowser(principal);
      if (!cloudStripe || !cloudBilling) throw Object.assign(new Error('billing_not_configured'),
        { code: 'billing_not_configured' });
      const workspace = (await cloudStore.listWorkspaces(user.id)).find((item) =>
        item.id === workspaceBillingPortalMatch[1] && (cloudSinglePlan || item.role === 'owner'));
      const ownAccount = cloudSinglePlan && cloudSinglePlan.ownAccount(user.id);
      const subscription = workspace && cloudBilling.getSubscription(cloudSinglePlan ? ownAccount && ownAccount.id || '__none__' : workspace.id);
      if (!subscription || !subscription.providerCustomerId) {
        throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
      }
      const portal = await cloudStripe.createBillingPortalSession({
        customerId: subscription.providerCustomerId,
        returnUrl: CLOUD_AUTH_PUBLIC_ORIGIN + '/cloud/admin?workspace_id=' + encodeURIComponent(workspace.id),
        configurationId: process.env.STRIPE_PORTAL_CONFIGURATION_ID,
        idempotencyKey: crypto.randomUUID(),
      });
      sendJson(res, 200, { ok: true, portal_url: portal.url });
      return;
    }
    if (workspaceProjectsMatch && req.method === 'POST') {
      const body = await cloudAuthHttp.readJson(req);
      requireCloudEntitlement(user.id, workspaceProjectsMatch[1], 'create_project');
      const project = await cloudStore.createProject({
        userId: user.id, workspaceId: workspaceProjectsMatch[1], name: body.name,
        beforeCommit: () => requireCloudEntitlement(
          user.id, workspaceProjectsMatch[1], 'create_project'),
      });
      sendJson(res, 201, { ok: true, project });
      return;
    }
    const workspaceMembersMatch = pathname.match(/^\/api\/cloud\/v1\/workspaces\/([^/]+)\/members$/);
    if (workspaceMembersMatch && req.method === 'GET') {
      const members = cloudStore.listWorkspaceMembers({
        userId: user.id, workspaceId: workspaceMembersMatch[1],
      }).map((member) => {
        let account = null;
        try { account = cloudAuth.getUser(member.user_id); } catch (_) {}
        const identity = account && account.identities.find((item) => item.verifiedEmail);
        return { ...member, email: identity ? identity.verifiedEmail : null };
      });
      sendJson(res, 200, { ok: true, members });
      return;
    }
    const workspaceAuditMatch = pathname.match(/^\/api\/cloud\/v1\/workspaces\/([^/]+)\/audit$/);
    if (workspaceAuditMatch && req.method === 'GET') {
      sendJson(res, 200, { ok: true, events: cloudStore.listAuditEvents({
        userId: user.id, workspaceId: workspaceAuditMatch[1], limit: url.searchParams.get('limit'),
      }) });
      return;
    }
    const workspaceExportMatch = pathname.match(/^\/api\/cloud\/v1\/workspaces\/([^/]+)\/export$/);
    if (workspaceExportMatch && req.method === 'POST') {
      requireRecentBrowser(principal);
      requireCloudEntitlement(user.id, workspaceExportMatch[1], 'read');
      const exported = await cloudStore.exportWorkspace({ userId: user.id,
        workspaceId: workspaceExportMatch[1], includeRevisions: true });
      cloudStore._requireWorkspaceRole(user.id, workspaceExportMatch[1], ['owner']);
      requireCloudEntitlement(user.id, workspaceExportMatch[1], 'read');
      exported.documents = exported.documents.filter(document => {
        try {
          cloudRequireDocumentRead(user.id, document, { workspaceId: workspaceExportMatch[1] });
          document.revisions = document.revisions.filter(revision => {
            try {
              cloudRequireDocumentRead(user.id, revision, { workspaceId: workspaceExportMatch[1],
                revisionId: revision.current_revision_id, includeDeleted: true });
              return true;
            } catch (_) { return false; }
          });
          return true;
        } catch (_) { return false; }
      });
      sendJson(res, 200, { ok: true, export: exported }, {
        'Content-Disposition': 'attachment; filename="smalldocs-cloud-export.json"',
      });
      return;
    }
    const workspaceInvitationsMatch = pathname.match(/^\/api\/cloud\/v1\/workspaces\/([^/]+)\/invitations$/);
    if (workspaceInvitationsMatch && req.method === 'GET') {
      sendJson(res, 200, { ok: true, invitations: await cloudStore.listWorkspaceInvitations({
        userId: user.id, workspaceId: workspaceInvitationsMatch[1],
      }) });
      return;
    }
    if (workspaceInvitationsMatch && req.method === 'POST') {
      requireAccountManager(principal);
      requireCloudInvitationRate(req, user.id, workspaceInvitationsMatch[1]);
      const body = await cloudAuthHttp.readJson(req);
      requireCloudEntitlement(user.id, workspaceInvitationsMatch[1], 'manage');
      const invitation = await cloudStore.createInvitation({
        userId: user.id, workspaceId: workspaceInvitationsMatch[1], email: body.email,
        role: body.role, projectGrants: Array.isArray(body.project_grants) ?
          body.project_grants.map((grant) => ({ projectId: grant.project_id || grant.projectId,
            role: grant.role })) : [],
        beforeCommit: () => requireCloudEntitlement(
          user.id, workspaceInvitationsMatch[1], 'manage'),
      });
      const acceptUrl = CLOUD_AUTH_PUBLIC_ORIGIN + '/cloud/invite?token=' + encodeURIComponent(invitation.token);
      const notificationScheduled = body.send_email !== false;
      if (notificationScheduled && cloudJobs) {
        const invitedWorkspace = (await cloudStore.listWorkspaces(user.id))
          .find((workspace) => workspace.id === workspaceInvitationsMatch[1]);
        enqueueCloudJob({ type: 'invitation_email', idempotencyKey: invitation.id,
          payload: { email: invitation.email, acceptUrl, inviter: cloudActorLabel(user.id),
            accountName: invitedWorkspace ? invitedWorkspace.name : 'a SmallDocs account' } });
      } else if (notificationScheduled && teamsNotify.isConfigured()) {
        const invitedWorkspace = (await cloudStore.listWorkspaces(user.id))
          .find((workspace) => workspace.id === workspaceInvitationsMatch[1]);
        const message = emailTemplates.workspaceInvitation({ acceptUrl,
          inviter: cloudActorLabel(user.id),
          accountName: invitedWorkspace ? invitedWorkspace.name : 'a SmallDocs account' });
        const delivered = await teamsNotify.sendTo(invitation.email, message.subject,
          message.text, message.html);
        if (!delivered.ok) console.error('[cloud-invitation] email delivery failed');
      }
      sendJson(res, 201, { ok: true, invitation: {
        id: invitation.id, email: invitation.email, role: invitation.role,
        project_grants: invitation.projectGrants,
        expires_at: new Date(invitation.expiresAtMs).toISOString(),
        notification_scheduled: notificationScheduled,
        accept_url: acceptUrl,
      } });
      return;
    }
    const workspaceInvitationMatch = pathname.match(
      /^\/api\/cloud\/v1\/workspaces\/([^/]+)\/invitations\/([^/]+)$/);
    if (workspaceInvitationMatch && req.method === 'DELETE') {
      requireAccountManager(principal);
      const invitation = cloudStore.revokeWorkspaceInvitation({
        userId: user.id, workspaceId: workspaceInvitationMatch[1],
        invitationId: workspaceInvitationMatch[2],
      });
      sendJson(res, 200, { ok: true, invitation });
      return;
    }
    const workspaceMemberMatch = pathname.match(/^\/api\/cloud\/v1\/workspaces\/([^/]+)\/members\/([^/]+)$/);
    if (workspaceMemberMatch && req.method === 'DELETE') {
      requireAccountManager(principal);
      cloudStore.removeWorkspaceMember({ actorUserId: user.id,
        workspaceId: workspaceMemberMatch[1], userId: workspaceMemberMatch[2] });
      const seatChangeId = crypto.randomUUID();
      try { await syncTeamSeatQuantity(workspaceMemberMatch[1], seatChangeId); }
      catch (_) {
        console.error('[cloud-billing] seat synchronization queued');
      }
      scheduleTeamSeatSync(workspaceMemberMatch[1], seatChangeId);
      sendJson(res, 200, { ok: true });
      return;
    }
    const workspaceOwnersMatch = pathname.match(/^\/api\/cloud\/v1\/workspaces\/([^/]+)\/owners$/);
    if (workspaceOwnersMatch && req.method === 'POST') {
      requireRecentBrowser(principal);
      const body = await cloudAuthHttp.readJson(req);
      const ownership = cloudStore.transferWorkspaceOwnership({
        actorUserId: user.id, workspaceId: workspaceOwnersMatch[1], targetUserId: body.user_id,
      });
      sendJson(res, 200, { ok: true, ownership });
      return;
    }
    const workspaceRestoreMatch = pathname.match(/^\/api\/cloud\/v1\/workspaces\/([^/]+)\/restore$/);
    if (workspaceRestoreMatch && req.method === 'POST') {
      requireRecentBrowser(principal);
      const restored = cloudStore.restoreWorkspace({
        userId: user.id, workspaceId: workspaceRestoreMatch[1],
      });
      sendJson(res, 200, { ok: true, workspace: restored });
      return;
    }
    const workspaceMatch = pathname.match(/^\/api\/cloud\/v1\/workspaces\/([^/]+)$/);
    if (workspaceMatch && req.method === 'DELETE') {
      requireRecentBrowser(principal);
      const visibleWorkspace = (await cloudStore.listWorkspaces(user.id)).find((workspace) =>
        workspace.id === workspaceMatch[1]);
      if (!visibleWorkspace) {
        throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
      }
      if (visibleWorkspace.role !== 'owner') {
        throw Object.assign(new Error('permission_denied'), { code: 'permission_denied' });
      }
      const subscription = cloudBilling && cloudBilling.getSubscription(workspaceMatch[1]);
      if (subscription && subscription.provider === 'stripe' &&
          ['active', 'past_due'].includes(subscription.status)) {
        throw Object.assign(new Error('active_subscription_requires_cancellation'),
          { code: 'active_subscription_requires_cancellation' });
      }
      const configuredWindow = Number(process.env.CLOUD_WORKSPACE_RESTORE_WINDOW_MS);
      const deleted = cloudStore.deleteWorkspace({
        userId: user.id, workspaceId: workspaceMatch[1],
        restoreWindowMs: Number.isSafeInteger(configuredWindow) && configuredWindow > 0
          ? configuredWindow : undefined,
      });
      enqueueCloudJob({ type: 'workspace_purge',
        idempotencyKey: deleted.id + ':' + deleted.purge_after,
        payload: { workspaceId: deleted.id }, availableAtMs: deleted.purge_after_ms });
      sendJson(res, 200, { ok: true, workspace: {
        id: deleted.id, deleted_at: deleted.deleted_at, purge_after: deleted.purge_after,
      } });
      return;
    }
    const invitationDetailsMatch = pathname.match(/^\/api\/cloud\/v1\/invitations\/([^/]+)$/);
    if (invitationDetailsMatch && req.method === 'GET') {
      const invitation = await cloudStore.getInvitationDetails({ token: invitationDetailsMatch[1], userId: user.id,
        verifiedEmails: user.identities.map(item => item.verifiedEmail).filter(Boolean) });
      sendJson(res, 200, { ok: true, invitation }); return;
    }
    const invitationAcceptMatch = pathname.match(/^\/api\/cloud\/v1\/invitations\/([^/]+)\/accept$/);
    if (invitationAcceptMatch && req.method === 'POST') {
      const verifiedEmails = user.identities.filter((item) => item.verifiedEmail)
        .map((item) => item.verifiedEmail);
      const details = await cloudStore.getInvitationDetails({ token: invitationAcceptMatch[1], userId: user.id, verifiedEmails });
      if (details.accepted) {
        cloudJoinRequests.completeForInvitation(details.id, user.id);
        sendJson(res, 200, { ok: true, workspace_id: details.workspace_id, role: details.role }); return;
      }
      const invitationContext = await cloudStore.getInvitationContext({ token: invitationAcceptMatch[1], verifiedEmails });
      if (!user.firstName || !user.lastName) {
        throw Object.assign(new Error('profile_required'), { code: 'profile_required' });
      }
      requireInvitationEntitlement(user.id, invitationContext.workspaceId);
      let result;
      try {
        result = await cloudStore.acceptInvitation({ userId: user.id,
          verifiedEmails, token: invitationAcceptMatch[1],
          beforeCommit: () => requireInvitationEntitlement(user.id, invitationContext.workspaceId) });
      } catch (error) {
        if (error.code !== 'resource_unavailable') throw error;
        const completed = await cloudStore.getInvitationDetails({ token: invitationAcceptMatch[1], userId: user.id, verifiedEmails });
        if (!completed.accepted) throw error;
        cloudJoinRequests.completeForInvitation(completed.id, user.id);
        sendJson(res, 200, { ok: true, workspace_id: completed.workspace_id, role: completed.role }); return;
      }
      if (cloudSinglePlan) cloudSinglePlan.claim(user.id, result.workspaceId);
      const seatChangeId = crypto.randomUUID();
      try { await syncTeamSeatQuantity(result.workspaceId, seatChangeId); }
      catch (_) {
        console.error('[cloud-billing] seat synchronization queued');
      }
      scheduleTeamSeatSync(result.workspaceId, seatChangeId);
      cloudJoinRequests.completeForInvitation(details.id, user.id);
      sendJson(res, 200, { ok: true, workspace_id: result.workspaceId, role: result.role });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/documents') {
      const projectId = url.searchParams.get('project_id') || undefined;
      const workspaceId = url.searchParams.get('workspace_id') || undefined;
      const sharedWithMe = url.searchParams.get('shared_with_me') === '1';
      const limit = normalizeLimit(url.searchParams.get('limit'));
      const cursorScope = JSON.stringify({ endpoint: 'documents', user_id: user.id,
        project_id: projectId || null, workspace_id: workspaceId || null,
        shared_with_me: sharedWithMe });
      const after = url.searchParams.get('cursor')
        ? cloudCursor.decode(url.searchParams.get('cursor'), cursorScope)
        : null;
      let documents = await cloudStore.listDocuments({
        userId: user.id, projectId, workspaceId,
      });
      if (sharedWithMe) documents = documents.filter((document) => document.shared_with_me);
      documents = documents.filter((document) => {
        try {
          cloudRequireDocumentRead(user.id, document, { workspaceId, projectId });
          return true;
        } catch (_) { return false; }
      });
      const page = cloudStore.pageDocuments(documents, { limit, after });
      sendJson(res, 200, { ok: true, documents: page.documents,
        next_cursor: page.nextPosition ? cloudCursor.encode(cursorScope, page.nextPosition) : null });
      return;
    }
    if (req.method === 'POST' && pathname === base + '/notifications') {
      if (!cloudJobs) throw Object.assign(new Error('notification_delivery_not_configured'),
        { code: 'notification_delivery_not_configured' });
      const body = await cloudAuthHttp.readJson(req);
      const recipientUserIds = Array.isArray(body.recipient_user_ids)
        ? body.recipient_user_ids : [];
      if (recipientUserIds.some((recipientUserId) => !verifiedCloudEmail(recipientUserId))) {
        throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
      }
      const notification = await cloudStore.createDocumentNotification({
        userId: user.id,
        credentialId,
        documentIds: body.document_ids,
        recipientUserIds,
        note: body.note,
        idempotencyKey: body.idempotency_key,
      });
      notification.recipient_user_ids.forEach((recipientUserId) => {
        enqueueCloudJob({
          type: 'document_notification_email',
          idempotencyKey: notification.id + ':' + recipientUserId,
          payload: { batchId: notification.id, recipientUserId },
        });
      });
      sendJson(res, 202, { ok: true, notification });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/tags') {
      const projectId = url.searchParams.get('project_id') || undefined;
      const workspaceIds = [];
      if (projectId) {
        const project = cloudStore.getSearchProjectContext({ userId: user.id, projectId });
        requireCloudEntitlement(user.id, project.workspaceId, 'read');
        workspaceIds.push(project.workspaceId);
      } else {
        for (const workspace of await cloudStore.listWorkspaces(user.id)) {
          try { requireCloudEntitlement(user.id, workspace.id, 'read'); workspaceIds.push(workspace.id); }
          catch (_) { /* Preserve the existing readable-library inventory scope. */ }
        }
      }
      const tags = await cloudStore.listTags({ userId: user.id, projectId, workspaceIds,
        beforeReturn: () => { for (const id of workspaceIds) requireCloudEntitlement(user.id, id, 'read'); } });
      sendJson(res, 200, { ok: true, tags });
      return;
    }
    if (req.method === 'POST' && pathname === base + '/documents') {
      const body = await cloudAuthHttp.readJson(req, CLOUD_DOCUMENT_JSON_MAX_BYTES);
      const project = cloudStore.getProjectContext({ userId: user.id,
        projectId: body.project_id, requiredRole: 'editor' });
      const entitlements = requireCloudEntitlement(user.id, project.workspaceId, 'store_revision', {
        fileBytes: cloudMarkdownBytes(body.markdown),
      });
      const document = await cloudStore.createDocument({
        userId: user.id, projectId: body.project_id, filename: body.filename, sourceFile: body.source_file,
        markdown: body.markdown, idempotencyKey: body.idempotency_key, credentialId,
        beforeCommit: () => requireCloudEntitlement(user.id, project.workspaceId, 'store_revision', {
          fileBytes: cloudMarkdownBytes(body.markdown),
        }),
      });
      scheduleRevisionPrune(document, entitlements);
      sendJson(res, 201, { ok: true, document });
      return;
    }
    if (req.method === 'POST' && pathname === base + '/search') {
      const body = await cloudAuthHttp.readJson(req, 8 * 1024 * 1024);
      const search = cloudSearchQuery.normalizeSearchRequest(body, { userId: user.id });
      function resolveAuthor(expression) {
        if (!expression) return expression;
        if (expression.op === 'not') return { op: 'not', clause: resolveAuthor(expression.clause) };
        if (expression.clauses) return { op: expression.op, clauses: expression.clauses.map(resolveAuthor) };
        if (expression.field === 'author' && expression.value === 'me') return { field: 'author', value: user.id };
        return expression;
      }
      search.expression = resolveAuthor(search.expression);
      const visibleWorkspaces = await cloudStore.listWorkspaces(user.id);
      let workspaceIds;
      if (search.projectId) {
        const project = cloudStore.getSearchProjectContext({ userId: user.id, projectId: search.projectId });
        if (search.workspaceId && search.workspaceId !== project.workspaceId) throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
        workspaceIds = [project.workspaceId];
      } else if (search.workspaceId) {
        if (!visibleWorkspaces.some(workspace => workspace.id === search.workspaceId)) throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
        workspaceIds = [search.workspaceId];
      } else workspaceIds = visibleWorkspaces.map(workspace => workspace.id);
      const sourceRate = cloudAuth.consumeRateLimit({ action: 'cloud_search_source',
        key: getClientIp(req), limit: Number(process.env.CLOUD_SEARCH_SOURCE_LIMIT) || 60,
        windowMs: Number(process.env.CLOUD_SEARCH_SOURCE_WINDOW_MS) || 60000 });
      if (!sourceRate.allowed) throw Object.assign(new Error('rate_limited'), { code: 'rate_limited', retryAfterMs: sourceRate.retryAfterMs });
      const searchable = [];
      let entitlementFailure = null;
      for (const workspaceId of workspaceIds) {
        try {
          const entitlements = requireCloudEntitlement(user.id, workspaceId, 'search');
          const limits = entitlements && entitlements.limits && entitlements.limits.search;
          if (limits && limits.maxRequests && limits.windowMs) {
            const budget = cloudAuth.consumeRateLimit({ action: 'cloud_search_workspace',
              key: user.id + ':' + workspaceId, limit: limits.maxRequests, windowMs: limits.windowMs });
            if (!budget.allowed) throw Object.assign(new Error('search_limit_reached'), { code: 'search_limit_reached', retryAfterMs: budget.retryAfterMs });
          }
          searchable.push(workspaceId);
        } catch (error) { entitlementFailure = entitlementFailure || error; }
      }
      // An all-library search must not look complete after silently dropping a
      // library whose entitlement or request budget failed. Callers can retry
      // or explicitly narrow the library scope.
      if (entitlementFailure) throw entitlementFailure;
      searchable.sort();
      const { cursor, limit, ...scopeFilters } = search;
      const cursorScope = JSON.stringify({ endpoint: 'search-v1', user_id: user.id, workspace_ids: searchable, filters: scopeFilters });
      const after = cursor ? cloudCursor.decode(cursor, cursorScope) : null;
      const beforeReturn = () => {
        for (const workspaceId of searchable) requireCloudEntitlement(user.id, workspaceId, 'read');
      };
      const page = searchable.length ? await cloudStore.searchPage({ ...search, userId: user.id, workspaceIds: searchable, after, beforeReturn })
        : { documents: [], total_count: 0, facets: {}, nextPosition: null, has_more: false };
      // Author labels are disclosed only for authors of authorized matching documents.
      const people = new Map();
      const person = id => {
        if (!people.has(id)) {
          const author = cloudAuth.getUser(id);
          people.set(id, { user_id: id, name: author ? [author.firstName, author.lastName].filter(Boolean).join(' ') || null : null });
        }
        return people.get(id);
      };
      const libraries = new Map(visibleWorkspaces.map(workspace => [workspace.id, workspace.name]));
      const documents = page.documents.map(document => ({ ...document,
        url: CLOUD_AUTH_PUBLIC_ORIGIN + '/docs?cloud-document=' + encodeURIComponent(document.id),
        library: { id: document.workspace_id, name: libraries.get(document.workspace_id) || null },
        author: person(document.created_by_user_id),
        updated_by: document.updated_by_user_id ? person(document.updated_by_user_id) : null }));
      const facets = Object.assign({}, page.facets);
      if (facets.authors) facets.authors = facets.authors.map(author => ({ ...author, ...person(author.user_id) }));
      if (facets.libraries) facets.libraries = facets.libraries.map(library => ({ ...library, name: libraries.get(library.id) || null }));
      sendJson(res, 200, { ok: true, schema_version: 1, documents, total_count: page.total_count,
        facets, facet_totals: page.facet_totals || {}, facets_truncated: page.facets_truncated || {}, has_more: Boolean(page.nextPosition), next_cursor: page.nextPosition ? cloudCursor.encode(cursorScope, page.nextPosition) : null,
        sort: search.sort, query_digest: crypto.createHash('sha256').update(cursorScope).digest('hex') });
      return;
    }

    if (req.method === 'GET' && pathname === base + '/documents/deleted') {
      const workspaceId = url.searchParams.get('workspace_id') || null;
      const documents = await cloudStore.listDeletedDocuments({
        userId: user.id, workspaceId: url.searchParams.get('workspace_id') || null,
      });
      sendJson(res, 200, { ok: true, documents: documents.filter(document => {
        try {
          cloudRequireDocumentRead(user.id, document, { workspaceId, includeDeleted: true, onlyDeleted: true });
          return true;
        } catch (_) { return false; }
      }) });
      return;
    }

    const documentStarMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/star$/);
    if (documentStarMatch && req.method === 'PUT') {
      const body = await cloudAuthHttp.readJson(req);
      const context = cloudStore.getDocumentContext({ userId: user.id, documentId: documentStarMatch[1] });
      requireCloudEntitlement(user.id, context.workspaceId, 'read');
      const result = cloudStore.setDocumentStar({ userId: user.id, documentId: documentStarMatch[1], starred: body.starred });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    const documentPermissionMatch = pathname.match(
      /^\/api\/cloud\/v1\/documents\/([^/]+)\/permission$/);
    if (documentPermissionMatch && req.method === 'GET') {
      const context = cloudStore.getDocumentContext({ userId: user.id,
        documentId: documentPermissionMatch[1] });
      requireCloudEntitlement(user.id, context.workspaceId, 'read');
      sendJson(res, 200, { ok: true, permission: cloudStore.getDocumentPermission({
        userId: user.id, documentId: documentPermissionMatch[1],
      }) });
      return;
    }
    if (documentPermissionMatch && req.method === 'PATCH') {
      const body = await cloudAuthHttp.readJson(req);
      const context = cloudStore.getDocumentContext({ userId: user.id,
        documentId: documentPermissionMatch[1], requiredRole: 'editor' });
      requireCloudEntitlement(user.id, context.workspaceId, 'manage');
      const permission = cloudStore.setDocumentPermission({ userId: user.id,
        documentId: documentPermissionMatch[1], mode: body.mode,
        memberUserIds: body.member_user_ids,
      });
      sendJson(res, 200, { ok: true, permission });
      return;
    }
    const documentTagsMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/tags$/);
    if (documentTagsMatch && req.method === 'PATCH') {
      const body = await cloudAuthHttp.readJson(req, CLOUD_DOCUMENT_JSON_MAX_BYTES);
      const hasExpectedHead = typeof body.expected_head_revision_id === 'string' &&
        body.expected_head_revision_id.length > 0;
      const hasTarget = typeof body.target_revision_id === 'string' &&
        body.target_revision_id.length > 0;
      if (hasExpectedHead === hasTarget) {
        const error = new Error('choose one revision base');
        error.code = 'invalid_request';
        throw error;
      }
      const context = cloudStore.getDocumentContext({ userId: user.id,
        documentId: documentTagsMatch[1], requiredRole: 'editor' });
      const entitlements = requireCloudEntitlement(user.id, context.workspaceId, 'store_revision');
      const mergeStartedAt = Date.now();
      const document = await cloudStore.updateDocumentTags({ userId: user.id,
        documentId: documentTagsMatch[1], tags: body.tags,
        expectedHeadRevisionId: body.expected_head_revision_id,
        targetRevisionId: body.target_revision_id,
        targetMarkdown: body.target_markdown,
        filename: body.filename,
        maxMarkdownBytes: CLOUD_DOCUMENT_MAX_BYTES,
        idempotencyKey: body.idempotency_key, credentialId,
        beforeCommit: (detail) => requireCloudEntitlement(
          user.id, context.workspaceId, 'store_revision', detail && {
            fileBytes: detail.markdownBytes,
          }),
      });
      if (hasTarget) {
        cloudCollaborationMetrics.recordTargetSave(document, Date.now() - mergeStartedAt);
      }
      scheduleRevisionPrune(document, entitlements);
      sendJson(res, 200, { ok: true, document });
      return;
    }

    const documentHeadMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/head$/);
    if (documentHeadMatch && req.method === 'GET') {
      const context = cloudStore.getDocumentContext({ userId: user.id,
        documentId: documentHeadMatch[1] });
      requireCloudEntitlement(user.id, context.workspaceId, 'read');
      const document = cloudStore.getDocumentHead({ userId: user.id,
        documentId: documentHeadMatch[1] });
      const knownRevisionId = url.searchParams.get('known_revision_id');
      cloudCollaborationMetrics.recordHeadCheck(knownRevisionId == null
        ? null : knownRevisionId !== document.current_revision_id);
      sendJson(res, 200, { ok: true, document });
      return;
    }

    const commentsMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/comments$/);
    if (commentsMatch && req.method === 'GET') {
      const model = require('./lib/cloud-comments');
      const documentId = commentsMatch[1];
      const status = url.searchParams.get('status') || (url.searchParams.has('comment_id') ? 'all' : 'open');
      const contextMode = url.searchParams.get('context') || 'snippet';
      if (!['all', 'open', 'resolved'].includes(status) || !['none', 'snippet'].includes(contextMode)) {
        throw Object.assign(new Error('Comment status must be open, resolved or all. Context must be none or snippet.'), { code: 'invalid_request', details: { field: 'comments' } });
      }
      const commentId = url.searchParams.get('comment_id') || null;
      const author = url.searchParams.get('author');
      if (author !== null && !author.trim()) throw Object.assign(new Error('Provide a comment author name or user ID.'), { code: 'invalid_request', details: { field: 'comments' } });
      const scope = JSON.stringify({ endpoint: 'comments', user_id: user.id, document_id: documentId, status, context: contextMode, comment_id: commentId, author });
      const cursor = url.searchParams.get('cursor') ? cloudCursor.decode(url.searchParams.get('cursor'), scope) : null;
      const revisionId = url.searchParams.get('revision_id') || cursor && cursor.revision_id;
      if (cursor && url.searchParams.get('revision_id') && cursor.revision_id !== revisionId) throw Object.assign(new Error('invalid cursor'), { code: 'invalid_request' });
      const context = cloudStore.getDocumentContext({ userId: user.id, documentId });
      requireCloudEntitlement(user.id, context.workspaceId, 'read');
      const selectedRevisionId = revisionId || cloudStore.getDocumentHead({ userId: user.id, documentId }).current_revision_id;
      const document = await cloudStore.getDocument({ userId: user.id, documentId, revisionId: selectedRevisionId });
      cloudRequireDocumentRead(user.id, document, { source: context, revisionId: selectedRevisionId });
      const state = model.snapshot(document.markdown);
      if (commentId) model.find(state, commentId);
      const matches = state.comments.filter(note => (!commentId || note.id === commentId) &&
        (author === null || (author === 'me' ? note.author_user_id === user.id :
          note.author_user_id === author || String(note.author || '').normalize('NFKC').toLowerCase() === author.trim().normalize('NFKC').toLowerCase())) &&
        (status === 'all' || (note.resolved === true || note.resolved === 'true' ? 'resolved' : 'open') === status));
      const limit = normalizeLimit(url.searchParams.get('limit'), 25, 100);
      const start = cursor ? cursor.offset : 0;
      if (!Number.isSafeInteger(start) || start < 0) throw Object.assign(new Error('invalid cursor'), { code: 'invalid_request' });
      const page = matches.slice(start, start + limit);
      const result = model.project(document, CLOUD_AUTH_PUBLIC_ORIGIN, { context: contextMode, comments: page });
      result.document.current_revision_id = cloudStore.getDocumentHead({ userId: user.id, documentId }).current_revision_id;
      result.permission = cloudStore.getDocumentPermission({ userId: user.id, documentId });
      result.returned_count = page.length;
      result.filtered_count = matches.length;
      result.has_more = start + page.length < matches.length;
      result.next_cursor = result.has_more ? cloudCursor.encode(scope, { revision_id: document.current_revision_id, offset: start + page.length }) : null;
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    const commentActionMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/comments\/actions(\/preview)?$/);
    if (commentActionMatch && req.method === 'POST') {
      const body = await cloudAuthHttp.readJson(req, CLOUD_DOCUMENT_JSON_MAX_BYTES);
      const documentId = commentActionMatch[1];
      const context = cloudStore.getDocumentContext({ userId: user.id, documentId, requiredRole: 'editor' });
      const entitlements = requireCloudEntitlement(user.id, context.workspaceId, 'store_revision');
      const profile = cloudUserProfile(user);
      const document = await cloudStore.actOnComment({ userId: user.id, documentId,
        baseRevisionId: body.base_revision_id, preview: Boolean(commentActionMatch[2]),
        operation: { action: body.action, comment_id: body.comment_id, expected_comment_sha256: body.expected_comment_sha256,
          text: body.text, anchor: body.anchor },
        actor: { user_id: user.id, display_name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email || 'user' },
        idempotencyKey: body.idempotency_key, credentialId, maxMarkdownBytes: CLOUD_DOCUMENT_MAX_BYTES,
        beforeCommit: detail => requireCloudEntitlement(user.id, context.workspaceId, 'store_revision', { fileBytes: detail.markdownBytes }),
      });
      if (!commentActionMatch[2]) scheduleRevisionPrune(document, entitlements);
      const model = require('./lib/cloud-comments');
      const selected = model.snapshot(document.markdown).comments.filter(note => note.id === document.comment_id);
      const projected = model.project(document, CLOUD_AUTH_PUBLIC_ORIGIN, { comments: selected });
      sendJson(res, commentActionMatch[2] ? 200 : 201, { ok: true, schema_version: 1,
        document: projected.document, comment: projected.comments[0] || null,
        action: document.action, comment_id: document.comment_id, base_revision_id: document.base_revision_id,
        merged_from_revision_id: document.merged_from_revision_id,
        revision_created: document.revision_created, preview: document.preview,
        would_change: document.would_change, imported_footnote_comments: document.imported_footnote_comments,
        ...(document.preview ? { proposed_sha256: document.content_sha256 } : { saved_sha256: document.content_sha256 }) });
      return;
    }
    const contentMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/content$/);
    if (contentMatch && req.method === 'GET') {
      const context = cloudStore.getDocumentContext({ userId: user.id, documentId: contentMatch[1] });
      requireCloudEntitlement(user.id, context.workspaceId, 'read');
      const revisionId = url.searchParams.get('revision_id') || undefined;
      const document = await cloudStore.getDocument({ userId: user.id, documentId: contentMatch[1], revisionId });
      cloudRequireDocumentRead(user.id, document, { source: context, revisionId });
      const selector = {};
      if (url.searchParams.has('lines')) selector.lines = url.searchParams.get('lines');
      if (url.searchParams.has('section')) selector.section = url.searchParams.get('section');
      if (url.searchParams.has('outline')) {
        if (url.searchParams.get('outline') !== 'true') {
          throw Object.assign(new Error('outline must be true'), { code: 'invalid_request', details: { field: 'edit' } });
        }
        selector.outline = true;
      }
      const selected = require('./cli/shared/sdocs-text-edit').select(document.markdown, selector);
      const { markdown, ...metadata } = document;
      sendJson(res, 200, { ok: true,
        permission: cloudStore.getDocumentPermission({ userId: user.id, documentId: document.id }),
        document: { ...metadata,
        current_revision_id: cloudStore.getDocumentHead({ userId: user.id, documentId: document.id }).current_revision_id,
        revision_id: document.current_revision_id,
        url: CLOUD_AUTH_PUBLIC_ORIGIN + '/docs?cloud-document=' + encodeURIComponent(document.id),
        sha256: crypto.createHash('sha256').update(markdown, 'utf8').digest('hex'),
        ...(selector.outline ? { outline: selected.outline } : { markdown: selected.markdown }),
        selection: { start_line: selected.start_line, end_line: selected.end_line, total_lines: selected.total_lines },
      } });
      return;
    }
    const editsMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/edits(\/preview)?$/);
    if (editsMatch && req.method === 'POST') {
      const body = await cloudAuthHttp.readJson(req, CLOUD_DOCUMENT_JSON_MAX_BYTES);
      if (typeof body.base_revision_id !== 'string' || !body.base_revision_id ||
          (body.edits == null) === (body.patch == null)) {
        throw Object.assign(new Error('Provide a base revision and either edits or patch.'), {
          code: 'invalid_request', details: { field: 'edit' },
        });
      }
      const context = cloudStore.getDocumentContext({ userId: user.id,
        documentId: editsMatch[1], requiredRole: 'editor' });
      const entitlements = requireCloudEntitlement(user.id, context.workspaceId, 'store_revision');
      const input = { userId: user.id, documentId: editsMatch[1],
        targetRevisionId: body.base_revision_id,
        editRequest: body.edits != null ? { edits: body.edits } : { patch: body.patch },
        expectedCurrentRevisionId: body.expected_current_revision_id,
        rejectConflicts: body.reject_conflicts,
        idempotencyKey: body.idempotency_key, credentialId,
        maxMarkdownBytes: CLOUD_DOCUMENT_MAX_BYTES,
        beforeCommit: (detail) => requireCloudEntitlement(user.id, context.workspaceId,
          'store_revision', { fileBytes: detail.markdownBytes }),
      };
      const started = Date.now();
      const document = editsMatch[2] ? await cloudStore.previewTargetRevision(input)
        : await cloudStore.saveTargetRevision(input);
      if (!editsMatch[2]) {
        cloudCollaborationMetrics.recordTargetSave(document, Date.now() - started);
        scheduleRevisionPrune(document, entitlements);
      }
      sendJson(res, editsMatch[2] ? 200 : 201, { ok: true,
        document: require('./lib/cloud-edit-response').editReceipt(document, CLOUD_AUTH_PUBLIC_ORIGIN) });
      return;
    }
    const sourceFileMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/source-file$/);
    if (sourceFileMatch && req.method === 'PUT') {
      const body = await cloudAuthHttp.readJson(req);
      const context = cloudStore.getDocumentContext({ userId: user.id, documentId: sourceFileMatch[1], requiredRole: 'editor' });
      requireCloudEntitlement(user.id, context.workspaceId, 'read');
      const saved = await cloudStore.setDocumentSourceFile({ userId: user.id,
        documentId: sourceFileMatch[1], sourceFile: body.source_file,
        beforeCommit: () => requireCloudEntitlement(user.id, context.workspaceId, 'read') });
      sendJson(res, 200, { ok: true, ...saved });
      return;
    }
    const documentMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)$/);
    if (documentMatch && req.method === 'GET') {
      const context = cloudStore.getDocumentContext({ userId: user.id, documentId: documentMatch[1] });
      requireCloudEntitlement(user.id, context.workspaceId, 'read');
      const document = await cloudStore.getDocument({ userId: user.id, documentId: documentMatch[1] });
      cloudRequireDocumentRead(user.id, document, { source: context });
      const permission = cloudStore.getDocumentPermission({ userId: user.id,
        documentId: documentMatch[1] });
      sendJson(res, 200, { ok: true, document, permission });
      return;
    }
    if (documentMatch && req.method === 'DELETE') {
      const body = await cloudAuthHttp.readJson(req);
      const context = cloudStore.getDocumentContext({ userId: user.id,
        documentId: documentMatch[1], requiredRole: 'editor', includeDeleted: true });
      requireCloudEntitlement(user.id, context.workspaceId, 'manage');
      const deleted = cloudStore.deleteDocument({ userId: user.id, documentId: documentMatch[1],
        expectedHeadRevisionId: body.expected_head_revision_id,
        restoreWindowMs: CLOUD_DOCUMENT_RESTORE_WINDOW_MS });
      enqueueCloudJob({ type: 'document_purge',
        idempotencyKey: deleted.id + ':' + deleted.purge_after,
        payload: {}, availableAtMs: Date.parse(deleted.purge_after) });
      sendJson(res, 200, { ok: true, document: deleted });
      return;
    }
    const documentRestoreMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/restore$/);
    if (documentRestoreMatch && req.method === 'POST') {
      const body = await cloudAuthHttp.readJson(req);
      const context = cloudStore.getDocumentContext({ userId: user.id,
        documentId: documentRestoreMatch[1], requiredRole: 'editor', includeDeleted: true });
      requireCloudEntitlement(user.id, context.workspaceId, 'manage');
      const restored = await cloudStore.restoreDeletedDocument({ userId: user.id,
        documentId: documentRestoreMatch[1],
        expectedHeadRevisionId: body.expected_head_revision_id,
        beforeCommit: () => requireCloudEntitlement(user.id, context.workspaceId, 'manage'),
      });
      sendJson(res, 200, { ok: true, document: restored });
      return;
    }
    const revisionPreviewMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/revisions\/preview$/);
    if (revisionPreviewMatch && req.method === 'POST') {
      const body = await cloudAuthHttp.readJson(req, CLOUD_DOCUMENT_JSON_MAX_BYTES);
      if (typeof body.target_revision_id !== 'string' || !body.target_revision_id ||
          body.expected_head_revision_id != null) {
        const error = new Error('a target revision is required');
        error.code = 'invalid_request';
        throw error;
      }
      const context = cloudStore.getDocumentContext({ userId: user.id,
        documentId: revisionPreviewMatch[1], requiredRole: 'editor' });
      requireCloudEntitlement(user.id, context.workspaceId, 'store_revision', {
        fileBytes: cloudMarkdownBytes(body.markdown),
      });
      const document = await cloudStore.previewTargetRevision({
        userId: user.id, documentId: revisionPreviewMatch[1],
        targetRevisionId: body.target_revision_id, targetMarkdown: body.target_markdown,
        markdown: body.markdown, filename: body.filename,
        expectedCurrentRevisionId: body.expected_current_revision_id,
        rejectConflicts: body.reject_conflicts,
        maxMarkdownBytes: CLOUD_DOCUMENT_MAX_BYTES,
        beforeCommit: (detail) => requireCloudEntitlement(user.id, context.workspaceId,
          'store_revision', { fileBytes: detail.markdownBytes }),
      });
      sendJson(res, 200, { ok: true, document });
      return;
    }
    const revisionsMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/revisions$/);
    if (revisionsMatch && req.method === 'GET') {
      const context = cloudStore.getDocumentContext({ userId: user.id, documentId: revisionsMatch[1],
        includeDeleted: true });
      requireCloudEntitlement(user.id, context.workspaceId, 'read');
      const limit = normalizeLimit(url.searchParams.get('limit'));
      const cursorScope = JSON.stringify({ endpoint: 'document-revisions', user_id: user.id,
        document_id: revisionsMatch[1] });
      const after = url.searchParams.get('cursor')
        ? cloudCursor.decode(url.searchParams.get('cursor'), cursorScope)
        : null;
      const page = cloudStore.listRevisionsPage({ userId: user.id,
        documentId: revisionsMatch[1], limit, after });
      sendJson(res, 200, { ok: true, revisions: page.revisions,
        next_cursor: page.nextPosition ? cloudCursor.encode(cursorScope, page.nextPosition) : null });
      return;
    }
    if (revisionsMatch && req.method === 'POST') {
      const body = await cloudAuthHttp.readJson(req, CLOUD_DOCUMENT_JSON_MAX_BYTES);
      const hasExpectedHead = typeof body.expected_head_revision_id === 'string' &&
        body.expected_head_revision_id.length > 0;
      const hasTarget = typeof body.target_revision_id === 'string' &&
        body.target_revision_id.length > 0;
      if (hasExpectedHead === hasTarget) {
        const error = new Error('choose one revision base');
        error.code = 'invalid_request';
        throw error;
      }
      const context = cloudStore.getDocumentContext({ userId: user.id,
        documentId: revisionsMatch[1], requiredRole: 'editor' });
      const entitlements = requireCloudEntitlement(user.id, context.workspaceId, 'store_revision', {
        fileBytes: cloudMarkdownBytes(body.markdown),
      });
      const saveInput = {
        userId: user.id, documentId: revisionsMatch[1],
        markdown: body.markdown, filename: body.filename,
        idempotencyKey: body.idempotency_key, credentialId,
      };
      let document;
      if (hasTarget) {
        const mergeStartedAt = Date.now();
        document = await cloudStore.saveTargetRevision({
          ...saveInput,
          targetRevisionId: body.target_revision_id,
          targetMarkdown: body.target_markdown,
          rejectConflicts: body.reject_conflicts,
          expectedCurrentRevisionId: body.expected_current_revision_id,
          maxMarkdownBytes: CLOUD_DOCUMENT_MAX_BYTES,
          beforeCommit: (detail) => requireCloudEntitlement(
            user.id, context.workspaceId, 'store_revision', {
              fileBytes: detail.markdownBytes,
            }),
        });
        cloudCollaborationMetrics.recordTargetSave(document, Date.now() - mergeStartedAt);
      } else {
        document = await cloudStore.saveRevision({
          ...saveInput,
          expectedHeadRevisionId: body.expected_head_revision_id,
          beforeCommit: () => requireCloudEntitlement(
            user.id, context.workspaceId, 'store_revision', {
              fileBytes: cloudMarkdownBytes(body.markdown),
            }),
        });
      }
      scheduleRevisionPrune(document, entitlements);
      sendJson(res, 201, { ok: true, document });
      return;
    }
    const revisionMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/revisions\/([^/]+)$/);
    if (revisionMatch && req.method === 'GET') {
      const context = cloudStore.getDocumentContext({ userId: user.id,
        documentId: revisionMatch[1], includeDeleted: true });
      requireCloudEntitlement(user.id, context.workspaceId, 'read');
      const document = await cloudStore.getDocument({ userId: user.id, documentId: revisionMatch[1],
        revisionId: revisionMatch[2], includeDeleted: true });
      cloudRequireDocumentRead(user.id, document, { source: context, revisionId: revisionMatch[2], includeDeleted: true });
      sendJson(res, 200, { ok: true, document, permission: cloudStore.getDocumentPermission({
        userId: user.id, documentId: document.id, includeDeleted: true }) });
      return;
    }
    const restoreMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/revisions\/([^/]+)\/restore$/);
    if (restoreMatch && req.method === 'POST') {
      const body = await cloudAuthHttp.readJson(req);
      const context = cloudStore.getDocumentContext({ userId: user.id,
        documentId: restoreMatch[1], requiredRole: 'editor' });
      const entitlements = requireCloudEntitlement(user.id, context.workspaceId, 'store_revision');
      const document = await cloudStore.restoreRevision({
        userId: user.id, documentId: restoreMatch[1], revisionId: restoreMatch[2],
        expectedHeadRevisionId: body.expected_head_revision_id,
        idempotencyKey: body.idempotency_key, credentialId,
        beforeCommit: () => requireCloudEntitlement(
          user.id, context.workspaceId, 'store_revision'),
      });
      scheduleRevisionPrune(document, entitlements);
      sendJson(res, 201, { ok: true, document });
      return;
    }
    sendJson(res, 404, { ok: false, error: 'resource_unavailable' });
  } catch (error) {
    if (error && error.code === 'target_too_old') {
      cloudCollaborationMetrics.recordTargetTooOld();
    }
    if (error.code === 'payload_too_large') return sendJson(res, 413, { ok: false, error: 'invalid_request' });
    if (error.code === 'invalid_json') return sendJson(res, 400, { ok: false, error: 'invalid_request' });
    cloudApiError(res, error);
  }
}

async function handleCloudEmailRequest(req, res) {
  if (!cloudAuthReady(res) || !cloudAuthPostAllowed(req, res)) return;
  try {
    const body = await cloudAuthHttp.readJson(req);
    if (!CLOUD_AUTH_DEV_LOG_CODES && !teamsNotify.isConfigured()) {
      sendJson(res, 503, { ok: false, error: 'email_delivery_not_configured' });
      return;
    }
    const tokens = cloudLinkTokens(req);
    let email = body.email;
    if (body.link_google && body.link_email) return sendJson(res, 400, { ok: false, error: 'invalid_request' });
    if (body.link_google) {
      email = cloudIdentityLinking.context(tokens.pending, tokens.session).identity.verifiedEmail;
    }
    if (body.link_email) cloudIdentityLinking.recentSession(tokens.session);
    const issued = cloudAuth.issueEmailCode({ email, ip: getClientIp(req),
      ...(body.link_email ? { purpose: 'link', sessionToken: tokens.session } : {}) });
    if (body.link_google) cloudIdentityLinking.setChallenge(tokens.pending, tokens.session, issued.requestId);
    if (CLOUD_AUTH_DEV_LOG_CODES) {
      console.log('[cloud-auth-code] ' + issued.requestId + ' ' + issued.code);
    } else {
      const message = emailTemplates.signInCode({ code: issued.code, expiresMinutes: 10 });
      const delivered = await teamsNotify.sendTo(email, message.subject,
        message.text, message.html);
      if (!delivered.ok) {
        sendJson(res, 503, { ok: false, error: 'email_delivery_failed' });
        return;
      }
    }
    sendJson(res, 202, {
      ok: true,
      challenge_id: issued.requestId,
      expires_at: new Date(issued.expiresAtMs).toISOString(),
    });
  } catch (error) {
    if (error.code === 'payload_too_large') return sendJson(res, 413, { ok: false, error: error.code });
    if (error.code === 'invalid_json' || error.code === 'invalid_email') {
      return sendJson(res, 400, { ok: false, error: 'invalid_request' });
    }
    if (error.code === 'rate_limited') return sendJson(res, 429, { ok: false, error: 'rate_limited' });
    if (['link_expired', 'authentication_required', 'recent_auth_required'].includes(error.code)) return sendJson(res, 401, { ok: false, error: error.code });
    sendJson(res, 500, { ok: false, error: 'temporary_service_failure' });
  }
}

async function handleCloudEmailVerify(req, res) {
  if (!cloudAuthReady(res) || !cloudAuthPostAllowed(req, res)) return;
  try {
    const body = await cloudAuthHttp.readJson(req);
    const rate = cloudAuth.consumeRateLimit({
      action: 'email_code_verify_ip',
      key: getClientIp(req),
      limit: 20,
      windowMs: 15 * 60 * 1000,
    });
    if (!rate.allowed) return sendJson(res, 429, { ok: false, error: 'rate_limited' });
    const result = cloudAuth.consumeEmailCode({ requestId: body.challenge_id, code: body.code,
      sessionToken: cloudLinkTokens(req).session });
    if (!result.ok) return sendJson(res, result.reason === 'identity_in_use' ? 409 : 400, { ok: false,
      error: result.reason === 'identity_in_use' ? 'identity_in_use' : 'invalid_or_expired_code' });
    const session = cloudAuth.createBrowserSession(result.user.id);
    const continuation = await cloudSignInContinuation(result.user, body.return_to);
    const secure = new URL(CLOUD_AUTH_PUBLIC_ORIGIN).protocol === 'https:';
    sendJson(res, 200, { ok: true, ...continuation }, {
      'Set-Cookie': cloudAuthHttp.sessionCookie(session.token, {
        secure,
        maxAge: Math.max(1, Math.floor((session.expiresAtMs - Date.now()) / 1000)),
      }),
    });
  } catch (error) {
    if (error.code === 'payload_too_large') return sendJson(res, 413, { ok: false, error: error.code });
    if (error.code === 'invalid_json') return sendJson(res, 400, { ok: false, error: 'invalid_request' });
    if (error.code === 'account_link_required') return sendJson(res, 409, { ok: false, error: 'account_link_required' });
    sendJson(res, 500, { ok: false, error: 'temporary_service_failure' });
  }
}

async function handleCloudTestLogin(req, res) {
  if (!CLOUD_TEST_LOGIN_ENABLED || !cloudAuth) {
    sendJson(res, 404, { ok: false, error: 'not_found' });
    return;
  }
  if (!cloudAuthPostAllowed(req, res)) return;
  try {
    const body = await cloudAuthHttp.readJson(req);
    const rate = cloudAuth.consumeRateLimit({ action: 'staging_test_login', key: getClientIp(req),
      limit: 10, windowMs: 60 * 60 * 1000 });
    if (!rate.allowed) return sendJson(res, 429, { ok: false, error: 'rate_limited' });
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const secret = typeof body.secret === 'string' ? body.secret : '';
    if (!CLOUD_TEST_LOGIN_EMAILS.has(email) ||
        !cloudAuthHttp.timingSafeEqualString(secret, CLOUD_TEST_LOGIN_SECRET)) {
      return sendJson(res, 403, { ok: false, error: 'permission_denied' });
    }
    const signedIn = cloudAuth.signInWithVerifiedEmail(email);
    const session = cloudAuth.createBrowserSession(signedIn.user.id);
    const secure = new URL(CLOUD_AUTH_PUBLIC_ORIGIN).protocol === 'https:';
    const continuation = await cloudSignInContinuation(signedIn.user, body.return_to);
    sendJson(res, 200, { ok: true, ...continuation }, {
      'Set-Cookie': cloudAuthHttp.sessionCookie(session.token, { secure,
        maxAge: Math.max(1, Math.floor((session.expiresAtMs - Date.now()) / 1000)),
      }),
    });
  } catch (error) {
    if (error.code === 'payload_too_large') return sendJson(res, 413, { ok: false, error: error.code });
    if (error.code === 'invalid_json') return sendJson(res, 400, { ok: false, error: 'invalid_request' });
    sendJson(res, 500, { ok: false, error: 'temporary_service_failure' });
  }
}

function beginCloudOAuth(req, res, url, provider) {
  if (!cloudAuthReady(res)) return;
  const adapter = provider === 'google' ? cloudGoogleOAuth : cloudGitHubOAuth;
  if (!adapter) {
    sendJson(res, 503, { ok: false, error: 'provider_not_configured' });
    return;
  }
  try {
    const rate = cloudAuth.consumeRateLimit({ action: 'oauth_begin_' + provider,
      key: getClientIp(req), limit: 30, windowMs: 15 * 60 * 1000 });
    if (!rate.allowed) return sendJson(res, 429, { ok: false, error: 'rate_limited' });
    const started = adapter.begin({ returnTo: url.searchParams.get('return_to') });
    if (url.searchParams.get('link') === '1') {
      if (provider !== 'google') throw new Error('unsupported link provider');
      try {
        cloudIdentityLinking.createContext({ token: new URL(started.authorizationUrl).searchParams.get('state'),
          sessionToken: cloudLinkTokens(req).session,
          returnTo: '/cloud/admin?panel=preferences' });
      } catch (_) {
        res.writeHead(303, { Location: '/cloud/sign-in?return=' + encodeURIComponent(url.pathname + url.search), 'Cache-Control': 'no-store' });
        res.end(); return;
      }
    }
    const secure = new URL(CLOUD_AUTH_PUBLIC_ORIGIN).protocol === 'https:';
    res.writeHead(303, { Location: started.authorizationUrl, 'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Set-Cookie': cloudOAuthBindingCookie(provider, new URL(started.authorizationUrl).searchParams.get('state'),
        { secure, maxAge: Math.max(1, Math.floor((started.expiresAtMs - Date.now()) / 1000)) }) });
    res.end();
  } catch (_) {
    sendJson(res, 400, { ok: false, error: 'invalid_oauth_request' });
  }
}

function cloudOAuthBindingCookie(provider, state, options) {
  options = options || {};
  const secure = options.secure !== false;
  const name = (secure ? '__Host-sdocs_oauth_' : 'sdocs_oauth_') + provider;
  const parts = [name + '=' + encodeURIComponent(state || ''), 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  if (Number.isInteger(options.maxAge) && options.maxAge >= 0) parts.push('Max-Age=' + options.maxAge);
  return parts.join('; ');
}

function cloudLinkTokens(req) {
  const secure = new URL(CLOUD_AUTH_PUBLIC_ORIGIN).protocol === 'https:';
  const cookies = cloudAuthHttp.parseCookies(req.headers.cookie);
  return { session: cloudAuthHttp.sessionTokenFromCookies(req.headers.cookie, secure),
    pending: cookies[(secure ? '__Host-sdocs_oauth_' : 'sdocs_oauth_') + 'link'], secure };
}

function applyGoogleProfile(result, identity) {
  if ((!result.user.firstName || !result.user.lastName) && (identity.firstName || identity.lastName)) {
    result.user = cloudAuth.updateUserProfile({ userId: result.user.id,
      firstName: result.user.firstName || identity.firstName || '',
      lastName: result.user.lastName || identity.lastName || '', allowIncomplete: true });
  }
  return result;
}

async function handleCloudIdentityLink(req, res, url) {
  if (!cloudAuthReady(res) || (req.method !== 'GET' && !cloudAuthPostAllowed(req, res))) return;
  const tokens = cloudLinkTokens(req);
  try {
    if (req.method === 'GET') {
      if (url.searchParams.get('email') === '1') {
        const session = cloudIdentityLinking.recentSession(tokens.session);
        sendJson(res, 200, { ok: true, add_email: true, account_email: verifiedCloudEmail(session.user.id) });
      } else {
        const row = cloudIdentityLinking.context(tokens.pending, tokens.session);
        sendJson(res, 200, { ok: true, email: row.identity.verifiedEmail,
          needs_email: !row.identity.emailAuthoritative,
          account_email: row.target_user_id ? verifiedCloudEmail(row.target_user_id) : null });
      }
      return;
    }
    const rate = cloudAuth.consumeRateLimit({ action: 'identity_link_verify', key: getClientIp(req), limit: 20, windowMs: 15 * 60 * 1000 });
    if (!rate.allowed) return sendJson(res, 429, { ok: false, error: 'rate_limited' });
    const body = await cloudAuthHttp.readJson(req);
    const row = cloudIdentityLinking.context(tokens.pending, tokens.session);
    const result = cloudIdentityLinking.complete(tokens.pending, tokens.session, body);
    if (!result.ok) return sendJson(res, 400, { ok: false, error: 'invalid_or_expired_code' });
    applyGoogleProfile(result, row.identity);
    const session = cloudAuth.createBrowserSession(result.user.id);
    const continuation = await cloudSignInContinuation(result.user, result.returnTo);
    sendJson(res, 200, { ok: true, ...continuation }, { 'Set-Cookie': [
      cloudAuthHttp.sessionCookie(session.token, { secure: tokens.secure, maxAge: Math.floor((session.expiresAtMs - Date.now()) / 1000) }),
      cloudOAuthBindingCookie('link', '', { secure: tokens.secure, maxAge: 0 }),
    ] });
  } catch (error) {
    if (error.code === 'payload_too_large') return sendJson(res, 413, { ok: false, error: error.code });
    if (error.code === 'invalid_json') return sendJson(res, 400, { ok: false, error: 'invalid_request' });
    if (error.code === 'identity_in_use') return sendJson(res, 409, { ok: false, error: error.code });
    if (['link_expired', 'recent_auth_required', 'authentication_required', 'invalid_user'].includes(error.code)) {
      return sendJson(res, 401, { ok: false, error: error.code });
    }
    sendJson(res, 500, { ok: false, error: 'temporary_service_failure' });
  }
}

async function finishCloudOAuth(req, res, url, provider) {
  if (!cloudAuthReady(res)) return;
  const adapter = provider === 'google' ? cloudGoogleOAuth : cloudGitHubOAuth;
  if (!adapter) return sendJson(res, 503, { ok: false, error: 'provider_not_configured' });
  let clearBinding = null;
  try {
    const rate = cloudAuth.consumeRateLimit({ action: 'oauth_callback_' + provider,
      key: getClientIp(req), limit: 30, windowMs: 15 * 60 * 1000 });
    if (!rate.allowed) return sendJson(res, 429, { ok: false, error: 'rate_limited' });
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const providerError = url.searchParams.get('error');
    const secure = new URL(CLOUD_AUTH_PUBLIC_ORIGIN).protocol === 'https:';
    const cookies = cloudAuthHttp.parseCookies(req.headers.cookie);
    const bindingName = (secure ? '__Host-sdocs_oauth_' : 'sdocs_oauth_') + provider;
    if (!state || !cloudAuthHttp.timingSafeEqualString(cookies[bindingName], state)) {
      throw new Error('invalid OAuth browser binding');
    }
    clearBinding = cloudOAuthBindingCookie(provider, '', { secure, maxAge: 0 });
    if (providerError || !state || !code) {
      // Every authorization response consumes its transaction, including a
      // denial. Otherwise a denied state remains a second callback path until
      // expiry. Do not reflect provider descriptions into our redirect.
      const transaction = cloudOAuthTransactions.consume({ provider, state });
      const publicError = providerError ? 'oauth_denied' : 'invalid_oauth_request';
      res.writeHead(303, { Location: '/cloud/sign-in?error=' + publicError + '&return=' + encodeURIComponent(transaction.returnTo),
        'Set-Cookie': clearBinding, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      res.end();
      return;
    }
    const completed = await adapter.callback({ state, code });
    const intent = cloudIdentityLinking.finishIntent(state, cloudLinkTokens(req).session);
    if (provider === 'google' && (intent || !completed.identity.emailAuthoritative)) {
      const token = cloudIdentityLinking.createContext({ identity: completed.identity,
        sessionToken: intent ? cloudLinkTokens(req).session : null,
        returnTo: intent ? intent.return_to : completed.returnTo });
      res.writeHead(303, { Location: '/cloud/link', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'Set-Cookie': [clearBinding, cloudOAuthBindingCookie('link', token, { secure, maxAge: 600 })] });
      res.end(); return;
    }
    const signedIn = applyGoogleProfile(provider === 'google'
      ? cloudIdentityLinking.signInGoogle(completed.identity)
      : cloudAuth.signInWithExternalIdentity(completed.identity), completed.identity);
    const session = cloudAuth.createBrowserSession(signedIn.user.id);
    const continuation = await cloudSignInContinuation(signedIn.user, completed.returnTo);
    res.writeHead(303, { Location: continuation.return_to,
      'Set-Cookie': [cloudAuthHttp.sessionCookie(session.token, { secure,
        maxAge: Math.max(1, Math.floor((session.expiresAtMs - Date.now()) / 1000)) }), clearBinding],
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end();
  } catch (_) {
    const headers = { Location: '/cloud/sign-in?error=oauth_failed',
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
    // A callback without the browser binding must not clear another valid
    // transaction that happens to be in progress in this browser.
    if (clearBinding) headers['Set-Cookie'] = clearBinding;
    res.writeHead(303, headers);
    res.end();
  }
}

async function handleCloudTermsAcceptance(req, res) {
  if (!cloudAuthReady(res) || !cloudAuthPostAllowed(req, res)) return;
  const authenticated = cloudAuthSession(req);
  if (!authenticated.ok) {
    sendJson(res, 401, { ok: false, error: 'login_required' });
    return;
  }
  try {
    const body = await cloudAuthHttp.readJson(req);
    if (body.accepted !== true || body.terms_version !== CURRENT_TERMS_VERSION) {
      return sendJson(res, 400, { ok: false, error: 'invalid_terms_acceptance',
        terms_version: CURRENT_TERMS_VERSION });
    }
    const acceptance = cloudAuth.acceptCurrentTerms({ userId: authenticated.user.id,
      termsVersion: body.terms_version });
    const continuation = await cloudSignInContinuation(cloudAuth.getUser(authenticated.user.id), body.return_to);
    sendJson(res, 200, { ok: true, terms_version: acceptance.termsVersion,
      accepted_at: new Date(acceptance.acceptedAtMs).toISOString(),
      ...continuation });
  } catch (error) {
    if (error.code === 'payload_too_large') return sendJson(res, 413, { ok: false, error: error.code });
    if (error.code === 'invalid_json' || error.code === 'invalid_terms_version') {
      return sendJson(res, 400, { ok: false, error: 'invalid_terms_acceptance',
        terms_version: CURRENT_TERMS_VERSION });
    }
    sendJson(res, 500, { ok: false, error: 'temporary_service_failure' });
  }
}

function readRawBody(req, limit) {
  const cap = limit || 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > cap) return reject(Object.assign(new Error('payload_too_large'), { code: 'payload_too_large' }));
      chunks.push(Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function stripeSubscriptionInput(subscription, eventCreatedMs, existing) {
  const update = cloudBillingLifecycle.buildStripeSubscriptionUpdate({
    subscription,
    existing,
    eventCreatedMs,
    now: Number.isSafeInteger(eventCreatedMs) ? eventCreatedMs : Date.now(),
    policy: CLOUD_BILLING_POLICY,
  });
  if (cloudSinglePlan) update.retentionEndsAtMs = null;
  return update;
}

async function handleStripeWebhook(req, res) {
  if (!cloudBilling || !cloudStripe || !stripeWebhookSecret) {
    return sendJson(res, 503, { ok: false, error: 'billing_not_configured' });
  }
  try {
    const rawBody = await readRawBody(req);
    const event = cloudStripe.verifyWebhook(rawBody, String(req.headers['stripe-signature'] || ''));
    // Reconcile an interrupted upgrade and use the current provider state for its webhooks.
    // Older personal-plan events must not reverse a completed team upgrade.
    if (event.type.startsWith('customer.subscription.')) {
      const metadata = event.data.object.metadata || {};
      const hasUpgrades = cloudBilling.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cloud_library_upgrades'").get();
      const operation = hasUpgrades && metadata.workspace_id && cloudBilling.db.prepare('SELECT * FROM cloud_library_upgrades WHERE workspace_id = ?').get(metadata.workspace_id);
      if (operation && ['processing', 'completed'].includes(operation.state)) {
        const data = JSON.parse(operation.data);
        if (data.subscription_id === event.data.object.id) {
          const remote = await cloudStripe.retrieveSubscription({ subscriptionId: data.subscription_id });
          if (remote.metadata.upgrade_operation_id === operation.id && operation.state === 'processing') {
            await require('./lib/cloud-library-upgrade').confirm({ billing: cloudBilling, store: cloudStore,
              stripe: cloudStripe, userId: operation.user_id, workspaceId: operation.workspace_id, operationId: operation.id });
          }
          event.data.object = remote;
          event.upgradeRefreshAtMs = Date.now();
        }
      }
    }
    const changedSponsors = [];
    cloudBilling.processWebhookEvent({ provider: 'stripe', eventId: event.id,
      eventType: event.type, payload: rawBody }, (store) => {
      if (event.type.startsWith('customer.subscription.')) {
        const metadata = event.data.object.metadata || {};
        const existing = metadata.workspace_id
          ? store.getSubscription(metadata.workspace_id) : null;
        const input = stripeSubscriptionInput(event.data.object,
          Number.isSafeInteger(event.upgradeRefreshAtMs) ? event.upgradeRefreshAtMs
            : Number.isSafeInteger(event.created) ? event.created * 1000 : null, existing);
        if (input.workspaceId && input.plan) {
          const after = store.upsertSubscription(input);
          if (cloudSinglePlan && event.data.object.metadata.single_plan === 'true' && after.providerSubscriptionId === event.data.object.id && after.status === 'active' && ['active', 'trialing'].includes(event.data.object.status)) {
            const owner = cloudSinglePlan.db.prepare('SELECT owner_user_id FROM cloud_single_accounts WHERE id=?').get(after.workspaceId);
            if (owner) {
              cloudSinglePlan.db.prepare('UPDATE cloud_single_accounts SET standard_subscription_id=? WHERE id=?').run(after.providerSubscriptionId, after.workspaceId);
              cloudSinglePlan.db.prepare('DELETE FROM cloud_single_checkouts WHERE account_id=? AND operation_id=?').run(after.workspaceId, event.data.object.metadata.single_checkout_operation_id || '');
              changedSponsors.push(after.workspaceId);
              const previousSponsor = cloudSinglePlan.coverage(owner.owner_user_id);
              if (previousSponsor && previousSponsor.account_id !== after.workspaceId) changedSponsors.push(previousSponsor.account_id);
              cloudSinglePlan.db.prepare('INSERT INTO cloud_single_sponsors VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET account_id=excluded.account_id, source_workspace_id=excluded.source_workspace_id').run(owner.owner_user_id, after.workspaceId, after.workspaceId);
            }
          }
          if (cloudSinglePlan && metadata.single_plan === 'true' && after.providerSubscriptionId === event.data.object.id && after.initialPaymentPending && after.status === 'canceled') {
            cloudSinglePlan.db.prepare('DELETE FROM cloud_single_checkouts WHERE account_id=? AND operation_id=?')
              .run(after.workspaceId, metadata.single_checkout_operation_id || '');
          }
          const change = { before: existing, after };
          scheduleBillingLifecycleJobs(change);
          return change;
        }
      }
      return null;
    });
    if (cloudSinglePlan && event.type.startsWith('customer.subscription.')) {
      const metadata = event.data.object.metadata || {};
      const current = metadata.workspace_id && cloudBilling.getSubscription(metadata.workspace_id);
      if (metadata.single_plan === 'true' && current && current.providerSubscriptionId === event.data.object.id && current.status === 'active') changedSponsors.push(current.workspaceId);
    }
    for (const accountId of new Set(changedSponsors)) {
      // Enqueue before the provider call so an interrupted response can be retried.
      scheduleTeamSeatSync(accountId, event.id);
      try { await syncTeamSeatQuantity(accountId, event.id); } catch (_) {}
    }
    sendJson(res, 200, { received: true });
  } catch (error) {
    sendJson(res, error.code === 'payload_too_large' ? 413 : 400,
      { ok: false, error: error.code || 'invalid_webhook' });
  }
}

function handleCloudLogout(req, res) {
  if (!cloudAuthReady(res) || !cloudAuthPostAllowed(req, res)) return;
  const authenticated = cloudAuthSession(req);
  const secure = new URL(CLOUD_AUTH_PUBLIC_ORIGIN).protocol === 'https:';
  const sessionToken = cloudAuthHttp.sessionTokenFromCookies(req.headers.cookie, secure);
  if (authenticated.ok) cloudAuth.revokeSession({ sessionToken });
  res.writeHead(303, {
    Location: '/cloud/sign-in',
    'Set-Cookie': [cloudAuthHttp.clearSessionCookie({ secure }),
      cloudAuthHttp.clearSessionCookie({ secure: !secure })],
    'Cache-Control': 'no-store',
  });
  res.end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (!CLOUD_DEPLOYMENT.publicEnabled &&
      (pathname === '/cloud' || pathname.startsWith('/cloud/') ||
       pathname.startsWith('/api/cloud/') || url.searchParams.has('cloud-document'))) {
    if (pathname.startsWith('/api/')) sendJson(res, 404, { error: 'not_found' });
    else {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('Not Found');
    }
    return;
  }

  if (pathname.startsWith('/api/cloud/v1/')) {
    handleCloudApi(req, res, url);
    return;
  }

  // POST /api/short: create a short link for encrypted ciphertext
  if (req.method === 'POST' && pathname === '/api/short') {
    handleShortLinkPost(req, res);
    return;
  }

  // POST /api/feedback: store user-submitted feedback
  if (req.method === 'POST' && pathname === '/api/feedback') {
    handleFeedbackPost(req, res);
    return;
  }

  // POST /api/teams-interest: relay a Teams contact request to SmallCRM
  if (req.method === 'POST' && pathname === '/api/teams-interest') {
    handleTeamsInterestPost(req, res);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/install-interest') {
    handleTeamsInterestPost(req, res, true);
    return;
  }

  if (pathname === '/api/cloud/auth/link' && ['GET', 'POST'].includes(req.method)) {
    handleCloudIdentityLink(req, res, url); return;
  }

  if (req.method === 'POST' && pathname === '/api/cloud/auth/email/request') {
    handleCloudEmailRequest(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/cloud/auth/email/verify') {
    handleCloudEmailVerify(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/cloud/auth/terms/accept') {
    handleCloudTermsAcceptance(req, res);
    return;
  }

  if (pathname === '/api/cloud/auth/test-login') {
    if (!CLOUD_TEST_LOGIN_ENABLED) {
      sendJson(res, 404, { ok: false, error: 'not_found' });
      return;
    }
    if (req.method === 'POST') handleCloudTestLogin(req, res);
    else sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/cloud/auth/logout') {
    handleCloudLogout(req, res);
    return;
  }

  const oauthBeginMatch = /^\/api\/cloud\/auth\/oauth\/(google|github)$/.exec(pathname);
  if (req.method === 'GET' && oauthBeginMatch) {
    beginCloudOAuth(req, res, url, oauthBeginMatch[1]);
    return;
  }

  const oauthCallbackMatch = /^\/api\/cloud\/auth\/oauth\/(google|github)\/callback$/.exec(pathname);
  if (req.method === 'GET' && oauthCallbackMatch) {
    finishCloudOAuth(req, res, url, oauthCallbackMatch[1]);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/cloud/billing/stripe/webhook') {
    handleStripeWebhook(req, res);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/cloud/billing/subscription') {
    const principal = cloudApiPrincipal(req, res);
    if (!principal) return;
    if (!cloudSinglePlan) { sendJson(res, 404, { ok: false, error: 'resource_unavailable' }); return; }
    const userId = principal.user.id;
    const account = cloudSinglePlan.ownAccount(userId);
    const sponsor = cloudSinglePlan.coverage(userId);
    const coverage = sponsor && cloudSinglePlan.hasSponsoredMembership(userId, sponsor.account_id)
      ? cloudSinglePlan.subscriptionAccess(sponsor.account_id) : null;
    const subscription = account && cloudBilling.getSubscription(account.id);
    const trial = cloudBilling.db.prepare('SELECT ends_at_ms FROM cloud_billing_personal_trials WHERE user_id=?').get(userId);
    const trialEnd = coverage && coverage.trialEndsAtMs
      ? Math.min(coverage.trialEndsAtMs, trial ? trial.ends_at_ms : Infinity) : trial && trial.ends_at_ms;
    const subscriptionState = cloudSubscriptionState(userId);
    sendJson(res, 200, { ok: true, ...subscriptionState, email: verifiedCloudEmail(userId),
      trial_ends_at_ms: trialEnd || null,
      trial_active: subscriptionState.phase === 'trial',
      subscription_status: subscription ? subscription.status : null,
      payment_pending: Boolean(subscription && subscription.initialPaymentPending && subscription.status !== 'canceled'),
      covered_elsewhere: Boolean(sponsor && (!account || sponsor.account_id !== account.id) && coverage && coverage.access.write
        && cloudBilling.getSubscription(sponsor.account_id)),
      quantity: account ? cloudSinglePlan.seatCount(account.id) : 1 });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/cloud/billing/subscribe') {
    const principal = cloudApiPrincipal(req, res);
    if (!principal || !cloudAuthPostAllowed(req, res)) return;
    (async () => { try {
      requireRecentBrowser(principal);
      if (!cloudSinglePlan || !cloudStripe || !process.env.STRIPE_STANDARD_PRICE_ID) throw Object.assign(new Error('billing_not_configured'), { code: 'billing_not_configured' });
      const session = await cloudSinglePlan.checkout({ userId: principal.user.id, stripe: cloudStripe, priceId: process.env.STRIPE_STANDARD_PRICE_ID, origin: CLOUD_AUTH_PUBLIC_ORIGIN, email: verifiedCloudEmail(principal.user.id) });
      sendJson(res, 200, { ok: true, checkout_url: session.url });
    } catch (error) { cloudApiError(res, error); } })();
    return;
  }
  if (req.method === 'POST' && pathname === '/api/cloud/billing/checkout') {
    if (SINGLE_PLAN_ENABLED) { sendJson(res, 409, { ok: false, error: 'use_single_subscription', subscribe_url: '/cloud/subscribe' }); return; }
    if (!cloudStripe || !cloudBilling || !cloudStore) {
      sendJson(res, 503, { ok: false, error: 'billing_not_configured' });
      return;
    }
    const principal = cloudApiPrincipal(req, res);
    if (!principal || !cloudAuthPostAllowed(req, res)) return;
    cloudAuthHttp.readJson(req).then(async (body) => {
      requireRecentBrowser(principal);
      const workspace = (await cloudStore.listWorkspaces(principal.user.id))
        .find((item) => item.id === body.workspace_id && item.role === 'owner');
      if (!workspace) throw Object.assign(new Error('permission_denied'), { code: 'permission_denied' });
      const plan = body.plan === 'team' ? 'team' : body.plan === 'personal' ? 'personal' : null;
      if (!plan || (plan === 'personal' && workspace.kind !== 'personal') ||
          (plan === 'team' && workspace.kind !== 'team')) {
        throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
      }
      const priceId = plan === 'team' ? process.env.STRIPE_TEAM_PRICE_ID : process.env.STRIPE_PERSONAL_PRICE_ID;
      if (!priceId) throw Object.assign(new Error('billing_not_configured'), { code: 'billing_not_configured' });
      const existingSubscription = cloudBilling.getSubscription(workspace.id);
      if (existingSubscription && ['active', 'past_due'].includes(existingSubscription.status)) {
        throw Object.assign(new Error('subscription_exists'), { code: 'subscription_exists' });
      }
      const usage = cloudStore.getWorkspaceUsage({ userId: principal.user.id, workspaceId: workspace.id });
      const identity = principal.user.identities.find((item) => item.verifiedEmail);
      const successTarget = new URL(cloudAuthHttp.safeReturnPath(body.return_to), CLOUD_AUTH_PUBLIC_ORIGIN);
      successTarget.searchParams.set('checkout', 'success');
      successTarget.searchParams.set('workspace_id', workspace.id);
      const session = await cloudStripe.createCheckoutSubscriptionSession({
        priceId, quantity: plan === 'team' ? Math.max(1, usage.memberCount) : 1,
        successUrl: successTarget.toString(),
        cancelUrl: CLOUD_AUTH_PUBLIC_ORIGIN + '/cloud?checkout=cancelled',
        workspaceId: workspace.id, plan, customerEmail: identity && identity.verifiedEmail,
        metadata: { owner_user_id: principal.user.id },
        idempotencyKey: 'workspace-checkout-' + workspace.id + '-' + plan,
      });
      sendJson(res, 200, { ok: true, checkout_url: session.url });
    }).catch((error) => cloudApiError(res, error));
    return;
  }

  // HEAD is routed exactly like GET. Node's http server omits the response
  // body for HEAD automatically while still sending headers (Content-Type,
  // Content-Length), so a HEAD gets correct metadata with no payload. Some
  // link-preview crawlers (WhatsApp) HEAD an og:image before downloading it;
  // answering 405 made them drop the preview.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  // GET /api/short/:id: fetch ciphertext for a short link
  if (pathname.startsWith('/api/short/')) {
    const id = pathname.slice('/api/short/'.length);
    handleShortLinkGet(res, id);
    return;
  }

  // CLI installer script: `curl -fsSL https://smalldocs.org/install | sh`.
  // Installs the `sdoc` command under ~/.sdocs without npm or root.
  if (pathname === '/install') {
    if (CLOUD_DEPLOYMENT.mode === 'staging') {
      const source = require('./lib/staging-cli-package').installer(
        fs.readFileSync(path.join(__dirname, 'install.sh'), 'utf8'), require('./cli/package.json').version);
      res.writeHead(200, { 'Content-Type': 'text/x-shellscript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(source); return;
    }
    serveFile(req, res, path.join(__dirname, 'install.sh'), { 'Cache-Control': 'no-cache' });
    return;
  }

  if (pathname === '/cli/sdocs-dev.tgz' && CLOUD_DEPLOYMENT.mode === 'staging') {
    serveFile(req, res, path.join(__dirname, 'cli-artifacts', 'sdocs-dev.tgz'), { 'Cache-Control': 'no-store', 'Content-Type': 'application/gzip' });
    return;
  }

  if (pathname === '/llms.txt') {
    serveFile(req, res, path.join(__dirname, 'public', 'llms.txt'), {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    return;
  }

  // Root entry point. New visitors stay on the marketing landing page;
  // returning browsers route to their available library in the page's first
  // script, after preserving old document fragments and homepage anchors.
  // /home serves the same page but explicitly bypasses that library redirect.
  // Standalone HTML (no /public/
  // assets except the hero poster under /public/homepage/; the hero video
  // streams from Cloudflare R2, bucket smalldocs-media), but still routed
  // through serveHtmlWithRewrite so any future asset additions get
  // cache-busted. Hash-encoded document links (#md=...) that land on the
  // root belong to the app at /docs; fragments never reach the server, so
  // an inline script in the page forwards them client-side.
  if (pathname === '/' || pathname === '/home' || pathname === '/home-next') {
    const homepageNav = homepageNavigation(req);
    serveHtmlWithRewrite(res, path.join(__dirname, 'public',
      pathname === '/home-next' || SINGLE_PLAN_ENABLED ? 'homepage-next.html' : 'homepage.html'),
      {
        ...homepageNav.substitutions,
        '__HOME_CLOUD_AUTHENTICATED__': homepageNav.authenticated ? 'true' : 'false',
        '__HOME_GOOGLE_ENABLED__': cloudGoogleOAuth && CLOUD_DEPLOYMENT.publicEnabled ? 'true' : 'false',
      }, {
      'Cache-Control': homepageNav.authenticated ? 'private, no-store' : 'no-cache',
      'Vary': 'Cookie',
    });
    return;
  }

  // The landing page's old address, kept as a redirect for links in the wild.
  if (pathname === '/homepage') {
    res.writeHead(301, { Location: '/' });
    res.end();
    return;
  }

  // SmallDocs for business: capability overview + contact form. The form
  // posts to /api/teams-interest, which relays it to SmallCRM.
  if (pathname === '/business') {
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'business.html'), null, {
      'Cache-Control': 'no-cache',
    });
    return;
  }

  // SmallDocs Cloud product, pricing, and security details.
  if (pathname === '/cloud') {
    const cloudNavigation = homepageNavigation(req);
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud.html'), {
      '__CLOUD_AUTHENTICATED__': cloudNavigation.authenticated ? 'true' : 'false',
      '__CLOUD_LEGACY_LIBRARY__': cloudNavigation.legacyLibrary ? 'true' : 'false',
      '__CLOUD_TERMS_ACCEPTED__': cloudNavigation.termsAccepted ? 'true' : 'false',
    }, {
      'Cache-Control': CLOUD_DEPLOYMENT.publicEnabled ? 'private, no-store' : 'no-cache',
      ...(CLOUD_DEPLOYMENT.publicEnabled ? { Vary: 'Cookie' } : {}),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    return;
  }

  if (pathname === '/cloud/link' || pathname === '/cloud/link-email') {
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-link.html'), null, {
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    }); return;
  }

  if (pathname === '/cloud/sign-in') {
    const hasCloudOAuth = Boolean(cloudGoogleOAuth || cloudGitHubOAuth);
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-sign-in.html'), {
      '__OAUTH_PROVIDERS_HIDDEN__': hasCloudOAuth ? '' : ' hidden',
      '__GOOGLE_OAUTH_HIDDEN__': cloudGoogleOAuth ? '' : ' hidden',
      '__GITHUB_OAUTH_HIDDEN__': cloudGitHubOAuth ? '' : ' hidden',
    }, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
    });
    return;
  }

  if (pathname === '/cloud/start' || pathname === '/cloud/join-request') {
    const authenticated = cloudAuthSession(req);
    const returnTo = pathname + url.search;
    if (!authenticated.ok) {
      res.writeHead(303, { Location: '/cloud/sign-in?return=' + encodeURIComponent(returnTo), 'Cache-Control': 'no-store' });
      res.end(); return;
    }
    if (redirectForCloudTerms(res, authenticated, returnTo)) return;
    if (pathname === '/cloud/start' && (!authenticated.user.firstName || !authenticated.user.lastName)) {
      res.writeHead(303, { Location: '/cloud/profile?return=' + encodeURIComponent(returnTo), 'Cache-Control': 'no-store' });
      res.end(); return;
    }
    if (pathname === '/cloud/start') {
      (async () => {
        try {
          const workspaces = await completeCloudOnboarding(authenticated.user);
          const explicit = workspaces.find(w => w.id === url.searchParams.get('workspace_id'));
          const selected = explicit || (workspaces.length === 1 ? workspaces[0] : null);
          const resume = cloudAuthHttp.safeReturnPath(url.searchParams.get('return'), '/cloud/start');
          const target = new URL(resume, CLOUD_AUTH_PUBLIC_ORIGIN).pathname !== '/cloud/start' ? resume
            : '/cloud/admin?panel=' + (url.searchParams.get('choose') === '1' || !selected ? 'libraries' : 'install')
            + (selected ? '&workspace_id=' + encodeURIComponent(selected.id) : '');
          res.writeHead(303, { Location: target, 'Cache-Control': 'no-store' }); res.end();
        } catch (error) { serveCloudSetupError(res, error, url.searchParams.get('return')); }
      })(); return;
    }
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-join-request.html'), null, {
      'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    return;
  }

  if (pathname === '/cloud/profile') {
    const returnTo = cloudAuthHttp.safeReturnPath(url.searchParams.get('return'), '/cloud/start');
    const authenticated = cloudAuthSession(req);
    if (!authenticated.ok) {
      res.writeHead(303, { Location: '/cloud/sign-in?return=' + encodeURIComponent(pathname + url.search), 'Cache-Control': 'no-store' });
      res.end(); return;
    }
    if (redirectForCloudTerms(res, authenticated, pathname + url.search)) return;
    if (authenticated.user.firstName && authenticated.user.lastName) {
      (async () => {
        const continuation = await cloudSignInContinuation(authenticated.user, returnTo);
        res.writeHead(303, { Location: continuation.return_to, 'Cache-Control': 'no-store' }); res.end();
      })().catch(error => serveCloudSetupError(res, error, returnTo));
      return;
    }
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-profile.html'), null, {
      'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    return;
  }

  if (pathname === '/cloud/terms') {
    const authenticated = cloudAuthSession(req);
    const returnTo = cloudAuthHttp.safeReturnPath(url.searchParams.get('return'));
    if (!authenticated.ok) {
      res.writeHead(303, { Location: '/cloud/sign-in?return=' +
        encodeURIComponent(returnTo), 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (cloudTermsAccepted(authenticated.user)) {
      res.writeHead(303, { Location: returnTo, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-terms.html'), {
      '__CLOUD_TERMS_VERSION__': CURRENT_TERMS_VERSION,
      '__CLOUD_TERMS_LABEL__': CURRENT_TERMS_LABEL,
    }, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
    });
    return;
  }

  if (pathname === '/cloud/test-login') {
    if (!CLOUD_TEST_LOGIN_ENABLED) {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('Not Found');
      return;
    }
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-test-login.html'), null, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
    });
    return;
  }

  if (pathname === '/cloud/authorize') {
    const authenticated = cloudAuthSession(req);
    if (!authenticated.ok) {
      res.writeHead(303, { Location: '/cloud/sign-in?return=' + encodeURIComponent(req.url), 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (redirectForCloudTerms(res, authenticated, req.url)) return;
    if (SINGLE_PLAN_ENABLED && (!authenticated.user.firstName || !authenticated.user.lastName)) {
      res.writeHead(303, { Location: '/cloud/profile?return=' + encodeURIComponent(req.url), 'Cache-Control': 'no-store' });
      res.end(); return;
    }
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-authorize.html'), null, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
    });
    return;
  }

  if (pathname === '/cloud/account') {
    res.writeHead(303, { Location: '/cloud/admin?panel=machines', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  if (pathname === '/cloud/invite') {
    const returnPath = pathname + url.search;
    const authenticated = cloudAuthSession(req);
    if (!authenticated.ok) {
      res.writeHead(303, { Location: '/cloud/sign-in?return=' + encodeURIComponent(returnPath),
        'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (redirectForCloudTerms(res, authenticated, returnPath)) return;
    if (!authenticated.user.firstName || !authenticated.user.lastName) {
      res.writeHead(303, { Location: '/cloud/profile?return=' + encodeURIComponent(returnPath), 'Cache-Control': 'no-store' });
      res.end(); return;
    }
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-invite.html'), null, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
    });
    return;
  }

  // Old invitation links use the same acceptance screen as all library invites.
  if (pathname === '/cloud/business-invite') {
    const target = new URL('/cloud/invite', CLOUD_AUTH_PUBLIC_ORIGIN);
    if (url.searchParams.get('token')) target.searchParams.set('token', url.searchParams.get('token'));
    res.writeHead(303, { Location: target.pathname + target.search, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end(); return;
  }

  if (pathname === '/cloud/trial-feedback') {
    const session = cloudAuthSession(req);
    if (!session.ok) {
      res.writeHead(303, { Location: '/cloud/sign-in?return=%2Fcloud%2Ftrial-feedback', 'Cache-Control': 'no-store' });
      res.end(); return;
    }
    if (redirectForCloudTerms(res, session, pathname)) return;
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-trial-feedback.html'), null, { 'Cache-Control': 'no-store' });
    return;
  }

  if (pathname === '/cloud/subscribe') {
    if (!SINGLE_PLAN_ENABLED) { sendJson(res, 404, { ok: false, error: 'resource_unavailable' }); return; }
    const authenticated = cloudAuthSession(req);
    if (!authenticated.ok) { res.writeHead(303, { Location: '/cloud/sign-in?return=%2Fcloud%2Fsubscribe', 'Cache-Control': 'no-store' }); res.end(); return; }
    if (redirectForCloudTerms(res, authenticated, pathname)) return;
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-subscribe.html'), null, { 'Cache-Control': 'no-store' }); return;
  }
  if (pathname === '/cloud/checkout') {
    res.writeHead(303, { Location: SINGLE_PLAN_ENABLED ? '/cloud/subscribe' : '/cloud/admin', 'Cache-Control': 'no-store' });
    res.end(); return;
  }

  if (pathname === '/cloud/admin') {
    const authenticated = cloudAuthSession(req);
    if (!authenticated.ok) {
      res.writeHead(303, { Location: '/cloud/sign-in?return=' + encodeURIComponent(pathname + url.search),
        'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (redirectForCloudTerms(res, authenticated, pathname + url.search)) return;
    if (SINGLE_PLAN_ENABLED) {
      if (!authenticated.user.firstName || !authenticated.user.lastName) {
        res.writeHead(303, { Location: '/cloud/profile?return=' + encodeURIComponent(pathname + url.search), 'Cache-Control': 'no-store' });
        res.end(); return;
      }
      (async () => {
        try {
          await completeCloudOnboarding(authenticated.user);
          serveCloudAdmin();
        } catch (error) { serveCloudSetupError(res, error, pathname + url.search); }
      })();
      return;
    }
    serveCloudAdmin();
    function serveCloudAdmin() {
      serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-admin.html'), {
        '__CLOUD_LEGACY_LIBRARY__': !SINGLE_PLAN_ENABLED || authenticated.user.legacyLibraryEnabled ? 'true' : 'false',
      }, {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
      });
    }
    return;
  }

  // Version check — used by service worker to detect updates
  if (pathname === '/version-check') {
    const v = url.searchParams.get('v') || '';
    const cohort = url.searchParams.get('cohort') || '';
    // Browser-reported local hour (0-23) and weekday (0=Sun..6=Sat) at visit
    // time. logVisit clamps/validates; a missing or bad value is stored NULL.
    const localHour = url.searchParams.get('lh');
    const localDow = url.searchParams.get('ld');
    // How the page opened (short / hash / local / app). logVisit allowlists it.
    const loadType = url.searchParams.get('lt');
    // Entry-source attribution, frozen by the page at initial load. Explicit
    // source names remain labels only; no campaign record or user ID is stored.
    const trafficSource = url.searchParams.get('src');
    // Opt-in placement attribution for a targeted social short link. The
    // analytics layer validates both opaque values again before storage.
    const placementId = url.searchParams.get('pid');
    const shortLinkId = url.searchParams.get('sid');
    // u=1 means this check fired because the page auto-reloaded for an update.
    // The tab's original load was already counted, and one deploy reloads every
    // open tab, so counting reload re-checks would inflate visits by one per
    // open tab on each release. Log the line for diagnostics, skip the visit.
    const reloadRecheck = url.searchParams.get('u') === '1';
    if (ANALYTICS_ENABLED) {
      console.log([
        new Date().toISOString(),
        req.headers['user-agent'] || '',
        req.headers['referer'] || '',
        req.headers['accept-language'] || '',
        v ? 'cached:' + v : 'no-cache',
        cohort || '-',
        reloadRecheck ? 'reload' : 'visit',
      ].join(' | '));
      if (!reloadRecheck) {
        try { analytics.logVisit(cohort, req.headers['user-agent'] || '', req.headers['referer'] || '', localHour, localDow, loadType, trafficSource, placementId, shortLinkId); } catch (e) { /* analytics failure should not break version-check */ }
      }
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    });
    res.end(JSON.stringify({ version: APP_VERSION }));
    return;
  }

  // Latest CLI release — the reader footer reads this on doc pages to show how
  // long ago the newest sdocs-dev shipped. Cached server-side; safe to cache at
  // the edge briefly too.
  if (pathname === '/cli-latest') {
    getCliLatest().then((info) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=1800',
      });
      res.end(JSON.stringify({ version: info.version, time: info.time }));
    }).catch(() => {
      res.writeHead(503, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ error: 'unavailable' }));
    });
    return;
  }

  // Public feedback page: serves the shell; data fetched via /api/feedback.
  if (pathname === '/feedback') {
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'feedback.html'), null, {
      'Cache-Control': 'no-cache',
    });
    return;
  }

  // Public JSON list of submitted feedback. No IP, no identifiers stored.
  if (pathname === '/api/feedback') {
    try {
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);
      const rows = feedback.list(isNaN(limit) ? 100 : limit);
      sendJson(res, 200, { items: rows });
    } catch (e) {
      sendJson(res, 500, { error: 'db_error' });
    }
    return;
  }

  // Library page: the UI shell only. The data API lives on a local agent
  // the user starts with `sdoc library`. The page reads ?agent=<url>
  // from the query string and fetches everything from there; no data
  // crosses this server.
  if (pathname === '/library') {
    if (SINGLE_PLAN_ENABLED && !url.searchParams.has('scope') && !['agent', 'force', 'demo'].some(key => url.searchParams.has(key))) {
      const session = cloudAuthSession(req);
      if (!session.ok || !session.user.legacyLibraryEnabled) {
        url.searchParams.set('scope', 'cloud');
        res.writeHead(303, { Location: '/library?' + url.searchParams.toString(), 'Cache-Control': 'no-store' });
        res.end(); return;
      }
    }

    if (!CLOUD_DEPLOYMENT.publicEnabled && url.searchParams.get('scope') === 'cloud') {
      res.writeHead(302, { Location: '/library', 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (url.searchParams.get('scope') === 'cloud') {
      const authenticated = cloudAuthSession(req);
      if (redirectForCloudTerms(res, authenticated, pathname + url.search)) return;
      if (redirectForCloudSetup(res, authenticated, pathname + url.search)) return;
      if (redirectForTrialPayment(res, authenticated)) return;
    }
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      // The page talks to a local agent (`sdoc library` server). Allow
      // http/https to loopback only; this matches the existing rule the
      // Bridge uses for ws://localhost.
      "connect-src 'self' http://127.0.0.1:* http://localhost:*",
      "frame-src 'none'",
      "object-src 'none'",
    ].join('; ');
    const libraryNavigation = homepageNavigation(req);
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'library', 'library.html'), {
      '__CLOUD_AUTHENTICATED__': libraryNavigation.authenticated ? 'true' : 'false',
      '__CLOUD_LEGACY_LIBRARY__': libraryNavigation.legacyLibrary ? 'true' : 'false',
      '__CLOUD_TERMS_ACCEPTED__': libraryNavigation.termsAccepted ? 'true' : 'false',
      '__CLOUD_LIBRARY_STYLES__': CLOUD_DEPLOYMENT.publicEnabled
        ? '<link rel="stylesheet" href="/public/library/cloud-library-prototype.css">' : '',
      '__CLOUD_LIBRARY_SCRIPT__': CLOUD_DEPLOYMENT.publicEnabled
        ? '<script src="/public/sdocs-cloud-account-selection.js"></script>'
          + '<script src="/public/library/cloud-library-prototype.js"></script>' : '',
      '<!--__CLOUD_LIBRARY_MOBILE_SCRIPT__-->': CLOUD_DEPLOYMENT.publicEnabled
        ? '<script src="/public/library/library-mobile.js"></script>' : '',
      '<!--__LIBRARY_NAV_MENU_BEFORE__-->': libraryNavigation.authenticated
        ? libraryNavigation.menuBefore : '',
      '<!--__LIBRARY_NAV_MENU_AFTER__-->': libraryNavigation.authenticated
        ? libraryNavigation.menuAfter : '',
      '<!--__LIBRARY_NAV_ACTIONS__-->': !libraryNavigation.authenticated && CLOUD_DEPLOYMENT.publicEnabled
        ? homepageNavLink('library-sign-in',
          '/cloud/sign-in?return=' + encodeURIComponent(pathname + url.search), 'signIn', 'Sign in')
        : '',
      '__LIBRARY_NAV_MENU_HIDDEN__': libraryNavigation.authenticated ? '' : 'hidden',
    }, {
      'Cache-Control': CLOUD_DEPLOYMENT.publicEnabled ? 'private, no-store' : 'no-cache',
      ...(CLOUD_DEPLOYMENT.publicEnabled ? { Vary: 'Cookie' } : {}),
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    return;
  }

  // /connect: the single door for opting into local features. The
  // page is mostly static, but the script makes a deliberate fetch
  // to the loopback agent when the user clicks Connect - so the CSP
  // needs the same allowance the library page uses.
  if (pathname === '/connect') {
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self' http://127.0.0.1:* http://localhost:*",
      "frame-src 'none'",
      "object-src 'none'",
    ].join('; ');
    const connectNavigation = homepageNavigation(req);
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'connect.html'), {
      '__CLOUD_AUTHENTICATED__': connectNavigation.authenticated ? 'true' : 'false',
      '__CLOUD_LEGACY_LIBRARY__': connectNavigation.legacyLibrary ? 'true' : 'false',
      '__CLOUD_TERMS_ACCEPTED__': connectNavigation.termsAccepted ? 'true' : 'false',
      '__CLOUD_CONNECT_LIBRARY_SWITCHER__': CLOUD_DEPLOYMENT.publicEnabled
        ? '<div class="library-onboarding-nav"><nav class="library-scope connect-library-scope" aria-label="Library location">' +
          '<a class="library-scope-option active" href="/library" aria-current="page">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 16h.01"/>' +
          '<path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527' +
          'a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>' +
          '<path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/></svg>Local</a>' +
          '<a class="library-scope-option" href="/library?scope=cloud">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79' +
          'a4.5 4.5 0 1 1 0 9Z"/></svg>Cloud</a></nav></div>'
        : '',
      '__CLOUD_CONNECT_COPY__': CLOUD_DEPLOYMENT.publicEnabled
        ? ' or save to SmallDocs Cloud from the editor' : '',
    }, {
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    return;
  }

  // Explainer for the rescued-files badge. Its prose stays static; the
  // shared sidebar receives the same authenticated state as other pages.
  if (pathname === '/library/rescued') {
    const rescuedNavigation = homepageNavigation(req);
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'library', 'rescued.html'), {
      '__CLOUD_AUTHENTICATED__': rescuedNavigation.authenticated ? 'true' : 'false',
      '__CLOUD_LEGACY_LIBRARY__': rescuedNavigation.legacyLibrary ? 'true' : 'false',
      '__CLOUD_TERMS_ACCEPTED__': rescuedNavigation.termsAccepted ? 'true' : 'false',
    }, {
      'Cache-Control': CLOUD_DEPLOYMENT.publicEnabled ? 'private, no-store' : 'no-cache',
      ...(CLOUD_DEPLOYMENT.publicEnabled ? { Vary: 'Cookie' } : {}),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    return;
  }

  // Trust page — always available. Proves the frontend served matches the
  // commit the server claims to be running. See public/trust.html for copy.
  if (pathname === '/trust') {
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'trust.html'), null, {
      'Cache-Control': 'no-cache',
      'X-Sdocs-Commit': RUNNING_COMMIT,
    });
    return;
  }

  if (pathname === '/trust/manifest') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Sdocs-Commit': RUNNING_COMMIT,
    });
    res.end(JSON.stringify(TRUST_MANIFEST));
    return;
  }

  // Analytics dashboard + JSON API — only mounted when ANALYTICS_ENABLED=1
  if (ANALYTICS_ENABLED && pathname === '/analytics') {
    serveHtmlWithRewrite(res, path.join(__dirname, 'analytics', 'dashboard.html'), null, {
      'Cache-Control': 'no-cache',
    });
    return;
  }

  if (ANALYTICS_ENABLED && pathname === '/analytics/sources') {
    serveHtmlWithRewrite(res, path.join(__dirname, 'analytics', 'sources.html'), null, {
      'Cache-Control': 'no-cache',
    });
    return;
  }

  if (ANALYTICS_ENABLED && pathname === '/analytics/sources/data') {
    try {
      const { getSourceData } = require('./analytics/query');
      const data = getSourceData(url.searchParams.get('type'));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (ANALYTICS_ENABLED && pathname === '/analytics/data') {
    try {
      const { getRetentionData } = require('./analytics/query');
      const data = getRetentionData();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  const blogMatch = /^\/blogs\/([A-Za-z0-9_-]+)$/.exec(pathname);
  const blogSlug = blogMatch && fs.existsSync(path.join(__dirname, 'public', 'blogs', blogMatch[1] + '.md'))
    ? blogMatch[1]
    : null;
  // The /s/<id> id range stays {1,32} so links minted before the id-length
  // bump (8 chars) and after it (22 chars) both serve the app shell.
  const policyDocuments = {
    '/legal': '/public/legal.md',
    '/privacy': '/public/privacy.md',
    '/acceptable-use': '/public/acceptable-use.md',
    '/cancellation': '/public/cancellation.md',
    '/service-closure': '/public/service-closure.md',
    '/subprocessors': '/public/subprocessors.md',
  };

  const developerDocs = {
    overview: path.join(__dirname, 'public', 'developers', 'overview.md'),
    quickstart: path.join(__dirname, 'public', 'developers', 'quickstart.md'),
    content: path.join(__dirname, 'public', 'developers', 'content.md'),
    lifecycle: path.join(__dirname, 'public', 'developers', 'lifecycle.md'),
    security: path.join(__dirname, 'public', 'developers', 'security.md'),
    loading: path.join(__dirname, 'public', 'developers', 'loading.md'),
    agents: path.join(__dirname, 'public', 'developers', 'agents.md'),
    api: path.join(__dirname, 'public', 'developers', 'api.md'),
    'authoring/markdown': path.join(__dirname, '.agents', 'skills', 'smalldocs-author', 'references', 'markdown.md'),
    'authoring/code': path.join(__dirname, '.agents', 'skills', 'smalldocs-author', 'references', 'code.md'),
    'authoring/math': path.join(__dirname, '.agents', 'skills', 'smalldocs-author', 'references', 'math.md'),
    'authoring/diagrams': path.join(__dirname, '.agents', 'skills', 'smalldocs-author', 'references', 'diagrams.md'),
    'authoring/charts': path.join(__dirname, '.agents', 'skills', 'smalldocs-author', 'references', 'charts.md'),
    'authoring/cells': path.join(__dirname, '.agents', 'skills', 'smalldocs-author', 'references', 'cells.md'),
    'authoring/slides': path.join(__dirname, '.agents', 'skills', 'smalldocs-author', 'references', 'slides.md'),
    'authoring/slide-shapes': path.join(__dirname, '.agents', 'skills', 'smalldocs-author', 'references', 'slide-shapes.md'),
    'authoring/apps': path.join(__dirname, '.agents', 'skills', 'smalldocs-author', 'references', 'apps.md'),
    'authoring/walkthroughs': path.join(__dirname, '.agents', 'skills', 'smalldocs-author', 'references', 'walkthroughs.md'),
    'authoring/video': path.join(__dirname, '.agents', 'skills', 'smalldocs-author', 'references', 'video.md'),
    'authoring/styles': path.join(__dirname, '.agents', 'skills', 'smalldocs-author', 'references', 'styles.md'),
  };
  const developerPageMatch = /^\/developers\/((?:authoring\/)?[a-z-]+)\/?$/.exec(pathname);
  const developerPageSlug = pathname === '/developers' || pathname === '/developers/'
    ? 'overview'
    : developerPageMatch && developerDocs[developerPageMatch[1]]
      ? developerPageMatch[1]
      : null;

  if (pathname === '/developers/example/non-collapsible' || pathname === '/developers/example/non-collapsible/') {
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'developers-style-demo.html'), null, {
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; font-src https://cdn.jsdelivr.net; frame-src 'self' https://www.youtube-nocookie.com; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    return;
  }

  if (pathname === '/developers/examples' || pathname === '/developers/examples/') {
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'developers-showcase.html'), null, {
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; font-src https://cdn.jsdelivr.net; frame-src 'self' https://www.youtube-nocookie.com; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    return;
  }

  if (pathname === '/developers/example' || pathname === '/developers/example/') {
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'developers-example.html'), null, {
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; font-src https://cdn.jsdelivr.net; frame-src 'self' https://www.youtube-nocookie.com; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    return;
  }

  if (developerPageSlug) {
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'developers.html'), null, {
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; font-src https://cdn.jsdelivr.net; frame-src 'self' https://www.youtube-nocookie.com; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    return;
  }

  const developerMarkdownMatch = /^\/developers\/((?:authoring\/)?[a-z-]+)\.md$/.exec(pathname);
  if (developerMarkdownMatch && developerDocs[developerMarkdownMatch[1]]) {
    serveFile(req, res, developerDocs[developerMarkdownMatch[1]], {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    return;
  }

  if (pathname === '/developers/llms.txt') {
    serveFile(req, res, path.join(__dirname, 'public', 'developers', 'llms.txt'), {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    });
    return;
  }

  if (pathname === '/developers/integration.md') {
    serveFile(req, res, path.join(__dirname, 'public', 'developers', 'integration.md'), {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    return;
  }

  if (pathname === '/developers/llms-full.txt') {
    const fullReferencePaths = [
      path.join(__dirname, 'public', 'developers', 'integration.md'),
      ...Object.keys(developerDocs)
        .filter(slug => slug.startsWith('authoring/'))
        .map(slug => developerDocs[slug]),
    ];
    const fullReference = fullReferencePaths
      .map(filename => fs.readFileSync(filename, 'utf8').trim())
      .join('\n\n---\n\n') + '\n';
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(fullReference);
    return;
  }

  const skillCatalogPath = pathname === '/.well-known/agent-skills/index.json'
    || pathname === '/.well-known/skills/index.json';
  if (skillCatalogPath) {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify({ skills: [
      {
        name: 'smalldocs-renderer',
        description: 'Integrate the SmallDocs browser renderer into a web application. Use when an application needs to display agent-authored Markdown or SmallDocs rich document features, when adding render, update, and destroy lifecycle wiring, or when debugging a SmallDocs renderer integration.',
        files: ['SKILL.md', 'references/api.md'],
      },
      {
        name: 'smalldocs-author',
        description: 'Create finished SmallDocs Markdown for an application using the SmallDocs renderer. Use when an agent must produce a readable report or rich document containing diagrams, charts, computed cells, slides, runnable HTML, walkthroughs, math, code, video, navigation, or document styling. Do not use for integrating the renderer SDK itself.',
        files: [
          'SKILL.md',
          'references/markdown.md',
          'references/code.md',
          'references/math.md',
          'references/diagrams.md',
          'references/charts.md',
          'references/cells.md',
          'references/slides.md',
          'references/slide-shapes.md',
          'references/apps.md',
          'references/walkthroughs.md',
          'references/video.md',
          'references/styles.md',
        ],
      },
    ] }));
    return;
  }

  const globalSkillCatalogMatch = /^\/agent-skills\/(standard|cloud)\/\.well-known\/(?:agent-skills|skills)\/index\.json$/.exec(pathname);
  if (globalSkillCatalogMatch) {
    const cloud = globalSkillCatalogMatch[1] === 'cloud';
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify({ skills: [{
      name: smallDocsAgentSkill.SKILL_NAME,
      description: cloud
        ? smallDocsAgentSkill.CLOUD_SKILL_DESCRIPTION
        : smallDocsAgentSkill.SKILL_DESCRIPTION,
      files: ['SKILL.md'],
    }] }));
    return;
  }

  const globalSkillMatch = /^\/agent-skills\/(standard|cloud)\/\.well-known\/(?:agent-skills|skills)\/smalldocs\/SKILL\.md$/.exec(pathname);
  if (globalSkillMatch) {
    const cloud = globalSkillMatch[1] === 'cloud';
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(smallDocsAgentSkill.formatSkill(smallDocsAgentSkill.SKILL_VERSION, { cloud }));
    return;
  }

  const skillFileMatch = /^\/\.well-known\/(?:agent-skills|skills)\/(smalldocs-renderer|smalldocs-author)\/(SKILL\.md|references\/[a-z-]+\.md)$/.exec(pathname);
  if (skillFileMatch) {
    const skillName = skillFileMatch[1];
    const skillRelativePath = skillFileMatch[2];
    const allowedSkillFiles = skillName === 'smalldocs-renderer'
      ? new Set(['SKILL.md', 'references/api.md'])
      : new Set([
        'SKILL.md', 'references/markdown.md', 'references/code.md', 'references/math.md',
        'references/diagrams.md', 'references/charts.md', 'references/cells.md',
        'references/slides.md', 'references/slide-shapes.md', 'references/apps.md',
        'references/walkthroughs.md', 'references/video.md',
        'references/styles.md',
      ]);
    if (!allowedSkillFiles.has(skillRelativePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    serveFile(req, res, path.join(__dirname, '.agents', 'skills', skillName, skillRelativePath), {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    return;
  }

  if (pathname === '/sdk/0.1.0/smalldocs.js' || pathname === '/sdk/0.1.1/smalldocs.js') {
    serveFile(req, res, path.join(__dirname, 'sdk', 'browser', 'smalldocs-0.1.1.js'), {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    return;
  }

  if (pathname === '/sdk/0.1.2/smalldocs.js') {
    serveFile(req, res, path.join(__dirname, 'sdk', 'browser', 'smalldocs-0.1.2.js'), {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    return;
  }

  if (pathname === '/sdk/0.1.3/smalldocs.js') {
    serveFile(req, res, path.join(__dirname, 'sdk', 'browser', 'smalldocs.js'), {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    return;
  }

  const sdkMermaidFrameMatch = /^\/sdk\/(0\.2\.0|0\.3\.0|0\.3\.1)\/mermaid-renderer\.html$/.exec(pathname);
  if (sdkMermaidFrameMatch) {
    serveHtmlWithRewrite(res, path.join(__dirname, 'sdk', 'browser', 'releases',
      sdkMermaidFrameMatch[1], 'mermaid-renderer.html'), null, {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Content-Security-Policy': "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src https: data: blob:; font-src 'self' https://cdn.jsdelivr.net; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors *",
      'X-Content-Type-Options': 'nosniff',
    });
    return;
  }

  const sdkAppFrameMatch = /^\/sdk\/(0\.3\.0|0\.3\.1)\/vendor\/sdocs-app-runner\.html$/.exec(pathname);
  if (sdkAppFrameMatch) {
    serveHtmlWithRewrite(res, path.join(__dirname, 'sdk', 'browser', 'releases',
      sdkAppFrameMatch[1], 'vendor', 'sdocs-app-runner.html'), null, {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    return;
  }

  const nativeSdkMatch = /^\/sdk\/(0\.2\.0|0\.3\.0|0\.3\.1)\/(release-manifest\.json|smalldocs\.js|smalldocs\.css|prose-reader\.css|code-reader\.css|slide-reader\.css|core\.js|assets\.js|runtime\.js|version\.js|overlay\.js|download\.js|mermaid-renderer\.js|features\/(?:code|math|video|charts|mermaid|cells|slides|apps|walkthrough|highlight)\.js|vendor\/(?:marked\.esm\.js|purify\.es\.mjs|fonts\/inter-(?:400|500|600)\.woff2|sdocs-(?:prose-reader|code-reader|slide-reader|video-reader|math-reader|mermaid-reader|mermaid-worker|chart-reader|cells|html-component-reader|walkthrough|docwalk)\.css|sdocs-code-lang\/[\w-]+\.js|sdocs-(?:yaml|styles|slugify|marked-del-core|math-core|highlight-core|prose-reader|code-reader|code-focus|slide-reader|present|present-mobile|zoom-math|mermaid|mermaid-focus|charts|cells|cells-formula|cells-xlsx|cells-controller|cells-select|cells-edit|cells-focus|cells-ui|shapes|slide-stdlib|slide-resolve|shape-render|slide-pdf|slide-pptx|video|icons-data|html-components|app-runner|docwalk)\.js))$/.exec(pathname);
  if (nativeSdkMatch) {
    serveFile(req, res, path.join(__dirname, 'sdk', 'browser', 'releases',
      nativeSdkMatch[1], nativeSdkMatch[2]), {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    return;
  }

  if (pathname === '/embed') {
    const parentOrigin = parseEmbedParentOrigin(url.searchParams.get('parentOrigin'));
    const channel = url.searchParams.get('channel');
    if (!parentOrigin || !channel || channel.length > 128) {
      res.writeHead(400, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end('Invalid SmallDocs embed request');
      return;
    }

    const nonce = crypto.randomBytes(16).toString('base64');
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'index.html'), {
      '__APP_VERSION__': APP_VERSION,
      '__SDOCS_DEV__': DEV_MODE ? '1' : '0',
      '__DEFAULT_MD_PATH__': '/public/sdoc.md',
      '__CSP_NONCE__': nonce,
      '__CLOUD_UI_STYLES__': '',
      '__CLOUD_UI_SCRIPT__': '',
      '__EMBED_STYLES__': '<link rel="stylesheet" href="/public/css/embed.css">',
      '__EMBED_SCRIPT__': '<script src="/public/sdocs-embed.js"></script>',
      '__DOCUMENT_LIBRARY_HREF__': '/library',
      '__DOCUMENT_CLOUD_AUTHENTICATED__': 'false',
      '__DOCUMENT_CLOUD_TERMS_ACCEPTED__': 'false',
      '__DOCUMENT_NAV_MENU_HIDDEN__': 'hidden',
      '<!--__DOCUMENT_NAV_MENU_BEFORE__-->': '',
      '<!--__DOCUMENT_NAV_MENU_AFTER__-->': '',
    }, {
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': documentCsp(nonce, parentOrigin),
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    return;
  }

  if (pathname === '/sdoc-app-runner/runner.html') {
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'sdocs-app-runner.html'), null, {
      'Cache-Control': 'no-cache',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    return;
  }

  if (pathname === '/sdoc-app-runner/sdocs-app-runner.js') {
    serveFile(req, res, path.join(__dirname, 'public', 'sdocs-app-runner.js'), {
      'Cache-Control': 'no-cache',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    return;
  }

  const appRunnerFontMatch = /^\/sdoc-app-runner\/fonts\/(inter-(?:400|500|600)\.woff2)$/.exec(pathname);
  if (appRunnerFontMatch) {
    serveFile(req, res, path.join(__dirname, 'public', 'fonts', appRunnerFontMatch[1]), {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    return;
  }

  if (pathname === '/docs' || pathname === '/new' || policyDocuments[pathname] || pathname === '/agent-changes' || pathname === '/cloud-search' || pathname === '/cloud-updates' || pathname === '/advanced-spreadsheets' || pathname === '/runnable-html' || pathname === '/upgrade' || blogSlug || /^\/s\/[A-Za-z0-9_-]{1,32}$/.test(pathname)) {
    if (pathname === '/docs' && url.searchParams.has('cloud-document')) {
      const authenticated = cloudAuthSession(req);
      if (redirectForCloudTerms(res, authenticated, pathname + url.search)) return;
      if (redirectForCloudSetup(res, authenticated, pathname + url.search)) return;
      if (redirectForTrialPayment(res, authenticated)) return;
    }
    const documentNav = documentNavigation(req);
    const nonce = crypto.randomBytes(16).toString('base64');
    const defaultMdPath = policyDocuments[pathname]
      ? policyDocuments[pathname]
      : pathname === '/cloud-search'
          ? '/public/cloud-search.md'
      : pathname === '/cloud-updates'
          ? '/public/cloud-updates.md'
          : pathname === '/agent-changes'
          ? '/public/agent-changes.md'
          : pathname === '/advanced-spreadsheets'
            ? '/public/advanced-spreadsheets.md'
            : pathname === '/runnable-html'
              ? '/public/runnable-html.md'
              : pathname === '/upgrade'
                ? '/public/upgrade.md'
                : blogSlug
                  ? '/public/blogs/' + blogSlug + '.md'
                  : '/public/sdoc.md';
    const csp = documentCsp(nonce);
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'index.html'), {
      '__APP_VERSION__': APP_VERSION,
      '__SDOCS_DEV__': DEV_MODE ? '1' : '0',
      '__DEFAULT_MD_PATH__': defaultMdPath,
      '__CSP_NONCE__': nonce,
      '__CLOUD_UI_STYLES__': CLOUD_DEPLOYMENT.publicEnabled
        ? '<link rel="stylesheet" href="/public/css/cloud-prototype.css">'
          + '<link rel="stylesheet" href="/public/css/cloud-ui-lab.css">' : '',
      '__CLOUD_UI_SCRIPT__': CLOUD_DEPLOYMENT.publicEnabled
        ? '<script src="/public/sdocs-cloud-account-selection.js"></script>'
          + '<script src="/public/sdocs-cloud-prototype.js"></script>'
          + (CLOUD_UI_LAB_ENABLED
            ? '<script src="/public/sdocs-cloud-ui-lab.js"></script>' : '') : '',
      '__EMBED_STYLES__': '',
      '__EMBED_SCRIPT__': '',
      ...documentNav.substitutions,
    }, {
      'Cache-Control': documentNav.authenticated ? 'private, no-store' : 'no-cache',
      'Vary': 'Cookie',
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    return;
  }

  // Shape playground — Phase 1 dev tool for the slides framework.
  if (pathname === '/shapes') {
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'shapes.html'), null, { 'Cache-Control': 'no-cache' });
    return;
  }

  // Service worker must be served from root scope
  if (pathname === '/sw.js') {
    serveFile(req, res, path.join(__dirname, 'public', 'sw.js'), { 'Cache-Control': 'no-cache' });
    return;
  }

  // Migration alias: existing service workers cached /public/default.md
  // before it was renamed to sdoc.md. Serve the new file under the old path
  // so cached clients keep rendering until their SW updates.
  if (pathname === '/public/default.md') {
    serveFile(req, res, path.join(__dirname, 'public', 'sdoc.md'));
    return;
  }

  if (pathname.startsWith('/public/')) {
    const filePath = path.join(__dirname, pathname);
    // Prevent path traversal
    const safe = path.resolve(filePath).startsWith(path.resolve(__dirname));
    if (!safe) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    serveFile(req, res, filePath, { 'X-Sdocs-Commit': RUNNING_COMMIT });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

async function startServer() {
  if (CLOUD_DEPLOYMENT.enabled && CLOUD_DEPLOYMENT.keyProvider === 'kms') {
    await require('./lib/cloud-deployment-config').checkCloudKmsReadiness(cloudKeyProvider);
  }
  if (cloudStore) await cloudStore.encryptDocumentIdempotencyReceipts();
  server.listen(PORT, HOST, () => {
    console.log(`sdocs-dev running at http://${HOST}:${PORT}`);
  });
}

startServer().catch(() => {
  console.error('Cloud startup check failed: temporary_service_failure');
  process.exitCode = 1;
  if (cloudKeyProvider && typeof cloudKeyProvider.clearCache === 'function') cloudKeyProvider.clearCache();
  if (cloudManagedKmsClient && typeof cloudManagedKmsClient.destroy === 'function') {
    cloudManagedKmsClient.destroy();
  }
  setImmediate(() => process.exit(1));
});

let resourcesClosed = false;
function closeResources() {
  if (resourcesClosed) return;
  resourcesClosed = true;
  clearInterval(_shortLinksCleanupTimer);
  clearInterval(cloudAuthCleanupTimer);
  clearInterval(cloudCollaborationMetricsTimer);
  clearInterval(cloudJobTimer);
  shortLinksRateLimit.stopCleanup();
  feedbackRateLimit.stopCleanup();
  const cleanup = [
    analytics && (() => analytics.close()),
    () => shortLinks.close(),
    () => feedback.close(),
    cloudJoinRequests && (() => cloudJoinRequests.close()),
    cloudAuth && (() => cloudAuth.close()),
    cloudOAuthTransactions && (() => cloudOAuthTransactions.close()),
    cloudStore && (() => cloudStore.close()),
    cloudBilling && (() => cloudBilling.close()),
    cloudJobs && (() => cloudJobs.close()),
    cloudKeyProvider && typeof cloudKeyProvider.clearCache === 'function' &&
      (() => cloudKeyProvider.clearCache()),
    cloudManagedKmsClient && typeof cloudManagedKmsClient.destroy === 'function' &&
      (() => cloudManagedKmsClient.destroy()),
  ];
  cleanup.forEach((close) => {
    if (close) {
      try { close(); } catch (_) {}
    }
  });
}

server.on('close', closeResources);

let shutdownStarted = false;
function shutdown() {
  if (shutdownStarted) return;
  shutdownStarted = true;
  clearInterval(cloudJobTimer);
  const forceExit = setTimeout(() => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    closeResources();
    process.exit(1);
  }, 15000);
  if (forceExit.unref) forceExit.unref();
  server.close((error) => {
    clearTimeout(forceExit);
    closeResources();
    process.exit(error ? 1 : 0);
  });
  if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

module.exports = server;
