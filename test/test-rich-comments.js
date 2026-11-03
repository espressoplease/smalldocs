'use strict';
const C = require('../public/sdocs-comments');
const yaml = require('../cli/shared/sdocs-yaml');
const comments = require('../lib/cloud-comments');
const context = require('../lib/cloud-comment-context');
const { reanchor } = require('../lib/cloud-comment-rebase');
module.exports = function (h) {
  const { test, assert } = h;
  const body = '# Budget\n\n```cells Budget\nTeam,Amount\nPlatform,100\nResearch,200\n```\n';
  const source = 'sdoc-cells: name="Budget"\nTeam,Amount\nPlatform,100\nResearch,200\n';
  const anchor = { block: 'cells:0', sheet_name: 'Budget', sheet_source: source,
    range: { start_row: 1, end_row: 1, start_col: 1, end_col: 1 }, cells_rows: [1],
    row_texts: ['["Platform","100"]'], column_texts: ['Amount'], cell_values: [['100']] };
  const persist = (meta, text) => yaml.serializeFrontMatter(meta) + '\n' + text;
  const feedback = text => C.addCellsComment({}, anchor, { text }).meta;

  test('sheet targets survive YAML and portable feedback without changing formulas or CSV', () => {
    const meta = feedback('Check the amount.');
    const raw = yaml.parseFrontMatter(persist(meta, body)).meta.comments[0];
    assert.deepStrictEqual(C.normalizeComment(raw).range, anchor.range);
    assert.deepStrictEqual(C.normalizeComment(raw).cell_values, [['100']]);
    const projected = context.project(persist(meta, body), [raw], { context: 'snippet' })[0];
    assert.strictEqual(projected.anchor.match_status, 'exact');
    assert.ok(projected.context.markdown.includes('Platform,100'));
    const copy = C.serializeFootnotes(meta, body);
    const imported = C.parseFootnotes(copy);
    assert.deepStrictEqual(C.normalizeComment(imported.comments[0]).range, anchor.range);
    assert.ok(imported.body.includes('Platform,100'));
  });
  test('agent correction rebases sheet feedback to the saved value and keeps its discussion', () => {
    const before = persist(feedback('Use 125.'), body);
    const result = reanchor(before, before.replace('\nPlatform,100\n', '\nPlatform,125\n'));
    const state = comments.snapshot(result), saved = C.normalizeComment(state.comments[0]);
    assert.strictEqual(saved.anchor_status, undefined);
    assert.deepStrictEqual(saved.cell_values, [['125']]);
    assert.strictEqual(saved.text, 'Use 125.');
    assert.strictEqual(context.project(result, state.comments)[0].anchor.match_status, 'exact');
  });
  test('sheet feedback follows an inserted CSV row while retaining its selected source cell', () => {
    const before = persist(feedback('Check platform.'), body);
    const result = reanchor(before, before.replace('\nPlatform,100\n', '\nOperations,50\nPlatform,100\n'));
    const saved = C.normalizeComment(comments.snapshot(result).comments[0]);
    assert.strictEqual(saved.anchor_status, undefined);
    assert.deepStrictEqual(saved.cells_rows, [2]);
    assert.deepStrictEqual(saved.cell_values, [['100']]);
  });
  test('deleted sheet rows remain visible as lost feedback', () => {
    const before = persist(feedback('Check platform.'), body);
    const result = reanchor(before, before.replace('\nPlatform,100\n', '\n'));
    assert.strictEqual(comments.snapshot(result).comments[0].anchor_status, 'orphaned');
  });
  test('multiline CSV values keep accurate original source snippet coordinates', () => {
    const text = '# Sheet\n\n```cells Budget\nTeam,Amount\n"Platform\nengineering",100\nResearch,200\n```\n';
    const src = 'sdoc-cells: name="Budget"\nTeam,Amount\n"Platform\nengineering",100\nResearch,200\n';
    const note = C.addCellsComment({}, { ...anchor, sheet_source: src }, { text: 'Review.' }).meta.comments[0];
    const projected = context.project(text, [note], { context: 'snippet' })[0];
    assert.strictEqual(projected.anchor.match_status, 'exact');
    assert.ok(projected.context.markdown.includes('engineering",100'));
  });
  test('indented sheet fences retain their selected row through longer and shorter corrections', () => {
    for (const amount of ['2500', '2']) {
      const text = '  ```cells Budget\n  Team,Amount\n  Platform,100\n  Research,200\n  ```\n';
      const meta = C.addCellsComment({}, { ...anchor, range: { start_row: 2, end_row: 2, start_col: 1, end_col: 1 },
        cells_rows: [2], row_texts: ['["Research","200"]'], cell_values: [['200']] }, { text: 'Correct this.' }).meta;
      const before = persist(meta, text), after = reanchor(before, before.replace('\n  Research,200\n', '\n  Research,' + amount + '\n'));
      const note = C.normalizeComment(comments.snapshot(after).comments[0]);
      assert.strictEqual(note.anchor_status, undefined);
      assert.deepStrictEqual(note.cell_values, [[amount]]);
      assert.strictEqual(context.project(after, [note])[0].anchor.match_status, 'exact');
    }
  });
  test('unrelated prose edits keep sheet notes on duplicate or empty header cells', () => {
    for (const header of ['Name,Value,Value', 'Name,,']) {
      const text = 'Initial prose.\n\n```cells Sheet\n' + header + '\nOne,100,200\n```\n';
      const meta = C.addCellsComment({}, { ...anchor, sheet_name: 'Sheet', sheet_source: 'sdoc-cells: name="Sheet"\n' + header + '\nOne,100,200',
        row_texts: ['["One","100","200"]'], column_texts: [header.split(',')[1]] }, { text: 'Check this value.' }).meta;
      const before = persist(meta, text), after = reanchor(before, before.replace('Initial prose.', 'Updated prose.'));
      const note = C.normalizeComment(comments.snapshot(after).comments[0]);
      assert.strictEqual(note.anchor_status, undefined);
      assert.strictEqual(note.range.start_col, 1);
    }
  });
  test('agent feedback responses omit large snapshot arrays and keep source context bounded', () => {
    const header = 'Amount' + 'X'.repeat(60000);
    const text = body.replace('Team,Amount', 'Team,' + header);
    const meta = C.addCellsComment({}, { ...anchor, sheet_source: source.replace('Team,Amount', 'Team,' + header), column_texts: [header] }, { text: 'Review.' }).meta;
    const receipt = comments.project({ id: 'doc', markdown: persist(meta, text) }, 'https://example.test', { context: 'none' });
    assert.ok(JSON.stringify(receipt).length < 5000);
    assert.ok(receipt.comments[0].anchor.omitted_fields.includes('column_texts'));
    assert.ok(receipt.comments[0].anchor.snapshot_sha256.sheet_source);
  });
  test('diagram feedback survives a source correction and retains stable node identity', () => {
    const dsl = 'flowchart LR\n A[Receive] --> B[Review]';
    const text = '# Flow\n\n```mermaid\n' + dsl + '\n```\n';
    const meta = C.addDiagramComment({}, { block: 'diagram:0', diagram_source: dsl,
      node_id: 'B', node_text: 'Review' }, { text: 'Rename this to Approve.' }).meta;
    const before = persist(meta, text), result = reanchor(before, before.replace('\n A[Receive] --> B[Review]\n', '\n A[Receive] --> B[Approve]\n'));
    const saved = comments.snapshot(result).comments[0];
    assert.strictEqual(saved.anchor_status, undefined);
    assert.ok(saved.diagram_source.includes('B[Approve]'));
    assert.strictEqual(context.project(result, [saved])[0].anchor.match_status, 'exact');
  });
  test('diagram node source context accepts compact arrows and labeled edges', () => {
    for (const source of ['flowchart LR\nA-->B', 'flowchart LR\nA[Start]-->B[End]', 'flowchart LR\nA -->|yes|B']) {
      const note = C.addDiagramComment({}, { block: 'diagram:0', diagram_source: source, node_id: 'B' }, { text: 'Review.' }).meta.comments[0];
      assert.strictEqual(context.project('```mermaid\n' + source + '\n```\n', [note])[0].anchor.match_status, 'exact');
    }
  });
  test('deleted diagram IDs inside labels, comments or directives do not claim feedback', () => {
    for (const source of ['flowchart LR\nA["Old node B[Review]"] --> C[Done]',
      'flowchart LR\nA --> C %% old B[Review]', 'flowchart LR\nA --> C\nclick B', 'flowchart LR\nA -->|B| C']) {
      const note = C.addDiagramComment({}, { block: 'diagram:0', diagram_source: 'flowchart LR\nA-->B', node_id: 'B' }, { text: 'Review.' }).meta.comments[0];
      assert.strictEqual(context.project('```mermaid\n' + source + '\n```\n', [note])[0].anchor.match_status, 'lost');
    }
  });
  test('slide feedback follows a renamed element and shape insertion without attaching to a deleted shape', () => {
    const source = 'grid 100 56.25\nr 5 5 90 15 | Heading\nr 5 25 90 20 | Review';
    const text = '```slide\n' + source + '\n```\n';
    const meta = C.addSlideComment({}, { slide: 0, shape: 1, slide_source: source, slide_text: 'Review', shape_texts: ['Review'] }, { text: 'Rename to Ownership.' }).meta;
    const before = persist(meta, text);
    const changed = before.replace('\nr 5 25 90 20 | Review\n', '\nr 1 1 2 2 | New\nr 5 25 90 20 | Ownership\n');
    const result = reanchor(before, changed), note = C.normalizeComment(comments.snapshot(result).comments[0]);
    assert.strictEqual(note.anchor_status, undefined); assert.strictEqual(note.shape, 2);
    assert.deepStrictEqual(note.shape_texts, ['Ownership']);
    assert.strictEqual(context.project(result, [note])[0].anchor.match_status, 'exact');
    const deleted = reanchor(before, before.replace('\nr 5 25 90 20 | Review\n', '\n'));
    assert.strictEqual(comments.snapshot(deleted).comments[0].anchor_status, 'orphaned');
  });
  test('duplicate diagrams do not silently claim moved feedback', () => {
    const dsl = 'flowchart LR\n A --> B';
    const note = C.addDiagramComment({}, { block: 'diagram:0', diagram_source: dsl }, { text: 'Review.' }).meta.comments[0];
    const text = '```mermaid\n' + dsl + '\n```\n\n```mermaid\n' + dsl + '\n```\n';
    assert.strictEqual(context.project(text, [note])[0].anchor.match_status, 'ambiguous');
  });
  test('sequence participants keep identity through aliases and message source context is precise', () => {
    const lib = require('../public/sdocs-diagram-comments');
    const source = 'sequenceDiagram\n actor A as Requester\n participant B as Owner\n A->>B: Submit request\n B-->>A: Confirm\n';
    const targets = lib.sequenceTargets(source);
    assert.deepStrictEqual(targets.filter(target => target.type === 'participant').map(target => target.text), ['Requester', 'Owner']);
    const message = targets.find(target => target.type === 'message');
    const body = '```mermaid\n' + source + '```\n';
    const meta = C.addDiagramComment({}, { block: 'diagram:0', diagram_source: source, node_id: message.id, node_text: message.text }, { text: 'Add the reference.' }).meta;
    const before = persist(meta, body), updated = reanchor(before, before.replace('\n A->>B: Submit request', '\n A->>B: Submit request number'));
    const saved = C.normalizeComment(comments.snapshot(updated).comments[0]);
    assert.strictEqual(saved.anchor_status, undefined);
    assert.strictEqual(saved.node_text, 'Submit request number');
    assert.ok(saved.node_id.includes('Submit request number'));
    const projected = context.project(updated, [saved], { context: 'snippet' })[0];
    assert.strictEqual(projected.anchor.match_status, 'exact');
    const location = context.sourceLocations(updated, [saved])[0].node_range;
    assert.strictEqual(updated.slice(location.start, location.end), ' A->>B: Submit request number');
    const portable = C.parseFootnotes(C.serializeFootnotes({ comments: [saved] }, body));
    assert.strictEqual(portable.comments[0].node_id, saved.node_id);
  });
  test('sequence message feedback follows insertions and never transfers to a deleted message', () => {
    const lib = require('../public/sdocs-diagram-comments');
    const source = 'sequenceDiagram\n A->>B: Submit\n B-->>A: Confirm\n';
    const target = lib.sequenceTargets(source).find(target => target.text === 'Confirm');
    const meta = C.addDiagramComment({}, { block: 'diagram:0', diagram_source: source, node_id: target.id }, { text: 'Check this reply.' }).meta;
    const before = persist(meta, '```mermaid\n' + source + '```\n');
    const inserted = reanchor(before, before.replace('\n A->>B: Submit', '\n A->>B: New message\n A->>B: Submit'));
    const saved = comments.snapshot(inserted).comments[0];
    assert.strictEqual(saved.anchor_status, undefined);
    assert.strictEqual(context.project(inserted, [saved])[0].anchor.match_status, 'exact');
    const deleted = reanchor(before, before.replace('\n B-->>A: Confirm\n', '\n'));
    assert.strictEqual(comments.snapshot(deleted).comments[0].anchor_status, 'orphaned');
  });
  test('duplicate sequence messages have separate initial targets and ambiguous changed-source fallback', () => {
    const lib = require('../public/sdocs-diagram-comments');
    const source = 'sequenceDiagram\n A->>B: Review\n A->>B: Review\n';
    const messages = lib.sequenceTargets(source).filter(target => target.type === 'message');
    assert.notStrictEqual(messages[0].id, messages[1].id);
    const note = { diagram_source: source, node_id: messages[1].id };
    assert.strictEqual(lib.resolveTarget(note, [{ source, index: 0, nodes: messages }]).status, 'attached');
    const changed = source.replace(' A->>B: Review', ' A->>B: New message\n A->>B: Review');
    assert.strictEqual(lib.resolveTarget(note, [{ source: changed, index: 0, nodes: lib.sequenceTargets(changed) }]).status, 'ambiguous');
  });
  test('out-of-range rich anchors stay unplaced without inventing source context', () => {
    const note = C.addCellsComment({}, { ...anchor, range: { ...anchor.range, end_row: 999999999 } }, { text: 'Review.' }).meta.comments[0];
    const projected = context.project(body, [note])[0];
    assert.strictEqual(projected.anchor.match_status, 'lost');
  });
};
