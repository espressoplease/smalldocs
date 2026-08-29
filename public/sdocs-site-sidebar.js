(function () {
  'use strict';

  var body = document.body;
  if (!body || !body.hasAttribute('data-sdocs-site-page')) return;

  var page = body.getAttribute('data-sdocs-site-page');
  var params = new URLSearchParams(location.search);
  var active = page === 'settings' ? 'settings'
    : page === 'cloud' || (page === 'library' && params.get('scope') === 'cloud')
      ? 'cloud' : 'local';
  var authenticated = body.getAttribute('data-cloud-authenticated') === 'true';
  var termsAccepted = body.getAttribute('data-cloud-terms-accepted') === 'true';
  var shared = window.SDocsSidebarShared;
  if (!shared) return;

  var aside = document.createElement('aside');
  aside.className = 'sdocs-sidebar-shell sdocs-site-sidebar';
  aside.id = '_sd_site_sidebar';
  aside.setAttribute('aria-label', 'SmallDocs navigation');
  shared.renderShell(aside, {
    idPrefix: '_sd_site_sidebar',
    rowClass: 'sdocs-site-sidebar-row',
    navClass: 'sdocs-site-sidebar-nav',
    primaryHtml: shared.sitePrimaryHtml(active, 'sdocs-site-sidebar-row'),
    authenticated: authenticated,
    termsAccepted: termsAccepted,
    returnTo: location.pathname + location.search,
    active: active,
  });

  var mobile = document.createElement('div');
  mobile.className = 'sdocs-site-mobilebar';
  mobile.innerHTML = '<div class="sdocs-site-mobilebar-scroll"><a class="sdocs-site-mobilebar-brand" href="/">' +
    '<span class="sdocs-site-mobilebar-brand-full">SmallDocs</span>' +
    '<span class="sdocs-site-mobilebar-brand-short">SDocs</span>' +
    '<span class="sdocs-site-mobilebar-brand-tiny">SD</span></a></div>' +
    '<button class="sdocs-site-mobilebar-menu" type="button" aria-label="Open menu" aria-controls="_sd_site_sidebar" aria-expanded="false">' +
    '<svg class="sdocs-site-mobilebar-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>' +
    '<svg class="sdocs-site-mobilebar-close-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>';

  body.classList.add('sdocs-site-shell');
  body.prepend(mobile);
  body.prepend(aside);
  window.requestAnimationFrame(function () {
    window.requestAnimationFrame(function () {
      body.classList.add('sdocs-sidebar-ready');
    });
  });

  shared.bindExpandableSections(aside);
  shared.bindDesktopRail({
    body: body,
    sidebar: aside,
    compactBreakpoint: 950,
    mobileBreakpoint: 768,
  });

  var menu = mobile.querySelector('.sdocs-site-mobilebar-menu');
  var scrollHeader = window.SDocsScrollHeader;
  var mobileHeader = scrollHeader && scrollHeader.bind({
    header: mobile,
    breakpoint: 768,
    observeTarget: body,
    isPinned: function () {
      return body.classList.contains('sdocs-site-menu-open');
    },
  });
  shared.bindMobileDrawer({
    body: body,
    sidebar: aside,
    button: menu,
    openClass: 'sdocs-site-menu-open',
    openLabel: 'Open menu',
    closeLabel: 'Close menu',
    breakpoint: 768,
    backgrounds: Array.from(body.children).filter(function (element) {
      return element !== aside && element !== mobile;
    }),
  });

  if (menu && mobileHeader) {
    menu.addEventListener('click', function () {
      mobileHeader.pinFor(350);
    });
  }
})();
