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
var LIBRARY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/></svg>';
var librarySettings = null;
var selectedLibrary = null;
var PLUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
var CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 6-11 11-5-5"/></svg>';
var CLOSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
var pendingChallenge = null;
var cloudState = { account: null, accounts: [], user: null, members: [], permission: null,
  suggestedTags: [], panel: null, status: '', busy: false };
var cloudSaveTimer = null;
var cloudSavePromise = null;
var cloudSaveQueued = false;
var cloudSaveBlocked = false;
var cloudLastSavedMarkdown = null;
var cloudTargetRevisionId = null;
var cloudTargetMarkdown = null;
var cloudRecoveryMarkdown = null;
var cloudPollTimer = null;

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
  if (typeof SDocStyles !== 'undefined' && typeof S.collectStyles === 'function') {
    var styles = SDocStyles.stripStyleDefaults(S.collectStyles());
    if (styles && Object.keys(styles).length) meta.styles = styles;
    else delete meta.styles;
  }
  return SDocYaml.serializeFrontMatter(meta) + '\n' + (S.currentBody || '');
}

function clearLocalDocumentContext() {
  var bridge = S.bridge || null;
  if (bridge && typeof bridge.releaseToCloud === 'function') {
    bridge.releaseToCloud();
  }
  if (S.bridge === bridge) S.bridge = null;
  S.localMeta = {};
  try { sessionStorage.removeItem('sdocs.localMeta'); } catch (_) {}
}

function cloudCommentIdentity() {
  if (!S.cloudDocument || !cloudState.user) return null;
  var parts = [cloudState.user.first_name, cloudState.user.last_name].filter(Boolean);
  return parts.length ? parts.join(' ') : cloudState.user.email || null;
}

S.cloudCommentIdentity = cloudCommentIdentity;

function setCloudSaveStatus(message, kind) {
  cloudState.status = message;
  if (S.setStatus) S.setStatus(message, kind);
  if (cloudState.panel) renderCloudPanel();
}

function applyCloudMarkdown(markdown, filename) {
  if (typeof markdown !== 'string' || markdown === currentMarkdown()) return;
  var mode = S.currentMode;
  S._loadingDocument = true;
  try {
    if (S.resetAllStyles) S.resetAllStyles();
    S.loadText(markdown, filename);
    if (mode && S.setMode) S.setMode(mode, true);
  } finally {
    S._loadingDocument = false;
  }
  if (S.refreshCommentIdentity) S.refreshCommentIdentity();
}

async function saveCloudRevision() {
  if (!S.cloudDocument || cloudSaveBlocked) return null;
  if (cloudSavePromise) {
    cloudSaveQueued = true;
    return cloudSavePromise;
  }
  var markdown = currentMarkdown();
  if (markdown === cloudLastSavedMarkdown) return S.cloudDocument;
  var documentId = S.cloudDocument.id;
  var targetRevisionId = cloudTargetRevisionId || S.cloudDocument.current_revision_id;
  setCloudSaveStatus('Saving to Cloud...');
  cloudSavePromise = jsonRequest('/api/cloud/v1/documents/' + encodeURIComponent(documentId)
    + '/revisions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: markdown, filename: currentFilename(),
        target_revision_id: targetRevisionId, target_markdown: cloudTargetMarkdown,
        idempotency_key: crypto.randomUUID() }) })
    .then(function (data) {
      var current = currentMarkdown();
      var savedMarkdown = typeof data.document.markdown === 'string'
        ? data.document.markdown : markdown;
      S.cloudDocument = Object.assign({}, S.cloudDocument, data.document);
      if (current === markdown) {
        applyCloudMarkdown(savedMarkdown, data.document.filename || currentFilename());
        cloudLastSavedMarkdown = currentMarkdown();
        cloudTargetRevisionId = data.document.current_revision_id;
        cloudTargetMarkdown = cloudLastSavedMarkdown;
      } else {
        cloudLastSavedMarkdown = markdown;
      }
      setCloudSaveStatus(data.document.combined
        ? 'Saved and combined with Cloud changes.' : 'Saved to Cloud.');
      return S.cloudDocument;
    })
    .catch(function (error) {
      if (error.data && (error.data.error === 'target_too_old' ||
          error.data.error === 'revision_conflict')) {
        cloudSaveBlocked = true;
        cloudRecoveryMarkdown = currentMarkdown();
        setCloudSaveStatus('Your edits were not saved to Cloud. They are still open here.',
          'error');
        openRecoveryDialog();
      } else {
        setCloudSaveStatus('Changes were not saved to Cloud.', 'error');
      }
      throw error;
    })
    .finally(function () {
      cloudSavePromise = null;
      if (cloudSaveQueued && !cloudSaveBlocked && S.cloudDocument) {
        cloudSaveQueued = false;
        if (currentMarkdown() !== cloudLastSavedMarkdown) queueCloudSave('queued');
      } else {
        cloudSaveQueued = false;
      }
    });
  return cloudSavePromise;
}

