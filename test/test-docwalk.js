/**
 * Regular Markdown walkthrough model and CLI metadata tests.
 */
const path = require('path');

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n-- Document Walkthrough Tests -----------------\n');

  const marked = require(path.join(__dirname, '..', 'public', 'vendor', 'marked.min.js'));
  const math = require(path.join(__dirname, '..', 'public', 'sdocs-math-core.js'));
  math.apply(marked);
  const DW = require(path.join(__dirname, '..', 'public', 'sdocs-docwalk.js'));
  const commands = require(path.join(__dirname, '..', 'cli', 'lib', 'commands.js'));

  test('isDocwalk accepts the YAML truthy spellings only', () => {
    assert.strictEqual(DW.isDocwalk({ docwalk: true }), true);
    assert.strictEqual(DW.isDocwalk({ docwalk: 'yes' }), true);
    assert.strictEqual(DW.isDocwalk({ docwalk: 'false' }), false);
    assert.strictEqual(DW.isDocwalk({}), false);
  });

  test('build maps source lines to ordinary rendered block ids', () => {
    const body = [
      '# Heading',
      '',
      'First paragraph.',
      '',
      '- Alpha',
      '- Beta',
      '',
      '| Name | Value |',
      '| --- | ---: |',
      '| A | 2 |',
    ].join('\n');
    const model = DW.build({
      docwalk: true,
      annotations: [
        { line: 1, text: 'heading' },
        { line: 3, text: 'paragraph' },
        { line: 5, text: 'list' },
        { line: 9, text: 'table' },
      ],
    }, body, marked.lexer);
    assert.deepStrictEqual(model.steps.map(step => {
      const target = step.targets[0];
      return [target.kind, target.type, target.index];
    }), [
      ['block', 'h1', 0],
      ['block', 'p', 0],
      ['block', 'ul', 0],
      ['block', 'table', 0],
    ]);
  });

  test('a selected paragraph source line carries text for an inline highlight', () => {
    const body = 'First rendered line\nwith **important** detail\nand a final line.\n';
    const model = DW.build({
      docwalk: true,
      annotations: [{ line: 2, text: 'focus here' }],
    }, body, marked.lexer);
    assert.strictEqual(model.steps[0].targets[0].type, 'p');
    assert.strictEqual(model.steps[0].targets[0].source, 'with **important** detail');
  });

  test('an explicit quote narrows a prose highlight to exact characters', () => {
    const body = 'Choose the reliable path before the fast path.\n';
    const model = DW.build({
      docwalk: true,
      annotations: [{ line: 1, quote: 'reliable path', text: 'focus here' }],
    }, body, marked.lexer);
    assert.strictEqual(model.steps[0].targets[0].source, 'reliable path');
  });

  test('ordinary code fences retain relative line and token geometry', () => {
    const body = [
      '```js',
      'const alpha = 1;',
      'const answer = alpha + 41;',
      '```',
    ].join('\n');
    const model = DW.build({
      docwalk: true,
      annotations: [{ line: 3, quote: 'alpha + 41', text: 'calculation' }],
    }, body, marked.lexer);
    assert.deepStrictEqual(Object.assign({}, model.steps[0].targets[0]), {
      kind: 'block', type: 'pre', index: 0, code: true, codeLineCount: 2,
      startLine: 1, endLine: 4, source: 'alpha + 41',
      codeLine: 2, codeEndLine: 2, quote: 'alpha + 41',
    });
  });

  test('rich fences and display math map to their finished reader wrappers', () => {
    const body = [
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
      '',
      '```cells',
      'Name,Value',
      'A,2',
      '```',
      '',
      '```slide',
      'grid 100 56.25',
      '```',
      '',
      '$$x^2$$',
    ].join('\n');
    const model = DW.build({
      docwalk: true,
      annotations: [
        { line: 3, text: 'diagram' },
        { line: 7, text: 'sheet' },
        { line: 12, text: 'slide' },
        { line: 15, text: 'math' },
      ],
    }, body, marked.lexer);
    assert.deepStrictEqual(model.steps.map(step => step.targets[0].selector), [
      '.sdoc-mermaid', '.sdoc-cells', '.sdoc-slide', '.sdocs-math-display',
    ]);
  });

  test('step order follows annotation order rather than source order', () => {
    const body = '# One\n\nParagraph.\n';
    const model = DW.build({
      docwalk: true,
      annotations: [
        { line: 3, text: 'first' },
        { line: 1, text: 'second' },
      ],
    }, body, marked.lexer);
    assert.deepStrictEqual(model.steps.map(step => [step.line, step.index]), [[3, 0], [1, 1]]);
  });

  test('a blank source line resolves to the next rendered block', () => {
    const body = '# One\n\nParagraph.\n';
    const model = DW.build({
      docwalk: true,
      annotations: [{ line: 2, text: 'transition' }],
    }, body, marked.lexer);
    assert.strictEqual(model.steps[0].targets[0].type, 'p');
  });

  test('a source range can cover several rendered targets', () => {
    const body = '# Heading\n\nParagraph.\n';
    const model = DW.build({
      docwalk: true,
      annotations: [{ line: 1, endLine: 3, text: 'both' }],
    }, body, marked.lexer);
    assert.deepStrictEqual(model.steps[0].targets.map(target => target.type), ['h1', 'p']);
  });

  test('CLI marks annotated Markdown as a document walkthrough', () => {
    const meta = {};
    const changed = commands.applyDocumentWalkthrough(meta, 'brief.markdown', [
      { file: null, line: 4, endLine: 5, text: 'explain this' },
    ]);
    assert.strictEqual(changed, true);
    assert.strictEqual(meta.docwalk, true);
    assert.deepStrictEqual(meta.annotations, [
      { line: 4, endLine: 5, text: 'explain this' },
    ]);
  });

  test('CLI converts physical file lines to rendered body lines after front matter', () => {
    const content = [
      '---',
      'title: Review',
      'styles:',
      '  fontFamily: Inter',
      '---',
      '# Heading',
      '',
      'Body.',
    ].join('\n');
    const offset = commands.frontMatterLineOffset(content);
    const meta = {};
    commands.applyDocumentWalkthrough(meta, 'brief.md', [
      { file: 'brief.md', line: 6, endLine: 6, text: 'heading' },
      { file: 'brief.md', line: 4, endLine: 8, text: 'body range' },
      { file: 'brief.md', line: 3, endLine: 4, text: 'front matter only' },
    ], offset);
    assert.strictEqual(offset, 5);
    assert.deepStrictEqual(meta.annotations, [
      { line: 1, endLine: 1, text: 'heading' },
      { line: 1, endLine: 3, text: 'body range' },
    ]);
  });

  test('CLI leaves non-Markdown documents out of document walkthrough mode', () => {
    const meta = {};
    assert.strictEqual(commands.applyDocumentWalkthrough(meta, 'report.csv', [
      { line: 1, endLine: 1, text: 'note' },
    ]), false);
    assert.deepStrictEqual(meta, {});
  });
};
