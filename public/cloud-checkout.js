(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var plan = params.get('plan');
  var select = document.getElementById('checkout-workspace');
  var button = document.getElementById('checkout-button');
  var status = document.getElementById('checkout-status');
  if (plan !== 'personal' && plan !== 'team') {
    status.textContent = 'Choose Personal or Team Cloud from the Cloud page.';
    status.className = 'status error';
    return;
  }
  document.getElementById('checkout-title').textContent =
    plan === 'team' ? 'Subscribe to Team Cloud' : 'Subscribe to Personal Cloud';
  fetch('/api/cloud/v1/workspaces', { credentials: 'same-origin' }).then(function (response) {
    return response.json().then(function (body) { return { response: response, body: body }; });
  }).then(function (result) {
    if (result.response.status === 401) {
      location.href = '/cloud/sign-in?return=' + encodeURIComponent(location.pathname + location.search);
      return;
    }
    var workspaces = (result.body.workspaces || []).filter(function (workspace) {
      return workspace.role === 'owner' && workspace.kind === plan;
    });
    select.replaceChildren();
    workspaces.forEach(function (workspace) {
      var option = document.createElement('option');
      option.value = workspace.id;
      option.textContent = workspace.name;
      select.appendChild(option);
    });
    button.disabled = !workspaces.length;
    if (!workspaces.length) status.textContent = plan === 'team'
      ? 'Create a team workspace before subscribing.'
      : 'Your personal workspace is not available.';
  }).catch(function () { status.textContent = 'Billing is temporarily unavailable.'; });

  button.addEventListener('click', function () {
    button.disabled = true;
    button.textContent = 'Opening payment...';
    fetch('/api/cloud/billing/checkout', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: select.value, plan: plan }) }).then(function (response) {
      return response.json().then(function (body) { return { response: response, body: body }; });
    }).then(function (result) {
      if (!result.response.ok || !result.body.checkout_url) throw new Error(result.body.error || 'request_failed');
      location.assign(result.body.checkout_url);
    }).catch(function () {
      button.disabled = false;
      button.textContent = 'Continue to payment';
      status.textContent = 'Payment could not be opened. Try again.';
      status.className = 'status error';
    });
  });
})();
