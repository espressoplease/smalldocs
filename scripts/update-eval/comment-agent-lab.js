'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { startLab } = require('./agent-lab');
const yaml = require('../../cli/shared/sdocs-yaml');
async function startCommentsLab(options = {}) {
  const lab = await startLab();
  if (options.baseline) {
    const tar = execFileSync('git', ['archive', 'HEAD', 'cli'], { maxBuffer: 20 * 1024 * 1024 });
    execFileSync('tar', ['-x', '--strip-components=1', '-C', path.join(lab.root, 'candidate')], { input: tar });
  }
  const selected = options.baseline ? ['targeted'] : ['targeted', 'independent', 'review', 'revoked', 'history'];
  const trials = [];
  for (const id of selected) {
    const session = lab.sessions.get(id);
    const approved = 40 + crypto.randomInt(8);
    const body = '# Harbor production retry policy\n\n## Production\n\nProduction retry window: 10 minutes.\n\n## Sandbox\n\nSandbox retry window: 10 minutes.\n\n## Escalation\n\nContact the payments on-call engineer.\n\n## Retained audit notes\n\n' +
      Array.from({ length: 1500 }, (_, i) => 'Entry ' + (i + 1) + ': checksum ' + crypto.randomBytes(8).toString('hex') + '.').join('\n') + '\n';
    const comments = [
      { id: 'c1', kind: 'inline', quote: '10 minutes', prefix: 'Production retry window: ', suffix: '.', block: 'p:0',
        block_text: 'Production retry window: 10 minutes.', author: 'Priya', color: '#ffbb00', at: '2026-10-27T09:00:00Z', text: 'The approved production retry window is ' + approved + ' minutes. Please update it.' },
      { id: 'c2', kind: 'inline', quote: '10 minutes', prefix: 'Sandbox retry window: ', suffix: '.', block: 'p:1',
        block_text: 'Sandbox retry window: 10 minutes.', author: 'Sam', at: '2026-10-27T09:01:00Z', text: 'Proposal: make the sandbox window 1 minute.' },
      { id: 'c3', kind: 'block', block: 'p:2', block_text: 'Contact the payments on-call engineer.', author: 'Priya', at: '2026-10-27T08:00:00Z', resolved: true, text: 'Use the on-call role rather than naming an individual.' },
      { id: 'c4', kind: 'inline', quote: 'The legacy exception applies.', prefix: 'Exemption: ', suffix: '', block: 'p:20',
        author: 'Priya', at: '2026-10-27T09:02:00Z', text: 'Which exception is this referring to? Please clarify it.' },
    ];
    if (id === 'history') {
      // Keep the unresolved Priya question beyond the first default page.
      comments.splice(3, 0, ...Array.from({ length: 30 }, (_, i) => ({ id: 'c' + (i + 5),
        kind: 'inline', quote: 'Sandbox retry window: 10 minutes.', block: 'p:1',
        block_text: 'Sandbox retry window: 10 minutes.', author: 'Sam',
        text: 'Audit note ' + (i + 1) + ': keep this sandbox evidence for later review.' })));
    }
    const markdown = yaml.serializeFrontMatter({ title: 'Harbor production retry policy', tags: ['payments', 'production', 'current'], comments }) + '\n' + body;
    const head = (await lab.fixture.api('bob', '/api/cloud/v1/documents/' + session.document.id)).data.document;
    const saved = await lab.fixture.api('bob', '/api/cloud/v1/documents/' + session.document.id + '/revisions', 'POST', {
      target_revision_id: head.current_revision_id, markdown, idempotency_key: crypto.randomUUID() });
    if (saved.status !== 201) throw new Error('Cannot seed feedback document: ' + JSON.stringify(saved.data));
    session.baseline = saved.data.document;
    session.oracle = { initial_markdown: markdown, initial_body: body, comments, approved };
    session.interference = id === 'independent' ? 'independent' : id === 'revoked' ? 'revoke' : null;
    const oldSkill = options.baseline ? require(path.join(lab.root, 'candidate/lib/agent-block')) : require('../../cli/lib/agent-block');
    fs.writeFileSync(path.join(session.work, '.agents/skills/smalldocs/SKILL.md'), oldSkill.formatSkill(oldSkill.SKILL_VERSION, { cloud: true }));
    const library = session.workspace.name || ({ targeted: 'Northstar Engineering', independent: 'Willow Engineering', review: 'Birch Engineering', revoked: 'Aster Engineering', history: 'Keystone Operations' }[id]);
    let task = 'In ' + library + ', find the current Harbor production retry policy and address Priya\'s open comments. Preserve other people\'s contributions and the sandbox policy. Mark feedback resolved only when it was actually addressed, and leave unclear or unplaced feedback open. Reply with a concise account of what changed, any remaining questions and the document link.';
    if (id === 'review') task = task.replace('Mark feedback resolved only when it was actually addressed, and leave unclear or unplaced feedback open.', 'Prepare proposed changes only, do not save content, replies or resolution state to Cloud.');
    trials.push({ id, work: session.work, task });
  }
  fs.writeFileSync(path.join(lab.root, 'comment-trials.json'), JSON.stringify({ trials, baseline: Boolean(options.baseline) }, null, 2));
  fs.writeFileSync(path.join(lab.root, 'comment-oracles.json'), JSON.stringify(selected.map(id => ({ id, ...lab.sessions.get(id).oracle })), null, 2));
  console.log(JSON.stringify({ root: lab.root, comments_trials: trials }));
  return lab;
}
if (require.main === module) {
  let lab;
  startCommentsLab({ baseline: process.argv.includes('--baseline') }).then(value => {
    lab = value;
    const stop = () => lab.close().then(() => process.exit(0));
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  }).catch(async error => { console.error(error); if (lab) await lab.close(); process.exitCode = 1; });
}
module.exports = { startCommentsLab };
