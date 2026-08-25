/**
 * Semantic checks for the SDK authoring documentation.
 *
 * The public authoring pages and the installable skill share the same files.
 * These tests run documented examples through the production parsers so the
 * examples cannot drift into plausible but unsupported syntax.
 */
const fs = require('fs');
const path = require('path');

module.exports = function (harness) {
  const { assert, test } = harness;
  const root = path.join(__dirname, '..');
  const skillRoot = path.join(root, '.agents', 'skills', 'smalldocs-author');
  const referenceRoot = path.join(skillRoot, 'references');
  const shapes = require('../public/sdocs-shapes');
  const slideResolve = require('../public/sdocs-slide-resolve');
  const slideStdlib = require('../cli/shared/sdocs-slide-stdlib');
  const cells = require('../public/sdocs-cells');
  const formulas = require('../public/sdocs-cells-formula');
  const video = require('../public/sdocs-video');

  console.log('\n-- SDK Authoring Documentation Tests ----------\n');

  function readReference(name) {
    return fs.readFileSync(path.join(referenceRoot, name + '.md'), 'utf8');
  }

  function fencedBodies(markdown, language) {
    const escaped = language.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('^```' + escaped + '(?:[ \\t]+[^\\n]*)?\\n([\\s\\S]*?)^```[ \\t]*$', 'gm');
    return Array.from(markdown.matchAll(pattern), match => match[1]);
  }

  function slideBodies(markdown) {
    return Array.from(markdown.matchAll(/^~~~slide(?:[ \t]+[^\n]*)?\n([\s\S]*?)^~~~[ \t]*$/gm), match => match[1]);
  }

  function tildeBodies(markdown, language) {
    const escaped = language.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('^~~~' + escaped + '(?:[ \\t]+[^\\n]*)?\\n([\\s\\S]*?)^~~~[ \\t]*$', 'gm');
    return Array.from(markdown.matchAll(pattern), match => match[1]);
  }

  test('author skill links only to references that exist', () => {
    const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const links = Array.from(skill.matchAll(/\]\((references\/[a-z-]+\.md)\)/g), match => match[1]);
    assert.ok(links.length >= 10, 'skill should route across the complete authoring surface');
    links.forEach(relative => {
      assert.ok(fs.existsSync(path.join(skillRoot, relative)), 'missing skill reference: ' + relative);
    });
  });

  test('documented built-in slide example resolves and parses', () => {
    const examples = slideBodies(readReference('slides'));
    assert.ok(examples.length > 0, 'slides reference should contain a slide example');
    const resolved = slideResolve.resolveSlides(examples, shapes, { stdlib: slideStdlib.templates });
    resolved.forEach(result => {
      assert.deepStrictEqual(result.errors, []);
      if (result.skip) return;
      const parsed = shapes.parse(result.dsl);
      assert.deepStrictEqual(parsed.errors, []);
      assert.ok(parsed.shapes.length > 0);
    });
  });

  test('slides reference distinguishes rendering a built-in from defining a template', () => {
    const reference = readReference('slides');
    assert.ok(reference.includes('Use a built-in template with `@extends NAME`'));
    assert.ok(reference.includes('`@template NAME` has a different purpose'));
    const example = slideBodies(reference)[0];
    assert.ok(example.startsWith('@extends '));
  });

  test('built-in slide templates parse and keep muted text theme-aware', () => {
    slideStdlib.names.forEach(name => {
      const parsed = shapes.parse(slideStdlib.templates[name]);
      assert.deepStrictEqual(parsed.errors, [], 'built-in template: ' + name);
      parsed.shapes.forEach(shape => {
        if (!shape.attrs.color || parsed.grid.attrs.bg) return;
        assert.ok(shape.attrs.color.startsWith('$'), name + ' should not pin text to one theme');
        const ref = require('../cli/shared/sdocs-styles').resolveStyleRef(shape.attrs.color);
        assert.ok(ref && !ref.error, 'unknown style reference in ' + name + ': ' + shape.attrs.color);
      });
    });
  });

  test('every documented custom slide example parses without errors', () => {
    const examples = slideBodies(readReference('slide-shapes'));
    assert.ok(examples.length >= 2, 'shape reference should contain multiple complete examples');
    examples.forEach((source, index) => {
      const parsed = shapes.parse(source);
      assert.deepStrictEqual(parsed.errors, [], 'custom slide example ' + (index + 1));
      assert.ok(parsed.grid && parsed.grid.w === 16 && parsed.grid.h === 9);
      assert.ok(parsed.shapes.length >= 3);
      if (parsed.grid.attrs.bg) {
        parsed.shapes.filter(shape => shape.content).forEach(shape => {
          assert.ok(shape.attrs.color, 'text on an explicit slide background needs an explicit colour');
        });
      }
    });
  });

  test('custom shape reference includes a complete five-stage horizontal pipeline', () => {
    const examples = slideBodies(readReference('slide-shapes'));
    const pipeline = examples.find(source => source.includes('Agent\n  analysis')
      && source.includes('Embedded\n  view'));
    assert.ok(pipeline, 'missing five-stage pipeline example');
    const parsed = shapes.parse(pipeline);
    const labels = parsed.shapes.filter(shape => shape.content).map(shape => shape.content.replace(/\s+/g, ' '));
    ['Agent analysis', 'Finished Markdown', 'Content discovery', 'Lazy feature loading', 'Embedded view']
      .forEach(label => assert.ok(labels.includes(label), 'pipeline missing stage: ' + label));
    const stageShapes = parsed.shapes.filter(shape => shape.content && shape.content !== 'One result moves through five visible stages');
    assert.ok(stageShapes.every((shape, index, list) => index === 0 || shape.x > list[index - 1].x),
      'pipeline stages should remain left to right');
  });

  test('every documented chart block is valid supported JSON', () => {
    const supported = new Set([
      'pie', 'doughnut', 'bar', 'horizontal_bar', 'stacked_bar',
      'stacked_horizontal_bar', 'line', 'area', 'stacked_area',
      'radar', 'polarArea', 'scatter', 'bubble', 'mixed',
    ]);
    const examples = fencedBodies(readReference('charts'), 'chart');
    assert.ok(examples.length >= 2);
    examples.forEach((source, index) => {
      const config = JSON.parse(source);
      assert.ok(supported.has(config.type), 'unsupported chart type in example ' + (index + 1));
      assert.ok(Array.isArray(config.labels));
      assert.ok(Array.isArray(config.values) || Array.isArray(config.datasets));
    });
  });

  test('documented cells blocks parse and formulas recalculate', () => {
    const markdown = readReference('cells');
    const examples = fencedBodies(markdown, 'cells');
    assert.ok(examples.length >= 3);
    const models = examples.map(source => cells.parseCells(source));
    models.forEach(model => {
      assert.strictEqual(model.empty, false);
      assert.strictEqual(model.error, undefined);
      assert.ok(model.rows > 1 && model.cols > 1);
    });

    const firstResults = formulas.recalc(models[0]);
    assert.strictEqual(firstResults[4][3].value, 4116);

    const names = Array.from(markdown.matchAll(/^```cells(?:\s+([^\n]+))?$/gm), match => (match[1] || '').trim());
    const workbookModels = models.slice(1).map((model, index) => ({ name: names[index + 1], model }));
    const workbookResults = formulas.recalcWorkbook(workbookModels);
    assert.strictEqual(workbookResults[1][1][1].value, 600);
  });

  test('every documented video block passes the production trust boundary', () => {
    const examples = fencedBodies(readReference('video'), 'video');
    assert.ok(examples.length > 0);
    examples.forEach(source => {
      const parsed = video.parseVideoSource(source);
      assert.strictEqual(parsed.error, undefined);
      assert.strictEqual(parsed.provider, 'youtube');
      assert.ok(video.buildEmbedUrl(parsed).startsWith('https://www.youtube-nocookie.com/embed/'));
    });
  });

  test('agent index points to both SDK skills and the complete reference', () => {
    const index = fs.readFileSync(path.join(root, 'public', 'developers', 'llms.txt'), 'utf8');
    assert.ok(index.includes('/developers/llms-full.txt'));
    assert.ok(index.includes('/sdk/0.1.2/smalldocs.js'));
    assert.ok(index.includes('/.well-known/agent-skills/smalldocs-renderer/SKILL.md'));
    assert.ok(index.includes('/.well-known/agent-skills/smalldocs-author/SKILL.md'));
    ['markdown', 'code', 'math', 'diagrams', 'charts', 'cells', 'slides', 'slide-shapes', 'video', 'styles']
      .forEach(slug => assert.ok(index.includes('/developers/authoring/' + slug + '.md')));
  });

  test('renderer documentation describes SDK-owned fullscreen behavior', () => {
    const integration = fs.readFileSync(path.join(root, 'public', 'developers', 'integration.md'), 'utf8');
    const lifecycle = fs.readFileSync(path.join(root, 'public', 'developers', 'lifecycle.md'), 'utf8');
    const api = fs.readFileSync(
      path.join(root, '.agents', 'skills', 'smalldocs-renderer', 'references', 'api.md'),
      'utf8'
    );
    [integration, lifecycle, api].forEach(document => {
      assert.ok(document.includes('browser viewport'));
      assert.ok(document.includes('scroll'));
    });
  });

  test('customer SDK example uses valid slides, charts, and computed cells', () => {
    const exampleRoot = path.join(root, 'public', 'developers', 'example');
    const slideSources = slideBodies(fs.readFileSync(path.join(exampleRoot, 'briefing.md'), 'utf8'));
    assert.strictEqual(slideSources.length, 4);
    const resolvedSlides = slideResolve.resolveSlides(slideSources, shapes, { stdlib: slideStdlib.templates });
    resolvedSlides.forEach(result => {
      assert.deepStrictEqual(result.errors, []);
      if (result.skip) return;
      assert.deepStrictEqual(shapes.parse(result.dsl).errors, []);
    });

    const chartSources = tildeBodies(fs.readFileSync(path.join(exampleRoot, 'charts.md'), 'utf8'), 'chart');
    assert.strictEqual(chartSources.length, 2);
    chartSources.forEach(source => {
      const chart = JSON.parse(source);
      assert.ok(['bar', 'line'].includes(chart.type));
      assert.ok(Array.isArray(chart.labels));
      assert.ok(Array.isArray(chart.values) || Array.isArray(chart.datasets));
    });

    const cellSources = tildeBodies(fs.readFileSync(path.join(exampleRoot, 'model.md'), 'utf8'), 'cells');
    assert.strictEqual(cellSources.length, 1);
    const model = cells.parseCells(cellSources[0]);
    assert.strictEqual(model.error, undefined);
    const results = formulas.recalc(model);
    assert.strictEqual(results[7][3].value, 37000);
    assert.strictEqual(results[7][4].value, 130000);
  });
};
