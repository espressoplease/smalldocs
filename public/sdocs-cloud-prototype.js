// SmallDocs Cloud document source and file-info controls.
(function () {
'use strict';

var S = window.SDocs = window.SDocs || {};
var CLOUD_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>';
var CLOUD_UPLOAD_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 13v8"/><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="m8 17 4-4 4 4"/></svg>';
var CLOUD_CHECK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 15-5.5 5.5L9 18"/><path d="M5.516 16.07A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 3.501 7.327"/></svg>';
var FILE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
var USER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>';
var USERS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/></svg>';
var PLUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
var CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 6-11 11-5-5"/></svg>';
var CLOSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
var pendingChallenge = null;
var cloudState = { account: null, accounts: [], user: null, members: [], permission: null,
  suggestedTags: [], panel: null, status: '', busy: false };

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

async function loadAccountData(accountId) {
  var suffix = accountId ? '?account_id=' + encodeURIComponent(accountId) : '';
  var data = await jsonRequest('/api/cloud/v1/account' + suffix);
  cloudState.account = data.account;
  cloudState.accounts = data.accounts || [];
  cloudState.user = data.user;
  var selectedSuffix = '?account_id=' + encodeURIComponent(data.account.id);
  var requests = [
    jsonRequest('/api/cloud/v1/account/members' + selectedSuffix),
    jsonRequest('/api/cloud/v1/account/tags' + selectedSuffix),
  ];
  var details = await Promise.all(requests);
  cloudState.members = details[0].members || [];
  cloudState.suggestedTags = details[1].tags || [];
  refreshRow();
  return data;
}

async function loadCloudDocument(id) {
  try {
    var data = await jsonRequest('/api/cloud/v1/documents/' + encodeURIComponent(id));
    S.cloudDocument = data.document;
    cloudState.permission = data.permission || null;
    if (data.document.workspace_id) {
      cloudState.account = { id: data.document.workspace_id };
      loadAccountData(data.document.workspace_id).catch(function () {});
    }
    S._isDefaultState = false;
    S._loadingDocument = true;
    if (S.resetAllStyles) S.resetAllStyles();
    S.loadText(data.document.markdown, data.document.filename);
    if (S.setMode) S.setMode('read', true);
  } catch (error) {
    if (error.status === 401) {
      location.href = '/cloud/sign-in?return=' +
        encodeURIComponent(location.pathname + location.search + location.hash);
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

function documentTags() {
  if (S.cloudDocument && Array.isArray(S.cloudDocument.tags)) return S.cloudDocument.tags;
  return S.currentMeta && Array.isArray(S.currentMeta.tags) ? S.currentMeta.tags.map(String) : [];
}

function selectedMembers() {
  var ids = cloudState.permission && cloudState.permission.member_user_ids || [];
  return cloudState.members.filter(function (member) { return ids.indexOf(member.user_id) !== -1; });
}

function permissionLabel() {
  if (!cloudState.permission) return 'You';
  if (cloudState.permission.mode === 'everyone') return 'Everyone';
  var members = selectedMembers();
  if (members.length <= 1) return 'You';
  var labels = members.slice(0, 4).map(function (member) {
    return member.is_you ? 'You' : member.initials;
  });
  if (members.length > 4) labels.push('+' + (members.length - 4));
  return labels.join(', ');
}

function permissionNames() {
  var members = cloudState.permission && cloudState.permission.mode === 'everyone'
    ? cloudState.members : selectedMembers();
  return members.map(function (member) {
    return member.name + (member.is_you ? ' (you)' : '');
  }).join(' · ');
}

function cloudTag(tag) {
  return '<button class="sdoc-cloud-lab-tag" type="button" data-cloud-open="tags"'
    + ' aria-label="Edit Cloud tag ' + escapeHtml(tag) + '">' + CLOUD_SVG
    + '<span>#' + escapeHtml(tag) + '</span></button>';
}

function cloudRow() {
  var row = document.createElement('div');
  row.className = 'fic-row fic-row-cloud fic-row-cloud-lab';
  if (S.cloudDocument) {
    var tags = documentTags().map(cloudTag).join('');
    var many = cloudState.permission && (cloudState.permission.mode === 'everyone' ||
      (cloudState.permission.member_user_ids || []).length > 1);
    row.innerHTML = '<span class="fic-label">Cloud</span>'
      + '<div class="sdoc-cloud-lab-row-main"><div class="sdoc-cloud-lab-pills">'
      + '<button class="sdoc-cloud-lab-access" type="button" data-cloud-open="access"'
      + ' title="' + escapeHtml(permissionNames()) + '">' + (many ? USERS_SVG : USER_SVG)
      + '<span>' + escapeHtml(permissionLabel()) + '</span></button>'
      + (tags || '<span class="sdoc-cloud-lab-no-tags">No tags</span>')
      + '<button class="sdoc-cloud-lab-plus" type="button" data-cloud-open="tags" aria-label="Edit Cloud tags">'
      + PLUS_SVG + '</button></div></div>'
      + '<button class="sdoc-cloud-lab-state-icon sdoc-cloud-lab-saved" type="button"'
      + ' aria-label="Remove from Cloud" title="Remove from Cloud">' + CLOUD_CHECK_SVG + '</button>';
    row.querySelectorAll('[data-cloud-open]').forEach(function (button) {
      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        openCloudPanel(button.getAttribute('data-cloud-open'));
      });
    });
    row.querySelector('.sdoc-cloud-lab-saved').addEventListener('click', removeCloudDocument);
    return row;
  }
  row.innerHTML = '<span class="fic-label">Cloud</span>'
    + '<button class="sdoc-cloud-lab-add-link" type="button" title="Add this document to Cloud">Add to Cloud</button>'
    + (!cloudState.account || !cloudState.account.can_write
      ? '<span class="fic-short-intro-text">Encrypted document on our server; paid feature '
        + '(<a class="fic-short-intro-learn fic-cloud-learn" href="/cloud" target="_blank" rel="noopener">learn more</a>)</span>' : '')
    + '<button class="sdoc-cloud-lab-state-icon sdoc-cloud-lab-upload" type="button" title="Add this document to Cloud">'
    + CLOUD_UPLOAD_SVG + '</button>';
  row.querySelector('.sdoc-cloud-lab-add-link').addEventListener('click', beginAdd);
  row.querySelector('.sdoc-cloud-lab-upload').addEventListener('click', beginAdd);
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
          return_to: location.pathname + location.search + location.hash }),
      });
      pendingChallenge = null;
      refreshRow();
      beginAdd(event);
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
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (cloudState.busy) return;
  cloudState.busy = true;
  try {
    var accountData = await loadAccountData();
    if (!accountData.account.can_write) {
      location.href = '/cloud/checkout?return=' +
        encodeURIComponent(location.pathname + location.search + location.hash);
      return;
    }
    var data = await jsonRequest('/api/cloud/v1/account/documents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: accountData.account.id, filename: currentFilename(),
        markdown: currentMarkdown(), idempotency_key: crypto.randomUUID() }),
    });
    S.cloudDocument = data.document;
    S.cloudDocument.workspace_id = data.account.id;
    cloudState.account = Object.assign({}, accountData.account, data.account);
    cloudState.permission = data.permission;
    var url = new URL(location.href);
    url.searchParams.set('cloud-document', data.document.id);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    cloudState.status = 'Added to Cloud.';
    refreshRow();
  } catch (error) {
    if (error.status === 401) {
      var row = document.querySelector('.fic-row-cloud');
      if (row) renderEmailPrompt(row);
      return;
    }
    if (error.status === 402) {
      location.href = '/cloud/checkout?return=' +
        encodeURIComponent(location.pathname + location.search + location.hash);
      return;
    }
    openErrorDialog('Cloud is temporarily unavailable.');
  } finally {
    cloudState.busy = false;
  }
}