function queueCloudSave(source) {
  if (!S.cloudDocument || S._loadingDocument || cloudSaveBlocked) return;
  if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(function () {
    cloudSaveTimer = null;
    saveCloudRevision().catch(function () {});
  }, source === 'comment' || source === 'remote' ? 0 : 800);
}

async function flushCloudSave() {
  do {
    if (cloudSaveTimer) {
      clearTimeout(cloudSaveTimer);
      cloudSaveTimer = null;
    }
    await saveCloudRevision();
  } while (S.cloudDocument && !cloudSaveBlocked &&
    currentMarkdown() !== cloudLastSavedMarkdown);
  return S.cloudDocument;
}

function installCloudSaveHook() {
  if (S._cloudSaveHooked || typeof S.syncAll !== 'function') return;
  var original = S.syncAll;
  S.syncAll = function (source) {
    var result = original.apply(this, arguments);
    if (source !== 'load' && source !== 'theme') queueCloudSave(source);
    return result;
  };
  S._cloudSaveHooked = true;
  S.saveCloudNow = flushCloudSave;
}

async function jsonRequest(url, options) {
  var response = await fetch(url, Object.assign({ credentials: 'same-origin' }, options || {}));
  var data = await response.json().catch(function () { return {}; });
  if (!response.ok) {
    if (data.error === 'trial_payment_required') location.assign('/cloud/subscribe');
    var error = new Error(data.error || 'request_failed');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function loadAccountData(accountId) {
  if (!accountId) {
    var workspaceData = await jsonRequest('/api/cloud/v1/workspaces');
    cloudState.accounts = workspaceData.workspaces || [];
    cloudState.user = workspaceData.user || null;
    var selected = window.SDocsCloudAccountSelection.resolve(
      cloudState.accounts, null, localStorage);
    if (!selected) return { account: null, accounts: cloudState.accounts,
      user: cloudState.user, needs_selection: cloudState.accounts.length > 1 };
    accountId = selected.id;
  }
  window.SDocsCloudAccountSelection.remember(localStorage, accountId);
  var suffix = '?account_id=' + encodeURIComponent(accountId);
  var data = await jsonRequest('/api/cloud/v1/account' + suffix);
  cloudState.singlePlan = Boolean(data.single_plan);
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
  if (S.refreshCommentIdentity) S.refreshCommentIdentity();
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
      await loadAccountData(data.document.workspace_id).catch(function () {});
    }
    S._isDefaultState = false;
    S._loadingDocument = true;
    if (S.resetAllStyles) S.resetAllStyles();
    S.loadText(data.document.markdown, data.document.filename);
    cloudLastSavedMarkdown = currentMarkdown();
    cloudTargetRevisionId = data.document.current_revision_id;
    cloudTargetMarkdown = cloudLastSavedMarkdown;
    cloudRecoveryMarkdown = null;
    cloudSaveBlocked = false;
    if (S.refreshCommentIdentity) S.refreshCommentIdentity();
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

async function checkCloudDocument() {
  if (!S.cloudDocument || cloudSaveBlocked || cloudSavePromise || document.hidden) return null;
  var documentId = S.cloudDocument.id;
  try {
    var headData = await jsonRequest('/api/cloud/v1/documents/' + encodeURIComponent(documentId)
      + '/head?known_revision_id=' + encodeURIComponent(S.cloudDocument.current_revision_id));
    if (!S.cloudDocument || S.cloudDocument.id !== documentId) return null;
    if (headData.document.current_revision_id === S.cloudDocument.current_revision_id && (!headData.document.workspace_id || headData.document.workspace_id === S.cloudDocument.workspace_id)) {
      return headData.document;
    }
    if (currentMarkdown() !== cloudLastSavedMarkdown) {
      queueCloudSave('remote');
      return headData.document;
    }
    var data = await jsonRequest('/api/cloud/v1/documents/' + encodeURIComponent(documentId));
    if (!S.cloudDocument || S.cloudDocument.id !== documentId) return null;
    S.cloudDocument = Object.assign({}, S.cloudDocument, data.document);
    if (cloudState.account && cloudState.account.id !== data.document.workspace_id) await loadAccountData(data.document.workspace_id);
    cloudState.permission = data.permission || cloudState.permission;
    applyCloudMarkdown(data.document.markdown, data.document.filename);
    cloudLastSavedMarkdown = currentMarkdown();
    cloudTargetRevisionId = data.document.current_revision_id;
    cloudTargetMarkdown = cloudLastSavedMarkdown;
    setCloudSaveStatus('Updated from Cloud.');
    refreshRow();
    return data.document;
  } catch (_) {
    return null;
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
      + (cloudState.accounts.length > 1 ? '<button class="sdoc-cloud-lab-access sdoc-cloud-library-pill" type="button" data-cloud-open="library" aria-label="Library: '
        + escapeHtml(cloudState.account && cloudState.account.name || 'Library') + '"><span class="sdoc-cloud-library-icon" style="color:' + window.SDocsCloudAccountSelection.color(S.cloudDocument.workspace_id) + '">' + LIBRARY_SVG + '</span><span>' + escapeHtml(cloudState.account && cloudState.account.name || 'Library') + '</span></button>' : '')
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
  var showPaidIntro = !cloudState.account || !cloudState.account.can_write;
  if (showPaidIntro) row.classList.add('fic-row-cloud-intro');
  row.innerHTML = '<span class="fic-label">Cloud</span>'
    + '<button class="sdoc-cloud-lab-add-link" type="button" title="Add this document to Cloud">Add to Cloud</button>'
    + (showPaidIntro
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

async function beginAdd(event, accountId) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (cloudState.busy) return;
  cloudState.busy = true;
  try {
    var accountData = await loadAccountData(accountId || null);
    if (accountData.needs_selection) {
      openAccountChoice(accountData.accounts, accountData.user);
      return;
    }
    if (!accountData.account) {
      location.href = '/cloud/checkout?return=' +
        encodeURIComponent(location.pathname + location.search + location.hash);
      return;
    }
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
    cloudLastSavedMarkdown = currentMarkdown();
    cloudTargetRevisionId = data.document.current_revision_id;
    cloudTargetMarkdown = cloudLastSavedMarkdown;
    cloudRecoveryMarkdown = null;
    cloudSaveBlocked = false;
    if (S.refreshCommentIdentity) S.refreshCommentIdentity();
    clearLocalDocumentContext();
    // Rebuild the base rows now that Cloud owns the document. This removes
    // the duplicate local tag row before the Cloud row is inserted again.
    if (S.renderFileInfoCard) S.renderFileInfoCard();
    try {
      if (S.updateDocumentLocationNow) await S.updateDocumentLocationNow();
    } catch (_) {
      cloudState.status = 'Added to Cloud, but the address bar could not be updated. Reopen this document from Cloud Library.';
      refreshRow();
      return;
    }
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

function openAccountChoice(accounts, user) {
  var backdrop = ensureDialog();
  var dialog = backdrop.querySelector('.sdoc-cloud-proto-dialog');
  backdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  dialog.innerHTML = shell('Choose an account',
    'This document will be added to the account you select.',
    documentPreview() + '<div class="sdoc-cloud-proto-account-list"></div>'
    + '<div class="sdoc-cloud-proto-actions"><button class="sdoc-cloud-proto-btn" data-action="cancel" type="button">Cancel</button></div>');
  wireClose(dialog);
  dialog.querySelector('[data-action="cancel"]').addEventListener('click', closeDialog);
  var list = dialog.querySelector('.sdoc-cloud-proto-account-list');
  accounts.forEach(function (account) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'sdoc-cloud-proto-btn';
    button.textContent = window.SDocsCloudAccountSelection.label(account, user);
    button.addEventListener('click', function () {
      window.SDocsCloudAccountSelection.remember(localStorage, account.id);
      closeDialog();
      beginAdd(null, account.id);
    });
    list.appendChild(button);
  });
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
  var removed = false;
  try {
    await flushCloudSave();
    await jsonRequest('/api/cloud/v1/documents/' + encodeURIComponent(S.cloudDocument.id), {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_head_revision_id: S.cloudDocument.current_revision_id }),
    });
    removed = true;
    S.cloudDocument = null;
    cloudLastSavedMarkdown = null;
    cloudTargetRevisionId = null;
    cloudTargetMarkdown = null;
    cloudRecoveryMarkdown = null;
    cloudSaveBlocked = false;
    cloudState.permission = null;
    if (S.refreshCommentIdentity) S.refreshCommentIdentity();
    closeCloudPanel();
    // The Markdown still carries its tags after leaving Cloud, so restore the
    // ordinary tag row as part of the same transition.
    if (S.renderFileInfoCard) S.renderFileInfoCard();
    if (S.updateDocumentLocationNow) await S.updateDocumentLocationNow();
    cloudState.status = 'Removed from Cloud. This copy is now local.';
    refreshRow();
  } catch (error) {
    cloudState.status = removed
      ? 'Removed from Cloud, but the local URL could not be updated. Export this document before reloading.'
      : error.data && error.data.error === 'revision_conflict'
        ? 'The Cloud document changed. Reopen it before removing it.'
        : 'The document was not removed from Cloud.';
    if (removed) refreshRow();
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
  function updatePanelViewport() {
    var viewport = window.visualViewport;
    var height = viewport ? viewport.height : window.innerHeight;
    var bottom = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
    panel.style.setProperty('--cloud-visible-height', height + 'px');
    panel.style.setProperty('--cloud-keyboard-offset', bottom + 'px');
  }
  updatePanelViewport();
  window.addEventListener('resize', updatePanelViewport);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updatePanelViewport);
    window.visualViewport.addEventListener('scroll', updatePanelViewport);
  }
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
  if (cloudState.account && (cloudState.singlePlan || cloudState.account.kind === 'team')) {
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

function tagSuggestionsHtml(query) {
  query = String(query || '').trim().replace(/^#+/, '').toLowerCase();
  var tags = documentTags();
  return cloudState.suggestedTags.filter(function (item) {
    return tags.indexOf(item.tag) === -1 && item.tag.toLowerCase().indexOf(query) !== -1;
  }).sort(function (a, b) {
    return b.count - a.count || a.tag.localeCompare(b.tag);
  }).map(function (item) {
    var label = escapeHtml(item.tag);
    if (query) {
      var parts = [], start = 0, index;
      var lower = item.tag.toLowerCase();
      while ((index = lower.indexOf(query, start)) !== -1) {
        parts.push(escapeHtml(item.tag.slice(start, index)), '<mark>',
          escapeHtml(item.tag.slice(index, index + query.length)), '</mark>');
        start = index + query.length;
      }
      parts.push(escapeHtml(item.tag.slice(start)));
      label = parts.join('');
    }
    return '<button class="sdoc-cloud-lab-suggestion" type="button" data-cloud-add-tag="'
      + escapeHtml(item.tag) + '"><span>#' + label + '</span><small>'
      + item.count + ' docs</small></button>';
  }).join('');
}

function tagsPanelHtml() {
  var tags = documentTags();
  var current = tags.length ? tags.map(tagChip).join('')
    : '<span class="sdoc-cloud-lab-no-tags">No tags yet</span>';
  var suggestions = tagSuggestionsHtml('');
  return '<section class="sdoc-cloud-lab-section"><div class="sdoc-cloud-lab-section-title">Current Cloud tags</div>'
    + '<div class="sdoc-cloud-lab-current-tags">' + current + '</div>'
    + '<form class="sdoc-cloud-lab-tag-form"><input type="text" placeholder="Add a tag" aria-label="New Cloud tag">'
    + '<button type="submit">Add</button></form>'
    + '<p class="sdoc-cloud-lab-help">Cloud tags are stored in the Markdown front matter.</p></section>'
    + '<section class="sdoc-cloud-lab-section"><div class="sdoc-cloud-lab-section-title">Used in your account</div>'
      + '<div class="sdoc-cloud-lab-suggestions">' + suggestions + '</div></section>';
}

function libraryPanelHtml() {
  if (!librarySettings) return '<p class="sdoc-cloud-lab-help">Loading libraries...</p>';
  var current = S.cloudDocument.workspace_id;
  var choices = librarySettings.libraries.map(function (library) {
    var chosen = (selectedLibrary || current) === library.id;
    return '<button class="sdoc-cloud-lab-member' + (chosen ? ' selected' : '') + '" type="button" data-library-choice="' + escapeHtml(library.id) + '">'
      + '<span class="sdoc-cloud-library-icon" style="color:' + window.SDocsCloudAccountSelection.color(library.id) + '">' + LIBRARY_SVG + '</span>'
      + '<span class="sdoc-cloud-lab-member-copy"><strong>' + escapeHtml(library.name) + '</strong><span>' + (library.id === current ? 'Current library' : '') + '</span></span></button>';
  }).join('');
  var canMove = cloudState.permission && cloudState.permission.can_manage && selectedLibrary && selectedLibrary !== current;
  var destination = librarySettings.libraries.find(function (library) { return library.id === selectedLibrary; });
  var machines = librarySettings.machines.map(function (machine) {
    return '<label class="sdoc-cloud-library-machine">' + escapeHtml(machine.display_name) + '<select data-library-machine="' + escapeHtml(machine.id) + '"><option value="">Ask when needed</option>'
      + librarySettings.libraries.map(function (library) { return '<option value="' + escapeHtml(library.id) + '"' + (machine.default_library_id === library.id ? ' selected' : '') + '>' + escapeHtml(library.name) + '</option>'; }).join('') + '</select></label>';
  }).join('');
  return '<section class="sdoc-cloud-lab-section"><div class="sdoc-cloud-lab-section-title">This document</div><div class="sdoc-cloud-lab-members">' + choices + '</div>'
    + (canMove ? '<p class="sdoc-cloud-lab-help">Move this document and its history to ' + escapeHtml(destination.name) + '. Its link stays the same. Access will be reset to Only you; people in the old library will lose access.</p><button type="button" class="sdoc-cloud-library-move">Move document</button>' : '')
    + (!cloudState.permission || !cloudState.permission.can_manage ? '<p class="sdoc-cloud-lab-help">Only the person who created this document can move it.</p>' : '')
    + '</section><section class="sdoc-cloud-lab-section"><div class="sdoc-cloud-lab-section-title">Default for new documents</div>'
    + (machines || '<p class="sdoc-cloud-lab-help">Connect a computer to set its default library.</p>')
    + '<p class="sdoc-cloud-lab-help">Applies to new documents from that computer. Existing documents stay in their libraries. A library specified by you or your project takes priority.</p></section>';
}

function renderCloudPanel() {
  var panel = ensureCloudPanel();
  panel.dataset.cloudPanel = cloudState.panel;
  panel.querySelector('[data-cloud-panel-title]').textContent = cloudState.panel === 'library' ? 'Library' : cloudState.panel === 'tags' ? 'Tags' : 'Access';
  var body = panel.querySelector('.sdoc-cloud-lab-panel-body');
  body.innerHTML = (cloudState.panel === 'library' ? libraryPanelHtml() : cloudState.panel === 'tags' ? tagsPanelHtml() : accessPanelHtml())
    + (cloudState.status ? '<p class="sdoc-cloud-lab-status" aria-live="polite">'
      + escapeHtml(cloudState.status) + '</p>' : '');
  wireCloudPanel(body);
}

function wireCloudPanel(body) {
  body.querySelectorAll('[data-library-choice]').forEach(function (button) {
    button.disabled = cloudState.busy;
    button.addEventListener('click', function () { selectedLibrary = button.dataset.libraryChoice; renderCloudPanel(); });
  });
  body.querySelectorAll('[data-library-machine]').forEach(function (select) {
    select.addEventListener('change', async function () {
      select.disabled = true;
      try {
        await jsonRequest('/api/cloud/v1/cli/credentials/' + encodeURIComponent(select.dataset.libraryMachine) + '/library-default', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: select.value || null }) });
        librarySettings = await jsonRequest('/api/cloud/v1/library-settings');
        cloudState.status = 'Default library updated.';
      } catch (_) { cloudState.status = 'The default library could not be updated.'; }
      renderCloudPanel();
    });
  });
  var move = body.querySelector('.sdoc-cloud-library-move');
  if (move) { move.disabled = cloudState.busy; move.addEventListener('click', async function () {
    if (cloudState.busy) return;
    cloudState.busy = true; renderCloudPanel();
    try {
      await flushCloudSave();
      var moved = await jsonRequest('/api/cloud/v1/documents/' + encodeURIComponent(S.cloudDocument.id) + '/library', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: selectedLibrary, expected_head_revision_id: S.cloudDocument.current_revision_id }) });
      S.cloudDocument = moved.document; cloudState.permission = moved.permission;
      await loadAccountData(moved.document.workspace_id);
      cloudState.status = 'Document moved. Access is Only you.';
    } catch (_) { cloudState.status = 'The document could not be moved. Reload and try again.'; }
    cloudState.busy = false; refreshRow(); renderCloudPanel();
  }); }

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
  var suggestions = body.querySelector('.sdoc-cloud-lab-suggestions');
  if (suggestions) suggestions.addEventListener('click', function (event) {
    var button = event.target.closest('[data-cloud-add-tag]');
    if (button) addCloudTag(button.getAttribute('data-cloud-add-tag'));
  });
  var tagForm = body.querySelector('.sdoc-cloud-lab-tag-form');
  if (tagForm) tagForm.querySelector('input').addEventListener('input', function (event) {
    suggestions.innerHTML = tagSuggestionsHtml(event.target.value);
  });
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
    await flushCloudSave();
    var markdownBeforeTags = currentMarkdown();
    var targetRevisionId = cloudTargetRevisionId || S.cloudDocument.current_revision_id;
    var data = await jsonRequest('/api/cloud/v1/documents/' + encodeURIComponent(S.cloudDocument.id)
      + '/tags', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: tags, filename: currentFilename(),
          target_revision_id: targetRevisionId, target_markdown: cloudTargetMarkdown,
          idempotency_key: crypto.randomUUID() }) });
    S.cloudDocument = Object.assign({}, S.cloudDocument, data.document);
    var savedMarkdown = typeof data.document.markdown === 'string'
      ? data.document.markdown : null;
    if (currentMarkdown() === markdownBeforeTags && savedMarkdown) {
      applyCloudMarkdown(savedMarkdown, data.document.filename || currentFilename());
      cloudLastSavedMarkdown = currentMarkdown();
      cloudTargetMarkdown = cloudLastSavedMarkdown;
    } else {
      if (!S.currentMeta) S.currentMeta = {};
      S.currentMeta.tags = data.document.tags.slice();
      cloudLastSavedMarkdown = savedMarkdown || currentMarkdown();
      if (savedMarkdown && currentMarkdown() !== savedMarkdown) queueCloudSave('remote');
    }
    cloudTargetRevisionId = data.document.current_revision_id;
    cloudState.status = data.document.combined
      ? 'Tags updated and combined with Cloud changes.' : 'Tags updated.';
    await loadAccountData(cloudState.account.id);
  } catch (_) { cloudState.status = 'Tags were not updated.'; }
  cloudState.busy = false;
  refreshRow();
  renderCloudPanel();
}

