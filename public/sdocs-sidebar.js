// sdocs-sidebar.js - contextual navigation for the document reader.
(function () {
'use strict';

var S = window.SDocs;
var LOCAL_PREVIEW_ENTRIES = [
  { id: 'preview-reader', title: 'Reader redesign notes', path: '/Documents/SmallDocs/reader-redesign.md', tags: ['design', 'renderer', 'product'], mtime: '2026-08-27T09:30:00Z', preview: true },
  { id: 'preview-research', title: 'Shared renderer research', path: '/Documents/SmallDocs/shared-renderer-research.md', tags: ['design', 'renderer', 'product'], mtime: '2026-08-26T18:20:00Z', preview: true },
  { id: 'preview-audit', title: 'SmallDocs UI audit', path: '/Documents/SmallDocs/ui-audit.md', tags: ['design', 'renderer', 'product'], mtime: '2026-08-25T14:10:00Z', preview: true },
  { id: 'preview-roadmap', title: 'SmallDocs renderer roadmap', path: '/Documents/SmallDocs/renderer-roadmap.md', tags: ['renderer', 'product'], mtime: '2026-08-24T11:40:00Z', preview: true },
  { id: 'preview-plan', title: 'Research plan', path: '/Documents/SmallDocs/research-plan.md', tags: ['research', 'product'], mtime: '2026-08-23T16:05:00Z', preview: true },
  { id: 'preview-tags', title: 'Tag navigation ideas', path: '/Documents/SmallDocs/tag-navigation.md', tags: ['design'], mtime: '2026-08-22T15:10:00Z', preview: true },
];
var CLOUD_PREVIEW_ENTRIES = [
  { id: 'preview-cloud-brief', title: 'Product brief', tags: ['product', 'planning'], mtime: '2026-08-27T08:45:00Z', preview: true },
  { id: 'preview-cloud-research', title: 'Shared research notes', tags: ['research', 'shared'], mtime: '2026-08-26T13:15:00Z', preview: true },
  { id: 'preview-cloud-review', title: 'Quarterly review', tags: ['planning', 'team'], mtime: '2026-08-24T16:30:00Z', preview: true },
];
var LOCAL_PREVIEW_TAGS = ['design', 'renderer', 'product', 'research'];
var SIDEBAR_PREVIEW_MODE = new URLSearchParams(window.location.search).get('sidebar');
var localEntries = SIDEBAR_PREVIEW_MODE === 'preview' ? LOCAL_PREVIEW_ENTRIES.slice() : [];
var usingPreviewData = SIDEBAR_PREVIEW_MODE === 'preview';
var libraryLoaded = false;
var libraryLoading = false;

function previewMode() {
  return SIDEBAR_PREVIEW_MODE;
}

function localConnected() {
  return previewMode() === 'connected' || previewMode() === 'local' || previewMode() === 'preview' || previewMode() === 'empty' ||
    Boolean(window.SDocsConnect && window.SDocsConnect.isConnected());
}

function cloudConnected() {
  var sidebar = document.getElementById('_sd_sidebar');
  return previewMode() === 'connected' || previewMode() === 'cloud' || previewMode() === 'preview' ||
    Boolean(sidebar && sidebar.dataset.cloudAuthenticated === 'true');
}

function libraryUrl(params) {
  var trigger = document.getElementById('_sd_btn-library');
  var base = trigger && trigger.dataset.sidebarHref ? trigger.dataset.sidebarHref : '/library';
  var url = new URL(base, window.location.origin);
  Object.keys(params || {}).forEach(function (key) { url.searchParams.set(key, params[key]); });
  return url.pathname + url.search;
}

function makeEmpty(text) {
  var empty = document.createElement('span');
  empty.className = 'sdocs-sidebar-preview-empty';
  empty.textContent = text;
  return empty;
}

function makeTag(tag, scope) {
  var link = document.createElement('a');
  link.className = 'sdocs-sidebar-tag';
  link.href = scope === 'cloud'
    ? '/library?scope=cloud&tag=' + encodeURIComponent(tag)
    : libraryUrl({ tag: tag });
  link.textContent = '#' + tag;
  return link;
}

function openNewTab(url) {
  var tab = window.open(url, '_blank');
  if (tab) tab.opener = null;
  return tab;
}

function openLocalEntry(entry, link) {
  if (entry.preview) return;
  var pendingTab = openNewTab('about:blank');
  if (link) link.setAttribute('aria-busy', 'true');
  fetch('http://127.0.0.1:47843/api/library/open?id=' + encodeURIComponent(entry.id))
    .then(function (response) {
      if (!response.ok) throw new Error('open failed');
      return response.json();
    })
    .then(function (data) {
      if (!data || !data.url) throw new Error('missing URL');
      var url = new URL(data.url, window.location.origin).toString();
      if (pendingTab) pendingTab.location.replace(url);
      else openNewTab(url);
    })
    .catch(function () {
      if (pendingTab) pendingTab.location.replace(libraryUrl());
      else openNewTab(libraryUrl());
    })
    .finally(function () {
      if (link) link.removeAttribute('aria-busy');
    });
}

function renderEntryList(host, list, emptyText, onOpen, fallbackHref) {
  if (!host) return;
  host.replaceChildren();
  if (!list.length) {
    host.appendChild(makeEmpty(emptyText));
    return;
  }
  list.forEach(function (entry) {
    var link = document.createElement('a');
    link.className = 'sdocs-sidebar-preview-entry';
    link.href = fallbackHref || libraryUrl();
    link.target = '_blank';
    link.rel = 'noopener';
    var title = entry.title || (entry.path ? entry.path.split('/').pop() : 'Untitled document');
    link.textContent = title;
    if (entry.preview) {
      link.classList.add('is-preview');
    }
    if (onOpen && !entry.preview) link.addEventListener('click', function (event) {
      event.preventDefault();
      onOpen(entry, link);
    });
    host.appendChild(link);
    if (link.scrollWidth > link.clientWidth) link.setAttribute('data-tip', title);
  });
  if (S && S.attachTooltips) S.attachTooltips(host);
}

function currentLocalTags() {
  var tags = S && S.currentMeta && Array.isArray(S.currentMeta.tags)
    ? S.currentMeta.tags.map(String).filter(Boolean)
    : [];
  return tags.length || !usingPreviewData ? tags : LOCAL_PREVIEW_TAGS.slice();
}

function normaliseTags(tags) {
  var seen = {};
  return (Array.isArray(tags) ? tags : []).map(function (tag) {
    return String(tag).trim();
  }).filter(function (tag) {
    var key = tag.toLowerCase();
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function isCurrentLocalEntry(entry) {
  var fullPath = S && S.localMeta && S.localMeta.fullPath;
  return Boolean(fullPath && entry && entry.path === fullPath);
}

function renderTagGroups(host, currentTags, entries, scope) {
  if (!host) return 0;
  host.replaceChildren();
  var libraryScope = scope === 'cloud' ? 'cloud' : 'local';

  var tags = normaliseTags(currentTags);
  var tagNames = {};
  tags.forEach(function (tag) { tagNames[tag.toLowerCase()] = tag; });
  var groups = {};

  entries.forEach(function (entry) {
    if (isCurrentLocalEntry(entry)) return;
    var entryTags = {};
    normaliseTags(entry.tags).forEach(function (tag) { entryTags[tag.toLowerCase()] = true; });
    var shared = tags.filter(function (tag) { return entryTags[tag.toLowerCase()]; });
    if (!shared.length) return;
    var key = shared.map(function (tag) { return tag.toLowerCase(); }).join('\u0000');
    if (!groups[key]) groups[key] = { tags: shared, entries: [] };
    groups[key].entries.push(entry);
  });

  var ordered = Object.keys(groups).map(function (key) { return groups[key]; });
  ordered.sort(function (a, b) {
    if (a.tags.length !== b.tags.length) return b.tags.length - a.tags.length;
    var aTime = Math.max.apply(null, a.entries.map(function (entry) { return new Date(entry.mtime || entry.firstSeen || 0).getTime(); }));
    var bTime = Math.max.apply(null, b.entries.map(function (entry) { return new Date(entry.mtime || entry.firstSeen || 0).getTime(); }));
    return bTime - aTime;
  });

  if (!ordered.length) {
    host.hidden = true;
    return 0;
  }

  host.hidden = false;
  var sharedDocumentCount = 0;

  ordered.forEach(function (group) {
    sharedDocumentCount += group.entries.length;
    var groupElement = document.createElement('section');
    groupElement.className = 'sdocs-sidebar-tag-group';
    var tagRow = document.createElement('div');
    tagRow.className = 'sdocs-sidebar-tags sdocs-sidebar-group-tags';
    tagRow.setAttribute('aria-label', group.tags.length + ' shared ' + (group.tags.length === 1 ? 'tag' : 'tags'));
    group.tags.forEach(function (tag) { tagRow.appendChild(makeTag(tagNames[tag.toLowerCase()] || tag, libraryScope)); });
    var list = document.createElement('div');
    list.className = 'sdocs-sidebar-preview-list';
    groupElement.appendChild(tagRow);
    groupElement.appendChild(list);
    host.appendChild(groupElement);
    renderEntryList(
      list,
      entriesByRecency(group.entries),
      '',
      libraryScope === 'local' ? openLocalEntry : null,
      libraryScope === 'local' ? libraryUrl({ demo: '1' }) : '/library?scope=cloud'
    );
  });
  return sharedDocumentCount;
}

function entriesByRecency(entries) {
  return entries.slice().sort(function (a, b) {
    return new Date(b.mtime || b.firstSeen || 0) - new Date(a.mtime || a.firstSeen || 0);
  });
}

function recentEntries(entries) {
  return entriesByRecency(entries).slice(0, 3);
}

function setLibraryCount(id, count) {
  var element = document.getElementById(id);
  if (element) element.textContent = String(count);
}

function setLibrarySubsectionExpanded(section, expanded) {
  if (!section) return;
  section.classList.toggle('is-expanded', expanded);
  var trigger = section.querySelector(':scope > .sdocs-sidebar-library-toggle');
  if (trigger) trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function syncLibrarySubsections(panel) {
  if (!panel) return;
  var sections = Array.prototype.slice.call(panel.querySelectorAll(':scope > .sdocs-sidebar-library-subsection'));
  sections.forEach(function (section) {
    if (section.hidden) setLibrarySubsectionExpanded(section, false);
  });
}

function renderLocalLibrary() {
  var connected = localConnected();
  var connectedPanel = document.getElementById('_sd_sidebar_local_connected');
  var disconnectedPanel = document.getElementById('_sd_sidebar_local_disconnected');
  var trigger = document.getElementById('_sd_btn-library');
  var section = document.querySelector('[data-sidebar-section="library"]');
  var connectLink = disconnectedPanel && disconnectedPanel.querySelector('.sdocs-sidebar-cta');
  var connectUrl = '/connect?return=' + encodeURIComponent(window.location.pathname);
  if (connectedPanel) connectedPanel.hidden = !connected;
  if (disconnectedPanel) disconnectedPanel.hidden = connected;
  if (section) {
    section.classList.toggle('is-connected', connected);
  }
  if (trigger) trigger.dataset.sidebarHref = connected ? '/library' : connectUrl;
  if (connectLink) connectLink.href = connectUrl;
  if (!connected) return;

  var sharedCount = renderTagGroups(document.getElementById('_sd_sidebar_tag_groups'), currentLocalTags(), localEntries, 'local');
  var sharedSection = document.getElementById('_sd_sidebar_local_shared_section');
  if (sharedSection) sharedSection.hidden = sharedCount === 0;
  setLibraryCount('_sd_sidebar_local_shared_count', sharedCount);
  var recent = recentEntries(localEntries);
  setLibraryCount('_sd_sidebar_local_recent_count', recent.length);
  renderEntryList(document.getElementById('_sd_sidebar_recent'), recent, 'No recent documents', openLocalEntry, libraryUrl({ demo: '1' }));
  syncLibrarySubsections(connectedPanel && connectedPanel.querySelector('.sdocs-sidebar-library-scroll'));
}

function renderCloudLibrary() {
  var connected = cloudConnected();
  var connectedPanel = document.getElementById('_sd_sidebar_cloud_connected');
  var disconnectedPanel = document.getElementById('_sd_sidebar_cloud_disconnected');
  var section = document.querySelector('[data-sidebar-section="cloud"]');
  var trigger = section && section.querySelector(':scope > .doc-site-action');
  if (connectedPanel) connectedPanel.hidden = !connected;
  if (disconnectedPanel) disconnectedPanel.hidden = connected;
  if (trigger) trigger.dataset.sidebarHref = connected ? '/library?scope=cloud' : '/cloud';
  if (!connected) return;

  var sharedCount = renderTagGroups(document.getElementById('_sd_sidebar_cloud_tag_groups'), currentLocalTags(), CLOUD_PREVIEW_ENTRIES, 'cloud');
  var sharedSection = document.getElementById('_sd_sidebar_cloud_shared_section');
  if (sharedSection) sharedSection.hidden = sharedCount === 0;
  setLibraryCount('_sd_sidebar_cloud_shared_count', sharedCount);
  var recent = recentEntries(CLOUD_PREVIEW_ENTRIES);
  setLibraryCount('_sd_sidebar_cloud_recent_count', recent.length);
  renderEntryList(document.getElementById('_sd_sidebar_cloud_recent'), recent, 'No cloud documents yet', null, '/library?scope=cloud');
  syncLibrarySubsections(connectedPanel);
}

function renderSidebar() {
  renderLocalLibrary();
  renderCloudLibrary();
}

function loadLibrary() {
  if (!localConnected() || libraryLoaded || libraryLoading) return;
  if (previewMode() === 'preview' || previewMode() === 'empty') {
    renderLocalLibrary();
    return;
  }
  libraryLoading = true;
  fetch('http://127.0.0.1:47843/api/library/data')
    .then(function (response) {
      if (!response.ok) throw new Error('library unavailable');
      return response.json();
    })
    .then(function (data) {
      var indexedEntries = data && Array.isArray(data.entries) ? data.entries : [];
      localEntries = indexedEntries;
      usingPreviewData = false;
      libraryLoaded = true;
      renderLocalLibrary();
    })
    .catch(function () { renderLocalLibrary(); })
    .finally(function () { libraryLoading = false; });
}

function setExpanded(section, expanded) {
  var trigger = section.querySelector(':scope > .doc-site-action');
  section.classList.toggle('is-expanded', expanded);
  if (trigger) trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

var mobileMenuButton = document.getElementById('_sd_mobile_menu');
var mobileSidebar = document.getElementById('_sd_sidebar');

function setMobileMenuOpen(open) {
  if (!mobileMenuButton || !mobileSidebar) return;
  document.body.classList.toggle('sdocs-mobile-nav-open', open);
  mobileMenuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  mobileMenuButton.setAttribute('aria-label', open ? 'Close SmallDocs menu' : 'Open SmallDocs menu');
}

if (mobileMenuButton) {
  mobileMenuButton.addEventListener('click', function () {
    setMobileMenuOpen(!document.body.classList.contains('sdocs-mobile-nav-open'));
  });
}

document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && document.body.classList.contains('sdocs-mobile-nav-open')) {
    setMobileMenuOpen(false);
    if (mobileMenuButton) mobileMenuButton.focus();
  }
});

window.addEventListener('resize', function () {
  if (!window.matchMedia('(max-width: 768px)').matches) setMobileMenuOpen(false);
});

if (mobileSidebar) {
  mobileSidebar.addEventListener('click', function (event) {
    if (event.target.closest('a')) setMobileMenuOpen(false);
  });
}

document.querySelectorAll('.sdocs-sidebar-section').forEach(function (section) {
  var trigger = section.querySelector(':scope > .doc-site-action');
  if (!trigger) return;
  trigger.addEventListener('click', function () {
    var shouldExpand = !section.classList.contains('is-expanded');
    document.querySelectorAll('.sdocs-sidebar-section.is-expanded').forEach(function (openSection) {
      if (openSection !== section) setExpanded(openSection, false);
    });
    setExpanded(section, shouldExpand);
    if (section.dataset.sidebarSection === 'library') {
      loadLibrary();
    }
  });
});

document.querySelectorAll('.sdocs-sidebar-library-toggle').forEach(function (trigger) {
  trigger.addEventListener('click', function () {
    var section = trigger.closest('.sdocs-sidebar-library-subsection');
    if (!section) return;
    var shouldExpand = !section.classList.contains('is-expanded');
    Array.prototype.forEach.call(section.parentElement.children, function (sibling) {
      if (sibling !== section && sibling.classList && sibling.classList.contains('sdocs-sidebar-library-subsection')) {
        setLibrarySubsectionExpanded(sibling, false);
      }
    });
    setLibrarySubsectionExpanded(section, shouldExpand);
  });
});

S.sidebarRefresh = renderSidebar;
renderSidebar();

})();
