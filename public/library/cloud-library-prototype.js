(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const scope = params.get('scope') === 'cloud' ? 'cloud' : 'local';
  const nav = document.getElementById('cloud-library-nav');
  const actions = document.getElementById('cloud-library-actions');
  const heading = document.getElementById('cloud-library-heading');
  const localLink = document.getElementById('local-scope-link');
  const cloudLink = document.getElementById('cloud-scope-link');
  var header;
  var selectionEpoch = 0;
  const onboarding = document.getElementById('cloud-onboarding');

  window.SDocsCloudLibrary = window.SDocsCloudLibrary || {};
  nav.hidden = false;
  localLink.href = '/library';
  cloudLink.href = '/library?scope=cloud';
  localLink.classList.toggle('active', scope === 'local');
  cloudLink.classList.toggle('active', scope === 'cloud');
  if (scope === 'local') localLink.setAttribute('aria-current', 'page');
  if (scope === 'cloud') cloudLink.setAttribute('aria-current', 'page');
  if (scope !== 'cloud') return;
  document.body.classList.add('cloud-library-loading');

  function showOnboarding(signedOut) {
    document.body.classList.remove('cloud-library-loading');
    document.body.classList.add('cloud-library-onboarding');
    if (onboarding) onboarding.hidden = false;
    var signIn = onboarding && onboarding.querySelector('[data-cloud-sign-in]');
    if (signIn) signIn.hidden = !signedOut;
  }

  function showLibrary() {
    document.body.classList.remove('cloud-library-loading', 'cloud-library-onboarding');
    if (onboarding) onboarding.hidden = true;
  }

  if (document.body.dataset.cloudAuthenticated !== 'true') {
    showOnboarding(true);
    return;
  }

  heading.hidden = false;

  async function selectWorkspace(workspace, user) {
    var accountName = window.SDocsCloudAccountSelection.label(workspace, user);
    window.SDocsCloudAccountSelection.remember(localStorage, workspace.id);
    window.SDocsCloudLibrary.workspaceId = workspace.id;
    window.SDocsCloudLibrary.workspaceName = accountName;
    document.getElementById('personal-library-note').hidden = workspace.kind !== 'personal';
    header.render(workspace);
    var epoch = ++selectionEpoch;
    const accountResponse = await fetch('/api/cloud/v1/account?account_id=' +
      encodeURIComponent(workspace.id), { credentials: 'same-origin' });
    if (epoch !== selectionEpoch) return;
    if (accountResponse.status === 401) {
      location.href = '/cloud/sign-in?return=' + encodeURIComponent(location.pathname + location.search);
      return;
    }
    if (!accountResponse.ok) throw new Error('Cloud account unavailable');
    const account = (await accountResponse.json()).account || {};
    if (!account.can_read) {
      showOnboarding(false);
      return;
    }
    showLibrary();
    window.dispatchEvent(new CustomEvent('sdocs-cloud-workspace-change'));
  }

  function showUnavailable() {
    document.body.classList.remove('cloud-library-loading');
    const note = heading.querySelector('.cloud-access-note');
    if (note) note.textContent = 'Cloud is temporarily unavailable';
  }

  Promise.all([
    fetch('/api/cloud/v1/workspaces', { credentials: 'same-origin' }),
    fetch('/api/cloud/v1/me', { credentials: 'same-origin' }),
  ]).then(async function (responses) {
    if (responses.some(function (response) { return response.status === 401; })) {
      location.href = '/cloud/sign-in?return=' + encodeURIComponent(location.pathname + location.search);
      return;
    }
    if (responses.some(function (response) { return !response.ok; })) throw new Error('Cloud unavailable');
    const workspaces = (await responses[0].json()).workspaces || [];
    const account = await responses[1].json();
    const me = account.user || {};
    window.SDocsCloudLibrary.workspaces = workspaces;
    window.SDocsCloudLibrary.user = me;
    actions.hidden = workspaces.length === 0;
    const note = heading.querySelector('.cloud-access-note');
    if (note) note.textContent = me.email ? 'Signed in as ' + me.email : 'Signed in';
    if (!workspaces.length) {
      if (account.single_plan) { location.assign('/cloud/start'); return; }
      if (note) note.textContent = 'Choose a Cloud plan to add documents';
      showOnboarding(false);
      return;
    }
    header = window.SDocsLibraryHeader.bind({ root: document.getElementById('library-header'), workspaces: workspaces, user: me,
      onSelect: function (workspace) { selectWorkspace(workspace, me).catch(showUnavailable); } });
    var selectedWorkspace = window.SDocsCloudAccountSelection.resolve(
      workspaces, params.get('workspace'), localStorage);
    if (selectedWorkspace) {
      selectWorkspace(selectedWorkspace, me).catch(showUnavailable);
    } else {
      if (note) note.textContent = 'Choose a library to view its documents';
    }
  }).catch(showUnavailable);
})();