function openCloudPanel(kind) {
  cloudState.panel = kind === 'library' ? 'library' : kind === 'tags' ? 'tags' : 'access';
  if (kind === 'library') {
    selectedLibrary = S.cloudDocument && S.cloudDocument.workspace_id; librarySettings = null;
    jsonRequest('/api/cloud/v1/library-settings').then(function (data) { librarySettings = data; if (cloudState.panel === 'library') renderCloudPanel(); })
      .catch(function () { cloudState.status = 'Libraries could not be loaded.'; renderCloudPanel(); });
  }
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

function openErrorDialog(message) {
  var backdrop = ensureDialog();
  var dialog = backdrop.querySelector('.sdoc-cloud-proto-dialog');
  backdrop.hidden = false;
  dialog.innerHTML = shell('Cloud unavailable', message,
    '<div class="sdoc-cloud-proto-actions"><button class="sdoc-cloud-proto-btn primary" data-action="done" type="button">Close</button></div>');
  wireClose(dialog);
  dialog.querySelector('[data-action="done"]').addEventListener('click', closeDialog);
}

function recoveryFilename() {
  var filename = currentFilename().replace(/[\\/]/g, '_');
  var extensionAt = filename.lastIndexOf('.');
  if (extensionAt <= 0) return filename + '-recovered.md';
  return filename.slice(0, extensionAt) + '-recovered' + filename.slice(extensionAt);
}

function downloadRecovery(markdown) {
  var link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
  link.download = recoveryFilename();
  link.click();
  URL.revokeObjectURL(link.href);
}

function openRecoveryDialog() {
  var backdrop = ensureDialog();
  var dialog = backdrop.querySelector('.sdoc-cloud-proto-dialog');
  backdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  dialog.innerHTML = shell('Cloud could not combine your edits',
    'The earlier version needed to combine your edits with the latest Cloud copy is no longer available.',
    documentPreview()
    + '<p class="sdoc-cloud-proto-recovery">Your edits have not been saved to Cloud. They are still open here, but opening the latest Cloud copy will replace them. Copy or download them first.</p>'
    + '<div class="sdoc-cloud-proto-actions sdoc-cloud-proto-recovery-actions">'
    + '<button class="sdoc-cloud-proto-btn" data-action="copy-recovery" type="button">Copy my edits</button>'
    + '<button class="sdoc-cloud-proto-btn" data-action="download-recovery" type="button">Download my edits</button>'
    + '<button class="sdoc-cloud-proto-btn primary" data-action="open-latest" type="button">Replace with latest Cloud copy</button>'
    + '</div>');
  wireClose(dialog);
  dialog.querySelector('[data-action="copy-recovery"]').addEventListener('click', function () {
    var button = this;
    cloudRecoveryMarkdown = currentMarkdown();
    navigator.clipboard.writeText(cloudRecoveryMarkdown).then(function () {
      button.textContent = 'Copied';
    }).catch(function () {
      setCloudSaveStatus('Could not copy your edits. Download them instead.', 'error');
    });
  });
  dialog.querySelector('[data-action="download-recovery"]').addEventListener('click', function () {
    cloudRecoveryMarkdown = currentMarkdown();
    downloadRecovery(cloudRecoveryMarkdown);
    this.textContent = 'Download started';
  });
  dialog.querySelector('[data-action="open-latest"]').addEventListener('click', async function () {
    var documentId = S.cloudDocument && S.cloudDocument.id;
    if (!documentId) return;
    this.disabled = true;
    this.textContent = 'Replacing...';
    await loadCloudDocument(documentId);
    if (!cloudSaveBlocked) {
      closeDialog();
      setCloudSaveStatus('Opened the latest Cloud copy.');
    } else {
      this.disabled = false;
      this.textContent = 'Try replacing again';
    }
  });
}

function closeDialog() {
  var backdrop = document.querySelector('.sdoc-cloud-proto-backdrop');
  if (backdrop) backdrop.hidden = true;
  document.body.style.overflow = '';
}

function start() {
  installCloudSaveHook();
  S.checkCloudNow = checkCloudDocument;
  if (!cloudPollTimer) {
    cloudPollTimer = setInterval(checkCloudDocument, 10000);
    window.addEventListener('focus', checkCloudDocument);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkCloudDocument();
    });
  }
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
