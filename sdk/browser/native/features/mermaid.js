import { loadStyle, sdkAsset, vendorAsset } from '../assets.js';
import { openOverlayLease } from '../overlay.js';
import { parseKnownHTML, setKnownHTML } from '../runtime.js';

let canonicalPromise = null;

function restoreGlobal(name, previous) {
  if (previous === undefined) delete window[name];
  else window[name] = previous;
}

async function ensureCanonical() {
  if (canonicalPromise) return canonicalPromise;
  canonicalPromise = (async () => {
    const previousZoom = window.SDocZoomMath;
    await import('../vendor/sdocs-zoom-math.js');
    const zoomMath = window.SDocZoomMath;
    restoreGlobal('SDocZoomMath', previousZoom);

    const previousFocus = window.SDocMermaidFocusCore;
    await import('../vendor/sdocs-mermaid-focus.js');
    const focusCore = window.SDocMermaidFocusCore;
    restoreGlobal('SDocMermaidFocusCore', previousFocus);

    const previousMermaid = window.SDocMermaidCore;
    await import('../vendor/sdocs-mermaid.js');
    const mermaidCore = window.SDocMermaidCore;
    restoreGlobal('SDocMermaidCore', previousMermaid);

    if (!zoomMath || !focusCore || !mermaidCore) {
      throw new Error('SmallDocs Mermaid assets loaded without their canonical APIs.');
    }
    return Object.freeze({ zoomMath, focusCore, mermaidCore });
  })().catch((error) => {
    canonicalPromise = null;
    throw error;
  });
  return canonicalPromise;
}

function randomToken() {
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(36)).join('');
}

function createWorker() {
  const token = randomToken();
  const frame = document.createElement('iframe');
  frame.tabIndex = -1;
  frame.title = 'SmallDocs diagram renderer';
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    'width:' + Math.max(320, document.documentElement.clientWidth) + 'px',
    'height:' + Math.max(320, document.documentElement.clientHeight) + 'px',
    'border:0',
    'opacity:0',
    'pointer-events:none',
  ].join(';');
  frame.src = sdkAsset('mermaid-renderer.html') + '?token=' + encodeURIComponent(token);
  const pending = new Map();
  let requestNumber = 0;
  let readyResolve;
  let readyReject;
  let destroyed = false;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const timer = setTimeout(() => readyReject(new Error('Mermaid renderer timed out.')), 15000);

  function receive(event) {
    const message = event.data;
    if (event.source !== frame.contentWindow || !message || message.token !== token) return;
    if (message.type === 'ready') {
      clearTimeout(timer);
      readyResolve();
      return;
    }
    if (message.type === 'failed') {
      clearTimeout(timer);
      readyReject(new Error(message.error || 'Mermaid renderer could not start.'));
      return;
    }
    if (message.type !== 'result') return;
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve({ svg: message.svg });
  }

  window.addEventListener('message', receive);
  frame.addEventListener('error', () => readyReject(new Error('Mermaid renderer could not load.')), { once: true });
  document.body.appendChild(frame);

  return {
    async render(source, diagramId, config) {
      await ready;
      if (destroyed) throw new Error('Mermaid renderer was removed.');
      const requestId = ++requestNumber;
      const result = new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
      frame.contentWindow.postMessage({
        type: 'render',
        token,
        requestId,
        source,
        diagramId,
        config,
      }, '*');
      return result;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      pending.forEach((request) => request.reject(new Error('Mermaid renderer was removed.')));
      pending.clear();
      frame.remove();
    },
  };
}

export async function mount(context) {
  const blocks = context.root.querySelectorAll('code.language-mermaid');
  if (!blocks.length) return;
  const canonical = await ensureCanonical();
  if (context.signal.aborted) return;
  await loadStyle(vendorAsset('sdocs-mermaid-reader.css'), 'smalldocs-sdk-mermaid-reader-styles');
  if (context.signal.aborted) return;

  const worker = createWorker();
  let mermaidConfig = null;
  const focus = canonical.focusCore.create({
    window,
    document,
    zoomMath: canonical.zoomMath,
    controls: context.options.controls,
    setHTML: setKnownHTML,
    mountSurface(surface, options) {
      return openOverlayLease(context, {
        surface,
        initialFocus: options.initialFocus,
        beforeClose: options.beforeClose,
      });
    },
  });
  const sdocs = { SDocMermaidFocus: focus };
  const mermaidProxy = {
    initialize(config) { mermaidConfig = config; },
    render(diagramId, source) { return worker.render(source, diagramId, mermaidConfig); },
  };
  const renderer = canonical.mermaidCore.create({
    window,
    document,
    sdocs,
    root: () => context.root.host || context.root,
    scope: context.root,
    loadMermaid: () => Promise.resolve(mermaidProxy),
    setSvgHTML: setKnownHTML,
    parseSvg: (source) => parseKnownHTML(source, 'image/svg+xml'),
    isActive: () => !context.signal.aborted,
    isNodeActive: (node) => context.allowDetached === true || node.isConnected,
  });

  try {
    await renderer.processMermaid(context.root);
  } finally {
    worker.destroy();
  }
  return () => {
    renderer.destroy();
    focus.destroy();
    worker.destroy();
  };
}
