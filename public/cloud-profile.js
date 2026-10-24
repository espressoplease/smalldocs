(function () {
  'use strict';
  var returnTo = '/cloud/start';
  try {
    var requested = new URLSearchParams(location.search).get('return') || returnTo;
    var target = new URL(requested, location.origin);
    if (requested.charAt(0) === '/' && requested.slice(0, 2) !== '//' &&
        !/[\\\u0000-\u001f\u007f]/.test(requested) && target.origin === location.origin) {
      returnTo = target.pathname + target.search + target.hash;
    }
  } catch (_) {}
  var form = document.getElementById('profile-form');
  var first = document.getElementById('profile-first');
  var last = document.getElementById('profile-last');
  var status = document.getElementById('profile-status');
  async function load() {
    try {
      var response = await fetch('/api/cloud/v1/me');
      if (response.status === 401) { location.assign('/cloud/sign-in?return=' + encodeURIComponent(location.pathname + location.search)); return; }
      if (!response.ok) throw new Error();
      var data = await response.json();
      document.getElementById('profile-email').textContent = data.user.email || '';
      first.value = data.user.first_name || '';
      last.value = data.user.last_name || '';
      first.focus();
    } catch (_) { status.textContent = 'Your details could not be loaded. Reload to try again.'; }
  }
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    var button = form.querySelector('button');
    button.disabled = true;
    status.textContent = '';
    try {
      var response = await fetch('/api/cloud/v1/me', { method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: first.value.trim(), last_name: last.value.trim(), return_to: returnTo }) });
      if (!response.ok) throw new Error();
      var data = await response.json();
      location.assign(data.return_to || returnTo);
    } catch (_) { status.textContent = 'Your details could not be saved. Try again.'; button.disabled = false; }
  });
  load();
})();
