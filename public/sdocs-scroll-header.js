(function (exports) {
  'use strict';

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
    var originalInline = {
      position: header.style.position,
      top: header.style.top,
      left: header.style.left,
      right: header.style.right,
      transform: header.style.transform,
      transition: header.style.transition,
      willChange: header.style.willChange,
    };
    var mobileTransition = null;

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
      header.style.transform = next === 'hidden' ? 'translateY(-100%)' : 'translateY(0)';
    }

    function setFixed(next) {
      header.style.position = 'fixed';
      header.style.top = '0';
      header.style.left = '0';
      header.style.right = '0';
      header.style.willChange = 'transform';
      if (mobileTransition == null) {
        var existing = getComputedStyle(header).transition;
        mobileTransition = existing && existing !== 'all 0s ease 0s'
          ? existing + ', transform .3s cubic-bezier(.4,0,.2,1)'
          : 'transform .3s cubic-bezier(.4,0,.2,1)';
      }
      header.style.transition = mobileTransition;
      setState(next);
    }

    function restoreInline(name) {
      if (originalInline[name]) header.style[name] = originalInline[name];
      else header.style.removeProperty(name.replace(/[A-Z]/g, function (letter) {
        return '-' + letter.toLowerCase();
      }));
    }

    function clearDesktopState() {
      restoreInline('position');
      restoreInline('top');
      restoreInline('left');
      restoreInline('right');
      restoreInline('transform');
      restoreInline('transition');
      restoreInline('willChange');
      state = 'visible';
      header.setAttribute('data-mobile-header-state', 'visible');
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
      setFixed('visible');
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

      if (scrollY <= 0 || pinsHeader()) {
        setFixed('visible');
        lastScrollY = scrollY;
        return;
      }

      if (delta > 0 && state !== 'hidden') setFixed('hidden');
      else if (delta < 0 && state !== 'visible') setFixed('visible');

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
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        bindMarkedHeaders(document);
      }, { once: true });
    } else {
      bindMarkedHeaders(document);
    }
  }
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocsScrollHeader = {}));
