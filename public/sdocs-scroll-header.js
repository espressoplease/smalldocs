(function (exports) {
  'use strict';

  var resetReloadScroll = false;

  function isReloadNavigation() {
    var entries = window.performance && window.performance.getEntriesByType
      ? window.performance.getEntriesByType('navigation') : [];
    if (entries && entries[0]) return entries[0].type === 'reload';
    return !!(window.performance && window.performance.navigation
      && window.performance.navigation.type === 1);
  }

  function hasDocumentAnchor() {
    if (!window.location.hash) return false;
    var target = window.location.hash.slice(1);
    try { target = decodeURIComponent(target); } catch (_) {}
    return !!(target && (document.getElementById(target)
      || document.getElementsByName(target).length));
  }

  function prepareMobileReload() {
    if (!window.matchMedia('(max-width: 768px)').matches
      || !isReloadNavigation() || hasDocumentAnchor()) return;
    resetReloadScroll = true;
    try {
      if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    } catch (_) {}
    window.scrollTo(0, 0);
  }

  function finishMobileReload() {
    if (!resetReloadScroll) return;
    window.scrollTo(0, 0);
    window.requestAnimationFrame(function () {
      window.scrollTo(0, 0);
      try {
        if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'auto';
      } catch (_) {}
      resetReloadScroll = false;
    });
  }

  function bind(options) {
    if (typeof window === 'undefined' || !window.document) return null;

    options = options || {};
    var header = options.header;
    if (typeof header === 'string') header = document.querySelector(header);
    if (!header) return null;

    var breakpoint = options.breakpoint || 768;
    var mobile = window.matchMedia('(max-width: ' + breakpoint + 'px)');
    var spacer = options.spacer;
    if (typeof spacer === 'string') spacer = document.querySelector(spacer);
    var ownsSpacer = !spacer;
    if (!spacer) {
      spacer = document.createElement('div');
      spacer.className = 'sdocs-scroll-header-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      header.parentNode.insertBefore(spacer, header.nextSibling);
    }

    var state = 'visible';
    var lastScrollY = Math.max(0, window.scrollY || 0);
    var frame = null;
    var pinUntil = 0;
    var listening = false;
    var destroyed = false;

    function headerHeight() {
      return header.getBoundingClientRect().height || header.offsetHeight || 44;
    }

    function syncSpacer() {
      if (!ownsSpacer) return;
      if (!mobile.matches) {
        spacer.style.display = 'none';
        spacer.style.removeProperty('height');
        return;
      }
      spacer.style.display = 'block';
      spacer.style.height = Math.round(headerHeight()) + 'px';
      spacer.style.flex = '0 0 auto';
      spacer.style.overflowAnchor = 'none';
    }

    function setState(next) {
      state = next;
      header.setAttribute('data-mobile-header-state', next);
    }

    function setFixed(top, next) {
      header.style.position = 'fixed';
      header.style.top = Math.round(top) + 'px';
      header.style.left = '0';
      header.style.right = '0';
      setState(next);
    }

    function setDocumentPosition(top) {
      header.style.position = 'absolute';
      header.style.top = Math.round(top) + 'px';
      header.style.left = '0';
      header.style.right = '0';
      setState('moving');
    }

    function clearDesktopState() {
      header.style.removeProperty('position');
      header.style.removeProperty('top');
      header.style.removeProperty('left');
      header.style.removeProperty('right');
      setState('visible');
      syncSpacer();
    }

    function pinsHeader() {
      return Date.now() < pinUntil || !!(options.isPinned && options.isPinned());
    }

    function reveal() {
      lastScrollY = Math.max(0, window.scrollY || 0);
      if (!mobile.matches) {
        clearDesktopState();
        return;
      }
      syncSpacer();
      setFixed(0, 'visible');
    }

    function pinFor(duration) {
      pinUntil = Date.now() + Math.max(0, duration || 0);
      reveal();
    }

    function update() {
      frame = null;
      if (!mobile.matches || destroyed) return;

      var scrollY = Math.max(0, window.scrollY || 0);
      var delta = scrollY - lastScrollY;
      var height = headerHeight();

      if (scrollY <= 0 || pinsHeader()) {
        setFixed(0, 'visible');
        lastScrollY = scrollY;
        return;
      }

      if (state === 'moving') {
        var movingRect = header.getBoundingClientRect();
        if (movingRect.top >= 0) setFixed(0, 'visible');
        else if (movingRect.bottom <= 0) setFixed(-height, 'hidden');
      }

      if (delta > 0 && state === 'visible') {
        var visibleRect = header.getBoundingClientRect();
        setDocumentPosition(scrollY + visibleRect.top);
      } else if (delta < 0 && state === 'hidden') {
        var hiddenRect = header.getBoundingClientRect();
        setDocumentPosition(scrollY + hiddenRect.top);
      }

      lastScrollY = scrollY;
    }

    function scheduleUpdate() {
      if (frame != null || destroyed) return;
      frame = window.requestAnimationFrame(update);
    }

    function setListening(next) {
      if (next === listening) return;
      listening = next;
      if (next) window.addEventListener('scroll', scheduleUpdate, { passive: true });
      else window.removeEventListener('scroll', scheduleUpdate);
    }

    function handleBreakpoint() {
      lastScrollY = Math.max(0, window.scrollY || 0);
      setListening(mobile.matches);
      if (mobile.matches) reveal();
      else clearDesktopState();
    }

    function handlePageShow() {
      reveal();
    }

    window.addEventListener('pageshow', handlePageShow);
    if (mobile.addEventListener) mobile.addEventListener('change', handleBreakpoint);
    else mobile.addListener(handleBreakpoint);

    var mutationObserver = null;
    if (options.observeTarget && window.MutationObserver) {
      mutationObserver = new MutationObserver(function () {
        if (mobile.matches && pinsHeader()) reveal();
      });
      mutationObserver.observe(options.observeTarget, {
        attributes: true,
        attributeFilter: options.attributeFilter || ['class'],
      });
    }

    var resizeObserver = null;
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(function () {
        if (!mobile.matches) return;
        syncSpacer();
        if (state === 'hidden') setFixed(-headerHeight(), 'hidden');
      });
      resizeObserver.observe(header);
    }

    function destroy() {
      destroyed = true;
      setListening(false);
      window.removeEventListener('pageshow', handlePageShow);
      if (mobile.removeEventListener) mobile.removeEventListener('change', handleBreakpoint);
      else mobile.removeListener(handleBreakpoint);
      if (mutationObserver) mutationObserver.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      if (frame != null) window.cancelAnimationFrame(frame);
      clearDesktopState();
      if (ownsSpacer && spacer.parentNode) spacer.parentNode.removeChild(spacer);
    }

    handleBreakpoint();

    return {
      destroy: destroy,
      pinFor: pinFor,
      refresh: scheduleUpdate,
      reveal: reveal,
    };
  }

  function bindMarkedHeaders(root) {
    root = root || document;
    var headers = root.querySelectorAll('[data-sdocs-scroll-header]');
    Array.prototype.forEach.call(headers, function (header) {
      if (header._sdocsScrollHeader) return;
      var breakpoint = parseInt(header.getAttribute('data-sdocs-scroll-header-breakpoint'), 10) || 768;
      var pinSelector = header.getAttribute('data-sdocs-scroll-header-pin');
      var observeSelector = header.getAttribute('data-sdocs-scroll-header-observe');
      header._sdocsScrollHeader = bind({
        header: header,
        breakpoint: breakpoint,
        observeTarget: observeSelector ? document.querySelector(observeSelector) : null,
        isPinned: pinSelector ? function () {
          return !!document.querySelector(pinSelector);
        } : null,
      });
    });
  }

  exports.bind = bind;
  exports.bindMarkedHeaders = bindMarkedHeaders;

  if (typeof window !== 'undefined' && window.document) {
    prepareMobileReload();
    window.addEventListener('pageshow', finishMobileReload, { once: true });
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        bindMarkedHeaders(document);
      }, { once: true });
    } else {
      bindMarkedHeaders(document);
    }
  }
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocsScrollHeader = {}));
