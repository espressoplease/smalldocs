const sdkUrl = new URL(import.meta.url);
const rendererOrigin = sdkUrl.origin;
const rendererPath = '/embed';

function randomChannel() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  var bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, function (value) {
    return value.toString(16).padStart(2, '0');
  }).join('');
}

function resolveTarget(target) {
  if (typeof target === 'string') {
    var element = document.querySelector(target);
    if (!element) throw new Error('SmallDocs render target was not found: ' + target);
    return element;
  }
  if (target && target.nodeType === 1) return target;
  throw new TypeError('SmallDocs render target must be a selector or an Element');
}

function deferred() {
  var resolve;
  var reject;
  var promise = new Promise(function (yes, no) {
    resolve = yes;
    reject = no;
  });
  return { promise: promise, resolve: resolve, reject: reject };
}

function abortError() {
  try {
    return new DOMException('A newer SmallDocs render replaced this one', 'AbortError');
  } catch (_) {
    var error = new Error('A newer SmallDocs render replaced this one');
    error.name = 'AbortError';
    return error;
  }
}

export async function render(target, markdown) {
  var mount = resolveTarget(target);
  if (!/^https?:$/.test(location.protocol)) {
    throw new Error('SmallDocs rendering requires an http or https host page');
  }

  var channel = randomChannel();
  var frame = document.createElement('iframe');
  var ready = deferred();
  var pending = new Map();
  var generation = 0;
  var destroyed = false;
  var focusOpen = false;
  var documentHeight = 1;
  var savedHostState = null;

  frame.className = 'smalldocs-renderer';
  frame.title = 'SmallDocs document';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-downloads allow-modals');
  frame.setAttribute('allow', 'fullscreen');
  frame.setAttribute('loading', 'eager');
  frame.style.display = 'block';
  frame.style.width = '100%';
  frame.style.height = '1px';
  frame.style.border = '0';

  function setHeight(value) {
    var height = Math.max(1, Number(value) || 1);
    documentHeight = height;
    if (focusOpen) return;
    frame.style.height = Math.ceil(height) + 'px';
  }

  function setFocusOpen(open) {
    open = !!open;
    if (open === focusOpen) return;
    focusOpen = open;
    if (open) {
      savedHostState = {
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        htmlOverflow: document.documentElement.style.overflow,
        bodyOverflow: document.body.style.overflow,
      };
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      frame.style.position = 'fixed';
      frame.style.inset = '0';
      frame.style.zIndex = '2147483647';
      frame.style.width = '100vw';
      frame.style.height = '100vh';
      frame.style.background = '#fff';
      window.scrollTo(savedHostState.scrollX, savedHostState.scrollY);
      return;
    }
    var restoreState = savedHostState;
    frame.blur();
    frame.style.position = '';
    frame.style.inset = '';
    frame.style.zIndex = '';
    frame.style.width = '100%';
    frame.style.height = Math.ceil(documentHeight) + 'px';
    frame.style.background = '';
    if (restoreState) {
      document.documentElement.style.overflow = restoreState.htmlOverflow;
      document.body.style.overflow = restoreState.bodyOverflow;
      window.scrollTo(restoreState.scrollX, restoreState.scrollY);
      requestAnimationFrame(function () {
        window.scrollTo(restoreState.scrollX, restoreState.scrollY);
      });
      savedHostState = null;
    }
  }

  function settleGeneration(current, method, value) {
    var operation = pending.get(current);
    if (!operation) return;
    pending.delete(current);
    operation[method](value);
  }

  function navigateHost(rawHref) {
    var destination;
    try {
      destination = new URL(String(rawHref || ''), location.href);
    } catch (_) {
      return;
    }
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(destination.protocol)) return;
    location.assign(destination.href);
  }

  function onMessage(event) {
    if (event.source !== frame.contentWindow || event.origin !== rendererOrigin) return;
    var message = event.data;
    if (!message || message.channel !== channel) return;
    if (message.type === 'sdocs:ready') {
      ready.resolve();
      return;
    }
    if (message.type === 'sdocs:resize') {
      setHeight(message.height);
      return;
    }
    if (message.type === 'sdocs:focus') {
      setFocusOpen(message.open);
      return;
    }
    if (message.type === 'sdocs:navigate') {
      navigateHost(message.href);
      return;
    }
    if (message.type === 'sdocs:rendered') {
      setHeight(message.height);
      settleGeneration(message.generation, 'resolve');
      return;
    }
    if (message.type === 'sdocs:error') {
      settleGeneration(message.generation, 'reject', new Error(message.message));
    }
  }

  window.addEventListener('message', onMessage);
  frame.addEventListener('error', function () {
    ready.reject(new Error('SmallDocs renderer could not be loaded'));
  }, { once: true });

  var embedUrl = new URL(rendererPath, rendererOrigin);
  embedUrl.searchParams.set('parentOrigin', location.origin);
  embedUrl.searchParams.set('channel', channel);
  frame.src = embedUrl.href;
  mount.replaceChildren(frame);

  var view = {
    element: frame,
    update: async function (nextMarkdown) {
      if (destroyed) throw new Error('SmallDocs renderer has been destroyed');
      await ready.promise;
      pending.forEach(function (operation) { operation.reject(abortError()); });
      pending.clear();
      generation += 1;
      var operation = deferred();
      pending.set(generation, operation);
      frame.contentWindow.postMessage({
        type: 'sdocs:render',
        channel: channel,
        generation: generation,
        markdown: String(nextMarkdown == null ? '' : nextMarkdown),
      }, rendererOrigin);
      await operation.promise;
    },
    destroy: function () {
      if (destroyed) return;
      destroyed = true;
      if (focusOpen) setFocusOpen(false);
      window.removeEventListener('message', onMessage);
      ready.reject(new Error('SmallDocs renderer was destroyed before it became ready'));
      pending.forEach(function (operation) {
        operation.reject(new Error('SmallDocs renderer was destroyed'));
      });
      pending.clear();
      frame.remove();
    },
  };

  await view.update(markdown);
  return view;
}

export const SmallDocs = Object.freeze({ render: render });
export default SmallDocs;
