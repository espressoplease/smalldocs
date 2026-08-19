// Interactive Cloud account, access, and tag prototype.
(function () {
'use strict';

var params = new URLSearchParams(window.location.search);
var hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
var prototypeRequested = params.get('cloud-ui-prototype') === '1'
  || hashParams.get('cloud-ui-prototype') === '1';
if (!prototypeRequested) return;
if (hashParams.get('cloud-ui-prototype') !== '1') {
  hashParams.set('cloud-ui-prototype', '1');
  history.replaceState(null, '', window.location.pathname + window.location.search + '#'
    + hashParams.toString());
}

var S = window.SDocs = window.SDocs || {};
var USER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>';
var USERS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/></svg>';
var CLOUD_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>';
var PLUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
var CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 6-11 11-5-5"/></svg>';
var CLOUD_UPLOAD_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 13v8"/><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="m8 17 4-4 4 4"/></svg>';
var CLOUD_CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m17 15-5.5 5.5L9 18"/><path d="M5.516 16.07A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 3.501 7.327"/></svg>';
var CLOSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

var members = [
  { id: 'you', name: 'Josh Summers', short: 'You', initials: 'JS', email: 'josh@example.com' },
  { id: 'tom', name: 'Tom Smith', short: 'TS', initials: 'TS', email: 'tom@example.com' },
  { id: 'lenny', name: 'Lenny Thompson', short: 'LT', initials: 'LT', email: 'lenny@example.com' },
  { id: 'dan', name: 'Dan Stow', short: 'DS', initials: 'DS', email: 'dan@example.com' },
  { id: 'sara', name: 'Sara Mercer', short: 'SM', initials: 'SM', email: 'sara@example.com' },
];

var state = {
  account: params.get('prototype-account') === 'personal' ? 'personal' : 'team',
  saved: params.get('prototype-saved') === '1',
  selected: ['you'],
  tags: [],
  tagsReady: false,
  panel: null,
  saveMessage: '',
  pending: [],
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (character) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
  });
}

function activeMembers() {
  return state.account === 'personal' ? members.slice(0, 1) : members;
}

function selectedMembers() {
  return activeMembers().filter(function (member) { return state.selected.indexOf(member.id) !== -1; });
}

function initialiseTags() {
  if (state.tagsReady || !S.currentBody) return;
  var current = S.currentMeta && Array.isArray(S.currentMeta.tags)
    ? S.currentMeta.tags.map(String).filter(Boolean) : [];
  state.tags = current.slice(0, 5);
  state.tagsReady = true;
}

function permissionLabel() {
  var selected = selectedMembers();
  if (selected.length <= 1) return 'You';
  if (selected.length === activeMembers().length) return 'Everyone';
  var labels = selected.slice(0, 4).map(function (member) { return member.short; });
  if (selected.length > 4) labels.push('+' + (selected.length - 4));
  return labels.join(', ');
}

function permissionNames() {
  return selectedMembers().map(function (member) {
    return member.id === 'you' ? member.name + ' (you)' : member.name;
  }).join('\n');
}

function permissionIcon() {
  return selectedMembers().length > 1 ? USERS_SVG : USER_SVG;
}

function makeCloudTag(tag) {
  return '<button class="sdoc-cloud-lab-tag" type="button" data-cloud-lab-open="tags"'
    + ' aria-label="Edit Cloud tag ' + escapeHtml(tag) + '">' + CLOUD_SVG
    + '<span>#' + escapeHtml(tag) + '</span></button>';
}

