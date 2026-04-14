/**
 * Chrome-tint pure helpers — parseRgb + luminance from sdocs-chrome.js
 */
const path = require('path');

module.exports = function (harness) {
  const { assert, test } = harness;
  const H = require(path.join(__dirname, '..', 'public', 'sdocs-chrome'));

  console.log('\n── Chrome tint helpers ──────────────────────────\n');

  test('parseRgb: rgb() with spaces', () => {
    assert.deepStrictEqual(H.parseRgb('rgb(253, 238, 241)'), { r: 253, g: 238, b: 241 });
  });

  test('parseRgb: rgba() with alpha', () => {
    assert.deepStrictEqual(H.parseRgb('rgba(11, 29, 54, 0.9)'), { r: 11, g: 29, b: 54 });
  });

  test('parseRgb: rgb() without internal spaces', () => {
    assert.deepStrictEqual(H.parseRgb('rgb(0,0,0)'), { r: 0, g: 0, b: 0 });
  });

  test('parseRgb: returns null on garbage input', () => {
    assert.strictEqual(H.parseRgb(''), null);
    assert.strictEqual(H.parseRgb('#fff'), null);
    assert.strictEqual(H.parseRgb(null), null);
    assert.strictEqual(H.parseRgb(undefined), null);
  });

  test('luminance: white ≈ 1', () => {
    assert.ok(Math.abs(H.luminance({ r: 255, g: 255, b: 255 }) - 1) < 1e-9);
  });

  test('luminance: black is 0', () => {
    assert.strictEqual(H.luminance({ r: 0, g: 0, b: 0 }), 0);
  });

  test('luminance: dark navy < 0.5 (routes to dark chrome base)', () => {
    // Q4 demo background
    assert.ok(H.luminance({ r: 11, g: 29, b: 54 }) < 0.5);
  });

  test('luminance: pastel pink > 0.5 (routes to light chrome base)', () => {
    // Pink demo background
    assert.ok(H.luminance({ r: 253, g: 238, b: 241 }) > 0.5);
  });

  test('luminance: pastel mint > 0.5', () => {
    // Lisbon demo background
    assert.ok(H.luminance({ r: 232, g: 243, b: 228 }) > 0.5);
  });

  test('luminance: green channel weighted heaviest', () => {
    const red =   H.luminance({ r: 255, g: 0,   b: 0   });
    const green = H.luminance({ r: 0,   g: 255, b: 0   });
    const blue =  H.luminance({ r: 0,   g: 0,   b: 255 });
    assert.ok(green > red, 'green should be brighter than red');
    assert.ok(red > blue, 'red should be brighter than blue');
  });
};
