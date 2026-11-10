/* Cloud history reuses the document's standard right panel and disclosures. */
(function () {
'use strict';
var S = window.SDocs, button = document.getElementById('_sd_btn-history');
var panel = document.getElementById('_sd_history-panel');
if (!S || !button || !panel) return;
var scriptURL = document.currentScript.src;
var docId = null, activity = null, sessionId = null, entries = [], cursor = null;
var diffId = null, copies = new Map();
var generation = 0, diffGeneration = 0, worker = null, loading = false, refreshPending = false, openId = null, noticeTimer = null;

function node(tag, className, text) {
  var el = document.createElement(tag); if (className) el.className = className;
  if (text != null) el.textContent = text; return el;
}
function action(text, kind) {
  var el = node('button', 'export-option sdoc-share-action sdoc-panel-action'); el.type = 'button';
  var paths = { changes: '<path d="M9 3H5v18h4M15 3h4v18h-4M8 8h8M8 16h8M12 12v8"/>',
    more: '<path d="m6 9 6 6 6-6"/>', reason: '<circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7h.01"/>',
    retry: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>' };
  el.innerHTML = kind === 'copy' ? S.copyIcon : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[kind] + '</svg>';
  el.appendChild(node('span', 'sdoc-panel-action-label', text));
  return el;
}
function actionText(el, text) { el.querySelector('.sdoc-panel-action-label').textContent = text; }
function date(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function stopDiff() { diffGeneration++; if (worker) worker.terminate(); worker = null; }
function clearNotice() { clearTimeout(noticeTimer); button.classList.remove('is-updated'); }
function notify(value) {
  clearNotice(); var time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(value));
  button.querySelector('.sdoc-history-notice').textContent = 'Updated ' + time;
  button.classList.add('is-updated'); noticeTimer = setTimeout(clearNotice, 3500);
}
async function request(path, options) {
  var response = await fetch(path, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options));
  var data = await response.json();
  if (!response.ok || !data.ok) { var error = new Error('History is unavailable.'); error.status = response.status; error.code = data.error; throw error; }
  return data;
}
function observe(document) {
  var id = document && document.id || null;
  var changedDocument = id !== docId;
  if (changedDocument) {
    generation++; stopDiff(); clearNotice(); docId = id || null; activity = null;
    entries = []; cursor = null; openId = null; diffId = null; copies.clear(); loading = false; refreshPending = false;
    sessionId = S.currentMode === 'write' ? crypto.randomUUID() : null;
    panel.replaceChildren();
  }
  var next = document && document.activity;
  if (next) {
    var previous = activity;
    if (previous?.latest && next.latest && next.latest.revision_number < previous.latest.revision_number) return;
    activity = next;
    var agentChanged = next.last_agent_revision_id && next.last_agent_revision_id !== previous?.last_agent_revision_id;
    if (!changedDocument && next.latest && (agentChanged || previous && next.latest.revision_id !== previous.latest?.revision_id && S.currentMode !== 'write')) notify(next.latest.updated_at);
    button.setAttribute('data-tip', next.latest ? 'History: last updated ' + date(next.latest.updated_at) : 'Document history');
    if (previous && next.latest?.revision_id !== previous.latest?.revision_id && S.currentMode === 'history') {
      if (loading) refreshPending = true; else load(false);
    }
  }
  button.hidden = !(docId && activity && activity.has_agent_edits);
}
function modeChanged(previous, mode) {
  if (mode === 'write' && previous !== 'write') sessionId = crypto.randomUUID();
  if (previous === 'write' && mode !== 'write' && activity?.latest?.kind === 'browser' && activity.latest.edit_session_id === sessionId) notify(activity.latest.updated_at);
  if (mode === 'history') { clearNotice(); load(false); }
  else if (previous === 'history') { generation++; loading = false; stopDiff(); }
}
function message(text, retry) {
  panel.replaceChildren(node('p', 'sdoc-history-message', text));
  if (retry) {
    var retry = action('Try again', 'retry');
    retry.addEventListener('click', function () { load(false); }); panel.appendChild(retry);
  }
}
async function load(more) {
  if (!docId || loading || S.currentMode !== 'history') return;
  loading = true; var token = ++generation, id = docId;
  if (!more && !entries.length) message('Loading history...');
  try {
    var data = await request('/api/cloud/v1/documents/' + encodeURIComponent(id) + '/history?limit=20'
      + (more && cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    if (token !== generation || id !== docId || S.currentMode !== 'history') return;
    entries = more ? entries.concat(data.entries) : data.entries; cursor = data.next_cursor;
    if (!activity?.latest || data.activity?.latest?.revision_number >= activity.latest.revision_number) activity = data.activity;
    render();
  } catch (error) {
    if (token !== generation || id !== docId) return;
    stopDiff(); entries = []; openId = null;
    message(error.status === 401 ? 'Sign in to view this document’s history.' : 'History is unavailable for this document.', true);
  } finally {
    if (token === generation) {
      loading = false;
      if (refreshPending && S.currentMode === 'history') { refreshPending = false; load(false); }
    }
  }
}
function render() {
  stopDiff(); panel.replaceChildren();
  panel.appendChild(node('p', 'sdoc-history-message', 'Open a saved version as a new document, or view its changes. Previous versions are kept for 90 days. The current document is always kept.'));
  if (!entries.length) panel.appendChild(node('p', 'sdoc-history-message', 'No updates to show.'));
  entries.forEach(function (entry) {
    var section = node('section', 'sdoc-history-entry');
    var toggle = node('button', 'export-option sdoc-share-toggle'); toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(openId === entry.id));
    var label = node('span', 'export-option-text');
    label.appendChild(node('span', 'sdoc-history-title', entry.is_you ? 'You' : entry.actor_name));
    if (entry.edit_reason) label.appendChild(node('span', 'sdoc-history-reason', entry.edit_reason + (entry.edit_reason_truncated ? '...' : '')));
    else if (entry.kind === 'agent') label.appendChild(node('span', 'sdoc-history-reason', 'No reason recorded'));
    label.appendChild(node('span', 'sdoc-history-meta', (entry.kind === 'created' ? 'Created' : entry.kind === 'agent' ? 'Agent / CLI update' : 'Edited in browser') + ' · ' + date(entry.updated_at)));
    if (entry.save_count > 1) label.appendChild(node('span', 'sdoc-history-meta', entry.save_count + ' saves'));
    var arrow = node('span', 'arrow', '›'); arrow.setAttribute('aria-hidden', 'true'); toggle.append(label, arrow);
    var disclosure = node('div', 'sdoc-share-disclosure'), wrapper = node('div'), actions = node('div', 'sdoc-history-actions');
    var copy = action(copies.get(entry.revision_id)?.result ? 'Open copy' : 'Open as new document', 'copy');
    var state = copies.get(entry.revision_id);
    var status = node('p', 'sdoc-history-message', state?.pending ? 'Creating your copy...' : state?.error || '');
    status.setAttribute('role', 'status'); status.hidden = !(state?.pending || state?.error);
    copy.disabled = Boolean(copies.get(entry.revision_id)?.pending);
    copy.addEventListener('click', function () { openCopy(entry, copy, status); });
    var explanation = node('p', 'sdoc-history-message', 'A private copy in this library. Your current document stays unchanged.');
    var changes = action('View changes', 'changes');
    changes.setAttribute('aria-expanded', String(diffId === entry.id));
    var inner = node('div', 'sdoc-history-comparison'); inner.hidden = diffId !== entry.id;
    changes.addEventListener('click', function () {
      stopDiff(); diffId = diffId === entry.id ? null : entry.id;
      inner.hidden = diffId !== entry.id; changes.setAttribute('aria-expanded', String(!inner.hidden));
      actionText(changes, inner.hidden ? 'View changes' : 'Hide changes');
      if (!inner.hidden) compare(entry, inner);
    });
    actions.append(copy, explanation);
    if (entry.edit_reason_truncated) {
      var fullReason = action('Read full reason', 'reason');
      var reasonText = node('p', 'sdoc-history-message sdoc-history-reason'); reasonText.hidden = true;
      fullReason.addEventListener('click', async function () {
        var id = docId; fullReason.disabled = true;
        try {
          var data = await request('/api/cloud/v1/documents/' + encodeURIComponent(id) + '/revisions/' + encodeURIComponent(entry.revision_id));
          if (docId !== id || openId !== entry.id || !reasonText.isConnected) return;
          reasonText.textContent = data.document.edit_reason || 'No reason recorded'; reasonText.hidden = false; fullReason.hidden = true;
        } catch (_) { reasonText.textContent = 'Could not load the full reason. Try again.'; reasonText.hidden = false; }
        finally { fullReason.disabled = false; }
      });
      actions.append(fullReason, reasonText);
    }
    actions.append(changes, status, inner); wrapper.appendChild(actions); disclosure.appendChild(wrapper);
    section.append(toggle, disclosure); panel.appendChild(section);
    function open() {
      panel.querySelectorAll('.sdoc-share-disclosure.open').forEach(function (el) { el.classList.remove('open'); el.previousElementSibling.classList.remove('open'); el.previousElementSibling.setAttribute('aria-expanded', 'false'); });
      stopDiff(); openId = entry.id; disclosure.classList.add('open'); toggle.classList.add('open'); toggle.setAttribute('aria-expanded', 'true');
      if (diffId === entry.id) { actionText(changes, 'Hide changes'); inner.hidden = false; compare(entry, inner); }
    }
    toggle.addEventListener('click', function () {
      if (openId === entry.id) { openId = null; stopDiff(); disclosure.classList.remove('open'); toggle.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }
      else open();
    });
    if (openId === entry.id) open();
  });
  if (cursor) {
    var more = action('Load older updates', 'more');
    more.addEventListener('click', function () { more.disabled = true; load(true); }); panel.appendChild(more);
  }
}
async function openCopy(entry, button, status) {
  var id = docId, saved = copies.get(entry.revision_id);
  if (saved?.result) { window.open(saved.result.url, '_blank', 'noopener'); return; }
  if (saved?.pending) return;
  var tab = window.open('about:blank', '_blank'); if (tab) tab.opener = null;
  saved = saved || { key: crypto.randomUUID() }; saved.pending = true; saved.error = null; copies.set(entry.revision_id, saved);
  button.disabled = true; status.hidden = false; status.textContent = 'Creating your copy...';
  try {
    var data = await request('/api/cloud/v1/documents/' + encodeURIComponent(id) + '/revisions/' + encodeURIComponent(entry.revision_id) + '/copy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotency_key: saved.key }) });
    var url = new URL(data.document.url);
    if (url.origin !== location.origin || url.pathname !== '/docs' || url.searchParams.get('cloud-document') !== data.document.id) throw new Error('Invalid copy URL');
    saved.result = { url: url.href };
    if (tab && !tab.closed) tab.location.replace(url.href);
    if (docId === id) {
      actionText(button, 'Open copy'); status.textContent = 'Copy created. ';
      var link = node('a', '', 'Open copy'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener'; status.appendChild(link);
    }
  } catch (error) {
    if (tab && !tab.closed) tab.close();
    saved.error = ['permission_denied', 'trial_payment_required', 'subscription_read_only', 'subscription_required'].includes(error.code)
      ? 'Your access or subscription does not allow creating a copy in this library.'
      : 'Could not create this copy. Try again.';
    if (docId === id) status.textContent = saved.error;
  } finally {
    saved.pending = false; button.disabled = false;
    if (docId === id && S.currentMode === 'history' && !button.isConnected) render();
  }
}
async function compare(entry, target) {
  var id = docId, token = ++diffGeneration;
  target.replaceChildren(node('p', 'sdoc-history-message', 'Loading changes...'));
  var base = '/api/cloud/v1/documents/' + encodeURIComponent(id) + '/revisions/';
  try {
    var versions = await Promise.all([entry.before_revision_id ? request(base + encodeURIComponent(entry.before_revision_id)) : Promise.resolve(null), request(base + encodeURIComponent(entry.revision_id))]);
    if (token !== diffGeneration || docId !== id || S.currentMode !== 'history' || openId !== entry.id) return;
    var url = new URL('/public/sdocs-history-diff-worker.js', scriptURL); url.search = new URL(scriptURL).search;
    worker = new Worker(url.href); var activeWorker = worker;
    var summary = node('p', 'sdoc-history-message', 'Comparing versions...'); var output = node('div', 'sdoc-history-diff');
    var more = action('Show more changes', 'more'); more.hidden = true;
    target.replaceChildren(summary, output, more);
    activeWorker.onmessage = function (event) {
      if (token !== diffGeneration || worker !== activeWorker || docId !== id) return;
      var data = event.data;
      if (data.error) { target.replaceChildren(node('p', 'sdoc-history-message', 'Could not compare these versions.')); return; }
      summary.textContent = 'Lines added: ' + data.totals.added + '. Lines removed: ' + data.totals.removed + '.';
      data.lines.forEach(function (line) {
        var el = node('div', 'sdoc-history-diff-line ' + line.kind, (line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : '') + line.text.replace(/\n$/, ''));
        output.appendChild(el);
      });
      more.hidden = !data.more; more.disabled = false;
      if (!data.more && !data.totals.added && !data.totals.removed) summary.textContent = 'No text changes.';
    };
    activeWorker.onerror = function () { if (token === diffGeneration) target.replaceChildren(node('p', 'sdoc-history-message', 'Could not compare these versions.')); };
    more.addEventListener('click', function () { more.disabled = true; activeWorker.postMessage({ command: 'more' }); });
    activeWorker.postMessage({ command: 'compare', before: versions[0] ? versions[0].document.markdown : '', after: versions[1].document.markdown });
  } catch (error) {
    if (token === diffGeneration && docId === id) target.replaceChildren(node('p', 'sdoc-history-message', error.status === 404 ? 'One of these versions is no longer available.' : 'Could not load these versions.'));
  }
}
button.addEventListener('click', function () { S.setMode(S.currentMode === 'history' ? 'read' : 'history'); });
document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && S.currentMode === 'history') { S.setMode('read'); if (!button.hidden) button.focus(); } });
S.cloudHistory = { observe: observe, modeChanged: modeChanged, editSessionId: function () { return sessionId || (sessionId = crypto.randomUUID()); } };
})();
