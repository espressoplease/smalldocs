'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function ({ test, testAsync, assert }) {
  const monitor = require('../ops/production-monitor');

  return async function() {
    console.log('\n-- Production Monitor Tests ----------------------\n');

  test('production monitor detects fresh and stale local backups', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-monitor-'));
    try {
      const filename = path.join(directory, 'smalldocs-20260824T000000Z-commit.tar.gz');
      fs.writeFileSync(filename, 'archive');
      const now = Date.now();
      fs.utimesSync(filename, new Date(now - 60 * 60 * 1000), new Date(now - 60 * 60 * 1000));
      assert.strictEqual(monitor.checkBackup(directory, now, 26 * 60 * 60 * 1000).ok, true);
      assert.strictEqual(monitor.checkBackup(directory, now, 30 * 60 * 1000).code, 'backup_stale');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  test('production monitor incident key excludes healthy checks and details', () => {
    const key = monitor.incidentKey([
      { ok: true, code: 'http_ok', detail: 'HTTP 200' },
      { ok: false, code: 'backup_stale', detail: 'private filename' },
      { ok: false, code: 'jobs_dead', detail: 'private payload' },
    ]);
    assert.strictEqual(key, 'backup_stale,jobs_dead');
    assert.ok(!key.includes('private'));
  });

  test('production monitor does not treat future scheduled jobs as stale', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-monitor-jobs-'));
    const dbPath = path.join(directory, 'jobs.db');
    const now = Date.now();
    const jobs = require('../lib/cloud-jobs').createCloudJobs({ dbPath, now: () => now });
    try {
      jobs.enqueue({ type: 'future', idempotencyKey: 'future-1', payload: {},
        availableAtMs: now + 24 * 60 * 60 * 1000 });
    } finally {
      jobs.close();
    }
    try {
      const result = monitor.checkJobs(dbPath, now, 15 * 60 * 1000);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.code, 'jobs_ok');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  await testAsync('production monitor alerts once, then sends a recovery message', async () => {
    let state = {};
    const messages = [];
    const config = { origin: 'http://127.0.0.1:3003', backupDir: '/backups', backupMaxAgeMs: 1,
      diskWarningPercent: 80, jobsDb: '/jobs.db', pendingMaxAgeMs: 1,
      stateFile: '/state.json', alertEmail: 'operator@example.com', reminderMs: 1000 };
    const options = {
      config, now: 100,
      checkHttp: async () => ({ ok: false, code: 'http_unavailable', detail: 'ECONNREFUSED' }),
      checkBackup: () => ({ ok: true, code: 'backup_ok', detail: '1 hour old' }),
      checkDisk: () => ({ ok: true, code: 'disk_ok', detail: '10% used' }),
      checkJobs: () => ({ ok: true, code: 'jobs_ok', detail: '0 queued jobs' }),
      readState: () => state,
      writeState: (_, next) => { state = next; },
      sendTo: async (_, subject, body) => { messages.push({ subject, body }); return { ok: true }; },
    };
    assert.strictEqual(await monitor.run(options), 2);
    assert.strictEqual(messages.length, 1);

    options.now = 200;
    assert.strictEqual(await monitor.run(options), 2);
    assert.strictEqual(messages.length, 1);

    options.now = 300;
    options.checkHttp = async () => ({ ok: true, code: 'http_ok', detail: 'HTTP 200' });
    assert.strictEqual(await monitor.run(options), 0);
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[1].subject, 'SmallDocs production recovered');
    });
  };
};
