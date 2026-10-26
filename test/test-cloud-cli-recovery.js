'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
module.exports = function (h) {
  const { assert, testAsync } = h;
  return async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-cli-recovery-'));
    const { createAuthStore } = require('../lib/cloud-auth');
    let now = Date.now();
    const auth = createAuthStore({ dbPath: path.join(dir, 'auth.db'), pepper: 'local-recovery-fixture-long-secret', now: () => now });
    function issue() {
      const user = auth.signInWithExternalIdentity({ provider: 'google', subject: crypto.randomUUID(), verifiedEmail: crypto.randomUUID() + '@gmail.com' }).user;
      auth.acceptCurrentTerms({ userId: user.id, termsVersion: require('../lib/cloud-auth').CURRENT_TERMS_VERSION });
      return auth._createCliCredential(user.id, 'Fixture', now);
    }
    try {
      await testAsync('refresh retry recovers the same tokens after a lost response, without storing plaintext tokens', async () => {
        const first = issue(), requestId = crypto.randomBytes(32).toString('base64url');
        const next = auth.refreshCliCredential({ refreshToken: first.refreshToken, requestId });
        const replay = auth.refreshCliCredential({ refreshToken: first.refreshToken, requestId });
        assert.deepStrictEqual(replay, next);
        const rows = JSON.stringify(auth.db.prepare('SELECT * FROM cloud_cli_credentials').all());
        assert.ok(!rows.includes(next.refreshToken) && !rows.includes(requestId));
        assert.strictEqual(auth.authenticateAccessToken(first.accessToken).ok, false);
        assert.strictEqual(auth.authenticateAccessToken(next.accessToken).ok, true);
        now += 3600000;
        const later = auth.refreshCliCredential({ refreshToken: first.refreshToken, requestId });
        assert.strictEqual(later.refreshToken, next.refreshToken);
        assert.strictEqual(auth.authenticateAccessToken(later.accessToken).ok, true);
        auth.refreshCliCredential({ refreshToken: later.refreshToken, requestId: crypto.randomBytes(32).toString('base64url') });
        assert.throws(() => auth.refreshCliCredential({ refreshToken: first.refreshToken, requestId }), e => e.code === 'invalid_token');
      });
      await testAsync('a different refresh request using the consumed token still revokes the installation', async () => {
        const first = issue();
        const next = auth.refreshCliCredential({ refreshToken: first.refreshToken, requestId: crypto.randomBytes(32).toString('base64url') });
        assert.throws(() => auth.refreshCliCredential({ refreshToken: first.refreshToken, requestId: crypto.randomBytes(32).toString('base64url') }), e => e.code === 'token_reuse');
        assert.strictEqual(auth.authenticateAccessToken(next.accessToken).ok, false);
      });
      await testAsync('parallel clients sharing a credential store rotate once and preserve a retry after response loss', async () => {
        const { CloudClient } = require('../cli/lib/cloud-commands');
        let value = { refresh_token: 'old', access_token: 'expired', access_token_expires_at: new Date(0).toISOString() };
        const store = { load: () => value, save: (_, next) => { value = next; }, remove: () => { value = null; } };
        let requests = 0, lost = true, receipt;
        const fetch = async (_, options) => {
          const body = JSON.parse(options.body); requests++;
          if (!receipt) receipt = body;
          assert.deepStrictEqual(body, receipt);
          await new Promise(resolve => setTimeout(resolve, 10));
          if (lost) { lost = false; throw new Error('response lost'); }
          return { ok: true, json: async () => ({ credential_id: 'cli', user_id: 'user', refresh_token: 'new', access_token: 'access', access_token_expires_at: new Date(Date.now() + 3600000).toISOString() }) };
        };
        const one = new CloudClient({ origin: 'https://fixture.example', credentials: store, fetch });
        const two = new CloudClient({ origin: one.origin, credentials: store, fetch });
        await assert.rejects(one.refresh(value), e => e.code === 'temporary_service_failure');
        assert.ok(value.refresh_request_id);
        const results = await Promise.all([one.refresh(value), two.refresh(value)]);
        assert.strictEqual(requests, 2);
        assert.strictEqual(results[0].refresh_token, results[1].refresh_token);
        assert.strictEqual(value.refresh_request_id, undefined);
      });
      await testAsync('independent CLI processes share one token refresh and all remain signed in', async () => {
        const { spawn } = require('child_process'), http = require('http');
        const first = issue();
        let rotations = 0;
        const server = http.createServer(async (req, res) => {
          let raw = ''; for await (const chunk of req) raw += chunk;
          try {
            const body = JSON.parse(raw); rotations++;
            const next = auth.refreshCliCredential({ refreshToken: body.refresh_token, requestId: body.refresh_request_id });
            await new Promise(resolve => setTimeout(resolve, 50));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ credential_id: next.credentialId, user_id: next.userId,
              access_token: next.accessToken, refresh_token: next.refreshToken,
              access_token_expires_at: new Date(next.accessExpiresAtMs).toISOString() }));
          } catch (error) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.code })); }
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const origin = 'http://127.0.0.1:' + server.address().port;
        const stateDir = path.join(dir, 'refresh-state');
        fs.mkdirSync(path.join(stateDir, 'cloud'), { recursive: true });
        fs.writeFileSync(path.join(stateDir, 'cloud/credentials.json'), JSON.stringify({ [origin]: {
          credential_id: first.credentialId, user_id: first.userId, refresh_token: first.refreshToken,
          access_token: first.accessToken, access_token_expires_at: new Date(0).toISOString(),
        } }));
        const script = `const {CloudClient}=require(${JSON.stringify(path.resolve(__dirname, '../cli/lib/cloud-commands'))});
const client=new CloudClient({origin:process.argv[1]});const credential=client.loadCredential();
setTimeout(()=>client.refresh(credential).then(value=>{if(!value.access_token)process.exitCode=1}).catch(error=>{process.stderr.write(error.code);process.exitCode=1}),100);`;
        try {
          await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
            const child = spawn(process.execPath, ['-e', script, origin], { env: { ...process.env, SDOCS_HOME: stateDir, SDOCS_CLOUD_FILE_CREDENTIALS: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
            let error = ''; child.stderr.on('data', chunk => { error += chunk; });
            child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(error)));
          })));
          assert.strictEqual(rotations, 1);
          const saved = JSON.parse(fs.readFileSync(path.join(stateDir, 'cloud/credentials.json')))[origin];
          assert.strictEqual(auth.authenticateAccessToken(saved.access_token).ok, true);
        } finally { await new Promise(resolve => server.close(resolve)); }
      });
      await testAsync('concurrent processes preserve every binding and pending operation', async () => {
        const { spawn } = require('child_process');
        const worker = path.join(dir, 'worker.js');
        fs.writeFileSync(worker, `const b=require(${JSON.stringify(path.resolve(__dirname, '../cli/lib/cloud-bindings'))});
const i=process.argv[2]; for(let n=0;n<15;n++){const file='file-'+i+'-'+n;b.set('user',file,{document_id:file});b.setPending('user',file,{id:file});b.setOperationPending('user','restore',file,{id:file});}
`);
        await Promise.all(Array.from({ length: 8 }, (_, i) => new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [worker, String(i)], { env: { ...process.env, SDOCS_HOME: dir }, stdio: ['ignore', 'ignore', 'pipe'] });
          let error = ''; child.stderr.on('data', chunk => { error += chunk; });
          child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(error)));
        })));
        assert.strictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'cloud/bindings.json')))).length, 120);
        assert.strictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'cloud/pending.json')))).length, 240);
      });
      await testAsync('state locks recover a terminated writer and preserve unreadable state', async () => {
        const { spawn } = require('child_process');
        const lock = require('../cli/lib/file-lock');
        const file = path.join(dir, 'abandoned');
        fs.mkdirSync(file + '.sdocs-lock');
        const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
        await new Promise(resolve => child.once('spawn', resolve));
        fs.writeFileSync(path.join(file + '.sdocs-lock', 'owner-' + child.pid + '-abcdef'), '');
        child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve));
        assert.strictEqual(lock.withLockSync(file, () => 'recovered', 1000), 'recovered');
        const old = process.env.SDOCS_HOME; process.env.SDOCS_HOME = dir;
        try {
          const b = require('../cli/lib/cloud-bindings'); fs.writeFileSync(b.bindingsFile(), '{invalid');
          assert.throws(() => b.set('u', 'file', {}), e => e.code === 'temporary_service_failure');
          assert.strictEqual(fs.readFileSync(b.bindingsFile(), 'utf8'), '{invalid');
        } finally { if (old == null) delete process.env.SDOCS_HOME; else process.env.SDOCS_HOME = old; }
      });
    } finally { auth.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  };
};
