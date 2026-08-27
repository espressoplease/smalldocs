(function () {
  'use strict';

  var body = document.body;
  if (!body || !body.hasAttribute('data-sdocs-site-page')) return;

  var page = body.getAttribute('data-sdocs-site-page');
  var params = new URLSearchParams(location.search);
  var active = page === 'cloud' || (page === 'library' && params.get('scope') === 'cloud')
    ? 'cloud' : 'local';
  var authenticated = body.getAttribute('data-cloud-authenticated') === 'true';

  var icons = {
    local: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5"/><path d="M8 19V7"/><path d="M12 19V4"/><path d="m16 5 4 14"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>',
    capabilities: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20"/><path d="m4.93 4.93 14.14 14.14"/><path d="M2 12h20"/><path d="m19.07 4.93-14.14 14.14"/></svg>',
    sdk: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9-3 3 3 3"/><path d="m16 9 3 3-3 3"/><path d="m14 5-4 14"/></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>',
    github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v12"/><path d="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M15 6a9 9 0 0 0-9 9"/><path d="M18 15v6"/><path d="M21 18h-6"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    chevron: '<svg class="sdocs-site-sidebar-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'
  };

  function section(id, icon, label, panel) {
    return '<div class="sdocs-site-sidebar-section" data-site-section="' + id + '">' +
      '<button class="sdocs-site-sidebar-row" type="button" aria-expanded="false">' + icon +
      '<span>' + label + '</span>' + icons.chevron + '</button>' +
      '<div class="sdocs-site-sidebar-expander"><div class="sdocs-site-sidebar-expander-inner">' +
      '<div class="sdocs-site-sidebar-panel">' + panel + '</div></div></div></div>';
  }

  var capabilities = '<div class="sdocs-site-sidebar-links">' +
    '<a class="sdocs-site-sidebar-subitem" href="/docs">Diagrams</a>' +
    '<a class="sdocs-site-sidebar-subitem" href="/docs">Slides</a>' +
    '<a class="sdocs-site-sidebar-subitem" href="/docs">Spreadsheets</a>' +
    '<a class="sdocs-site-sidebar-subitem" href="/docs">Formatting</a></div>';
  var sdk = '<p>Render agent-generated Markdown as rich, interactive documents inside your application with configurable styling.</p>' +
    '<span class="sdocs-site-sidebar-cta" aria-disabled="true">Coming soon</span>';
  var privacy = '<p>Local documents stay in your browser. Short links are encrypted before upload. Cloud documents use managed encryption and access controls.</p>' +
    '<a class="sdocs-site-sidebar-cta" href="/privacy" target="_blank" rel="noopener">Learn more</a>';

  var aside = document.createElement('aside');
  aside.className = 'sdocs-site-sidebar';
  aside.id = '_sd_site_sidebar';
  aside.setAttribute('aria-label', 'SmallDocs navigation');
  aside.innerHTML = '<a class="sdocs-site-sidebar-brand" href="/">SmallDocs</a>' +
    '<nav class="sdocs-site-sidebar-nav">' +
    '<a class="sdocs-site-sidebar-row sdocs-site-sidebar-local' + (active === 'local' ? ' is-active' : '') + '" href="/library">' + icons.local + '<span>Local library</span></a>' +
    '<a class="sdocs-site-sidebar-row' + (active === 'cloud' ? ' is-active' : '') + '" href="/library?scope=cloud">' + icons.cloud + '<span>Cloud library</span></a>' +
    section('capabilities', icons.capabilities, 'Capabilities', capabilities) +
    section('sdk', icons.sdk, 'SDK', sdk) +
    (authenticated ? '<a class="sdocs-site-sidebar-row sdocs-site-sidebar-account" href="/cloud/admin">' + icons.settings + '<span>Account settings</span></a>' : '') +
    '<div class="sdocs-site-sidebar-divider"></div>' +
    section('privacy', icons.shield, 'Private by design', privacy) +
    '<a class="sdocs-site-sidebar-row" href="https://github.com/espressoplease/smalldocs" target="_blank" rel="noopener">' + icons.github + '<span>Source on GitHub</span></a>' +
    '</nav><footer class="sdocs-site-sidebar-footer"><div class="sdocs-site-sidebar-footer-links">' +
    '<a href="/business">For business</a><span aria-hidden="true">·</span><a href="/legal">Terms</a>' +
    '</div></footer>';

  var mobile = document.createElement('div');
  mobile.className = 'sdocs-site-mobilebar';
  mobile.innerHTML = '<div class="sdocs-site-mobilebar-scroll"><a class="sdocs-site-mobilebar-brand" href="/">SmallDocs</a></div>' +
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
