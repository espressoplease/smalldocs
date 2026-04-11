const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const analytics = require('./analytics/db');

const PORT = process.env.PORT || 3000;

// Auto-version: hash all non-font files in public/ at startup.
// Any file change = new hash = clients purge their SW cache.
const appHash = crypto.createHash('md5');
(function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === 'fonts') continue;
      walkDir(path.join(dir, entry.name));
    } else {
      appHash.update(entry.name);
      appHash.update(fs.readFileSync(path.join(dir, entry.name)));
    }
  }
})(path.join(__dirname, 'public'));
const APP_VERSION = appHash.digest('hex').slice(0, 10);

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

function cacheHeader(ext) {
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  // Version check — used by service worker to detect updates + analytics
  if (pathname === '/version-check') {
    const v = url.searchParams.get('v') || '';
    const cohort = url.searchParams.get('cohort') || '';
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log([
      new Date().toISOString(),
      ip,
      req.headers['user-agent'] || '',
      req.headers['referer'] || '',
      req.headers['accept-language'] || '',
      v ? 'cached:' + v : 'no-cache',
      cohort || '-',
    ].join(' | '));
    try { analytics.logVisit(ip, cohort, req.headers['user-agent'] || '', req.headers['referer'] || ''); } catch (e) { /* analytics failure should not break version-check */ }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    });
    res.end(JSON.stringify({ version: APP_VERSION }));
    return;
  }

  // Analytics dashboard (public)
  if (pathname === '/analytics') {
    serveFile(res, path.join(__dirname, 'analytics', 'dashboard.html'), { 'Cache-Control': 'no-cache' });
    return;
  }

  // Analytics JSON API (public)
  if (pathname === '/analytics/data') {
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

  if (pathname === '/' || pathname === '/new') {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(htmlPath, 'utf8', (err, html) => {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      const nonce = crypto.randomBytes(16).toString('base64');
      html = html.replace('__APP_VERSION__', APP_VERSION);
      html = html.replace(/__CSP_NONCE__/g, nonce);
      const csp = [
        "default-src 'self'",
        "script-src 'self' 'nonce-" + nonce + "' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: https:",
        "connect-src 'self' https://cdn.jsdelivr.net",
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

  if (pathname.startsWith('/public/')) {
    const filePath = path.join(__dirname, pathname);
    // Prevent path traversal
    const safe = path.resolve(filePath).startsWith(path.resolve(__dirname));
    if (!safe) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    serveFile(res, filePath);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`sdocs-dev running at http://localhost:${PORT}`);
});

module.exports = server;
