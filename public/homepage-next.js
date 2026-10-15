(function () {
  'use strict';
  const login = document.querySelector('.homepage-login');
  function revealLogin() {
    setTimeout(() => { login.classList.add('is-visible'); }, 500);
  }
  if (document.readyState === 'complete') revealLogin();
  else window.addEventListener('load', revealLogin, { once: true });
  const command = window.SDocCliSetup.installCommand(window.SDocCliSetup.isWindows());
  document.querySelector('[data-install-command]').textContent = command;
  document.querySelector('[data-copy-install]').dataset.copy = command;
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      const label = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = label; }, 1400);
    } catch (_) { button.textContent = 'Select and copy'; }
  }));
  document.querySelectorAll('[data-install-form]').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const status = form.parentElement.querySelector('.start-status');
    const button = form.querySelector('button');
    const email = form.elements.email.value.trim();
    button.disabled = true;
    status.textContent = 'Getting your install script…';
    try {
      const response = await fetch('/api/install-interest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error('Install request failed');
      document.querySelectorAll('[data-install-form] input').forEach(input => { input.value = email; });
      const instructions = document.getElementById('install-instructions');
      instructions.hidden = false;
      status.textContent = 'Your install script is ready below.';
      instructions.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
      instructions.focus({ preventScroll: true });
    } catch (_) { status.textContent = 'Your request could not be saved. Try again.'; }
    finally { button.disabled = false; }
  }));
  const video = document.getElementById('intro-video');
  const play = document.querySelector('.intro-play');
  play.addEventListener('click', async () => {
    if (video.currentTime >= 29.8) video.currentTime = 0;
    video.controls = true;
    try { await video.play(); play.hidden = true; }
    catch (_) { video.controls = true; }
  });
  video.addEventListener('ended', () => { play.hidden = false; });
  video.addEventListener('timeupdate', () => {
    if (video.currentTime >= 30) { video.pause(); play.hidden = false; }
  });
})();

/* Teams interest form: the same-origin endpoint validates and relays the
   submission to SmallCRM. On success the form is replaced with a confirmation
   so the same visitor cannot submit it twice accidentally. */
(function () {
  const form = document.getElementById('teamsForm');
  if (!form) return;
  const email = document.getElementById('tf-email');
  const name = document.getElementById('tf-name');
  const message = document.getElementById('tf-message');
  const hp = document.getElementById('tf-website');
  const submit = document.getElementById('tf-submit');
  const status = document.getElementById('tf-status');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const contactName = name.value.trim();
    if (!contactName) {
      status.textContent = 'Enter your name.';
      status.classList.add('err');
      name.focus();
      return;
    }
    const address = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) {
      status.textContent = 'Enter a valid email address.';
      status.classList.add('err');
      email.focus();
      return;
    }
    status.classList.remove('err');
    status.textContent = 'Sending...';
    submit.disabled = true;
    try {
      const response = await fetch('/api/teams-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: address,
          name: contactName,
          message: message.value.trim(),
          website: hp.value,
        }),
      });
      if (!response.ok) throw new Error('http ' + response.status);
      form.innerHTML = '<div class="teams-thanks">Thanks. We will be in touch at <strong>'
        + address.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</strong>.</div>';
    } catch (error) {
      submit.disabled = false;
      status.classList.add('err');
      status.textContent = 'Something went wrong; nothing was sent. Try again, or email hi@smalldocs.org.';
    }
  });
})();