async function removeCloudDocument(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (!S.cloudDocument || cloudState.busy) return;
  cloudState.busy = true;
  var rowButton = document.querySelector('.sdoc-cloud-lab-saved');
  if (rowButton) rowButton.disabled = true;
  try {
    await jsonRequest('/api/cloud/v1/documents/' + encodeURIComponent(S.cloudDocument.id), {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_head_revision_id: S.cloudDocument.current_revision_id }),
    });
    S.cloudDocument = null;
    cloudState.permission = null;
    closeCloudPanel();
    var url = new URL(location.href);
    url.searchParams.delete('cloud-document');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    refreshRow();
  } catch (error) {
    cloudState.status = error.data && error.data.error === 'revision_conflict'
      ? 'The Cloud document changed. Reopen it before removing it.'
      : 'The document was not removed from Cloud.';
    if (rowButton) rowButton.disabled = false;
  } finally {
    cloudState.busy = false;
  }
}

function ensureCloudPanel() {
  var panel = document.getElementById('_sd_cloud-lab-panel');
  if (panel) return panel;
  panel = document.createElement('aside');
  panel.id = '_sd_cloud-lab-panel';
  panel.setAttribute('aria-label', 'Cloud document controls');
  panel.innerHTML = '<header class="sdoc-cloud-lab-panel-head"><div>'
    + '<span class="sdoc-cloud-lab-eyebrow">Cloud</span>'
    + '<strong data-cloud-panel-title>Access</strong></div>'
    + '<button class="sdoc-cloud-lab-close" type="button" aria-label="Close Cloud panel">'
    + CLOSE_SVG + '</button></header><div class="sdoc-cloud-lab-panel-body"></div>';
  var main = document.getElementById('_sd_main');
  if (main) main.appendChild(panel);
  else document.body.appendChild(panel);
  panel.querySelector('.sdoc-cloud-lab-close').addEventListener('click', closeCloudPanel);
  return panel;
}

