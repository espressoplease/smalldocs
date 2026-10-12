(function () {
  'use strict';
  const nav = document.getElementById('nav');
  const header = window.SDocsScrollHeader && window.SDocsScrollHeader.bind({
    header: nav, breakpoint: 768, isPinned: () => !!nav.querySelector('details[open]'),
  });
  const menus = Array.from(nav.querySelectorAll('details'));
  menus.forEach(menu => menu.addEventListener('toggle', () => {
    menu.querySelector('summary').setAttribute('aria-expanded', String(menu.open));
    if (menu.open) {
      if (header) header.reveal();
      menus.forEach(other => { if (other !== menu) other.open = false; });
    }
  }));
  document.addEventListener('click', event => menus.forEach(menu => {
    if (!menu.contains(event.target)) menu.open = false;
  }));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const menu = menus.find(menu => menu.open);
    if (menu) { menu.open = false; menu.querySelector('summary').focus(); }
  });
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
