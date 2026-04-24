// sdocs-info.js - info panel: feed render, unseen dot, feedback form
(function () {
'use strict';

var S = window.SDocs = window.SDocs || {};

var SEEN_KEY = 'sdocs_notifications_seen_id';
var ENABLED_KEY = 'sdocs_notifications_enabled';
var FEED_URL = '/public/notifications.json';

var feed = [];
var maxId = 0;

function readSeen() {
  try {
    var v = parseInt(localStorage.getItem(SEEN_KEY) || '0', 10);
    return isNaN(v) ? 0 : v;
  } catch (_) { return 0; }
}

function writeSeen(id) {
  try { localStorage.setItem(SEEN_KEY, String(id)); } catch (_) {}
}

function isEnabled() {
  try {
    var v = localStorage.getItem(ENABLED_KEY);
    return v === null ? true : v === '1';
  } catch (_) { return true; }
}

function setEnabled(on) {
  try { localStorage.setItem(ENABLED_KEY, on ? '1' : '0'); } catch (_) {}
}

function relativeDate(iso) {
  // iso is "YYYY-MM-DD"; compute whole-day difference from today (local).
  var parts = iso.split('-');
  if (parts.length !== 3) return iso;
  var then = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var days = Math.round((today - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return days + ' days ago';
  if (days < 14) return '1 week ago';
  if (days < 60) return Math.floor(days / 7) + ' weeks ago';
  if (days < 365) return Math.floor(days / 30) + ' months ago';
  return iso;
}

function renderFeatures(seenAtRender) {
  var list = document.getElementById('_sd_info-features');
  if (!list) return;
  list.innerHTML = '';
  if (!feed.length) {
    var empty = document.createElement('li');
    empty.className = 'info-feature-empty';
    empty.textContent = 'No updates yet.';
    list.appendChild(empty);
    return;
  }
  // Newest first by id
  var sorted = feed.slice().sort(function (a, b) { return b.id - a.id; });
  sorted.forEach(function (item) {
    var li = document.createElement('li');
    li.className = 'info-feature-item';
    if (item.id > seenAtRender) {
      li.classList.add('is-new');
      var marker = document.createElement('span');
      marker.className = 'info-feature-new';
      marker.title = 'New since your last visit';
      marker.setAttribute('aria-label', 'New');
      li.appendChild(marker);
    }

    var title = document.createElement('div');
    title.className = 'info-feature-title';
    title.textContent = item.title || '';
    li.appendChild(title);

    var meta = document.createElement('div');
    meta.className = 'info-feature-meta';
    if (item.date) {
      var d = document.createElement('span');
      d.className = 'info-feature-date';
      d.title = item.date;
      d.textContent = relativeDate(item.date);
      meta.appendChild(d);
    }
    if (item.link) {
      var a = document.createElement('a');
      a.href = item.link;
      a.target = '_blank';
      a.rel = 'noopener';
      a.className = 'info-feature-link';
      a.textContent = 'Open';
      meta.appendChild(a);
    }
    li.appendChild(meta);

    if (item.body) {
      var body = document.createElement('div');
      body.className = 'info-feature-body';
      body.textContent = item.body;
      li.appendChild(body);
    }

    list.appendChild(li);
  });
}

function refreshDot() {
  var btn = document.getElementById('_sd_btn-info');
  if (!btn) return;
  var seen = readSeen();
  btn.classList.toggle('has-unseen', isEnabled() && maxId > seen);
}

function wireNotifyToggle() {
  var onBtn = document.getElementById('_sd_info-notify-on');
  var offBtn = document.getElementById('_sd_info-notify-off');
  if (!onBtn || !offBtn) return;

  function paint(on) {
    onBtn.classList.toggle('active', on);
    offBtn.classList.toggle('active', !on);
    onBtn.setAttribute('aria-checked', on ? 'true' : 'false');
    offBtn.setAttribute('aria-checked', on ? 'false' : 'true');
  }

  paint(isEnabled());

  onBtn.addEventListener('click', function () {
    setEnabled(true);
    paint(true);
    refreshDot();
  });
  offBtn.addEventListener('click', function () {
    setEnabled(false);
    paint(false);
    refreshDot();
  });
}

function markSeen() {
  if (maxId > 0) writeSeen(maxId);
  refreshDot();
}

function loadFeed() {
  return fetch(FEED_URL, { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : []; })
    .catch(function () { return []; })
    .then(function (items) {
      feed = Array.isArray(items) ? items : [];
      maxId = feed.reduce(function (m, it) {
        var id = parseInt(it && it.id, 10);
        return isNaN(id) ? m : Math.max(m, id);
      }, 0);
      // Snapshot before markSeen() could run — per-item "new" markers
      // reflect the state as of page load, not post-click.
      var seenAtRender = readSeen();
      renderFeatures(seenAtRender);
      refreshDot();
      // Covers the race where the user clicked the info button before the
      // feed finished loading: markSeen() earlier was a no-op (maxId was 0),
      // so persist now that we know maxId.
      if (document.body.classList.contains('info-mode')) {
        markSeen();
      }
    });
}

// Feedback form wiring
var EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

function wireFeedback() {
  var btn = document.getElementById('_sd_info-feedback-send');
  var ta = document.getElementById('_sd_info-feedback');
  var statusEl = document.getElementById('_sd_info-feedback-status');
  var warnEl = document.getElementById('_sd_info-feedback-warning');
  if (!btn || !ta || !statusEl) return;

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = 'info-feedback-status' + (kind ? ' info-feedback-' + kind : '');
  }

  var warnTimer = null;
  ta.addEventListener('input', function () {
    if (!warnEl) return;
    clearTimeout(warnTimer);
    warnTimer = setTimeout(function () {
      warnEl.hidden = !EMAIL_RE.test(ta.value);
    }, 150);
  });

  btn.addEventListener('click', function () {
    var msg = (ta.value || '').trim();
    if (!msg) { setStatus('Type a message first.', 'warn'); return; }
    if (msg.length > 4096) { setStatus('Message too long (max 4 KB).', 'warn'); return; }

    btn.disabled = true;
    setStatus('Sending...', '');

    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
    }).then(function (r) {
      if (r.ok) {
        ta.value = '';
        setStatus('Thanks. Got it.', 'ok');
      } else if (r.status === 429) {
        setStatus('Too many submissions. Try again later.', 'warn');
      } else if (r.status === 413) {
        setStatus('Message too long.', 'warn');
      } else {
        setStatus('Could not send. Try again.', 'warn');
      }
    }).catch(function () {
      setStatus('Network error. Try again.', 'warn');
    }).finally(function () {
      btn.disabled = false;
    });
  });
}

S.refreshInfoDot = refreshDot;
S.markInfoSeen = markSeen;

function init() {
  wireNotifyToggle();
  wireFeedback();
  loadFeed();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
