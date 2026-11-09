'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function request(port, target, options) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: target,
      method: options && options.method || 'GET', agent: false,
      headers: options && options.headers || {} }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(3000, () => req.destroy(new Error('HTTP fixture request timed out')));
    req.on('error', reject);
    req.end(options && options.body);
  });
}

module.exports = function ({ assert, testAsync }) {
  return async function () {
    await testAsync('invalid HTTP request URLs return 400 without stopping the server or dispatching routes', async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-invalid-url-'));
      const port = await availablePort();
      const feedbackPath = path.join(directory, 'feedback.db');
      const shortLinksPath = path.join(directory, 'short-links.db');
      // Keep host credentials and service configuration out of the fixture.
      const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        env: { PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH,
          NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
          FEEDBACK_DB: feedbackPath, SHORT_LINKS_DB: shortLinksPath }, stdio: 'pipe',
      });
      let stdout = '', stderr = '';
      server.stdout.on('data', chunk => stdout += chunk);
      server.stderr.on('data', chunk => stderr += chunk);
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('HTTP fixture did not start')), 8000);
          const ready = () => {
            if (!stdout.includes('running at')) return;
            clearTimeout(timeout);
            server.stdout.removeListener('data', ready);
            resolve();
          };
          server.stdout.on('data', ready);
          server.once('error', reject);
          server.once('exit', code => { clearTimeout(timeout); reject(new Error('HTTP fixture exited: ' + code)); });
        });
        const marker = 'private-request-canary';
        for (const target of ['/\\[', '//[', 'http://[']) {
          const response = await request(port, target + '?' + marker, {
            method: 'POST', body: JSON.stringify({ message: marker, ciphertext: marker }),
            headers: { 'Content-Type': 'application/json' },
          });
          assert.strictEqual(response.status, 400, target);
          assert.strictEqual(response.body, 'Bad Request');
          assert.strictEqual(response.headers['cache-control'], 'no-store');
          assert.strictEqual(response.headers.connection, 'close');
          const healthy = await request(port, '/version-check');
          assert.strictEqual(healthy.status, 200);
        }
        // The request Host is not used as the parsing base.
        assert.strictEqual((await request(port, '/version-check', { headers: { Host: '[invalid' } })).status, 200);
        assert.strictEqual(server.exitCode, null);
        assert.strictEqual(stderr, '');
        assert.ok(!stdout.includes(marker), 'request details must not be logged');
        const Database = require('better-sqlite3');
        for (const [dbPath, table] of [[feedbackPath, 'feedback'], [shortLinksPath, 'short_links']]) {
          const db = new Database(dbPath, { readonly: true });
          try { assert.strictEqual(db.prepare('SELECT count(*) AS n FROM ' + table).get().n, 0); }
          finally { db.close(); }
        }
      } finally {
        if (server.exitCode === null) {
          await new Promise(resolve => {
            const timeout = setTimeout(() => server.kill('SIGKILL'), 3000);
            server.once('exit', () => { clearTimeout(timeout); resolve(); });
            server.kill('SIGTERM');
          });
        }
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  };
};
