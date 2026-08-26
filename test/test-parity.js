'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('playwright-core/lib/utilsBundle');
const parity = require('../scripts/lib/sdocs-parity');

module.exports = function ({ assert, test }) {
  test('parity CLI parses suite and baseline options', () => {
    const result = parity.parseArgs(['slides', '--baseline', 'v1.2.3', '--headed'], '/tmp/project');
    assert.equal(result.suite, 'slides');
    assert.equal(result.baseline, 'v1.2.3');
    assert.equal(result.headed, true);
  });

  test('parity CLI accepts a deployed production baseline', () => {
    const result = parity.parseArgs(['slides', '--baseline-url', 'https://smalldocs.org'], '/tmp/project');
    assert.equal(result.baselineUrl, 'https://smalldocs.org');
  });

  test('parity capture comparison reports nested structural drift', () => {
    const reference = { semantic: { tag: 'button', text: 'Next' }, controls: [], styles: {} };
    const candidate = { semantic: { tag: 'button', text: 'Forward' }, controls: [], styles: {} };
    const differences = parity.compareCapture(reference, candidate);
    assert.equal(differences.length, 1);
    assert.equal(differences[0].location, 'semantic.text');
  });

  test('parity image diff writes a visible difference image', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdocs-parity-test-'));
    const firstPath = path.join(dir, 'first.png');
    const secondPath = path.join(dir, 'second.png');
    const diffPath = path.join(dir, 'diff.png');
    const first = new PNG({ width: 2, height: 1 });
    const second = new PNG({ width: 2, height: 1 });
    first.data.fill(255);
    second.data.fill(255);
    second.data[4] = 0;
    fs.writeFileSync(firstPath, PNG.sync.write(first));
    fs.writeFileSync(secondPath, PNG.sync.write(second));
    const result = parity.diffPng(firstPath, secondPath, diffPath, 0);
    assert.equal(result.changed, 1);
    assert.equal(fs.existsSync(diffPath), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('parity HTML report names failed states and evidence', () => {
    const html = parity.reportHtml({
      suite: 'slides', baseline: 'main', createdAt: 'now', pass: false,
      comparisons: [{ label: 'Production to SDK', states: [{
        label: 'Presentation', pass: false, differences: [], contractFailures: ['Rail missing'],
        referenceImage: 'a.png', candidateImage: 'b.png', diffImage: 'd.png', image: { ratio: 0.25 },
      }] }],
    });
    assert.ok(html.includes('DRIFT FOUND'));
    assert.ok(html.includes('Rail missing'));
  });
};
