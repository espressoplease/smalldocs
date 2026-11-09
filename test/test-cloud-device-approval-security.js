module.exports = function ({ assert, testAsync }) {
  return async function () {
    const fixture = await require('./cloud-onboarding-fixture').startFixture();
    const { auth, users, api, origin } = fixture;
    const base = '/api/cloud/v1/cli/device-authorizations';
    const issued = auth.issueDeviceAuthorization({ displayName: 'Existing laptop' });
    auth.approveDeviceAuthorization({ userCode: issued.userCode, userId: users.bob.id });
    const original = auth.pollDeviceAuthorization({ deviceCode: issued.deviceCode });
    let browserCredential;
    async function request(path, body, headers = {}) {
      const response = await fetch(origin + path, { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    }
    try {
      await testAsync('a CLI access token cannot approve another persistent installation', async () => {
        const device = auth.issueDeviceAuthorization({ displayName: 'Another laptop' });
        const count = auth.listCliCredentials(users.bob.id).length;
        for (const headers of [
          { Authorization: 'Bearer ' + original.accessToken },
          { Authorization: 'Bearer ' + original.accessToken, Origin: origin },
          { Authorization: 'Bearer ' + original.accessToken, Origin: origin, Cookie: users.member.cookie },
        ]) {
          const rejected = await request(base + '/approve', { user_code: device.userCode }, headers);
          assert.strictEqual(rejected.status, 403);
          assert.strictEqual(rejected.data.error, 'permission_denied');
        }
        assert.strictEqual(auth.getDeviceAuthorization(device.userCode).approved, false);
        assert.strictEqual(auth.listCliCredentials(users.bob.id).length, count);
        const pending = await request(base + '/token', { device_code: device.deviceCode });
        assert.strictEqual(pending.status, 428);
        assert.strictEqual(pending.data.error, 'authorization_pending');
        assert.strictEqual(pending.data.refresh_token, undefined);
      });

      await testAsync('browser device approval still rejects cross-origin and revoked sessions', async () => {
        const device = auth.issueDeviceAuthorization({ displayName: 'Workstation' });
        for (const headers of [
          { Cookie: users.bob.cookie },
          { Cookie: users.bob.cookie, Origin: 'https://other.test' },
          { Cookie: users.bob.cookie, Origin: 'null' },
        ]) {
          assert.strictEqual((await request(base + '/approve', { user_code: device.userCode }, headers)).status, 403);
        }
        const revoked = auth.createBrowserSession(users.bob.id);
        auth.revokeSession({ sessionToken: revoked.token });
        assert.strictEqual((await request(base + '/approve', { user_code: device.userCode },
          { Cookie: 'sdocs_cloud=' + revoked.token, Origin: origin })).status, 401);
        assert.strictEqual(auth.getDeviceAuthorization(device.userCode).approved, false);
      });

      await testAsync('an active browser can approve one device without changing existing installations', async () => {
        const device = auth.issueDeviceAuthorization({ displayName: 'Browser-approved laptop' });
        const approved = await api('bob', base + '/approve', 'POST', { user_code: device.userCode });
        assert.strictEqual(approved.status, 200);
        const polled = await request(base + '/token', { device_code: device.deviceCode });
        assert.strictEqual(polled.status, 200);
        assert.ok(polled.data.refresh_token);
        assert.strictEqual(polled.data.user_id, users.bob.id);
        browserCredential = polled.data;
        assert.strictEqual(auth.authenticateAccessToken(original.accessToken).ok, true);
        assert.strictEqual((await request(base + '/token', { device_code: device.deviceCode })).status, 400);
      });

      await testAsync('revoking an old installation preserves separately browser-approved installations', async () => {
        assert.ok(browserCredential);
        auth.revokeCliCredential({ userId: users.bob.id, credentialId: original.credentialId });
        assert.strictEqual(auth.authenticateAccessToken(original.accessToken).ok, false);
        assert.throws(() => auth.refreshCliCredential({ refreshToken: original.refreshToken }),
          error => error.code === 'invalid_token');
        assert.strictEqual(auth.authenticateAccessToken(browserCredential.access_token).ok, true);
        assert.strictEqual(auth.refreshCliCredential({ refreshToken: browserCredential.refresh_token }).ok, true);
      });
    } finally {
      await fixture.close();
    }
  };
};
