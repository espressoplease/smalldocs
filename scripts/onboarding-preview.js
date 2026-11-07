// Disposable, loopback-only preview gateway over the real onboarding backend.
// It seeds fictional authenticated users. Production authentication is unchanged.
const http = require('http');
const crypto = require('crypto');
const { startFixture } = require('../test/cloud-onboarding-fixture');
const port = Number(process.env.PREVIEW_PORT || 3102);
(async function () {
  const singlePlan = process.env.CLOUD_SINGLE_PLAN_ENABLED === '1';
  const fixture = await startFixture({ singlePlan });
  const previewOrigin = 'http://localhost:' + port;
  let freshCount = 0;
  const scenarios = [ ['email', 'New email signup'], ['google', 'Google with profile name'],
    ['missing', 'Google without a profile name'], ['connected', 'Already connected'],
    ['invited', singlePlan ? 'Invited to a library' : 'Invited to a team'],
    ['returning', singlePlan ? 'Existing library' : 'Existing personal library'],
    ['member', singlePlan ? 'Existing library member' : 'Existing team member'] ];
  const device = fixture.auth.issueDeviceAuthorization({ displayName: 'Alexs-MacBook.local' });
  fixture.auth.approveDeviceAuthorization({ userCode: device.userCode, userId: fixture.users.returning.id });
  fixture.auth.pollDeviceAuthorization({ deviceCode: device.deviceCode });
  function redirect(res, target, actor) { res.writeHead(303, { Location: target,
    ...(actor ? { 'Set-Cookie': 'sdocs_preview_actor=' + encodeURIComponent(actor) + '; Path=/; HttpOnly; SameSite=Lax' } : {}) }); res.end(); }
  function actorFor(req) {
    const cookie = /sdocs_preview_actor=([^;]+)/.exec(req.headers.cookie || '');
    const key = cookie ? decodeURIComponent(cookie[1]) : 'josh';
    return fixture.users[key] ? key : 'josh';
  }
  async function freshUser(complete) {
    const key = 'preview-' + crypto.randomUUID();
    const email = 'alex' + (++freshCount) + '@joes.com';
    let user = fixture.auth.signInWithVerifiedEmail(email).user;
    if (complete) user = fixture.auth.updateUserProfile({ userId: user.id, firstName: 'Alex', lastName: 'Rivera' });
    fixture.auth.acceptCurrentTerms({ userId: user.id, termsVersion: require('../lib/cloud-terms').CURRENT_TERMS_VERSION });
    const session = fixture.auth.createBrowserSession(user.id);
    fixture.users[key] = { ...user, email, sessionToken: session.token, cookie: 'sdocs_cloud=' + session.token };
    return key;
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, previewOrigin);
      const actor = actorFor(req);
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SmallDocs onboarding previews</title><link rel="stylesheet" href="/preview.css"><main class="preview-launcher"><h1>Try Cloud onboarding</h1><p>These paths use the real application and backend with disposable fictional accounts. They start after sign-in. No emails or payments are sent.</p>' + scenarios.map(([key, label]) => '<a href="/start?scenario=' + key + '">' + label + '</a>').join('') + '<p>Choose an invitation scenario to test joining a library. Create libraries and request links from settings.</p></main>');
      }
      if (url.pathname === '/preview.css') {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        return res.end('.preview-bar{padding:10px 14px;background:#fff2cf;color:#473600;font:13px/1.5 system-ui;position:relative;z-index:100;overflow-wrap:anywhere}.preview-bar a{color:#173f86;margin-left:12px}.preview-launcher{font:16px/1.6 system-ui;max-width:680px;margin:40px auto;padding:20px;color:#1c1917}.preview-launcher>a{display:block;padding:15px;border:1px solid #d4cfc9;border-radius:8px;margin:10px 0;color:inherit;text-decoration:none}');
      }
      if (url.pathname === '/start') {
        const scenario = url.searchParams.get('scenario');
        if (['returning', 'connected', 'member'].includes(scenario)) return redirect(res,
          scenario === 'connected' ? '/cloud/admin?panel=machines' : '/cloud/start', scenario === 'member' ? 'member' : 'returning');
        const key = await freshUser(scenario === 'google');
        if (scenario === 'invited') {
          const invitation = await fixture.store.createInvitation({ userId: fixture.users.bob.id, workspaceId: fixture.team.workspaceId,
            email: fixture.users[key].email, projectGrants: [{ projectId: fixture.team.projectId, role: 'editor' }] });
          return redirect(res, '/cloud/invite?token=' + encodeURIComponent(invitation.token), key);
        }
        return redirect(res, '/cloud/profile', key);
      }
      if (url.pathname === '/switch') {
        const chosen = url.searchParams.get('actor');
        const target = url.searchParams.get('return') || '/cloud/start?choose=1';
        if (!fixture.users[chosen] || !target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return redirect(res, '/');
        return redirect(res, target, chosen);
      }
      const headers = { ...req.headers, host: new URL(fixture.origin).host,
        cookie: fixture.users[actor].cookie, origin: fixture.origin };
      const upstream = http.request(fixture.origin + url.pathname + url.search, { method: req.method, headers }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          let body = Buffer.concat(chunks);
          const outputHeaders = { ...response.headers };
          delete outputHeaders['content-length']; delete outputHeaders['transfer-encoding']; delete outputHeaders['set-cookie'];
          if (outputHeaders.location) outputHeaders.location = outputHeaders.location.replace(fixture.origin, previewOrigin);
          const type = String(outputHeaders['content-type'] || '');
          if (type.includes('application/json')) body = Buffer.from(body.toString().split(fixture.origin).join(previewOrigin));
          res.writeHead(response.statusCode, outputHeaders); res.end(body);
        });
      });
      upstream.on('error', () => { res.writeHead(502); res.end('Preview backend unavailable.'); });
      req.pipe(upstream);
    } catch (_) { res.writeHead(500); res.end('Preview failed. Restart the preview server.'); }
  });
  server.listen(port, '127.0.0.1', () => console.log('Onboarding previews: ' + previewOrigin));
  let closing = false;
  async function close() { if (closing) return; closing = true; server.close(); await fixture.close(); process.exit(0); }
  process.on('SIGTERM', close); process.on('SIGINT', close);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
