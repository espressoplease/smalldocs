let activeOverlay = null;

function captureOverflow(element) {
  return {
    value: element.style.getPropertyValue('overflow'),
    priority: element.style.getPropertyPriority('overflow'),
  };
}

function restoreOverflow(element, state) {
  if (state.value) element.style.setProperty('overflow', state.value, state.priority);
  else element.style.removeProperty('overflow');
}

function captureHost() {
  return {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    htmlOverflow: captureOverflow(document.documentElement),
    bodyOverflow: captureOverflow(document.body),
  };
}

function lockHost() {
  document.documentElement.style.setProperty('overflow', 'hidden', 'important');
  document.body.style.setProperty('overflow', 'hidden', 'important');
}

function restoreHost(state) {
  restoreOverflow(document.documentElement, state.htmlOverflow);
  restoreOverflow(document.body, state.bodyOverflow);
  window.scrollTo(state.scrollX, state.scrollY);
  requestAnimationFrame(() => window.scrollTo(state.scrollX, state.scrollY));
}

function closeRecord(record, reason, closeOptions) {
  if (!record || record.closed || activeOverlay !== record) return false;
  const options = closeOptions && typeof closeOptions === 'object' ? closeOptions : {};
  record.closed = true;
  activeOverlay = null;
  window.removeEventListener('keydown', record.onKeydown);

  if (typeof record.beforeClose === 'function') {
    try { record.beforeClose(reason); } catch (_) {}
  }
  record.surface.remove();
  if (options.restoreHost !== false) restoreHost(record.hostState);
  if (typeof record.onClose === 'function') {
    try { record.onClose(reason); } catch (_) {}
  }

  const restoreFocus = reason === 'user'
    && options.restoreFocus !== false
    && record.restoreFocus;
  if (restoreFocus && record.returnFocus && record.returnFocus.isConnected) {
    record.returnFocus.focus();
  }
  return true;
}

/*
 * Register a caller-built fullscreen surface with the shared overlay manager.
 * The caller owns the surface markup. The manager owns arbitration, Escape,
 * scroll locking, removal, and lifecycle callbacks.
 */
export function openOverlayLease(owner, rawOptions) {
  const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
  const surface = options.surface;
  if (!owner) throw new TypeError('SmallDocs overlay owner is required');
  if (!surface || surface.nodeType !== 1) {
    throw new TypeError('SmallDocs custom overlay surface must be an Element');
  }

  let hostState = null;
  let returnFocus = null;
  if (activeOverlay) {
    hostState = activeOverlay.hostState;
    returnFocus = activeOverlay.returnFocus;
    closeRecord(activeOverlay, 'superseded', { restoreHost: false, restoreFocus: false });
  }
  if (!hostState) hostState = captureHost();
  if (!returnFocus) returnFocus = options.returnFocus || document.activeElement;

  const record = {
    owner,
    surface,
    hostState,
    returnFocus,
    restoreFocus: options.restoreFocus !== false,
    beforeClose: options.beforeClose,
    onClose: options.onClose,
    onKeydown: null,
    closed: false,
  };
  const close = (reason = 'user', closeOptions) => closeRecord(record, reason, closeOptions);
  record.onKeydown = (event) => {
    if (event.key !== 'Escape' || activeOverlay !== record) return;
    event.preventDefault();
    close('user');
  };

  (options.mount || document.body).appendChild(surface);
  lockHost();
  window.addEventListener('keydown', record.onKeydown);
  activeOverlay = record;

  if (options.initialFocus && typeof options.initialFocus.focus === 'function') {
    options.initialFocus.focus();
  }
  return Object.freeze({ surface, close });
}

export function openOverlay(owner, options) {
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
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'smalldocs-control';
  closeButton.textContent = 'Close';
  actions.appendChild(closeButton);
  bar.append(title, actions);

  const stage = document.createElement('div');
  stage.className = 'smalldocs-overlay-stage';
  overlay.append(bar, stage);

  const lease = openOverlayLease(owner, {
    surface: overlay,
    initialFocus: closeButton,
    beforeClose: options.beforeClose,
    onClose: options.onClose,
    restoreFocus: options.restoreFocus,
  });
  closeButton.addEventListener('click', () => lease.close('user'));
  return { overlay, stage, close: lease.close };
}

export function closeActiveOverlay(owner, reason = 'user', closeOptions) {
  if (!activeOverlay) return false;
  if (owner && activeOverlay.owner !== owner) return false;
  return closeRecord(activeOverlay, reason, closeOptions);
}

export function overlayOwnedBy(owner) {
  return !!activeOverlay && activeOverlay.owner === owner;
}