function makeRow() {
  initialiseTags();
  var row = document.createElement('div');
  row.className = 'fic-row fic-row-cloud fic-row-cloud-lab';
  row.setAttribute('data-prototype-account', state.account);
  row.setAttribute('data-prototype-saved', String(state.saved));
  if (!state.saved) {
    row.innerHTML = '<span class="fic-label">Cloud</span>'
      + '<button class="sdoc-cloud-lab-add-link" type="button">Add to Cloud</button>'
      + '<button class="sdoc-cloud-lab-state-icon sdoc-cloud-lab-upload" type="button"'
      + ' aria-label="Upload to Cloud" title="Add to Cloud">' + CLOUD_UPLOAD_SVG + '</button>';
    row.querySelectorAll('.sdoc-cloud-lab-add-link, .sdoc-cloud-lab-upload').forEach(function (button) {
      button.addEventListener('click', addToCloud);
    });
    return row;
  }
  var tags = state.tags.map(makeCloudTag).join('');
  row.innerHTML = '<span class="fic-label">Cloud</span>'
    + '<div class="sdoc-cloud-lab-row-main">'
    + '<div class="sdoc-cloud-lab-pills">'
    + '<button class="sdoc-cloud-lab-access" type="button" data-cloud-lab-open="access"'
    + ' data-tip="' + escapeHtml(permissionNames()).replace(/\n/g, ' · ') + '"'
    + ' title="' + escapeHtml(permissionNames()).replace(/\n/g, ' · ') + '">'
    + permissionIcon() + '<span>' + escapeHtml(permissionLabel()) + '</span></button>'
    + (tags || '<span class="sdoc-cloud-lab-no-tags">No tags</span>')
    + '<button class="sdoc-cloud-lab-plus" type="button" data-cloud-lab-open="tags" aria-label="Edit Cloud tags">'
    + PLUS_SVG + '</button></div>'
    + '</div>'
    + '<button class="sdoc-cloud-lab-state-icon sdoc-cloud-lab-saved" type="button"'
    + ' aria-label="Remove from Cloud" title="Remove from Cloud">' + CLOUD_CHECK_SVG + '</button>';

  row.querySelectorAll('[data-cloud-lab-open]').forEach(function (button) {
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      openPanel(button.getAttribute('data-cloud-lab-open'));
    });
  });
  row.querySelector('.sdoc-cloud-lab-saved').addEventListener('click', removeFromCloud);
  if (S.attachTooltips) S.attachTooltips(row);
  return row;
}

function addToCloud(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  state.saved = true;
  state.saveMessage = 'Prototype saved. No document or account data changed.';
  refreshRow();
  if (state.panel) renderPanel();
}

function removeFromCloud(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  state.saved = false;
  state.saveMessage = 'Removed from the prototype. No document or account data changed.';
  closePanel();
  refreshRow();
}

function insertRow() {
  var card = document.getElementById('_sd_sdocs-file-info');
  var rows = card && card.querySelector('.fic-rows');
  if (!card || !rows || !S.currentBody) return;
  var existing = rows.querySelector('.fic-row-cloud');
  if (existing && existing.classList.contains('fic-row-cloud-lab')) return;
  if (existing) existing.remove();
  var row = makeRow();
  var filename = rows.querySelector('[data-key="file"]');
  if (filename && filename.nextSibling) rows.insertBefore(row, filename.nextSibling);
  else if (filename) rows.appendChild(row);
  else rows.insertBefore(row, rows.firstChild);
  rows.hidden = false;
  card.hidden = false;
}

function refreshRow() {
  var existing = document.querySelector('.fic-row-cloud-lab');
  if (!existing || !existing.parentNode) return insertRow();
  existing.parentNode.replaceChild(makeRow(), existing);
}

