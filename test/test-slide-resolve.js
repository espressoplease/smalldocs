/**
 * Slide template resolver tests
 * Uses shared sdocs-slide-resolve.js module + sdocs-shapes.js for merge.
 */
const path = require('path');
const SDocSlideResolve = require(path.join(__dirname, '..', 'public', 'sdocs-slide-resolve.js'));
const SDocShapes = require(path.join(__dirname, '..', 'public', 'sdocs-shapes.js'));

module.exports = function(harness) {
  const { assert, test } = harness;
  const { resolveSlides, splitDirective, parseSlots } = SDocSlideResolve;

  console.log('\n── Slide Template Resolver Tests ──────────────\n');

  // ── Directive parsing ────────────────────────────────

  test('splitDirective: no directive → kind null', () => {
    const r = splitDirective('grid 16 9\nr 0 0 16 9');
    assert.strictEqual(r.kind, null);
  });

  test('splitDirective: @template recognised', () => {
    const r = splitDirective('@template hero\ngrid 16 9\nr 0 0 16 9');
    assert.strictEqual(r.kind, 'template');
    assert.strictEqual(r.name, 'hero');
    assert.strictEqual(r.body, 'grid 16 9\nr 0 0 16 9');
  });

  test('splitDirective: @extends recognised', () => {
    const r = splitDirective('@extends hero\n#title: Hello');
    assert.strictEqual(r.kind, 'extends');
    assert.strictEqual(r.name, 'hero');
  });

  test('splitDirective: leading blank lines skipped', () => {
    const r = splitDirective('\n\n@template foo\nbody');
    assert.strictEqual(r.kind, 'template');
  });

  // ── Slot parsing ─────────────────────────────────────

  test('parseSlots: inline slot', () => {
    const s = parseSlots('#title: Hello world');
    assert.deepStrictEqual(s, { title: 'Hello world' });
  });

  test('parseSlots: block slot (colon, then indented body)', () => {
    const s = parseSlots('#body:\n- one\n- two');
    assert.deepStrictEqual(s, { body: '- one\n- two' });
  });

  test('parseSlots: multiple slots', () => {
    const s = parseSlots('#title: Hi\n#body:\nline one\nline two');
    assert.deepStrictEqual(s, { title: 'Hi', body: 'line one\nline two' });
  });

  test('parseSlots: text before first slot is ignored', () => {
    const s = parseSlots('some notes\nmore notes\n#title: Hello');
    assert.deepStrictEqual(s, { title: 'Hello' });
  });

  test('parseSlots: trailing blank lines trimmed from slot content', () => {
    const s = parseSlots('#body:\nline\n\n\n');
    assert.deepStrictEqual(s, { body: 'line' });
  });

  test('parseSlots: bare | after colon is YAML-style sugar (dropped)', () => {
    const s = parseSlots('#body: |\nline one\nline two');
    assert.deepStrictEqual(s, { body: 'line one\nline two' });
  });

  test('parseSlots: indented block body is dedented to common leading indent', () => {
    const s = parseSlots('#body:\n  - one\n  - two\n  - three');
    assert.deepStrictEqual(s, { body: '- one\n- two\n- three' });
  });

  test('parseSlots: dedent keeps relative indent between lines', () => {
    const s = parseSlots('#body:\n  - top\n    - nested\n  - back');
    // common leading indent = 2, so nested should still be indented by 2
    assert.deepStrictEqual(s, { body: '- top\n  - nested\n- back' });
  });

  test('parseSlots: YAML-style | + indented body dedents correctly (table case)', () => {
    const s = parseSlots('#body: |\n  | A | B |\n  |---|---|\n  | 1 | 2 |');
    assert.deepStrictEqual(s, { body: '| A | B |\n|---|---|\n| 1 | 2 |' });
  });

  test('parseSlots: inline slot is left exactly as typed (no dedent on single line)', () => {
    const s = parseSlots('#title:   leading spaces kept as value');
    assert.deepStrictEqual(s, { title: '  leading spaces kept as value' });
  });

  // ── End-to-end resolve ───────────────────────────────

  test('resolveSlides: plain slides pass through untouched', () => {
    const out = resolveSlides(['grid 16 9\nr 0 0 16 9'], SDocShapes);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].skip, false);
    assert.strictEqual(out[0].dsl, 'grid 16 9\nr 0 0 16 9');
    assert.deepStrictEqual(out[0].errors, []);
  });

  test('resolveSlides: @template slide is skipped (skip:true)', () => {
    const out = resolveSlides(['@template hero\ngrid 16 9\nr 0 0 16 9'], SDocShapes);
    assert.strictEqual(out[0].skip, true);
    assert.deepStrictEqual(out[0].errors, []);
  });

  test('resolveSlides: @extends merges inline slot content', () => {
    const tpl = [
      '@template hero',
      'grid 16 9',
      'r 0 0 16 4 #title fill=#1e40af color=#fff | placeholder title',
    ].join('\n');
    const consumer = [
      '@extends hero',
      '#title: Hello world',
    ].join('\n');
    const out = resolveSlides([tpl, consumer], SDocShapes);
    assert.strictEqual(out[1].skip, false);
    assert.ok(out[1].dsl.includes('Hello world'), 'merged DSL contains slot value');
    assert.ok(!out[1].dsl.includes('placeholder title'), 'placeholder replaced');
  });

  test('resolveSlides: @extends merges multi-line slot via block form', () => {
    const tpl = [
      '@template layout',
      'grid 16 9',
      'r 0 0 16 9 #body align=left valign=top | placeholder',
    ].join('\n');
    const consumer = [
      '@extends layout',
      '#body:',
      '- one',
      '- two',
    ].join('\n');
    const out = resolveSlides([tpl, consumer], SDocShapes);
    const dsl = out[1].dsl;
    assert.ok(dsl.includes('- one') && dsl.includes('- two'), 'both bullets present');
    // Re-parsing the merged DSL must succeed (serialize → parse round-trip).
    const parsed = SDocShapes.parse(dsl);
    assert.deepStrictEqual(parsed.errors, []);
    const shape = parsed.shapes.find(s => s.id === 'body');
    assert.strictEqual(shape.content, '- one\n- two');
  });

  test('resolveSlides: consumer ordering — consumer before template still resolves', () => {
    const consumer = '@extends hero\n#title: Hi';
    const tpl = '@template hero\ngrid 16 9\nr 0 0 16 4 #title | placeholder';
    // Consumer declared first, template second.
    const out = resolveSlides([consumer, tpl], SDocShapes);
    assert.deepStrictEqual(out[0].errors, []);
    assert.ok(out[0].dsl.includes('Hi'));
    assert.strictEqual(out[1].skip, true);
  });

  test('resolveSlides: @extends of unknown template surfaces error', () => {
    const out = resolveSlides(['@extends ghost\n#title: Hi'], SDocShapes);
    assert.strictEqual(out[0].skip, false);
    assert.strictEqual(out[0].errors.length, 1);
    assert.ok(/unknown template/.test(out[0].errors[0].message));
  });

  test('resolveSlides: partial fill retains template placeholder for unset slots', () => {
    const tpl = [
      '@template layout',
      'grid 16 9',
      'r 0 0 16 3 #title | placeholder title',
      'r 0 3 16 6 #body  | placeholder body',
    ].join('\n');
    const consumer = '@extends layout\n#title: Only title';
    const out = resolveSlides([tpl, consumer], SDocShapes);
    const dsl = out[1].dsl;
    assert.ok(dsl.includes('Only title'), 'title replaced');
    assert.ok(dsl.includes('placeholder body'), 'body placeholder retained');
  });

  test('resolveSlides: mixed deck — plain + template + consumer', () => {
    const plain = 'grid 16 9\nr 0 0 16 9 | plain';
    const tpl = '@template hero\ngrid 16 9\nr 0 0 16 9 #title | X';
    const consumer = '@extends hero\n#title: Custom';
    const out = resolveSlides([plain, tpl, consumer], SDocShapes);
    assert.strictEqual(out[0].skip, false);
    assert.strictEqual(out[0].dsl, plain);
    assert.strictEqual(out[1].skip, true);
    assert.ok(out[2].dsl.includes('Custom'));
  });
};
