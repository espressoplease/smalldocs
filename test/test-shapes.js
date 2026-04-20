/**
 * Shape DSL parser tests
 * Uses shared sdocs-shapes.js module
 */
const path = require('path');
const SDocShapes = require(path.join(__dirname, '..', 'public', 'sdocs-shapes.js'));

module.exports = function(harness) {
  const { assert, test } = harness;
  const { parse, resolve, parseAndResolve, anchorPoint, bboxOf, contentBox, serialize } = SDocShapes;

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

  // ── Phase 2: references ──────────────────────────────

  test('ref parse: arrow endpoints as @id', () => {
    const { shapes, errors } = parse('r 10 10 30 20 #a\nr 60 10 30 20 #b\na @a @b');
    assert.strictEqual(errors.length, 0);
    const arrow = shapes[2];
    assert.strictEqual(arrow.kind, 'a');
    assert.strictEqual(arrow.x1, null);
    assert.strictEqual(arrow.y1, null);
    assert.strictEqual(arrow.x2, null);
    assert.strictEqual(arrow.y2, null);
    assert.deepStrictEqual(arrow.refs.from, { id: 'a', anchor: 'center' });
    assert.deepStrictEqual(arrow.refs.to,   { id: 'b', anchor: 'center' });
  });

  test('ref parse: mix ref and numeric endpoints', () => {
    const { shapes, errors } = parse('r 0 0 20 20 #a\nl @a.right 90 50');
    assert.strictEqual(errors.length, 0);
    const line = shapes[1];
    assert.strictEqual(line.refs.from.anchor, 'right');
    assert.strictEqual(line.x2, 90);
    assert.strictEqual(line.y2, 50);
    assert.strictEqual(line.refs.to, undefined);
  });

  test('ref parse: anchor variants', () => {
    const anchors = ['center', 'top', 'bottom', 'left', 'right',
                     'topleft', 'topright', 'bottomleft', 'bottomright'];
    for (const anc of anchors) {
      const { shapes, errors } = parse('r 0 0 10 10 #t\na @t.' + anc + ' 90 90');
      assert.strictEqual(errors.length, 0, 'anchor "' + anc + '" failed to parse');
      assert.strictEqual(shapes[1].refs.from.anchor, anc);
    }
  });

  test('ref parse: circle center as ref', () => {
    const { shapes, errors } = parse('r 20 20 40 40 #box\nc @box.center 5');
    assert.strictEqual(errors.length, 0);
    assert.deepStrictEqual(shapes[1].refs.center, { id: 'box', anchor: 'center' });
    assert.strictEqual(shapes[1].r, 5);
  });

  test('ref parse: ellipse center as ref', () => {
    const { shapes, errors } = parse('r 0 0 100 50 #stage\ne @stage 10 5');
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(shapes[1].refs.center.id, 'stage');
    assert.strictEqual(shapes[1].rx, 10);
    assert.strictEqual(shapes[1].ry, 5);
  });

  test('ref parse: polygon points accept @ref', () => {
    const { shapes, errors } = parse('r 0 0 20 20 #a\nr 60 60 20 20 #b\np @a @b 50,50');
    assert.strictEqual(errors.length, 0);
    const poly = shapes[2];
    assert.strictEqual(poly.points.length, 3);
    assert.deepStrictEqual(poly.points[0].ref, { id: 'a', anchor: 'center' });
    assert.deepStrictEqual(poly.points[1].ref, { id: 'b', anchor: 'center' });
    assert.strictEqual(poly.points[2].x, 50);
    assert.strictEqual(poly.points[2].y, 50);
  });

  test('ref parse: polygon @ref after ~', () => {
    const { shapes, errors } = parse('r 0 0 20 20 #a\np 10,10 ~ @a 90,90');
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(shapes[1].points[1].curve, true);
    assert.ok(shapes[1].points[1].ref);
  });

  // ── Phase 2: bbox + anchor math ──────────────────────

  test('bboxOf: rectangle', () => {
    const b = bboxOf({ kind: 'r', x: 10, y: 20, w: 30, h: 40 });
    assert.deepStrictEqual(b, { x: 10, y: 20, w: 30, h: 40 });
  });

  test('bboxOf: circle', () => {
    const b = bboxOf({ kind: 'c', cx: 50, cy: 50, r: 10 });
    assert.deepStrictEqual(b, { x: 40, y: 40, w: 20, h: 20 });
  });

  test('bboxOf: ellipse', () => {
    const b = bboxOf({ kind: 'e', cx: 50, cy: 25, rx: 20, ry: 10 });
    assert.deepStrictEqual(b, { x: 30, y: 15, w: 40, h: 20 });
  });

  test('bboxOf: line', () => {
    const b = bboxOf({ kind: 'l', x1: 10, y1: 50, x2: 90, y2: 10 });
    assert.deepStrictEqual(b, { x: 10, y: 10, w: 80, h: 40 });
  });

  test('bboxOf: polygon', () => {
    const b = bboxOf({ kind: 'p', points: [
      { x: 10, y: 20 }, { x: 90, y: 30 }, { x: 50, y: 80 },
    ]});
    assert.deepStrictEqual(b, { x: 10, y: 20, w: 80, h: 60 });
  });

  test('anchorPoint: all anchors on a centred rect', () => {
    const r = { kind: 'r', x: 0, y: 0, w: 100, h: 50 };
    assert.deepStrictEqual(anchorPoint(r, 'center'),      { x: 50, y: 25 });
    assert.deepStrictEqual(anchorPoint(r, 'top'),         { x: 50, y: 0  });
    assert.deepStrictEqual(anchorPoint(r, 'bottom'),      { x: 50, y: 50 });
    assert.deepStrictEqual(anchorPoint(r, 'left'),        { x: 0,  y: 25 });
    assert.deepStrictEqual(anchorPoint(r, 'right'),       { x: 100, y: 25 });
    assert.deepStrictEqual(anchorPoint(r, 'topleft'),     { x: 0,  y: 0  });
    assert.deepStrictEqual(anchorPoint(r, 'topright'),    { x: 100, y: 0 });
    assert.deepStrictEqual(anchorPoint(r, 'bottomleft'),  { x: 0,  y: 50 });
    assert.deepStrictEqual(anchorPoint(r, 'bottomright'), { x: 100, y: 50 });
  });

  test('anchorPoint: unknown anchor throws', () => {
    assert.throws(() => anchorPoint({ kind: 'r', x: 0, y: 0, w: 10, h: 10 }, 'diagonal'));
  });

  // ── Phase 2: resolve() ───────────────────────────────

  test('resolve: arrow between two rects uses centers', () => {
    const { shapes } = parse([
      'r 0 0 20 20 #a',
      'r 80 60 20 20 #b',
      'a @a @b',
    ].join('\n'));
    const res = resolve(shapes);
    assert.strictEqual(res.errors.length, 0);
    const arrow = shapes[2];
    assert.strictEqual(arrow.x1, 10);
    assert.strictEqual(arrow.y1, 10);
    assert.strictEqual(arrow.x2, 90);
    assert.strictEqual(arrow.y2, 70);
  });

  test('resolve: specific anchors (right edge → left edge)', () => {
    const { shapes } = parse([
      'r 10 20 20 20 #a',
      'r 60 20 20 20 #b',
      'a @a.right @b.left',
    ].join('\n'));
    resolve(shapes);
    const arrow = shapes[2];
    assert.strictEqual(arrow.x1, 30); // right of a = x+w = 30
    assert.strictEqual(arrow.y1, 30); // y+h/2 = 30
    assert.strictEqual(arrow.x2, 60); // left of b = x = 60
    assert.strictEqual(arrow.y2, 30);
  });

  test('resolve: circle at ref center', () => {
    const { shapes } = parse([
      'r 40 20 20 20 #box',
      'c @box 3',
    ].join('\n'));
    resolve(shapes);
    assert.strictEqual(shapes[1].cx, 50);
    assert.strictEqual(shapes[1].cy, 30);
  });

  test('resolve: polygon point resolves to ref', () => {
    const { shapes } = parse([
      'r 0 0 10 10 #a',
      'p @a 50,50 90,50',
    ].join('\n'));
    resolve(shapes);
    const p = shapes[1];
    assert.strictEqual(p.points[0].x, 5);
    assert.strictEqual(p.points[0].y, 5);
    assert.strictEqual(p.points[1].x, 50);
  });

  test('resolve: chain — shape B refs A, shape C refs B', () => {
    const { shapes } = parse([
      'r 10 10 20 20 #a',
      'c @a 10 #b',
      'a @b @a.topright',
    ].join('\n'));
    const res = resolve(shapes);
    assert.strictEqual(res.errors.length, 0);
    // b center = a center = (20, 20); b bbox = (10,10,20,20) so b center = 20,20
    assert.strictEqual(shapes[1].cx, 20);
    assert.strictEqual(shapes[1].cy, 20);
    // arrow from b center to a topright (30, 10)
    assert.strictEqual(shapes[2].x1, 20);
    assert.strictEqual(shapes[2].y1, 20);
    assert.strictEqual(shapes[2].x2, 30);
    assert.strictEqual(shapes[2].y2, 10);
  });

  test('resolve: unknown id reports error', () => {
    const { shapes } = parse('a @ghost 50 50');
    const res = resolve(shapes);
    assert.strictEqual(res.errors.length, 1);
    assert.match(res.errors[0].message, /unknown id/);
  });

  test('resolve: cycle between two shapes reports error', () => {
    const { shapes } = parse([
      'c @b 5 #a',
      'c @a 5 #b',
    ].join('\n'));
    const res = resolve(shapes);
    assert.ok(res.errors.length >= 1);
    assert.ok(res.errors.some(e => /cycle/.test(e.message)));
  });

  test('resolve: duplicate id reports error', () => {
    const { shapes } = parse([
      'r 0 0 10 10 #a',
      'r 20 20 10 10 #a',
    ].join('\n'));
    const res = resolve(shapes);
    assert.ok(res.errors.some(e => /duplicate id/.test(e.message)));
  });

  test('resolve: unknown anchor reports error', () => {
    const { shapes } = parse([
      'r 0 0 10 10 #a',
      'a @a.diagonal 50 50',
    ].join('\n'));
    const res = resolve(shapes);
    assert.ok(res.errors.some(e => /unknown anchor/.test(e.message)));
  });

  test('resolve: shapes without refs are untouched', () => {
    const { shapes } = parse('r 10 20 30 40\nc 50 50 5');
    const before = JSON.stringify(shapes);
    resolve(shapes);
    assert.strictEqual(JSON.stringify(shapes), before);
  });

  test('resolve: parseAndResolve convenience', () => {
    const res = parseAndResolve([
      'r 0 0 20 20 #a',
      'a @a 80 80',
    ].join('\n'));
    assert.strictEqual(res.errors.length, 0);
    assert.strictEqual(res.shapes[1].x1, 10);
    assert.strictEqual(res.shapes[1].y1, 10);
  });

  // ── Phase 2: serialization preserves refs ────────────

  test('roundtrip: arrow with refs is stable', () => {
    const src = 'r 0 0 20 20 #a\nr 80 0 20 20 #b\na @a.right @b.left';
    const p1 = parse(src);
    const s1 = serialize(p1.shapes);
    const p2 = parse(s1);
    assert.deepStrictEqual(p2.shapes, p1.shapes);
  });

  test('roundtrip: circle with ref center and ref polygon point', () => {
    const src = 'r 0 0 20 20 #a\nc @a 5\np @a 50,50 90,10';
    const p1 = parse(src);
    const s1 = serialize(p1.shapes);
    const p2 = parse(s1);
    assert.deepStrictEqual(p2.shapes, p1.shapes);
  });

  test('roundtrip: default .center anchor drops suffix', () => {
    const src = 'r 0 0 20 20 #a\na @a 90 90';
    const p1 = parse(src);
    const s1 = serialize(p1.shapes);
    assert.ok(s1.includes('@a '), 's1 should keep bare @a: ' + s1);
    assert.ok(!s1.includes('@a.center'), 's1 should drop .center: ' + s1);
  });

  // ── grid statement ───────────────────────────────────

  test('grid: default when absent is 100 × 56.25', () => {
    const { grid } = parse('r 0 0 10 10');
    assert.deepStrictEqual(grid, { w: 100, h: 56.25 });
  });

  test('grid: empty input also returns default grid', () => {
    const { grid } = parse('');
    assert.deepStrictEqual(grid, { w: 100, h: 56.25 });
  });

  test('grid: parsed as first line', () => {
    const { grid, errors } = parse('grid 160 90\nr 0 0 10 10');
    assert.strictEqual(errors.length, 0);
    assert.deepStrictEqual(grid, { w: 160, h: 90 });
  });

  test('grid: allowed after blank lines and comments', () => {
    const { grid, errors } = parse('\n// header\n\ngrid 200 100\nr 0 0 10 10');
    assert.strictEqual(errors.length, 0);
    assert.deepStrictEqual(grid, { w: 200, h: 100 });
  });

  test('grid: floating-point dims', () => {
    const { grid } = parse('grid 100 56.25');
    assert.deepStrictEqual(grid, { w: 100, h: 56.25 });
  });

  test('grid: error when declared after a shape', () => {
    const { grid, errors } = parse('r 0 0 10 10\ngrid 160 90');
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0].message, /before any shapes/);
    assert.deepStrictEqual(grid, { w: 100, h: 56.25 });
  });

  test('grid: error when declared twice', () => {
    const { grid, errors } = parse('grid 160 90\ngrid 200 100');
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0].message, /more than once/);
    // First grid wins
    assert.deepStrictEqual(grid, { w: 160, h: 90 });
  });

  test('grid: error on missing H', () => {
    const { errors } = parse('grid 160');
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0].message, /expected "grid W H"/);
  });

  test('grid: error on extra tokens', () => {
    const { errors } = parse('grid 160 90 extra');
    assert.match(errors[0].message, /expected "grid W H"/);
  });

  test('grid: error on non-numeric', () => {
    const { errors } = parse('grid abc 90');
    assert.match(errors[0].message, /Expected number/);
  });

  test('grid: error on non-positive dims', () => {
    const { errors } = parse('grid 100 0');
    assert.match(errors[0].message, /positive/);
  });

  test('grid: shape coords in big grid work unchanged', () => {
    const { shapes, grid } = parse('grid 400 225\nr 100 50 200 125');
    assert.deepStrictEqual(grid, { w: 400, h: 225 });
    assert.strictEqual(shapes[0].x, 100);
    assert.strictEqual(shapes[0].w, 200);
  });

  test('grid: roundtrip via serialize preserves non-default grid', () => {
    const src = 'grid 160 90\nr 10 10 30 30';
    const p1 = parse(src);
    const s1 = serialize(p1.shapes, p1.grid);
    assert.ok(s1.startsWith('grid 160 90'));
    const p2 = parse(s1);
    assert.deepStrictEqual(p2.grid, p1.grid);
    assert.deepStrictEqual(p2.shapes, p1.shapes);
  });

  test('grid: default grid omitted from serialized output', () => {
    const { shapes, grid } = parse('r 0 0 10 10');
    const s = serialize(shapes, grid);
    assert.ok(!s.includes('grid'), 'default grid should not appear in output');
  });

  // ── contentBox: text area for each shape kind ────────

  test('contentBox: rectangle returns full rect', () => {
    const b = contentBox({ kind: 'r', x: 10, y: 20, w: 30, h: 40 });
    assert.deepStrictEqual(b, { x: 10, y: 20, w: 30, h: 40 });
  });

  test('contentBox: circle returns inscribed square (side = r * √2)', () => {
    const b = contentBox({ kind: 'c', cx: 50, cy: 50, r: 10 });
    const side = 10 * Math.SQRT2;
    assert.ok(Math.abs(b.w - side) < 1e-9);
    assert.ok(Math.abs(b.h - side) < 1e-9);
    assert.ok(Math.abs(b.x - (50 - side / 2)) < 1e-9);
    assert.ok(Math.abs(b.y - (50 - side / 2)) < 1e-9);
  });

  test('contentBox: ellipse returns inscribed rectangle', () => {
    const b = contentBox({ kind: 'e', cx: 50, cy: 25, rx: 20, ry: 10 });
    const w = 20 * Math.SQRT2, h = 10 * Math.SQRT2;
    assert.ok(Math.abs(b.w - w) < 1e-9);
    assert.ok(Math.abs(b.h - h) < 1e-9);
  });

  test('contentBox: polygon returns its bounding box', () => {
    const b = contentBox({ kind: 'p', points: [
      { x: 10, y: 10 }, { x: 90, y: 20 }, { x: 50, y: 80 },
    ]});
    assert.deepStrictEqual(b, { x: 10, y: 10, w: 80, h: 70 });
  });

  test('contentBox: line returns null (decorative)', () => {
    assert.strictEqual(contentBox({ kind: 'l', x1: 0, y1: 0, x2: 10, y2: 10 }), null);
  });

  test('contentBox: arrow returns null (decorative)', () => {
    assert.strictEqual(contentBox({ kind: 'a', x1: 0, y1: 0, x2: 10, y2: 10 }), null);
  });

  // ── multi-line content (indented continuation) ───────

  test('multi-line: indented lines after | become content', () => {
    const src = [
      'r 0 0 80 60 |',
      '  Line one',
      '  Line two',
    ].join('\n');
    const { shapes, errors } = parse(src);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(shapes[0].content, 'Line one\nLine two');
  });

  test('multi-line: same-line text + indented continuation combine', () => {
    const src = [
      'r 0 0 80 60 | Title',
      '  Subtitle',
      '  Third line',
    ].join('\n');
    const { shapes } = parse(src);
    assert.strictEqual(shapes[0].content, 'Title\nSubtitle\nThird line');
  });

  test('multi-line: strips leading 2-space indent only', () => {
    const src = [
      'r 0 0 80 60 |',
      '  - Bullet',
      '    - Nested',
    ].join('\n');
    const { shapes } = parse(src);
    assert.strictEqual(shapes[0].content, '- Bullet\n  - Nested');
  });

  test('multi-line: blank lines inside a block are preserved', () => {
    const src = [
      'r 0 0 80 60 |',
      '  paragraph one',
      '',
      '  paragraph two',
    ].join('\n');
    const { shapes } = parse(src);
    assert.strictEqual(shapes[0].content, 'paragraph one\n\nparagraph two');
  });

  test('multi-line: block ends at first dedented line', () => {
    const src = [
      'r 0 0 80 60 |',
      '  content A',
      'r 10 10 20 20',
    ].join('\n');
    const { shapes } = parse(src);
    assert.strictEqual(shapes.length, 2);
    assert.strictEqual(shapes[0].content, 'content A');
    assert.strictEqual(shapes[1].kind, 'r');
  });

  test('multi-line: no content collected when shape had no | separator', () => {
    const src = [
      'r 0 0 80 60',
      '  orphan line',
    ].join('\n');
    const { shapes, errors } = parse(src);
    // First shape has no content (no |).
    assert.strictEqual(shapes[0].content, null);
    // The orphan indented line should surface as an error.
    assert.ok(errors.some(e => /unexpected indented/.test(e.message)));
  });
};