function ensurePanel() {
  var panel = document.getElementById('_sd_cloud-lab-panel');
  if (panel) return panel;
  panel = document.createElement('aside');
  panel.id = '_sd_cloud-lab-panel';
  panel.setAttribute('aria-label', 'Cloud prototype controls');
  panel.innerHTML = '<header class="sdoc-cloud-lab-panel-head">'
    + '<div><span class="sdoc-cloud-lab-eyebrow">UI prototype</span>'
    + '<strong data-cloud-lab-panel-title>Cloud</strong></div>'
    + '<button class="sdoc-cloud-lab-close" type="button" aria-label="Close Cloud panel">' + CLOSE_SVG + '</button>'
    + '</header><div class="sdoc-cloud-lab-panel-body"></div>';
  document.getElementById('_sd_main').appendChild(panel);
  panel.querySelector('.sdoc-cloud-lab-close').addEventListener('click', closePanel);
  panel.querySelector('.sdoc-cloud-lab-panel-head').addEventListener('click', function (event) {
    if (window.innerWidth <= 768 && !event.target.closest('button')) {
      document.body.classList.toggle('mobile-cloud-lab-open');
    }
  });
  return panel;
}

function prototypeControls() {
  return '<section class="sdoc-cloud-lab-fixture" aria-label="Prototype state">'
    + '<div class="sdoc-cloud-lab-fixture-head"><strong>Prototype state</strong>'
    + '<span>Nothing here is saved</span></div>'
    + '<div class="sdoc-cloud-lab-segment" role="group" aria-label="Account type">'
    + '<button type="button" data-cloud-lab-account="personal" class="' + (state.account === 'personal' ? 'active' : '') + '">Just me</button>'
    + '<button type="button" data-cloud-lab-account="team" class="' + (state.account === 'team' ? 'active' : '') + '">My team</button></div>'
    + '<div class="sdoc-cloud-lab-segment" role="group" aria-label="Document location">'
    + '<button type="button" data-cloud-lab-saved="false" class="' + (!state.saved ? 'active' : '') + '">Local</button>'
    + '<button type="button" data-cloud-lab-saved="true" class="' + (state.saved ? 'active' : '') + '">In Cloud</button></div>'
    + '</section>';
}

function accessPanelHtml() {
  var people = activeMembers().map(function (member) {
    var checked = state.selected.indexOf(member.id) !== -1;
    return '<label class="sdoc-cloud-lab-member' + (checked ? ' selected' : '') + '">'
      + '<input type="checkbox" data-cloud-lab-member="' + member.id + '"'
      + (checked ? ' checked' : '') + (member.id === 'you' ? ' disabled' : '') + '>'
      + '<span class="sdoc-cloud-lab-avatar">' + escapeHtml(member.initials) + '</span>'
      + '<span class="sdoc-cloud-lab-member-copy"><strong>' + escapeHtml(member.name)
      + (member.id === 'you' ? ' <small>You</small>' : '') + '</strong><span>' + escapeHtml(member.email) + '</span></span>'
      + '<span class="sdoc-cloud-lab-check">' + CHECK_SVG + '</span></label>';
  }).join('');
  var invite = state.account === 'team'
    ? '<section class="sdoc-cloud-lab-section"><div class="sdoc-cloud-lab-section-title">Invite someone</div>'
      + '<form class="sdoc-cloud-lab-invite"><input type="email" placeholder="person@example.com" aria-label="Email address" required>'
      + '<button type="submit">Invite</button></form>'
      + '<p class="sdoc-cloud-lab-help">The team price increases by £7 per month after they accept.</p>'
      + pendingHtml() + '</section>'
    : '<section class="sdoc-cloud-lab-section"><div class="sdoc-cloud-lab-empty">'
      + USERS_SVG + '<strong>Just you</strong><span>Choose My team during signup to invite people.</span></div></section>';
  return prototypeControls()
    + '<section class="sdoc-cloud-lab-section"><div class="sdoc-cloud-lab-section-title">Quick choices</div>'
    + '<div class="sdoc-cloud-lab-presets"><button type="button" data-cloud-lab-preset="only">' + USER_SVG + 'Only you</button>'
    + (state.account === 'team' ? '<button type="button" data-cloud-lab-preset="everyone">' + USERS_SVG + 'Everyone</button>' : '')
    + '</div></section>'
    + '<section class="sdoc-cloud-lab-section"><div class="sdoc-cloud-lab-section-title">People with access</div>'
    + '<div class="sdoc-cloud-lab-members">' + people + '</div>'
    + '<p class="sdoc-cloud-lab-help">The owner always keeps access. This selection applies to this document.</p></section>'
    + invite;
}

