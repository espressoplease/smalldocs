(function () {
  'use strict';
  var button = document.getElementById('accept-invite');
  var status = document.getElementById('invite-status');
  var token = new URLSearchParams(window.location.search).get('token');

  function show(message, error) {
    status.textContent = message;
    status.classList.toggle('error', Boolean(error));
  }

  if (!token) {
    button.disabled = true;
    show('This invitation link is incomplete.', true);
    return;
  }

  button.addEventListener('click', function () {
    button.disabled = true;
    show('Accepting invitation...');
    fetch('/api/cloud/v1/invitations/' + encodeURIComponent(token) + '/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(function (response) {
      return response.json().then(function (body) { return { response: response, body: body }; });
    }).then(function (result) {
      if (!result.response.ok) {
        if (result.body.error === 'permission_denied') {
          throw new Error('Sign in with the email address this invitation was sent to.');
        }
        throw new Error('This invitation is no longer available.');
      }
      show('Invitation accepted. Opening the Cloud library...');
      window.location.assign('/library?scope=cloud&workspace=' + encodeURIComponent(result.body.workspace_id));
    }).catch(function (error) {
      button.disabled = false;
      show(error.message || 'The invitation could not be accepted.', true);
    });
  });
})();
