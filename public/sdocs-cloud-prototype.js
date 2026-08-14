// SmallDocs Cloud document source and file-info controls.
(function () {
'use strict';

var S = window.SDocs = window.SDocs || {};
var CLOUD_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>';
var CLOUD_UPLOAD_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 13v8"/><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="m8 17 4-4 4 4"/></svg>';
var CLOUD_CHECK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 15-5.5 5.5L9 18"/><path d="M5.516 16.07A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 3.501 7.327"/></svg>';
var FILE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
var pendingChallenge = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (character) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
  });
}

function currentFilename() {
  var meta = S.currentMeta || {};
  if (meta.file) return String(meta.file).split('/').pop();
  if (S.cloudDocument && S.cloudDocument.filename) return S.cloudDocument.filename;
  var heading = document.querySelector('#_sd_rendered h1');
  if (heading && heading.textContent.trim()) return heading.textContent.trim() + '.md';
  return 'Untitled document.md';
}

function currentMarkdown() {
  var meta = Object.assign({}, S.currentMeta || {});
  return SDocYaml.serializeFrontMatter(meta) + '\n' + (S.currentBody || '');
}

async function jsonRequest(url, options) {
  var response = await fetch(url, Object.assign({ credentials: 'same-origin' }, options || {}));
  var data = await response.json().catch(function () { return {}; });
  if (!response.ok) {
    var error = new Error(data.error || 'request_failed');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function loadCloudDocument(id) {
  try {
    var data = await jsonRequest('/api/cloud/v1/documents/' + encodeURIComponent(id));
    S.cloudDocument = data.document;
    S._isDefaultState = false;
    S._loadingDocument = true;
    if (S.resetAllStyles) S.resetAllStyles();
    S.loadText(data.document.markdown, data.document.filename);
    if (S.setMode) S.setMode('read', true);
  } catch (error) {
    if (error.status === 401) {
      location.href = '/cloud/sign-in?return=' + encodeURIComponent(location.pathname + location.search);
      return;
    }
    var status = document.getElementById('_sd_status-text');
    if (status) status.textContent = 'Could not open this Cloud document.';
  } finally {
    S._loadingDocument = false;
  }
}

if (S.Sources) {
  S.Sources.register({
    name: 'cloud-document',
    matches: function (location) {
      return new URLSearchParams(location.search).has('cloud-document');
    },
    create: function (location) {
      var id = new URLSearchParams(location.search).get('cloud-document');
      return {
        name: 'cloud-document',
        capabilities: { canSave: true, canWatch: false, canSubmit: false },
        load: function () { return loadCloudDocument(id); },
      };
    },
  });
}

function cloudRow() {
  var row = document.createElement('div');
  row.className = 'fic-row fic-row-cloud fic-row-short-intro';
  if (S.cloudDocument) {
    var project = S.cloudDocument.project && S.cloudDocument.project.name
      ? S.cloudDocument.project.name : 'Cloud';
    row.innerHTML = '<span class="fic-label">Cloud</span>'
      + '<button class="fic-shorten-button fic-cloud-add" type="button">' + escapeHtml(project) + '</button>'
      + '<span class="fic-short-intro-text">Revision ' + escapeHtml(S.cloudDocument.revision_number) + '</span>'
      + '<button class="fic-copy fic-cloud-icon fic-cloud-saved-icon" type="button" title="Open Cloud document details">' + CLOUD_CHECK_SVG + '</button>';
    row.querySelector('.fic-cloud-add').addEventListener('click', openDialog);
    row.querySelector('.fic-cloud-icon').addEventListener('click', openDialog);
    return row;
  }
  row.innerHTML = '<span class="fic-label">Cloud</span>'
    + '<button class="fic-shorten-button fic-cloud-add" type="button" title="Add this document to Cloud">Add to Cloud</button>'
    + '<span class="fic-short-intro-text">Encrypted document on our server; paid feature '
    + '(<a class="fic-short-intro-learn fic-cloud-learn" href="/cloud" target="_blank" rel="noopener">learn more</a>)</span>'
    + '<button class="fic-copy fic-cloud-icon" type="button" title="Add this document to Cloud">' + CLOUD_UPLOAD_SVG + '</button>';
  row.querySelector('.fic-cloud-add').addEventListener('click', beginAdd);
  row.querySelector('.fic-cloud-icon').addEventListener('click', beginAdd);
  return row;
}

function insertRow() {
  var card = document.getElementById('_sd_sdocs-file-info');
  var rows = card && card.querySelector('.fic-rows');
  if (!card || !rows || rows.querySelector('.fic-row-cloud')) return;
  var hasDocument = !!(S.currentBody || (S.currentMeta && Object.keys(S.currentMeta).length));
  if (!hasDocument || S._isDefaultState) return;
  var row = cloudRow();
  var filename = rows.querySelector('[data-key="file"]');
  if (filename && filename.nextSibling) rows.insertBefore(row, filename.nextSibling);
  else if (filename) rows.appendChild(row);
  else rows.insertBefore(row, rows.firstChild);
  rows.hidden = false;
  card.hidden = false;
}

function refreshRow() {
  var row = document.querySelector('.fic-row-cloud');
  if (row) row.remove();
  insertRow();
}

function renderEmailPrompt(row) {
  row.className = 'fic-row fic-row-cloud fic-row-cloud-auth';
  row.innerHTML = '<span class="fic-label">Cloud</span>'
    + '<form class="fic-cloud-auth-fields">'
    + '<input class="fic-cloud-email" type="email" autocomplete="email" placeholder="you@example.com" aria-label="Email address" required>'
    + '<button class="fic-cloud-send" type="submit">Email me a code</button>'
    + '<button class="fic-cloud-cancel" type="button">Cancel</button></form>'
    + '<button class="fic-copy fic-cloud-icon" type="button" title="Email me a code">' + CLOUD_UPLOAD_SVG + '</button>';
  var form = row.querySelector('form');
  var input = row.querySelector('input');
  async function submit(event) {
    event.preventDefault();
    if (!input.checkValidity()) { input.reportValidity(); return; }
    var button = row.querySelector('.fic-cloud-send');
    button.disabled = true;
    button.textContent = 'Sending...';
    try {
      var data = await jsonRequest('/api/cloud/auth/email/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.value.trim() }),
      });
      pendingChallenge = data.challenge_id;
      renderCodePrompt(row, input.value.trim());
    } catch (_) {
      button.disabled = false;
      button.textContent = 'Try again';
    }
  }
  form.addEventListener('submit', submit);
  row.querySelector('.fic-cloud-icon').addEventListener('click', submit);
  row.querySelector('.fic-cloud-cancel').addEventListener('click', refreshRow);
  setTimeout(function () { input.focus(); }, 0);
}

function renderCodePrompt(row, email) {
  row.className = 'fic-row fic-row-cloud fic-row-cloud-auth';
  row.innerHTML = '<span class="fic-label">Cloud</span>'
    + '<form class="fic-cloud-auth-fields">'
    + '<input class="fic-cloud-email" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code" aria-label="Six-digit code" required>'
    + '<button class="fic-cloud-send" type="submit">Verify</button>'
    + '<button class="fic-cloud-cancel" type="button">Cancel</button></form>'
    + '<button class="fic-copy fic-cloud-icon" type="button" title="Verify code">' + CLOUD_UPLOAD_SVG + '</button>';
  var form = row.querySelector('form');
  var input = row.querySelector('input');
  async function verify(event) {
    event.preventDefault();
    if (!/^\d{6}$/.test(input.value)) { input.focus(); return; }
    try {
      await jsonRequest('/api/cloud/auth/email/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_id: pendingChallenge, code: input.value,
          return_to: location.pathname + location.search }),
      });
      pendingChallenge = null;
      refreshRow();
      openProjectDialog();
    } catch (_) {
      input.setCustomValidity('That code is invalid or has expired.');
      input.reportValidity();
      input.setCustomValidity('');
    }
  }
  form.addEventListener('submit', verify);
  row.querySelector('.fic-cloud-icon').addEventListener('click', verify);
  row.querySelector('.fic-cloud-cancel').addEventListener('click', refreshRow);
  row.setAttribute('data-email', email);
  setTimeout(function () { input.focus(); }, 0);
}

