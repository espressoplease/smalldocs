(function () {
  'use strict';
  const form = document.getElementById('authorize-form');
  const input = document.getElementById('user-code');
  const detail = document.getElementById('authorization-detail');
  const result = document.getElementById('authorization-result');
  const button = document.getElementById('authorize-button');
  const params = new URLSearchParams(location.search);
  if (params.get('user_code')) input.value = params.get('user_code').toUpperCase();

  function normalizedCode() {
    return input.value.toUpperCase().replace(/[^A-Z2-9]/g, '');
  }

  async function lookup() {
    const code = normalizedCode();
    if (code.length !== 8) { detail.textContent = ''; return null; }
    const response = await fetch('/api/cloud/v1/cli/device-authorizations/lookup?user_code=' + encodeURIComponent(code), {
      credentials: 'same-origin',
    });
    if (!response.ok) { detail.textContent = 'This code is invalid or has expired.'; return null; }
    const data = await response.json();
    detail.textContent = 'Request from ' + data.authorization.display_name + '.';
    return data.authorization;
  }

  input.addEventListener('input', function () {
    const code = normalizedCode();
    input.value = code.length > 4 ? code.slice(0, 4) + '-' + code.slice(4, 8) : code;
    lookup().catch(function () { detail.textContent = 'Could not check this code.'; });
  });
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    const authorization = await lookup();
    if (!authorization) return;
    button.disabled = true;
    button.textContent = 'Authorizing...';
    const response = await fetch('/api/cloud/v1/cli/device-authorizations/approve', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_code: normalizedCode() }),
    });
    if (response.ok) {
      form.hidden = true;
      result.textContent = 'CLI authorized. You can return to the terminal.';
    } else {
      button.disabled = false;
      button.textContent = 'Try again';
      result.textContent = 'The CLI could not be authorized.';
    }
  });
  if (input.value) lookup().catch(function () {});
})();