function pendingHtml() {
  if (!state.pending.length) return '';
  return '<div class="sdoc-cloud-lab-pending">' + state.pending.map(function (email) {
    return '<div><span class="sdoc-cloud-lab-avatar pending">?</span><span><strong>' + escapeHtml(email)
      + '</strong><small>Invitation pending</small></span></div>';
  }).join('') + '</div>';
}

function tagChipHtml(tag) {
  return '<span class="sdoc-cloud-lab-tag-edit">' + CLOUD_SVG + '<span>#' + escapeHtml(tag) + '</span>'
    + '<button type="button" data-cloud-lab-remove-tag="' + escapeHtml(tag) + '" aria-label="Remove ' + escapeHtml(tag) + '">'
    + CLOSE_SVG + '</button></span>';
}

function suggestionButton(tag, count, kind) {
  return '<button class="sdoc-cloud-lab-suggestion" type="button" data-cloud-lab-add-tag="' + escapeHtml(tag) + '">'
    + '<span>#' + escapeHtml(tag) + '</span><small>' + count + ' ' + kind + '</small></button>';
}

function tagsPanelHtml() {
  var current = state.tags.length
    ? state.tags.map(tagChipHtml).join('')
    : '<span class="sdoc-cloud-lab-no-tags">No tags yet</span>';
  var team = state.account === 'team'
    ? '<section class="sdoc-cloud-lab-section"><div class="sdoc-cloud-lab-section-title">Used in accessible team documents</div>'
      + '<div class="sdoc-cloud-lab-suggestions">'
      + suggestionButton('product', 18, 'docs') + suggestionButton('launch', 12, 'docs')
      + suggestionButton('research', 7, 'docs') + '</div></section>' : '';
  return prototypeControls()
    + '<section class="sdoc-cloud-lab-section"><div class="sdoc-cloud-lab-section-title">Current Cloud tags</div>'
    + '<div class="sdoc-cloud-lab-current-tags">' + current + '</div>'
    + '<form class="sdoc-cloud-lab-tag-form"><input type="text" placeholder="Add a tag" aria-label="New Cloud tag">'
    + '<button type="submit">Add</button></form>'
    + '<p class="sdoc-cloud-lab-help">The tag names stay the same as the Markdown tags in your local file.</p></section>'
    + '<section class="sdoc-cloud-lab-section"><div class="sdoc-cloud-lab-section-title">Frequently used by you</div>'
    + '<div class="sdoc-cloud-lab-suggestions">'
    + suggestionButton('planning', 24, 'docs') + suggestionButton('cloud', 15, 'docs')
    + suggestionButton('notes', 9, 'docs') + '</div></section>' + team;
}

function renderPanel() {
  var panel = ensurePanel();
  panel.querySelector('[data-cloud-lab-panel-title]').textContent = state.panel === 'tags' ? 'Tags' : 'Access';
  var body = panel.querySelector('.sdoc-cloud-lab-panel-body');
  body.innerHTML = '<div class="sdoc-cloud-lab-notice">This is an interactive UI prototype. It does not contact Cloud.</div>'
    + (state.panel === 'tags' ? tagsPanelHtml() : accessPanelHtml())
    + (state.saveMessage ? '<p class="sdoc-cloud-lab-status" aria-live="polite">' + escapeHtml(state.saveMessage) + '</p>' : '');
  wirePanel(body);
}

