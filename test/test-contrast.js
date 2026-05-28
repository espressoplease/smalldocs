/**
 * SDocContrast pure-module tests (WCAG maths + palette resolution).
 */
const path = require('path');
const C = require(path.join(__dirname, '..', 'cli', 'shared', 'sdocs-contrast.js'));

module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── SDocContrast Tests ─────────────────────────\n');

  test('contrastRatio: black on white is 21:1', () => {
    assert.ok(Math.abs(C.contrastRatio('#000000', '#ffffff') - 21) < 0.01);
  });

  test('contrastRatio: identical colours are 1:1', () => {
    assert.ok(Math.abs(C.contrastRatio('#3a3a3a', '#3a3a3a') - 1) < 0.001);
  });

  test('contrastRatio: order does not matter', () => {
    assert.strictEqual(C.contrastRatio('#123456', '#abcdef'), C.contrastRatio('#abcdef', '#123456'));
  });

  test('contrastRatio: bad input returns null', () => {
    assert.strictEqual(C.contrastRatio('not-a-colour', '#fff'), null);
  });

  test('grade: single fail line at MIN_CONTRAST (3:1), calibrated to human review', () => {
    assert.strictEqual(C.MIN_CONTRAST, 3.0);
    // ~3.2-4.4 reads fine on screen -> passes (deliberately looser than WCAG AA body).
    assert.strictEqual(C.grade(3.23, false).ok, true);
    assert.strictEqual(C.grade(3.95, false).ok, true);
    assert.strictEqual(C.grade(4.0, true).ok, true);
    // below 3:1 fails for everything.
    assert.strictEqual(C.grade(2.9, false).ok, false);
    assert.strictEqual(C.grade(2.9, true).ok, false);
    // WCAG bands still reported for the curious.
    assert.strictEqual(C.grade(3.5, false).level, 'aa-large');
    assert.strictEqual(C.grade(5.0, false).level, 'aa');
  });

  test('analyzeStyles: the corrupted dark-on-dark doc flags navy heading + link', () => {
    // This is the exact palette that ended up in the user's broken doc:
    // dark page, light body (ok), orange h1/h2 (ok), navy h3/link (fail).
    const styles = {
      background: '#1a120b',
      color: '#dedcd9',
      h1: { color: '#e3864b' },
      h2: { color: '#d2732e' },
      h3: { color: '#111e74' },
      link: { color: '#111e74' }
    };
    const a = C.analyzeStyles(styles);
    assert.strictEqual(a.hasCustomColors, true);
    const lightByLabel = {};
    a.light.forEach(p => { lightByLabel[p.label] = p; });
    assert.strictEqual(lightByLabel['body text'].ok, true, 'light body should pass');
    assert.strictEqual(lightByLabel['h1'].ok, true, 'orange h1 should pass');
    assert.strictEqual(lightByLabel['h3'].ok, false, 'navy h3 on dark page should fail');
    assert.strictEqual(lightByLabel['link'].ok, false, 'navy link on dark page should fail');
    assert.ok(a.fails.length >= 2);
  });

  test('analyzeStyles: the all-default palette passes in both themes', () => {
    const a = C.analyzeStyles({});
    assert.strictEqual(a.fails.length, 0, 'defaults should never fail: ' + JSON.stringify(a.fails));
  });

  test('analyzeStyles: a custom palette with matching dark overrides passes', () => {
    const styles = {
      background: '#ffffff', color: '#1c1a17',
      h1: { color: '#c2540e' }, h3: { color: '#4d65ff' },
      link: { color: '#2563eb' },
      dark: {
        background: '#1a120b', color: '#ece4d8',
        h1: { color: '#f59e3b' }, h3: { color: '#7c8cff' },
        link: { color: '#7c8cff' }
      }
    };
    const a = C.analyzeStyles(styles);
    assert.strictEqual(a.fails.length, 0, 'no failures expected: ' + JSON.stringify(a.fails));
  });

  test('analyzeStyles: a light-only mid-tone accent is flagged when it auto-inverts to an unreadable dark heading', () => {
    // #4d65ff reads fine on a white page, but with no dark override it
    // auto-inverts to a dark navy that fails on the dark background. The
    // checker should catch the dark-theme failure (true positive).
    const styles = { background: '#ffffff', color: '#1c1a17', h3: { color: '#4d65ff' } };
    const a = C.analyzeStyles(styles);
    const darkH3 = a.dark.find(p => p.label === 'h3');
    assert.strictEqual(darkH3.ok, false, 'auto-inverted dark h3 should be flagged');
    const lightH3 = a.light.find(p => p.label === 'h3');
    assert.strictEqual(lightH3.ok, true, 'light h3 on white is fine');
  });

  test('analyzeStyles: dark-mode resolution catches a light heading inverted onto a light page', () => {
    // A doc with default (light) page but a very light custom heading would
    // be unreadable in light mode.
    const styles = { h2: { color: '#fff6e0' } }; // near-white heading on white page
    const a = C.analyzeStyles(styles);
    const lightH2 = a.light.find(p => p.label === 'h2');
    assert.strictEqual(lightH2.ok, false, 'near-white heading on white page should fail');
  });

  test('hasCustomColors: false for a doc with no colour styles', () => {
    assert.strictEqual(C.hasCustomColors({ fontFamily: 'Inter', baseFontSize: 17 }), false);
    assert.strictEqual(C.hasCustomColors({}), false);
    assert.strictEqual(C.hasCustomColors(null), false);
  });

  test('hasCustomColors: true once any colour is set', () => {
    assert.strictEqual(C.hasCustomColors({ background: '#000' }), true);
    assert.strictEqual(C.hasCustomColors({ h3: { color: '#abc' } }), true);
  });
};