function memberRow(member) {
  var ids = cloudState.permission && cloudState.permission.member_user_ids || [];
  var checked = cloudState.permission && (cloudState.permission.mode === 'everyone' ||
    ids.indexOf(member.user_id) !== -1);
  var locked = member.is_you || !cloudState.permission || !cloudState.permission.can_manage;
  return '<label class="sdoc-cloud-lab-member' + (checked ? ' selected' : '') + '">'
    + '<input type="checkbox" data-cloud-member="' + escapeHtml(member.user_id) + '"'
    + (checked ? ' checked' : '') + (locked ? ' disabled' : '') + '>'
    + '<span class="sdoc-cloud-lab-avatar">' + escapeHtml(member.initials) + '</span>'
    + '<span class="sdoc-cloud-lab-member-copy"><strong>' + escapeHtml(member.name)
    + (member.is_you ? ' <small>You</small>' : '') + '</strong><span>'
    + escapeHtml(member.email || '') + '</span></span>'
    + '<span class="sdoc-cloud-lab-check">' + CHECK_SVG + '</span></label>';
}

function accessPanelHtml() {
  var canManage = cloudState.permission && cloudState.permission.can_manage;
  var presets = '<button type="button" data-cloud-preset="only"' + (!canManage ? ' disabled' : '')
    + '>' + USER_SVG + 'Only you</button>';
  if (cloudState.account && cloudState.account.kind === 'team') {
    presets += '<button type="button" data-cloud-preset="everyone"' + (!canManage ? ' disabled' : '')
      + '>' + USERS_SVG + 'Everyone</button>';
  }
  return '<section class="sdoc-cloud-lab-section"><div class="sdoc-cloud-lab-section-title">Quick choices</div>'
    + '<div class="sdoc-cloud-lab-presets">' + presets + '</div></section>'
    + '<section class="sdoc-cloud-lab-section"><div class="sdoc-cloud-lab-section-title">People with access</div>'
    + '<div class="sdoc-cloud-lab-members">' + cloudState.members.map(memberRow).join('') + '</div>'
    + '<p class="sdoc-cloud-lab-help">This selection applies to this document. The person who added it always keeps access.</p>'
    + '</section>';
}

