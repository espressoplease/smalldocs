// sdocs-html-components.js - canonical runnable HTML component reader.
//
// A fenced `sdoc-app` block contains one complete HTML document. The source
// runs in its own sandboxed iframe, both inline and in the fullscreen gallery.
// The iframe deliberately has no same-origin capability, so the component is
// a standalone browser context rather than another part of the reader DOM.
(function (exports) {
  'use strict';

  var EXPAND_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
  var PREVIOUS_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  var NEXT_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
  var CLOSE_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var SANDBOX = 'allow-scripts allow-forms allow-modals allow-downloads allow-popups';
  var READY_TIMEOUT_MS = 15000;

  function deferred() {
    var resolve;
    var promise = new Promise(function (yes) { resolve = yes; });
    return { promise: promise, resolve: resolve };
  }

  function randomToken(win) {
    if (win.crypto && typeof win.crypto.randomUUID === 'function') {
      return win.crypto.randomUUID();
    }
    var bytes = new Uint32Array(4);
    win.crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (value) {
      return value.toString(36);
    }).join('');
  }

  function titleFromSource(win, source, index) {
    try {
      var parsed = new win.DOMParser().parseFromString(String(source || ''), 'text/html');
      var title = (parsed.title || '').replace(/\s+/g, ' ').trim();
      if (title) return title.slice(0, 160);
      var heading = parsed.querySelector('h1');
      if (heading && heading.textContent.trim()) {
        return heading.textContent.replace(/\s+/g, ' ').trim().slice(0, 160);
      }
    } catch (_) {}
    return 'Interactive component ' + (index + 1);
  }

  function createButton(doc, className, label) {
    var button = doc.createElement('button');
    button.type = 'button';
    button.className = className;
    button.setAttribute('aria-label', label);
    button.title = label;
    return button;
  }

  function create(options) {
    options = options || {};
    var win = options.window || window;
    var doc = options.document || win.document;
    var entries = [];
    var framesByToken = new Map();
    var overlay = null;
    var destroyed = false;

    function setHTML(node, html) {
      if (options.setHTML) options.setHTML(node, String(html));
      else node.innerHTML = html;
    }

    function controls(name) {
      var configured = typeof options.controls === 'function' ? options.controls() : options.controls;
      return !configured || configured[name] !== false;
    }

    function button(className, label, icon) {
      var result = createButton(doc, className, label);
      setHTML(result, icon);
      return result;
    }

    function isActive() {
      return !destroyed && (!options.isActive || options.isActive());
    }

    function runnerUrl(token) {
      var configured = typeof options.runnerUrl === 'function'
        ? options.runnerUrl(token)
        : options.runnerUrl;
      var url = new URL(configured || '/sdoc-app-runner', win.location.href);
      url.searchParams.set('token', token);
      return url.href;
    }

    function removeFrame(frame) {
      if (!frame) return;
      var token = frame.dataset.sdocsAppToken;
      if (token) framesByToken.delete(token);
      frame.remove();
    }

    function settleEntry(entry, status) {
      if (!entry || entry.settled) return;
      entry.settled = true;
      win.clearTimeout(entry.readyTimer);
      entry.ready.resolve({ status: status, index: entry.index });
    }

    function showFailure(entry, message) {
      if (!entry || !entry.host) return;
      if (entry.status) {
        entry.status.textContent = message;
        entry.status.hidden = false;
      }
      if (!entry.failure) {
        var details = doc.createElement('details');
        details.className = 'sdoc-app-failure-source';
        var summary = doc.createElement('summary');
        summary.textContent = 'View component source';
        var pre = doc.createElement('pre');
        var code = doc.createElement('code');
        code.className = 'language-html';
        code.textContent = entry.source;
        pre.appendChild(code);
        details.append(summary, pre);
        entry.host.appendChild(details);
        entry.failure = details;
      }
      settleEntry(entry, 'error');
    }

    function createFrame(entry, mode) {
      var token = randomToken(win);
      var frame = doc.createElement('iframe');
      frame.className = 'sdoc-app-frame sdoc-app-frame-' + mode;
      frame.dataset.sdocsAppToken = token;
      frame.dataset.sdocsAppIndex = String(entry.index);
      frame.title = entry.title;
      frame.setAttribute('sandbox', SANDBOX);
      frame.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
      frame.setAttribute('loading', 'eager');
      frame.src = runnerUrl(token);
      framesByToken.set(token, {
        token: token,
        frame: frame,
        entry: entry,
        mode: mode,
        sent: false,
        lastInlineHeight: 480,
      });
      frame.addEventListener('error', function () {
        showFailure(entry, 'This component could not start.');
      }, { once: true });
      return frame;
    }

    function receive(event) {
      var message = event.data;
      if (!message || typeof message !== 'object' || !message.token) return;
      var record = framesByToken.get(message.token);
      if (!record || event.source !== record.frame.contentWindow || !isActive()) return;
      if (message.type === 'sdocs-app-ready') {
        if (record.sent) return;
        record.sent = true;
        record.frame.contentWindow.postMessage({
          type: 'sdocs-app-load',
          token: record.token,
          source: record.entry.source,
        }, '*');
        return;
      }
      if (message.type === 'sdocs-app-size' && record.mode === 'inline') {
        var height = Math.round(Number(message.height));
        if (!Number.isFinite(height)) return;
        height = Math.max(0, height);
        record.lastInlineHeight = height;
        record.frame.style.height = height + 'px';
        return;
      }
      if (message.type === 'sdocs-app-mounted' && record.entry.status) {
        record.entry.status.hidden = true;
        settleEntry(record.entry, 'mounted');
      }
    }

    win.addEventListener('message', receive);

    function clearInline() {
      entries.forEach(function (entry) {
        if (entry.frame) removeFrame(entry.frame);
      });
      entries = [];
    }

    function cleanupOverlay(record) {
      if (!record || record.cleaned) return;
      record.cleaned = true;
      win.removeEventListener('keydown', record.onKeydown);
      restoreInlineFrame(record.entry);
      if (overlay === record) overlay = null;
    }

    function frameRecord(entry) {
      return entry && entry.frame
        ? framesByToken.get(entry.frame.dataset.sdocsAppToken)
        : null;
    }

    function restoreInlineFrame(entry) {
      if (!entry || !entry.frame || !entry.host || !entry.host.isConnected) return;
      var record = frameRecord(entry);
      if (record) record.mode = 'inline';
      entry.frame.classList.remove('sdoc-app-frame-fullscreen');
      entry.frame.classList.add('sdoc-app-frame-inline');
      entry.frame.style.height = ((record && record.lastInlineHeight) || 480) + 'px';
      entry.host.classList.remove('sdoc-app-expanded');
      if (entry.placeholder) entry.placeholder.hidden = true;
    }

    function moveFrameToOverlay(entry) {
      var record = frameRecord(entry);
      if (record) record.mode = 'fullscreen';
      entry.frame.classList.remove('sdoc-app-frame-inline');
      entry.frame.classList.add('sdoc-app-frame-fullscreen');
      entry.frame.style.height = '';
      entry.host.classList.add('sdoc-app-expanded');
      if (entry.placeholder) entry.placeholder.hidden = false;
    }

    function defaultMountSurface(surface, setup) {
      var previousBodyOverflow = doc.body.style.overflow;
      var previousRootOverflow = doc.documentElement.style.overflow;
      doc.body.appendChild(surface);
      doc.body.classList.add('sdoc-app-focus-open');
      doc.documentElement.style.overflow = 'hidden';
      return {
        close: function (reason) {
          setup.beforeClose(reason || 'user');
          surface.remove();
          doc.body.classList.remove('sdoc-app-focus-open');
          doc.body.style.overflow = previousBodyOverflow;
          doc.documentElement.style.overflow = previousRootOverflow;
          if (setup.returnFocus && setup.returnFocus.isConnected) setup.returnFocus.focus();
        },
      };
    }

    function renderOverlayEntry(record, index) {
      if (!record || !entries.length) return;
      var total = entries.length;
      var nextIndex = Math.max(0, Math.min(total - 1, index));
      var entry = entries[nextIndex];
      restoreInlineFrame(record.entry);
      record.index = nextIndex;
      record.entry = entry;
      record.title.textContent = entry.title;
      record.counter.textContent = (nextIndex + 1) + ' / ' + total;
      record.previous.disabled = nextIndex === 0;
      record.next.disabled = nextIndex === total - 1;
      record.previous.hidden = total < 2;
      record.next.hidden = total < 2;
      record.counter.hidden = total < 2;
      moveFrameToOverlay(entry);
    }

    function closeFullscreen(reason) {
      var record = overlay;
      if (!record) return;
      if (record.lease && typeof record.lease.close === 'function') {
        record.lease.close(reason || 'user');
      } else {
        cleanupOverlay(record);
        record.surface.remove();
      }
    }

    function openFullscreen(index, returnFocus) {
      if (!entries.length || !isActive()) return;
      closeFullscreen('superseded');

      var surface = doc.createElement('div');
      surface.className = 'sdoc-app-focus';
      surface.dataset.sdocsSdkVersion = options.sdkVersion || 'app';
      surface.setAttribute('role', 'dialog');
      surface.setAttribute('aria-modal', 'true');
      surface.setAttribute('aria-label', 'Interactive components');
      var bar = doc.createElement('div');
      bar.className = 'sdoc-app-focus-bar';
      var brand = doc.createElement('span');
      brand.className = 'sdoc-app-focus-brand';
      brand.textContent = 'SmallDocs';
      var title = doc.createElement('span');
      title.className = 'sdoc-app-focus-title';
      var actions = doc.createElement('div');
      actions.className = 'sdoc-app-focus-actions';
      var previous = button('sdoc-app-focus-button', 'Previous component', PREVIOUS_SVG);
      var counter = doc.createElement('span');
      counter.className = 'sdoc-app-focus-counter';
      var next = button('sdoc-app-focus-button', 'Next component', NEXT_SVG);
      var close = button('sdoc-app-focus-button', 'Close fullscreen', CLOSE_SVG);
      var stage = doc.createElement('div');
      stage.className = 'sdoc-app-focus-stage';
      actions.append(previous, counter, next, close);
      bar.append(brand, title, actions);
      surface.append(bar, stage);

      var record = {
        surface: surface,
        stage: stage,
        title: title,
        previous: previous,
        counter: counter,
        next: next,
        close: close,
        entry: null,
        index: 0,
        returnFocus: returnFocus || doc.activeElement,
        lease: null,
        cleaned: false,
        onKeydown: null,
      };
      overlay = record;
      previous.addEventListener('click', function () { renderOverlayEntry(record, record.index - 1); });
      next.addEventListener('click', function () { renderOverlayEntry(record, record.index + 1); });
      close.addEventListener('click', function () { closeFullscreen('user'); });
      record.onKeydown = function (event) {
        if (overlay !== record) return;
        if (event.key === 'ArrowLeft' && !record.previous.disabled) {
          event.preventDefault();
          renderOverlayEntry(record, record.index - 1);
        } else if (event.key === 'ArrowRight' && !record.next.disabled) {
          event.preventDefault();
          renderOverlayEntry(record, record.index + 1);
        } else if (event.key === 'Escape' && !options.mountSurface) {
          event.preventDefault();
          closeFullscreen('user');
        }
      };
      win.addEventListener('keydown', record.onKeydown);

      var mount = options.mountSurface || defaultMountSurface;
      record.lease = mount(surface, {
        initialFocus: close,
        returnFocus: record.returnFocus,
        beforeClose: function () { cleanupOverlay(record); },
      });
      renderOverlayEntry(record, index || 0);
      close.focus();
    }

    function mountInline(code, index) {
      var pre = code.closest('pre');
      if (!pre) return null;
      var target = pre.closest('.pre-wrapper') || pre;
      var source = code.textContent || '';
      var entry = {
        index: index,
        source: source,
        title: titleFromSource(win, source, index),
        frame: null,
        status: null,
        host: null,
        placeholder: null,
        failure: null,
        settled: false,
        ready: deferred(),
        readyTimer: null,
      };
      var host = doc.createElement('section');
      host.className = 'sdoc-app';
      host.dataset.sdocsAppIndex = String(index);
      host.dataset.sdocsSdkVersion = options.sdkVersion || 'app';
      var bar = doc.createElement('div');
      bar.className = 'sdoc-app-bar';
      var title = doc.createElement('span');
      title.className = 'sdoc-app-title';
      title.textContent = entry.title;
      var expand = null;
      if (controls('fullscreen')) {
        expand = button('sdoc-app-expand', 'Open ' + entry.title + ' in fullscreen', EXPAND_SVG);
        expand.addEventListener('click', function () { openFullscreen(entry.index, expand); });
      }
      var status = doc.createElement('span');
      status.className = 'sdoc-app-status';
      status.textContent = 'Loading component...';
      entry.status = status;
      entry.host = host;
      var placeholder = doc.createElement('div');
      placeholder.className = 'sdoc-app-placeholder';
      placeholder.textContent = 'This component is open in fullscreen.';
      placeholder.hidden = true;
      entry.placeholder = placeholder;
      bar.appendChild(title);
      if (expand) bar.appendChild(expand);
      entry.frame = createFrame(entry, 'inline');
      host.append(bar, entry.frame, status, placeholder);
      target.replaceWith(host);
      entry.readyTimer = win.setTimeout(function () {
        showFailure(entry, 'This component did not finish starting.');
      }, READY_TIMEOUT_MS);
      return entry;
    }

    function process(root) {
      if (!isActive() || !root) return { apps: [], ready: Promise.resolve([]) };
      closeFullscreen('rerender');
      clearInline();
      var blocks = Array.from(root.querySelectorAll('pre > code.language-sdoc-app'));
      entries = blocks.map(mountInline).filter(Boolean);
      return {
        apps: entries.slice(),
        ready: Promise.all(entries.map(function (entry) { return entry.ready.promise; })),
      };
    }

    function destroy(reason) {
      if (destroyed) return;
      closeFullscreen(reason || 'destroy');
      clearInline();
      destroyed = true;
      win.removeEventListener('message', receive);
      framesByToken.forEach(function (record) { record.frame.remove(); });
      framesByToken.clear();
    }

    return {
      process: process,
      open: openFullscreen,
      close: closeFullscreen,
      destroy: destroy,
      entries: function () { return entries.slice(); },
    };
  }

  exports.SANDBOX = SANDBOX;
  exports.titleFromSource = titleFromSource;
  exports.create = create;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocHtmlComponents = {}));
