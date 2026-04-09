module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Chart Replace Tests ─────────────────────────\n');

  // replaceChartBlock is exposed on window.SDocs in the browser,
  // but for Node testing we replicate the pure function here.
  function replaceChartBlock(body, index, newJson) {
    var count = -1;
    return body.replace(/```chart\n([\s\S]*?)```/g, function (match) {
      count++;
      if (count === index) return '```chart\n' + newJson + '\n```';
      return match;
    });
  }

  test('replaceChartBlock: replaces first chart block', () => {
    const body = '# Title\n\n```chart\n{"type":"bar"}\n```\n\nMore text.';
    const result = replaceChartBlock(body, 0, '{"type":"line"}');
    assert.ok(result.includes('```chart\n{"type":"line"}\n```'));
    assert.ok(result.includes('# Title'));
    assert.ok(result.includes('More text.'));
  });

  test('replaceChartBlock: replaces second chart, leaves first untouched', () => {
    const body = '```chart\n{"type":"bar"}\n```\n\n```chart\n{"type":"pie"}\n```';
    const result = replaceChartBlock(body, 1, '{"type":"doughnut"}');
    assert.ok(result.includes('{"type":"bar"}'), 'first chart should be unchanged');
    assert.ok(result.includes('{"type":"doughnut"}'), 'second chart should be replaced');
    assert.ok(!result.includes('{"type":"pie"}'), 'old second chart should be gone');
  });

  test('replaceChartBlock: preserves surrounding content', () => {
    const body = '# Heading\n\nParagraph one.\n\n```chart\n{"type":"bar"}\n```\n\nParagraph two.\n\n> Blockquote';
    const result = replaceChartBlock(body, 0, '{"type":"line"}');
    assert.ok(result.includes('# Heading'));
    assert.ok(result.includes('Paragraph one.'));
    assert.ok(result.includes('Paragraph two.'));
    assert.ok(result.includes('> Blockquote'));
  });

  test('replaceChartBlock: handles chart at end of document', () => {
    const body = '# Title\n\n```chart\n{"type":"bar"}\n```';
    const result = replaceChartBlock(body, 0, '{"type":"line"}');
    assert.ok(result.endsWith('```'));
    assert.ok(result.includes('{"type":"line"}'));
  });

  test('replaceChartBlock: out of range index leaves body unchanged', () => {
    const body = '```chart\n{"type":"bar"}\n```';
    const result = replaceChartBlock(body, 5, '{"type":"line"}');
    assert.strictEqual(result, body);
  });

  test('replaceChartBlock: handles multiline JSON', () => {
    const body = '```chart\n{\n  "type": "bar",\n  "title": "Test"\n}\n```';
    const newJson = '{\n  "type": "line",\n  "title": "Updated"\n}';
    const result = replaceChartBlock(body, 0, newJson);
    assert.ok(result.includes('"type": "line"'));
    assert.ok(result.includes('"title": "Updated"'));
    assert.ok(!result.includes('"type": "bar"'));
  });

  test('replaceChartBlock: does not touch non-chart code blocks', () => {
    const body = '```python\nprint("hi")\n```\n\n```chart\n{"type":"bar"}\n```\n\n```js\nconsole.log()\n```';
    const result = replaceChartBlock(body, 0, '{"type":"pie"}');
    assert.ok(result.includes('```python\nprint("hi")\n```'), 'python block untouched');
    assert.ok(result.includes('```js\nconsole.log()\n```'), 'js block untouched');
    assert.ok(result.includes('{"type":"pie"}'));
  });
};
