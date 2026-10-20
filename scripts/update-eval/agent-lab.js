'use strict';
// Real HTTP/CLI write trials. Oracles and instrumentation stay outside agent workspaces.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const { startFixture } = require('../../test/cloud-onboarding-fixture');
const skill = require('../../cli/lib/agent-block');

async function startLab() {
  process.env.CLOUD_SEARCH_SOURCE_LIMIT = '10000';
  const fixture = await startFixture({ singlePlan: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-update-agent-lab-'));
  const candidate = path.join(root, 'candidate');
  fs.cpSync(path.resolve(__dirname, '../../cli'), candidate, { recursive: true });
  const token = crypto.randomBytes(24).toString('hex');
  const sessions = new Map();
  async function current(session) {
    const response = await fixture.api('bob', '/api/cloud/v1/documents/' + session.document.id);
    if (response.status !== 200) throw new Error('Cannot inspect trial document: ' + response.status);
    return response.data.document;
  }
  async function replace(session, markdown, key) {
    const head = await current(session);
    const response = await fixture.api('bob', '/api/cloud/v1/documents/' + head.id + '/revisions', 'POST', {
      target_revision_id: head.current_revision_id, filename: head.filename, markdown,
      idempotency_key: key || crypto.randomUUID(),
    });
    if (response.status !== 201 && response.status !== 200) throw new Error('Trial write failed: ' + JSON.stringify(response.data));
    return response.data.document;
  }
  const control = http.createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== 'Bearer ' + token) { response.writeHead(403).end(); return; }
      let raw = ''; for await (const chunk of request) raw += chunk;
      const input = raw ? JSON.parse(raw) : {};
      const session = sessions.get(input.session);
      if (!session) { response.writeHead(404).end(); return; }
      if (request.url === '/before') {
        const args = input.args || [];
        const write = args[0] === 'cloud' && args[1] === 'push' && !args.includes('--help') && !args.includes('-h');
        if (write && !session.injected && session.interference) {
          session.injected = true;
          if (session.interference === 'revoke') {
            fixture.store.setDocumentPermission({ userId: fixture.users.bob.id, documentId: session.document.id, mode: 'custom', memberUserIds: [] });
          } else {
            const head = await current(session);
            const next = session.interference === 'overlap'
              ? head.markdown.replace('Maximum retry window: ' + session.oldLimit + ' minutes.', 'Maximum retry window: ' + session.otherLimit + ' minutes.') + '\nSecurity owner note: the revised cap needs a joint review.\n'
              : head.markdown + '\nOperator note: page the on-call lead before disabling retries.\n';
            session.injectedRevision = await replace(session, next);
          }
        }
      } else if (request.url === '/after') {
        session.commands.push(input);
      } else if (request.url === '/inspect') {
        const head = await current(session);
        const revisions = fixture.store.db.prepare('SELECT id,revision_number,created_by_user_id FROM cloud_document_revisions WHERE document_id=? ORDER BY revision_number').all(session.document.id);
        const otherDocuments = [];
        for (const document of session.decoys) {
          const found = await fixture.api('bob', '/api/cloud/v1/documents/' + document.id);
          otherDocuments.push({ id: document.id, unchanged: found.status === 200 && found.data.document.current_revision_id === document.current_revision_id });
        }
        const result = { scenario: session.id, current: head, revisions, commands: session.commands,
          oracle: session.oracle, injected: Boolean(session.injected), interference: session.interference,
          permission: fixture.store.getDocumentPermission({ userId: fixture.users.bob.id, documentId: session.document.id }),
          decoys_unchanged: otherDocuments.every(document => document.unchanged) };
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result)); return;
      }
      response.setHeader('Content-Type', 'application/json'); response.end('{"ok":true}');
    } catch (error) { response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => control.listen(0, '127.0.0.1', resolve));
  const controlOrigin = 'http://127.0.0.1:' + control.address().port;
  fs.writeFileSync(path.join(root, 'control.json'), JSON.stringify({ origin: controlOrigin, token }), { mode: 0o600 });
  const shim = `const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const root=__dirname,config=JSON.parse(fs.readFileSync(path.join(root,'control.json'))),session=process.argv[2],args=process.argv.slice(3);
async function event(endpoint,value){const r=await fetch(config.origin+endpoint,{method:'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:JSON.stringify({session,...value})});if(!r.ok)throw new Error('Trial instrumentation failed '+r.status);}
(async()=>{await event('/before',{args});const child=spawn(process.execPath,[path.join(root,'candidate/bin/sdocs-dev.js'),...args],{stdio:['inherit','pipe','pipe'],env:process.env});let out='',err='';child.stdout.on('data',b=>{out+=b;process.stdout.write(b)});child.stderr.on('data',b=>{err+=b;process.stderr.write(b)});const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject)});let json;try{json=JSON.parse(out)}catch{}await event('/after',{args,exit_code:code,result:json,stdout:json?undefined:out,stderr:err});process.exitCode=code;})().catch(e=>{console.error(e.message);process.exitCode=1});\n`;
  fs.writeFileSync(path.join(root, 'shim.js'), shim);
  function quote(value) { return "'" + value.replace(/'/g, "'\\''") + "'"; }
  async function seed(workspaceId, name, body, shared = true) {
    const made = await fixture.api('bob', '/api/cloud/v1/account/documents', 'POST', {
      account_id: workspaceId, filename: name, markdown: body, idempotency_key: crypto.randomUUID(),
    });
    if (made.status !== 201) throw new Error('Trial seed failed: ' + JSON.stringify(made.data));
    if (shared) fixture.store.setDocumentPermission({ userId: fixture.users.bob.id, documentId: made.data.document.id, mode: 'custom', memberUserIds: [fixture.users.member.id] });
    return made.data.document;
  }
  async function addSession(id, options = {}) {
    const work = path.join(root, id, 'work'), state = path.join(root, id, 'state');
    fs.mkdirSync(path.join(work, '.agents/skills/smalldocs'), { recursive: true });
    fs.mkdirSync(path.join(work, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(state, 'cloud'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(work, '.agents/skills/smalldocs/SKILL.md'), skill.formatSkill(skill.SKILL_VERSION, { cloud: true }));
    fs.writeFileSync(path.join(work, 'AGENTS.md'), '# Company workspace\n\nSmallDocs Cloud is installed. Read `.agents/skills/smalldocs/SKILL.md`; use `./bin/sdoc` and its help. Use only this workspace, the CLI and accessible documents. Do not inspect parent directories, credentials, instrumentation, server state, implementation or evaluation answers. The user task determines whether to save or prepare a proposed change.\n');
    fs.writeFileSync(path.join(work, 'bin/sdoc'), '#!/bin/sh\nexport SDOCS_HOME=' + quote(state) + '\nexport SDOCS_CLOUD_URL=' + quote(fixture.origin) + '\nexport SDOCS_CLOUD_FILE_CREDENTIALS=1\nexport SDOCS_NO_SETUP=1\nexport NO_UPDATE_NOTIFIER=1\nexec ' + quote(process.execPath) + ' ' + quote(path.join(root, 'shim.js')) + ' ' + quote(id) + ' "$@"\n', { mode: 0o755 });
    const issued = fixture.auth.issueDeviceAuthorization({ displayName: 'Document update trial ' + id });
    fixture.auth.approveDeviceAuthorization({ userCode: issued.userCode, userId: fixture.users.member.id });
    const credential = fixture.auth.pollDeviceAuthorization({ deviceCode: issued.deviceCode });
    fs.writeFileSync(path.join(state, 'cloud/credentials.json'), JSON.stringify({ [fixture.origin]: {
      access_token: credential.accessToken, refresh_token: credential.refreshToken,
      access_token_expires_at: new Date(credential.accessExpiresAtMs).toISOString(),
    } }), { mode: 0o600 });
    const workspace = await fixture.store.createTeamWorkspace({ userId: fixture.users.bob.id, name: options.library || id, projectName: 'Documents' });
    fixture.store.addWorkspaceMember({ actorUserId: fixture.users.bob.id, workspaceId: workspace.workspaceId, userId: fixture.users.member.id, role: 'member' });
    fixture.billing.upsertSubscription({ workspaceId: workspace.workspaceId, plan: 'team', status: 'active', provider: 'manual' });
    const oldLimit = 10 + crypto.randomInt(15), newLimit = oldLimit + crypto.randomInt(7, 16);
    const body = '---\ntitle: Harbor production retry policy\ntags:\n  - payments\n  - production\n  - current\nstyles:\n  accent: "#334455"\n---\n# Harbor production retry policy\n\nScope: production. Status: current. Owner: Bob Example.\n\nMaximum retry window: ' + oldLimit + ' minutes.\nBackoff: exponential with jitter.\n\n## Escalation\n\nPage the payments on-call engineer before disabling retries.\n\n## Monitoring\n\n| Signal | Threshold |\n| --- | --- |\n| Queue age | 180 seconds |\n\n```json\n{"retryBudget":3,"region":"us-east-1"}\n```\n';
    const document = await seed(workspace.workspaceId, 'harbor-production-policy.md', body);
    const session = { id, work, state, workspace, document, oldLimit, newLimit,
      otherLimit: oldLimit + 3, interference: options.interference, commands: [], decoys: [],
      oracle: { initial_markdown: body, initial_filename: document.filename, intended_limit: newLimit } };
    sessions.set(id, session);
    for (const [title, scope, tag] of [['Harbor production retry policy archive', 'Archived. Superseded. Do not use as current production policy.', 'archived'],
      ['Harbor sandbox retry policy', 'Sandbox only. Not production.', 'sandbox'], ['Harbor retry planning note', 'Draft proposal. Not an approved policy.', 'draft']]) {
      session.decoys.push(await seed(workspace.workspaceId, title.replace(/ /g, '-').toLowerCase() + '.md', '---\ntags:\n  - payments\n  - ' + tag + '\n---\n# ' + title + '\n\n' + scope + '\n\nMaximum retry window: 90 minutes.\n'));
    }
    session.decoys.push(await seed(workspace.workspaceId, 'private-harbor-policy.md', '# Harbor private policy\nPrivate canary ' + crypto.randomBytes(8).toString('hex'), false));
    if (options.history) {
      const verifiedPhone = '+1 202 555 ' + String(crypto.randomInt(100, 199)).padStart(4, '0');
      const initial = '# Mercury deployment runbook\n\nVendor support phone: ' + verifiedPhone + '.\nVerification: confirmed with vendor on 2026-10-01.\n\n## On-call rota\nAlex, weekdays.\n';
      await replace(session, initial);
      await replace(session, initial.replace(verifiedPhone, '+1 202 555 0999').replace('confirmed with vendor on 2026-10-01', 'phone edited without verification'));
      const head = await current(session);
      await replace(session, head.markdown.replace('Alex, weekdays.', 'Sam, weekdays; Priya, weekends.'));
      session.oracle.verified_phone = verifiedPhone;
      session.oracle.required_rota = 'Sam, weekdays; Priya, weekends.';
    }
    session.baseline = await current(session);
    return { id, work, library: options.library || id, task: options.history
      ? 'In ' + (options.library || id) + ', find the current Mercury deployment runbook. The vendor support phone was accidentally changed. Restore the last verified phone number from its history, keeping the newer on-call rota and all other material. Save the correction, verify what was saved, and link the document.'
      : 'In ' + (options.library || id) + ', update the current Harbor production retry policy: the approved maximum retry window is now ' + newLimit + ' minutes. Keep all other material, metadata and sharing as they are. Save the change, verify the result, and link the document.' };
  }
  const trials = [];
  trials.push(await addSession('targeted', { library: 'Northstar Engineering' }));
  trials.push(await addSession('history', { library: 'Keystone Operations', history: true }));
  trials.push(await addSession('overlap', { library: 'Orion Payments', interference: 'overlap' }));
  trials.push(await addSession('independent', { library: 'Willow Engineering', interference: 'independent' }));
  trials.push(await addSession('revoked', { library: 'Aster Engineering', interference: 'revoke' }));
  trials.push(await addSession('review', { library: 'Birch Engineering', interference: 'independent' }));
  trials[trials.length - 1].task = trials[trials.length - 1].task.replace('Save the change, verify the result, and link the document.', 'Prepare a preview for me to review, but do not save any changes to Cloud yet. Show the proposed difference and link the existing document.');
  fs.writeFileSync(path.join(root, 'oracles.json'), JSON.stringify([...sessions.values()].map(session => ({ id: session.id, document: session.document, baseline: session.baseline, oracle: session.oracle })), null, 2));
  fs.writeFileSync(path.join(root, 'trials.json'), JSON.stringify({ root, origin: fixture.origin, trials }, null, 2));
  console.log(JSON.stringify({ root, origin: fixture.origin, trials }));
  let closed = false;
  async function close() {
    if (closed) return; closed = true;
    await new Promise(resolve => control.close(resolve));
    await fixture.close();
    for (const session of sessions.values()) fs.rmSync(session.state, { recursive: true, force: true });
  }
  return { fixture, root, sessions, close };
}
if (require.main === module) {
  let lab;
  startLab().then(value => {
    lab = value;
    const stop = () => lab.close().then(() => process.exit(0));
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
  }).catch(async error => { console.error(error); if (lab) await lab.close(); process.exit(1); });
}
module.exports = { startLab };
