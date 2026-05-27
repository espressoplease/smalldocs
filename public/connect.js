// Connect-page logic: copy buttons + the Connect button that actually
// fires the loopback fetch. This is the ONE place the page initiates
// a request to the library agent before the user has consented - and
// it does so only after the user has read the explainer and clicked.

(function () {
  var COPY_FEEDBACK_MS = 1500;
  var COPY_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var CHECK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  function copyOnClick(btn) {
    var targetId = btn.getAttribute('data-copy');
    var target = document.getElementById(targetId);
    if (!target) return;
    var text = target.textContent.trim();
    navigator.clipboard.writeText(text).then(function () {
      btn.innerHTML = CHECK_SVG;
      btn.classList.add('copied');
      setTimeout(function () {
        btn.innerHTML = COPY_SVG;
        btn.classList.remove('copied');
      }, COPY_FEEDBACK_MS);
    }).catch(function(){});
  }

  function wireCopyButtons() {
    var btns = document.querySelectorAll('.copy-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', (function (b) {
        return function () { copyOnClick(b); };
      })(btns[i]));
    }
  }

  function setStatus(msg, kind) {
    var el = document.getElementById('status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'status-msg' + (kind ? ' ' + kind : '');
    el.hidden = false;
  }

  function hideStatus() {
    var el = document.getElementById('status');
    if (el) el.hidden = true;
  }

  // The return URL the user came from, if we were sent here from
  // /library or the editor. Restricted to same-origin paths so a
  // malicious link can't redirect users off-site after connecting.
  function returnTarget() {
    var p = new URLSearchParams(location.search).get('return');
    if (!p) return null;
    if (p.charAt(0) !== '/' || p.charAt(1) === '/') return null;
    return p;
  }

  function tryConnect() {
    var btn = document.getElementById('connect-btn');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    hideStatus();

    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var to = ctrl ? setTimeout(function(){ ctrl.abort(); }, 3000) : null;

    fetch('http://127.0.0.1:47843/api/library/health', ctrl ? { signal: ctrl.signal } : {})
      .then(function (r) {
        if (to) clearTimeout(to);
        if (!r.ok) throw new Error('agent returned ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var version = (data && data.version) || '';
        if (window.SDocsConnect) window.SDocsConnect.markConnected(version);
        btn.classList.add('success');
        btn.textContent = version ? 'Connected ✓ (CLI ' + version + ')' : 'Connected ✓';
        setStatus('Local features are now enabled in this browser.', 'ok');
        document.getElementById('nav-buttons').hidden = false;
        // If we were sent here from somewhere specific, offer to
        // bounce back. The "Open library" button always wins so the
        // user has a direct path to the feature they probably wanted.
        var ret = returnTarget();
        if (ret && ret !== '/library') {
          var nav = document.getElementById('nav-buttons');
          var back = document.createElement('a');
          back.href = ret;
          back.textContent = 'Back to where you were';
          nav.insertBefore(back, nav.firstChild.nextSibling);
        }
      })
      .catch(function (e) {
        if (to) clearTimeout(to);
        btn.disabled = false;
        btn.textContent = 'Connect now';
        var msg;
        if (e && e.name === 'AbortError') {
          msg = 'No response from the library. Is `sdoc library` running in a terminal? Press the button again to retry.';
        } else if (e && /Failed to fetch/.test(String(e))) {
          // Could be: not running, or PNA-blocked by the user clicking
          // Block. Either way the action is the same.
          msg = 'Could not reach the library. Make sure `sdoc library` is running, then press Connect again. If your browser asked for permission, click Allow.';
        } else {
          msg = 'Connect failed: ' + (e && e.message ? e.message : 'unknown error') + '. Press Connect again to retry.';
        }
        setStatus(msg, 'error');
      });
  }

  function init() {
    wireCopyButtons();
    var btn = document.getElementById('connect-btn');
    btn.addEventListener('click', tryConnect);

    // Already connected? Skip the prompt-fire on this visit; just
    // show the "you're good, here are your destinations" state.
    if (window.SDocsConnect && window.SDocsConnect.isConnected()) {
      btn.classList.add('success');
      btn.disabled = true;
      var v = window.SDocsConnect.lastVersion();
      btn.textContent = v ? 'Already connected (CLI ' + v + ')' : 'Already connected';
      setStatus('You can re-press Connect now to refresh.', 'ok');
      btn.disabled = false;
      document.getElementById('nav-buttons').hidden = false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
