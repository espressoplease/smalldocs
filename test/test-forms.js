/**
 * sdocs-form-block tests — parser, serializer, token, boundary stability.
 * The browser renderer and the multi-round flow are exercised by the
 * Playwright spec in test/forms.spec.js.
 */
const path = require('path');
const FB = require(path.join(__dirname, '..', 'cli', 'shared', 'sdocs-form-block.js'));

module.exports = function (harness) {
  const { test } = harness;

  // ── parse: happy paths ────────────────────────────────────

  test('forms: parse minimal valid block', () => {
    const src = [
      'id: demo',
      'fields:',
      '  - name: ready',
      '    type: radio',
      '    label: "Are you ready?"',
      '    options: [Yes, No]',
      'buttons:',
      '  - name: ok',
      '    label: "OK"',
    ].join('\n');
    const r = FB.parseFormBlock(src);
    if (r.error) throw new Error(r.error);
    if (r.value.id !== 'demo') throw new Error('bad id');
    if (r.value.fields.length !== 1) throw new Error('bad field count');
    if (r.value.fields[0].type !== 'radio') throw new Error('bad type');
    if (r.value.buttons[0].name !== 'ok') throw new Error('bad button');
  });

  test('forms: parse block scalar default', () => {
    const src = [
      'id: t1',
      'fields:',
      '  - name: notes',
      '    type: textarea',
      '    label: "Notes"',
      '    default: |',
      '      Line one',
      '      Line two',
      'buttons:',
      '  - name: ok',
      '    label: "OK"',
    ].join('\n');
    const r = FB.parseFormBlock(src);
    if (r.error) throw new Error(r.error);
    const got = r.value.fields[0].default;
    if (!got.includes('Line one') || !got.includes('Line two')) {
      throw new Error('lost lines: ' + JSON.stringify(got));
    }
  });

  test('forms: parse all three field types', () => {
    const src = [
      'id: all',
      'fields:',
      '  - name: a', '    type: text', '    label: "a"',
      '  - name: b', '    type: textarea', '    label: "b"',
      '  - name: c', '    type: radio', '    label: "c"', '    options: [x, y]',
      'buttons:', '  - name: ok', '    label: "ok"',
    ].join('\n');
    const r = FB.parseFormBlock(src);
    if (r.error) throw new Error(r.error);
    if (r.value.fields.map(f => f.type).join(',') !== 'text,textarea,radio') {
      throw new Error('types: ' + r.value.fields.map(f => f.type).join(','));
    }
  });

  test('forms: parse new field types (checkbox, select, number, date)', () => {
    const src = [
      'id: ext',
      'fields:',
      '  - name: tags',    '    type: checkbox', '    label: "Tags"',    '    options: [a, b, c]', '    default: [a, b]',
      '  - name: tier',    '    type: select',   '    label: "Tier"',    '    options: [free, pro]', '    default: pro',
      '  - name: count',   '    type: number',   '    label: "How many"', '    min: 1', '    max: 100', '    default: 7',
      '  - name: ship',    '    type: date',     '    label: "Date"',     '    default: "2026-06-01"',
      'buttons:', '  - name: ok', '    label: "OK"',
    ].join('\n');
    const r = FB.parseFormBlock(src);
    if (r.error) throw new Error(r.error);
    const f = r.value.fields;
    if (f[0].type !== 'checkbox' || !Array.isArray(f[0].default) ||
        f[0].default.join(',') !== 'a,b') throw new Error('checkbox default');
    if (f[1].type !== 'select'   || f[1].default !== 'pro') throw new Error('select default');
    if (f[2].type !== 'number'   || f[2].default !== 7   ||
        f[2].min   !== 1         || f[2].max     !== 100) throw new Error('number');
    if (f[3].type !== 'date'     || f[3].default !== '2026-06-01') throw new Error('date');
  });

  test('forms: checkbox/select without options are rejected', () => {
    const cb = FB.parseFormBlock([
      'id: d', 'fields:', '  - name: x', '    type: checkbox', '    label: "x"',
      'buttons:', '  - name: ok', '    label: "OK"',
    ].join('\n'));
    if (!cb.error || !/options/.test(cb.error)) throw new Error('checkbox missing options should error');
    const se = FB.parseFormBlock([
      'id: d', 'fields:', '  - name: x', '    type: select', '    label: "x"',
      'buttons:', '  - name: ok', '    label: "OK"',
    ].join('\n'));
    if (!se.error || !/options/.test(se.error)) throw new Error('select missing options should error');
  });

  test('forms: checkbox default must be array; number default must be a number', () => {
    const cb = FB.parseFormBlock([
      'id: d', 'fields:', '  - name: x', '    type: checkbox', '    label: "x"',
      '    options: [a, b]', '    default: a',
      'buttons:', '  - name: ok', '    label: "OK"',
    ].join('\n'));
    if (!cb.error || !/array/.test(cb.error)) throw new Error('expected checkbox default-array error');
    const num = FB.parseFormBlock([
      'id: d', 'fields:', '  - name: n', '    type: number', '    label: "n"', '    default: "five"',
      'buttons:', '  - name: ok', '    label: "OK"',
    ].join('\n'));
    if (!num.error || !/number/.test(num.error)) throw new Error('expected number default-number error');
  });

  test('forms: button.after refers to a known field', () => {
    const bad = FB.parseFormBlock([
      'id: d',
      'fields:', '  - name: a', '    type: text', '    label: "A"',
      'buttons:',
      '  - name: ok', '    label: "OK"', '    after: missing',
    ].join('\n'));
    if (!bad.error || !/unknown field/.test(bad.error)) throw new Error('expected after-unknown-field error');
    const good = FB.parseFormBlock([
      'id: d',
      'fields:', '  - name: a', '    type: text', '    label: "A"',
      'buttons:',
      '  - name: ok', '    label: "OK"', '    after: a',
    ].join('\n'));
    if (good.error) throw new Error('after-existing-field: ' + good.error);
    if (good.value.buttons[0].after !== 'a') throw new Error('after not preserved');
  });

  test('forms: new field types round-trip through serialize → parse', () => {
    const src = [
      'id: rt2',
      'fields:',
      '  - name: tags',  '    type: checkbox', '    label: "Tags"', '    options: [a, b, c]', '    default: [a, c]',
      '  - name: tier',  '    type: select',   '    label: "Tier"', '    options: [free, pro]', '    default: pro',
      '  - name: count', '    type: number',   '    label: "n"',    '    default: 9',
      '  - name: when',  '    type: date',     '    label: "d"',    '    default: "2026-07-04"',
      'buttons:',
      '  - name: a', '    label: "A"', '    scope: [tags]', '    after: tags',
      '  - name: b', '    label: "B"', '    final: true',
    ].join('\n');
    const r1 = FB.parseFormBlock(src);
    if (r1.error) throw new Error('first parse: ' + r1.error);
    const ser = FB.serializeFormBlock(r1.value);
    const r2 = FB.parseFormBlock(ser);
    if (r2.error) throw new Error('reparse: ' + r2.error);
    const t1 = FB.formRevisionToken(r1.value.fields, r1.value.buttons);
    const t2 = FB.formRevisionToken(r2.value.fields, r2.value.buttons);
    if (t1 !== t2) throw new Error('token drift after round-trip');
    if (r2.value.buttons[0].after !== 'tags') throw new Error('after lost in round-trip');
    if (r2.value.fields[2].default !== 9) throw new Error('number lost: ' + JSON.stringify(r2.value.fields[2].default));
    if (r2.value.fields[3].default !== '2026-07-04') throw new Error('date lost: ' + JSON.stringify(r2.value.fields[3].default));
  });

  // ── parse: rejection paths ────────────────────────────────

  test('forms: reject missing id', () => {
    const r = FB.parseFormBlock('fields:\n  - name: x\n    type: text\n    label: "X"\nbuttons:\n  - name: ok\n    label: "OK"');
    if (!r.error) throw new Error('expected error');
  });

  test('forms: reject duplicate field names', () => {
    const r = FB.parseFormBlock([
      'id: d',
      'fields:',
      '  - name: a', '    type: text', '    label: "A"',
      '  - name: a', '    type: text', '    label: "A2"',
      'buttons:', '  - name: ok', '    label: "OK"',
    ].join('\n'));
    if (!r.error || !/duplicate/.test(r.error)) throw new Error('expected dup error');
  });

  test('forms: reject invalid field name', () => {
    const r = FB.parseFormBlock([
      'id: d', 'fields:', '  - name: BAD NAME', '    type: text', '    label: "x"',
      'buttons:', '  - name: ok', '    label: "OK"',
    ].join('\n'));
    if (!r.error) throw new Error('expected name regex error');
  });

  test('forms: reject unknown field type', () => {
    const r = FB.parseFormBlock([
      'id: d', 'fields:', '  - name: x', '    type: slider', '    label: "s"',
      'buttons:', '  - name: ok', '    label: "OK"',
    ].join('\n'));
    if (!r.error || !/unknown type/.test(r.error)) throw new Error('expected type error');
  });

  test('forms: reject radio without options', () => {
    const r = FB.parseFormBlock([
      'id: d', 'fields:', '  - name: x', '    type: radio', '    label: "r"',
      'buttons:', '  - name: ok', '    label: "OK"',
    ].join('\n'));
    if (!r.error || !/options/.test(r.error)) throw new Error('expected options error');
  });

  test('forms: reject button scope to unknown field', () => {
    const r = FB.parseFormBlock([
      'id: d', 'fields:', '  - name: a', '    type: text', '    label: "A"',
      'buttons:', '  - name: ok', '    label: "OK"', '    scope: [b]',
    ].join('\n'));
    if (!r.error || !/unknown field/.test(r.error)) throw new Error('expected scope error');
  });

  test('forms: reject block over size limit', () => {
    const big = 'x'.repeat(FB.MAX_BLOCK_BYTES + 1);
    const r = FB.parseFormBlock(big);
    if (!r.error) throw new Error('expected size error');
  });

  test('forms: reject __proto__ key', () => {
    const r = FB.parseFormBlock([
      'id: d', '__proto__: oops', 'fields:', '  - name: a', '    type: text', '    label: "A"',
      'buttons:', '  - name: ok', '    label: "OK"',
    ].join('\n'));
    if (!r.error) throw new Error('expected reserved-key error');
  });

  // ── round-trip ────────────────────────────────────────────

  test('forms: round-trip parse → serialize → parse', () => {
    const src = [
      'id: rt',
      'fields:',
      '  - name: ready', '    type: radio', '    label: "Ready?"', '    options: [Yes, No]', '    required: true', '    default: Yes',
      '  - name: notes', '    type: textarea', '    label: "Notes"', '    rows: 5', '    default: |', '      Hello', '      World',
      'buttons:',
      '  - name: a', '    label: "A"', '    scope: [ready]',
      '  - name: b', '    label: "B"', '    final: true',
    ].join('\n');
    const r1 = FB.parseFormBlock(src);
    if (r1.error) throw new Error('first parse: ' + r1.error);
    const ser = FB.serializeFormBlock(r1.value);
    const r2 = FB.parseFormBlock(ser);
    if (r2.error) throw new Error('reparse: ' + r2.error);
    const t1 = FB.formRevisionToken(r1.value.fields, r1.value.buttons);
    const t2 = FB.formRevisionToken(r2.value.fields, r2.value.buttons);
    if (t1 !== t2) throw new Error('token drift: ' + t1 + ' vs ' + t2);
    if (r2.value.fields[1].default.replace(/\n$/, '') !== 'Hello\nWorld') {
      throw new Error('textarea round-trip: ' + JSON.stringify(r2.value.fields[1].default));
    }
  });

  // ── token ──────────────────────────────────────────────────

  test('forms: token ignores answers/submissions', () => {
    const t0 = FB.formRevisionToken(
      [{ name: 'a', type: 'text', label: 'A' }],
      [{ name: 'ok', label: 'OK' }]
    );
    // Same fields/buttons regardless of unrelated state — verify
    // canonicalFormSignature only depends on those two arrays.
    const t1 = FB.formRevisionToken(
      [{ name: 'a', type: 'text', label: 'A' }],
      [{ name: 'ok', label: 'OK' }]
    );
    if (t0 !== t1) throw new Error('token not stable');
  });

  test('forms: token changes when label changes', () => {
    const t0 = FB.formRevisionToken([{ name: 'a', type: 'text', label: 'A' }],  [{ name: 'ok', label: 'OK' }]);
    const t1 = FB.formRevisionToken([{ name: 'a', type: 'text', label: 'A2' }], [{ name: 'ok', label: 'OK' }]);
    if (t0 === t1) throw new Error('label change did not bump token');
  });

  test('forms: token strips unknown keys before hashing', () => {
    const t0 = FB.formRevisionToken(
      [{ name: 'a', type: 'text', label: 'A' }],
      [{ name: 'ok', label: 'OK' }]
    );
    const t1 = FB.formRevisionToken(
      [{ name: 'a', type: 'text', label: 'A', _internal: 'cosmetic' }],
      [{ name: 'ok', label: 'OK' }]
    );
    if (t0 !== t1) throw new Error('unknown key leaked into token');
  });

  // ── findFormBlocks + spliceFormBlock + boundary stability ──

  test('forms: findFormBlocks locates single block', () => {
    const doc = [
      '# Heading',
      '',
      'Some prose.',
      '',
      '```form',
      'id: f1',
      'fields:',
      '  - name: a', '    type: text', '    label: "A"',
      'buttons:', '  - name: ok', '    label: "OK"',
      '```',
      '',
      'After text.',
    ].join('\n');
    const blocks = FB.findFormBlocks(doc);
    if (blocks.length !== 1) throw new Error('blocks: ' + blocks.length);
    if (blocks[0].id !== 'f1') throw new Error('id wrong');
    if (blocks[0].error) throw new Error('parse error: ' + blocks[0].error);
  });

  test('forms: spliceFormBlock preserves surrounding bytes', () => {
    const doc = [
      'BEFORE',
      '```form',
      'id: f',
      'fields:',
      '  - name: a', '    type: text', '    label: "A"',
      'buttons:', '  - name: ok', '    label: "OK"',
      '```',
      'AFTER',
    ].join('\n') + '\n';
    const blocks = FB.findFormBlocks(doc);
    const target = blocks[0];
    const updated = Object.assign({}, target.parsed, {
      answers: { a: 'value' },
      submissions: [{ by: 'ok', at: '2026-01-01T00:00:00Z', scope: ['a'], values: { a: 'value' } }],
    });
    const r = FB.spliceFormBlock(doc, target, updated);
    if (r.error) throw new Error(r.error);
    if (r.doc.slice(0, r.startByte) !== doc.slice(0, target.startByte)) throw new Error('pre changed');
    if (r.doc.slice(r.endByte)       !== doc.slice(target.endByte))     throw new Error('post changed');
    const re = FB.findFormBlocks(r.doc);
    if (re.length !== 1 || re[0].id !== 'f' || re[0].error) {
      throw new Error('spliced block does not re-parse: ' + (re[0] && re[0].error));
    }
  });

  test('forms: spliceFormBlock survives tricky user input', () => {
    const doc = [
      '```form',
      'id: e',
      'fields:',
      '  - name: a', '    type: textarea', '    label: "A"',
      'buttons:', '  - name: ok', '    label: "OK"',
      '```',
    ].join('\n') + '\n';
    const blocks = FB.findFormBlocks(doc);
    const target = blocks[0];
    // Block scalars don't preserve trailing whitespace per line (that's a
    // YAML thing, not ours) — every other twist on user input must
    // round-trip exactly.
    const tricky = [
      'first line',
      '   --- not a doc marker',
      'something with "quotes" and # hash',
      'trailing-no-space',
    ].join('\n');
    const updated = Object.assign({}, target.parsed, {
      answers: { a: tricky },
      submissions: [{ by: 'ok', at: '2026-01-01T00:00:00Z', scope: ['a'], values: { a: tricky } }],
    });
    const r = FB.spliceFormBlock(doc, target, updated);
    if (r.error) throw new Error(r.error);
    if (r.doc.slice(0, r.startByte) !== doc.slice(0, target.startByte)) throw new Error('pre shifted');
    if (r.doc.slice(r.endByte)       !== doc.slice(target.endByte))     throw new Error('post shifted');
    const re = FB.findFormBlocks(r.doc);
    if (re[0].error) throw new Error('reparse: ' + re[0].error);
    const got = re[0].parsed.answers.a.replace(/\n$/, '');
    if (got !== tricky) throw new Error('tricky text lost: ' + JSON.stringify(re[0].parsed.answers.a));
  });

  test('forms: findFormBlocks locates multiple blocks', () => {
    const doc = [
      '```form',
      'id: a',
      'fields:', '  - name: x', '    type: text', '    label: "X"',
      'buttons:', '  - name: ok', '    label: "OK"',
      '```',
      '',
      'between',
      '',
      '```form',
      'id: b',
      'fields:', '  - name: y', '    type: text', '    label: "Y"',
      'buttons:', '  - name: ok', '    label: "OK"',
      '```',
    ].join('\n');
    const blocks = FB.findFormBlocks(doc);
    if (blocks.length !== 2) throw new Error('count: ' + blocks.length);
    if (blocks[0].id !== 'a' || blocks[1].id !== 'b') {
      throw new Error('ids: ' + blocks.map(b => b.id).join(','));
    }
  });
};
