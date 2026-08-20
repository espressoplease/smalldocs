#!/usr/bin/env node
'use strict';

const fs = require('fs');
const https = require('https');

function readHeartbeatUrl(filePath) {
  if (!filePath) return null;
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error('backup heartbeat credential must be an owner-only file');
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim() || raw.length > 2048 || raw.trim().includes('\n') || raw.trim().includes('\r')) {
    throw new Error('backup heartbeat credential must contain one URL');
  }
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('backup heartbeat URL must use HTTPS without embedded credentials');
  }
  return url;
}

function sendHeartbeat(url, request) {
  const makeRequest = request || https.request;
  return new Promise((resolve, reject) => {
    const req = makeRequest(url, {
      method: 'GET',
      headers: { 'User-Agent': 'SmallDocs-backup/1' },
      timeout: 15000,
    }, (res) => {
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 300) resolve();
      else reject(new Error('backup heartbeat returned HTTP ' + res.statusCode));
    });
    req.on('timeout', () => req.destroy(new Error('backup heartbeat timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const url = readHeartbeatUrl(process.env.SDOCS_BACKUP_HEARTBEAT_URL_FILE);
  if (!url) return;
  await sendHeartbeat(url);
  process.stdout.write('Backup success heartbeat sent\n');
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}

module.exports = { readHeartbeatUrl, sendHeartbeat };
