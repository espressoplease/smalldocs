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
    { label: 'Runnable HTML', href: '/runnable-html' },
    { label: 'Walkthroughs', href: '/docs#sec=document-walkthroughs' },
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
    attrs += ' data-rail-label="' + options.label + '"';
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
      sdkDescription + '</p><a class="sdocs-sidebar-cta" href="/developers">' +
      'Open SDK guide</a></div>';
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
      label: 'Renderer SDK',
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
      ? '<a class="sdocs-sidebar-footer-link sdocs-sidebar-account-link" href="/cloud/admin" data-rail-label="Account settings">' +
        icons.settings + '<span>Account settings</span></a>'
      : '<a class="sdocs-sidebar-footer-link sdocs-sidebar-account-link" href="/cloud/sign-in?return=' +
        encodeURIComponent(returnTo) + '" data-sdocs-sign-in-return data-rail-label="Sign in">' +
        icons.signIn + '<span>Sign in</span></a>';
    var legal = options.termsAccepted ? '' :
      '<div class="sdocs-sidebar-legal">You agree to our ' +
      '<a href="/legal" target="_blank" rel="noopener">Terms</a></div>';
    return status +
      account +
      '<a class="sdocs-sidebar-footer-link" href="/privacy" target="_blank" rel="noopener" data-rail-label="Private by design">' +
      icons.shield + '<span>Private by design</span></a>' +
      '<a class="sdocs-sidebar-footer-link" href="https://github.com/espressoplease/smalldocs" target="_blank" rel="noopener" data-rail-label="Source on GitHub">' +
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
    element.innerHTML = '<div class="sdocs-sidebar-main"><div class="sdocs-sidebar-header">' + brandHtml({
      id: options.brandId,
      responsive: options.responsiveBrand,
    }) + '<button class="sdocs-sidebar-collapse-toggle" type="button" aria-label="Collapse sidebar" aria-expanded="true">' +
      '<span class="sdocs-sidebar-rail-mark" aria-hidden="true">SD</span>' +
      '<svg class="sdocs-sidebar-collapse-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>' +
      '</button></div><nav class="sdocs-sidebar-nav' + (options.navClass ? ' ' + options.navClass : '') +
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
    Array.from(element.querySelectorAll('.sdocs-sidebar-top-row:not([data-rail-label])')).forEach(function (row) {
      var label = row.querySelector('span');
      if (label) row.setAttribute('data-rail-label', label.textContent.trim());
    });
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

    function focusWithoutScrolling(element) {
      if (!element) return;
      try {
        element.focus({ preventScroll: true });
      } catch (_) {
        element.focus();
      }
    }

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
          focusWithoutScrolling(first);
        });
      } else if (restoreFocus) {
        focusWithoutScrolling(button);
      }
    }

    button.addEventListener('click', function () {
      setOpen(!body.classList.contains(openClass), true);
    });
    // The mobile CSS backdrop is body::after, so a tap on the exposed area
    // arrives as a click on the body itself. Close through the same path as
    // the menu button and Escape, including focus restoration.
    body.addEventListener('click', function (event) {
      if (event.target !== body || !body.classList.contains(openClass)) return;
      if (!window.matchMedia('(max-width: ' + breakpoint + 'px)').matches) return;
      setOpen(false, true);
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
        focusWithoutScrolling(last);
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        focusWithoutScrolling(first);
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

  function bindDesktopRail(options) {
    options = options || {};
    var body = options.body || document.body;
    var sidebar = options.sidebar;
    if (!sidebar) return null;
    var toggle = sidebar.querySelector('.sdocs-sidebar-collapse-toggle');
    if (!toggle) return null;
    var compactBreakpoint = options.compactBreakpoint || 950;
    var mobileBreakpoint = options.mobileBreakpoint || 768;
    var manualState = null;

    function isMobile() {
      return window.matchMedia('(max-width: ' + mobileBreakpoint + 'px)').matches;
    }

    function isCompact() {
      return window.matchMedia('(max-width: ' + compactBreakpoint + 'px)').matches;
    }

    function setCollapsed(collapsed, restoreFocus) {
      collapsed = Boolean(collapsed) && !isMobile() && isCompact();
      if (collapsed) {
        Array.from(sidebar.querySelectorAll('.sdocs-sidebar-section.is-expanded')).forEach(function (section) {
          setExpanded(section, false);
        });
        Array.from(sidebar.querySelectorAll('.sdocs-sidebar-library-subsection.is-expanded')).forEach(function (section) {
          section.classList.remove('is-expanded');
          var trigger = section.querySelector(':scope > .sdocs-sidebar-library-toggle');
          if (trigger) trigger.setAttribute('aria-expanded', 'false');
        });
      }
      body.classList.toggle('sdocs-sidebar-collapsed', collapsed);
      sidebar.setAttribute('data-sidebar-collapsed', collapsed ? 'true' : 'false');
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      if (restoreFocus) toggle.focus();
    }

    function syncToViewport() {
      if (isMobile() || !isCompact()) {
        setCollapsed(false, false);
      } else if (manualState) {
        setCollapsed(manualState === 'collapsed', false);
      } else {
        setCollapsed(isCompact(), false);
      }
    }

    toggle.addEventListener('click', function () {
      if (isMobile() || !isCompact()) return;
      var shouldCollapse = !body.classList.contains('sdocs-sidebar-collapsed');
      manualState = shouldCollapse ? 'collapsed' : 'expanded';
      setCollapsed(shouldCollapse, true);
    });

    sidebar.addEventListener('click', function (event) {
      if (!body.classList.contains('sdocs-sidebar-collapsed')) return;
      if (event.target.closest('.sdocs-sidebar-collapse-toggle')) return;
      var interactive = event.target.closest('a, button');
      if (interactive && interactive.matches('a')) event.preventDefault();
      manualState = 'expanded';
      setCollapsed(false, false);
    });

    window.addEventListener('resize', syncToViewport);
    syncToViewport();
    return { setCollapsed: setCollapsed, syncToViewport: syncToViewport };
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
  exports.bindDesktopRail = bindDesktopRail;
  exports.hydrate = hydrate;
})(typeof module !== 'undefined' && module.exports
  ? module.exports : (window.SDocsSidebarShared = {}));

if (typeof document !== 'undefined') window.SDocsSidebarShared.hydrate(document);
