const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ANALYTICS_ENABLED = process.env.ANALYTICS_ENABLED === '1';
const analytics = ANALYTICS_ENABLED ? require('./analytics/db') : null;

const shortLinks = require('./short-links/db');
const shortLinksRateLimit = require('./short-links/rate-limit');
const SHORT_LINKS_MAX_BYTES = 256 * 1024;       // 256 KB ciphertext cap
const SHORT_LINKS_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
shortLinksRateLimit.startCleanup();
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
  repo: 'https://github.com/espressoplease/SDocs',
  files: trustFiles,
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.md':   'text/plain',
  '.smd':  'text/plain',
  '.woff2': 'font/woff2',
  '.wasm':  'application/wasm',
};

const DEV_MODE = process.env.SDOCS_DEV === '1' || process.env.NODE_ENV === 'development';

function cacheHeader(ext) {
  if (DEV_MODE) return 'no-store';
  if (ext === '.html') return 'no-cache';
  if (ext === '.woff2') return 'public, max-age=31536000, immutable';
  if (ext === '.css' || ext === '.js') return 'public, max-age=86400';
  return 'no-cache';
}

function serveFile(res, filePath, extraHeaders) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath);
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheHeader(ext),
    };
    Object.assign(headers, extraHeaders);
    res.writeHead(200, headers);
    res.end(data);
  });
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
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

function handleShortLinkGet(res, id) {
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // POST /api/short: create a short link for encrypted ciphertext
  if (req.method === 'POST' && pathname === '/api/short') {
    handleShortLinkPost(req, res);
    return;
  }

  // POST /api/feedback: store + mail user-submitted feedback
  if (req.method === 'POST' && pathname === '/api/feedback') {
    handleFeedbackPost(req, res);
    return;
  }

  if (req.method !== 'GET') {
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

  // Version check — used by service worker to detect updates
  if (pathname === '/version-check') {
    const v = url.searchParams.get('v') || '';
    const cohort = url.searchParams.get('cohort') || '';
    if (ANALYTICS_ENABLED) {
      console.log([
        new Date().toISOString(),
        req.headers['user-agent'] || '',
        req.headers['referer'] || '',
        req.headers['accept-language'] || '',
        v ? 'cached:' + v : 'no-cache',
        cohort || '-',
      ].join(' | '));
      try { analytics.logVisit(cohort, req.headers['user-agent'] || '', req.headers['referer'] || ''); } catch (e) { /* analytics failure should not break version-check */ }
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    });
    res.end(JSON.stringify({ version: APP_VERSION }));
    return;
  }

  // Public feedback page: serves the shell; data fetched via /api/feedback.
  if (pathname === '/feedback') {
    serveFile(res, path.join(__dirname, 'public', 'feedback.html'), {
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

  // Trust page — always available. Proves the frontend served matches the
  // commit the server claims to be running. See public/trust.html for copy.
  if (pathname === '/trust') {
    serveFile(res, path.join(__dirname, 'public', 'trust.html'), {
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
    serveFile(res, path.join(__dirname, 'analytics', 'dashboard.html'), { 'Cache-Control': 'no-cache' });
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

  if (pathname === '/' || pathname === '/new' || pathname === '/legal' || /^\/s\/[A-Za-z0-9_-]{1,32}$/.test(pathname)) {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(htmlPath, 'utf8', (err, html) => {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      const nonce = crypto.randomBytes(16).toString('base64');
      const defaultMdPath = pathname === '/legal' ? '/public/legal.md' : '/public/sdoc.md';
      html = html.replace('__APP_VERSION__', APP_VERSION);
      html = html.replace('__SDOCS_DEV__', DEV_MODE ? '1' : '0');
      html = html.replace('__DEFAULT_MD_PATH__', defaultMdPath);
      html = html.replace(/__CSP_NONCE__/g, nonce);
      const csp = [
        "default-src 'self'",
        "script-src 'self' 'nonce-" + nonce + "' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
        "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
        "img-src 'self' data: https:",
        "connect-src 'self' https://cdn.jsdelivr.net https://raw.githubusercontent.com",
        "frame-src 'none'",
        "object-src 'none'",
      ].join('; ');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': csp,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      });
      res.end(html);
    });
    return;
  }

  // Service worker must be served from root scope
  if (pathname === '/sw.js') {
    serveFile(res, path.join(__dirname, 'public', 'sw.js'), { 'Cache-Control': 'no-cache' });
    return;
  }

  // Migration alias: existing service workers cached /public/default.md
  // before it was renamed to sdoc.md. Serve the new file under the old path
  // so cached clients keep rendering until their SW updates.
  if (pathname === '/public/default.md') {
    serveFile(res, path.join(__dirname, 'public', 'sdoc.md'));
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
    serveFile(res, filePath, { 'X-Sdocs-Commit': RUNNING_COMMIT });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`sdocs-dev running at http://localhost:${PORT}`);
});

module.exports = server;
