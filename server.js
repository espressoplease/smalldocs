const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createCursorCodec, normalizeLimit } = require('./lib/cloud-cursor');

const PORT = process.env.PORT || 3000;
const DEV_MODE = process.env.SDOCS_DEV === '1' || process.env.NODE_ENV === 'development';
const ANALYTICS_ENABLED = process.env.ANALYTICS_ENABLED === '1';
const analytics = ANALYTICS_ENABLED ? require('./analytics/db') : null;

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

// Business-interest contact form. Stored in its own SQLite file; an email
// ping fires when SMTP env vars are set (see teams/notify.js).
// Shares the feedback rate limiter: both are infrequent human submissions
// and a common per-IP budget keeps spam cheap to refuse.
const teamsInterest = require('./teams/db');
const teamsNotify = require('./teams/notify');
teamsInterest.init();

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
let cloudAuth = null;
let cloudOAuthTransactions = null;
let cloudGoogleOAuth = null;
let cloudGitHubOAuth = null;
if (CLOUD_AUTH_PEPPER) {
  const { createAuthStore } = require('./lib/cloud-auth');
  cloudAuth = createAuthStore({
    dbPath: process.env.CLOUD_AUTH_DB || path.join(__dirname, 'cloud_auth.db'),
    pepper: CLOUD_AUTH_PEPPER,
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
      transactions: cloudOAuthTransactions });
  }
  if (process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET) {
    cloudGitHubOAuth = createGitHubOAuth({ clientId: process.env.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
      redirectUri: CLOUD_AUTH_PUBLIC_ORIGIN + '/api/cloud/auth/oauth/github/callback',
      transactions: cloudOAuthTransactions });
  }
}
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
let cloudCursor = null;
if (process.env.CLOUD_KMS_CLIENT_MODULE && process.env.CLOUD_KMS_KEY_ID) {
  const kmsModulePath = path.resolve(process.env.CLOUD_KMS_CLIENT_MODULE);
  const kmsModule = require(kmsModulePath);
  const kmsClient = typeof kmsModule.createKmsClient === 'function'
    ? kmsModule.createKmsClient({ environment: process.env.CLOUD_ENVIRONMENT || 'production' })
    : kmsModule;
  cloudKeyProvider = require('./lib/cloud-kms').createManagedKmsKeyProvider({ kmsClient,
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
if (process.env.CLOUD_BILLING_DB) {
  const { createBillingStore } = require('./lib/cloud-billing');
  let planLimits = {};
  if (process.env.CLOUD_PLAN_LIMITS_JSON) {
    try { planLimits = JSON.parse(process.env.CLOUD_PLAN_LIMITS_JSON); }
    catch (_) { throw new Error('CLOUD_PLAN_LIMITS_JSON must contain valid JSON'); }
  }
  cloudBilling = createBillingStore({ dbPath: process.env.CLOUD_BILLING_DB, planLimits });
  if (process.env.STRIPE_SECRET_KEY) {
    cloudStripe = require('./lib/cloud-stripe').createStripeClient({
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      apiVersion: process.env.STRIPE_API_VERSION || undefined,
    });
  }
}

let cloudJobs = null;
const CLOUD_JOB_WORKER_ID = 'cloud-server-' + process.pid;
if (process.env.CLOUD_JOBS_DB) {
  cloudJobs = require('./lib/cloud-jobs').createCloudJobs({ dbPath: process.env.CLOUD_JOBS_DB });
}

function enqueueCloudJob(input) {
  if (!cloudJobs) return null;
  return cloudJobs.enqueue(input);
}

function scheduleRevisionPrune(document) {
  const keepLatest = Number(process.env.CLOUD_REVISION_KEEP_LATEST);
  if (!cloudJobs || !Number.isSafeInteger(keepLatest) || keepLatest < 1 || !document) return;
  enqueueCloudJob({ type: 'revision_prune',
    idempotencyKey: document.id + ':' + document.current_revision_id,
    payload: { documentId: document.id, keepLatest } });
}

function scheduleTeamSeatSync(workspaceId) {
  if (!cloudJobs) return;
  const usage = cloudStore.getWorkspaceUsage({ workspaceId, skipAccess: true });
  enqueueCloudJob({ type: 'team_seat_sync',
    idempotencyKey: workspaceId + ':' + usage.memberCount,
    payload: { workspaceId } });
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
    if (cloudStore) cloudStore.pruneRevisions({ documentId: job.payload.documentId,
      keepLatest: job.payload.keepLatest });
    return;
  }
  if (job.type === 'team_seat_sync') {
    await syncTeamSeatQuantity(job.payload.workspaceId);
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
    const delivered = await teamsNotify.sendTo(job.payload.email, 'You have been invited to SmallDocs Cloud',
      'You have been invited to a SmallDocs Cloud workspace.\n\nOpen the invitation:\n' + job.payload.acceptUrl);
    if (!delivered.ok) throw Object.assign(new Error('email_delivery_failed'), { code: 'email_delivery_failed' });
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
  '.json': 'application/json',
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
function serveHtmlWithRewrite(res, filePath, subs, extraHeaders) {
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
    res.writeHead(200, headers);
    res.end(html);
  });
}

function getClientIp(req) {
  return cloudAuthHttp.getClientIp(req, process.env.TRUST_PROXY === '1');
}

function sendJson(res, status, obj, extraHeaders) {
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
// a 201 with nothing stored so the bot learns nothing. The email ping is
// fire-and-forget; the SQLite row is the system of record.
const CONTACT_EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,24}$/;

function handleTeamsInterestPost(req, res) {
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
    if (body && typeof body.website === 'string' && body.website.trim().length) {
      sendJson(res, 201, { ok: true });
      return;
    }
    const email = body && typeof body.email === 'string' ? body.email.trim() : '';
    if (!CONTACT_EMAIL_RE.test(email)) {
      sendJson(res, 400, { error: 'invalid_email' });
      return;
    }
    const company = body && typeof body.company === 'string' ? body.company.trim().slice(0, 200) : '';
    const message = body && typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : '';
    try {
      teamsInterest.insert({ email, company, message });
    } catch (e) {
      sendJson(res, 500, { error: 'db_error' });
      return;
    }
    sendJson(res, 201, { ok: true });
    teamsNotify.send(
      'SmallDocs Teams interest: ' + email,
      'New Teams-interest submission on smalldocs.org\n\n' +
      'Email:   ' + email + '\n' +
      'Company: ' + (company || '-') + '\n' +
      'Message: ' + (message || '-') + '\n\n' +
      'All submissions: teams_interest.db on the server.'
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

function cloudApiError(res, error) {
  const code = error && error.code ? error.code : 'temporary_service_failure';
  const statuses = {
    invalid_request: 400,
    login_required: 401,
    permission_denied: 403,
    resource_unavailable: 404,
    revision_conflict: 409,
    idempotency_mismatch: 409,
    final_owner_required: 409,
    personal_workspace_cannot_be_deleted: 409,
    subscription_required: 402,
    subscription_read_only: 402,
    payment_grace_expired: 402,
    file_too_large: 413,
    storage_limit_exceeded: 409,
    project_limit_reached: 409,
    member_limit_reached: 409,
    search_limit_reached: 429,
    billing_not_configured: 503,
    subscription_exists: 409,
    active_subscription_requires_cancellation: 409,
    rate_limited: 429,
    invalid_token: 401,
    recent_auth_required: 401,
    token_reuse: 401,
    temporary_service_failure: 503,
  };
  const body = { ok: false, error: code };
  if (code === 'revision_conflict') {
    body.document_id = error.documentId;
    body.base_revision_id = error.baseRevisionId;
    body.current_revision_id = error.currentRevisionId;
  }
  sendJson(res, statuses[code] || 500, body);
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

function cloudApiMutationAllowed(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  if (/^Bearer\s+/i.test(String(req.headers.authorization || ''))) return true;
  return cloudAuthPostAllowed(req, res);
}

function requireCloudEntitlement(userId, workspaceId, operation, extra) {
  if (!cloudBilling) return null;
  const usage = cloudStore.getWorkspaceUsage({ userId, workspaceId, skipAccess: true });
  const result = cloudBilling.checkOperation(workspaceId, Object.assign({ operation, usage }, extra || {}));
  if (!result.allowed) throw Object.assign(new Error(result.reason), { code: result.reason });
  return result.entitlements;
}

async function syncTeamSeatQuantity(workspaceId) {
  if (!cloudBilling || !cloudStripe) return;
  const subscription = cloudBilling.getSubscription(workspaceId);
  if (!subscription || subscription.plan !== 'team' || subscription.provider !== 'stripe' ||
      !subscription.providerSubscriptionId) return;
  const usage = cloudStore.getWorkspaceUsage({ workspaceId, skipAccess: true });
  const remote = await cloudStripe.retrieveSubscription({
    subscriptionId: subscription.providerSubscriptionId,
  });
  const item = remote.items && remote.items.data && remote.items.data[0];
  if (!item || item.quantity === usage.memberCount) return;
  await cloudStripe.updateSubscriptionItemQuantity({ subscriptionItemId: item.id,
    quantity: Math.max(1, usage.memberCount), prorationBehavior: 'create_prorations',
    idempotencyKey: 'workspace-seats-' + workspaceId + '-' + usage.memberCount });
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
        const status = result.reason === 'authorization_pending' ? 428 : 400;
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
      const result = cloudAuth.refreshCliCredential({ refreshToken: body.refresh_token });
      sendJson(res, 200, { ok: true, credential_id: result.credentialId, user_id: result.userId,
        access_token: result.accessToken, access_token_expires_at: new Date(result.accessExpiresAtMs).toISOString(),
        refresh_token: result.refreshToken, token_type: 'Bearer' });
      return;
    }

    const principal = cloudApiPrincipal(req, res);
    if (!principal || !cloudApiMutationAllowed(req, res)) return;
    const user = principal.user;
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
      cloudAuth.approveDeviceAuthorization({ userCode: body.user_code, userId: user.id });
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/cli/credentials') {
      sendJson(res, 200, { ok: true, credentials: cloudAuth.listCliCredentials(user.id) });
      return;
    }
    const credentialMatch = pathname.match(/^\/api\/cloud\/v1\/cli\/credentials\/([^/]+)$/);
    if (credentialMatch && req.method === 'DELETE') {
      cloudAuth.revokeCliCredential({ userId: user.id, credentialId: credentialMatch[1] });
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/workspaces') {
      const personal = cloudStore.ensurePersonalWorkspace(user.id, 'Personal');
      sendJson(res, 200, { ok: true, personal_workspace_id: personal.workspaceId,
        workspaces: cloudStore.listWorkspaces(user.id) });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/workspaces/deleted') {
      sendJson(res, 200, { ok: true, workspaces: cloudStore.listDeletedWorkspaces(user.id) });
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
      const workspace = cloudStore.createTeamWorkspace({
        userId: user.id, name: body.name, projectName: body.project_name || 'Documents',
      });
      sendJson(res, 201, { ok: true, workspace });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/me') {
      const identity = user.identities.find((item) => item.verifiedEmail) || null;
      sendJson(res, 200, { ok: true, user: { id: user.id,
        email: identity ? identity.verifiedEmail : null } });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/projects') {
      const workspaceId = url.searchParams.get('workspace_id');
      sendJson(res, 200, { ok: true, projects: cloudStore.listProjects(user.id, workspaceId) });
      return;
    }
    const workspaceProjectsMatch = pathname.match(/^\/api\/cloud\/v1\/workspaces\/([^/]+)\/projects$/);
    if (workspaceProjectsMatch && req.method === 'GET') {
      sendJson(res, 200, { ok: true,
        projects: cloudStore.listProjects(user.id, workspaceProjectsMatch[1]) });
      return;
    }
    const workspaceBillingMatch = pathname.match(/^\/api\/cloud\/v1\/workspaces\/([^/]+)\/billing$/);
    if (workspaceBillingMatch && req.method === 'GET') {
      const role = cloudStore.listWorkspaces(user.id).find((workspace) =>
        workspace.id === workspaceBillingMatch[1]);
      if (!role) throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
      const usage = cloudStore.getWorkspaceUsage({ userId: user.id,
        workspaceId: workspaceBillingMatch[1] });
      const entitlements = cloudBilling ? cloudBilling.computeEntitlements(workspaceBillingMatch[1], usage) : null;
      sendJson(res, 200, { ok: true, billing: entitlements });
      return;
    }
    const workspaceBillingPortalMatch = pathname.match(/^\/api\/cloud\/v1\/workspaces\/([^/]+)\/billing\/portal$/);
    if (workspaceBillingPortalMatch && req.method === 'POST') {
      requireRecentBrowser(principal);
      if (!cloudStripe || !cloudBilling) throw Object.assign(new Error('billing_not_configured'),
        { code: 'billing_not_configured' });
      const workspace = cloudStore.listWorkspaces(user.id).find((item) =>
        item.id === workspaceBillingPortalMatch[1] && item.role === 'owner');
      const subscription = workspace && cloudBilling.getSubscription(workspace.id);
      if (!subscription || !subscription.providerCustomerId) {
        throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
      }
      const portal = await cloudStripe.createBillingPortalSession({
        customerId: subscription.providerCustomerId,
        returnUrl: CLOUD_AUTH_PUBLIC_ORIGIN + '/cloud/admin?workspace_id=' + encodeURIComponent(workspace.id),
        idempotencyKey: crypto.randomUUID(),
      });
      sendJson(res, 200, { ok: true, portal_url: portal.url });
      return;
    }
    if (workspaceProjectsMatch && req.method === 'POST') {
      const body = await cloudAuthHttp.readJson(req);
      requireCloudEntitlement(user.id, workspaceProjectsMatch[1], 'create_project');
      const project = cloudStore.createProject({
        userId: user.id, workspaceId: workspaceProjectsMatch[1], name: body.name,
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
      const exported = cloudStore.exportWorkspace({ userId: user.id,
        workspaceId: workspaceExportMatch[1], includeRevisions: true });
      sendJson(res, 200, { ok: true, export: exported }, {
        'Content-Disposition': 'attachment; filename="smalldocs-cloud-export.json"',
      });
      return;
    }
    const workspaceInvitationsMatch = pathname.match(/^\/api\/cloud\/v1\/workspaces\/([^/]+)\/invitations$/);
    if (workspaceInvitationsMatch && req.method === 'GET') {
      sendJson(res, 200, { ok: true, invitations: cloudStore.listWorkspaceInvitations({
        userId: user.id, workspaceId: workspaceInvitationsMatch[1],
      }) });
      return;
    }
    if (workspaceInvitationsMatch && req.method === 'POST') {
      requireRecentBrowser(principal);
      const sourceRate = cloudAuth.consumeRateLimit({ action: 'cloud_invitation_source',
        key: getClientIp(req), limit: Number(process.env.CLOUD_INVITATION_SOURCE_LIMIT) || 30,
        windowMs: Number(process.env.CLOUD_INVITATION_SOURCE_WINDOW_MS) || 60 * 60 * 1000 });
      const workspaceRate = cloudAuth.consumeRateLimit({ action: 'cloud_invitation_workspace',
        key: user.id + ':' + workspaceInvitationsMatch[1],
        limit: Number(process.env.CLOUD_INVITATION_WORKSPACE_LIMIT) || 100,
        windowMs: Number(process.env.CLOUD_INVITATION_WORKSPACE_WINDOW_MS) || 24 * 60 * 60 * 1000 });
      if (!sourceRate.allowed || !workspaceRate.allowed) {
        throw Object.assign(new Error('rate_limited'), { code: 'rate_limited' });
      }
      const body = await cloudAuthHttp.readJson(req);
      requireCloudEntitlement(user.id, workspaceInvitationsMatch[1], 'manage');
      const invitation = cloudStore.createInvitation({
        userId: user.id, workspaceId: workspaceInvitationsMatch[1], email: body.email,
        role: body.role, projectGrants: Array.isArray(body.project_grants) ?
          body.project_grants.map((grant) => ({ projectId: grant.project_id || grant.projectId,
            role: grant.role })) : [],
      });
      const acceptUrl = CLOUD_AUTH_PUBLIC_ORIGIN + '/cloud/invite?token=' + encodeURIComponent(invitation.token);
      if (cloudJobs) {
        enqueueCloudJob({ type: 'invitation_email', idempotencyKey: invitation.id,
          payload: { email: invitation.email, acceptUrl } });
      } else if (teamsNotify.isConfigured()) {
        const delivered = await teamsNotify.sendTo(invitation.email,
          'You have been invited to SmallDocs Cloud',
          'You have been invited to a SmallDocs Cloud workspace.\n\nOpen the invitation:\n' + acceptUrl);
        if (!delivered.ok) console.error('[cloud-invitation] email delivery failed');
      }
      sendJson(res, 201, { ok: true, invitation: {
        id: invitation.id, email: invitation.email, role: invitation.role,
        project_grants: invitation.projectGrants,
        expires_at: new Date(invitation.expiresAtMs).toISOString(),
        accept_url: acceptUrl,
      } });
      return;
    }
    const workspaceInvitationMatch = pathname.match(
      /^\/api\/cloud\/v1\/workspaces\/([^/]+)\/invitations\/([^/]+)$/);
    if (workspaceInvitationMatch && req.method === 'DELETE') {
      requireRecentBrowser(principal);
      const invitation = cloudStore.revokeWorkspaceInvitation({
        userId: user.id, workspaceId: workspaceInvitationMatch[1],
        invitationId: workspaceInvitationMatch[2],
      });
      sendJson(res, 200, { ok: true, invitation });
      return;
    }
    const workspaceMemberMatch = pathname.match(/^\/api\/cloud\/v1\/workspaces\/([^/]+)\/members\/([^/]+)$/);
    if (workspaceMemberMatch && req.method === 'DELETE') {
      requireRecentBrowser(principal);
      cloudStore.removeWorkspaceMember({ actorUserId: user.id,
        workspaceId: workspaceMemberMatch[1], userId: workspaceMemberMatch[2] });
      try { await syncTeamSeatQuantity(workspaceMemberMatch[1]); }
      catch (_) {
        scheduleTeamSeatSync(workspaceMemberMatch[1]);
        console.error('[cloud-billing] seat synchronization queued');
      }
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
    const invitationAcceptMatch = pathname.match(/^\/api\/cloud\/v1\/invitations\/([^/]+)\/accept$/);
    if (invitationAcceptMatch && req.method === 'POST') {
      const verifiedEmails = user.identities.filter((item) => item.verifiedEmail)
        .map((item) => item.verifiedEmail);
      const invitationContext = cloudStore.getInvitationContext({ token: invitationAcceptMatch[1],
        verifiedEmails });
      requireCloudEntitlement(user.id, invitationContext.workspaceId, 'add_member');
      const result = cloudStore.acceptInvitation({ userId: user.id,
        verifiedEmails, token: invitationAcceptMatch[1] });
      try { await syncTeamSeatQuantity(result.workspaceId); }
      catch (_) {
        scheduleTeamSeatSync(result.workspaceId);
        console.error('[cloud-billing] seat synchronization queued');
      }
      sendJson(res, 200, { ok: true, workspace_id: result.workspaceId, role: result.role });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/documents') {
      const projectId = url.searchParams.get('project_id') || undefined;
      const workspaceId = url.searchParams.get('workspace_id') || undefined;
      const limit = normalizeLimit(url.searchParams.get('limit'));
      const cursorScope = JSON.stringify({ endpoint: 'documents', user_id: user.id,
        project_id: projectId || null, workspace_id: workspaceId || null });
      const after = url.searchParams.get('cursor')
        ? cloudCursor.decode(url.searchParams.get('cursor'), cursorScope)
        : null;
      let documents = cloudStore.listDocuments({
        userId: user.id, projectId, workspaceId,
      });
      if (cloudBilling) documents = documents.filter((document) => {
        try {
          const context = cloudStore.getDocumentContext({ userId: user.id, documentId: document.id });
          requireCloudEntitlement(user.id, context.workspaceId, 'read');
          return true;
        } catch (_) { return false; }
      });
      const page = cloudStore.pageDocuments(documents, { limit, after });
      sendJson(res, 200, { ok: true, documents: page.documents,
        next_cursor: page.nextPosition ? cloudCursor.encode(cursorScope, page.nextPosition) : null });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/tags') {
      const projectId = url.searchParams.get('project_id') || undefined;
      let documents = cloudStore.listDocuments({ userId: user.id, projectId });
      if (cloudBilling) documents = documents.filter((document) => {
        try {
          const context = cloudStore.getDocumentContext({ userId: user.id, documentId: document.id });
          requireCloudEntitlement(user.id, context.workspaceId, 'read');
          return true;
        } catch (_) { return false; }
      });
      const counts = new Map();
      documents.forEach((document) => document.tags.forEach((tag) =>
        counts.set(tag, (counts.get(tag) || 0) + 1)));
      const tags = Array.from(counts, ([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
      sendJson(res, 200, { ok: true, tags });
      return;
    }
    if (req.method === 'POST' && pathname === base + '/documents') {
      const body = await cloudAuthHttp.readJson(req, 2 * 1024 * 1024);
      const project = cloudStore.getProjectContext({ userId: user.id,
        projectId: body.project_id, requiredRole: 'editor' });
      requireCloudEntitlement(user.id, project.workspaceId, 'store_revision', {
        fileBytes: Buffer.byteLength(String(body.markdown || ''), 'utf8'),
      });
      const document = cloudStore.createDocument({
        userId: user.id, projectId: body.project_id, filename: body.filename,
        markdown: body.markdown, idempotencyKey: body.idempotency_key, credentialId,
      });
      scheduleRevisionPrune(document);
      sendJson(res, 201, { ok: true, document });
      return;
    }
    if (req.method === 'POST' && pathname === base + '/search') {
      const body = await cloudAuthHttp.readJson(req);
      const sourceRate = cloudAuth.consumeRateLimit({ action: 'cloud_search_source',
        key: getClientIp(req), limit: Number(process.env.CLOUD_SEARCH_SOURCE_LIMIT) || 60,
        windowMs: Number(process.env.CLOUD_SEARCH_SOURCE_WINDOW_MS) || 60000 });
      if (!sourceRate.allowed) throw Object.assign(new Error('rate_limited'), { code: 'rate_limited' });
      const visibleWorkspaces = cloudStore.listWorkspaces(user.id);
      let projectId = body.project_id || null;
      let workspaceIds;
      if (projectId) {
        const project = cloudStore.getProjectContext({ userId: user.id, projectId });
        workspaceIds = [project.workspaceId];
      } else if (body.workspace_id) {
        if (!visibleWorkspaces.some((workspace) => workspace.id === body.workspace_id)) {
          throw Object.assign(new Error('resource_unavailable'), { code: 'resource_unavailable' });
        }
        workspaceIds = [body.workspace_id];
      } else {
        workspaceIds = visibleWorkspaces.map((workspace) => workspace.id);
      }
      const searchable = [];
      let entitlementFailure = null;
      workspaceIds.forEach((workspaceId) => {
        try {
          const entitlements = requireCloudEntitlement(user.id, workspaceId, 'search');
          const limits = entitlements && entitlements.limits && entitlements.limits.search;
          if (limits && limits.maxRequests && limits.windowMs) {
            const budget = cloudAuth.consumeRateLimit({ action: 'cloud_search_workspace',
              key: user.id + ':' + workspaceId, limit: limits.maxRequests, windowMs: limits.windowMs });
            if (!budget.allowed) throw Object.assign(new Error('search_limit_reached'),
              { code: 'search_limit_reached' });
          }
          searchable.push(workspaceId);
        } catch (error) {
          entitlementFailure = entitlementFailure || error;
        }
      });
      if (!searchable.length && entitlementFailure) throw entitlementFailure;
      const requestedSearchLimit = Math.max(1, Math.min(Number(body.limit) || 50, 100));
      const documents = [];
      searchable.forEach((workspaceId) => {
        documents.push(...cloudStore.search({ userId: user.id, query: body.query,
          projectId, workspaceId, tags: body.tags, limit: requestedSearchLimit,
          maxProjects: Number(process.env.CLOUD_SEARCH_MAX_PROJECTS) || undefined,
          maxDocuments: Number(process.env.CLOUD_SEARCH_MAX_DOCUMENTS) || undefined,
          maxBytes: Number(process.env.CLOUD_SEARCH_MAX_BYTES) || undefined,
          deadlineMs: Number(process.env.CLOUD_SEARCH_DEADLINE_MS) || undefined }));
      });
      documents.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
      sendJson(res, 200, { ok: true, documents: documents.slice(0, requestedSearchLimit),
        next_cursor: null });
      return;
    }

    if (req.method === 'GET' && pathname === base + '/documents/deleted') {
      sendJson(res, 200, { ok: true, documents: cloudStore.listDeletedDocuments({
        userId: user.id, workspaceId: url.searchParams.get('workspace_id') || null,
      }) });
      return;
    }

    const documentMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)$/);
    if (documentMatch && req.method === 'GET') {
      const context = cloudStore.getDocumentContext({ userId: user.id, documentId: documentMatch[1] });
      requireCloudEntitlement(user.id, context.workspaceId, 'read');
      const document = cloudStore.getDocument({ userId: user.id, documentId: documentMatch[1] });
      sendJson(res, 200, { ok: true, document });
      return;
    }
    if (documentMatch && req.method === 'DELETE') {
      const body = await cloudAuthHttp.readJson(req);
      const context = cloudStore.getDocumentContext({ userId: user.id,
        documentId: documentMatch[1], requiredRole: 'editor', includeDeleted: true });
      requireCloudEntitlement(user.id, context.workspaceId, 'manage');
      const deleted = cloudStore.deleteDocument({ userId: user.id, documentId: documentMatch[1],
        expectedHeadRevisionId: body.expected_head_revision_id });
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
      const restored = cloudStore.restoreDeletedDocument({ userId: user.id,
        documentId: documentRestoreMatch[1],
        expectedHeadRevisionId: body.expected_head_revision_id });
      sendJson(res, 200, { ok: true, document: restored });
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
      const body = await cloudAuthHttp.readJson(req, 2 * 1024 * 1024);
      const context = cloudStore.getDocumentContext({ userId: user.id,
        documentId: revisionsMatch[1], requiredRole: 'editor' });
      requireCloudEntitlement(user.id, context.workspaceId, 'store_revision', {
        fileBytes: Buffer.byteLength(String(body.markdown || ''), 'utf8'),
      });
      const document = cloudStore.saveRevision({
        userId: user.id, documentId: revisionsMatch[1],
        expectedHeadRevisionId: body.expected_head_revision_id,
        markdown: body.markdown, filename: body.filename,
        idempotencyKey: body.idempotency_key, credentialId,
      });
      scheduleRevisionPrune(document);
      sendJson(res, 201, { ok: true, document });
      return;
    }
    const revisionMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/revisions\/([^/]+)$/);
    if (revisionMatch && req.method === 'GET') {
      const context = cloudStore.getDocumentContext({ userId: user.id,
        documentId: revisionMatch[1], includeDeleted: true });
      requireCloudEntitlement(user.id, context.workspaceId, 'read');
      const document = cloudStore.getDocument({ userId: user.id, documentId: revisionMatch[1],
        revisionId: revisionMatch[2], includeDeleted: true });
      sendJson(res, 200, { ok: true, document });
      return;
    }
    const restoreMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/revisions\/([^/]+)\/restore$/);
    if (restoreMatch && req.method === 'POST') {
      const body = await cloudAuthHttp.readJson(req);
      const context = cloudStore.getDocumentContext({ userId: user.id,
        documentId: restoreMatch[1], requiredRole: 'editor' });
      requireCloudEntitlement(user.id, context.workspaceId, 'store_revision');
      const document = cloudStore.restoreRevision({
        userId: user.id, documentId: restoreMatch[1], revisionId: restoreMatch[2],
        expectedHeadRevisionId: body.expected_head_revision_id,
        idempotencyKey: body.idempotency_key, credentialId,
      });
      scheduleRevisionPrune(document);
      sendJson(res, 201, { ok: true, document });
      return;
    }
    sendJson(res, 404, { ok: false, error: 'resource_unavailable' });
  } catch (error) {
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
    const issued = cloudAuth.issueEmailCode({ email: body.email, ip: getClientIp(req) });
    if (CLOUD_AUTH_DEV_LOG_CODES) {
      console.log('[cloud-auth-code] ' + issued.requestId + ' ' + issued.code);
    } else {
      const delivered = await teamsNotify.sendTo(body.email, 'Your SmallDocs sign-in code',
        'Your SmallDocs sign-in code is: ' + issued.code + '\n\nThe code expires in 10 minutes.');
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
    const result = cloudAuth.consumeEmailCode({ requestId: body.challenge_id, code: body.code });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: 'invalid_or_expired_code' });
    if (cloudStore) cloudStore.ensurePersonalWorkspace(result.user.id, 'Personal');
    const session = cloudAuth.createBrowserSession(result.user.id);
    const returnTo = cloudAuthHttp.safeReturnPath(body.return_to);
    const secure = new URL(CLOUD_AUTH_PUBLIC_ORIGIN).protocol === 'https:';
    sendJson(res, 200, { ok: true, return_to: returnTo }, {
      'Set-Cookie': cloudAuthHttp.sessionCookie(session.token, {
        secure,
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
      if (state) cloudOAuthTransactions.consume({ provider, state });
      const publicError = providerError ? 'oauth_denied' : 'invalid_oauth_request';
      res.writeHead(303, { Location: '/cloud/sign-in?error=' + publicError,
        'Set-Cookie': clearBinding, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      res.end();
      return;
    }
    const completed = await adapter.callback({ state, code });
    const signedIn = cloudAuth.signInWithExternalIdentity(completed.identity);
    if (cloudStore) cloudStore.ensurePersonalWorkspace(signedIn.user.id, 'Personal');
    const session = cloudAuth.createBrowserSession(signedIn.user.id);
    res.writeHead(303, { Location: cloudAuthHttp.safeReturnPath(completed.returnTo),
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

function stripeSubscriptionInput(subscription, eventCreatedMs) {
  const metadata = subscription.metadata || {};
  const statusMap = {
    active: 'active', trialing: 'active', past_due: 'past_due', unpaid: 'read_only',
    paused: 'read_only', canceled: 'canceled', incomplete: 'read_only',
    incomplete_expired: 'canceled',
  };
  const item = subscription.items && subscription.items.data && subscription.items.data[0];
  return {
    workspaceId: metadata.workspace_id,
    plan: metadata.plan,
    status: statusMap[subscription.status] || 'read_only',
    seatQuantity: Math.max(1, Number(item && item.quantity) || 1),
    provider: 'stripe', providerCustomerId: subscription.customer,
    providerSubscriptionId: subscription.id,
    currentPeriodEndMs: subscription.current_period_end ? subscription.current_period_end * 1000 : null,
    graceEndsAtMs: subscription.status === 'past_due' ? Date.now() +
      Number(process.env.CLOUD_PAYMENT_GRACE_MS || 7 * 24 * 60 * 60 * 1000) : null,
    canceledAtMs: subscription.canceled_at ? subscription.canceled_at * 1000 : null,
    providerEventCreatedMs: eventCreatedMs,
  };
}

async function handleStripeWebhook(req, res) {
  if (!cloudBilling || !cloudStripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return sendJson(res, 503, { ok: false, error: 'billing_not_configured' });
  }
  try {
    const rawBody = await readRawBody(req);
    const event = cloudStripe.verifyWebhook(rawBody, String(req.headers['stripe-signature'] || ''));
    cloudBilling.processWebhookEvent({ provider: 'stripe', eventId: event.id,
      eventType: event.type, payload: rawBody }, (store) => {
      if (event.type.startsWith('customer.subscription.')) {
        const input = stripeSubscriptionInput(event.data.object,
          Number.isSafeInteger(event.created) ? event.created * 1000 : null);
        if (input.workspaceId && input.plan) {
          const existing = store.getSubscription(input.workspaceId);
          if (input.status === 'past_due' && existing && existing.status === 'past_due' &&
              existing.graceEndsAtMs != null) input.graceEndsAtMs = existing.graceEndsAtMs;
          store.upsertSubscription(input);
        }
      }
    });
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

  // POST /api/teams-interest: store a Teams contact request + email ping
  if (req.method === 'POST' && pathname === '/api/teams-interest') {
    handleTeamsInterestPost(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/cloud/auth/email/request') {
    handleCloudEmailRequest(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/cloud/auth/email/verify') {
    handleCloudEmailVerify(req, res);
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

  if (req.method === 'POST' && pathname === '/api/cloud/billing/checkout') {
    if (!cloudStripe || !cloudBilling || !cloudStore) {
      sendJson(res, 503, { ok: false, error: 'billing_not_configured' });
      return;
    }
    const principal = cloudApiPrincipal(req, res);
    if (!principal || !cloudAuthPostAllowed(req, res)) return;
    cloudAuthHttp.readJson(req).then(async (body) => {
      requireRecentBrowser(principal);
      const workspace = cloudStore.listWorkspaces(principal.user.id)
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
    serveFile(req, res, path.join(__dirname, 'install.sh'), { 'Cache-Control': 'no-cache' });
    return;
  }

  // Marketing landing page, served at the root. Standalone HTML (no /public/
  // assets except the hero poster under /public/homepage/; the hero video
  // streams from Cloudflare R2, bucket smalldocs-media), but still routed
  // through serveHtmlWithRewrite so any future asset additions get
  // cache-busted. Hash-encoded document links (#md=...) that land on the
  // root belong to the app at /docs; fragments never reach the server, so
  // an inline script in the page forwards them client-side.
  if (pathname === '/') {
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'homepage.html'), null, {
      'Cache-Control': 'no-cache',
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
  // posts to /api/teams-interest (stores + email ping).
  if (pathname === '/business') {
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'business.html'), null, {
      'Cache-Control': 'no-cache',
    });
    return;
  }

  // SmallDocs Cloud product, pricing, and security details.
  if (pathname === '/cloud') {
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud.html'), null, {
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    return;
  }

  if (pathname === '/cloud/sign-in') {
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-sign-in.html'), null, {
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
    const authenticated = cloudAuthSession(req);
    if (!authenticated.ok) {
      res.writeHead(303, { Location: '/cloud/sign-in?return=' + encodeURIComponent('/cloud/account'), 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-account.html'), null, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
    });
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
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-invite.html'), null, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
    });
    return;
  }

  if (pathname === '/cloud/checkout') {
    const authenticated = cloudAuthSession(req);
    if (!authenticated.ok) {
      res.writeHead(303, { Location: '/cloud/sign-in?return=' + encodeURIComponent(pathname + url.search),
        'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-checkout.html'), null, {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
    });
    return;
  }

  if (pathname === '/cloud/admin') {
    const authenticated = cloudAuthSession(req);
    if (!authenticated.ok) {
      res.writeHead(303, { Location: '/cloud/sign-in?return=' + encodeURIComponent('/cloud/admin'),
        'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-admin.html'), null, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
    });
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
        try { analytics.logVisit(cohort, req.headers['user-agent'] || '', req.headers['referer'] || '', localHour, localDow, loadType); } catch (e) { /* analytics failure should not break version-check */ }
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
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'library', 'library.html'), null, {
      'Cache-Control': 'no-cache',
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
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'connect.html'), null, {
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    return;
  }

  // Static explainer for the rescued-files badge. Pure prose, same CSP
  // as the rest of the site since it doesn't touch the local agent.
  if (pathname === '/library/rescued') {
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'library', 'rescued.html'), null, {
      'Cache-Control': 'no-cache',
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
  if (pathname === '/docs' || pathname === '/new' || pathname === '/legal' || pathname === '/privacy' || pathname === '/agent-changes' || pathname === '/upgrade' || blogSlug || /^\/s\/[A-Za-z0-9_-]{1,32}$/.test(pathname)) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const defaultMdPath = pathname === '/legal'
      ? '/public/legal.md'
      : pathname === '/privacy'
        ? '/public/privacy.md'
        : pathname === '/agent-changes'
          ? '/public/agent-changes.md'
          : pathname === '/upgrade'
            ? '/public/upgrade.md'
            : blogSlug
              ? '/public/blogs/' + blogSlug + '.md'
              : '/public/sdoc.md';
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'nonce-" + nonce + "' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
      "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
      "img-src 'self' data: https:",
      // ws://127.0.0.1:* and ws://localhost:* let the page reach a local
      // Bridge process the `sdoc edit|watch|compose --wait` CLI spawns. The
      // Bridge binds to loopback only and gates the upgrade on a per-session
      // token, so the policy still excludes arbitrary internal IPs.
      // http://127.0.0.1:* and http://localhost:* are the equivalent for
      // the local library agent (`sdoc library`) - same trust boundary.
      "connect-src 'self' https://cdn.jsdelivr.net https://raw.githubusercontent.com ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:*",
      // YouTube embeds (```video blocks) load only from the no-cookie host -
      // the exact origin sdocs-video.js builds its iframe src from. The
      // renderer never emits standard youtube.com, so it is not allowed here.
      "frame-src https://www.youtube-nocookie.com",
      "object-src 'none'",
    ].join('; ');
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'index.html'), {
      '__APP_VERSION__': APP_VERSION,
      '__SDOCS_DEV__': DEV_MODE ? '1' : '0',
      '__DEFAULT_MD_PATH__': defaultMdPath,
      '__CSP_NONCE__': nonce,
    }, {
      'Cache-Control': 'no-cache',
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

server.listen(PORT, () => {
  console.log(`sdocs-dev running at http://localhost:${PORT}`);
});

module.exports = server;
