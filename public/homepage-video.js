(function () {
  'use strict';
  const card = document.getElementById('videocard');
  const video = document.getElementById('intro-video') || document.getElementById('heroVid');
  if (!card || !video) return;
  const teaser = document.getElementById('heroTeaser');
  const play = document.getElementById('playOverlay');
  const config = window.SDocsHomepageVideoConfig || {};
  const chapters = config.chapters || [];
  const cues = config.cues || [];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  card.insertAdjacentHTML('beforeend', `<div class="vid-controls">
          <button class="vid-btn" id="pauseBtn" type="button" title="Pause">
            <svg class="ic-pause" width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M5.4 3.4v9.2M10.6 3.4v9.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            <svg class="ic-play" width="15" height="15" viewBox="0 0 16 16"><path d="M5 3.1l7.6 4.9L5 12.9z" fill="currentColor"/></svg>
            <span class="lbl">Pause</span>
          </button>
          <button class="vid-btn" id="ccBtn" type="button" aria-pressed="true" title="Subtitles">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="1.3" y="3" width="13.4" height="10" rx="2.4" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 6.7a1.7 1.7 0 1 0 0 2.6M11.3 6.7a1.7 1.7 0 1 0 0 2.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            CC
          </button>
          <button class="vid-btn seek" id="back10Btn" type="button" title="Back 10 seconds">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/><text x="12.5" y="15.6" font-size="8.5" fill="currentColor" text-anchor="middle">10</text></svg>
          </button>
          <button class="vid-btn seek" id="fwd10Btn" type="button" title="Forward 10 seconds">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/><text x="11.5" y="15.6" font-size="8.5" fill="currentColor" text-anchor="middle">10</text></svg>
          </button>
          <button class="vid-btn seek" id="prevChapBtn" type="button" title="Previous chapter">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4"/><rect x="4" y="4" width="2.4" height="16" rx="1"/></svg>
          </button>
          <button class="vid-btn" id="chapBtn" type="button" aria-haspopup="true" aria-expanded="false" title="Chapters">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5.5 4H14M5.5 8H14M5.5 12H14M2.2 4h.01M2.2 8h.01M2.2 12h.01"/></svg>
            <span class="lbl">Chapters</span>
          </button>
          <button class="vid-btn seek" id="nextChapBtn" type="button" title="Next chapter">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20"/><rect x="17.6" y="4" width="2.4" height="16" rx="1"/></svg>
          </button>
          <button class="vid-btn" id="muteBtn" type="button" title="Mute">
            <svg class="ic-muted" width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2.5 6v4h2.2L8 12.6V3.4L4.7 6H2.5z" fill="currentColor"/><path d="M11 6l3 4M14 6l-3 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <svg class="ic-sound" width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2.5 6v4h2.2L8 12.6V3.4L4.7 6H2.5z" fill="currentColor"/><path d="M10.6 5.6a3.3 3.3 0 0 1 0 4.8M12.6 3.8a6 6 0 0 1 0 8.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <span class="lbl">Mute</span>
          </button>
          <button class="vid-btn" id="fsBtn" type="button" title="Full screen">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2.2 5.6V2.2h3.4M13.8 5.6V2.2h-3.4M2.2 10.4v3.4h3.4M13.8 10.4v3.4h-3.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span class="lbl">Full screen</span>
          </button>
        </div>
        <div class="vid-chapmenu" id="chapMenu" role="menu" aria-label="Chapters"></div>`);
  if (!document.getElementById('heroCap')) card.insertAdjacentHTML('beforeend',
    '<div class="vid-caption" id="heroCap" aria-live="off"></div><div class="vid-loading" role="status"><span class="spinner"></span><span data-video-status>Loading</span></div>');
  const controls = card.querySelector('.vid-controls');
  const caption = document.getElementById('heroCap');
  const pause = document.getElementById('pauseBtn');
  const mute = document.getElementById('muteBtn');
  const cc = document.getElementById('ccBtn');
  const fullscreen = document.getElementById('fsBtn');
  const chapterButton = document.getElementById('chapBtn');
  const menu = document.getElementById('chapMenu');
  const previewHome = card.parentElement;
  let previewLoops = 0, dialog = null, closing = false, closeTimer = null;
  let previousOverflow = '', returnFocus = null;
  controls.querySelectorAll('button').forEach(button => {
    if (button.title) button.setAttribute('aria-label', button.title);
    button.querySelectorAll('svg').forEach(icon => icon.setAttribute('aria-hidden', 'true'));
  });

  play.setAttribute('aria-expanded', 'false');
  play.setAttribute('aria-haspopup', card.hasAttribute('data-expand-on-play') ? 'dialog' : 'false');
  controls.inert = true;
  menu.inert = true;
  ['prevChapBtn', 'chapBtn', 'nextChapBtn'].forEach(id => {
    document.getElementById(id).hidden = !chapters.length;
  });

  function tryPlay(media, onFailure) {
    const promise = media.play();
    if (promise && promise.catch) promise.catch(error => { if (onFailure) onFailure(error); });
  }
  function previewAllowed() {
    return !reducedMotion.matches && !(navigator.connection && navigator.connection.saveData);
  }
  function resumePreview() {
    if (teaser && previewAllowed() && (previewLoops < 2 || matchMedia('(max-width: 620px)').matches)) {
      teaser.muted = true; teaser.autoplay = true;
      tryPlay(teaser, error => { if (error.name === 'NotAllowedError') teaser.dataset.previewBlocked = 'true'; });
    }
  }
  function nextPreview() {
    previewLoops++;
    if (previewLoops < 2 || matchMedia('(max-width: 620px)').matches) {
      teaser.currentTime = 0; resumePreview();
    } else teaser.pause();
  }
  if (teaser) {
    if (!previewAllowed()) { teaser.autoplay = false; teaser.pause(); }
    teaser.addEventListener('playing', () => { delete teaser.dataset.previewBlocked; });
    teaser.addEventListener('ended', nextPreview);
    const previewEnd = Number(teaser.dataset.previewEnd);
    if (previewEnd > 0) teaser.addEventListener('timeupdate', () => {
      if (teaser.currentTime >= previewEnd && !teaser.paused) nextPreview();
    });
    // A missing preview leaves the poster and Play button available.
    teaser.addEventListener('error', () => { teaser.hidden = true; });
    resumePreview();
  }
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches && teaser) { teaser.autoplay = false; teaser.pause(); }
    else if (card.classList.contains('teaser')) resumePreview();
  });

  function closeMenu() {
    card.classList.remove('chapters-open');
    chapterButton.setAttribute('aria-expanded', 'false'); menu.inert = true;
  }
  function syncMute() {
    card.classList.toggle('sound-on', !video.muted);
    const label = video.muted ? 'Unmute' : 'Mute';
    mute.querySelector('.lbl').textContent = label; mute.title = label;
    mute.setAttribute('aria-label', label);
  }
  function syncPause() {
    card.classList.toggle('paused', video.paused);
    const label = video.paused ? 'Play' : 'Pause';
    pause.querySelector('.lbl').textContent = label; pause.title = label;
    pause.setAttribute('aria-label', label);
  }
  function closeExpanded(immediate) {
    if (!dialog || !dialog.open || closing) return;
    closing = true; video.pause(); closeMenu();
    const finish = () => {
      clearTimeout(closeTimer); closeTimer = null;
      previewHome.appendChild(card);
      dialog.close(); dialog.classList.remove('is-closing');
      document.documentElement.style.overflow = previousOverflow;
      card.classList.add('teaser'); card.classList.remove('needs-play'); controls.inert = true;
      play.setAttribute('aria-expanded', 'false'); closing = false;
      if (!immediate && returnFocus) returnFocus.focus({ preventScroll: true });
      if (!immediate) resumePreview();
    };
    if (immediate || reducedMotion.matches) finish();
    else { dialog.classList.add('is-closing'); closeTimer = setTimeout(finish, 300); }
  }
  function expand() {
    if (!card.hasAttribute('data-expand-on-play')) return;
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'homepage-video-dialog'; dialog.setAttribute('aria-label', 'SmallDocs demo');
      dialog.innerHTML = '<button class="vid-btn vid-close" type="button" aria-label="Close video" title="Close video" autofocus><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg></button>';
      document.body.appendChild(dialog);
      dialog.querySelector('.vid-close').addEventListener('click', () => closeExpanded());
      dialog.addEventListener('cancel', event => {
        event.preventDefault();
        if (card.classList.contains('chapters-open')) { closeMenu(); chapterButton.focus(); }
        else closeExpanded();
      });
      dialog.addEventListener('click', event => { if (event.target === dialog) closeExpanded(); });
      dialog.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const buttons = Array.from(dialog.querySelectorAll('button')).filter(button =>
          !button.disabled && !button.closest('[inert]') && button.getClientRects().length);
        const index = buttons.indexOf(document.activeElement);
        const next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        if (buttons[next]) { event.preventDefault(); buttons[next].focus(); }
      });
    }
    if (dialog.open) return;
    returnFocus = play; previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    dialog.appendChild(card); dialog.showModal(); play.setAttribute('aria-expanded', 'true');
  }
  function startDemo() {
    expand();
    card.classList.remove('teaser');
    if (teaser) { teaser.autoplay = false; teaser.pause(); }
    controls.inert = false; video.muted = false; video.loop = false;
    if (video.ended) video.currentTime = 0;
    if (video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) video.load();
    const status = card.querySelector('[data-video-status]');
    if (status && !card.classList.contains('video-error')) status.textContent = 'Loading';
    syncMute();
    tryPlay(video, () => { card.classList.add('needs-play'); syncPause(); });
  }
  play.addEventListener('click', startDemo);
  pause.addEventListener('click', () => { if (video.paused) tryPlay(video); else video.pause(); });
  video.addEventListener('click', () => { if (!card.classList.contains('teaser')) pause.click(); });
  video.addEventListener('play', syncPause);
  video.addEventListener('pause', syncPause);
  video.addEventListener('playing', () => { card.classList.add('ready'); card.classList.remove('video-error', 'needs-play'); });
  video.addEventListener('waiting', () => card.classList.remove('ready'));
  function showLoadError() {
    card.classList.add('video-error', 'needs-play'); card.classList.remove('ready');
    const status = card.querySelector('[data-video-status]');
    if (status) status.textContent = 'The video could not be loaded. Try again.';
  }
  video.addEventListener('error', showLoadError);
  video.addEventListener('ended', () => {
    video.currentTime = 0;
    if (dialog && dialog.open) closeExpanded();
    else {
      card.classList.add('teaser'); controls.inert = true; previewLoops = 0;
      if (teaser) { teaser.currentTime = 0; resumePreview(); }
    }
  });
  mute.addEventListener('click', () => { video.muted = !video.muted; syncMute(); });
  cc.addEventListener('click', () => {
    const enabled = cc.getAttribute('aria-pressed') !== 'true';
    cc.setAttribute('aria-pressed', String(enabled)); cc.classList.toggle('cc-off', !enabled);
    caption.classList.toggle('cc-hidden', !enabled);
  });
  fullscreen.addEventListener('click', () => {
    let action;
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement)
        action = (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else if (card.requestFullscreen) action = card.requestFullscreen();
      else if (card.webkitRequestFullscreen) action = card.webkitRequestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
      if (action && action.catch) action.catch(() => {});
    } catch (_) {}
  });
  function syncFullscreen() {
    const active = document.fullscreenElement === card || document.webkitFullscreenElement === card || video.webkitDisplayingFullscreen;
    const label = active ? 'Exit full screen' : 'Full screen';
    fullscreen.title = label; fullscreen.setAttribute('aria-label', label); fullscreen.querySelector('.lbl').textContent = label;
  }
  document.addEventListener('fullscreenchange', syncFullscreen);
  document.addEventListener('webkitfullscreenchange', syncFullscreen);

  const format = seconds => Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
  const chapterAt = time => { let index = 0; chapters.forEach((chapter, i) => { if (time >= chapter.t) index = i; }); return index; };
  function seek(time) {
    const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : Math.max(0, time);
    video.currentTime = Math.min(Math.max(0, time), end);
    if (video.paused) tryPlay(video);
  }
  chapters.forEach(chapter => {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'vid-chap'; row.setAttribute('role', 'menuitem');
    const time = document.createElement('span'); time.className = 't'; time.textContent = format(chapter.t);
    const label = document.createElement('span'); label.className = 'l'; label.textContent = chapter.title;
    row.append(time, label); row.addEventListener('click', () => { seek(chapter.t + 0.01); closeMenu(); chapterButton.focus(); });
    menu.appendChild(row);
  });
  chapterButton.addEventListener('click', event => {
    event.stopPropagation();
    if (card.classList.contains('chapters-open')) closeMenu();
    else {
      card.classList.add('chapters-open'); menu.inert = false; chapterButton.setAttribute('aria-expanded', 'true');
      const active = menu.querySelector('.active') || menu.firstElementChild;
      if (active) active.focus({ preventScroll: true });
    }
  });
  document.addEventListener('click', event => {
    if (!menu.contains(event.target) && !chapterButton.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !(dialog && dialog.open)) closeMenu();
  });
  document.getElementById('back10Btn').addEventListener('click', () => seek(video.currentTime - 10));
  document.getElementById('fwd10Btn').addEventListener('click', () => seek(video.currentTime + 10));
  document.getElementById('nextChapBtn').addEventListener('click', () => {
    const index = chapterAt(video.currentTime); seek(chapters[index + 1] ? chapters[index + 1].t + 0.01 : video.duration);
  });
  document.getElementById('prevChapBtn').addEventListener('click', () => {
    const index = chapterAt(video.currentTime);
    seek(chapters[video.currentTime - chapters[index].t < 3 && index > 0 ? index - 1 : index].t + 0.01);
  });

  function updateCaption() {
    const cue = cues.find(item => video.currentTime >= item.t0 && video.currentTime < item.t1);
    const track = video.textTracks[0];
    const text = cue ? cue.text : track && track.activeCues ? Array.from(track.activeCues, item => item.text).join('\n') : '';
    if (caption.textContent !== text) {
      caption.replaceChildren();
      if (text) { const span = document.createElement('span'); span.textContent = text; caption.appendChild(span); }
    }
    Array.from(menu.children).forEach((row, index) => row.classList.toggle('active', index === chapterAt(video.currentTime)));
  }
  const boundTracks = new Set();
  function bindCaptionTrack(track) {
    track.mode = 'hidden';
    if (!boundTracks.has(track)) { track.addEventListener('cuechange', updateCaption); boundTracks.add(track); }
  }
  video.querySelectorAll('track').forEach(element => {
    element.removeAttribute('default'); bindCaptionTrack(element.track);
    element.addEventListener('load', () => bindCaptionTrack(element.track));
  });
  video.textTracks.addEventListener('addtrack', event => bindCaptionTrack(event.track));
  video.addEventListener('timeupdate', updateCaption);
  video.addEventListener('webkitbeginfullscreen', () => {
    if (video.textTracks[0]) video.textTracks[0].mode = cc.getAttribute('aria-pressed') === 'true' ? 'showing' : 'disabled';
    syncFullscreen();
  });
  video.addEventListener('webkitendfullscreen', () => { if (video.textTracks[0]) video.textTracks[0].mode = 'hidden'; syncFullscreen(); });
  window.addEventListener('pagehide', () => {
    video.pause(); if (teaser) { teaser.autoplay = false; teaser.pause(); }
    if (closeTimer) { clearTimeout(closeTimer); closing = false; }
    closeExpanded(true);
  });
  window.addEventListener('pageshow', () => { if (card.classList.contains('teaser')) resumePreview(); });
  syncMute(); syncPause();
})();
