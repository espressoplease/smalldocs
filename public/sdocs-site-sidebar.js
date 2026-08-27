(function () {
  'use strict';

  var body = document.body;
  if (!body || !body.hasAttribute('data-sdocs-site-page')) return;

  var page = body.getAttribute('data-sdocs-site-page');
  var params = new URLSearchParams(location.search);
  var active = page === 'cloud' || (page === 'library' && params.get('scope') === 'cloud')
    ? 'cloud' : 'local';
  var authenticated = body.getAttribute('data-cloud-authenticated') === 'true';
  var shared = window.SDocsSidebarShared;
  if (!shared) return;
  var icons = shared.icons;

  function section(id, icon, label, panel) {
    return '<div class="sdocs-site-sidebar-section" data-site-section="' + id + '">' +
      '<button class="sdocs-site-sidebar-row" type="button" aria-expanded="false">' + icon +
      '<span>' + label + '</span>' + icons.chevron + '</button>' +
      '<div class="sdocs-site-sidebar-expander"><div class="sdocs-site-sidebar-expander-inner">' +
      '<div class="sdocs-site-sidebar-panel">' + panel + '</div></div></div></div>';
  }

  var capabilities = '<div class="sdocs-site-sidebar-links" data-sdocs-shared-capabilities>' +
    shared.capabilitiesHtml('sdocs-site-sidebar-subitem') + '</div>';
  var sdk = '<p>' + shared.sdkDescription + '</p>' +
    '<span class="sdocs-site-sidebar-cta" aria-disabled="true">Coming soon</span>';

  var aside = document.createElement('aside');
  aside.className = 'sdocs-sidebar-shell sdocs-site-sidebar';
  aside.id = '_sd_site_sidebar';
  aside.setAttribute('aria-label', 'SmallDocs navigation');
  aside.innerHTML = '<a class="sdocs-sidebar-brand sdocs-site-sidebar-brand" href="/">SmallDocs</a>' +
    '<nav class="sdocs-site-sidebar-nav">' +
    '<a class="sdocs-site-sidebar-row sdocs-site-sidebar-local' + (active === 'local' ? ' is-active' : '') + '" href="/library">' + icons.local + '<span>Local library</span></a>' +
    '<a class="sdocs-site-sidebar-row' + (active === 'cloud' ? ' is-active' : '') + '" href="/library?scope=cloud">' + icons.cloud + '<span>Cloud library</span></a>' +
    section('capabilities', icons.capabilities, 'Capabilities', capabilities) +
    section('sdk', icons.sdk, 'SDK', sdk) +
    '</nav><footer class="sdocs-sidebar-footer">' + shared.footerInnerHtml({
      authenticated: authenticated,
      returnTo: location.pathname + location.search,
    }) + '</footer>';

  var mobile = document.createElement('div');
  mobile.className = 'sdocs-site-mobilebar';
  mobile.innerHTML = '<div class="sdocs-site-mobilebar-scroll"><a class="sdocs-site-mobilebar-brand" href="/">' +
    '<span class="sdocs-site-mobilebar-brand-full">SmallDocs</span>' +
    '<span class="sdocs-site-mobilebar-brand-short">SDocs</span>' +
    '<span class="sdocs-site-mobilebar-brand-tiny">SD</span></a></div>' +
    '<button class="sdocs-site-mobilebar-menu" type="button" aria-label="Open menu" aria-controls="_sd_site_sidebar" aria-expanded="false">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>';

  body.classList.add('sdocs-site-shell');
  body.prepend(mobile);
  body.prepend(aside);

  aside.addEventListener('click', function (event) {
    var button = event.target.closest('.sdocs-site-sidebar-section > .sdocs-site-sidebar-row');
    if (!button) return;
    var sectionElement = button.parentElement;
    var expanded = sectionElement.classList.toggle('is-expanded');
    button.setAttribute('aria-expanded', String(expanded));
  });

  var menu = mobile.querySelector('.sdocs-site-mobilebar-menu');
  function setMenu(open) {
    body.classList.toggle('sdocs-site-menu-open', open);
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (open) aside.querySelector('a, button').focus();
    else menu.focus();
  }
  menu.addEventListener('click', function () {
    setMenu(!body.classList.contains('sdocs-site-menu-open'));
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && body.classList.contains('sdocs-site-menu-open')) setMenu(false);
  });
  aside.addEventListener('click', function (event) {
    if (event.target.closest('a') && matchMedia('(max-width: 760px)').matches) setMenu(false);
  });
})();
