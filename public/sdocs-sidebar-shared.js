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
    external: '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7"/><path d="m9 15 12-12"/><path d="M15 3h6v6"/></svg>',
    chevron: '<svg class="sdocs-sidebar-row-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'
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

  function capabilitiesHtml(className, ctaClassName) {
    var homepage = '<a class="' + (ctaClassName || className) + '" href="/home" ' +
      'target="_blank" rel="noopener"><span>View homepage</span>' + icons.external + '</a>';
    return homepage + capabilities.map(function (item) {
      return '<a class="' + className + '" href="' + item.href + '">' + item.label + '</a>';
    }).join('');
  }

  function topRowHtml(options) {
    options = options || {};
    var tag = options.href ? 'a' : 'button';
    var classes = 'sdocs-sidebar-top-row' + (options.rowClass ? ' ' + options.rowClass : '') +
      (options.className ? ' ' + options.className : '') + (options.active ? ' is-active' : '');
    var attrs = options.href ? ' href="' + options.href + '"' : ' type="button"';
    if (options.id) attrs += ' id="' + options.id + '"';
    if (options.controls) attrs += ' aria-controls="' + options.controls + '" aria-expanded="false"';
    if (options.dataHref) attrs += ' data-sidebar-href="' + options.dataHref + '"';
    if (options.active) attrs += ' aria-current="page"';
    return '<' + tag + ' class="' + classes + '"' + attrs + '>' + options.icon +
      '<span' + (options.labelClass ? ' class="' + options.labelClass + '"' : '') + '>' +
      options.label + '</span>' + (options.controls ? icons.chevron : '') + '</' + tag + '>';
  }

  function sectionHtml(options) {
    var panelId = options.panelId || options.idPrefix + '_' + options.id + '_panel';
    return '<div class="sdocs-sidebar-section' + (options.className ? ' ' + options.className : '') +
      '" data-sidebar-section="' + options.id + '">' + topRowHtml({
        rowClass: options.rowClass,
        id: options.buttonId,
        icon: options.icon,
        label: options.label,
        labelClass: options.labelClass,
        controls: panelId,
        dataHref: options.dataHref,
      }) + '<div class="sdocs-sidebar-expander" id="' + panelId + '">' +
      '<div class="sdocs-sidebar-expander-clip">' + options.content + '</div></div></div>';
  }

  function supportingSectionsHtml(options) {
    options = options || {};
    var rowClass = options.rowClass || '';
    var idPrefix = options.idPrefix || '_sd_sidebar';
    var capabilityContent = '<div class="sdocs-sidebar-preview sdocs-sidebar-preview-compact" ' +
      'data-sdocs-shared-capabilities>' +
      capabilitiesHtml('sdocs-sidebar-subitem',
        'sdocs-sidebar-library-row sdocs-sidebar-library-open') + '</div>';
    var sdkContent = '<div class="sdocs-sidebar-preview"><p class="sdocs-sidebar-explainer">' +
      sdkDescription + '</p><button class="sdocs-sidebar-cta" type="button" disabled>' +
      'Coming soon</button></div>';
    return sectionHtml({
      id: 'capabilities',
      idPrefix: idPrefix,
      rowClass: rowClass,
      icon: icons.capabilities,
      label: 'Capabilities',
      dataHref: '/docs#sec=formatting',
      content: capabilityContent,
    }) + sectionHtml({
      id: 'sdk',
      idPrefix: idPrefix,
      rowClass: rowClass,
      icon: icons.sdk,
      label: 'SDK',
      dataHref: '/developers',
      content: sdkContent,
    });
  }

  function sitePrimaryHtml(active, rowClass) {
    return topRowHtml({
      href: '/library',
      rowClass: rowClass,
      className: 'sdocs-site-sidebar-local',
      icon: icons.local,
      label: 'Local library',
      active: active === 'local',
    }) + topRowHtml({
      href: '/library?scope=cloud',
      rowClass: rowClass,
      icon: icons.cloud,
      label: 'Cloud library',
      active: active === 'cloud',
    });
  }

  function brandHtml(options) {
    options = options || {};
    var text = options.responsive
      ? '<span class="toolbar-brand-text toolbar-brand-full">SmallDocs</span>' +
        '<span class="toolbar-brand-text toolbar-brand-short">SDocs</span>' +
        '<span class="toolbar-brand-text toolbar-brand-tiny">SD</span>'
      : '<span>SmallDocs</span>';
    return '<a' + (options.id ? ' id="' + options.id + '"' : '') +
      ' class="sdocs-sidebar-brand" href="/" title="SmallDocs homepage">' + text + '</a>';
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
    var legal = options.termsAccepted ? '' :
      '<div class="sdocs-sidebar-legal">You agree to our ' +
      '<a href="/legal" target="_blank" rel="noopener">Terms</a></div>';
    return status +
      account +
      '<a class="sdocs-sidebar-footer-link" href="/privacy" target="_blank" rel="noopener">' +
      icons.shield + '<span>Private by design</span></a>' +
      '<a class="sdocs-sidebar-footer-link" href="https://github.com/espressoplease/smalldocs" target="_blank" rel="noopener">' +
      icons.github + '<span>Source on GitHub</span></a>' +
      legal;
  }

  function renderShell(element, options) {
    options = options || {};
    var footerOptions = {
      statusId: options.statusId,
      authenticated: Boolean(options.authenticated),
      termsAccepted: Boolean(options.termsAccepted),
      returnTo: options.returnTo || '/docs',
    };
    element.innerHTML = '<div class="sdocs-sidebar-main">' + brandHtml({
      id: options.brandId,
      responsive: options.responsiveBrand,
    }) + '<nav class="sdocs-sidebar-nav' + (options.navClass ? ' ' + options.navClass : '') +
      '" aria-label="SmallDocs navigation">' + (options.primaryHtml || '') +
      supportingSectionsHtml({ idPrefix: options.idPrefix, rowClass: options.rowClass }) +
      '</nav></div><footer class="sdocs-sidebar-footer">' + footerInnerHtml(footerOptions) + '</footer>';
    element.setAttribute('data-sdocs-sidebar-renderer', 'shared');
    if (options.active === 'settings') {
      var accountSettings = element.querySelector('a[href="/cloud/admin"]');
      if (accountSettings) {
        accountSettings.classList.add('is-active');
        accountSettings.setAttribute('aria-current', 'page');
      }
    }
    return element;
  }

  function setExpanded(section, expanded) {
    var trigger = section.querySelector(':scope > .sdocs-sidebar-top-row');
    section.classList.toggle('is-expanded', expanded);
    if (trigger) trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function bindExpandableSections(root, options) {
    options = options || {};
    Array.from(root.querySelectorAll('.sdocs-sidebar-section')).forEach(function (section) {
      var trigger = section.querySelector(':scope > .sdocs-sidebar-top-row');
      if (!trigger || trigger.getAttribute('data-sdocs-expander-bound') === 'true') return;
      trigger.setAttribute('data-sdocs-expander-bound', 'true');
      trigger.addEventListener('click', function () {
        var shouldExpand = !section.classList.contains('is-expanded');
        Array.from(root.querySelectorAll('.sdocs-sidebar-section.is-expanded')).forEach(function (openSection) {
          if (openSection !== section) setExpanded(openSection, false);
        });
        setExpanded(section, shouldExpand);
        if (typeof options.onToggle === 'function') {
          options.onToggle(section.getAttribute('data-sidebar-section'), shouldExpand, section);
        }
      });
    });
  }

  function bindMobileDrawer(options) {
    options = options || {};
    var button = options.button;
    var sidebar = options.sidebar;
    if (!button || !sidebar) return null;
    var body = options.body || document.body;
    var openClass = options.openClass || 'sdocs-mobile-nav-open';
    var backgrounds = options.backgrounds || [];
    var breakpoint = options.breakpoint || 768;

    function focusables() {
      return Array.from(sidebar.querySelectorAll(
        'a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
      )).filter(function (element) {
        return !element.hidden && element.getClientRects().length > 0;
      });
    }

    function setOpen(open, restoreFocus) {
      body.classList.toggle(openClass, open);
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      button.setAttribute('aria-label', open ? options.closeLabel : options.openLabel);
      backgrounds.forEach(function (element) { element.inert = open; });
      if (open) {
        window.requestAnimationFrame(function () {
          var first = focusables()[0];
          if (first) first.focus();
        });
      } else if (restoreFocus) {
        button.focus();
      }
    }

    button.addEventListener('click', function () {
      setOpen(!body.classList.contains(openClass), true);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && body.classList.contains(openClass)) {
        setOpen(false, true);
        return;
      }
      if (event.key !== 'Tab' || !body.classList.contains(openClass)) return;
      var available = focusables();
      available.push(button);
      if (!available.length) return;
      var first = available[0];
      var last = available[available.length - 1];
      if (event.shiftKey && (document.activeElement === first || available.indexOf(document.activeElement) === -1)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    window.addEventListener('resize', function () {
      if (!window.matchMedia('(max-width: ' + breakpoint + 'px)').matches) setOpen(false, false);
    });
    sidebar.addEventListener('click', function (event) {
      if (event.target.closest('a')) setOpen(false, false);
    });
    return { setOpen: setOpen };
  }

  function hydrate(root) {
    root = root || document;
    Array.from(root.querySelectorAll('[data-sdocs-sidebar-shell]')).forEach(function (element) {
      var template = document.getElementById(element.getAttribute('data-primary-template'));
      renderShell(element, {
        idPrefix: element.getAttribute('data-id-prefix') || element.id,
        rowClass: element.getAttribute('data-row-class') || '',
        navClass: element.getAttribute('data-nav-class') || '',
        brandId: element.getAttribute('data-brand-id') || '',
        responsiveBrand: element.hasAttribute('data-responsive-brand'),
        primaryHtml: template ? template.innerHTML : '',
        statusId: element.getAttribute('data-status-id') || '',
        authenticated: element.getAttribute('data-cloud-authenticated') === 'true',
        termsAccepted: element.getAttribute('data-cloud-terms-accepted') === 'true',
        returnTo: window.location.pathname + window.location.search,
      });
    });
  }

  exports.icons = icons;
  exports.capabilities = capabilities;
  exports.sdkDescription = sdkDescription;
  exports.capabilitiesHtml = capabilitiesHtml;
  exports.topRowHtml = topRowHtml;
  exports.sectionHtml = sectionHtml;
  exports.supportingSectionsHtml = supportingSectionsHtml;
  exports.sitePrimaryHtml = sitePrimaryHtml;
  exports.brandHtml = brandHtml;
  exports.footerInnerHtml = footerInnerHtml;
  exports.renderShell = renderShell;
  exports.setExpanded = setExpanded;
  exports.bindExpandableSections = bindExpandableSections;
  exports.bindMobileDrawer = bindMobileDrawer;
  exports.hydrate = hydrate;
})(typeof module !== 'undefined' && module.exports
  ? module.exports : (window.SDocsSidebarShared = {}));

if (typeof document !== 'undefined') window.SDocsSidebarShared.hydrate(document);
