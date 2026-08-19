(function () {
  'use strict';
  var form = document.getElementById('test-login-form');
  var error = document.getElementById('test-error');
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    error.textContent = '';
    var button = form.querySelector('button');
    button.disabled = true;
    try {
      var response = await fetch('/api/cloud/auth/test-login', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: document.getElementById('test-email').value.trim(),
          secret: document.getElementById('test-secret').value,
          return_to: new URLSearchParams(location.search).get('return') || '/cloud/admin' }),
      });
      var body = await response.json();
      if (!response.ok) throw new Error(body.error || 'request_failed');
      location.assign(body.return_to);
    } catch (_) {
      button.disabled = false;
      error.textContent = 'The test identity or staging secret was not accepted.';
    }
  });
})();
