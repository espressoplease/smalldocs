(function () {
  'use strict';
  var token = new URLSearchParams(location.search).get('token');
  var status = document.getElementById('review-status');
  var form = document.getElementById('review-form');
  function byId(id) { return document.getElementById(id); }
  byId('review-sign-in').href = '/cloud/sign-in?return=' + encodeURIComponent(location.pathname + location.search);
  function unavailable(message) {
    byId('review-title').textContent = 'Request unavailable';
    byId('review-intro').hidden = true;
    status.textContent = message; byId('review-recovery').hidden = false;
  }
  if (!token) { unavailable('This request link is incomplete. Ask the sender for the full link.'); return; }
  fetch('/api/cloud/v1/join-requests/review?token=' + encodeURIComponent(token || '')).then(async function (response) {
    if (!response.ok) throw new Error();
    var data = await response.json();
    byId('requester-name').textContent = data.request.name;
    byId('requester-email').textContent = data.request.email;
    byId('requester-note').textContent = data.request.note;
    data.workspaces.forEach(function (workspace) {
      var option = document.createElement('option'); option.value = workspace.id; option.textContent = workspace.name;
      byId('review-team').appendChild(option);
    });
    form.hidden = false; status.textContent = '';
  }).catch(function () { unavailable('This request is unavailable for this account. Use the work email you use to manage your library, or ask the sender for a new link.'); });
  form.addEventListener('submit', async function (event) {
    event.preventDefault(); var button = form.querySelector('button'); button.disabled = true;
    try {
      var response = await fetch('/api/cloud/v1/join-requests/invite', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, workspace_id: byId('review-team').value }) });
      if (!response.ok) throw new Error();
      var data = await response.json();
      status.textContent = data.invitation.notification_scheduled ? 'Invitation created. An email will be sent. You can also share the link.' : 'Invitation created. Share this link with the requester.';
      form.hidden = true; byId('review-result').hidden = false; byId('invite-link').value = data.invitation.accept_url;
    } catch (_) { status.textContent = 'The invitation could not be sent. Check People and Billing in settings, then try again.'; button.disabled = false; }
  });
  byId('copy-invite').addEventListener('click', async function () {
    try { await navigator.clipboard.writeText(byId('invite-link').value); status.textContent = 'Invitation link copied'; }
    catch (_) { status.textContent = 'Select the invitation link and copy it.'; }
  });
})();
