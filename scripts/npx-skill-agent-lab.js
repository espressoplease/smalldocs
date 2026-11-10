#!/usr/bin/env node
'use strict';
// Opt-in, executed agent trials. Installs the hosted skill through the real NPX
// installer; no skill bodies or agent instructions are seeded into task folders.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { startFixture } = require('../test/cloud-onboarding-fixture');

const source = path.resolve(__dirname, '..');
const scenarios = [
  { id: 'report', prompt: 'Write an operations report from these notes and return a link: on 7 November, checkout errors affected 240 of 12,000 requests between 09:10 and 09:34; stale cache entries caused the failures; rollback restored service; Mei owns the invalidation fix by 14 November. Include impact, cause, response and follow-up.' },
  { id: 'artifact', prompt: 'Create an artifact explaining our checkout incident for the service review. On 7 November, stale cache entries caused 240 failed requests out of 12,000 between 09:10 and 09:34. A rollback restored service. Mei owns the invalidation fix, due 14 November. Include impact, the timeline and an action list. Give me the link.' },
  { id: 'budget', prompt: 'Build a hiring budget we can check and adjust. Starting cash is GBP 180,000. Revenue is GBP 40,000 each month. Current monthly costs are GBP 55,000. Two hires add GBP 6,000 each monthly from February. Show January to March cash movement, totals, a chart and a short interpretation. Return a link.' },
  { id: 'slides', prompt: 'Prepare a five-slide briefing for the service review. On 7 November, checkout errors affected 240 of 12,000 requests between 09:10 and 09:34; stale cache entries caused the failures; rollback restored service. Mei owns the invalidation fix by 14 November. Cover impact, timeline, cause, corrective work and decisions needed. Return something I can present.' },
  { id: 'calculator', prompt: 'Make a calculator to explore how support staffing changes response capacity. Inputs: agents, productive hours per day and minutes per ticket. Start with 6 agents, 6 hours and 12 minutes. Show daily capacity and whether it meets demand of 200 tickets. Explain the assumptions. Return a link.' },
  { id: 'feedback', prompt: 'Update DOCUMENT_URL. Address Priya\'s open launch-date correction using the date approved in the earlier review. Preserve the current retry timeout, the resolved discussion and everything unrelated. Leave unclear feedback open. Return the updated link and say what changed.' },
  { id: 'folder', prompt: 'Write a short rollout checklist from these notes and return a link: confirm the rollback owner, rehearse rollback, check error rates, release to 10 percent, then expand after 30 minutes without errors.' },
  { id: 'ambiguous', prompt: 'Write a short rollout checklist from these notes and return a link: confirm the rollback owner, rehearse rollback, check error rates, release to 10 percent, then expand after 30 minutes without errors.' },
  { id: 'csv', prompt: 'Create a CSV named quarterly-sales.csv, and return that file only. Columns: month,revenue,cost. January 12000,8000; February 14000,9000; March 17000,10000.' },
  { id: 'signed-out', prompt: 'Write an operations report from these notes and return a link: on 7 November, checkout errors affected 240 of 12,000 requests between 09:10 and 09:34; stale cache entries caused the failures; rollback restored service; Mei owns the invalidation fix by 14 November. Include impact, cause, response and follow-up.' },
];

function capture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.out) fs.writeFileSync(options.out, '');
    if (options.err) fs.writeFileSync(options.err, '');
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), options.timeout || 480000);
    child.stdout.on('data', data => { stdout += data; if (options.out) fs.appendFileSync(options.out, data); });
    child.stderr.on('data', data => { stderr += data; if (options.err) fs.appendFileSync(options.err, data); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    child.stdin.end(options.input || '');
  });
}

