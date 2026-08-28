(function () {
  'use strict';

  var DEFAULT_RETURN = '/cloud/admin';
  var form = document.getElementById('terms-form');
  var accepted = document.getElementById('terms-accepted');
  var submit = document.getElementById('terms-submit');
  var error = document.getElementById('terms-error');
  var status = document.getElementById('terms-status');

  function safeReturnPath(value) {
    if (!value || value.charAt(0) !== '/' || value.slice(0, 2) === '//') return DEFAULT_RETURN;
    if (value.indexOf('\\') !== -1 || /[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_RETURN;
    try {
      var parsed = new URL(value, window.location.origin);
      if (parsed.origin !== window.location.origin) return DEFAULT_RETURN;
      return parsed.pathname + parsed.search + parsed.hash;
    } catch (_) {
      return DEFAULT_RETURN;
    }
  }

  var returnTo = safeReturnPath(new URLSearchParams(window.location.search).get('return'));

  accepted.addEventListener('change', function () {
    submit.disabled = !accepted.checked;
    if (accepted.checked) error.textContent = '';
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!accepted.checked) {
      error.textContent = 'Agree to the Terms to continue.';
      accepted.focus();
      return;
    }
    submit.disabled = true;
    status.textContent = 'Saving your acceptance...';
    fetch(form.action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accepted: true,
        terms_version: document.getElementById('terms-version').value,
        return_to: returnTo
      })
    }).then(function (response) {
      return response.json().then(function (body) { return { response: response, body: body }; });
    }).then(function (result) {
      if (result.response.status === 401) {
        window.location.assign('/cloud/sign-in?return=' + encodeURIComponent(
          window.location.pathname + window.location.search));
        return;
      }
      if (!result.response.ok) throw new Error('acceptance_failed');
      window.location.assign(result.body.return_to || returnTo);
    }).catch(function () {
      submit.disabled = false;
      status.textContent = '';
      error.textContent = 'Your acceptance could not be saved. Try again.';
    });
  });
})();
