const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const APP_VERSION = 'sdocs-v1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.md':   'text/plain',
  '.smd':  'text/plain',
  '.woff2': 'font/woff2',
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

  // Version check — used by service worker to detect updates
  if (pathname === '/version-check') {
    const v = url.searchParams.get('v') || '';
    console.log([
      new Date().toISOString(),
      req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      req.headers['user-agent'] || '',
      req.headers['referer'] || '',
      req.headers['accept-language'] || '',
      v ? 'cached:' + v : 'no-cache',
    ].join(' | '));
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    });
    res.end(JSON.stringify({ version: APP_VERSION }));
    return;
  }

  if (pathname === '/' || pathname === '/new') {
    serveFile(res, path.join(__dirname, 'public', 'index.html'));
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
