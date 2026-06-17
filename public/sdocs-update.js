// sdocs-update.js — version-aware refresh manager.
//
// Background: each served HTML bakes in APP_VERSION (a hash of /public). A
// service worker, when messaged 'check-update', fetches /version-check and on
// a mismatch deletes its cache and posts 'sdocs-reload' back. The page then
// reloads onto the new code. Document state lives in the URL (hash docs) or is
// re-fetched + re-decrypted (short links), so a reload rebuilds the content.
//
// This module adds: (1) re-checking when a backgrounded tab returns to the
// foreground — so mobile tabs, which rarely do a fresh load, still catch a
// deploy; (2) a calm visible note when a refresh happens, on every platform;
// (3) the safety the review surfaced — a loop-guard so an inconsistent
// /version-check can't reload-spin a tab, a time/throttle gate + jitter so a
// return doesn't herd, and "don't reload over an in-progress edit".
//
// The pure decision functions (decideReload / decideCheck) are UMD-exported so
// the loop-guard and gating are unit-tested in Node without a browser; the
// browser wiring is attached only when window/document exist.
(function (exports) {
  'use strict';

  // ── pure decision logic (Node-testable) ──────────────
  // Reload only if there's a real target version, we're not already on it, and
  // we haven't already reloaded once for THIS baked version (the loop-guard:
  // if we reloaded and came back to the same baked version, /version-check is
  // inconsistent — stop, stay on working-but-stale code) and we're under the
  // per-session reload cap.
  function decideReload(appVersion, reloadedFor, reloadCount, maxReloads) {
    if (!appVersion) return false;
    if (reloadedFor === appVersion) return false;
    if (typeof reloadCount === 'number' && reloadCount >= maxReloads) return false;
    return true;
  }

  // Whether to fire a version check on a return-to-foreground. Only if the tab
  // was actually hidden long enough that a deploy could plausibly have landed
  // (minAwayMs), and not within the throttle window of the last check (which
  // also dedupes the pageshow + visibilitychange double-fire on one return).
  function decideCheck(now, lastCheck, hiddenSince, minAwayMs, throttleMs) {
    if (hiddenSince == null) return false;
    if ((now - hiddenSince) < minAwayMs) return false;
    if ((now - lastCheck) < throttleMs) return false;
    return true;
  }

  exports.decideReload = decideReload;
  exports.decideCheck = decideCheck;

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // ── browser wiring ────────────────────────────────────
  var MIN_AWAY_MS = 60000;     // only re-check if hidden at least this long
  var THROTTLE_MS = 60000;     // and not more often than this
  var JITTER_MS = 3000;        // spread checks so a return doesn't herd one host
  var RELOAD_DELAY_MS = 900;   // show the "updating" note this long before reload
  var MAX_RELOADS = 3;         // per-tab-session hard cap (belt-and-braces)
  var TOAST_MS = 3200;

  var K_FOR = 'sdocs_reloaded_for';
  var K_COUNT = 'sdocs_reload_count';
  var K_DONE = 'sdocs_just_updated';
  var K_TARGET = 'sdocs_update_target';

  var appVersion = '', cohort = '';
  var hiddenSince = null, lastCheck = 0, started = false;

  function ss(get, key, val) {
    try {
      if (get) return window.sessionStorage.getItem(key);
      if (val == null) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, val);
    } catch (e) {}
    return null;
  }

  // Reading -> safe to reload. Mid-edit -> don't yank the page; nudge instead.
  // Heuristic without coupling to editor internals: is focus in an editable
  // field (write-mode contentEditable, comment composer, cell edit, any input)?
  function isEditingNow() {
    var a = document.activeElement;
    if (!a) return false;
    if (a.isContentEditable) return true;
    var t = a.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
  }

  // ── banner / toast UI ─────────────────────────────────
  var CSS_ID = 'sdocs-update-css';
  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = [
      '.sdoc-upd {',
      '  position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);',
      '  z-index: 100000; max-width: 90%;',
      '  background: #131210; color: #f5f4f2;',
      '  font: 500 13px/1.4 ui-sans-serif, system-ui, sans-serif;',
      '  padding: 10px 16px; border-radius: 999px;',
      '  border: 1px solid rgba(255,255,255,.14); box-shadow: 0 8px 30px rgba(0,0,0,.32);',
      '  display: inline-flex; align-items: center; gap: 10px;',
      '  opacity: 0; transition: opacity .3s ease; pointer-events: none;',
      '}',
      '.sdoc-upd.sdoc-upd-show { opacity: 1; }',
      '.sdoc-upd-act { pointer-events: auto; cursor: pointer; color: #93c5fd; font-weight: 600; }',
      '@media (prefers-reduced-motion: reduce) { .sdoc-upd { transition: none; } }'
    ].join('\n');
    document.head.appendChild(s);
  }

  var bannerEl = null;
  function clearBanner() {
    if (!bannerEl) return;
    var el = bannerEl; bannerEl = null;
    el.classList.remove('sdoc-upd-show');
    window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 350);
  }
  function showBanner(text, action) {
    injectCSS();
    clearBanner();
    var el = document.createElement('div');
    el.className = 'sdoc-upd';
    el.setAttribute('role', 'status');
    el.textContent = text;
    if (action) {
      var a = document.createElement('span');
      a.className = 'sdoc-upd-act';
      a.textContent = action.label;
      a.addEventListener('click', action.onClick);
      el.appendChild(document.createTextNode(' '));
      el.appendChild(a);
    }
    document.body.appendChild(el);
    bannerEl = el;
    requestAnimationFrame(function () { if (bannerEl === el) el.classList.add('sdoc-upd-show'); });
    return el;
  }
  function showToast(text, ms) {
    var el = showBanner(text);
    window.setTimeout(function () { if (bannerEl === el) clearBanner(); }, ms || TOAST_MS);
  }

  // ── checking ──────────────────────────────────────────
  function activeWorker(cb) {
    if (!('serviceWorker' in navigator)) return;
    var ctrl = navigator.serviceWorker.controller;
    if (ctrl) { cb(ctrl); return; }
    navigator.serviceWorker.ready.then(function (r) { if (r && r.active) cb(r.active); }).catch(function () {});
  }
  function postCheck() {
    lastCheck = Date.now();
    var count = parseInt(ss(true, K_COUNT) || '0', 10) || 0;
    activeWorker(function (w) {
      w.postMessage({ type: 'check-update', version: appVersion, cohort: cohort, r: count });
    });
  }
  function maybeCheck() {
    var now = Date.now();
    if (!decideCheck(now, lastCheck, hiddenSince, MIN_AWAY_MS, THROTTLE_MS)) return;
    // Set lastCheck at SCHEDULE time (not just in postCheck) so a second
    // visibilitychange/pageshow firing during the jitter window is throttled
    // out — closes the double-schedule gap before the delayed postCheck runs.
    lastCheck = now;
    var delay = Math.floor(Math.random() * JITTER_MS);
    window.setTimeout(postCheck, delay);
  }

  // ── reload decision (called from the SW 'sdocs-reload' message) ──
  // The reload count is keyed to the TARGET version we're chasing, not the
  // session: a new target restarts it, so the per-target cap only ever blocks
  // repeated attempts at the same unreachable version — never a later genuine
  // deploy in a long-lived tab.
  function targetCount(serverVersion) {
    return ss(true, K_TARGET) === serverVersion
      ? (parseInt(ss(true, K_COUNT) || '0', 10) || 0)
      : 0;
  }
  function doReload(serverVersion) {
    var count = targetCount(serverVersion) + 1;
    ss(false, K_TARGET, serverVersion);
    ss(false, K_FOR, appVersion);
    ss(false, K_COUNT, String(count));
    ss(false, K_DONE, '1');
    window.location.reload();
  }
  function onReloadSignal(serverVersion) {
    // Ignore a signal that names the version we already run (an edge/rolled-back
    // node briefly reporting our own or an older hash) — the prime spin source.
    if (!serverVersion || serverVersion === appVersion) return;
    var reloadedFor = ss(true, K_FOR);
    if (!decideReload(appVersion, reloadedFor, targetCount(serverVersion), MAX_RELOADS)) return; // loop-guard
    if (isEditingNow()) {
      // Don't reload over an in-progress edit (also covers the patchy-signal
      // short-link case — the user taps when ready / connected).
      showBanner('A new version is available.', { label: 'Refresh', onClick: function () { doReload(serverVersion); } });
      return;
    }
    showBanner('Updating to the latest version…');
    window.setTimeout(function () { doReload(serverVersion); }, RELOAD_DELAY_MS);
  }

  // Shown on the fresh load after we reloaded for an update.
  function showUpdatedConfirmationIfFlagged() {
    if (ss(true, K_DONE) == null) return;
    ss(false, K_DONE, null);
    var reloadedFor = ss(true, K_FOR);
    if (reloadedFor !== appVersion) {
      // We moved forward onto a new version — success. Clear the guard so a
      // later genuine deploy this session can update again.
      ss(false, K_FOR, null);
      ss(false, K_COUNT, null);
      ss(false, K_TARGET, null);
      showToast("You're on the latest version.");
    }
    // else: we reloaded but landed on the same baked version (inconsistent
    // /version-check). Keep the stamp so decideReload blocks further reloads;
    // stay quiet rather than claim an update that didn't happen.
  }

  function start(opts) {
    if (started) return;
    started = true;
    appVersion = (opts && opts.appVersion) || '';
    cohort = (opts && opts.cohort) || '';

    showUpdatedConfirmationIfFlagged();
    postCheck(); // initial check on this load

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { hiddenSince = Date.now(); }
      else if (document.visibilityState === 'visible') { maybeCheck(); }
    });
    // bfcache restore (and other returns). Gated by the same logic so it
    // dedupes with visibilitychange.
    window.addEventListener('pageshow', function () { maybeCheck(); });
  }

  exports.start = start;
  exports.onReloadSignal = onReloadSignal;
  exports.showUpdatedConfirmationIfFlagged = showUpdatedConfirmationIfFlagged;
  exports.isEditingNow = isEditingNow;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocUpdate = {}));