function wirePanel(body) {
  body.querySelectorAll('[data-cloud-lab-account]').forEach(function (button) {
    button.addEventListener('click', function () {
      state.account = button.getAttribute('data-cloud-lab-account');
      if (state.account === 'personal') state.selected = ['you'];
      else if (state.selected.length === 1) state.selected = ['you', 'tom', 'lenny', 'dan'];
      state.pending = [];
      refreshRow();
      renderPanel();
    });
  });
  body.querySelectorAll('[data-cloud-lab-saved]').forEach(function (button) {
    button.addEventListener('click', function () {
      state.saved = button.getAttribute('data-cloud-lab-saved') === 'true';
      state.saveMessage = '';
      refreshRow();
      renderPanel();
    });
  });
  body.querySelectorAll('[data-cloud-lab-preset]').forEach(function (button) {
    button.addEventListener('click', function () {
      state.selected = button.getAttribute('data-cloud-lab-preset') === 'everyone'
        ? activeMembers().map(function (member) { return member.id; }) : ['you'];
      refreshRow();
      renderPanel();
    });
  });
  body.querySelectorAll('[data-cloud-lab-member]').forEach(function (input) {
    input.addEventListener('change', function () {
      var id = input.getAttribute('data-cloud-lab-member');
      if (input.checked && state.selected.indexOf(id) === -1) state.selected.push(id);
      if (!input.checked) state.selected = state.selected.filter(function (value) { return value !== id; });
      if (state.selected.indexOf('you') === -1) state.selected.unshift('you');
      refreshRow();
      renderPanel();
    });
  });
  var invite = body.querySelector('.sdoc-cloud-lab-invite');
  if (invite) invite.addEventListener('submit', function (event) {
    event.preventDefault();
    var input = invite.querySelector('input');
    var email = input.value.trim();
    if (!email || state.pending.indexOf(email) !== -1) return;
    state.pending.push(email);
    state.saveMessage = 'Invitation prepared for ' + email + '. Nothing was sent.';
    renderPanel();
  });
  body.querySelectorAll('[data-cloud-lab-remove-tag]').forEach(function (button) {
    button.addEventListener('click', function () {
      var tag = button.getAttribute('data-cloud-lab-remove-tag');
      state.tags = state.tags.filter(function (value) { return value !== tag; });
      refreshRow();
      renderPanel();
    });
  });
  body.querySelectorAll('[data-cloud-lab-add-tag]').forEach(function (button) {
    button.addEventListener('click', function () { addTag(button.getAttribute('data-cloud-lab-add-tag')); });
  });
  var tagForm = body.querySelector('.sdoc-cloud-lab-tag-form');
  if (tagForm) tagForm.addEventListener('submit', function (event) {
    event.preventDefault();
    addTag(tagForm.querySelector('input').value);
  });
}

function addTag(raw) {
  var tag = String(raw || '').trim().replace(/^#+/, '');
  if (!tag) return;
  var exists = state.tags.some(function (value) { return value.toLowerCase() === tag.toLowerCase(); });
  if (!exists) state.tags.push(tag);
  refreshRow();
  renderPanel();
}

function openPanel(kind) {
  state.panel = kind === 'tags' ? 'tags' : 'access';
  renderPanel();
  document.body.classList.add('cloud-lab-mode');
  document.body.classList.add('mobile-cloud-lab-open');
  var panel = ensurePanel();
  panel.querySelector('.sdoc-cloud-lab-close').focus();
}

function closePanel() {
  state.panel = null;
  document.body.classList.remove('cloud-lab-mode');
  document.body.classList.remove('mobile-cloud-lab-open');
}

function start() {
  document.documentElement.classList.add('sdoc-cloud-lab-enabled');
  var card = document.getElementById('_sd_sdocs-file-info');
  if (card) new MutationObserver(insertRow).observe(card, { childList: true, subtree: true });
  insertRow();
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && state.panel) closePanel();
  });
}

window.SDocsCloudUiLab = {
  state: state,
  openPanel: openPanel,
  closePanel: closePanel,
  refresh: refreshRow,
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
})();