async function beginAdd(event) {
  event.preventDefault();
  event.stopPropagation();
  try {
    await jsonRequest('/api/cloud/v1/workspaces');
    openProjectDialog();
  } catch (error) {
    if (error.status === 401) {
      var row = document.querySelector('.fic-row-cloud');
      if (row) renderEmailPrompt(row);
      return;
    }
    openErrorDialog('Cloud is temporarily unavailable.');
  }
}

function ensureDialog() {
  var existing = document.querySelector('.sdoc-cloud-proto-backdrop');
  if (existing) return existing;
  var backdrop = document.createElement('div');
  backdrop.className = 'sdoc-cloud-proto-backdrop';
  backdrop.hidden = true;
  backdrop.innerHTML = '<section class="sdoc-cloud-proto-dialog" role="dialog" aria-modal="true" aria-labelledby="sdoc-cloud-title"></section>';
  backdrop.addEventListener('click', function (event) { if (event.target === backdrop) closeDialog(); });
  document.body.appendChild(backdrop);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !backdrop.hidden) closeDialog();
  });
  return backdrop;
}

function shell(title, subtitle, body) {
  return '<header class="sdoc-cloud-proto-head"><span class="sdoc-cloud-proto-mark">' + CLOUD_SVG + '</span>'
    + '<div><h2 class="sdoc-cloud-proto-title" id="sdoc-cloud-title">' + escapeHtml(title) + '</h2>'
    + '<p class="sdoc-cloud-proto-subtitle">' + escapeHtml(subtitle) + '</p></div>'
    + '<button class="sdoc-cloud-proto-close" type="button" aria-label="Close">&times;</button></header>'
    + '<div class="sdoc-cloud-proto-body">' + body + '</div>';
}

