(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var token = params.get('token');
  var preview = params.get('preview') === 'signin';
  var authCard = document.getElementById('invite-auth');
  var termsCard = document.getElementById('invite-terms');
  var acceptCard = document.getElementById('invite-accept');
  var completeCard = document.getElementById('invite-complete');
  var button = document.getElementById('accept-invite');
  var status = document.getElementById('invite-status');
  var firstName = document.getElementById('invite-first-name');
  var lastName = document.getElementById('invite-last-name');
  var profileLoaded = false;
  var invitationData = {};
  var resumeKey = 'sdocs-business-invite:' + (token || 'preview');

  function clean(value, maxLength) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
  }

  function base64UrlBytes(value) {
    var base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    var binary = window.atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function decryptInvitation(fragment) {
    var match = /^#invite=v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(fragment || '');
    if (!match || !window.crypto || !window.crypto.subtle) return {};
    var keyBytes = base64UrlBytes(match[1]);
    var packed = base64UrlBytes(match[2]);
    if (keyBytes.length !== 32 || packed.length < 29) return {};
    var key = await window.crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    var plaintext = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: packed.slice(0, 12) }, key, packed.slice(12));
    var data = JSON.parse(new TextDecoder().decode(plaintext));
    return {
      name: clean(data.name, 80),
      firstName: clean(data.first_name, 128),
      lastName: clean(data.last_name, 128),
      email: clean(data.email, 254),
      company: clean(data.company, 120),
      inviter: clean(data.inviter, 80)
    };
  }

  function inviteFragment() {
    if (window.location.hash.indexOf('#invite=') === 0) {
      try { window.sessionStorage.setItem(resumeKey, window.location.hash); } catch (_) {}
      return window.location.hash;
    }
    if (params.get('resume_invite') === '1') {
      try { return window.sessionStorage.getItem(resumeKey) || ''; } catch (_) { return ''; }
    }
    return '';
  }

  function applyInvitation(data) {
    invitationData = data;
    var displayName = data.name || data.firstName;
    if (displayName) document.getElementById('page-title').textContent =
      'Welcome to SmallDocs, ' + displayName;
    if (data.company) {
      document.getElementById('nav-label').textContent = data.company + ' invitation';
      document.getElementById('sdk-heading').textContent = 'Build SmallDocs into ' + data.company;
      document.title = 'SmallDocs for ' + data.company;
    }
    if (data.inviter && data.company) document.getElementById('invite-eyebrow').textContent =
      data.inviter + ' invited you to try SmallDocs with ' + data.company;
    else if (data.inviter) document.getElementById('invite-eyebrow').textContent =
      data.inviter + ' invited you to try SmallDocs';
    else if (data.company) document.getElementById('invite-eyebrow').textContent =
      'A private SmallDocs invitation for ' + data.company;
    if (data.inviter) document.getElementById('auth-copy').textContent =
      'Sign in with the address ' + data.inviter + ' invited. If you are new to SmallDocs, this also creates your account.';
    if (data.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
      document.getElementById('email').value = data.email;
    }
    firstName.value = data.firstName;
    lastName.value = data.lastName;
  }

  function prepareOAuthResume() {
    if (!window.location.hash) return;
    var returnUrl = new URL(window.location.pathname + window.location.search, window.location.origin);
    returnUrl.searchParams.set('resume_invite', '1');
    Array.prototype.forEach.call(document.querySelectorAll('[data-provider]'), function (link) {
      var url = new URL(link.href, window.location.origin);
      url.searchParams.set('return_to', returnUrl.pathname + returnUrl.search);
      link.href = url.pathname + url.search;
    });
  }

  function readResponse(response) {
    return response.json().then(function (body) { return { response: response, body: body }; });
  }

  function show(message, error) {
    status.textContent = message;
    status.style.color = error ? 'var(--red)' : '';
  }

  function showOnly(card) {
    authCard.hidden = card !== authCard;
    termsCard.hidden = card !== termsCard;
    acceptCard.hidden = card !== acceptCard;
    completeCard.hidden = card !== completeCard;
  }

  function refreshButton() {
    button.disabled = !profileLoaded || !firstName.value.trim() || !lastName.value.trim();
  }

  function configureCloudSetup(workspaceId) {
    if (!workspaceId) return;
    var command = 'sdoc setup --cloud --account ' + workspaceId + ' --yes';
    var commandNode = document.getElementById('cloud-setup-command');
    var copyButton = document.getElementById('copy-cloud-setup');
    commandNode.textContent = command;
    copyButton.setAttribute('data-copy', command);
    var prompt = document.getElementById('install-prompt');
    prompt.textContent = prompt.textContent.replace(
      'sdoc setup --cloud --yes to enable Cloud-first sdocs',
      command + ' to enable Cloud-first sdocs for this workspace');
  }

  function showTerms() {
    showOnly(termsCard);
    document.getElementById('invite-terms-title').focus();
  }

  function showProfile(user) {
    showOnly(acceptCard);
    document.getElementById('invite-email').textContent = user.email || invitationData.email || '';
    firstName.value = user.first_name || invitationData.firstName || '';
    lastName.value = user.last_name || invitationData.lastName || '';
    profileLoaded = true;
    refreshButton();
    document.getElementById('accept-title').focus();
  }

  function loadProfile() {
    return fetch('/api/cloud/v1/me', { credentials: 'same-origin' }).then(readResponse).then(function (result) {
      if (result.response.status === 401) {
        showOnly(authCard);
        return;
      }
      if (result.response.status === 403 && result.body.error === 'terms_acceptance_required') {
        showTerms();
        return;
      }
      if (!result.response.ok) throw new Error('Your account details could not be loaded.');
      showProfile(result.body.user || {});
    }).catch(function (error) {
      document.getElementById('prototype-status').textContent =
        error.message || 'Your account details could not be loaded.';
    });
  }

  firstName.addEventListener('input', refreshButton);
  lastName.addEventListener('input', refreshButton);

  window.addEventListener('sdocs:auth-complete', function () {
    if (preview) {
      document.getElementById('prototype-status').textContent =
        'Preview complete. A real invitation continues here without leaving the page.';
      return;
    }
    loadProfile();
  });

  var termsAccepted = document.getElementById('invite-terms-accepted');
  var termsSubmit = document.getElementById('invite-terms-submit');
  var termsError = document.getElementById('invite-terms-error');
  termsAccepted.addEventListener('change', function () {
    termsSubmit.disabled = !termsAccepted.checked;
    if (termsAccepted.checked) termsError.textContent = '';
  });
  document.getElementById('invite-terms-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!termsAccepted.checked) {
      termsError.textContent = 'Agree to the Terms to continue.';
      termsAccepted.focus();
      return;
    }
    termsSubmit.disabled = true;
    document.getElementById('invite-terms-status').textContent = 'Saving your acceptance...';
    fetch('/api/cloud/auth/terms/accept', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accepted: true,
        terms_version: document.getElementById('invite-terms-version').value,
        return_to: window.location.pathname + window.location.search
      })
    }).then(readResponse).then(function (result) {
      if (result.response.status === 401) {
        showOnly(authCard);
        return;
      }
      if (!result.response.ok) throw new Error('acceptance_failed');
      termsAccepted.checked = false;
      document.getElementById('invite-terms-status').textContent = '';
      return loadProfile();
    }).catch(function () {
      termsSubmit.disabled = false;
      document.getElementById('invite-terms-status').textContent = '';
      termsError.textContent = 'Your acceptance could not be saved. Try again.';
    });
  });

  button.addEventListener('click', function () {
    button.disabled = true;
    show('Saving your details...');
    fetch('/api/cloud/v1/me', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: firstName.value.trim(), last_name: lastName.value.trim() })
    }).then(readResponse).then(function (profileResult) {
      if (profileResult.response.status === 401) {
        showOnly(authCard);
        throw new Error('login_required');
      }
      if (!profileResult.response.ok) throw new Error('Enter your first and last name.');
      show('Accepting your invitation...');
      return fetch('/api/cloud/v1/invitations/' + encodeURIComponent(token) + '/accept', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      }).then(readResponse);
    }).then(function (result) {
      if (!result || !result.response.ok) {
        if (result && result.body.error === 'permission_denied') {
          throw new Error('Sign in with the email address that received this invitation.');
        }
        if (result && result.body.error === 'profile_required') {
          throw new Error('Enter your first and last name.');
        }
        throw new Error('This invitation is no longer available.');
      }
      document.getElementById('complete-library-link').href =
        '/library?scope=cloud&workspace=' + encodeURIComponent(result.body.workspace_id);
      configureCloudSetup(result.body.workspace_id);
      showOnly(completeCard);
      document.getElementById('complete-title').focus();
      document.getElementById('install-details').open = true;
      document.getElementById('install').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (error) {
      if (error.message === 'login_required') return;
      refreshButton();
      show(error.message || 'The invitation could not be accepted.', true);
    });
  });

  function copyText(value, buttonElement) {
    function copied() {
      if (buttonElement.classList.contains('copy-button')) {
        var oldAriaLabel = buttonElement.getAttribute('aria-label');
        buttonElement.setAttribute('aria-label', 'Copied');
        buttonElement.classList.add('is-copied');
        window.setTimeout(function () {
          buttonElement.setAttribute('aria-label', oldAriaLabel);
          buttonElement.classList.remove('is-copied');
        }, 1800);
        return;
      }
      var oldLabel = buttonElement.textContent;
      buttonElement.textContent = 'Copied';
      window.setTimeout(function () { buttonElement.textContent = oldLabel; }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(copied).catch(function () {});
      return;
    }
    var input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    if (document.execCommand('copy')) copied();
    input.remove();
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (copyButton) {
    copyButton.addEventListener('click', function () { copyText(copyButton.getAttribute('data-copy'), copyButton); });
  });
  document.getElementById('copy-install-prompt').addEventListener('click', function () {
    copyText(document.getElementById('install-prompt').textContent.trim(), this);
  });

  decryptInvitation(inviteFragment()).catch(function () { return {}; }).then(function (data) {
    applyInvitation(data);
    prepareOAuthResume();
    if (preview) {
      document.getElementById('preview-note').hidden = false;
      return;
    }
    if (!token) {
      document.getElementById('prototype-status').textContent =
        'This invitation link is incomplete. Ask the sender for a new link.';
      return;
    }
    loadProfile();
  });
})();
