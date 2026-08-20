(function () {
  'use strict';

  var DEFAULT_RETURN = '/cloud/admin';
  var params = new URLSearchParams(window.location.search);

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

  function returnLabel(path) {
    if (path.indexOf('/library') === 0) return 'Cloud library';
    if (path.indexOf('/cloud/admin') === 0) return 'Cloud settings';
    if (path.indexOf('/cloud/checkout') === 0) return 'checkout';
    if (path.indexOf('/cloud/authorize') === 0) return 'CLI authorization';
    if (path.indexOf('/cloud/document') === 0) return 'your document';
    return path;
  }

  var returnPath = safeReturnPath(params.get('return'));
  var label = returnLabel(returnPath);
  var choiceView = document.getElementById('choice-view');
  var codeView = document.getElementById('code-view');
  var emailForm = document.getElementById('email-form');
  var codeForm = document.getElementById('code-form');
  var emailInput = document.getElementById('email');
  var codeInput = document.getElementById('code');
  var status = document.getElementById('prototype-status');

  if (params.get('error')) {
    status.textContent = 'Sign-in could not be completed. Try again or use email.';
  }

  document.getElementById('return-label').textContent = label;
  Array.prototype.forEach.call(document.querySelectorAll('.return-input'), function (input) {
    input.value = returnPath;
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-provider]'), function (link) {
    link.href += '?return_to=' + encodeURIComponent(returnPath);
  });

  emailForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    var value = emailInput.value.trim();
    var error = document.getElementById('email-error');
    if (!emailInput.validity.valid || !value) {
      emailInput.setAttribute('aria-invalid', 'true');
      error.textContent = 'Enter a valid email address.';
      emailInput.focus();
      return;
    }
    emailInput.removeAttribute('aria-invalid');
    error.textContent = '';
    status.textContent = 'Sending code...';
    try {
      var response = await fetch(emailForm.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, return_to: returnPath })
      });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || 'request_failed');
      document.getElementById('sent-email').textContent = value;
      document.getElementById('email-challenge').value = result.challenge_id;
      choiceView.hidden = true;
      codeView.hidden = false;
      status.textContent = '';
      codeInput.focus();
    } catch (_) {
      status.textContent = 'The code could not be sent. Try again.';
    }
  });

  codeInput.addEventListener('input', function () {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
    codeInput.removeAttribute('aria-invalid');
    document.getElementById('code-error').textContent = '';
  });

  codeForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!/^[0-9]{6}$/.test(codeInput.value)) {
      codeInput.setAttribute('aria-invalid', 'true');
      document.getElementById('code-error').textContent = 'Enter the six-digit code.';
      codeInput.focus();
      return;
    }
    status.textContent = 'Checking code...';
    try {
      var response = await fetch(codeForm.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: document.getElementById('email-challenge').value,
          code: codeInput.value,
          return_to: returnPath
        })
      });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || 'verification_failed');
      window.location.assign(result.return_to || returnPath);
    } catch (_) {
      codeInput.setAttribute('aria-invalid', 'true');
      document.getElementById('code-error').textContent = 'The code is invalid or has expired.';
      status.textContent = '';
      codeInput.focus();
    }
  });

  document.getElementById('change-email').addEventListener('click', function () {
    codeView.hidden = true;
    choiceView.hidden = false;
    codeInput.value = '';
    status.textContent = '';
    emailInput.focus();
  });

  document.getElementById('resend-code').addEventListener('click', function () {
    var button = this;
    button.disabled = true;
    button.textContent = 'Code requested';
    emailForm.requestSubmit();
    window.setTimeout(function () {
      button.disabled = false;
      button.textContent = 'Send another code';
    }, 3000);
  });
})();
