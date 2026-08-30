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
    var originalInline = {
      position: header.style.position,
      top: header.style.top,
      left: header.style.left,
      right: header.style.right,
      transform: header.style.transform,
      transition: header.style.transition,
      willChange: header.style.willChange,
    };

    function restoreInline(name) {
      if (originalInline[name]) header.style[name] = originalInline[name];
      else header.style.removeProperty(name.replace(/[A-Z]/g, function (letter) {
        return '-' + letter.toLowerCase();
      }));
    }

    function hideSpacer() {
      if (!spacer) return;
      spacer.style.display = 'none';
      spacer.style.removeProperty('height');
      spacer.style.removeProperty('flex');
      spacer.style.removeProperty('overflow-anchor');
    }

    function showMobileHeader() {
      header.style.position = 'sticky';
      header.style.top = '0';
      header.style.removeProperty('left');
      header.style.removeProperty('right');
      header.style.removeProperty('transform');
      header.style.removeProperty('transition');
      header.style.removeProperty('will-change');
      header.setAttribute('data-mobile-header-state', 'visible');
      hideSpacer();
    }

    function restoreDesktopHeader() {
      restoreInline('position');
      restoreInline('top');
      restoreInline('left');
      restoreInline('right');
      restoreInline('transform');
      restoreInline('transition');
      restoreInline('willChange');
      header.setAttribute('data-mobile-header-state', 'visible');
      hideSpacer();
    }

    function refresh() {
      if (mobile.matches) showMobileHeader();
      else restoreDesktopHeader();
    }

    function destroy() {
      if (mobile.removeEventListener) mobile.removeEventListener('change', refresh);
      else mobile.removeListener(refresh);
      restoreDesktopHeader();
    }

    if (mobile.addEventListener) mobile.addEventListener('change', refresh);
    else mobile.addListener(refresh);
    refresh();

    return {
      destroy: destroy,
      pinFor: refresh,
      refresh: refresh,
      reveal: refresh,
    };
  }

  function bindMarkedHeaders(root) {
    root = root || document;
    var headers = root.querySelectorAll('[data-sdocs-scroll-header]');
    Array.prototype.forEach.call(headers, function (header) {
      if (header._sdocsScrollHeader) return;
      var breakpoint = parseInt(header.getAttribute('data-sdocs-scroll-header-breakpoint'), 10) || 768;
      header._sdocsScrollHeader = bind({
        header: header,
        breakpoint: breakpoint,
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
