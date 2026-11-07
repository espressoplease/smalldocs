const fs = require('fs');
const os = require('os');
const path = require('path');
module.exports = function (harness) {
  const { assert, test } = harness;
  return function () {
    const { JoinRequests, companyDomain } = require('../lib/cloud-join-requests');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-join-requests-'));
    let now = Date.now();
    const requests = new JoinRequests({ dbPath: path.join(dir, 'requests.db'), secret: 'test-join-request-secret-32-bytes', now: () => now });
    let request;
    try {
      test('domain request is independent of whether a matching team exists', () => {
        request = requests.create({ userId: 'josh', email: 'josh@joes.com', consented: true, note: 'Engineering' });
        assert.strictEqual(request.status, 'pending');
        assert.strictEqual(request.domain, 'joes.com');
        assert.strictEqual(requests.resolve(request.token).user_id, 'josh');
        assert.deepStrictEqual(Object.keys(request).sort(), ['created_at_ms', 'domain', 'expires_at_ms', 'id', 'note', 'status', 'token']);
      });
      test('duplicate request returns the same unexpired handoff link', () => {
        const again = requests.create({ userId: 'josh', email: 'josh@joes.com', consented: true });
        assert.strictEqual(again.token, request.token);
        assert.strictEqual(again.expires_at_ms, request.expires_at_ms);
      });
      test('company request requires consent and excludes shared email providers', () => {
        assert.strictEqual(companyDomain('person@gmail.com'), null);
        assert.strictEqual(companyDomain('x@JOES.COM'), 'joes.com');
        assert.throws(() => requests.create({ userId: 'x', email: 'x@joes.com', consented: false }));
        assert.throws(() => requests.create({ userId: 'x', email: 'x@gmail.com', consented: true }));
      });
      test('request token cannot be forged and another user cannot cancel it', () => {
        assert.throws(() => requests.resolve(request.token + 'x'), e => e.code === 'resource_unavailable');
        assert.throws(() => requests.cancel('bob', request.id), e => e.code === 'resource_unavailable');
      });
      test('request cancellation is idempotent and invalidates the link', () => {
        requests.cancel('josh', request.id); requests.cancel('josh', request.id);
        assert.throws(() => requests.resolve(request.token), e => e.code === 'resource_unavailable');
      });
      test('expired links fail and a fresh request gets a different token', () => {
        const old = requests.create({ userId: 'josh', email: 'josh@joes.com', consented: true });
        now += 8 * 86400000;
        assert.throws(() => requests.resolve(old.token));
        const fresh = requests.create({ userId: 'josh', email: 'josh@joes.com', consented: true });
        assert.notStrictEqual(fresh.token, old.token);
      });
    } finally { requests.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  };
};
