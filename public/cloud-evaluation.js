(function () {
  'use strict';
  var checkbox = document.getElementById('evaluation-consent');
  var button = document.getElementById('evaluation-start');
  var status = document.getElementById('evaluation-status');
  var next = document.getElementById('evaluation-next');
  var copy = document.getElementById('evaluation-copy');
  var workspace = null;
  var busy = false;

  function readResponse(response) {
    return response.json().then(function (body) { return { response: response, body: body }; });
  }

  function request(path, options) {
    return fetch(path, Object.assign({ credentials: 'same-origin' }, options || {}))
      .then(readResponse).then(function (result) {
        if (result.response.status === 401) {
          location.href = '/cloud/sign-in?return=' + encodeURIComponent(location.pathname + location.search);
          throw new Error('login_required');
        }
        if (!result.response.ok) throw new Error(result.body.error || 'request_failed');
        return result.body;
      });
  }

  function showWorkspaceInstructions(evaluation, billing) {
    var checkout = '/cloud/checkout?plan=personal&workspace_id=' + encodeURIComponent(workspace.id) +
      '&return=' + encodeURIComponent('/cloud/evaluation?workspace_id=' + workspace.id);
    var paid = evaluation.status === 'converted' && billing && billing.access && billing.access.write;
    var expired = evaluation.status === 'expired';
    var until = new Date(evaluation.endsAtMs).toLocaleString();
    if (paid) {
      copy.textContent = 'This Personal Cloud account has paid access. The evaluation no longer controls access.';
    } else if (expired) {
      copy.textContent = 'Your Cloud evaluation ended on ' + until +
        '. During this staging review, you can read and export existing files. Retention after the review is undecided. Use test documents only.';
    } else if (evaluation.status === 'converted') {
      copy.textContent = 'This Cloud account is currently read only. Review billing settings for its current status.';
    } else {
      copy.textContent = 'Your Cloud evaluation is active until ' + until + '. No payment method is attached.';
    }
    checkbox.checked = false;
    checkbox.disabled = true;
    button.hidden = true;
    next.replaceChildren();
    if (paid || evaluation.status === 'active') {
      var intro = document.createElement('p');
      intro.textContent = 'To enable Cloud-first on a computer, run these commands. The setup command asks you to sign in and choose this Personal Cloud account.';
      var setup = document.createElement('code');
      setup.className = 'evaluation-command';
      setup.textContent = 'sdoc setup --cloud --account ' + workspace.id;
      var open = document.createElement('code');
      open.className = 'evaluation-command';
      open.textContent = 'sdoc FILE.md';
      next.append(intro, setup, open);
    } else if (expired) {
      var library = document.createElement('a');
      library.className = 'evaluation-link';
      library.href = '/library?scope=cloud';
      library.textContent = 'Open Cloud library to read and export';
      next.append(library);
    } else {
      var billingLink = document.createElement('a');
      billingLink.className = 'evaluation-link';
      billingLink.href = '/cloud/admin?panel=billing&workspace_id=' + encodeURIComponent(workspace.id);
      billingLink.textContent = 'Review Cloud billing settings';
      next.append(billingLink);
    }
    if (!paid) {
      var upgrade = document.createElement('a');
      upgrade.className = 'evaluation-link';
      upgrade.href = checkout;
      upgrade.textContent = 'Choose a paid Cloud subscription';
      next.append(upgrade);
    }
    next.hidden = false;
    // Move focus to the newly revealed next step after starting the evaluation.
    // Existing evaluations may load on page entry, where moving focus would be disruptive.
    if (paid) status.textContent = 'Paid Cloud access is active.';
    else if (expired || evaluation.status === 'converted') {
      status.textContent = 'Cloud changes are disabled for this account.';
    } else status.textContent = 'Evaluation started. Its end date is ' + until + '.';
  }

  function loadExisting() {
    request('/api/cloud/v1/workspaces').then(function (result) {
      var personal = (result.workspaces || []).find(function (item) {
        return item.kind === 'personal' && item.role === 'owner';
      });
      if (!personal) return;
      workspace = personal;
      return request('/api/cloud/v1/workspaces/' + encodeURIComponent(workspace.id) + '/billing')
        .then(function (billingResult) {
          if (billingResult.billing && billingResult.billing.evaluation) {
            showWorkspaceInstructions(billingResult.billing.evaluation, billingResult.billing);
          }
        });
    }).catch(function (error) {
      if (error.message !== 'login_required') {
        status.textContent = 'Cloud could not load. Refresh this page to try again, or sign in again if the problem continues.';
        status.className = 'status evaluation-status error';
      }
    });
  }

  checkbox.addEventListener('change', function () {
    button.disabled = !checkbox.checked || busy;
  });

  button.addEventListener('click', function () {
    if (!checkbox.checked || busy) return;
    busy = true;
    button.disabled = true;
    status.textContent = 'Starting your evaluation...';
    var ensureWorkspace = workspace ? Promise.resolve(workspace) : request('/api/cloud/v1/workspaces', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'personal' }),
    }).then(function (result) {
      workspace = result.workspace;
      return workspace;
    });
    ensureWorkspace.then(function (current) {
      workspace = current;
      return request('/api/cloud/v1/evaluations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspace.id, cloud_first_consent: true,
          terms_version: document.querySelector('meta[name="cloud-terms-version"]').content }),
      });
    }).then(function (result) {
      showWorkspaceInstructions(result.evaluation);
      next.focus();
    }).catch(function (error) {
      if (error.message === 'login_required') return;
      status.textContent = error.message === 'subscription_exists'
        ? 'This account already has a paid subscription.'
        : 'The evaluation could not be started. Refresh the page and try again.';
      status.className = 'status evaluation-status error';
      busy = false;
      button.disabled = !checkbox.checked;
    });
  });

  loadExisting();
})();
