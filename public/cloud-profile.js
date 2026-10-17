(function () {
  'use strict';
  var returnTo = '/cloud/start';
  try {
    var target = new URL(new URLSearchParams(location.search).get('return') || returnTo, location.origin);
    if (target.origin === location.origin && ['/cloud/start', '/cloud/invite', '/cloud/admin'].includes(target.pathname)) returnTo = target.pathname + target.search;
  } catch (_) {}
  var form = document.getElementById('profile-form');
  var first = document.getElementById('profile-first');
  var last = document.getElementById('profile-last');
  var status = document.getElementById('profile-status');
  async function load() {
    try {
      var response = await fetch('/api/cloud/v1/me');
      if (response.status === 401) { location.assign('/cloud/sign-in?return=%2Fcloud%2Fprofile'); return; }
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
        body: JSON.stringify({ first_name: first.value.trim(), last_name: last.value.trim() }) });
      if (!response.ok) throw new Error();
      location.assign(returnTo);
    } catch (_) { status.textContent = 'Your details could not be saved. Try again.'; button.disabled = false; }
  });
  load();
})();
