#!/usr/bin/env node
'use strict';

const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { LOCAL_TEST_LOGIN_SECRET, TEST_LOGIN_EMAILS } = require('./cloud-e2e-constants');

const root = path.join(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cloud-e2e-'));
const appPort = Number(process.env.CLOUD_E2E_APP_PORT || 3111);
const publicPort = Number(process.env.CLOUD_E2E_PORT || 3110);
const publicOrigin = 'https://127.0.0.1:' + publicPort;
const secretFile = path.join(tempDir, 'test-login-secret');
const keyFile = path.join(tempDir, 'localhost-key.pem');
const certFile = path.join(tempDir, 'localhost-cert.pem');

fs.writeFileSync(secretFile, LOCAL_TEST_LOGIN_SECRET, { mode: 0o600 });
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
  '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
  '-keyout', keyFile, '-out', certFile,
], { stdio: 'ignore' });

const env = Object.assign({}, process.env, {
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: String(appPort),
  CLOUD_MODE: 'staging',
  CLOUD_PUBLIC_MODE: 'enabled',
  CLOUD_AUTH_PUBLIC_ORIGIN: publicOrigin,
  CLOUD_ENVIRONMENT: 'staging',
  CLOUD_AUTH_PEPPER: crypto.randomBytes(32).toString('base64url'),
  CLOUD_IDEMPOTENCY_SECRET: crypto.randomBytes(32).toString('base64url'),
  CLOUD_CURSOR_SECRET: crypto.randomBytes(32).toString('base64url'),
  CLOUD_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
  CLOUD_AUTH_DB: path.join(tempDir, 'auth.db'),
  CLOUD_OAUTH_DB: path.join(tempDir, 'oauth.db'),
  CLOUD_DB: path.join(tempDir, 'cloud.db'),
  CLOUD_BILLING_DB: path.join(tempDir, 'billing.db'),
  CLOUD_JOBS_DB: path.join(tempDir, 'jobs.db'),
  CLOUD_TEST_LOGIN_ENABLED: '1',
  CLOUD_TEST_LOGIN_EMAILS: TEST_LOGIN_EMAILS.join(','),
  CLOUD_TEST_LOGIN_SECRET_FILE: secretFile,
  CLOUD_PLAN_LIMITS_JSON: JSON.stringify({
    personal: { maxFileBytes: 10 * 1024 * 1024, revisionRetentionDays: 90, maxMembers: 1 },
    team: { maxFileBytes: 10 * 1024 * 1024, revisionRetentionDays: 90 },
  }),
  CLOUD_REVISION_KEEP_PREVIOUS: '3',
  CLOUD_REVISION_RETENTION_DAYS: '90',
  CLOUD_DOCUMENT_RESTORE_WINDOW_MS: '60000',
  CLOUD_WORKSPACE_RESTORE_WINDOW_MS: '60000',
  STRIPE_SECRET_KEY: 'sk_test_local_cloud_e2e',
  STRIPE_WEBHOOK_SECRET: 'whsec_local_cloud_e2e',
  STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_local_cloud_e2e',
  STRIPE_PERSONAL_PRICE_ID: 'price_local_personal',
  STRIPE_TEAM_PRICE_ID: 'price_local_team',
  NOTIFY_SMTP_HOST: '127.0.0.1',
  NOTIFY_SMTP_PORT: '1',
  NOTIFY_SMTP_USER: 'cloud-e2e',
  NOTIFY_SMTP_PASS: 'cloud-e2e-not-used',
  NOTIFY_EMAIL_FROM: 'cloud-e2e@smalldocs.invalid',
  ANALYTICS_ENABLED: '0',
  SHORT_LINKS_DB: path.join(tempDir, 'short-links.db'),
  FEEDBACK_DB: path.join(tempDir, 'feedback.db'),
  TEAMS_DB: path.join(tempDir, 'teams.db'),
});

execFileSync(process.execPath, [path.join(root, 'ops', 'seed-cloud-staging.js')], {
  cwd: root,
  env,
  stdio: ['ignore', 'ignore', 'inherit'],
});

const app = spawn(process.execPath, [path.join(root, 'server.js')], {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let appReady = false;
let proxy;

function cleanup(code) {
  if (proxy) proxy.close();
  if (!app.killed) app.kill('SIGTERM');
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (Number.isInteger(code)) process.exit(code);
}

app.stderr.on('data', chunk => process.stderr.write(chunk));
app.on('exit', code => {
  if (!appReady) {
    process.stderr.write('Cloud E2E application exited before startup\n');
    cleanup(code || 1);
  }
});

app.stdout.on('data', chunk => {
  const output = chunk.toString();
  process.stdout.write(output);
  if (appReady || !output.includes('running at')) return;
  appReady = true;
  proxy = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) },
    (request, response) => {
      const headers = Object.assign({}, request.headers, {
        host: '127.0.0.1:' + appPort,
      });
      const upstream = http.request({
        hostname: '127.0.0.1',
        port: appPort,
        method: request.method,
        path: request.url,
        headers,
      }, upstreamResponse => {
        response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstream.on('error', error => {
        response.writeHead(502, { 'Content-Type': 'text/plain' });
        response.end('Cloud E2E proxy error');
        process.stderr.write(error.stack + '\n');
      });
      request.pipe(upstream);
    });
  proxy.listen(publicPort, '127.0.0.1', () => {
    process.stdout.write('Cloud E2E ready at ' + publicOrigin + '\n');
  });
});

process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));
process.on('exit', () => {
  if (!app.killed) app.kill('SIGTERM');
  fs.rmSync(tempDir, { recursive: true, force: true });
});
