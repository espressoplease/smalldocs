const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
if (CLOUD_AUTH_PEPPER) {
  const { createAuthStore } = require('./lib/cloud-auth');
  cloudAuth = createAuthStore({
    dbPath: process.env.CLOUD_AUTH_DB || path.join(__dirname, 'cloud_auth.db'),
    pepper: CLOUD_AUTH_PEPPER,
  });
}
setImmediate(() => { if (cloudAuth) cloudAuth.cleanupExpired(); });
const cloudAuthCleanupTimer = setInterval(() => {
  if (cloudAuth) cloudAuth.cleanupExpired();
}, 24 * 60 * 60 * 1000);
if (cloudAuthCleanupTimer.unref) cloudAuthCleanupTimer.unref();

// Cloud document storage is configured separately from authentication. The
// local key provider is for development and tests; production must supply the
// same interface through a managed key service before accepting customer data.
let cloudStore = null;
if (process.env.CLOUD_MASTER_KEY) {
  const { createCloudStore, createLocalKeyProvider } = require('./lib/cloud-store');
  const cloudKeyProvider = createLocalKeyProvider({
    masterKey: process.env.CLOUD_MASTER_KEY,
    environment: process.env.CLOUD_ENVIRONMENT || 'development',
    reference: process.env.CLOUD_KEY_REFERENCE || 'local-development-key',
  });
  cloudStore = createCloudStore({
    dbPath: process.env.CLOUD_DB || path.join(__dirname, 'cloud.db'),
    keyProvider: cloudKeyProvider,
    idempotencySecret: process.env.CLOUD_IDEMPOTENCY_SECRET || CLOUD_AUTH_PEPPER,
  });
}

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
  const cookies = cloudAuthHttp.parseCookies(req.headers.cookie);
  const token = cookies['__Host-sdocs_cloud'] || cookies.sdocs_cloud;
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
    rate_limited: 429,
    invalid_token: 401,
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
  return { user: authenticated.user, credential: authenticated.credential || null };
}

function cloudApiMutationAllowed(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  if (/^Bearer\s+/i.test(String(req.headers.authorization || ''))) return true;
  return cloudAuthPostAllowed(req, res);
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
    if (req.method === 'GET' && pathname === base + '/documents') {
      sendJson(res, 200, { ok: true, documents: cloudStore.listDocuments({
        userId: user.id, projectId: url.searchParams.get('project_id') || undefined,
        workspaceId: url.searchParams.get('workspace_id') || undefined,
      }), next_cursor: null });
      return;
    }
    if (req.method === 'GET' && pathname === base + '/tags') {
      sendJson(res, 200, { ok: true, tags: cloudStore.listTags({
        userId: user.id, projectId: url.searchParams.get('project_id') || undefined,
      }) });
      return;
    }
    if (req.method === 'POST' && pathname === base + '/documents') {
      const body = await cloudAuthHttp.readJson(req, 2 * 1024 * 1024);
      const document = cloudStore.createDocument({
        userId: user.id, projectId: body.project_id, filename: body.filename,
        markdown: body.markdown, idempotencyKey: body.idempotency_key, credentialId,
      });
      sendJson(res, 201, { ok: true, document });
      return;
    }
    if (req.method === 'POST' && pathname === base + '/search') {
      const body = await cloudAuthHttp.readJson(req);
      const documents = cloudStore.search({ userId: user.id, query: body.query,
        projectId: body.project_id, workspaceId: body.workspace_id, limit: body.limit });
      sendJson(res, 200, { ok: true, documents, next_cursor: null });
      return;
    }

    const documentMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)$/);
    if (documentMatch && req.method === 'GET') {
      const document = cloudStore.getDocument({ userId: user.id, documentId: documentMatch[1] });
      sendJson(res, 200, { ok: true, document });
      return;
    }
    if (documentMatch && req.method === 'DELETE') {
      const body = await cloudAuthHttp.readJson(req);
      const deleted = cloudStore.deleteDocument({ userId: user.id, documentId: documentMatch[1],
        expectedHeadRevisionId: body.expected_head_revision_id });
      sendJson(res, 200, { ok: true, document: deleted });
      return;
    }
    const revisionsMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/revisions$/);
    if (revisionsMatch && req.method === 'GET') {
      sendJson(res, 200, { ok: true, revisions: cloudStore.listRevisions({
        userId: user.id, documentId: revisionsMatch[1],
      }), next_cursor: null });
      return;
    }
    if (revisionsMatch && req.method === 'POST') {
      const body = await cloudAuthHttp.readJson(req, 2 * 1024 * 1024);
      const document = cloudStore.saveRevision({
        userId: user.id, documentId: revisionsMatch[1],
        expectedHeadRevisionId: body.expected_head_revision_id,
        markdown: body.markdown, filename: body.filename,
        idempotencyKey: body.idempotency_key, credentialId,
      });
      sendJson(res, 201, { ok: true, document });
      return;
    }
    const revisionMatch = pathname.match(/^\/api\/cloud\/v1\/documents\/([^/]+)\/revisions\/([^/]+)$/);
    if (revisionMatch && req.method === 'GET') {
      const document = cloudStore.getDocument({ userId: user.id, documentId: revisionMatch[1],
        revisionId: revisionMatch[2], includeDeleted: true });
      sendJson(res, 200, { ok: true, document });
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
    if (!CLOUD_AUTH_DEV_LOG_CODES) {
      // Email delivery is a launch provider decision. Do not create a login
      // transaction that the user cannot receive outside explicit dev mode.
      sendJson(res, 503, { ok: false, error: 'email_delivery_not_configured' });
      return;
    }
    const issued = cloudAuth.issueEmailCode({ email: body.email, ip: getClientIp(req) });
    console.log('[cloud-auth-code] ' + issued.requestId + ' ' + issued.code);
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

function handleCloudLogout(req, res) {
  if (!cloudAuthReady(res) || !cloudAuthPostAllowed(req, res)) return;
  const authenticated = cloudAuthSession(req);
  if (authenticated.ok) cloudAuth.revokeSession({
    sessionToken: cloudAuthHttp.parseCookies(req.headers.cookie)['__Host-sdocs_cloud'] ||
      cloudAuthHttp.parseCookies(req.headers.cookie).sdocs_cloud,
  });
  const secure = new URL(CLOUD_AUTH_PUBLIC_ORIGIN).protocol === 'https:';
  res.writeHead(303, {
    Location: '/cloud/sign-in',
    'Set-Cookie': cloudAuthHttp.clearSessionCookie({ secure }),
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
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
    });
    return;
  }

  if (pathname === '/api/cloud/auth/oauth/google' || pathname === '/api/cloud/auth/oauth/github') {
    sendJson(res, 503, { ok: false, error: 'provider_not_configured' });
    return;
  }

  // Interactive local sketch of team workspace administration.
  if (pathname === '/cloud/admin') {
    serveHtmlWithRewrite(res, path.join(__dirname, 'public', 'cloud-admin.html'), null, {
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
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
