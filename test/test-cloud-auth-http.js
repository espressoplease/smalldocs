const { Readable } = require('stream');
const AuthHttp = require('../cloud/auth/http');

module.exports = function (harness) {
  const { assert, test, testAsync } = harness;

  test('cloud auth: safe return accepts a relative Cloud path', () => {
    assert.strictEqual(
      AuthHttp.safeReturnPath('/cloud/account?from=document#status'),
      '/cloud/account?from=document#status'
    );
  });

  test('cloud auth: public origin accepts only bare HTTP and HTTPS origins', () => {
    assert.strictEqual(AuthHttp.parsePublicOrigin('https://smalldocs.org'), 'https://smalldocs.org');
    assert.strictEqual(AuthHttp.parsePublicOrigin('http://localhost:3000'), 'http://localhost:3000');
    assert.throws(() => AuthHttp.parsePublicOrigin('ftp://smalldocs.org'));
    assert.throws(() => AuthHttp.parsePublicOrigin('https://smalldocs.org/cloud'));
    assert.throws(() => AuthHttp.parsePublicOrigin('not a URL'));
  });

  test('cloud auth: code logging requires test or development on loopback', () => {
    const base = { enabled: true, nodeEnv: 'development' };
    assert.strictEqual(AuthHttp.canLogDevCodes({ ...base, publicOrigin: 'http://localhost:3000' }), true);
    assert.strictEqual(AuthHttp.canLogDevCodes({ ...base, nodeEnv: 'production', publicOrigin: 'http://localhost:3000' }), false);
    assert.strictEqual(AuthHttp.canLogDevCodes({ ...base, publicOrigin: 'https://smalldocs.org' }), false);
    assert.strictEqual(AuthHttp.canLogDevCodes({ ...base, enabled: false, publicOrigin: 'http://localhost:3000' }), false);
  });

  test('cloud auth: forwarded IP is ignored unless proxy trust is explicit', () => {
    const req = { headers: { 'x-forwarded-for': '203.0.113.8, 10.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } };
    assert.strictEqual(AuthHttp.getClientIp(req, false), '127.0.0.1');
    assert.strictEqual(AuthHttp.getClientIp(req, true), '203.0.113.8');
  });

  test('cloud auth: safe return rejects absolute and protocol-relative URLs', () => {
    assert.strictEqual(AuthHttp.safeReturnPath('https://evil.example'), '/cloud/account');
    assert.strictEqual(AuthHttp.safeReturnPath('//evil.example/path'), '/cloud/account');
    assert.strictEqual(AuthHttp.safeReturnPath('/\\evil.example/path'), '/cloud/account');
  });

  test('cloud auth: cookie parser decodes values and keeps the first duplicate', () => {
    assert.deepStrictEqual(
      AuthHttp.parseCookies('one=a%20b; session=first; session=second'),
      { one: 'a b', session: 'first' }
    );
  });

  test('cloud auth: session cookie uses host-only secure browser controls', () => {
    const value = AuthHttp.sessionCookie('secret', { maxAge: 3600 });
    assert.ok(value.startsWith('__Host-sdocs_cloud=secret;'));
    assert.ok(value.includes('Path=/'));
    assert.ok(value.includes('HttpOnly'));
    assert.ok(value.includes('SameSite=Lax'));
    assert.ok(value.includes('Secure'));
    assert.ok(!value.includes('Domain='));
  });

  test('cloud auth: clear cookie expires the same host-only cookie', () => {
    const value = AuthHttp.clearSessionCookie();
    assert.ok(value.includes('__Host-sdocs_cloud='));
    assert.ok(value.includes('Max-Age=0'));
  });

  test('cloud auth: HTTPS sessions ignore the insecure fallback cookie', () => {
    const header = 'sdocs_cloud=insecure; __Host-sdocs_cloud=secure';
    assert.strictEqual(AuthHttp.sessionTokenFromCookies(header, true), 'secure');
    assert.strictEqual(AuthHttp.sessionTokenFromCookies('sdocs_cloud=insecure', true), undefined);
    assert.strictEqual(AuthHttp.sessionTokenFromCookies(header, false), 'insecure');
  });

  test('cloud auth: local HTTP cookie drops the secure host prefix', () => {
    const value = AuthHttp.sessionCookie('secret', { secure: false });
    assert.ok(value.startsWith('sdocs_cloud=secret;'));
    assert.ok(!value.includes('Secure'));
  });

  test('cloud auth: origin check accepts exact origin and rejects another host', () => {
    assert.strictEqual(AuthHttp.sameOrigin({ headers: { origin: 'https://smalldocs.org' } }, 'https://smalldocs.org'), true);
    assert.strictEqual(AuthHttp.sameOrigin({ headers: { origin: 'https://evil.example' } }, 'https://smalldocs.org'), false);
    assert.strictEqual(AuthHttp.sameOrigin({ headers: {} }, 'https://smalldocs.org'), false);
  });

  test('cloud auth: timing-safe string comparison handles equal and unequal input', () => {
    assert.strictEqual(AuthHttp.timingSafeEqualString('abc', 'abc'), true);
    assert.strictEqual(AuthHttp.timingSafeEqualString('abc', 'abd'), false);
    assert.strictEqual(AuthHttp.timingSafeEqualString('abc', 'longer'), false);
  });

  return async function () {
    await testAsync('cloud auth: readJson parses a bounded request body', async () => {
      const req = Readable.from([Buffer.from('{"email":"a@example.com"}')]);
      const body = await AuthHttp.readJson(req);
      assert.strictEqual(body.email, 'a@example.com');
    });

    await testAsync('cloud auth: readJson rejects oversized input', async () => {
      const req = Readable.from([Buffer.from('{"value":"123456789"}')]);
      await assert.rejects(AuthHttp.readJson(req, 8), error => error.code === 'payload_too_large');
    });
  };
};
