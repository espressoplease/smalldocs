'use strict';

const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const heartbeat = require('../ops/backup-heartbeat');

module.exports = function(harness) {
  const { assert, test, testAsync } = harness;

  return async function() {
    console.log('\n-- Backup Heartbeat Tests ------------------------\n');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-backup-heartbeat-'));
    try {
      test('backup heartbeat accepts one HTTPS URL from a credential file', () => {
        const file = path.join(dir, 'valid');
        fs.writeFileSync(file, 'https://monitor.test/ping/opaque-token\n', { mode: 0o600 });
        assert.strictEqual(heartbeat.readHeartbeatUrl(file).origin, 'https://monitor.test');
      });

      test('backup heartbeat rejects plaintext and multi-line credentials', () => {
        const plaintext = path.join(dir, 'plaintext');
        const multiple = path.join(dir, 'multiple');
        fs.writeFileSync(plaintext, 'http://monitor.test/ping', { mode: 0o600 });
        fs.writeFileSync(multiple, 'https://monitor.test/one\nhttps://monitor.test/two',
          { mode: 0o600 });
        assert.throws(() => heartbeat.readHeartbeatUrl(plaintext), /must use HTTPS/);
        assert.throws(() => heartbeat.readHeartbeatUrl(multiple), /must contain one URL/);
      });

      test('backup heartbeat rejects a group-readable credential', () => {
        const file = path.join(dir, 'readable');
        fs.writeFileSync(file, 'https://monitor.test/ping', { mode: 0o640 });
        assert.throws(() => heartbeat.readHeartbeatUrl(file), /owner-only file/);
      });

      await testAsync('backup heartbeat accepts a successful monitor response', async () => {
        let ended = false;
        const request = (url, options, callback) => {
          assert.strictEqual(url.hostname, 'monitor.test');
          assert.strictEqual(options.method, 'GET');
          const req = new EventEmitter();
          req.end = () => {
            ended = true;
            const response = new EventEmitter();
            response.statusCode = 204;
            response.resume = () => {};
            callback(response);
          };
          req.destroy = (error) => req.emit('error', error);
          return req;
        };
        await heartbeat.sendHeartbeat(new URL('https://monitor.test/ping'), request);
        assert.strictEqual(ended, true);
      });

      await testAsync('backup heartbeat fails when the monitor rejects the ping', async () => {
        const request = (_url, _options, callback) => {
          const req = new EventEmitter();
          req.end = () => {
            const response = new EventEmitter();
            response.statusCode = 503;
            response.resume = () => {};
            callback(response);
          };
          req.destroy = (error) => req.emit('error', error);
          return req;
        };
        await assert.rejects(
          heartbeat.sendHeartbeat(new URL('https://monitor.test/ping'), request),
          /returned HTTP 503/);
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
};
