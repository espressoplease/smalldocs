(function () {
  'use strict';
  const login = document.querySelector('.homepage-login');
  function revealLogin() {
    setTimeout(() => { login.classList.add('is-visible'); }, 500);
  }
  if (document.readyState === 'complete') revealLogin();
  else window.addEventListener('load', revealLogin, { once: true });
  document.querySelectorAll('.homepage-google').forEach(link => link.addEventListener('click', event => {
    if (document.body.dataset.googleEnabled === 'true') return;
    event.preventDefault();
    link.parentElement.querySelector('.start-status').textContent = 'Google sign-in is unavailable right now. Use email to continue.';
  }));
  document.querySelectorAll('[data-install-form]').forEach(form => form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    location.assign('/cloud/sign-in?return=%2Fcloud%2Fprofile&email=' + encodeURIComponent(form.elements.email.value.trim()));
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
