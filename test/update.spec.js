// @ts-check
//
// Browser wiring for the version-refresh manager (sdocs-update.js). The pure
// decisions are unit-tested in test/test-update.js; here we confirm the parts
// that need a DOM: the post-update confirmation toast, the mid-edit nudge
// (instead of a reload), and that the loop-guard suppresses a repeat reload.
//
// We deliberately never exercise the AUTO-reload path here — it would reload
// the test page out from under the harness. That path (and bfcache) is the
// real-device / manual check called out in the PR.
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

async function ready(page) {
  await page.goto(BASE + '/');
  await page.waitForFunction(() => !!window.SDocUpdate && typeof window.SDocUpdate.onReloadSignal === 'function');
}

test('shows a confirmation toast after a successful update', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    // Simulate: we reloaded for an update (flag set), and we are now on a
    // DIFFERENT baked version than the one we reloaded from -> success.
    sessionStorage.setItem('sdocs_just_updated', '1');
    sessionStorage.setItem('sdocs_reloaded_for', 'some-older-version');
    window.SDocUpdate.showUpdatedConfirmationIfFlagged();
  });
  const toast = page.locator('.sdoc-upd');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(/latest version/i);
  const cleared = await page.evaluate(() => ({
    done: sessionStorage.getItem('sdocs_just_updated'),
    forKey: sessionStorage.getItem('sdocs_reloaded_for'),
  }));
  expect(cleared.done).toBeNull();      // flag consumed
  expect(cleared.forKey).toBeNull();    // guard cleared on confirmed progress
});

test('isEditingNow reflects focus in an editable field', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(() => {
    const ed = document.createElement('div');
    ed.contentEditable = 'true';
    ed.id = '__test_editable';
    document.body.appendChild(ed);
    ed.focus();
    const editing = window.SDocUpdate.isEditingNow();
    ed.blur();
    document.body.focus();
    const notEditing = window.SDocUpdate.isEditingNow();
    ed.remove();
    return { editing, notEditing };
  });
  expect(result.editing).toBe(true);
  expect(result.notEditing).toBe(false);
});

test('a reload signal while editing shows a tap-to-refresh nudge, not an auto-reload', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    sessionStorage.clear(); // clean guard so decideReload would otherwise pass
    const ed = document.createElement('div');
    ed.contentEditable = 'true';
    ed.id = '__test_editable2';
    document.body.appendChild(ed);
    ed.focus();
    window.SDocUpdate.onReloadSignal('a-new-version');
  });
  const nudge = page.locator('.sdoc-upd');
  await expect(nudge).toBeVisible();
  await expect(nudge).toContainText(/new version/i);
  await expect(nudge.locator('.sdoc-upd-act')).toContainText(/refresh/i);
  // No reload was scheduled: sessionStorage has no pending-update flag.
  expect(await page.evaluate(() => sessionStorage.getItem('sdocs_just_updated'))).toBeNull();
});

test('a reload signal naming our own version is ignored (stale/rolled-back node)', async ({ page }) => {
  await ready(page);
  const shown = await page.evaluate(() => {
    sessionStorage.clear();
    document.body.focus();
    window.SDocUpdate.onReloadSignal(window.APP_VERSION); // SW saw the version we already run
    return !!document.querySelector('.sdoc-upd');
  });
  expect(shown).toBe(false);
});

test('loop-guard: already reloaded for this baked version -> ignored', async ({ page }) => {
  await ready(page);
  const shown = await page.evaluate(() => {
    sessionStorage.clear();
    // We reloaded once while on this baked version and are still on it.
    sessionStorage.setItem('sdocs_reloaded_for', window.APP_VERSION);
    document.body.focus(); // not editing — if the guard failed it would auto-reload
    window.SDocUpdate.onReloadSignal('a-different-version');
    return !!document.querySelector('.sdoc-upd');
  });
  expect(shown).toBe(false);
});

test('per-target cap blocks a stuck target but still allows a new deploy', async ({ page }) => {
  await ready(page);
  const r = await page.evaluate(() => {
    sessionStorage.clear();
    // Cap reached chasing target "C"; reloadedFor is some OTHER baked version
    // so the reloadedFor guard does not pre-block.
    sessionStorage.setItem('sdocs_update_target', 'C');
    sessionStorage.setItem('sdocs_reload_count', '3');
    sessionStorage.setItem('sdocs_reloaded_for', 'older-baked');
    // Focus an editable so a passing decision NUDGES (never reloads the harness).
    var ed = document.createElement('div');
    ed.contentEditable = 'true'; document.body.appendChild(ed); ed.focus();

    window.SDocUpdate.onReloadSignal('C');          // same stuck target -> capped
    var blocked = !document.querySelector('.sdoc-upd');

    window.SDocUpdate.onReloadSignal('D');          // a genuinely new target -> allowed
    var allowed = !!document.querySelector('.sdoc-upd');

    ed.remove();
    return { blocked: blocked, allowed: allowed };
  });
  expect(r.blocked).toBe(true);   // counter did not wedge open for the stuck target
  expect(r.allowed).toBe(true);   // ...but a new target is not refused
});
