import { openOverlay } from '../overlay.js';
import { safeFilename } from '../download.js';
import { sdkAsset } from '../assets.js';
import { setKnownHTML, setSanitizedHTML } from '../runtime.js';

const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const EXPAND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>';
const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>';

function randomToken() {
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(36)).join('');
}

function createWorker() {
  const token = randomToken();
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.tabIndex = -1;
  frame.title = 'SmallDocs diagram renderer';
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.src = sdkAsset('mermaid-renderer.html') + '?token=' + encodeURIComponent(token);
  const pending = new Map();
  let requestNumber = 0;
  let readyResolve;
  let readyReject;
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
    else request.resolve(message.svg);
  }

  window.addEventListener('message', receive);
  frame.addEventListener('error', () => readyReject(new Error('Mermaid renderer could not load.')), { once: true });
  document.body.appendChild(frame);

  return {
    async render(source, diagramId, themeVariables) {
      await ready;
      const requestId = ++requestNumber;
      const result = new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
      frame.contentWindow.postMessage({ type: 'render', token, requestId, source, diagramId, themeVariables }, '*');
      return result;
    },
    destroy() {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      pending.forEach((request) => request.reject(new Error('Mermaid renderer was removed.')));
      pending.clear();
      frame.remove();
    },
  };
}

function button(label, icon) {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = 'smalldocs-control';
  control.setAttribute('aria-label', label);
  control.title = label;
  setKnownHTML(control, icon);
  return control;
}

function cleanSource(source) {
  return String(source || '').replace(/^\s*%%\{[\s\S]*?\}%%\s*/g, '').slice(0, 65536);
}

function copyText(text, control) {
  navigator.clipboard.writeText(text).then(() => {
    control.dataset.copied = 'true';
    setTimeout(() => delete control.dataset.copied, 1200);
  }).catch(() => { control.dataset.copyFailed = 'true'; });
}

function errorBlock(source, message) {
  const error = document.createElement('pre');
  error.className = 'smalldocs-feature-error sdoc-mermaid-error';
  error.textContent = message + '\n\n' + source;
  return error;
}

function downloadSvg(source, filename) {
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

async function renderOne(worker, context, code, index) {
  const pre = code.closest('pre');
  if (!pre || !pre.isConnected) return;
  const source = cleanSource(code.textContent);
  try {
    const styles = getComputedStyle(context.root && context.root.nodeType === 11 ? context.root.host : context.root);
    const id = context.id.replace(/[^a-z0-9_-]/gi, '') + '-mermaid-' + context.generation + '-' + index;
    const svgSource = await worker.render(source, id, {
      primaryColor: styles.getPropertyValue('--sdocs-background').trim() || '#ffffff',
      primaryTextColor: styles.color || '#1c1917',
      primaryBorderColor: styles.getPropertyValue('--sdocs-accent').trim() || '#2563eb',
      lineColor: styles.getPropertyValue('--sdocs-muted-color').trim() || '#6b6560',
      fontFamily: styles.fontFamily,
    });
    if (context.signal.aborted || !pre.isConnected) return;
    const figure = document.createElement('figure');
    figure.className = 'sdoc-mermaid smalldocs-mermaid';
    const tools = document.createElement('div');
    tools.className = 'smalldocs-feature-tools';
    const stage = document.createElement('div');
    stage.className = 'smalldocs-mermaid-stage';
    setSanitizedHTML(stage, svgSource, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'style', 'animate', 'set'],
      FORBID_ATTR: ['style', 'onload', 'onclick', 'onerror'],
    });
    const svg = stage.querySelector('svg');
    if (!svg) throw new Error('Mermaid did not return an SVG diagram.');
    svg.removeAttribute('height');
    svg.style.maxWidth = '100%';
    figure.append(tools, stage);
    pre.replaceWith(figure);

    if (context.options.controls.copy) {
      const copy = button('Copy Mermaid source', COPY_ICON);
      copy.addEventListener('click', () => copyText(source, copy));
      tools.appendChild(copy);
    }
    if (context.options.controls.fullscreen) {
      const expand = button('Open diagram in fullscreen', EXPAND_ICON);
      expand.addEventListener('click', () => {
        const overlay = openOverlay(context, { label: 'Mermaid diagram', title: 'Diagram' });
        const clone = stage.cloneNode(true);
        clone.classList.add('smalldocs-mermaid-focus');
        overlay.stage.appendChild(clone);
      });
      tools.appendChild(expand);
    }
    if (context.options.controls.download) {
      const download = button('Download diagram SVG', DOWNLOAD_ICON);
      download.addEventListener('click', () => downloadSvg(
        '<?xml version="1.0" encoding="UTF-8"?>\n' + svg.outerHTML,
        safeFilename(context.meta.title, 'diagram-' + (index + 1)) + '.svg'
      ));
      tools.appendChild(download);
    }
  } catch (error) {
    if (pre.isConnected) pre.replaceWith(errorBlock(source, error.message));
  }
}

export async function mount(context) {
  const blocks = Array.from(context.root.querySelectorAll('code.language-mermaid')).slice(0, 50);
  if (!blocks.length) return;
  const worker = createWorker();
  try {
    for (let index = 0; index < blocks.length; index += 1) {
      await renderOne(worker, context, blocks[index], index);
    }
  } finally {
    worker.destroy();
  }
}