async function inventory(env, cwd) {
  const child = spawn('codex', ['app-server'], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let buffer = '', errorText = '', done = false;
    const timer = setTimeout(() => finish(new Error('Skill inventory timed out: ' + errorText.slice(-500))), 30000);
    function finish(error, value) { if (done) return; done = true; clearTimeout(timer); child.kill('SIGTERM'); error ? reject(error) : resolve(value); }
    function send(value) { child.stdin.write(JSON.stringify(value) + '\n'); }
    child.stderr.on('data', chunk => { errorText += chunk; });
    child.once('error', finish);
    child.once('exit', code => { if (!done) finish(new Error('Skill inventory exited ' + code + ': ' + errorText.slice(-500))); });
    child.stdout.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let value; try { value = JSON.parse(line); } catch (_) { continue; }
        if (value.id === 1) {
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'skills/list', params: { cwds: [cwd], forceReload: true } });
        } else if (value.id === 2) finish(value.error ? new Error(JSON.stringify(value.error)) : null, value.result);
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'smalldocs-npx-eval', version: '1' }, capabilities: {} } });
  });
}

function grade(record, events, filesDirectory) {
  const completed = events.filter(item => item.type === 'item.completed' && item.item && item.item.type === 'command_execution').map(item => item.item);
  const commands = completed.map(item => item.command).join('\n');
  const fresh = (record.documents || []).filter(item => item.is_new);
  const checks = {
    clean_skill_inventory: record.skill_inventory.data.flatMap(item => item.skills || []).map(item => item.name).join(',') === 'smalldocs',
    agent_completed: record.exit_code === 0,
    source_documents_preserved: (record.documents || []).filter(item => !item.is_new && item.id !== record.target_id).every(item => item.revision_number === 1),
  };
  if (!['csv', 'signed-out', 'ambiguous', 'feedback'].includes(record.id)) {
    checks.one_cloud_document = fresh.length === 1;
    checks.looked_up_existing_tags = /sdoc cloud tags/.test(commands);
    checks.saved_tags = fresh.length === 1 && fresh[0].tags.length > 0;
    checks.real_link_returned = fresh.length === 1 && record.answer.includes(fresh[0].id);
  }
  if (['report', 'artifact'].includes(record.id)) {
    const text = fresh[0] && fresh[0].markdown || '';
    checks.correct_incident_figures = /2(?:\.0+)?\s*%/.test(text) && /24[ -]minute|24 minutes/.test(text) && text.includes('Mei') && text.includes('14 November');
    checks.reused_relevant_tags = fresh.length === 1 && fresh[0].tags.some(tag => ['operations', 'incident-review', 'service-reliability'].includes(tag));
  }
  if (record.id === 'budget') {
    const text = fresh[0] && fresh[0].markdown || '';
    const cells = require('../cli/lib/cells-verify');
    const formula = require('../cli/shared/sdocs-cells-formula');
    const values = cells.buildWorkbook(text).workbooks.flatMap(book => formula.recalcWorkbook(book.sheets).flat(2)).filter(Boolean);
    const numbers = values.filter(cell => cell.kind === 'number').map(cell => cell.value);
    checks.live_formulas_calculate_correctly = [165000, 138000, 111000, 120000, -69000].every(value => numbers.includes(value));
    checks.chart_present = /```chart|~~~chart|<svg\b|<canvas\b/.test(text);
    checks.agent_checked_workbook = /sdoc cells verify/.test(commands);
  }
  if (record.id === 'slides') {
    const result = require('../cli/lib/slides-verify').verifySlides(fresh[0] && fresh[0].markdown || '');
    checks.five_valid_slides = result.ok && result.slideCount === 5;
    checks.agent_verified_slides = /sdoc slides verify/.test(commands);
    checks.agent_opened_presentation = /sdoc present/.test(commands);
  }
  if (record.id === 'calculator') checks.runnable_component = /(?:```|~~~)sdoc-app\n/.test(fresh[0] && fresh[0].markdown || '');
  if (record.id === 'feedback') {
    const doc = record.documents.find(item => item.id === record.target_id);
    const meta = require('../cli/shared/sdocs-yaml').parseFrontMatter(doc && doc.markdown || '').meta;
    checks.correct_historical_repair = !!doc && doc.markdown.includes('Launch date: 26 November.') && doc.markdown.includes('Retry timeout: 45 seconds.');
    checks.addressed_feedback_closed_others_preserved = !(meta.comments || []).some(item => item.id === 'c1' && !item.resolved) && (meta.comments || []).some(item => item.id === 'c2' && !item.resolved) && (meta.comments || []).some(item => item.id === 'c3' && item.resolved);
    checks.preserved_tags = !!doc && ['operations', 'release-readiness'].every(tag => doc.tags.includes(tag));
    checks.reason_recorded = (record.revisions || []).some(item => item.edit_reason);
    checks.same_document_returned = !!doc && record.answer.includes(doc.id) && fresh.length === 0;
  }
  if (record.id === 'folder') checks.folder_library_respected = fresh.length === 1 && fresh[0].workspace_id === record.destination.team;
  if (record.id === 'ambiguous') {
    checks.no_guessed_destination = fresh.length === 0;
    checks.asks_for_library = /Personal/.test(record.answer) && /Engineering/.test(record.answer) && /which|choose|where/i.test(record.answer);
  }
  if (record.id === 'csv') {
    checks.no_cloud_upload = fresh.length === 0;
    const file = path.join(filesDirectory, 'quarterly-sales.csv');
    checks.requested_csv = fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim().replace(/\r/g, '') === 'month,revenue,cost\nJanuary,12000,8000\nFebruary,14000,9000\nMarch,17000,10000';
  }
  if (record.id === 'signed-out') {
    checks.no_cloud_upload = fresh.length === 0;
    checks.real_auth_failure_observed = completed.some(item => /login_required|sdoc cloud login/.test(item.aggregated_output || '') && item.exit_code !== 0);
    checks.no_fabricated_link = !/cloud-document=/.test(record.answer);
  }
  return { pass: Object.values(checks).every(Boolean), checks };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--run')) { console.log('Usage: node scripts/npx-skill-agent-lab.js --run [--cases report,artifact] [--output DIRECTORY]\nRuns real model tasks using your existing Codex login copied into disposable homes. No production Cloud credentials or data are used.'); return; }
  const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : null;
  const wanted = value('--cases') && new Set(value('--cases').split(','));
  const selected = scenarios.filter(item => !wanted || wanted.has(item.id));
  const output = path.resolve(value('--output') || path.join(os.tmpdir(), 'sdocs-npx-agent-results-' + Date.now()));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-npx-clean-agents-'));
  fs.mkdirSync(output, { recursive: true });
  // Copy authentication only. No host config, skills, plugins, rules or sessions.
  const authSource = path.join(os.homedir(), '.codex/auth.json');
  const fixture = await startFixture({ singlePlan: true });
  const results = [];
  const basicPath = path.dirname(process.execPath) + ':' + path.dirname(require('child_process').execFileSync('which', ['codex'], { encoding: 'utf8' }).trim()) + ':/usr/bin:/bin:/usr/sbin:/sbin';
  const baseEnv = { PATH: basicPath, TMPDIR: os.tmpdir(), LANG: 'en_US.UTF-8', npm_config_cache: path.join(root, 'npm-cache'), npm_config_update_notifier: 'false', NO_COLOR: '1' };
  async function runCase(scenario) {
    const dir = path.join(root, scenario.id), home = path.join(dir, 'home'), work = path.join(dir, 'work');
    const codexHome = path.join(home, '.codex'), state = path.join(home, '.sdocs');
    const record = { id: scenario.id, prompt: scenario.prompt, started_at: new Date().toISOString() };
    const prefix = path.join(output, scenario.id);
    try {
      fs.mkdirSync(work, { recursive: true }); fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
      fs.copyFileSync(authSource, path.join(codexHome, 'auth.json')); fs.chmodSync(path.join(codexHome, 'auth.json'), 0o600);
      fs.writeFileSync(path.join(codexHome, 'config.toml'), 'approval_policy = "never"\nsandbox_mode = "danger-full-access"\n[skills.bundled]\nenabled = false\n');
      fs.mkdirSync(path.join(state, 'bin'), { recursive: true });
      fs.cpSync(path.join(source, 'cli'), path.join(state, 'cli'), { recursive: true });
      fs.symlinkSync('../cli/bin/sdocs-dev.js', path.join(state, 'bin/sdoc'));
      // Capture browser-open requests rather than opening user tabs during QA.
      fs.writeFileSync(path.join(state, 'bin/open'), '#!/bin/sh\nprintf "%s\\n" "$@" >> "$HOME/browser-open-requests.txt"\n', { mode: 0o755 });
      const env = { ...baseEnv, HOME: home, CODEX_HOME: codexHome, PATH: path.join(state, 'bin') + ':' + basicPath,
        SDOCS_CLOUD_URL: fixture.origin, SDOCS_URL: fixture.origin, SDOCS_CLOUD_FILE_CREDENTIALS: '1',
        SDOCS_NO_UPDATE_CHECK: '1', SDOCS_NO_REFRESH: '1', SDOCS_NO_SETUP: '1' };
      const installArgs = ['--yes', 'skills@latest', 'add', fixture.origin + '/agent-skills/cloud', '--global', '--yes'];
      record.install_command = 'npx ' + installArgs.join(' ');
      const installed = await capture('npx', installArgs, { env, cwd: work, out: prefix + '-install.txt', timeout: 120000 });
      if (installed.code !== 0) throw new Error('NPX install failed: ' + installed.stderr.slice(-1000));
      const skillFile = path.join(home, '.agents/skills/smalldocs/SKILL.md');
      const skillText = fs.readFileSync(skillFile, 'utf8');
      const served = await (await fetch(fixture.origin + '/agent-skills/cloud/.well-known/agent-skills/smalldocs/SKILL.md')).text();
      if (skillText !== served) throw new Error('Installed skill differs from hosted bytes');
      record.skill_sha256 = crypto.createHash('sha256').update(skillText).digest('hex');
      record.skill_version = /sdocs-skill: v=(\d+)/.exec(skillText)[1];
      record.skill_inventory = await inventory(env, work);
      const listed = record.skill_inventory.data.flatMap(item => item.skills || []);
      if (listed.length !== 1 || listed[0].name !== 'smalldocs') throw new Error('Unclean skill inventory: ' + JSON.stringify(listed.map(item => item.name)));
      if (fs.existsSync(path.join(work, 'AGENTS.md')) || fs.existsSync(path.join(home, 'AGENTS.md'))) throw new Error('Unexpected agent instruction file');

      const key = 'eval_' + scenario.id;
      let user = fixture.auth.signInWithVerifiedEmail(key + '@example.test').user;
      user = fixture.auth.updateUserProfile({ userId: user.id, firstName: 'Robin', lastName: 'Tester' });
      fixture.auth.acceptCurrentTerms({ userId: user.id, termsVersion: require('../lib/cloud-terms').CURRENT_TERMS_VERSION });
      fixture.users[key] = { ...user, cookie: 'sdocs_cloud=' + fixture.auth.createBrowserSession(user.id).token };
      const personal = await fixture.store.ensurePersonalWorkspace(user.id, 'Personal');
      // Let the real account endpoint establish the same trial as first login.
      const status = await fixture.api(key, '/api/cloud/v1/account');
      if (status.status !== 200) throw new Error('Cannot initialise user: ' + JSON.stringify(status.data));
      async function seed(markdown, workspaceId = personal.workspaceId) {
        const made = await fixture.api(key, '/api/cloud/v1/account/documents', 'POST', { account_id: workspaceId, filename: 'source-notes.md', markdown, idempotency_key: crypto.randomUUID() });
        if (made.status !== 201) throw new Error('Seed failed: ' + JSON.stringify(made.data));
        return made.data.document;
      }
      await seed('---\ntags:\n  - operations\n  - incident-review\n  - service-reliability\n---\n# Service review vocabulary\n\nPast operational reviews use these tags.');
      let team;
      if (['folder', 'ambiguous'].includes(scenario.id)) {
        team = await fixture.store.createTeamWorkspace({ userId: user.id, name: 'Engineering', projectName: 'Documents' });
        await seed('---\ntags:\n  - release-readiness\n  - engineering\n---\n# Release vocabulary\n\nExisting release checklists.', team.workspaceId);
        if (scenario.id === 'folder') fs.writeFileSync(path.join(work, '.sdocs.json'), JSON.stringify({ library: 'Engineering' }));
      }
      if (scenario.id === 'feedback') {
        const yaml = require('../cli/shared/sdocs-yaml');
        const comments = [
          { id: 'c1', kind: 'inline', quote: '19 November', prefix: 'Launch date: ', suffix: '.', block: 'p:0', block_text: 'Launch date: 19 November.', author: 'Priya', text: 'Use the launch date approved in the earlier review.' },
          { id: 'c2', kind: 'block', block: 'p:2', block_text: 'The exception requires approval.', author: 'Sam', text: 'Which exception is this?' },
          { id: 'c3', kind: 'block', block: 'p:1', block_text: 'Retry timeout: 45 seconds.', author: 'Priya', text: 'Keep the 45 second timeout.', resolved: true },
        ];
        const document = await seed('---\ntags:\n  - operations\n  - release-readiness\n---\n# Launch plan\n\nLaunch date: 26 November.\n\nRetry timeout: 30 seconds.\n\nThe exception requires approval.\n');
        const saved = await fixture.api(key, '/api/cloud/v1/documents/' + document.id + '/revisions', 'POST', { target_revision_id: document.current_revision_id, markdown: yaml.serializeFrontMatter({ tags: ['operations', 'release-readiness'], comments }) + '\n# Launch plan\n\nLaunch date: 19 November.\n\nRetry timeout: 45 seconds.\n\nThe exception requires approval.\n', idempotency_key: crypto.randomUUID() });
        if (saved.status !== 201) throw new Error('Cannot seed history');
        record.target_id = document.id;
        record.prompt = record.prompt.replace('DOCUMENT_URL', fixture.origin + '/docs?cloud-document=' + document.id);
      }
      const initial = fixture.store.db.prepare('SELECT id,current_revision_id FROM cloud_documents WHERE created_by_user_id=?').all(user.id);
      record.initial_document_ids = initial.map(item => item.id);
      if (scenario.id !== 'signed-out') {
        const issued = fixture.auth.issueDeviceAuthorization({ displayName: 'Fresh NPX laptop' });
        fixture.auth.approveDeviceAuthorization({ userCode: issued.userCode, userId: user.id });
        const token = fixture.auth.pollDeviceAuthorization({ deviceCode: issued.deviceCode });
        fs.mkdirSync(path.join(state, 'cloud'), { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(state, 'cloud/credentials.json'), JSON.stringify({ [fixture.origin]: { access_token: token.accessToken, refresh_token: token.refreshToken, access_token_expires_at: new Date(token.accessExpiresAtMs).toISOString() } }), { mode: 0o600 });
      }
      const started = Date.now();
      const run = await capture('codex', ['exec', '--skip-git-repo-check', '--ignore-rules', '--json', '--color', 'never', '-C', work, '-o', prefix + '-answer.txt', record.prompt], { env, cwd: work, out: prefix + '-events.jsonl', err: prefix + '-stderr.txt' });
      record.duration_seconds = Math.round((Date.now() - started) / 1000);
      record.exit_code = run.code; record.signal = run.signal;
      record.answer = fs.existsSync(prefix + '-answer.txt') ? fs.readFileSync(prefix + '-answer.txt', 'utf8') : '';
      record.documents = [];
      const all = fixture.store.db.prepare('SELECT id FROM cloud_documents WHERE created_by_user_id=?').all(user.id);
      for (const row of all) {
        const opened = await fixture.store.getDocument({ userId: user.id, documentId: row.id });
        record.documents.push({ ...opened, is_new: !record.initial_document_ids.includes(row.id) });
      }
      record.revisions = record.target_id ? await fixture.store.withRevisionReasons({ userId: user.id, documentId: record.target_id }, fixture.store.listRevisions({ userId: user.id, documentId: record.target_id })) : [];
      record.browser_open_requests = fs.existsSync(path.join(home, 'browser-open-requests.txt')) ? fs.readFileSync(path.join(home, 'browser-open-requests.txt'), 'utf8').trim().split('\n') : [];
      fs.cpSync(work, prefix + '-files', { recursive: true });
      record.destination = { personal: personal.workspaceId, team: team && team.workspaceId };
      record.grade = grade(record, run.stdout.trim().split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch (_) { return []; } }), prefix + '-files');
      if (scenario.id === 'ambiguous' && record.grade.pass) {
        const thread = JSON.parse(run.stdout.split('\n').find(line => line.includes('"thread.started"'))).thread_id;
        const follow = await capture('codex', ['exec', 'resume', '--skip-git-repo-check', '--ignore-rules', '--json', '-o', prefix + '-follow-up-answer.txt', thread, 'Use Engineering.'], { env, cwd: work, out: prefix + '-follow-up-events.jsonl', err: prefix + '-follow-up-stderr.txt' });
        const answer = fs.existsSync(prefix + '-follow-up-answer.txt') ? fs.readFileSync(prefix + '-follow-up-answer.txt', 'utf8') : '';
        const newRows = fixture.store.db.prepare('SELECT id FROM cloud_documents WHERE created_by_user_id=?').all(user.id).filter(row => !record.initial_document_ids.includes(row.id));
        const saved = await Promise.all(newRows.map(row => fixture.store.getDocument({ userId: user.id, documentId: row.id })));
        record.follow_up = { prompt: 'Use Engineering.', exit_code: follow.code, answer, documents: saved,
          pass: follow.code === 0 && saved.length === 1 && saved[0].workspace_id === team.workspaceId && saved[0].tags.length > 0 && answer.includes(saved[0].id) };
        record.grade.checks.clarification_saved_to_requested_library = record.follow_up.pass;
        record.grade.pass = record.grade.pass && record.follow_up.pass;
      }
      record.completed_at = new Date().toISOString();
    } catch (error) { record.error = error.stack || String(error); }
    finally {
      fs.writeFileSync(prefix + '.json', JSON.stringify(record, null, 2) + '\n');
      fs.rmSync(dir, { recursive: true, force: true });
      results.push(record);
      console.log(JSON.stringify({ id: record.id, exit_code: record.exit_code, duration_seconds: record.duration_seconds, new_documents: record.documents && record.documents.filter(item => item.is_new).length, pass: record.grade && record.grade.pass, error: record.error }));
    }
  }
  try {
    console.log(JSON.stringify({ output, origin: fixture.origin, cases: selected.map(item => item.id) }));
    const queue = selected.slice();
    await Promise.all([0, 1].map(async () => { while (queue.length) await runCase(queue.shift()); }));
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ timestamp: new Date().toISOString(), cli_version: require('../cli/package.json').version, cases: results.map(item => ({ id: item.id, exit_code: item.exit_code, duration_seconds: item.duration_seconds, error: item.error, skill_version: item.skill_version, skill_sha256: item.skill_sha256, grade: item.grade })) }, null, 2) + '\n');
    if (results.some(item => item.error || item.exit_code !== 0 || !item.grade || !item.grade.pass)) process.exitCode = 1;
  } finally { await fixture.close(); fs.rmSync(root, { recursive: true, force: true }); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { inventory, capture, scenarios, grade };