function documentPreview() {
  var tags = S.currentMeta && Array.isArray(S.currentMeta.tags) ? S.currentMeta.tags.length + ' tags' : 'Markdown document';
  return '<div class="sdoc-cloud-proto-doc">' + FILE_SVG
    + '<div class="sdoc-cloud-proto-doc-text"><div class="sdoc-cloud-proto-doc-title">' + escapeHtml(currentFilename()) + '</div>'
    + '<div class="sdoc-cloud-proto-doc-meta">' + escapeHtml(tags) + '</div></div></div>';
}

function wireClose(dialog) {
  dialog.querySelector('.sdoc-cloud-proto-close').addEventListener('click', closeDialog);
}

async function openProjectDialog() {
  var backdrop = ensureDialog();
  var dialog = backdrop.querySelector('.sdoc-cloud-proto-dialog');
  backdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  dialog.innerHTML = shell('Choose where it belongs',
    'The document will be added as the first Cloud revision. Your local file remains where it is.',
    documentPreview() + '<label class="sdoc-cloud-proto-label" for="sdoc-cloud-project">Project</label>'
    + '<select class="sdoc-cloud-proto-select" id="sdoc-cloud-project"><option>Loading projects...</option></select>'
    + '<div class="sdoc-cloud-proto-actions"><button class="sdoc-cloud-proto-btn" data-action="cancel" type="button">Cancel</button>'
    + '<button class="sdoc-cloud-proto-btn primary" data-action="add" type="button" disabled>Add document</button></div>'
    + '<p class="sdoc-cloud-proto-note">Stored encrypted. SmallDocs decrypts it in memory after checking access when a person or agent opens or searches it.</p>');
  wireClose(dialog);
  dialog.querySelector('[data-action="cancel"]').addEventListener('click', closeDialog);
  var select = dialog.querySelector('select');
  var add = dialog.querySelector('[data-action="add"]');
  try {
    var workspaceData = await jsonRequest('/api/cloud/v1/workspaces');
    var groups = await Promise.all(workspaceData.workspaces.map(async function (workspace) {
      var projects = await jsonRequest('/api/cloud/v1/projects?workspace_id=' + encodeURIComponent(workspace.id));
      return { workspace: workspace, projects: projects.projects || [] };
    }));
    select.replaceChildren();
    groups.forEach(function (group) {
      group.projects.forEach(function (project) {
        if (project.role !== 'editor') return;
        var option = document.createElement('option');
        option.value = project.id;
        option.textContent = group.workspace.name + ' / ' + project.name;
        option.dataset.projectName = project.name;
        select.appendChild(option);
      });
    });
    add.disabled = !select.options.length;
  } catch (error) {
    select.replaceChildren(Object.assign(document.createElement('option'), { textContent: 'Projects unavailable' }));
  }
  add.addEventListener('click', async function () {
    if (!select.value) return;
    add.disabled = true;
    add.textContent = 'Adding...';
    try {
      var data = await jsonRequest('/api/cloud/v1/documents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: select.value,
          filename: currentFilename(),
          markdown: currentMarkdown(),
          idempotency_key: crypto.randomUUID(),
        }),
      });
      data.document.project = { id: select.value,
        name: select.options[select.selectedIndex].dataset.projectName || 'Cloud' };
      S.cloudDocument = data.document;
      var url = new URL(location.href);
      url.searchParams.set('cloud-document', data.document.id);
      history.replaceState(null, '', url.pathname + url.search + url.hash);
      refreshRow();
      renderSuccess(dialog);
    } catch (error) {
      add.disabled = false;
      add.textContent = 'Try again';
    }
  });
}

