(function () {
  'use strict';

  const section = document.getElementById('deleted-workspaces');
  const list = document.getElementById('deleted-workspace-list');

  function showError(message) {
    const row = document.createElement('p');
    row.textContent = message;
    list.replaceChildren(row);
    section.hidden = false;
  }

  async function restoreWorkspace(workspace, button) {
    button.disabled = true;
    button.textContent = 'Restoring...';
    try {
      const response = await fetch('/api/cloud/v1/workspaces/' + encodeURIComponent(workspace.id) + '/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error('restore_failed');
      button.closest('.deleted-workspace-row').remove();
      if (!list.children.length) section.hidden = true;
    } catch (_) {
      button.disabled = false;
      button.textContent = 'Restore';
      const status = button.parentNode.querySelector('.deleted-workspace-status');
      status.textContent = 'Could not restore this workspace. Reload and try again.';
    }
  }

  function renderWorkspace(workspace) {
    const row = document.createElement('div');
    row.className = 'deleted-workspace-row';

    const details = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = workspace.name;
    const status = document.createElement('p');
    status.className = 'deleted-workspace-status';
    status.textContent = 'Available until ' + new Date(workspace.purge_after).toLocaleString();
    details.append(name, status);

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Restore';
    button.addEventListener('click', function () { restoreWorkspace(workspace, button); });
    row.append(details, button);
    list.append(row);
  }

  fetch('/api/cloud/v1/workspaces/deleted', { headers: { Accept: 'application/json' } })
    .then(function (response) {
      if (!response.ok) throw new Error('load_failed');
      return response.json();
    })
    .then(function (body) {
      const workspaces = Array.isArray(body.workspaces) ? body.workspaces : [];
      if (!workspaces.length) return;
      workspaces.forEach(renderWorkspace);
      section.hidden = false;
    })
    .catch(function () {
      showError('Could not load recently deleted workspaces. Reload to try again.');
    });
})();
