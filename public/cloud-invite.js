(function () {
  'use strict';
  var button = document.getElementById('accept-invite');
  var status = document.getElementById('invite-status');
  var firstName = document.getElementById('invite-first-name');
  var lastName = document.getElementById('invite-last-name');
  var token = new URLSearchParams(window.location.search).get('token');
  var profileLoaded = false;

  function show(message, error) {
    status.textContent = message;
    status.classList.toggle('error', Boolean(error));
  }

  function readResponse(response) {
    return response.json().then(function (body) { return { response: response, body: body }; });
  }

  function refreshButton() {
    button.disabled = !profileLoaded || !firstName.value.trim() || !lastName.value.trim();
  }

  function returnToSignIn() {
    window.location.assign('/cloud/sign-in?return=' +
      encodeURIComponent(window.location.pathname + window.location.search));
  }

  if (!token) {
    button.disabled = true;
    show('This invitation link is incomplete.', true);
    return;
  }

  firstName.addEventListener('input', refreshButton);
  lastName.addEventListener('input', refreshButton);

  show('Loading your details...');
  fetch('/api/cloud/v1/me', { credentials: 'same-origin' }).then(readResponse).then(function (result) {
    if (result.response.status === 401) {
      returnToSignIn();
      return;
    }
    if (!result.response.ok) throw new Error('Your details could not be loaded.');
    firstName.value = result.body.user.first_name || '';
    lastName.value = result.body.user.last_name || '';
    profileLoaded = true;
    show('');
    refreshButton();
  }).catch(function (error) {
    show(error.message || 'Your details could not be loaded.', true);
  });

  button.addEventListener('click', function () {
    button.disabled = true;
    show('Saving your details...');
    fetch('/api/cloud/v1/me', {
      method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: firstName.value.trim(), last_name: lastName.value.trim() }),
    }).then(readResponse).then(function (profileResult) {
      if (profileResult.response.status === 401) {
        returnToSignIn();
        throw new Error('login_required');
      }
      if (!profileResult.response.ok) throw new Error('Enter your first and last name.');
      show('Accepting invitation...');
      return fetch('/api/cloud/v1/invitations/' + encodeURIComponent(token) + '/accept', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }).then(readResponse);
    }).then(function (result) {
      if (!result.response.ok) {
        if (result.body.error === 'permission_denied') {
          throw new Error('Sign in with the email address this invitation was sent to.');
        }
        if (result.body.error === 'profile_required') {
          throw new Error('Enter your first and last name.');
        }
        throw new Error('This invitation is no longer available.');
      }
      show('Invitation accepted. Opening the Cloud library...');
      window.location.assign('/library?scope=cloud&workspace=' + encodeURIComponent(result.body.workspace_id));
    }).catch(function (error) {
      if (error.message !== 'login_required') {
        refreshButton();
        show(error.message || 'The invitation could not be accepted.', true);
      }
    });
  });
})();