function tagChip(tag) {
  return '<span class="sdoc-cloud-lab-tag-edit">' + CLOUD_SVG + '<span>#' + escapeHtml(tag) + '</span>'
    + '<button type="button" data-cloud-remove-tag="' + escapeHtml(tag) + '" aria-label="Remove '
    + escapeHtml(tag) + '">' + CLOSE_SVG + '</button></span>';
}

function tagsPanelHtml() {
  var tags = documentTags();
  var current = tags.length ? tags.map(tagChip).join('')
    : '<span class="sdoc-cloud-lab-no-tags">No tags yet</span>';
  var suggestions = cloudState.suggestedTags.filter(function (item) {
    return tags.indexOf(item.tag) === -1;
  }).slice(0, 8).map(function (item) {
    return '<button class="sdoc-cloud-lab-suggestion" type="button" data-cloud-add-tag="'
      + escapeHtml(item.tag) + '"><span>#' + escapeHtml(item.tag) + '</span><small>'
      + item.count + ' docs</small></button>';
  }).join('');
  return '<section class="sdoc-cloud-lab-section"><div class="sdoc-cloud-lab-section-title">Current Cloud tags</div>'
    + '<div class="sdoc-cloud-lab-current-tags">' + current + '</div>'
    + '<form class="sdoc-cloud-lab-tag-form"><input type="text" placeholder="Add a tag" aria-label="New Cloud tag">'
    + '<button type="submit">Add</button></form>'
    + '<p class="sdoc-cloud-lab-help">Cloud tags are stored in the Markdown front matter.</p></section>'
    + (suggestions ? '<section class="sdoc-cloud-lab-section"><div class="sdoc-cloud-lab-section-title">Used in your account</div>'
      + '<div class="sdoc-cloud-lab-suggestions">' + suggestions + '</div></section>' : '');
}

function renderCloudPanel() {
  var panel = ensureCloudPanel();
  panel.querySelector('[data-cloud-panel-title]').textContent = cloudState.panel === 'tags' ? 'Tags' : 'Access';
  var body = panel.querySelector('.sdoc-cloud-lab-panel-body');
  body.innerHTML = (cloudState.panel === 'tags' ? tagsPanelHtml() : accessPanelHtml())
    + (cloudState.status ? '<p class="sdoc-cloud-lab-status" aria-live="polite">'
      + escapeHtml(cloudState.status) + '</p>' : '');
  wireCloudPanel(body);
}

function wireCloudPanel(body) {
  body.querySelectorAll('[data-cloud-preset]').forEach(function (button) {
    button.addEventListener('click', function () {
      var everyone = button.getAttribute('data-cloud-preset') === 'everyone';
      savePermission(everyone ? 'everyone' : 'custom', []);
    });
  });
  body.querySelectorAll('[data-cloud-member]').forEach(function (input) {
    input.addEventListener('change', function () {
      var selected = Array.prototype.map.call(body.querySelectorAll('[data-cloud-member]:checked'),
        function (checkbox) { return checkbox.getAttribute('data-cloud-member'); });
      savePermission('custom', selected);
    });
  });
  body.querySelectorAll('[data-cloud-remove-tag]').forEach(function (button) {
    button.addEventListener('click', function () {
      saveTags(documentTags().filter(function (tag) {
        return tag !== button.getAttribute('data-cloud-remove-tag');
      }));
    });
  });
  body.querySelectorAll('[data-cloud-add-tag]').forEach(function (button) {
    button.addEventListener('click', function () { addCloudTag(button.getAttribute('data-cloud-add-tag')); });
  });
  var tagForm = body.querySelector('.sdoc-cloud-lab-tag-form');
  if (tagForm) tagForm.addEventListener('submit', function (event) {
    event.preventDefault();
    addCloudTag(tagForm.querySelector('input').value);
  });
}

