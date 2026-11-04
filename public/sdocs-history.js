/* Cloud history reuses the document's standard right panel and disclosures. */
(function () {
'use strict';
var S = window.SDocs, button = document.getElementById('_sd_btn-history');
var panel = document.getElementById('_sd_history-panel');
if (!S || !button || !panel) return;
var scriptURL = document.currentScript.src;
var docId = null, activity = null, sessionId = null, entries = [], cursor = null;
var generation = 0, diffGeneration = 0, worker = null, loading = false, refreshPending = false, openId = null, noticeTimer = null;

function node(tag, className, text) {
  var el = document.createElement(tag); if (className) el.className = className;
  if (text != null) el.textContent = text; return el;
}
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
async function request(path) {
  var response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  var data = await response.json();
  if (!response.ok || !data.ok) { var error = new Error('History is unavailable.'); error.status = response.status; throw error; }
  return data;
}
function observe(document) {
  var id = document && document.id || null;
  var changedDocument = id !== docId;
  if (changedDocument) {
    generation++; stopDiff(); clearNotice(); docId = id || null; activity = null;
    entries = []; cursor = null; openId = null; loading = false; refreshPending = false;
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
    var action = node('button', 'export-option sdoc-share-action', 'Try again'); action.type = 'button';
    action.addEventListener('click', function () { load(false); }); panel.appendChild(action);
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
  panel.appendChild(node('p', 'sdoc-history-message', 'Previous versions are kept for 90 days. The current document is always kept. Consecutive browser saves from one editing session appear together.'));
  if (!entries.length) panel.appendChild(node('p', 'sdoc-history-message', 'No updates to show.'));
  entries.forEach(function (entry) {
    var section = node('section', 'sdoc-history-entry');
    var toggle = node('button', 'export-option sdoc-share-toggle'); toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(openId === entry.id));
    var label = node('span', 'export-option-text');
    label.appendChild(node('span', 'sdoc-history-title', entry.kind === 'created' ? 'Created' : entry.kind === 'agent' ? 'Agent / CLI update' : 'Browser edit'));
    label.appendChild(node('span', 'sdoc-history-meta', (entry.is_you ? 'You' : entry.actor_name) + ' · ' + date(entry.updated_at)));
    if (entry.save_count > 1) label.appendChild(node('span', 'sdoc-history-meta', entry.save_count + ' saves'));
    var arrow = node('span', 'arrow', '›'); arrow.setAttribute('aria-hidden', 'true'); toggle.append(label, arrow);
    var disclosure = node('div', 'sdoc-share-disclosure'), inner = node('div', 'sdoc-history-comparison'); disclosure.appendChild(inner);
    section.append(toggle, disclosure); panel.appendChild(section);
    function open() {
      panel.querySelectorAll('.sdoc-share-disclosure.open').forEach(function (el) { el.classList.remove('open'); el.previousElementSibling.classList.remove('open'); el.previousElementSibling.setAttribute('aria-expanded', 'false'); });
      stopDiff(); openId = entry.id; disclosure.classList.add('open'); toggle.classList.add('open'); toggle.setAttribute('aria-expanded', 'true'); compare(entry, inner);
    }
    toggle.addEventListener('click', function () {
      if (openId === entry.id) { openId = null; stopDiff(); disclosure.classList.remove('open'); toggle.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }
      else open();
    });
    if (openId === entry.id) open();
  });
  if (cursor) {
    var more = node('button', 'export-option sdoc-share-action', 'Load older updates'); more.type = 'button';
    more.addEventListener('click', function () { more.disabled = true; load(true); }); panel.appendChild(more);
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
    var more = node('button', 'export-option sdoc-share-action', 'Show more changes'); more.type = 'button'; more.hidden = true;
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
