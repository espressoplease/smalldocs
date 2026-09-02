const fs = require('fs');
const path = require('path');

module.exports = function (h) {
  const { test, assert } = h;
  const evalHarness = require('../evals/smalldocs-skill/harness');

  test('skill eval suite has 24 valid unique scenarios', () => {
    const suite = evalHarness.loadSuite();
    assert.strictEqual(suite.scenarios.length, 24);
    assert.strictEqual(new Set(suite.scenarios.map(scenario => scenario.id)).size, 24);
  });

  test('skill eval matrix expands editions and model strengths', () => {
    const suite = evalHarness.loadSuite();
    const runs = evalHarness.expandRuns(suite, {
      scenarioIds: ['casual-sdoc-this'],
      editions: ['standard', 'cloud'],
      profiles: [
        { model: 'fast', effort: 'low' },
        { model: 'strong', effort: 'high' }
      ]
    });
    assert.strictEqual(runs.length, 4);
    assert.deepStrictEqual(new Set(runs.map(run => run.edition)), new Set(['standard', 'cloud']));
  });

  test('skill eval fixture starts without inherited agent context', () => {
    const scenario = evalHarness.loadSuite().scenarios.find(item => item.id === 'casual-sdoc-this');
    const fixture = evalHarness.createFixture({ scenario, edition: 'none' });
    try {
      assert.strictEqual(fs.existsSync(path.join(fixture.codexHome, 'AGENTS.md')), false);
      assert.strictEqual(fs.existsSync(path.join(fixture.home, '.agents', 'skills', 'smalldocs')), false);
      assert.strictEqual(fs.existsSync(path.join(fixture.project, 'AGENTS.md')), false);
    } finally {
      fixture.cleanup();
    }
  });

  test('skill eval fixture installs exactly the requested edition', () => {
    const scenario = evalHarness.loadSuite().scenarios.find(item => item.id === 'cloud-local-viewing');
    for (const edition of ['standard', 'cloud']) {
      const fixture = evalHarness.createFixture({ scenario, edition });
      try {
        const skill = fs.readFileSync(path.join(fixture.home, '.agents', 'skills', 'smalldocs', 'SKILL.md'), 'utf8');
        assert.ok(skill.includes(`<!-- sdocs-skill-edition: ${edition} -->`));
        assert.ok(!skill.includes('/Users/mac'));
      } finally {
        fixture.cleanup();
      }
    }
  });

  test('skill eval command check detects required and forbidden commands', () => {
    const scenario = evalHarness.loadSuite().scenarios.find(item => item.id === 'cloud-local-viewing');
    const good = evalHarness.evaluateCommands(scenario, 'cloud', { commands: ['sdoc notes.md'] });
    assert.strictEqual(good.pass, true);
    const bad = evalHarness.evaluateCommands(scenario, 'cloud', {
      commands: ['sdoc cloud status --json', 'sdoc notes.md']
    });
    assert.strictEqual(bad.pass, false);
    assert.ok(bad.present_forbidden.includes('sdoc cloud status'));
  });

  test('skill eval command check accepts concrete UUID and output path placeholders', () => {
    const scenario = evalHarness.loadSuite().scenarios.find(item => item.id === 'cloud-reuse-prior-decisions');
    const result = evalHarness.evaluateCommands(scenario, 'cloud', {
      commands: [
        'sdoc cloud status --json',
        'sdoc cloud search "authentication migration" --json',
        'sdoc cloud pull abc-123 --output /tmp/context.md --no-bind --json'
      ]
    });
    assert.strictEqual(result.pass, true);
  });

  test('skill eval treats sdoc-app syntax as guidance rather than a command', () => {
    const scenario = evalHarness.loadSuite().scenarios.find(item => item.id === 'runnable-component-authoring');
    const result = evalHarness.evaluateCommands(scenario, 'standard', {
      commands: ['sdoc apps', 'sdoc runway.md']
    });
    assert.strictEqual(result.pass, true);
    assert.deepStrictEqual(result.required, ['sdoc apps', 'sdoc FILE.md']);
  });

  test('skill eval standard Cloud comparison does not require connected commands', () => {
    const scenario = evalHarness.loadSuite().scenarios.find(item => item.id === 'cloud-update-existing');
    const result = evalHarness.evaluateCommands(scenario, 'standard', { commands: [] });
    assert.deepStrictEqual(result.required, []);
  });

  test('skill eval judge prompt hides candidate model metadata', () => {
    const scenario = evalHarness.loadSuite().scenarios.find(item => item.id === 'casual-sdoc-this');
    const prompt = evalHarness.buildJudgePrompt(
      scenario,
      'standard',
      { triggered: true, summary: 'Open locally', actions: [], commands: ['sdoc file.md'], questions: [], boundary_notes: [] },
      { pass: true, missing: [], present_forbidden: [] }
    );
    assert.ok(prompt.includes('Candidate response'));
    assert.ok(!prompt.includes('gpt-5'));
    assert.ok(!prompt.includes('reasoning effort'));
  });
};
