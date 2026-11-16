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
            <span class="lbl">CC</span>
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
  const chapterToggle = document.createElement('span'); chapterToggle.className = 'vid-chapter-toggle';
  chapterButton.before(chapterToggle); chapterToggle.appendChild(chapterButton);
  const previewHome = card.parentElement;
  const screen = document.createElement('div'); screen.className = 'vid-screen';
  Array.from(card.children).forEach(element => {
    if (element !== controls && element !== menu) screen.appendChild(element);
  });
  const toolbar = document.createElement('div'); toolbar.className = 'vid-toolbar';
  const toolbarClip = document.createElement('div'); toolbarClip.className = 'vid-toolbar-clip';
  toolbarClip.appendChild(controls); toolbar.append(toolbarClip, menu); card.append(screen, toolbar);
  const chapterNav = document.createElement('nav');
  chapterNav.className = 'vid-chapters'; chapterNav.setAttribute('aria-label', 'Video chapters');
  const chapterClip = document.createElement('div'); chapterClip.className = 'vid-chapters-clip';
  const chapterPills = document.createElement('div'); chapterPills.className = 'vid-chapter-pills';
  chapterClip.appendChild(chapterPills); chapterNav.appendChild(chapterClip); previewHome.appendChild(chapterNav);
  let previewLoops = 0, expanded = false;
  const collapse = document.createElement('button');
  collapse.type = 'button'; collapse.className = 'vid-btn vid-collapse';
  collapse.title = 'Collapse video'; collapse.setAttribute('aria-label', 'Collapse video');
  collapse.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>';
  collapse.hidden = true; controls.appendChild(collapse);
  collapse.addEventListener('click', () => closeExpanded());
  controls.querySelectorAll('button').forEach(button => {
    if (button.title) button.setAttribute('aria-label', button.title);
    button.querySelectorAll('svg').forEach(icon => icon.setAttribute('aria-hidden', 'true'));
  });

  play.setAttribute('aria-expanded', 'false');
  play.removeAttribute('aria-haspopup');
  if (!previewHome.id) previewHome.id = 'homepage-video';
  play.setAttribute('aria-controls', previewHome.id);
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
  function syncChapterNavigation() {
    const available = chapters.length > 0 && !card.classList.contains('teaser');
    const inFullscreen = document.fullscreenElement === card || document.webkitFullscreenElement === card;
    const visible = available && (!card.classList.contains('is-scroll-docked') || inFullscreen);
    card.classList.toggle('chapter-pills-visible', visible);
    previewHome.classList.toggle('has-video-chapters', available);
    chapterNav.inert = !available; chapterNav.setAttribute('aria-hidden', String(!available));
    chapterToggle.inert = visible || controls.inert;
    chapterToggle.setAttribute('aria-hidden', String(visible));
    if (visible) closeMenu();
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
    if (video.paused && !video.seeking && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) card.classList.add('ready');
  }
  function closeExpanded(quiet) {
    if (!expanded) return;
    video.pause();
    if (!quiet) {
      let exit;
      try {
        if (document.fullscreenElement === card || document.webkitFullscreenElement === card)
          exit = (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else if (video.webkitDisplayingFullscreen && video.webkitExitFullscreen) video.webkitExitFullscreen();
      } catch (_) {}
      if (exit && exit.then) { exit.then(() => compact(), () => compact()); return; }
    }
    compact(quiet);
  }
  function compact(quiet) {
    const readingHeight = !quiet && docked ? dockHome.height : 0;
    if (readingHeight) compactHold = readingHeight;
    dockHasPlayed = false;
    releaseScrollDock(Boolean(readingHeight));
    expanded = false; video.pause(); closeMenu();
    previewHome.classList.remove('is-expanded');
    card.classList.add('teaser'); card.classList.remove('needs-play');
    controls.inert = true; collapse.hidden = true;
    syncChapterNavigation();
    play.setAttribute('aria-expanded', 'false');
    if (!quiet) { play.focus({ preventScroll: true }); resumePreview(); }
    if (readingHeight) compactTimer = setTimeout(finishCompactHold, reducedMotion.matches ? 0 : 320);
  }
  function expand() {
    if (!card.hasAttribute('data-expand-on-play') || expanded) return;
    finishCompactHold();
    expanded = true; previewHome.classList.add('is-expanded');
    collapse.hidden = false; play.setAttribute('aria-expanded', 'true');
  }
  function startDemo() {
    expand();
    card.classList.remove('teaser');
    if (teaser) { teaser.autoplay = false; teaser.pause(); }
    controls.inert = false; video.muted = false; video.loop = false;
    syncChapterNavigation();
    if (video.ended) video.currentTime = 0;
    if (video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) video.load();
    const status = card.querySelector('[data-video-status]');
    if (status && !card.classList.contains('video-error')) status.textContent = 'Loading';
    syncMute();
    tryPlay(video, () => { card.classList.add('needs-play'); syncPause(); scheduleScrollDock(); });
  }
  play.addEventListener('click', startDemo);
  pause.addEventListener('click', () => { if (video.paused) tryPlay(video); else video.pause(); });
  video.addEventListener('click', () => { if (!card.classList.contains('teaser')) pause.click(); });
  video.addEventListener('play', syncPause);
  video.addEventListener('pause', syncPause);
  video.addEventListener('seeked', syncPause);
  video.addEventListener('playing', () => {
    card.classList.add('ready'); card.classList.remove('video-error', 'needs-play');
    dockHasPlayed = true; scheduleScrollDock(true);
  });
  video.addEventListener('waiting', () => card.classList.remove('ready'));
  function showLoadError() {
    card.classList.add('video-error', 'needs-play'); card.classList.remove('ready');
    const status = card.querySelector('[data-video-status]');
    if (status) status.textContent = 'The video could not be loaded. Try again.';
    scheduleScrollDock();
  }
  video.addEventListener('error', showLoadError);
  video.addEventListener('ended', () => {
    video.currentTime = 0;
    if (expanded) closeExpanded();
    else {
      card.classList.add('teaser'); controls.inert = true; previewLoops = 0;
      syncChapterNavigation();
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
    const chapterHost = document.fullscreenElement === card || document.webkitFullscreenElement === card ? card : previewHome;
    if (chapterNav.parentElement !== chapterHost) chapterHost.appendChild(chapterNav);
    syncChapterNavigation();
    scheduleScrollDock(true);
  }
  document.addEventListener('fullscreenchange', syncFullscreen);
  document.addEventListener('webkitfullscreenchange', syncFullscreen);

  // Keep the same media element in place. Its home holds the inline height
  // while the card follows the viewport, so reading content never jumps.
  const scrollDockEnabled = previewHome.classList.contains('homepage-small-video');
  const dockProperties = ['left', 'top', 'width', 'height', 'video-width', 'toolbar-left',
    'toolbar-top', 'toolbar-width', 'toolbar-opacity', 'toolbar-height', 'progress'];
  let dockHasPlayed = false, docked = false, dockFrame = 0, dockNeedsMeasure = true;
  let dockHome = null, compactHold = 0, compactTimer = 0;
  const clamp = value => Math.max(0, Math.min(1, value));
  const mix = (from, to, amount) => from + (to - from) * amount;
  function placeDockCaption(beside) {
    const host = beside ? toolbarClip : screen;
    if (caption.parentElement !== host) host.appendChild(caption);
  }
  function releaseScrollDock(holdHome) {
    if (!scrollDockEnabled) return;
    if (!docked && !previewHome.style.height) return;
    docked = false; card.classList.remove('is-scroll-docked');
    previewHome.classList.remove('has-docked-video');
    syncChapterNavigation();
    placeDockCaption(false);
    dockProperties.forEach(name => card.style.removeProperty('--dock-' + name));
    if (!holdHome && !compactHold) previewHome.style.removeProperty('height');
    document.documentElement.classList.remove('has-homepage-dock');
    document.documentElement.style.removeProperty('--homepage-dock-height');
  }
  function finishCompactHold() {
    if (!compactHold) return;
    clearTimeout(compactTimer);
    const delta = card.getBoundingClientRect().height - compactHold;
    compactHold = 0; previewHome.style.removeProperty('height');
    // Dismissing a docked video should not move the paragraph being read.
    if (scrollY > 0) window.scrollBy({ top: delta, behavior: 'instant' });
  }
  function scheduleScrollDock(measure) {
    if (!scrollDockEnabled) return;
    if (measure === true) dockNeedsMeasure = true;
    if (!dockFrame) dockFrame = requestAnimationFrame(renderScrollDock);
  }
  function renderScrollDock() {
    dockFrame = 0;
    const inFullscreen = document.fullscreenElement || document.webkitFullscreenElement || video.webkitDisplayingFullscreen;
    if (!expanded || !dockHasPlayed || inFullscreen || card.classList.contains('needs-play') || card.classList.contains('video-error')) {
      releaseScrollDock(Boolean(inFullscreen)); return;
    }
    const pinTop = innerWidth <= 600 ? 8 : 12;
    let home = previewHome.getBoundingClientRect();
    if (home.top > pinTop) { releaseScrollDock(); return; }
    if (!docked || dockNeedsMeasure) {
      card.classList.add('vid-measuring-inline');
      card.classList.remove('is-scroll-docked');
      previewHome.classList.remove('has-docked-video');
      syncChapterNavigation();
      placeDockCaption(false);
      previewHome.style.removeProperty('height');
      home = previewHome.getBoundingClientRect();
      dockHome = { width: home.width, height: home.height };
      previewHome.style.height = dockHome.height + 'px';
      previewHome.classList.add('has-docked-video');
      card.classList.add('is-scroll-docked'); docked = true; dockNeedsMeasure = false;
      syncChapterNavigation();
      void chapterNav.offsetHeight;
      card.classList.remove('vid-measuring-inline');
    }
    const progress = reducedMotion.matches ? 1 : clamp((pinTop - home.top) / Math.min(240, dockHome.width * .45));
    const smallWidth = Math.min(240, Math.max(104, dockHome.width * .34));
    const screenWidth = mix(dockHome.width, smallWidth, progress);
    const gap = innerWidth <= 600 ? 12 : 20;
    const sideAt = Math.min(.82, Math.max(.45, (gap + (innerWidth <= 600 ? 128 : 240)) / (dockHome.width - smallWidth)));
    const beside = progress >= sideAt;
    placeDockCaption(beside);
    const sideProgress = clamp((progress - sideAt) / Math.max(.01, 1 - sideAt));
    const toolbarLeft = beside ? screenWidth + gap + 12 * (1 - sideProgress) : 0;
    const opacity = beside ? sideProgress : 1 - clamp((progress - sideAt + .16) / .16);
    const set = (name, value) => card.style.setProperty('--dock-' + name, value + 'px');
    set('left', home.left); set('top', pinTop); set('width', dockHome.width);
    set('video-width', screenWidth); set('toolbar-left', toolbarLeft);
    set('toolbar-width', dockHome.width - toolbarLeft);
    card.style.setProperty('--dock-toolbar-opacity', opacity);
    card.style.setProperty('--dock-progress', progress);
    const toolbarTop = beside ? 12 * (1 - sideProgress) : screen.getBoundingClientRect().height + 10;
    set('toolbar-top', toolbarTop);
    const toolbarHeight = toolbar.getBoundingClientRect().height;
    set('toolbar-height', toolbarHeight);
    const height = Math.max(screen.getBoundingClientRect().height, toolbarTop + toolbarHeight);
    set('height', height);
    document.documentElement.classList.add('has-homepage-dock');
    document.documentElement.style.setProperty('--homepage-dock-height', Math.ceil(pinTop + height + 24) + 'px');
  }
  if (scrollDockEnabled) {
    window.addEventListener('scroll', () => scheduleScrollDock(), { passive: true });
    window.addEventListener('resize', () => scheduleScrollDock(true), { passive: true });
    previewHome.addEventListener('transitionend', event => {
      if (event.propertyName === 'max-width') scheduleScrollDock(true);
    });
    new ResizeObserver(() => scheduleScrollDock(true)).observe(previewHome);
    new ResizeObserver(() => scheduleScrollDock()).observe(toolbar);
    new ResizeObserver(() => scheduleScrollDock(true)).observe(chapterNav);
    reducedMotion.addEventListener('change', () => scheduleScrollDock(true));
  }

  const format = seconds => Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
  const chapterAt = time => { let index = 0; chapters.forEach((chapter, i) => { if (time >= chapter.t) index = i; }); return index; };
  function seek(time) {
    const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : Math.max(0, time);
    video.currentTime = Math.min(Math.max(0, time), end);
    updateCaption();
    if (video.paused) tryPlay(video);
  }
  // Reuse the same Lucide paths as the document reader's icon collection.
  const chapterIcons = {
    'file-text': '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8M16 13H8M16 17H8"/>',
    lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4"/>',
    'book-open': '<path d="M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    'chart-column': '<path d="M3 3v16a2 2 0 0 0 2 2h16M18 17V9M13 17V5M8 17v-3"/>',
    presentation: '<path d="M2 3h20M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3M7 21l5-5 5 5"/>',
    library: '<path d="m16 6 4 14M12 6v14M8 8v12M4 4v16"/>',
    'share-2': '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98m-.01-10.98-6.82 3.98"/>',
    'message-square': '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2"/>'
  };
  chapters.forEach((chapter, index) => {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'vid-chap'; row.setAttribute('role', 'menuitem');
    const time = document.createElement('span'); time.className = 't'; time.textContent = format(chapter.t);
    const label = document.createElement('span'); label.className = 'l'; label.textContent = chapter.title;
    row.append(time, label); row.addEventListener('click', () => { seek(chapter.t + 0.01); closeMenu(); chapterButton.focus(); });
    menu.appendChild(row);
    const pill = document.createElement('button'); pill.type = 'button'; pill.className = 'vid-btn vid-chapter-pill';
    pill.title = format(chapter.t) + ' - ' + chapter.title;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('width', '15'); icon.setAttribute('height', '15');
    icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '1.7');
    icon.setAttribute('stroke-linecap', 'round'); icon.setAttribute('stroke-linejoin', 'round'); icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = chapterIcons[chapter.icon] || chapterIcons['file-text'];
    const pillLabel = document.createElement('span'); pillLabel.textContent = chapter.title;
    pill.append(icon, pillLabel); pill.addEventListener('click', () => seek(chapter.t + 0.01));
    if (index === 0) pill.setAttribute('aria-current', 'step');
    chapterPills.appendChild(pill);
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
    if (event.key !== 'Escape' || document.fullscreenElement || document.webkitFullscreenElement || video.webkitDisplayingFullscreen) return;
    if (card.classList.contains('chapters-open')) { closeMenu(); chapterButton.focus(); }
    else if (expanded) closeExpanded();
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
    Array.from(chapterPills.children).forEach((pill, index) => {
      if (index === chapterAt(video.currentTime)) pill.setAttribute('aria-current', 'step');
      else pill.removeAttribute('aria-current');
    });
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
    finishCompactHold();
    video.pause(); if (teaser) { teaser.autoplay = false; teaser.pause(); }
    closeExpanded(true);
  });
  window.addEventListener('pageshow', () => { if (card.classList.contains('teaser')) resumePreview(); });
  syncMute(); syncPause(); syncChapterNavigation();
})();
