/**
 * Pure pan/zoom transform math (public/sdocs-zoom-math.js).
 *
 * This is the one zoom core the Mermaid focus modal routes wheel, keyboard,
 * toolbar-button and touch-pinch through. The browser wiring (synthetic
 * TouchEvents, no-jump handoff) is covered in test/mermaid-pinch.spec.js;
 * here we pin the arithmetic that's easy to get subtly wrong and impossible
 * to eyeball in CI: the anchor invariant, the scale clamp, the zero-distance
 * guard, and that every entry path agrees.
 */

module.exports = function(harness) {
  const { assert, test } = harness;

  console.log('\n── Zoom Math Tests ────────────────────────────\n');

  const ZM = require('../public/sdocs-zoom-math.js');
  const { clamp, nextTransform, applyPinch } = ZM;

  const MIN = 0.1, MAX = 16;
  const STAGE_W = 800, STAGE_H = 600;

  test('clamp bounds a value', () => {
    assert.strictEqual(clamp(5, 0, 10), 5);
    assert.strictEqual(clamp(-1, 0, 10), 0);
    assert.strictEqual(clamp(99, 0, 10), 10);
  });

  test('nextTransform: zoom factor multiplies scale', () => {
    const s = nextTransform({ tx: 0, ty: 0, scale: 1 }, STAGE_W, STAGE_H, 400, 300, 2, MIN, MAX);
    assert.strictEqual(s.scale, 2);
  });

  test('nextTransform: scale is clamped to MAX', () => {
    const s = nextTransform({ tx: 0, ty: 0, scale: 10 }, STAGE_W, STAGE_H, 400, 300, 100, MIN, MAX);
    assert.strictEqual(s.scale, MAX);
  });

  test('nextTransform: scale is clamped to MIN', () => {
    const s = nextTransform({ tx: 0, ty: 0, scale: 0.2 }, STAGE_W, STAGE_H, 400, 300, 0.001, MIN, MAX);
    assert.strictEqual(s.scale, MIN);
  });

  test('nextTransform: zooming at the stage centre keeps it centred', () => {
    // Anchor == wrap centre (400,300 with tx=ty=0) => no translation needed.
    const s = nextTransform({ tx: 0, ty: 0, scale: 1 }, STAGE_W, STAGE_H, 400, 300, 3, MIN, MAX);
    assert.ok(Math.abs(s.tx) < 1e-9, 'tx ~ 0, got ' + s.tx);
    assert.ok(Math.abs(s.ty) < 1e-9, 'ty ~ 0, got ' + s.ty);
  });

  // The core map-pinch invariant: the document point under the anchor before
  // the zoom is under the anchor after the zoom.
  test('nextTransform: anchor point stays fixed under the cursor', () => {
    const before = { tx: 37, ty: -12, scale: 1.4 };
    const ax = 250, ay = 180;
    const after = nextTransform(before, STAGE_W, STAGE_H, ax, ay, 1.8, MIN, MAX);

    // doc offset of the anchor from the wrap centre, before:
    const cxB = STAGE_W / 2 + before.tx;
    const cyB = STAGE_H / 2 + before.ty;
    const docX = (ax - cxB) / before.scale;
    const docY = (ay - cyB) / before.scale;
    // re-project with the post-zoom transform:
    const cxA = STAGE_W / 2 + after.tx;
    const cyA = STAGE_H / 2 + after.ty;
    const projX = cxA + docX * after.scale;
    const projY = cyA + docY * after.scale;

    assert.ok(Math.abs(projX - ax) < 1e-6, 'anchor x drifted: ' + projX + ' vs ' + ax);
    assert.ok(Math.abs(projY - ay) < 1e-6, 'anchor y drifted: ' + projY + ' vs ' + ay);
  });

  test('nextTransform: every entry path agrees on the same scale', () => {
    // A pinch that doubles spread, two `+` presses of 1.25, and a wheel factor
    // must all land on the same transform when fed the same factor product.
    // Here: assert repeated factor calls compose like a single combined factor.
    const start = { tx: 10, ty: 20, scale: 1 };
    const anchor = [300, 250];
    const stepwise = nextTransform(
      nextTransform(start, STAGE_W, STAGE_H, anchor[0], anchor[1], 1.25, MIN, MAX),
      STAGE_W, STAGE_H, anchor[0], anchor[1], 1.25, MIN, MAX);
    const combined = nextTransform(start, STAGE_W, STAGE_H, anchor[0], anchor[1], 1.25 * 1.25, MIN, MAX);
    assert.ok(Math.abs(stepwise.scale - combined.scale) < 1e-9, 'scale mismatch');
    assert.ok(Math.abs(stepwise.tx - combined.tx) < 1e-6, 'tx mismatch: ' + stepwise.tx + ' vs ' + combined.tx);
    assert.ok(Math.abs(stepwise.ty - combined.ty) < 1e-6, 'ty mismatch');
  });

  test('applyPinch: spreading fingers zooms in, pinching zooms out', () => {
    const state = { tx: 0, ty: 0, scale: 1 };
    const mid = { mx: 400, my: 300 };
    const out = applyPinch(state, STAGE_W, STAGE_H,
      Object.assign({ dist: 100 }, mid), Object.assign({ dist: 200 }, mid), MIN, MAX);
    assert.ok(out.scale > 1, 'spread should zoom in, got ' + out.scale);
    const inn = applyPinch(state, STAGE_W, STAGE_H,
      Object.assign({ dist: 200 }, mid), Object.assign({ dist: 100 }, mid), MIN, MAX);
    assert.ok(inn.scale < 1, 'pinch should zoom out, got ' + inn.scale);
  });

  test('applyPinch: zero / near-zero previous spread does not blow up (no NaN/Infinity)', () => {
    const state = { tx: 0, ty: 0, scale: 1 };
    const out = applyPinch(state, STAGE_W, STAGE_H,
      { mx: 400, my: 300, dist: 0 }, { mx: 400, my: 300, dist: 120 }, MIN, MAX);
    assert.ok(Number.isFinite(out.scale), 'scale finite');
    assert.ok(Number.isFinite(out.tx) && Number.isFinite(out.ty), 'translate finite');
    // dist <= 1 is treated as "no zoom this frame" => scale unchanged.
    assert.strictEqual(out.scale, 1);
  });

  test('applyPinch: a moving midpoint pans by the midpoint travel', () => {
    const state = { tx: 0, ty: 0, scale: 1 };
    // Same spread (no zoom), midpoint slides right 50 / down 30.
    const out = applyPinch(state, STAGE_W, STAGE_H,
      { mx: 400, my: 300, dist: 150 }, { mx: 450, my: 330, dist: 150 }, MIN, MAX);
    assert.ok(Math.abs(out.scale - 1) < 1e-9, 'scale unchanged on equal spread');
    assert.ok(Math.abs(out.tx - 50) < 1e-6, 'tx should follow midpoint +50, got ' + out.tx);
    assert.ok(Math.abs(out.ty - 30) < 1e-6, 'ty should follow midpoint +30, got ' + out.ty);
  });

  test('applyPinch: pinch keeps the midpoint anchored while zooming', () => {
    // Pure zoom (midpoint fixed): the doc point under the midpoint stays put.
    const before = { tx: 15, ty: -8, scale: 1.2 };
    const mx = 500, my = 220;
    const after = applyPinch(before, STAGE_W, STAGE_H,
      { mx: mx, my: my, dist: 120 }, { mx: mx, my: my, dist: 240 }, MIN, MAX);
    const cxB = STAGE_W / 2 + before.tx, cyB = STAGE_H / 2 + before.ty;
    const docX = (mx - cxB) / before.scale, docY = (my - cyB) / before.scale;
    const cxA = STAGE_W / 2 + after.tx, cyA = STAGE_H / 2 + after.ty;
    const projX = cxA + docX * after.scale, projY = cyA + docY * after.scale;
    assert.ok(Math.abs(projX - mx) < 1e-6, 'midpoint x drifted');
    assert.ok(Math.abs(projY - my) < 1e-6, 'midpoint y drifted');
    assert.ok(after.scale > before.scale, 'should have zoomed in');
  });
};
