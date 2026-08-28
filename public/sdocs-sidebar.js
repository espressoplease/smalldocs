// sdocs-sidebar.js - contextual navigation for the document reader.
(function () {
'use strict';

var S = window.SDocs;
var SidebarData = window.SDocsSidebarData;
var SIDEBAR_RECENT_LIMIT = 10;
var LOCAL_PREVIEW_ENTRIES = [
  { id: 'preview-reader', title: 'Reader redesign notes', path: '/Documents/SmallDocs/reader-redesign.md', tags: ['design', 'renderer', 'product'], mtime: '2026-08-27T09:30:00Z', preview: true },
  { id: 'preview-research', title: 'Shared renderer research', path: '/Documents/SmallDocs/shared-renderer-research.md', tags: ['design', 'renderer', 'product'], mtime: '2026-08-26T18:20:00Z', preview: true },
  { id: 'preview-audit', title: 'SmallDocs UI audit', path: '/Documents/SmallDocs/ui-audit.md', tags: ['design', 'renderer', 'product'], mtime: '2026-08-25T14:10:00Z', preview: true },
  { id: 'preview-roadmap', title: 'SmallDocs renderer roadmap', path: '/Documents/SmallDocs/renderer-roadmap.md', tags: ['renderer', 'product'], mtime: '2026-08-24T11:40:00Z', preview: true },
  { id: 'preview-plan', title: 'Research plan', path: '/Documents/SmallDocs/research-plan.md', tags: ['research', 'product'], mtime: '2026-08-23T16:05:00Z', preview: true },
  { id: 'preview-tags', title: 'Tag navigation ideas', path: '/Documents/SmallDocs/tag-navigation.md', tags: ['design'], mtime: '2026-08-22T15:10:00Z', preview: true },
  { id: 'preview-release', title: 'Release checklist', path: '/Documents/SmallDocs/release-checklist.md', tags: ['release'], mtime: '2026-08-21T12:30:00Z', preview: true },
  { id: 'preview-notes', title: 'Document rendering notes', path: '/Documents/SmallDocs/rendering-notes.md', tags: ['notes'], mtime: '2026-08-20T09:10:00Z', preview: true },
  { id: 'preview-feedback', title: 'Reader feedback', path: '/Documents/SmallDocs/reader-feedback.md', tags: ['feedback'], mtime: '2026-08-19T17:45:00Z', preview: true },
  { id: 'preview-mobile', title: 'Mobile navigation review', path: '/Documents/SmallDocs/mobile-navigation.md', tags: ['mobile'], mtime: '2026-08-18T14:00:00Z', preview: true },
  { id: 'preview-accessibility', title: 'Accessibility checks', path: '/Documents/SmallDocs/accessibility.md', tags: ['accessibility'], mtime: '2026-08-17T10:20:00Z', preview: true },
];
var CLOUD_PREVIEW_ENTRIES = [
  { id: 'preview-cloud-brief', title: 'Product brief', tags: ['product', 'planning'], mtime: '2026-08-27T08:45:00Z', preview: true },
  { id: 'preview-cloud-research', title: 'Shared research notes', tags: ['research', 'shared'], mtime: '2026-08-26T13:15:00Z', preview: true },
  { id: 'preview-cloud-review', title: 'Quarterly review', tags: ['planning', 'team'], mtime: '2026-08-24T16:30:00Z', preview: true },
];
var LOCAL_PREVIEW_TAGS = ['design', 'renderer', 'product', 'research'];
var SIDEBAR_PREVIEW_MODE = new URLSearchParams(window.location.search).get('sidebar');
var localEntries = SIDEBAR_PREVIEW_MODE === 'preview' ? LOCAL_PREVIEW_ENTRIES.slice() : [];
var cloudEntries = SIDEBAR_PREVIEW_MODE === 'preview' ? CLOUD_PREVIEW_ENTRIES.slice() : [];
var usingPreviewData = SIDEBAR_PREVIEW_MODE === 'preview';
var libraryLoaded = SIDEBAR_PREVIEW_MODE === 'preview' || SIDEBAR_PREVIEW_MODE === 'empty';
var libraryLoading = false;
var libraryError = '';
var cloudLibraryLoaded = SIDEBAR_PREVIEW_MODE === 'preview';
var cloudLibraryLoading = false;
var cloudLibraryError = '';
var cloudLibraryStatus = 0;
var cloudLibraryScope = null;

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
    link.href = typeof fallbackHref === 'function'
      ? fallbackHref(entry)
      : fallbackHref || libraryUrl();
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

function currentDocumentTags() {
  var tags = S && S.currentMeta && Array.isArray(S.currentMeta.tags)
    ? S.currentMeta.tags.map(String).filter(Boolean)
    : [];
  return tags.length || !usingPreviewData ? tags : LOCAL_PREVIEW_TAGS.slice();
}

function currentDocumentRef(scope) {
  if (scope === 'cloud') {
    return { id: S && S.cloudDocument && S.cloudDocument.id || '' };
  }
  return { path: S && S.localMeta && S.localMeta.fullPath || '' };
}

function renderTagGroups(host, currentTags, entries, scope) {
  if (!host) return 0;
  host.replaceChildren();
  var libraryScope = scope === 'cloud' ? 'cloud' : 'local';
  var ordered = SidebarData.relatedGroups(currentTags, entries, currentDocumentRef(libraryScope));

  if (!ordered.length) {
    host.hidden = true;
    return 0;
  }

  host.hidden = false;
  var sharedTagCount = SidebarData.sharedTagCount(ordered);

  ordered.forEach(function (group) {
    var groupElement = document.createElement('section');
    groupElement.className = 'sdocs-sidebar-tag-group';
    var tagRow = document.createElement('div');
    tagRow.className = 'sdocs-sidebar-tags sdocs-sidebar-group-tags';
    tagRow.setAttribute('aria-label', group.tags.length + ' shared ' + (group.tags.length === 1 ? 'tag' : 'tags'));
    group.tags.forEach(function (tag) { tagRow.appendChild(makeTag(tag, libraryScope)); });
    var list = document.createElement('div');
    list.className = 'sdocs-sidebar-preview-list';
    groupElement.appendChild(tagRow);
    groupElement.appendChild(list);
    host.appendChild(groupElement);
    renderEntryList(
      list,
      group.entries,
      '',
      libraryScope === 'local' ? openLocalEntry : null,
      libraryScope === 'local'
        ? libraryUrl(usingPreviewData ? { demo: '1' } : {})
        : function (entry) { return entry.preview ? '/library?scope=cloud' : '/docs?cloud-document=' + encodeURIComponent(entry.id); }
    );
  });
  return sharedTagCount;
}

function setLibraryCount(id, count) {
  var element = document.getElementById(id);
  if (element) element.textContent = String(count);
}

function setDataStatus(id, message, actionLabel, onAction) {
  var host = document.getElementById(id);
  if (!host) return;
  var label = host.querySelector('span');
  var action = host.querySelector('button');
  host.hidden = !message;
  if (label) label.textContent = message || '';
  if (!action) return;
  action.hidden = !actionLabel;
  action.textContent = actionLabel || '';
  action.onclick = onAction || null;
}

function setLibraryContentVisible(prefix, visible) {
  var shared = document.getElementById('_sd_sidebar_' + prefix + '_shared_section');
  var recent = document.getElementById('_sd_sidebar_' + prefix + '_recent_section');
  if (shared && !visible) shared.hidden = true;
  if (recent) recent.hidden = !visible;
}

function cloudEntry(documentData) {
  return {
    id: documentData.id,
    title: documentData.title,
    path: documentData.filename,
    tags: Array.isArray(documentData.tags) ? documentData.tags : [],
    mtime: documentData.updated_at,
  };
}

function selectedCloudWorkspaceId() {
  if (S && S.cloudDocument && S.cloudDocument.workspace_id) return S.cloudDocument.workspace_id;
  if (window.SDocsCloudAccountSelection && window.SDocsCloudAccountSelection.storedId) {
    return window.SDocsCloudAccountSelection.storedId(window.localStorage) || '';
  }
  return '';
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

  if (!libraryLoaded) {
    setLibraryContentVisible('local', false);
    setDataStatus('_sd_sidebar_local_status', libraryLoading
      ? 'Loading documents...'
      : libraryError || '', libraryError ? 'Retry' : '', function () {
        libraryError = '';
        loadLibrary();
      });
    return;
  }

  setDataStatus('_sd_sidebar_local_status', '');
  setLibraryContentVisible('local', true);
  var sharedCount = renderTagGroups(document.getElementById('_sd_sidebar_tag_groups'), currentDocumentTags(), localEntries, 'local');
  var sharedSection = document.getElementById('_sd_sidebar_local_shared_section');
  if (sharedSection) sharedSection.hidden = sharedCount === 0;
  setLibraryCount('_sd_sidebar_local_shared_count', sharedCount);
  var recent = SidebarData.recentEntries(localEntries, currentDocumentRef('local'), SIDEBAR_RECENT_LIMIT);
  setLibraryCount('_sd_sidebar_local_recent_count', recent.length);
  renderEntryList(document.getElementById('_sd_sidebar_recent'), recent, 'No recent documents', openLocalEntry,
    libraryUrl(usingPreviewData ? { demo: '1' } : {}));
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

  if (!cloudLibraryLoaded) {
    setLibraryContentVisible('cloud', false);
    var cloudMessage = cloudLibraryLoading ? 'Loading documents...' : cloudLibraryError;
    var cloudAction = cloudLibraryStatus === 401 ? 'Sign in' : cloudLibraryError ? 'Retry' : '';
    setDataStatus('_sd_sidebar_cloud_status', cloudMessage, cloudAction, function () {
      if (cloudLibraryStatus === 401) {
        window.location.href = '/cloud/sign-in?return=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
        return;
      }
      cloudLibraryError = '';
      loadCloudLibrary();
    });
    return;
  }

  setDataStatus('_sd_sidebar_cloud_status', '');
  setLibraryContentVisible('cloud', true);
  var sharedCount = renderTagGroups(document.getElementById('_sd_sidebar_cloud_tag_groups'), currentDocumentTags(), cloudEntries, 'cloud');
  var sharedSection = document.getElementById('_sd_sidebar_cloud_shared_section');
  if (sharedSection) sharedSection.hidden = sharedCount === 0;
  setLibraryCount('_sd_sidebar_cloud_shared_count', sharedCount);
  var recent = SidebarData.recentEntries(cloudEntries, currentDocumentRef('cloud'), SIDEBAR_RECENT_LIMIT);
  setLibraryCount('_sd_sidebar_cloud_recent_count', recent.length);
  renderEntryList(document.getElementById('_sd_sidebar_cloud_recent'), recent, 'No recent documents', null,
    function (entry) { return entry.preview ? '/library?scope=cloud' : '/docs?cloud-document=' + encodeURIComponent(entry.id); });
  syncLibrarySubsections(connectedPanel);
}

function renderSidebar() {
  var nextCloudScope = selectedCloudWorkspaceId();
  if (!usingPreviewData && cloudLibraryLoaded && cloudLibraryScope !== nextCloudScope) {
    cloudEntries = [];
    cloudLibraryLoaded = false;
    cloudLibraryError = '';
    cloudLibraryStatus = 0;
  }
  renderLocalLibrary();
  renderCloudLibrary();
  var cloudSection = document.querySelector('[data-sidebar-section="cloud"]');
  if (cloudSection && cloudSection.classList.contains('is-expanded')) loadCloudLibrary();
}

function loadLibrary() {
  if (!localConnected() || libraryLoaded || libraryLoading) return;
  if (previewMode() === 'preview' || previewMode() === 'empty') {
    renderLocalLibrary();
    return;
  }
  libraryLoading = true;
  libraryError = '';
  renderLocalLibrary();
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
    .catch(function () {
      libraryError = 'Local Library is unavailable.';
    })
    .finally(function () {
      libraryLoading = false;
      renderLocalLibrary();
    });
}

function loadCloudLibrary() {
  if (!cloudConnected() || cloudLibraryLoaded || cloudLibraryLoading) return;
  if (previewMode() === 'preview') {
    renderCloudLibrary();
    return;
  }
  cloudLibraryLoading = true;
  cloudLibraryError = '';
  cloudLibraryStatus = 0;
  renderCloudLibrary();

  var documents = [];
  var workspaceId = selectedCloudWorkspaceId();

  function loadPage(cursor) {
    var params = new URLSearchParams({ limit: '100' });
    if (workspaceId) params.set('workspace_id', workspaceId);
    if (cursor) params.set('cursor', cursor);
    return fetch('/api/cloud/v1/documents?' + params.toString(), { credentials: 'same-origin' })
      .then(function (response) {
        if (!response.ok) {
          var error = new Error('Cloud returned ' + response.status);
          error.status = response.status;
          throw error;
        }
        return response.json();
      })
      .then(function (page) {
        documents.push.apply(documents, Array.isArray(page.documents) ? page.documents : []);
        return page.next_cursor ? loadPage(page.next_cursor) : documents;
      });
  }

  loadPage(null)
    .then(function (loadedDocuments) {
      cloudEntries = loadedDocuments.map(cloudEntry);
      cloudLibraryLoaded = true;
      cloudLibraryScope = workspaceId;
    })
    .catch(function (error) {
      cloudLibraryStatus = error && error.status || 0;
      if (cloudLibraryStatus === 401) cloudLibraryError = 'Sign in to load Cloud documents.';
      else if (cloudLibraryStatus === 402) cloudLibraryError = 'Cloud Library is not available for this account.';
      else if (cloudLibraryStatus === 403) cloudLibraryError = 'You do not have access to these Cloud documents.';
      else cloudLibraryError = 'Cloud Library is unavailable.';
    })
    .finally(function () {
      cloudLibraryLoading = false;
      renderCloudLibrary();
    });
}

function setExpanded(section, expanded) {
  var trigger = section.querySelector(':scope > .doc-site-action');
  section.classList.toggle('is-expanded', expanded);
  if (trigger) trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

var mobileMenuButton = document.getElementById('_sd_mobile_menu');
var mobileSidebar = document.getElementById('_sd_sidebar');
var mobileBackground = [
  document.querySelector('.sdocs-mobile-toolbar-scroll'),
  document.getElementById('_sd_content-area'),
  document.getElementById('_sd_right'),
  document.getElementById('_sd_statusbar'),
].filter(Boolean);

function mobileMenuFocusables() {
  if (!mobileSidebar) return [];
  return Array.prototype.slice.call(mobileSidebar.querySelectorAll(
    'a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
  )).filter(function (element) {
    return !element.hidden && element.getClientRects().length > 0;
  });
}

function setMobileMenuOpen(open, restoreFocus) {
  if (!mobileMenuButton || !mobileSidebar) return;
  document.body.classList.toggle('sdocs-mobile-nav-open', open);
  mobileMenuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  mobileMenuButton.setAttribute('aria-label', open ? 'Close SmallDocs menu' : 'Open SmallDocs menu');
  mobileBackground.forEach(function (element) { element.inert = open; });
  if (open) {
    window.requestAnimationFrame(function () {
      var first = mobileMenuFocusables()[0];
      if (first) first.focus();
    });
  } else if (restoreFocus) {
    mobileMenuButton.focus();
  }
}

if (mobileMenuButton) {
  mobileMenuButton.addEventListener('click', function () {
    setMobileMenuOpen(!document.body.classList.contains('sdocs-mobile-nav-open'), true);
  });
}

document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && document.body.classList.contains('sdocs-mobile-nav-open')) {
    setMobileMenuOpen(false, true);
    return;
  }
  if (event.key === 'Tab' && document.body.classList.contains('sdocs-mobile-nav-open')) {
    var focusables = mobileMenuFocusables();
    if (mobileMenuButton) focusables.push(mobileMenuButton);
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (event.shiftKey && (document.activeElement === first || focusables.indexOf(document.activeElement) === -1)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

window.addEventListener('resize', function () {
  if (!window.matchMedia('(max-width: 768px)').matches) setMobileMenuOpen(false, false);
});

if (mobileSidebar) {
  mobileSidebar.addEventListener('click', function (event) {
    if (event.target.closest('a')) setMobileMenuOpen(false, false);
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
    } else if (section.dataset.sidebarSection === 'cloud') {
      loadCloudLibrary();
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
