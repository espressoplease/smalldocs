(function () {
  'use strict';
  var status = document.getElementById('feedback-inbox-status');
  var messages = document.getElementById('feedback-messages');
  var refresh = document.getElementById('feedback-refresh');
  var previous = document.getElementById('feedback-previous');
  var next = document.getElementById('feedback-next');
  var cursors = [null], pageIndex = 0, nextCursor = null, loading = false, generation = 0, controller = null;
  function node(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }
  async function load(index, reset) {
    if (loading) return;
    loading = true; previous.disabled = next.disabled = refresh.disabled = true;
    var requestGeneration = ++generation; controller = new AbortController();
    messages.replaceChildren();
    status.textContent = 'Loading feedback...';
    try {
      var after = reset ? null : cursors[index];
      var response = await fetch('/api/cloud/v1/feedback/inbox' + (after ? '?after=' + encodeURIComponent(after) : ''), { credentials: 'same-origin', signal: controller.signal });
      if (requestGeneration !== generation) return;
      if (response.status === 401) { location.assign('/cloud/sign-in?return=%2Fcloud%2Ffeedback'); return; }
      if (response.status === 404 || response.status === 403) {
        messages.replaceChildren(); cursors = [null]; pageIndex = 0; nextCursor = null;
        status.textContent = 'This inbox is not available for this account.'; return;
      }
      if (!response.ok) throw new Error('load_failed');
      var data = await response.json();
      if (requestGeneration !== generation) return;
      var fragment = document.createDocumentFragment();
      data.items.forEach(function (item) {
        var card = node('article', 'card feedback-entry');
        var header = node('header', 'card-head feedback-sender');
        var identity = node('div');
        identity.append(node('strong', '', item.name || item.email || 'Account'), node('p', '', item.email || item.user_id));
        var time = node('time', '', new Date(item.created_at).toLocaleString());
        time.dateTime = item.created_at; header.append(identity, time);
        card.append(header, node('p', 'feedback-message', item.message));
        fragment.appendChild(card);
      });
      if (reset) cursors = [null];
      pageIndex = index; nextCursor = data.next_cursor;
      messages.replaceChildren(fragment);
      status.textContent = data.items.length ? '' : 'No feedback yet.';
    } catch (_) { if (requestGeneration === generation) status.textContent = 'Feedback could not be loaded. Try Refresh.'; }
    finally {
      if (requestGeneration !== generation) return;
      loading = false; previous.disabled = pageIndex === 0;
      next.disabled = !nextCursor; refresh.disabled = false;
    }
  }
  refresh.addEventListener('click', function () { load(0, true); });
  previous.addEventListener('click', function () { if (pageIndex > 0) load(pageIndex - 1); });
  next.addEventListener('click', function () {
    if (nextCursor) { cursors[pageIndex + 1] = nextCursor; load(pageIndex + 1); }
  });
  window.addEventListener('pagehide', function () {
    generation++; if (controller) controller.abort(); loading = false;
    messages.replaceChildren(); status.textContent = 'Loading feedback...';
  });
  window.addEventListener('pageshow', function (event) { if (event.persisted) load(0, true); });
  window.addEventListener('focus', function () { load(0, true); });
  load(0, true);
})();
