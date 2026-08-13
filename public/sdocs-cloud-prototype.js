// Local UX prototype for adding the current document to SmallDocs Cloud.
// It is inert unless the page URL includes cloud-demo=1. No network writes.
(function () {
'use strict';

var queryParams = new URLSearchParams(location.search);
var hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
var isLocalDemo = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
if (!isLocalDemo && queryParams.get('cloud-demo') !== '1' && hashParams.get('cloud-demo') !== '1') return;

var STORAGE_KEY = 'sdocs.cloud.prototype.v3';
var CLOUD_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>';
var CLOUD_UPLOAD_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 13v8"/><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="m8 17 4-4 4 4"/></svg>';
var CLOUD_CHECK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 15-5.5 5.5L9 18"/><path d="M5.516 16.07A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 3.501 7.327"/></svg>';
var FILE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';

function readState() {
  try {
    var value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      signedIn: value.signedIn === true,
      email: typeof value.email === 'string' ? value.email : '',
      saved: value.saved === true,
      project: typeof value.project === 'string' ? value.project : 'Personal / My documents',
    };
  } catch (_) {
    return { signedIn: false, email: '', saved: false, project: 'Personal / My documents' };
  }
}

var state = readState();

function writeState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
}

function currentFilename() {
  var meta = window.SDocs && window.SDocs.currentMeta ? window.SDocs.currentMeta : {};
  if (meta.file) return String(meta.file);
  var heading = document.querySelector('#_sd_rendered h1');
  if (heading && heading.textContent.trim()) return heading.textContent.trim() + '.md';
  return 'Untitled document.md';
}

function cloudRow() {
  var row = document.createElement('div');
  row.className = 'fic-row fic-row-cloud fic-row-short-intro';
  row.dataset.state = state.saved ? 'saved' : 'local';
  if (state.saved) {
    row.innerHTML = ''
      + '<span class="fic-label">Cloud</span>'
      + '<span class="fic-value">' + escapeHtml(state.project) + '</span>'
      + '<button class="fic-copy fic-cloud-icon fic-cloud-saved-icon" type="button" title="Open Cloud document">' + CLOUD_CHECK_SVG + '</button>';
    row.querySelector('.fic-cloud-icon').addEventListener('click', openDialog);
    return row;
  }
  row.innerHTML = ''
    + '<span class="fic-label">Cloud</span>'
    + '<button class="fic-shorten-button fic-cloud-add" type="button" title="Add this document to Cloud">Add to Cloud</button>'
    + '<span class="fic-short-intro-text">Encrypted document on our server; paid feature '
    +   '(<a class="fic-short-intro-learn fic-cloud-learn" href="/cloud" target="_blank" rel="noopener">learn more</a>)'
    + '</span>'
    + '<button class="fic-copy fic-cloud-icon" type="button" title="Add this document to Cloud">' + CLOUD_UPLOAD_SVG + '</button>';
  function triggerAdd(event) {
    event.preventDefault();
    event.stopPropagation();
    if (state.signedIn) openDialog();
    else renderEmailPrompt(row);
  }
  row.querySelector('.fic-cloud-add').addEventListener('click', triggerAdd);
  row.querySelector('.fic-cloud-icon').addEventListener('click', triggerAdd);
  return row;
}

function renderEmailPrompt(row) {
  row.className = 'fic-row fic-row-cloud fic-row-cloud-auth';
  row.innerHTML = ''
    + '<span class="fic-label">Cloud</span>'
    + '<form class="fic-cloud-auth-fields">'
    +   '<input class="fic-cloud-email" type="email" autocomplete="email" placeholder="you@example.com" aria-label="Email address" value="' + escapeHtml(state.email) + '" required>'
    +   '<button class="fic-cloud-send" type="submit">Email me a code</button>'
    +   '<button class="fic-cloud-cancel" type="button">Cancel</button>'
    + '</form>'
    + '<button class="fic-copy fic-cloud-icon" type="submit" title="Email me a code">' + CLOUD_UPLOAD_SVG + '</button>';
  var form = row.querySelector('form');
  var input = row.querySelector('.fic-cloud-email');
  var icon = row.querySelector('.fic-cloud-icon');
  function submit(event) {
    event.preventDefault();
    if (!input.checkValidity()) { input.reportValidity(); return; }
    state.email = input.value.trim();
    writeState();
    renderEmailSent(row);
  }
  form.addEventListener('submit', submit);
  icon.addEventListener('click', submit);
  row.querySelector('.fic-cloud-cancel').addEventListener('click', refreshRow);
  setTimeout(function () { input.focus(); }, 0);
}

