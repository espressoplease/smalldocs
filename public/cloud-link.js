(function () {
  'use strict';
  function byId(id) { return document.getElementById(id); }
  var addEmail = location.pathname === '/cloud/link-email';
  var challenge = null, needsEmail = true;
  var form = byId('link-form'), button = byId('link-submit'), error = byId('link-error');
  function explain(code) {
    if (code === 'identity_in_use' || code === 'account_link_required') return 'This sign-in method belongs to a different SmallDocs account. Sign in with it to open that account.';
    if (code === 'link_expired') return 'This connection has expired. Sign in again, or return to settings to start again.';
    if (code === 'recent_auth_required' || code === 'authentication_required') return 'Sign in again before connecting this sign-in method.';
    if (code === 'rate_limited') return 'Too many attempts. Try again later.';
    return 'The connection could not be completed. Try again.';
  }
  async function request(url, data) {
    var response = await fetch(url, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {});
    var result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }
  async function sendCode() {
    var result = await request('/api/cloud/auth/email/request', addEmail
      ? { email: byId('link-email').value.trim(), link_email: true }
      : { link_google: true });
    challenge = result.challenge_id;
    byId('link-email-field').hidden = true;
    byId('link-code-field').hidden = false;
    byId('link-code').required = true;
    byId('link-code').value = '';
    byId('link-intro').textContent = 'Enter the code sent to ' + (addEmail ? byId('link-email').value.trim() : form.dataset.email) + '.';
    byId('link-resend-row').hidden = false;
    button.textContent = addEmail ? 'Add email address' : 'Connect Google';
    byId('link-code').focus();
  }
  form.addEventListener('submit', async function (event) {
    event.preventDefault(); if (!form.reportValidity()) return;
    button.disabled = true; error.textContent = '';
    try {
      if (needsEmail && !challenge) { await sendCode(); return; }
      var result = await request(addEmail ? '/api/cloud/auth/email/verify' : '/api/cloud/auth/link', {
        challenge_id: challenge, code: byId('link-code').value, return_to: '/cloud/admin?panel=preferences',
      });
      location.assign(result.return_to);
    } catch (failure) {
      error.textContent = failure.message === 'invalid_or_expired_code' ? 'The code is invalid or has expired. Try again or request another code.' : explain(failure.message);
    } finally { button.disabled = false; }
  });
  byId('link-resend').addEventListener('click', async function () {
    this.disabled = true; error.textContent = '';
    try { await sendCode(); } catch (failure) { error.textContent = explain(failure.message); }
    finally { this.disabled = false; }
  });
  request('/api/cloud/auth/link' + (addEmail ? '?email=1' : '')).then(function (data) {
    needsEmail = addEmail || data.needs_email;
    form.dataset.email = data.email || '';
    byId('link-title').textContent = addEmail ? 'Add an email address' : 'Connect Google';
    byId('link-intro').textContent = addEmail ? 'Add an email address you can use to sign in to this account.' : needsEmail
      ? 'Confirm access to ' + data.email + ' to use this Google account with SmallDocs.'
      : 'Use ' + data.email + ' to sign in to your existing SmallDocs account.';
    if (data.account_email) {
      byId('link-account-label').textContent = 'Your SmallDocs account: ' + data.account_email;
      byId('link-account').hidden = false;
    }
    byId('link-email-field').hidden = !addEmail;
    byId('link-email').required = addEmail;
    button.textContent = needsEmail ? 'Email me a code' : 'Connect Google';
    form.hidden = false;
  }).catch(function (failure) {
    byId('link-intro').textContent = explain(failure.message);
  });
})();
