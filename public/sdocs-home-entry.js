(function () {
  'use strict';

  var script = document.currentScript;
  function redirect(path) {
    window.__sdocsHomeRedirecting = true;
    document.documentElement.style.visibility = 'hidden';
    location.replace(path);
  }
  // Fragment documents predate /docs and take precedence over home routing.
  if (location.hash && location.hash.indexOf('=') !== -1) {
    redirect('/docs' + location.hash);
    return;
  }
  // Explicit marketing pages and section links remain available when signed in.
  if (location.pathname !== '/' || location.hash) return;

  var cloudAuthenticated = script.dataset.cloudAuthenticated === 'true';
  var localConnected = false;
  if (script.dataset.localLibrary === 'true') {
    try {
      var localState = JSON.parse(localStorage.getItem('sdocs.connect') || 'null');
      localConnected = Boolean(localState && localState.connected === true);
    } catch (_) {}
  }
  if (cloudAuthenticated || localConnected) {
    redirect(cloudAuthenticated ? '/library?scope=cloud' : '/library');
  }
})();