function renderEmailSent(row) {
  row.className = 'fic-row fic-row-cloud fic-row-cloud-auth fic-cloud-email-sent';
  row.innerHTML = ''
    + '<span class="fic-label">Cloud</span>'
    + '<span class="fic-cloud-sent-copy"><strong>Check your email</strong><span>Sign-in link sent to ' + escapeHtml(state.email) + '. This document has not been uploaded.</span></span>'
    + '<button class="fic-cloud-demo-link" type="button">Use demo link</button>'
    + '<button class="fic-copy fic-cloud-icon" type="button" title="Waiting for sign-in">' + CLOUD_UPLOAD_SVG + '</button>';
  row.querySelector('.fic-cloud-demo-link').addEventListener('click', function () {
    state.signedIn = true;
    writeState();
    refreshRow();
    openDialog();
  });
}

function insertRow() {
  var card = document.getElementById('_sd_sdocs-file-info');
  var rows = card && card.querySelector('.fic-rows');
  if (!card || !rows || rows.querySelector('.fic-row-cloud')) return;
  var row = cloudRow();
  var filename = rows.querySelector('[data-key="file"]');
  if (filename && filename.nextSibling) rows.insertBefore(row, filename.nextSibling);
  else if (filename) rows.appendChild(row);
  else rows.insertBefore(row, rows.firstChild);
  rows.hidden = false;
  card.hidden = false;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function ensureDialog() {
  var existing = document.querySelector('.sdoc-cloud-proto-backdrop');
  if (existing) return existing;
  var backdrop = document.createElement('div');
  backdrop.className = 'sdoc-cloud-proto-backdrop';
  backdrop.hidden = true;
  backdrop.innerHTML = '<section class="sdoc-cloud-proto-dialog" role="dialog" aria-modal="true" aria-labelledby="sdoc-cloud-proto-title"></section>';
  backdrop.addEventListener('click', function (event) {
    if (event.target === backdrop) closeDialog();
  });
  document.body.appendChild(backdrop);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !backdrop.hidden) closeDialog();
  });
  return backdrop;
}

function shell(title, subtitle, body) {
  return ''
    + '<header class="sdoc-cloud-proto-head">'
    +   '<span class="sdoc-cloud-proto-mark">' + CLOUD_SVG + '</span>'
    +   '<div><h2 class="sdoc-cloud-proto-title" id="sdoc-cloud-proto-title">' + escapeHtml(title) + '</h2>'
    +   '<p class="sdoc-cloud-proto-subtitle">' + escapeHtml(subtitle) + '</p></div>'
    +   '<button class="sdoc-cloud-proto-close" type="button" aria-label="Close">&times;</button>'
    + '</header>'
    + '<div class="sdoc-cloud-proto-body">' + body + '</div>';
}

function documentPreview() {
  var tags = window.SDocs && window.SDocs.currentMeta && Array.isArray(window.SDocs.currentMeta.tags)
    ? window.SDocs.currentMeta.tags.length + ' tags'
    : 'Markdown document';
  return '<div class="sdoc-cloud-proto-doc">' + FILE_SVG
    + '<div class="sdoc-cloud-proto-doc-text"><div class="sdoc-cloud-proto-doc-title">' + escapeHtml(currentFilename()) + '</div>'
    + '<div class="sdoc-cloud-proto-doc-meta">' + escapeHtml(tags) + '</div></div></div>';
}

function renderAccountStep(dialog) {
  dialog.innerHTML = shell(
    'Add this document to Cloud',
    'Open it on another device, share it with a team, or let an authorized agent work with it.',
    documentPreview()
      + '<div class="sdoc-cloud-proto-allowance"><strong>Cloud</strong><span>Paid account required</span><small>Signing in does not upload this document.</small></div>'
      + '<label class="sdoc-cloud-proto-label" for="sdoc-cloud-email">Work or personal email</label>'
      + '<input class="sdoc-cloud-proto-input" id="sdoc-cloud-email" type="email" autocomplete="email" placeholder="you@example.com" value="' + escapeHtml(state.email) + '">'
      + '<div class="sdoc-cloud-proto-actions"><button class="sdoc-cloud-proto-btn" data-action="cancel" type="button">Cancel</button><button class="sdoc-cloud-proto-btn primary" data-action="continue" type="button">Continue</button></div>'
      + '<p class="sdoc-cloud-proto-note">We will email a six-digit code. Creating an account does not upload this document until you confirm the project.</p>'
  );
  wireClose(dialog);
  dialog.querySelector('[data-action="cancel"]').addEventListener('click', closeDialog);
  var email = dialog.querySelector('#sdoc-cloud-email');
  var advance = function () {
    if (!email.value.trim() || !email.checkValidity()) { email.focus(); email.reportValidity(); return; }
    state.email = email.value.trim();
    state.signedIn = true;
    writeState();
    renderProjectStep(dialog);
  };
  dialog.querySelector('[data-action="continue"]').addEventListener('click', advance);
  email.addEventListener('keydown', function (event) { if (event.key === 'Enter') advance(); });
  setTimeout(function () { email.focus(); }, 0);
}

