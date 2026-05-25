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
const autostart  = require('./library-autostart');
const url        = require('./url');

const DEFAULT_PORT = 4778;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age':       '86400',
};

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({
    'Cache-Control': 'no-store',
  }, CORS, headers || {}));
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
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
    try {
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

      // Mutate the tag list on a file. Used by the file info card in the
      // editor so users can add or remove tags without dropping into a
      // terminal. The file must exist on disk; short-link / hash-URL
      // documents have no path to write to, so the editor sends nothing.
      if (req.method === 'POST' && route === '/api/library/tags') {
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
        const add    = Array.isArray(body.add)    ? body.add    : [];
        const remove = Array.isArray(body.remove) ? body.remove : [];
        if (add.length)    libIndex.injectTagsIntoFile(resolved, add);
        if (remove.length) libIndex.removeTagsFromFile(resolved, remove);
        // Re-index so the library mirrors the new state immediately.
        const entry = libIndex.indexFile(resolved);
        sendJson(res, 200, { ok: true, tags: entry ? entry.tags : [] });
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

module.exports = { createServer, DEFAULT_PORT };
