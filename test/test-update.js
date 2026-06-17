/**
 * Version-refresh decision logic (public/sdocs-update.js).
 *
 * The browser wiring (listeners, banner, reload) is exercised in
 * test/update.spec.js; here we pin the two pure decisions that carry the
 * safety the review demanded: the reload loop-guard and the check gate.
 */
module.exports = function (harness) {
  const { assert, test } = harness;

  console.log('\n── Update / Refresh Tests ─────────────────────\n');

  const U = require('../public/sdocs-update.js');
  const { decideReload, decideCheck } = U;

  const MAX = 3;

  test('decideReload: fresh page never reloaded -> reload', () => {
    assert.strictEqual(decideReload('v1', null, 0, MAX), true);
  });

  test('decideReload: already reloaded for THIS baked version -> blocked (loop-guard)', () => {
    // We reloaded while on v1 and we are still on v1 => /version-check is
    // inconsistent. Must not reload again, or every focus would loop.
    assert.strictEqual(decideReload('v1', 'v1', 1, MAX), false);
  });

  test('decideReload: reloaded for a DIFFERENT (older) version -> allowed (we moved forward)', () => {
    assert.strictEqual(decideReload('v2', 'v1', 1, MAX), true);
  });

  test('decideReload: per-session reload cap blocks further reloads', () => {
    assert.strictEqual(decideReload('v2', 'v1', MAX, MAX), false);
    assert.strictEqual(decideReload('v2', 'v1', MAX + 1, MAX), false);
  });

  test('decideReload: no baked version -> never reload', () => {
    assert.strictEqual(decideReload('', null, 0, MAX), false);
    assert.strictEqual(decideReload(undefined, null, 0, MAX), false);
  });

  const MIN_AWAY = 60000, THROTTLE = 60000;

  test('decideCheck: never hidden -> no check', () => {
    assert.strictEqual(decideCheck(200000, 0, null, MIN_AWAY, THROTTLE), false);
  });

  test('decideCheck: returned after a long gap, throttle clear -> check', () => {
    // hidden at t=100000, now=200000 => away 100s; lastCheck 0 => 200s ago.
    assert.strictEqual(decideCheck(200000, 0, 100000, MIN_AWAY, THROTTLE), true);
  });

  test('decideCheck: only away briefly -> no check (ignores quick tab-flips)', () => {
    // hidden at 170000, now 200000 => away 30s < 60s.
    assert.strictEqual(decideCheck(200000, 0, 170000, MIN_AWAY, THROTTLE), false);
  });

  test('decideCheck: within throttle window of last check -> no check (dedupes double-fire)', () => {
    // away is long enough, but we checked 10s ago.
    assert.strictEqual(decideCheck(200000, 190000, 100000, MIN_AWAY, THROTTLE), false);
  });
};
