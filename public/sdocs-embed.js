(function () {
  if (!document.documentElement.classList.contains('sdocs-embed')) return;

  var S = window.SDocs;
  var params = new URLSearchParams(location.search);
  var channel = params.get('channel') || '';
  var expectedParentOrigin = params.get('parentOrigin') || '';
  var latestGeneration = 0;
  var resizeObserver = null;
  var focusObserver = null;
  var resizeFrame = 0;
  var lastFocusOpen = false;

  if (!S || !channel || !expectedParentOrigin) return;
  S.embedMode = true;

  function send(type, detail) {
    parent.postMessage(Object.assign({
      type: type,
      channel: channel,
    }, detail || {}), expectedParentOrigin);
  }

  function renderedHeight() {
    var root = document.getElementById('_sd_rendered');
    if (!root) return 1;
    return Math.max(1, Math.ceil(root.getBoundingClientRect().bottom));
  }

  function sendResize() {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(function () {
      send('sdocs:resize', { height: renderedHeight() });
    });
  }

  function sendFocusState() {
    var open = [
      'sdoc-present-open',
      'sdoc-cells-focus-open',
      'sdoc-code-focus-open',
      'sdoc-mermaid-focus-open',
    ].some(function (className) { return document.body.classList.contains(className); });
    if (open === lastFocusOpen) return;
    lastFocusOpen = open;
    send('sdocs:focus', { open: open });
  }
  S.syncEmbedFocus = sendFocusState;

  function afterLayout() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(resolve);
      });
    });
  }

  async function renderMessage(message) {
    var generation = Number(message.generation) || 0;
    if (generation < latestGeneration) return;
    latestGeneration = generation;

    try {
      S._isDefaultState = false;
      S.loadText(String(message.markdown == null ? '' : message.markdown));
      S.setMode('read', true);
      clearTimeout(S._hashTimer);
      await afterLayout();
      if (generation !== latestGeneration) return;
      var height = renderedHeight();
      send('sdocs:rendered', { generation: generation, height: height });
      sendResize();
    } catch (error) {
      send('sdocs:error', {
        generation: generation,
        message: error && error.message ? error.message : 'Document rendering failed',
      });
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== parent || event.origin !== expectedParentOrigin) return;
    var message = event.data;
    if (!message || message.channel !== channel || message.type !== 'sdocs:render') return;
    renderMessage(message);
  });

  function ready() {
    var root = document.getElementById('_sd_rendered');
    if (root && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(sendResize);
      resizeObserver.observe(root);
    }
    if (typeof MutationObserver !== 'undefined') {
      focusObserver = new MutationObserver(sendFocusState);
      focusObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    send('sdocs:ready');
    sendResize();
  }

  if (S._appReady) ready();
  else document.addEventListener('sdocs-app-ready', ready, { once: true });

  window.addEventListener('pagehide', function () {
    if (resizeObserver) resizeObserver.disconnect();
    if (focusObserver) focusObserver.disconnect();
    cancelAnimationFrame(resizeFrame);
  }, { once: true });
}());
