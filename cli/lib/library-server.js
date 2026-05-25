// Local data agent for the library UI. Binds to 127.0.0.1 only. The UI
// page itself is served by the main SDocs site (`/library`); this agent
// exposes the JSON API the page calls into. CORS is open because the
// agent is loopback-only - only same-machine code can reach it, and the
// data is local.
//
// Lifetime: started by `sdoc library`, opens the browser, stays alive
// in the foreground. Ctrl-C ends it.

const http = require('http');
const { URL } = require('url');
const fs   = require('fs');
const path = require('path');

const store      = require('./library-store');
const libIndex   = require('./library-index');
const libScan    = require('./library-scan');
const autostart  = require('./library-autostart');
const url        = require('./url');
const { startBridge } = require('../bin/sdocs-bridge');

// The two endpoints that work with a caller-supplied path - /file and
// /bridge-for - go through this gate. Three checks, all independent:
//
//   1. realpath() the requested path so a symlink can't smuggle the
//      target past the membership check.
//   2. The deny-pattern list (SSH keys, .env, credentials.{json,...}
//      and anything under .ssh/.aws/.gnupg/...).
//   3. Library-membership: the real path must appear in the index.
//      The index is what the user has explicitly opened with sdoc or
//      placed under a scanned root; arbitrary paths outside that set
//      are refused.
//
// Returns { ok: true, realPath } on pass, { ok: false, reason, status }
// on refusal. Caller picks the HTTP status from `status`.
function gatePath(filePath) {
  const fsMod   = require('fs');
  const pathMod = require('path');
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, status: 400, reason: 'path required' };
  }
  const resolved = pathMod.resolve(filePath);
  if (!fsMod.existsSync(resolved)) {
    return { ok: false, status: 404, reason: 'file not found' };
  }
  let real = resolved;
  try { real = fsMod.realpathSync(resolved); } catch (_) {}
  if (libScan.deniedByPattern(real) || libScan.deniedByPattern(resolved)) {
    return { ok: false, status: 403, reason: 'path is on the deny list' };
  }
  if (!store.isIndexed(real)) {
    return { ok: false, status: 403, reason: 'path is not in the library index' };
  }
  return { ok: true, realPath: real };
}

// Five-digit port in a relatively quiet range. The agent falls back to
// a random free port if this one is occupied, and the CLI prints the
// agent URL on launch either way - so a rare collision degrades
// gracefully rather than crashing.
const DEFAULT_PORT = 47843;

// Browser origins the agent will accept cross-origin requests from.
// The set is the SDocs site (production + future) plus the local dev
// server. SDOCS_URL extends the list for users hosting the page on a
// non-default origin (e.g. running the dev server on a different
// port). SDOCS_AGENT_ALLOWED_ORIGINS is the explicit override.
//
// Loopback-anchored requests with no Origin header (curl, the CLI's
// own callers, other local tools) are allowed - the agent's bind to
// 127.0.0.1 is the same-machine boundary for those.
function defaultAllowedOrigins() {
  const set = new Set([
    'https://sdocs.dev',
    'https://smalldocs.org',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);
  if (process.env.SDOCS_URL) {
    try { set.add(new URL(process.env.SDOCS_URL).origin); } catch (_) {}
  }
  if (process.env.SDOCS_AGENT_ALLOWED_ORIGINS) {
    process.env.SDOCS_AGENT_ALLOWED_ORIGINS.split(',')
      .map(s => s.trim()).filter(Boolean).forEach(o => set.add(o));
  }
  return set;
}

function originAllowed(origin) {
  if (!origin) return true; // no-Origin → non-browser caller, loopback-only
  return defaultAllowedOrigins().has(origin);
}

// Host header must point at loopback. Same rule the Bridge applies, for
// the same reason (DNS rebinding: an attacker DNS that resolves to
// 127.0.0.1 from a script-running page can otherwise reach us via the
// browser even when CORS is locked down).
function hostOk(host) {
  if (!host) return false;
  const h = String(host).toLowerCase();
  // Strip port for comparison.
  const noPort = h.replace(/:\d+$/, '');
  return noPort === '127.0.0.1' || noPort === 'localhost' || noPort === '[::1]';
}

function corsHeadersFor(origin) {
  // No Origin → echo back nothing (the response is for a non-browser
  // caller; CORS doesn't apply). Allowed Origin → echo it back. Disallowed
  // origins never reach this function because we 403 before they do.
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
    'Vary':                         'Origin',
  };
}