function renderSuccess(dialog) {
  dialog.innerHTML = shell('Document added to Cloud',
    S.cloudDocument.project && S.cloudDocument.project.name || 'Cloud',
    '<div class="sdoc-cloud-proto-success"><div class="sdoc-cloud-proto-success-icon">' + CLOUD_CHECK_SVG + '</div>'
    + '<h3>' + escapeHtml(currentFilename()) + '</h3><p>Revision 1 is available to authorized people and agents in this project.</p>'
    + '<div class="sdoc-cloud-proto-actions"><a class="sdoc-cloud-proto-btn" href="/library?scope=cloud">Open library</a>'
    + '<button class="sdoc-cloud-proto-btn primary" data-action="done" type="button">Done</button></div></div>');
  wireClose(dialog);
  dialog.querySelector('[data-action="done"]').addEventListener('click', closeDialog);
}

function openDialog() {
  if (!S.cloudDocument) return openProjectDialog();
  var backdrop = ensureDialog();
  var dialog = backdrop.querySelector('.sdoc-cloud-proto-dialog');
  backdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  dialog.innerHTML = shell('Cloud document',
    (S.cloudDocument.project && S.cloudDocument.project.name) || 'Cloud',
    documentPreview() + '<div class="sdoc-cloud-proto-success"><div class="sdoc-cloud-proto-success-icon">' + CLOUD_CHECK_SVG + '</div>'
    + '<h3>Revision ' + escapeHtml(S.cloudDocument.revision_number) + '</h3><p>Save your current changes as a new immutable revision.</p>'
    + '<div class="sdoc-cloud-proto-actions"><a class="sdoc-cloud-proto-btn" href="/library?scope=cloud">Open library</a>'
    + '<button class="sdoc-cloud-proto-btn" data-action="history" type="button">Revision history</button>'
    + '<button class="sdoc-cloud-proto-btn primary" data-action="save" type="button">Save to Cloud</button></div>'
    + '<p class="sdoc-cloud-proto-note" data-save-status></p></div>');
  wireClose(dialog);
  dialog.querySelector('[data-action="history"]').addEventListener('click', openRevisionHistory);
  dialog.querySelector('[data-action="save"]').addEventListener('click', saveRevision);
}

