(function (exports) {
  'use strict';
  var markup = `<div class="cloud-library-nav" id="cloud-library-nav" hidden>
      <div class="library-scope" aria-label="Library location">
        <a class="library-scope-option" id="local-scope-link" href="/library">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/></svg>
          Local
        </a>
        <a class="library-scope-option" id="cloud-scope-link" href="/library?scope=cloud">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>
          Cloud
        </a>
      </div>

      <div class="cloud-library-actions" id="cloud-library-actions" hidden>
        <div class="workspace-switcher">
          <button class="workspace-button" id="workspace-button" aria-expanded="false" aria-haspopup="menu">
            <span class="workspace-mark" aria-hidden="true"></span>
            <span>Choose library</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div class="workspace-menu" id="workspace-menu" role="menu" hidden>
            <div class="workspace-menu-label">Libraries</div>
          </div>
        </div>
        <a class="workspace-button cloud-manage-members" id="manage-members-link" href="/library/settings?panel=people" hidden>Manage members</a>
        <a class="workspace-button cloud-create-library" href="/library/settings?panel=libraries">Create team library</a>
      </div>
    </div>`;
  function settingsUrl(id, panel) {
    var params = new URLSearchParams({ panel: panel || 'overview' });
    if (id) params.set('workspace', id);
    return '/library/settings?' + params;
  }
  function bind(options) {
    var root = options.root;
    if (!root.querySelector('#workspace-button')) root.innerHTML = markup;
    var button = root.querySelector('#workspace-button');
    var menu = root.querySelector('#workspace-menu');
    var selection = window.SDocsCloudAccountSelection;
    function mark(workspace) {
      var node = document.createElement('span'); node.className = 'workspace-mark';
      node.innerHTML = selection.icon(workspace && workspace.kind);
      if (workspace) node.style.color = selection.color(workspace.id);
      return node;
    }
    function close() { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); }
    function render(workspace) {
      button.replaceChildren(mark(workspace));
      var name = document.createElement('span'); name.textContent = workspace ? selection.label(workspace, options.user) : 'Choose library';
      button.appendChild(name);
      button.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>');
      var members = root.querySelector('#manage-members-link');
      members.hidden = !workspace || workspace.kind !== 'team';
      members.href = settingsUrl(workspace && workspace.id, 'people');
      root.querySelector('.cloud-create-library').href = settingsUrl(workspace && workspace.id, 'libraries');
      menu.replaceChildren();
      var label = document.createElement('div'); label.className = 'workspace-menu-label'; label.textContent = 'Libraries'; menu.appendChild(label);
      selection.orderedLibraries(options.workspaces).forEach(function (library) {
        var item = document.createElement('button'); item.type = 'button'; item.className = 'workspace-menu-item'; item.setAttribute('role', 'menuitem');
        item.appendChild(mark(library));
        var copy = document.createElement('span'); var strong = document.createElement('strong'); strong.textContent = selection.label(library, options.user); copy.appendChild(strong); item.appendChild(copy);
        if (workspace && workspace.id === library.id) {
          item.classList.add('selected');
          item.insertAdjacentHTML('beforeend', '<svg class="workspace-check" viewBox="0 0 24 24" aria-label="Current library"><path d="m20 6-11 11-5-5"/></svg>');
        }
        item.addEventListener('click', function () { close(); options.onSelect(library); });
        menu.appendChild(item);
      });
      if (workspace) {
        var separator = document.createElement('div'); separator.className = 'workspace-menu-sep';
        var settings = document.createElement('a'); settings.className = 'workspace-menu-link'; settings.href = settingsUrl(workspace.id);
        settings.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg><span>Library settings</span>';
        menu.append(separator, settings);
      }
      root.querySelector('#cloud-library-actions').hidden = options.workspaces.length === 0;
      close();
    }
    button.addEventListener('click', function () { var open = menu.hidden; menu.hidden = !open; button.setAttribute('aria-expanded', String(open)); });
    document.addEventListener('click', function (event) { if (!root.querySelector('.workspace-switcher').contains(event.target)) close(); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') close(); });
    root.querySelector('#cloud-library-nav').hidden = false;
    root.querySelector('.library-scope').hidden = true;
    render(options.selected || null);
    return { render: render };
  }
  exports.markup = markup;
  exports.bind = bind;
  exports.settingsUrl = settingsUrl;
  if (typeof document !== 'undefined') {
    var root = document.getElementById('library-header');
    if (root && !root.querySelector('#workspace-button')) root.innerHTML = markup;
  }
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocsLibraryHeader = {}));