function send(res, status, body, headers) {
  // CORS for the request's origin is stashed on res by the request
  // handler before any sendJson runs - keeps callsites unchanged.
  res.writeHead(status, Object.assign({
    'Cache-Control': 'no-store',
  }, corsHeadersFor(res._origin || null), headers || {}));
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj),
       { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function stripBody(e) {
  const { body, ...rest } = e;
  return rest;
}

// Build a sdocs.dev hash URL from a file's contents. Returns null when
// the file has gone missing on disk (entry might be stale).
function buildOpenUrl(entry) {
  const filePath = entry.rescued ? entry.path : entry.path;
  if (!fs.existsSync(filePath)) return null;
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch (_) { return null; }
  // Use the existing CLI url builder. We pass no `local` (no path leak
  // through the URL) and read mode by default.
  const u = url.buildUrl(content, {});
  // The page substitutes its own origin when opening, so we return only
  // the part after the origin. `buildUrl` returns the full URL; carve
  // out the path + hash.
  try {
    const parsed = new URL(u);
    return parsed.pathname + parsed.search + parsed.hash;
  } catch (_) { return u; }
}

function createServer({ port } = {}) {
  const server = http.createServer(async (req, res) => {
    const origin = req.headers['origin'] || null;
    // Stash so sendJson echoes the right Access-Control-Allow-Origin.
    // Only set when the origin is allowed - disallowed/missing origins
    // produce responses with no CORS headers, which is the desired
    // browser-side rejection signal.
    res._origin = (origin && originAllowed(origin)) ? origin : null;
    try {
      // Gate every request, including preflight. Order matters: Host
      // first (a missing/wrong Host means the request didn't reach us
      // legitimately, including via DNS rebinding), then Origin
      // (browser cross-origin rejection), then route.
      if (!hostOk(req.headers['host'])) {
        send(res, 403, 'bad host');
        return;
      }
      if (origin && !originAllowed(origin)) {
        send(res, 403, 'origin not allowed');
        return;
      }

      if (req.method === 'OPTIONS') {
        send(res, 204, '');
        return;
      }

      const u = new URL(req.url, 'http://localhost');
      const route = u.pathname;

      if (req.method === 'GET' && (route === '/' || route === '/api/library/health')) {
        sendJson(res, 200, { ok: true, agent: 'sdocs-library' });
        return;
      }

      if (req.method === 'GET' && route === '/api/library/data') {
        const idx = store.loadIndex();
        const state = store.loadState();
        const as = autostart.status();
        sendJson(res, 200, {
          entries: idx.entries.map(stripBody),
          generatedAt: idx.generatedAt,
          enabled: state.enabled !== false,
          lastScanAt: state.lastScanAt || 0,
          autostart: {
            supported:    as.supported,
            enabled:      as.enabled,
            userDisabled: state.autostartUserDisabled === true,
          },
        });
        return;
      }

      if (req.method === 'GET' && route === '/api/library/entry') {
        const id = u.searchParams.get('id');
        const e = store.getEntry(id);
        if (!e) { sendJson(res, 404, { error: 'not found' }); return; }
        sendJson(res, 200, e);
        return;
      }

      if (req.method === 'GET' && route === '/api/library/open') {
        const id = u.searchParams.get('id');
        const e = store.getEntry(id);
        if (!e) { sendJson(res, 404, { error: 'not found' }); return; }
        const openPath = buildOpenUrl(e);
        if (!openPath) { sendJson(res, 410, { error: 'file missing on disk' }); return; }
        sendJson(res, 200, { url: openPath, path: e.path });
        return;
      }

      if (req.method === 'GET' && route === '/api/library/tags-under') {
        const prefix = u.searchParams.get('prefix');
        if (!prefix) { sendJson(res, 400, { error: 'prefix required' }); return; }
        sendJson(res, 200, { tags: libIndex.tagsUnderPrefix(prefix) });
        return;
      }

      // Tags used by other files in the same project as the given path.
      // The agent walks up from `path` looking for `.git/` to find the
      // project root; if none, falls back to the file's parent directory
      // (NOT `/` - all-tags-ever is too noisy to suggest).
      if (req.method === 'GET' && route === '/api/library/project-tags') {
        const filePath = u.searchParams.get('path');
        if (!filePath) { sendJson(res, 400, { error: 'path required' }); return; }
        const pathMod = require('path');
        const fsMod   = require('fs');
        const startDir = pathMod.dirname(pathMod.resolve(filePath));
        let root = startDir;
        let foundGit = false;
        for (let i = 0; i < 30; i++) {
          if (fsMod.existsSync(pathMod.join(root, '.git'))) { foundGit = true; break; }
          const parent = pathMod.dirname(root);
          if (parent === root) break;
          root = parent;
        }
        if (!foundGit) root = startDir;
        sendJson(res, 200, { root, tags: libIndex.tagsUnderPrefix(root) });
        return;
      }

      if (req.method === 'POST' && route === '/api/library/star') {
        const body = await readBody(req);
        const ok = store.setStar(body.id, !!body.starred);
        sendJson(res, ok ? 200 : 404, { ok });
        return;
      }

      if (req.method === 'POST' && route === '/api/library/rescan') {
        const result = libIndex.scanAndIndex();
        sendJson(res, 200, result);
        return;
      }

      // Serve the current contents of a local file. The editor page
      // uses this to refresh content after the URL-hash snapshot goes
      // stale (e.g. after the user edited tags then reloaded). Gated
      // by gatePath() - only files already in the library index are
      // readable, after realpath resolution and deny-pattern check.
      if (req.method === 'GET' && route === '/api/library/file') {
        const g = gatePath(u.searchParams.get('path'));
        if (!g.ok) { sendJson(res, g.status, { error: g.reason }); return; }
        const fsMod = require('fs');
        let content;
        try { content = fsMod.readFileSync(g.realPath, 'utf8'); }
        catch (e) { sendJson(res, 500, { error: e.message }); return; }
        const stat = fsMod.statSync(g.realPath);
        sendJson(res, 200, { path: g.realPath, content, mtimeMs: stat.mtimeMs });
        return;
      }

      // Re-index a single file. Called by the editor page after a Bridge
      // save so the library catches up immediately (instead of waiting
      // for the next manual scan). Pure read-then-index; never writes
      // the file the path points at.
      if (req.method === 'POST' && route === '/api/library/reindex') {
        const body = await readBody(req);
        const filePath = body && body.path;
        if (!filePath || typeof filePath !== 'string') {
          sendJson(res, 400, { error: 'path required' });
          return;
        }
        const resolved = require('path').resolve(filePath);
        if (!require('fs').existsSync(resolved)) {
          sendJson(res, 404, { error: 'file not found' });
          return;
        }
        const entry = libIndex.indexFile(resolved);
        sendJson(res, 200, { ok: true, tags: entry ? entry.tags : [] });
        return;
      }

      // Start a Bridge for a path and hand the page back the address
      // and one-time token. The agent process runs this Bridge in-tree
      // (same node process), so there's no subprocess to babysit; the
      // Bridge's own idle-timeout handles cleanup when the tab closes.
      // The agent never writes user files itself - any write goes
      // through the Bridge after the user's page connects to it. Gated
      // by gatePath() - only library-indexed files can be bridged.
      if (req.method === 'POST' && route === '/api/library/bridge-for') {
        const body = await readBody(req);
        const g = gatePath(body && body.path);
        if (!g.ok) { sendJson(res, g.status, { error: g.reason }); return; }
        const pathMod = require('path');
        try {
          const bridge = await startBridge({ files: [g.realPath], mode: 'open' });
          sendJson(res, 200, {
            port:  bridge.port,
            token: bridge.token,
            file:  pathMod.basename(g.realPath),
          });
        } catch (e) {
          sendJson(res, 500, { error: 'could not start bridge: ' + e.message });
        }
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
  });

  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      const handleErr = (err) => {
        server.removeListener('error', handleErr);
        if (err.code === 'EADDRINUSE' && p === DEFAULT_PORT) {
          // Fall back to a random port if the canonical one is occupied.
          tryPort(0);
        } else {
          reject(err);
        }
      };
      server.once('error', handleErr);
      server.listen(p, '127.0.0.1', () => {
        server.removeListener('error', handleErr);
        const addr = server.address();
        const agentUrl = `http://127.0.0.1:${addr.port}`;
        resolve({ server, agentUrl, port: addr.port });
      });
    };
    tryPort(port == null ? DEFAULT_PORT : port);
  });
}

module.exports = {
  createServer, DEFAULT_PORT,
  // Exported for tests of the gate logic.
  originAllowed, hostOk, defaultAllowedOrigins,
};
