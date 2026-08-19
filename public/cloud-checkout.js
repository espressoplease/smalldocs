(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var requestedPlan = params.get('plan');
  var plan = requestedPlan === 'personal' || requestedPlan === 'team' ? requestedPlan : null;
  var returnTo = params.get('return');
  var select = document.getElementById('checkout-workspace');
  var workspaceField = document.getElementById('checkout-workspace-field');
  var teamField = document.getElementById('checkout-team-field');
  var teamName = document.getElementById('checkout-team-name');
  var button = document.getElementById('checkout-button');
  var status = document.getElementById('checkout-status');
  var planField = document.getElementById('checkout-plan-field');
  var back = document.getElementById('checkout-back');
  var detail = document.getElementById('checkout-detail');
  var profileField = document.getElementById('checkout-profile-field');
  var profileFirstName = document.getElementById('checkout-profile-first-name');
  var profileLastName = document.getElementById('checkout-profile-last-name');
  var selectionName = document.getElementById('checkout-selection-name');
  var planNote = document.getElementById('checkout-plan-note');
  var paymentNote = document.getElementById('checkout-payment-note');
  var workspaces = [];
  var workspacesLoaded = false;
  var needsWorkspace = false;
  var planReady = false;
  var planHistoryEntry = false;

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

  function showPlanChoices() {
    plan = null;
    needsWorkspace = false;
    planReady = false;
    planField.hidden = false;
    back.hidden = true;
    detail.hidden = true;
    profileField.hidden = true;
    workspaceField.hidden = true;
    teamField.hidden = true;
    button.hidden = true;
    paymentNote.hidden = true;
    status.textContent = '';
    status.className = 'status';
    document.getElementById('checkout-title').textContent = 'Who is Cloud for?';
    document.getElementById('checkout-copy').textContent =
      'Choose the account that matches how you want to share documents.';
  }

  function refreshContinueState() {
    button.disabled = !workspacesLoaded || !planReady || !profileFirstName.value.trim() ||
      !profileLastName.value.trim() ||
      (needsWorkspace && plan === 'team' && !teamName.value.trim());
  }

  function populateProfile(user) {
    if (!user) return;
    profileFirstName.value = user.first_name || '';
    profileLastName.value = user.last_name || '';
  }

  function showWorkspaceCreation() {
    needsWorkspace = true;
    planReady = true;
    workspaceField.hidden = true;
    teamField.hidden = plan !== 'team';
    refreshContinueState();
    button.textContent = 'Continue to payment';
    status.textContent = '';
  }

  function configurePlan() {
    if (!plan || !workspacesLoaded) return;
    var matching = workspaces.filter(function (workspace) {
      return workspace.role === 'owner' && workspace.kind === plan;
    });
    needsWorkspace = false;
    planReady = false;
    select.replaceChildren();
    workspaceField.hidden = true;
    teamField.hidden = true;
    status.textContent = '';
    status.className = 'status';
    matching.forEach(addWorkspace);
    if (matching.length) select.value = matching[0].id;
    if (!matching.length) {
      showWorkspaceCreation();
      return;
    }
    planReady = true;
    workspaceField.hidden = matching.length < 2;
    refreshContinueState();
    button.textContent = 'Continue to payment';
  }

  function selectPlan(nextPlan, addHistory) {
    if (addHistory && typeof history !== 'undefined' && history.pushState) {
      history.pushState({ cloudCheckoutPlan: nextPlan }, '', location.pathname + location.search);
      planHistoryEntry = true;
    }
    plan = nextPlan;
    planField.hidden = true;
    back.hidden = false;
    detail.hidden = false;
    profileField.hidden = false;
    button.hidden = false;
    paymentNote.hidden = false;
    selectionName.textContent = plan === 'team' ? 'My team' : 'Just me';
    planNote.textContent = plan === 'team'
      ? '£7 per member each month. Invite people and set access after payment.'
      : '£4 each month. Documents start with access for you only.';
    document.getElementById('checkout-title').textContent = 'Set up Cloud';
    document.getElementById('checkout-copy').textContent =
      'Review your choice, then continue to Stripe to pay.';
    refreshContinueState();
    status.className = 'status';
    status.textContent = workspacesLoaded ? '' : 'Checking your account...';
    configurePlan();
  }

  document.getElementById('checkout-personal').addEventListener('click', function () {
    selectPlan('personal', true);
  });
  document.getElementById('checkout-team').addEventListener('click', function () {
    selectPlan('team', true);
  });
  document.getElementById('checkout-back').addEventListener('click', function () {
    if (planHistoryEntry && typeof history !== 'undefined' && history.back) {
      history.back();
      return;
    }
    showPlanChoices();
    if (typeof history !== 'undefined' && history.replaceState) {
      history.replaceState({ cloudCheckoutChoice: true }, '', location.pathname + location.search);
    }
  });

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('popstate', function (event) {
      if (event.state && event.state.cloudCheckoutPlan) {
        planHistoryEntry = true;
        selectPlan(event.state.cloudCheckoutPlan, false);
        return;
      }
      planHistoryEntry = false;
      showPlanChoices();
    });
  }

  if (plan) selectPlan(plan, false);
  else {
    if (typeof history !== 'undefined' && history.replaceState) {
      history.replaceState({ cloudCheckoutChoice: true }, '', location.pathname + location.search);
    }
    showPlanChoices();
  }

  fetch('/api/cloud/v1/workspaces', { credentials: 'same-origin' }).then(readResponse).then(handleLogin)
    .then(function (result) {
      if (!result.response.ok) throw new Error(result.body.error || 'request_failed');
      workspaces = result.body.workspaces || [];
      workspacesLoaded = true;
      populateProfile(result.body.user);
      configurePlan();
    }).catch(function (error) {
      if (error.message !== 'login_required') {
        status.textContent = 'Billing is temporarily unavailable.';
        status.className = 'status error';
      }
    });

  teamName.addEventListener('input', function () {
    refreshContinueState();
  });

  profileFirstName.addEventListener('input', refreshContinueState);
  profileLastName.addEventListener('input', refreshContinueState);

  function updateProfile() {
    status.textContent = 'Saving your details...';
    return fetch('/api/cloud/v1/me', {
      method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: profileFirstName.value.trim(),
        last_name: profileLastName.value.trim(),
      }),
    }).then(readResponse).then(handleLogin).then(function (result) {
      if (!result.response.ok) throw new Error(result.body.error || 'profile_update_failed');
    });
  }

  function createWorkspace() {
    var name = plan === 'team' ? teamName.value.trim()
      : [profileFirstName.value.trim(), profileLastName.value.trim()].join(' ');
    if (!name) return Promise.reject(new Error('account_name_required'));
    status.textContent = plan === 'team' ? 'Creating your team...' : 'Creating your account...';
    return fetch('/api/cloud/v1/workspaces', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: plan, name: name, project_name: 'Documents' }),
    }).then(readResponse).then(handleLogin).then(function (result) {
      if (!result.response.ok) throw new Error(result.body.error || 'request_failed');
      var created = result.body.workspace || {};
      var workspaceId = created.workspaceId || created.workspace_id || created.id;
      if (!workspaceId) throw new Error('invalid_workspace_response');
      select.replaceChildren();
      addWorkspace({ id: workspaceId, name: name });
      select.value = workspaceId;
      needsWorkspace = false;
      workspaceField.hidden = true;
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
    if (!plan) return;
    button.disabled = true;
    status.className = 'status';
    var creationRequired = needsWorkspace;
    button.textContent = creationRequired
      ? (plan === 'team' ? 'Creating your team...' : 'Creating your account...')
      : 'Opening payment...';
    var workspace = updateProfile().then(function () {
      return creationRequired ? createWorkspace() : select.value;
    });
    workspace.then(openCheckout).catch(function (error) {
      if (error.message === 'login_required') return;
      button.disabled = false;
      button.textContent = 'Continue to payment';
      status.textContent = creationRequired && needsWorkspace
        ? 'Your account could not be created. Try again.'
        : 'Payment could not be opened. Try again.';
      status.className = 'status error';
    });
  });
})();
