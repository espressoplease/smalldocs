(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const scope = params.get('scope') === 'cloud' ? 'cloud' : 'local';
  const nav = document.getElementById('cloud-library-nav');
  const actions = document.getElementById('cloud-library-actions');
  const heading = document.getElementById('cloud-library-heading');
  const localLink = document.getElementById('local-scope-link');
  const cloudLink = document.getElementById('cloud-scope-link');
  const workspaceButton = document.getElementById('workspace-button');
  const workspaceMenu = document.getElementById('workspace-menu');

  window.SDocsCloudLibrary = window.SDocsCloudLibrary || {};
  nav.hidden = false;
  localLink.href = '/library';
  cloudLink.href = '/library?scope=cloud';
  localLink.classList.toggle('active', scope === 'local');
  cloudLink.classList.toggle('active', scope === 'cloud');
  if (scope === 'local') localLink.setAttribute('aria-current', 'page');
  if (scope === 'cloud') cloudLink.setAttribute('aria-current', 'page');
  if (scope !== 'cloud') return;

  actions.hidden = false;
  heading.hidden = false;

  function workspaceMark(name, personal) {
    const mark = document.createElement('span');
    mark.className = 'workspace-mark' + (personal ? ' personal' : '');
    mark.textContent = (name || '?').slice(0, 1).toUpperCase();
    return mark;
  }

  function selectWorkspace(workspace) {
    window.SDocsCloudLibrary.workspaceId = workspace.id;
    window.SDocsCloudLibrary.workspaceName = workspace.name;
    workspaceButton.replaceChildren(
      workspaceMark(workspace.name, workspace.kind === 'personal'),
      Object.assign(document.createElement('span'), { textContent: workspace.name }),
      chevron()
    );
    workspaceButton.setAttribute('aria-expanded', 'false');
    workspaceMenu.hidden = true;
    renderMenu(window.SDocsCloudLibrary.workspaces || [], workspace.id);
    window.dispatchEvent(new CustomEvent('sdocs-cloud-workspace-change'));
  }

  function chevron() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'm6 9 6 6 6-6');
    svg.appendChild(path);
    return svg;
  }

  function renderMenu(workspaces, selectedId) {
    workspaceMenu.replaceChildren();
    const label = document.createElement('div');
    label.className = 'workspace-menu-label';
    label.textContent = 'Workspaces';
    workspaceMenu.appendChild(label);
    workspaces.forEach(function (workspace) {
      const button = document.createElement('button');
      button.className = 'workspace-menu-item' + (workspace.id === selectedId ? ' selected' : '');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.appendChild(workspaceMark(workspace.name, workspace.kind === 'personal'));
      const copy = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = workspace.name;
      const small = document.createElement('small');
      small.textContent = workspace.kind === 'personal' ? 'Personal' : 'Team workspace';
      copy.append(strong, small);
      button.appendChild(copy);
      if (workspace.id === selectedId) {
        const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        check.setAttribute('class', 'workspace-check');
        check.setAttribute('viewBox', '0 0 24 24');
        check.setAttribute('aria-label', 'Current workspace');
        const path = document.createElementNS(check.namespaceURI, 'path');
        path.setAttribute('d', 'm20 6-11 11-5-5');
        check.appendChild(path);
        button.appendChild(check);
      }
      button.addEventListener('click', function () { selectWorkspace(workspace); });
      workspaceMenu.appendChild(button);
    });
    const selected = workspaces.find(function (workspace) { return workspace.id === selectedId; });
    if (selected && (selected.role === 'owner' || selected.role === 'admin')) {
      const separator = document.createElement('div');
      separator.className = 'workspace-menu-sep';
      const link = document.createElement('a');
      link.className = 'workspace-menu-link';
      link.href = '/cloud/admin?workspace_id=' + encodeURIComponent(selected.id);
      link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg><span>Workspace settings</span>';
      workspaceMenu.append(separator, link);
    }
  }

  workspaceButton.addEventListener('click', function () {
    const open = workspaceMenu.hidden;
    workspaceMenu.hidden = !open;
    workspaceButton.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', function (event) {
    if (!event.target.closest('.workspace-switcher')) {
      workspaceMenu.hidden = true;
      workspaceButton.setAttribute('aria-expanded', 'false');
    }
  });

  Promise.all([
    fetch('/api/cloud/v1/workspaces', { credentials: 'same-origin' }),
    fetch('/api/cloud/v1/me', { credentials: 'same-origin' }),
  ]).then(async function (responses) {
    if (responses.some(function (response) { return response.status === 401; })) {
      location.href = '/cloud/sign-in?return=' + encodeURIComponent(location.pathname + location.search);
      return;
    }
    if (responses.some(function (response) { return !response.ok; })) throw new Error('Cloud unavailable');
    const workspaces = (await responses[0].json()).workspaces || [];
    const me = (await responses[1].json()).user || {};
    window.SDocsCloudLibrary.workspaces = workspaces;
    const note = heading.querySelector('.cloud-access-note');
    if (note) note.textContent = me.email ? 'Signed in as ' + me.email : 'Signed in';
    if (workspaces.length) {
      var requestedWorkspaceId = params.get('workspace');
      var selectedWorkspace = workspaces.find(function (workspace) {
        return workspace.id === requestedWorkspaceId;
      }) || workspaces[0];
      selectWorkspace(selectedWorkspace);
    }
  }).catch(function () {
    const note = heading.querySelector('.cloud-access-note');
    if (note) note.textContent = 'Cloud is temporarily unavailable';
  });
})();
