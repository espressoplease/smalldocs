/**
 * Shape DSL parser tests
 * Uses shared sdocs-shapes.js module
 */
const path = require('path');
const SDocShapes = require(path.join(__dirname, '..', 'public', 'sdocs-shapes.js'));

module.exports = function(harness) {
  const { assert, test } = harness;
  const { parse, serialize } = SDocShapes;

  console.log('\n── Shape DSL Tests ────────────────────────────\n');

  // ── Primitives ───────────────────────────────────────

  test('rectangle: r x y w h', () => {
    const { shapes, errors } = parse('r 10 20 30 40');
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(shapes.length, 1);
    assert.deepStrictEqual(shapes[0], {
      kind: 'r', x: 10, y: 20, w: 30, h: 40,
      id: null, attrs: {}, content: null, lineNumber: 1,
    });
  });

  test('circle: c cx cy r', () => {
    const { shapes } = parse('c 50 25 12');
    assert.strictEqual(shapes[0].kind, 'c');
    assert.strictEqual(shapes[0].cx, 50);
    assert.strictEqual(shapes[0].cy, 25);
    assert.strictEqual(shapes[0].r, 12);
  });

  test('ellipse: e cx cy rx ry', () => {
    const { shapes } = parse('e 50 25 20 10');
    assert.deepStrictEqual(
      { kind: shapes[0].kind, cx: shapes[0].cx, cy: shapes[0].cy, rx: shapes[0].rx, ry: shapes[0].ry },
      { kind: 'e', cx: 50, cy: 25, rx: 20, ry: 10 }
    );
  });

  test('line: l x1 y1 x2 y2', () => {
    const { shapes } = parse('l 0 0 100 50');
    assert.deepStrictEqual(
      { kind: shapes[0].kind, x1: shapes[0].x1, y1: shapes[0].y1, x2: shapes[0].x2, y2: shapes[0].y2 },
      { kind: 'l', x1: 0, y1: 0, x2: 100, y2: 50 }
    );
  });

  test('arrow: a x1 y1 x2 y2', () => {
    const { shapes } = parse('a 10 10 90 10');
    assert.strictEqual(shapes[0].kind, 'a');
    assert.strictEqual(shapes[0].x2, 90);
  });

  test('polygon: all straight segments', () => {
    const { shapes, errors } = parse('p 10,10 90,10 90,50 10,50');
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(shapes[0].points.length, 4);
    assert.strictEqual(shapes[0].points[0].x, 10);
    assert.strictEqual(shapes[0].points[0].curve, false);
    assert.ok(shapes[0].points.every(p => p.curve === false));
  });

  test('polygon: ~ marks segment into next point as curved', () => {
    const { shapes } = parse('p 10,10 90,10 ~ 90,50 10,50');
    // Point 0: first, not curved. Point 1: straight from 0. Point 2: curved from 1. Point 3: straight from 2.
    assert.strictEqual(shapes[0].points[0].curve, false);
    assert.strictEqual(shapes[0].points[1].curve, false);
    assert.strictEqual(shapes[0].points[2].curve, true);
    assert.strictEqual(shapes[0].points[3].curve, false);
  });

  test('polygon: multiple ~ modifiers', () => {
    const { shapes } = parse('p 10,10 90,10 ~ 90,50 ~ 50,60 10,50');
    assert.strictEqual(shapes[0].points.filter(p => p.curve).length, 2);
  });

  test('polygon: supports floating-point coordinates', () => {
    const { shapes, errors } = parse('p 10.5,10.25 90,10 90,56.25');
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(shapes[0].points[0].x, 10.5);
    assert.strictEqual(shapes[0].points[0].y, 10.25);
    assert.strictEqual(shapes[0].points[2].y, 56.25);
  });

  test('polygon: supports negative coordinates', () => {
    const { shapes, errors } = parse('p -5,-5 10,10 20,20');
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(shapes[0].points[0].x, -5);
    assert.strictEqual(shapes[0].points[0].y, -5);
  });

  // ── IDs and attributes ───────────────────────────────

  test('id: #name attaches identifier', () => {
    const { shapes } = parse('r 10 10 80 15 #title');
    assert.strictEqual(shapes[0].id, 'title');
  });

  test('id: allowed characters (letters, digits, underscore, hyphen)', () => {
    const { shapes, errors } = parse('r 0 0 10 10 #my_id-2');
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(shapes[0].id, 'my_id-2');
  });

  test('id: must start with letter or underscore', () => {
    const { errors } = parse('r 0 0 10 10 #2bad');
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0].message, /invalid id/);
  });

  test('attributes: single key=value', () => {
    const { shapes } = parse('r 0 0 10 10 fill=#ff0000');
    assert.strictEqual(shapes[0].attrs.fill, '#ff0000');
  });

  test('attributes: multiple on one line', () => {
    const { shapes } = parse('r 0 0 10 10 fill=#fff stroke=#000 radius=4');
    assert.deepStrictEqual(shapes[0].attrs, { fill: '#fff', stroke: '#000', radius: '4' });
  });

  test('id + attributes: order-independent', () => {
    const { shapes } = parse('r 0 0 10 10 fill=#fff #label stroke=#000');
    assert.strictEqual(shapes[0].id, 'label');
    assert.strictEqual(shapes[0].attrs.fill, '#fff');
    assert.strictEqual(shapes[0].attrs.stroke, '#000');
  });

  // ── Content ──────────────────────────────────────────

  test('content: after | separator', () => {
    const { shapes } = parse('r 0 0 100 15 | Title of the slide');
    assert.strictEqual(shapes[0].content, 'Title of the slide');
  });

  test('content: attributes before |', () => {
    const { shapes } = parse('r 0 0 100 15 fill=#fff | Title');
    assert.strictEqual(shapes[0].attrs.fill, '#fff');
    assert.strictEqual(shapes[0].content, 'Title');
  });

  test('content: empty content after |', () => {
    const { shapes } = parse('r 0 0 100 15 |');
    assert.strictEqual(shapes[0].content, '');
  });

  test('content: may itself contain = signs without parsing as attribute', () => {
    const { shapes } = parse('r 0 0 100 15 | a = b');
    assert.strictEqual(shapes[0].content, 'a = b');
    assert.deepStrictEqual(shapes[0].attrs, {});
  });

  // ── Multi-shape and whitespace ───────────────────────

  test('parse: multiple shapes on separate lines', () => {
    const src = 'r 0 0 100 15\nc 50 30 10\nl 0 50 100 50';
    const { shapes, errors } = parse(src);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(shapes.length, 3);
    assert.deepStrictEqual(shapes.map(s => s.kind), ['r', 'c', 'l']);
  });

  test('parse: blank lines skipped', () => {
    const { shapes, errors } = parse('\n\nr 0 0 10 10\n\n\nc 50 50 5\n');
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(shapes.length, 2);
  });

  test('parse: // comments ignored', () => {
    const src = '// this is a comment\nr 0 0 10 10\n  // indented comment\nc 50 50 5';
    const { shapes, errors } = parse(src);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(shapes.length, 2);
  });

  test('parse: extra whitespace between tokens tolerated', () => {
    const { shapes, errors } = parse('r    0   0    10    10   #id  fill=#fff');
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(shapes[0].id, 'id');
    assert.strictEqual(shapes[0].attrs.fill, '#fff');
  });

  test('parse: lineNumber tracks source line', () => {
    const src = '\n\nr 0 0 10 10\n\nc 50 50 5';
    const { shapes } = parse(src);
    assert.strictEqual(shapes[0].lineNumber, 3);
    assert.strictEqual(shapes[1].lineNumber, 5);
  });

  // ── Errors ───────────────────────────────────────────

  test('error: unknown shape letter', () => {
    const { shapes, errors } = parse('x 10 20');
    assert.strictEqual(shapes.length, 0);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0].message, /Unknown shape/);
  });

  test('error: too few numeric args', () => {
    const { errors } = parse('r 10 20 30');
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0].message, /needs 4 numeric args/);
  });

  test('error: non-numeric arg', () => {
    const { errors } = parse('r 10 twenty 30 40');
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0].message, /Expected number/);
  });

  test('error: polygon with fewer than 2 points', () => {
    const { errors } = parse('p 10,10');
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0].message, /at least 2 points/);
  });

  test('error: polygon with leading ~', () => {
    const { errors } = parse('p ~ 10,10 20,20');
    assert.match(errors[0].message, /cannot precede the first point/);
  });

  test('error: polygon with trailing ~', () => {
    const { errors } = parse('p 10,10 20,20 ~');
    assert.match(errors[0].message, /trailing ~/);
  });

  test('error: invalid attribute key', () => {
    const { errors } = parse('r 0 0 10 10 9bad=x');
    assert.match(errors[0].message, /invalid attribute key/);
  });

  test('error: unexpected bare token', () => {
    const { errors } = parse('r 0 0 10 10 stray-word');
    assert.match(errors[0].message, /unexpected token/);
  });

  test('error: multiple #id on same line', () => {
    const { errors } = parse('r 0 0 10 10 #a #b');
    assert.match(errors[0].message, /multiple #id/);
  });

  test('error: bad line does not stop subsequent lines', () => {
    const { shapes, errors } = parse('r 10 20 30\nc 50 25 10');
    assert.strictEqual(shapes.length, 1);
    assert.strictEqual(shapes[0].kind, 'c');
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].line, 1);
  });

  // ── Roundtrip ────────────────────────────────────────

  test('roundtrip: parse → serialize → parse stable (simple)', () => {
    const src = 'r 10 20 30 40 #box fill=#fff | Hello';
    const p1 = parse(src);
    const s1 = serialize(p1.shapes);
    const p2 = parse(s1);
    assert.deepStrictEqual(p2.shapes, p1.shapes);
  });

  test('roundtrip: polygon with curves stable', () => {
    const src = 'p 10,10 90,10 ~ 90,50 ~ 50,60 10,50 #blob fill=#eee';
    const p1 = parse(src);
    const s1 = serialize(p1.shapes);
    const p2 = parse(s1);
    assert.deepStrictEqual(p2.shapes, p1.shapes);
  });

  test('roundtrip: multi-shape document stable', () => {
    const src = [
      'r 0 0 100 15 #title fill=#0f172a | # Title',
      'c 50 30 8 fill=#3b82f6',
      'a 10 50 90 50',
      'p 20,60 80,60 ~ 50,80',
    ].join('\n');
    const p1 = parse(src);
    const s1 = serialize(p1.shapes);
    const p2 = parse(s1);
    assert.deepStrictEqual(p2.shapes, p1.shapes);
  });

  // ── Edge cases ───────────────────────────────────────

  test('empty input returns empty result', () => {
    const { shapes, errors } = parse('');
    assert.deepStrictEqual(shapes, []);
    assert.deepStrictEqual(errors, []);
  });

  test('null input returns empty result', () => {
    const { shapes, errors } = parse(null);
    assert.deepStrictEqual(shapes, []);
    assert.deepStrictEqual(errors, []);
  });

  test('content separator only appears once; extra | stays in content', () => {
    const { shapes } = parse('r 0 0 10 10 | first | second');
    assert.strictEqual(shapes[0].content, 'first | second');
  });
};
