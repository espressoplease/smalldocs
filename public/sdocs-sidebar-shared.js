(function (exports) {
  'use strict';

  var icons = {
    local: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5"/><path d="M8 19V7"/><path d="M12 19V4"/><path d="m16 5 4 14"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>',
    capabilities: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20"/><path d="m4.93 4.93 14.14 14.14"/><path d="M2 12h20"/><path d="m19.07 4.93-14.14 14.14"/></svg>',
    sdk: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9-3 3 3 3"/><path d="m16 9 3 3-3 3"/><path d="m14 5-4 14"/></svg>',
    signIn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path d="m16 19 2 2 4-4"/></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3z"/><path d="m9 12 2 2 4-4"/></svg>',
    github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v12"/><path d="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M15 6a9 9 0 0 0-9 9"/><path d="M18 15v6"/><path d="M21 18h-6"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    chevron: '<svg class="sdocs-site-sidebar-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'
  };

  var capabilities = [
    { label: 'Diagrams', href: '/docs#sec=diagrams' },
    { label: 'Slides', href: '/docs#sec=slides' },
    { label: 'Spreadsheets', href: '/advanced-spreadsheets' },
    { label: 'Charts', href: '/docs#sec=charts' },
    { label: 'Formatting', href: '/docs#sec=formatting' },
    { label: 'Code', href: '/docs#sec=code' },
  ];

  var sdkDescription = 'Render agent-generated Markdown as rich, interactive documents inside your application with configurable styling.';

  function capabilitiesHtml(className) {
    return capabilities.map(function (item) {
      return '<a class="' + className + '" href="' + item.href + '">' + item.label + '</a>';
    }).join('');
  }

  function footerInnerHtml(options) {
    options = options || {};
    var status = options.statusId
      ? '<div id="' + options.statusId + '" class="sdocs-sidebar-status" aria-live="polite"></div>' : '';
    var returnTo = options.returnTo || '/docs';
    var account = options.authenticated
      ? '<a class="sdocs-sidebar-footer-link" href="/cloud/admin">' +
        icons.settings + '<span>Account settings</span></a>'
      : '<a class="sdocs-sidebar-footer-link" href="/cloud/sign-in?return=' +
        encodeURIComponent(returnTo) + '" data-sdocs-sign-in-return>' +
        icons.signIn + '<span>Sign in</span></a>';
    return status +
      account +
      '<a class="sdocs-sidebar-footer-link" href="/privacy" target="_blank" rel="noopener">' +
      icons.shield + '<span>Private by design</span></a>' +
      '<a class="sdocs-sidebar-footer-link" href="https://github.com/espressoplease/smalldocs" target="_blank" rel="noopener">' +
      icons.github + '<span>Source on GitHub</span></a>' +
      '<div class="sdocs-sidebar-legal">You agree to our ' +
      '<a href="/legal" target="_blank" rel="noopener">Terms</a></div>';
  }

  function hydrate(root) {
    root = root || document;
    Array.from(root.querySelectorAll('[data-sdocs-shared-capabilities]')).forEach(function (element) {
      element.innerHTML = capabilitiesHtml(element.getAttribute('data-item-class') || '');
    });
    Array.from(root.querySelectorAll('[data-sdocs-shared-sdk-description]')).forEach(function (element) {
      element.textContent = sdkDescription;
    });
    Array.from(root.querySelectorAll('[data-sdocs-shared-footer]')).forEach(function (element) {
      var authHost = element.closest('[data-cloud-authenticated]');
      element.innerHTML = footerInnerHtml({
        statusId: element.getAttribute('data-status-id'),
        authenticated: authHost && authHost.getAttribute('data-cloud-authenticated') === 'true',
        returnTo: window.location.pathname + window.location.search,
      });
    });
  }

  exports.icons = icons;
  exports.capabilities = capabilities;
  exports.sdkDescription = sdkDescription;
  exports.capabilitiesHtml = capabilitiesHtml;
  exports.footerInnerHtml = footerInnerHtml;
  exports.hydrate = hydrate;
})(typeof module !== 'undefined' && module.exports
  ? module.exports : (window.SDocsSidebarShared = {}));

if (typeof document !== 'undefined') window.SDocsSidebarShared.hydrate(document);
