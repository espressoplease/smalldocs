(function () {
  'use strict';
  var root = document.getElementById('install-methods');
  var setup = window.SDocCliSetup;
  root.innerHTML = setup.cloudInstallMarkup({ origin: root.dataset.cloudOrigin,
    workspaceId: root.dataset.libraryId, workspaceName: root.dataset.libraryName,
    windows: setup.isWindows(), accountPage: true, onboarding: true });
  setup.bindInstallCopy(root);
})();
