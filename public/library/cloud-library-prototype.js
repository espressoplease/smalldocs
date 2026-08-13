(function () {
  const params = new URLSearchParams(location.search);
  if (params.get('cloud-demo') !== '1') return;

  const scope = params.get('scope') === 'cloud' ? 'cloud' : 'local';
  const nav = document.getElementById('cloud-library-nav');
  const actions = document.getElementById('cloud-library-actions');
  const heading = document.getElementById('cloud-library-heading');
  const localLink = document.getElementById('local-scope-link');
  const cloudLink = document.getElementById('cloud-scope-link');
  nav.hidden = false;
  localLink.classList.toggle('active', scope === 'local');
  cloudLink.classList.toggle('active', scope === 'cloud');
  if (scope === 'local') localLink.setAttribute('aria-current', 'page');
  if (scope === 'cloud') cloudLink.setAttribute('aria-current', 'page');

  if (scope !== 'cloud') return;

  actions.hidden = false;
  heading.hidden = false;

  const workspaceButton = document.getElementById('workspace-button');
  const workspaceMenu = document.getElementById('workspace-menu');
  workspaceButton.addEventListener('click', function () {
    const open = workspaceMenu.hidden;
    workspaceMenu.hidden = !open;
    workspaceButton.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', function (event) {
    if (!event.target.closest('.workspace-switcher')) {
      workspaceMenu.hidden = true;
      workspaceButton.setAttribute('aria-expanded', 'false');
    }
  });

})();