function renderProjectStep(dialog) {
  dialog.innerHTML = shell(
    'Choose where it belongs',
    'The document will be added as the first Cloud revision. Your local file remains where it is.',
    documentPreview()
      + '<label class="sdoc-cloud-proto-label" for="sdoc-cloud-project">Project</label>'
      + '<select class="sdoc-cloud-proto-select" id="sdoc-cloud-project"><option>Personal / My documents</option><option>Product / Planning</option><option>Team / Shared docs</option></select>'
      + '<div class="sdoc-cloud-proto-actions"><button class="sdoc-cloud-proto-btn" data-action="back" type="button">Cancel</button><button class="sdoc-cloud-proto-btn primary" data-action="add" type="button">Add document</button></div>'
      + '<p class="sdoc-cloud-proto-note">Stored encrypted. SmallDocs decrypts it in memory when an authorized person or agent opens or searches it.</p>'
  );
  wireClose(dialog);
  var select = dialog.querySelector('#sdoc-cloud-project');
  select.value = state.project;
  dialog.querySelector('[data-action="back"]').addEventListener('click', closeDialog);
  dialog.querySelector('[data-action="add"]').addEventListener('click', function (event) {
    state.project = select.value;
    var button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Adding...';
    setTimeout(function () {
      state.saved = true;
      writeState();
      renderSuccess(dialog);
      refreshRow();
    }, 650);
  });
}

function renderSuccess(dialog) {
  dialog.innerHTML = shell(
    'Document added to Cloud',
    state.project,
    '<div class="sdoc-cloud-proto-success"><div class="sdoc-cloud-proto-success-icon"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m20 6-11 11-5-5"/></svg></div>'
      + '<h3>' + escapeHtml(currentFilename()) + '</h3><p>This browser is now showing the Cloud document. Your original local file has not been replaced.</p>'
      + '<div class="sdoc-cloud-proto-actions"><button class="sdoc-cloud-proto-btn" data-action="library" type="button">Open library</button><button class="sdoc-cloud-proto-btn primary" data-action="done" type="button">Done</button></div></div>'
  );
  wireClose(dialog);
  dialog.querySelector('[data-action="done"]').addEventListener('click', closeDialog);
  dialog.querySelector('[data-action="library"]').addEventListener('click', function () {
    alert('Prototype: this would open the unified Library with Cloud selected.');
  });
}

function renderSaved(dialog) {
  dialog.innerHTML = shell(
    'Cloud document',
    state.project,
    documentPreview()
      + '<div class="sdoc-cloud-proto-success"><div class="sdoc-cloud-proto-success-icon"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m20 6-11 11-5-5"/></svg></div>'
      + '<h3>Saved in Cloud</h3><p>Revision 1 is available to authorized people and agents in this project.</p>'
      + '<div class="sdoc-cloud-proto-actions"><button class="sdoc-cloud-proto-btn" data-action="reset" type="button">Reset prototype</button><button class="sdoc-cloud-proto-btn primary" data-action="done" type="button">Done</button></div></div>'
  );
  wireClose(dialog);
  dialog.querySelector('[data-action="done"]').addEventListener('click', closeDialog);
  dialog.querySelector('[data-action="reset"]').addEventListener('click', function () {
    state = { signedIn: false, email: '', saved: false, project: 'Personal / My documents' };
    writeState();
    refreshRow();
    closeDialog();
  });
}

function wireClose(dialog) {
  dialog.querySelector('.sdoc-cloud-proto-close').addEventListener('click', closeDialog);
}

function openDialog() {
  var backdrop = ensureDialog();
  var dialog = backdrop.querySelector('.sdoc-cloud-proto-dialog');
  backdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  if (state.saved) renderSaved(dialog);
  else if (state.signedIn) renderProjectStep(dialog);
  else renderAccountStep(dialog);
}

function closeDialog() {
  var backdrop = document.querySelector('.sdoc-cloud-proto-backdrop');
  if (backdrop) backdrop.hidden = true;
  document.body.style.overflow = '';
}

function refreshRow() {
  var existing = document.querySelector('.fic-row-cloud');
  if (existing) existing.remove();
  insertRow();
}

function startPrototype() {
  var card = document.getElementById('_sd_sdocs-file-info');
  if (card) {
    var observer = new MutationObserver(function () { insertRow(); });
    observer.observe(card, { childList: true, subtree: true });
  }
  insertRow();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startPrototype);
else startPrototype();
})();