async function savePermission(mode, memberIds) {
  if (!S.cloudDocument || cloudState.busy) return;
  cloudState.busy = true;
  try {
    var data = await jsonRequest('/api/cloud/v1/documents/' + encodeURIComponent(S.cloudDocument.id)
      + '/permission', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: mode, member_user_ids: memberIds }) });
    cloudState.permission = data.permission;
    cloudState.status = 'Access updated.';
  } catch (_) { cloudState.status = 'Access was not updated.'; }
  cloudState.busy = false;
  refreshRow();
  renderCloudPanel();
}

function addCloudTag(raw) {
  var tag = String(raw || '').trim().replace(/^#+/, '').toLowerCase();
  if (!tag) return;
  var tags = documentTags();
  if (tags.indexOf(tag) === -1) tags = tags.concat(tag);
  saveTags(tags);
}

async function saveTags(tags) {
  if (!S.cloudDocument || cloudState.busy) return;
  cloudState.busy = true;
  try {
    var data = await jsonRequest('/api/cloud/v1/documents/' + encodeURIComponent(S.cloudDocument.id)
      + '/tags', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: tags, expected_head_revision_id: S.cloudDocument.current_revision_id,
          idempotency_key: crypto.randomUUID() }) });
    S.cloudDocument = Object.assign({}, S.cloudDocument, data.document);
    if (!S.currentMeta) S.currentMeta = {};
    S.currentMeta.tags = data.document.tags.slice();
    cloudState.status = 'Tags updated.';
    await loadAccountData(cloudState.account.id);
  } catch (_) { cloudState.status = 'Tags were not updated.'; }
  cloudState.busy = false;
  refreshRow();
  renderCloudPanel();
}

function openCloudPanel(kind) {
  cloudState.panel = kind === 'tags' ? 'tags' : 'access';
  cloudState.status = '';
  renderCloudPanel();
  document.body.classList.add('cloud-lab-mode', 'mobile-cloud-lab-open');
}

function closeCloudPanel() {
  cloudState.panel = null;
  document.body.classList.remove('cloud-lab-mode', 'mobile-cloud-lab-open');
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

async function openProjectDialog(preferredWorkspaceId) {
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
        option.dataset.workspaceId = group.workspace.id;
        option.dataset.workspaceKind = group.workspace.kind;
        select.appendChild(option);
      });
    });
    if (preferredWorkspaceId) {
      var preferred = Array.prototype.find.call(select.options, function (option) {
        return option.dataset.workspaceId === preferredWorkspaceId;
      });
      if (preferred) select.value = preferred.value;
    }
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
      if (error.status === 402 && (error.data.error === 'subscription_required' ||
          error.data.error === 'subscription_read_only' || error.data.error === 'payment_grace_expired')) {
        var selected = select.options[select.selectedIndex];
        var plan = selected && selected.dataset.workspaceKind === 'team' ? 'team' : 'personal';
        location.href = '/cloud/checkout?plan=' + plan + '&return=' +
          encodeURIComponent(location.pathname + location.search + location.hash);
        return;
      }
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
    + '<button class="sdoc-cloud-proto-btn danger" data-action="delete" type="button">Delete from Cloud</button>'
    + '<button class="sdoc-cloud-proto-btn" data-action="history" type="button">Revision history</button>'
    + '<button class="sdoc-cloud-proto-btn primary" data-action="save" type="button">Save to Cloud</button></div>'
    + '<p class="sdoc-cloud-proto-note" data-save-status></p></div>');
  wireClose(dialog);
  dialog.querySelector('[data-action="delete"]').addEventListener('click', confirmDeleteDocument);
  dialog.querySelector('[data-action="history"]').addEventListener('click', openRevisionHistory);
  dialog.querySelector('[data-action="save"]').addEventListener('click', saveRevision);
}

