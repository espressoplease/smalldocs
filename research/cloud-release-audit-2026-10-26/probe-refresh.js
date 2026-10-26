// Disposable real-server probes. No installed credentials or external providers.
'use strict';
const assert = require('assert');
const { startFixture } = require('../../test/cloud-onboarding-fixture');
const { CloudClient } = require('../../cli/lib/cloud-commands');
(async () => {
 const f = await startFixture({ singlePlan: true });
 try {
  function login(label) {
   const device = f.auth.issueDeviceAuthorization({ displayName: label });
   f.auth.approveDeviceAuthorization({ userCode: device.userCode, userId: f.users.returning.id });
   const token = f.auth.pollDeviceAuthorization({ deviceCode: device.deviceCode });
   let saved = { credential_id: token.credentialId, user_id: token.userId, access_token: token.accessToken,
    access_token_expires_at: new Date(Date.now() - 1).toISOString(), refresh_token: token.refreshToken };
   return { id: token.credentialId, store: {
    load: () => saved && { ...saved }, save: (_origin, value) => { saved = value; }, remove: () => { saved = null; },
   }, hasSaved: () => Boolean(saved) };
  }
  const first = login('Concurrent agents');
  let arrivals = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const fetchTogether = async (url, options) => {
   if (url.endsWith('/cli/token/refresh')) { if (++arrivals === 2) release(); await gate; }
   return fetch(url, options);
  };
  const clients = [0, 1].map(() => new CloudClient({ origin: f.origin, credentials: first.store, fetch: fetchTogether }));
  const results = await Promise.allSettled(clients.map(client => client.authenticated('/api/cloud/v1/me')));
  const revoked = f.auth.listCliCredentials(f.users.returning.id).find(c => c.id === first.id).revokedAtMs != null;
  console.log(JSON.stringify({ case: 'concurrent_refresh', results: results.map(r => r.status === 'fulfilled' ? 'ok' : r.reason.code), credential_revoked: revoked, saved_credential_exists: first.hasSaved() }));
  assert.equal(revoked, true, 'Probe expected the current refresh race');
  const second = login('Lost refresh response');
  let drop = true;
  const dropping = new CloudClient({ origin: f.origin, credentials: second.store, fetch: async (url, options) => {
   const response = await fetch(url, options);
   if (drop && url.endsWith('/cli/token/refresh')) { drop = false; throw new Error('Simulated connection lost after response'); }
   return response;
  } });
  const outcomes = [];
  for (let n = 0; n < 2; n++) {
   try { await dropping.authenticated('/api/cloud/v1/me'); outcomes.push('ok'); } catch (error) { outcomes.push(error.code); }
  }
  const lostRevoked = f.auth.listCliCredentials(f.users.returning.id).find(c => c.id === second.id).revokedAtMs != null;
  console.log(JSON.stringify({ case: 'lost_refresh_reply_then_retry', results: outcomes, credential_revoked: lostRevoked, saved_credential_exists: second.hasSaved() }));
  assert.equal(lostRevoked, true, 'Probe expected replay detection after a lost response');
 } finally { await f.close(); }
})().catch(error => { console.error(error); process.exit(1); });