async function openRevisionHistory() {
  var backdrop = ensureDialog();
  var dialog = backdrop.querySelector('.sdoc-cloud-proto-dialog');
  dialog.innerHTML = shell('Revision history', currentFilename(),
    '<p class="sdoc-cloud-proto-note" data-history-status>Loading revisions...</p>');
  wireClose(dialog);
  try {
    var data = await jsonRequest('/api/cloud/v1/documents/' + encodeURIComponent(S.cloudDocument.id) + '/revisions');
    var list = document.createElement('div');
    list.className = 'sdoc-cloud-revision-list';
    (data.revisions || []).forEach(function (revision) {
      var row = document.createElement('div');
      row.className = 'sdoc-cloud-revision-row';
      var details = document.createElement('div');
      var title = document.createElement('strong');
      title.textContent = 'Revision ' + revision.revision_number;
      var date = document.createElement('span');
      date.textContent = new Date(revision.created_at).toLocaleString();
      details.append(title, date);
      row.appendChild(details);
      if (revision.id !== S.cloudDocument.current_revision_id) {
        var restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'sdoc-cloud-proto-btn';
        restore.textContent = 'Restore';
        restore.addEventListener('click', function () { restoreRevision(revision, restore); });
        row.appendChild(restore);
      } else {
        var current = document.createElement('span');
        current.className = 'sdoc-cloud-proto-note';
        current.textContent = 'Current';
        row.appendChild(current);
      }
      list.appendChild(row);
    });
    var body = dialog.querySelector('.sdoc-cloud-proto-body');
    body.replaceChildren(list);
  } catch (_) {
    dialog.querySelector('[data-history-status]').textContent = 'Revision history is unavailable.';
  }
}

async function restoreRevision(revision, button) {
  button.disabled = true;
  button.textContent = 'Restoring...';
  try {
    var data = await jsonRequest('/api/cloud/v1/documents/' + encodeURIComponent(S.cloudDocument.id)
      + '/revisions/' + encodeURIComponent(revision.id) + '/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_head_revision_id: S.cloudDocument.current_revision_id,
        idempotency_key: crypto.randomUUID() }),
    });
    data.document.project = S.cloudDocument.project;
    S.cloudDocument = data.document;
    S._loadingDocument = true;
    if (S.resetAllStyles) S.resetAllStyles();
    S.loadText(data.document.markdown, data.document.filename);
    S._loadingDocument = false;
    refreshRow();
    openRevisionHistory();
  } catch (error) {
    button.disabled = false;
    button.textContent = error.data && error.data.error === 'revision_conflict' ? 'Document changed' : 'Try again';
  }
}

async function saveRevision(event) {
  var button = event.currentTarget;
  var dialog = button.closest('.sdoc-cloud-proto-dialog');
  var status = dialog.querySelector('[data-save-status]');
  button.disabled = true;
  button.textContent = 'Saving...';
  try {
    var data = await jsonRequest('/api/cloud/v1/documents/' + encodeURIComponent(S.cloudDocument.id) + '/revisions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_head_revision_id: S.cloudDocument.current_revision_id,
        filename: currentFilename(), markdown: currentMarkdown(),
        idempotency_key: crypto.randomUUID(),
      }),
    });
    data.document.project = S.cloudDocument.project;
    S.cloudDocument = data.document;
    status.textContent = 'Revision ' + data.document.revision_number + ' saved.';
    button.textContent = 'Saved';
    refreshRow();
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Try again';
    status.textContent = error.data && error.data.error === 'revision_conflict'
      ? 'This document changed elsewhere. Reopen it before saving your changes.'
      : 'The revision could not be saved.';
  }
}

function openErrorDialog(message) {
  var backdrop = ensureDialog();
  var dialog = backdrop.querySelector('.sdoc-cloud-proto-dialog');
  backdrop.hidden = false;
  dialog.innerHTML = shell('Cloud unavailable', message,
    '<div class="sdoc-cloud-proto-actions"><button class="sdoc-cloud-proto-btn primary" data-action="done" type="button">Close</button></div>');
  wireClose(dialog);
  dialog.querySelector('[data-action="done"]').addEventListener('click', closeDialog);
}

function closeDialog() {
  var backdrop = document.querySelector('.sdoc-cloud-proto-backdrop');
  if (backdrop) backdrop.hidden = true;
  document.body.style.overflow = '';
}

function start() {
  var card = document.getElementById('_sd_sdocs-file-info');
  if (card) {
    new MutationObserver(function () { insertRow(); }).observe(card, { childList: true, subtree: true });
  }
  insertRow();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
})();
