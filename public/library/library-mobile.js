(function () {
  'use strict';

  if (!window.matchMedia('(max-width: 700px)').matches) return;

  var params = new URLSearchParams(location.search);
  if (params.get('scope') === 'cloud') return;

  params.set('scope', 'cloud');
  var query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
})();