function confirmDeleteDocument() {
  var dialog = ensureDialog().querySelector('.sdoc-cloud-proto-dialog');
  dialog.innerHTML = shell('Delete from Cloud', currentFilename(),
    '<p>This removes the document from Cloud now. It can be restored for 30 days before its encrypted revisions are purged.</p>'
    + '<div class="sdoc-cloud-proto-actions"><button class="sdoc-cloud-proto-btn" data-action="cancel" type="button">Cancel</button>'
    + '<button class="sdoc-cloud-proto-btn danger" data-action="confirm-delete" type="button">Delete from Cloud</button></div>'
    + '<p class="sdoc-cloud-proto-note" data-delete-status></p>');
  wireClose(dialog);
  dialog.querySelector('[data-action="cancel"]').addEventListener('click', openDialog);
  dialog.querySelector('[data-action="confirm-delete"]').addEventListener('click', deleteCloudDocument);
}

async function deleteCloudDocument(event) {
  var button = event.currentTarget;
  var dialog = button.closest('.sdoc-cloud-proto-dialog');
  button.disabled = true;
  button.textContent = 'Deleting...';
  try {
    await jsonRequest('/api/cloud/v1/documents/' + encodeURIComponent(S.cloudDocument.id), {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_head_revision_id: S.cloudDocument.current_revision_id }),
    });
    S.cloudDocument = null;
    var url = new URL(location.href);
    url.searchParams.delete('cloud-document');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    refreshRow();
    dialog.innerHTML = shell('Deleted from Cloud', currentFilename(),
      '<p>The current document remains open here. Cloud keeps its encrypted revisions for the 30-day restore window.</p>'
      + '<div class="sdoc-cloud-proto-actions"><a class="sdoc-cloud-proto-btn" href="/library?scope=cloud">Open library</a>'
      + '<button class="sdoc-cloud-proto-btn primary" data-action="done" type="button">Done</button></div>');
    wireClose(dialog);
    dialog.querySelector('[data-action="done"]').addEventListener('click', closeDialog);
  } catch (error) {
    button.disabled = false;
    button.textContent = error.data && error.data.error === 'revision_conflict'
      ? 'Document changed' : 'Try again';
    dialog.querySelector('[data-delete-status]').textContent = 'The document was not deleted.';
  }
}

async function openRevisionHistory() {
  var backdrop = ensureDialog();
  var dialog = backdrop.querySelector('.sdoc-cloud-proto-dialog');
  dialog.innerHTML = shell('Revision history', currentFilename(),
    '<p class="sdoc-cloud-proto-note" data-history-status>Loading revisions...</p>');
  wireClose(dialog);
  try {
    var revisions = [];
    var cursor = null;
    do {
      var endpoint = '/api/cloud/v1/documents/' + encodeURIComponent(S.cloudDocument.id) +
        '/revisions?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      var page = await jsonRequest(endpoint);
      revisions = revisions.concat(page.revisions || []);
      cursor = page.next_cursor || null;
    } while (cursor);
    var list = document.createElement('div');
    list.className = 'sdoc-cloud-revision-list';
    revisions.forEach(function (revision) {
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
  loadAccountData().catch(function () {});
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && cloudState.panel) closeCloudPanel();
  });
  var params = new URLSearchParams(location.search);
  if (params.get('checkout') === 'success' && params.get('workspace_id')) {
    var workspaceId = params.get('workspace_id');
    var url = new URL(location.href);
    url.searchParams.delete('checkout');
    url.searchParams.delete('workspace_id');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    waitForSubscription(workspaceId, 0);
  }
}

function waitForSubscription(workspaceId, attempt) {
  jsonRequest('/api/cloud/v1/workspaces/' + encodeURIComponent(workspaceId) + '/billing')
    .then(function (data) {
      if (data.billing && data.billing.access && data.billing.access.write) {
        loadAccountData(workspaceId).then(function () { beginAdd(); });
        return;
      }
      if (attempt >= 9) throw new Error('subscription_pending');
      setTimeout(function () { waitForSubscription(workspaceId, attempt + 1); }, 1000);
    })
    .catch(function () {
      if (attempt < 9) {
        setTimeout(function () { waitForSubscription(workspaceId, attempt + 1); }, 1000);
      } else {
        openErrorDialog('Payment was accepted, but Cloud access is still being activated. Try Add to Cloud again in a moment.');
      }
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
})();
