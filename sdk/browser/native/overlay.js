let activeOverlay = null;

function restoreHost(state) {
  document.documentElement.style.overflow = state.htmlOverflow;
  document.body.style.overflow = state.bodyOverflow;
  window.scrollTo(state.scrollX, state.scrollY);
  requestAnimationFrame(() => window.scrollTo(state.scrollX, state.scrollY));
}

export function openOverlay(owner, options) {
  closeActiveOverlay();
  const state = {
    owner,
    returnFocus: document.activeElement,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    htmlOverflow: document.documentElement.style.overflow,
    bodyOverflow: document.body.style.overflow,
  };
  const overlay = document.createElement('div');
  overlay.className = 'smalldocs-overlay';
  overlay.dataset.smalldocsOwner = owner.id;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', options.label || 'Expanded SmallDocs content');

  const bar = document.createElement('div');
  bar.className = 'smalldocs-overlay-bar';
  const title = document.createElement('span');
  title.className = 'smalldocs-overlay-title';
  title.textContent = options.title || 'SmallDocs';
  const actions = document.createElement('div');
  actions.className = 'smalldocs-overlay-actions';
  if (typeof options.actions === 'function') options.actions(actions);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'smalldocs-control';
  close.textContent = 'Close';
  close.addEventListener('click', () => closeActiveOverlay());
  actions.appendChild(close);
  bar.append(title, actions);

  const stage = document.createElement('div');
  stage.className = 'smalldocs-overlay-stage';
  overlay.append(bar, stage);
  document.body.appendChild(overlay);
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';

  function onKeydown(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeActiveOverlay();
  }
  window.addEventListener('keydown', onKeydown);
  activeOverlay = { owner, overlay, stage, state, onKeydown, onClose: options.onClose };
  close.focus();
  return { overlay, stage, close: closeActiveOverlay };
}

export function closeActiveOverlay(owner) {
  if (!activeOverlay) return;
  if (owner && activeOverlay.owner !== owner) return;
  const current = activeOverlay;
  activeOverlay = null;
  window.removeEventListener('keydown', current.onKeydown);
  current.overlay.remove();
  restoreHost(current.state);
  if (typeof current.onClose === 'function') current.onClose();
  if (current.state.returnFocus && current.state.returnFocus.isConnected) {
    current.state.returnFocus.focus();
  }
}

export function overlayOwnedBy(owner) {
  return !!activeOverlay && activeOverlay.owner === owner;
}
