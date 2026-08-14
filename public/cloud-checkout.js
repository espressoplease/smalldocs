(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var plan = params.get('plan');
  var returnTo = params.get('return');
  var select = document.getElementById('checkout-workspace');
  var workspaceField = document.getElementById('checkout-workspace-field');
  var teamField = document.getElementById('checkout-team-field');
  var teamName = document.getElementById('checkout-team-name');
  var button = document.getElementById('checkout-button');
  var status = document.getElementById('checkout-status');
  var needsTeamWorkspace = false;
  if (plan !== 'personal' && plan !== 'team') {
    status.textContent = 'Choose Personal or Team Cloud from the Cloud page.';
    status.className = 'status error';
    return;
  }
  document.getElementById('checkout-title').textContent =
    plan === 'team' ? 'Subscribe to Team Cloud' : 'Subscribe to Personal Cloud';

  function readResponse(response) {
    return response.json().then(function (body) { return { response: response, body: body }; });
  }

  function handleLogin(result) {
    if (result.response.status === 401) {
      location.href = '/cloud/sign-in?return=' + encodeURIComponent(location.pathname + location.search);
      throw new Error('login_required');
    }
    return result;
  }

  function addWorkspace(workspace) {
    var option = document.createElement('option');
    option.value = workspace.id;
    option.textContent = workspace.name;
    select.appendChild(option);
  }

  function showTeamCreation() {
    needsTeamWorkspace = true;
    workspaceField.hidden = true;
    teamField.hidden = false;
    button.disabled = !teamName.value.trim();
    button.textContent = 'Create workspace and continue';
    status.textContent = 'Enter a name for the team workspace you want to subscribe to.';
  }

  fetch('/api/cloud/v1/workspaces', { credentials: 'same-origin' }).then(readResponse).then(handleLogin).then(function (result) {
    if (!result.response.ok) throw new Error(result.body.error || 'request_failed');
    var workspaces = (result.body.workspaces || []).filter(function (workspace) {
      return workspace.role === 'owner' && workspace.kind === plan;
    });
    select.replaceChildren();
    workspaces.forEach(addWorkspace);
    button.disabled = !workspaces.length;
    if (!workspaces.length && plan === 'team') showTeamCreation();
    else if (!workspaces.length) status.textContent = 'Your personal workspace is not available.';
  }).catch(function (error) {
    if (error.message !== 'login_required') status.textContent = 'Billing is temporarily unavailable.';
  });

  teamName.addEventListener('input', function () {
    if (needsTeamWorkspace) button.disabled = !teamName.value.trim();
  });

  function createTeamWorkspace() {
    var name = teamName.value.trim();
    if (!name) return Promise.reject(new Error('team_name_required'));
    status.textContent = 'Creating team workspace...';
    return fetch('/api/cloud/v1/workspaces', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, project_name: 'Documents' }),
    }).then(readResponse).then(handleLogin).then(function (result) {
      if (!result.response.ok) throw new Error(result.body.error || 'request_failed');
      var created = result.body.workspace || {};
      var workspaceId = created.workspaceId || created.workspace_id || created.id;
      if (!workspaceId) throw new Error('invalid_workspace_response');
      select.replaceChildren();
      addWorkspace({ id: workspaceId, name: name });
      select.value = workspaceId;
      needsTeamWorkspace = false;
      workspaceField.hidden = false;
      teamField.hidden = true;
      return workspaceId;
    });
  }

  function openCheckout(workspaceId) {
    button.textContent = 'Opening payment...';
    status.textContent = 'Opening payment...';
    var checkout = { workspace_id: workspaceId, plan: plan };
    if (returnTo) checkout.return_to = returnTo;
    return fetch('/api/cloud/billing/checkout', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkout) }).then(readResponse).then(handleLogin)
      .then(function (result) {
        if (!result.response.ok || !result.body.checkout_url) {
          throw new Error(result.body.error || 'request_failed');
        }
        location.assign(result.body.checkout_url);
      });
  }

  button.addEventListener('click', function () {
    button.disabled = true;
    status.className = 'status';
    var creationRequired = needsTeamWorkspace;
    button.textContent = creationRequired ? 'Creating workspace...' : 'Opening payment...';
    var workspace = creationRequired ? createTeamWorkspace() : Promise.resolve(select.value);
    workspace.then(openCheckout).catch(function (error) {
      if (error.message === 'login_required') return;
      button.disabled = false;
      button.textContent = needsTeamWorkspace ? 'Create workspace and continue' : 'Continue to payment';
      status.textContent = creationRequired && needsTeamWorkspace
        ? 'The team workspace could not be created. Try again.'
        : 'Payment could not be opened. Try again.';
      status.className = 'status error';
    });
  });
})();
