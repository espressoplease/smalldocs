'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { startLab } = require('./agent-lab');
const yaml = require('../../cli/shared/sdocs-yaml');
const C = require('../../public/sdocs-comments');

async function startRichLab() {
  const lab = await startLab();
  const session = lab.sessions.get('independent');
  const body = fs.readFileSync(path.resolve(__dirname, '../../test/fixtures/comment-rich-elements.md'), 'utf8');
  const allowance = 1300 + crypto.randomInt(20, 80);
  const decision = ['Approve the request', 'Confirm ownership', 'Check readiness'][crypto.randomInt(3)];
  let meta = { title: 'Delivery plan and budget', tags: ['delivery', 'budget', 'current'] };
  meta = C.addCellsComment(meta, { block: 'cells:0', sheet_name: 'Budget',
    sheet_source: 'sdoc-cells: name="Budget" workbook="Delivery"\n' + body.split('```cells Delivery/Budget\n')[1].split('```')[0],
    range: { start_row: 1, end_row: 1, start_col: 1, end_col: 1 }, cells_rows: [1],
    row_texts: ['["Platform","1200","3","=B2/C2"]'], column_texts: ['Monthly allocation'], cell_values: [['1200']] },
  { author: 'Priya', text: 'The approved Platform monthly allocation is ' + allowance + '. Update that allocation, keeping people and formulas.' }).meta;
  const dsl = body.split('```mermaid\n')[1].split('```')[0];
  meta = C.addDiagramComment(meta, { block: 'diagram:0', diagram_source: dsl, node_id: 'review', node_text: 'Review' },
    { author: 'Priya', text: 'Rename this decision to "' + decision + '". Keep the sequence and node IDs.' }).meta;
  const slide = body.split('~~~slide\n')[1].split('~~~')[0];
  meta = C.addSlideComment(meta, { slide: 0, shape: 2, slide_source: slide, slide_text: 'Review Confirm ownership before a request reaches delivery.',
    shape_texts: ['Review Confirm ownership before a request reaches delivery.'] },
  { author: 'Priya', text: 'In this element, change the heading Review to Ownership. Keep its paragraph.' }).meta;
  meta = C.addBlockComment(meta, { block: 'p:99', block_text: 'The missing exception.' },
    { author: 'Priya', text: 'Which exception did we agree? I cannot find the decision.' }).meta;
  meta = C.addBlockComment(meta, { block: 'p:0', block_text: 'The delivery team is preparing a staged launch.' },
    { author: 'Sam', text: 'Proposal only: remove the Operations budget.' }).meta;
  meta.comments.forEach(c => { c.document_hash = C.documentFingerprint(body); });
  const markdown = yaml.serializeFrontMatter(meta) + '\n' + body;
  const head = (await lab.fixture.api('bob', '/api/cloud/v1/documents/' + session.document.id)).data.document;
  const saved = await lab.fixture.api('bob', '/api/cloud/v1/documents/' + head.id + '/revisions', 'POST', {
    target_revision_id: head.current_revision_id, markdown, idempotency_key: crypto.randomUUID(),
  });
  if (saved.status !== 201) throw new Error('Cannot seed rich feedback');
  session.baseline = saved.data.document;
  session.oracle = { initial_markdown: markdown, initial_body: body, allowance, decision,
    expected_body: body.replace('Platform,1200,3,=B2/C2', 'Platform,' + allowance + ',3,=B2/C2')
      .replace('review[Review]', 'review[' + decision + ']').replace('## Review\n\n  Confirm ownership', '## Ownership\n\n  Confirm ownership') };
  const task = 'In Willow Engineering, find the current Delivery plan and budget and address Priya\'s open feedback. Keep the rest of the plan and other people\'s contributions intact. Save and verify the work, then return the document link and any remaining questions.';
  fs.writeFileSync(path.join(lab.root, 'rich-comment-trial.json'), JSON.stringify({ work: session.work, task }, null, 2));
  console.log(JSON.stringify({ root: lab.root, work: session.work, task }));
  return lab;
}
if (require.main === module) {
  let lab;
  startRichLab().then(value => { lab = value;
    const stop = () => lab.close().then(() => process.exit(0));
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  }).catch(async error => { console.error(error); if (lab) await lab.close(); process.exitCode = 1; });
}
module.exports = { startRichLab };
