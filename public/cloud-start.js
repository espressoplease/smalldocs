(function () {
  'use strict';
  var upgradePreview = null;
  var state, status = document.getElementById('start-status');
  function byId(id) { return document.getElementById(id); }
  async function api(path, options) {
    var response = await fetch('/api/cloud/v1' + path, options);
    if (response.status === 401) { location.assign('/cloud/sign-in?return=%2Fcloud%2Fstart'); throw new Error('Sign in to continue.'); }
    var data = await response.json();
    if (!response.ok) {
      var error = new Error(data.error === 'trial_already_used' ? 'This email has already used its trial.' : data.error === 'recent_auth_required' ? 'Sign in again to continue.' : 'This action could not be completed. Try again.');
      if (data.error === 'upgrade_preview_changed') error.message = 'Your library or billing changed. Review the upgrade again.';
      if (data.error === 'billing_update_required') error.message = 'Review your subscription in Billing before upgrading.';
      if (data.error === 'stripe_api_error') error.message = 'We could not confirm the billing change. Check Billing before trying again.';
      error.code = data.error; throw error;
    }
    return data;
  }
  function post(path, body) { return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  function showRequest(request) {
    var pending = request && request.status === 'pending';
    byId('request-pending').hidden = !pending;
    byId('team-request-form').hidden = true;
    if (pending) {
      byId('request-link').value = request.handoff_url;
      byId('request-expiry').textContent = 'Link expires ' + new Date(request.expires_at_ms).toLocaleDateString() + '.';
    }
  }
  byId('start-personal').addEventListener('click', async function () {
    var existing = state && state.workspaces.find(function (workspace) { return workspace.kind === 'personal' && workspace.role === 'owner'; });
    if (existing) { location.assign('/cloud/admin?panel=install&workspace_id=' + encodeURIComponent(existing.id)); return; }
    var button = this; button.disabled = true; status.textContent = 'Preparing your library...';
    try {
      var data = await post('/onboarding/personal', {});
      location.assign('/cloud/admin?panel=install&workspace_id=' + encodeURIComponent(data.workspace_id));
    } catch (error) { status.textContent = error.message; if (error.code === 'trial_already_used') byId('trial-used-help').hidden = false; button.disabled = false; }
  });
  byId('show-team-request').addEventListener('click', function () {
    if (state.request && state.request.status === 'pending') { byId('request-pending').scrollIntoView({ block: 'center' }); return; }
    byId('team-request-form').hidden = false;
    byId('request-note').focus();
  });
  byId('team-request-form').addEventListener('submit', async function (event) {
    event.preventDefault(); if (!this.reportValidity()) return;
    var button = this.querySelector('button'); button.disabled = true;
    try {
      var data = await post('/join-requests', { consented: byId('request-consent').checked, note: byId('request-note').value });
      state.request = data.request; showRequest(data.request); status.textContent = '';
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  byId('copy-request').addEventListener('click', async function () {
    try { await navigator.clipboard.writeText(byId('request-link').value); status.textContent = 'Request link copied'; }
    catch (_) { status.textContent = 'Select the link and copy it.'; }
  });
  byId('cancel-request').addEventListener('click', async function () {
    try { await api('/join-requests/' + encodeURIComponent(state.request.id), { method: 'DELETE' }); state.request = null; showRequest(null); status.textContent = 'Request cancelled.'; }
    catch (error) { status.textContent = error.message; }
  });
  function personalWorkspace() {
    var requested = new URLSearchParams(location.search).get('workspace_id');
    return state.workspaces.find(function (w) { return w.kind === 'personal' && w.role === 'owner' && (!requested || w.id === requested); });
  }
  byId('show-team-upgrade').addEventListener('click', function () {
    byId('team-upgrade-form').hidden = false;
    byId('team-name').focus();
  });
  byId('team-name').addEventListener('input', function () { upgradePreview = null; byId('upgrade-review').hidden = true; });
  function money(amount, currency) { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency }).format(amount / 100); }
  byId('team-upgrade-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var workspace = personalWorkspace();
    if (!workspace || !this.reportValidity()) return;
    byId('preview-upgrade').disabled = true; status.textContent = '';
    try {
      var result = await post('/team-upgrade/preview', { workspace_id: workspace.id, name: byId('team-name').value });
      if (result.completed) { location.assign('/cloud/admin?panel=people&workspace_id=' + encodeURIComponent(result.workspace_id)); return; }
      upgradePreview = result.preview;
      byId('upgrade-access').textContent = upgradePreview.document_count + ' documents will keep their current access settings. ' + upgradePreview.everyone_count + ' are shared with everyone in your team, including future members. Those members can edit these documents.';
      byId('upgrade-billing').textContent = upgradePreview.billing_kind === 'stripe'
        ? 'Team pricing replaces your personal plan: ' + money(upgradePreview.unit_amount, upgradePreview.currency) + ' per member per month, including you. Estimated amount due now: ' + money(upgradePreview.amount_due, upgradePreview.currency) + '. Your billing date stays the same.'
        : upgradePreview.billing_kind === 'manual' ? 'Your existing provisioned access will become team access.'
        : upgradePreview.requires_subscription ? 'Your free month has ended. After conversion, subscribe to the team plan to continue saving and invite members. No payment is taken by this step.'
        : 'Your team is free until ' + new Date(upgradePreview.trial_ends_at_ms).toLocaleDateString() + ', the original trial deadline. No payment is taken now. After the trial, subscribe to continue saving and inviting members.';
      if (upgradePreview.billing_kind === 'trial' && !upgradePreview.requires_subscription) {
        var limits = upgradePreview.team_limits;
        byId('upgrade-billing').textContent += ' Team trial limits: ' + new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(limits.maxStoredBytes / (1024 * 1024 * 1024)) + ' GB storage' + (limits.maxMembers == null ? ', no configured member cap.' : ', up to ' + limits.maxMembers + ' members.');
      }
      byId('upgrade-cancellation').textContent = upgradePreview.cancel_at_period_end ? 'Your scheduled cancellation remains in place.' : '';
      byId('confirm-upgrade').textContent = result.processing ? 'Resume team upgrade' : upgradePreview.billing_kind === 'stripe' ? 'Confirm upgrade and billing change' : 'Create team';
      byId('upgrade-review').hidden = false;
    } catch (error) { status.textContent = error.message; }
    finally { byId('preview-upgrade').disabled = false; }
  });
  byId('confirm-upgrade').addEventListener('click', async function () {
    if (!upgradePreview) return;
    this.disabled = true; status.textContent = 'Updating your library...';
    try {
      var result = await post('/team-upgrade/confirm', { workspace_id: upgradePreview.workspace_id, operation_id: upgradePreview.operation_id });
      location.assign('/cloud/admin?panel=' + (result.requires_subscription ? 'billing' : 'people') + '&workspace_id=' + encodeURIComponent(result.workspace_id));
    } catch (error) { status.textContent = error.message; this.disabled = false; }
  });
  api('/onboarding').then(async function (data) {
    state = data;
    if (!data.user.first_name || !data.user.last_name) { location.assign('/cloud/profile'); return; }
    byId('start-identity').textContent = [data.user.first_name, data.user.last_name].join(' ') + ' · ' + data.user.email;
    if (new URLSearchParams(location.search).get('choose') !== '1' || !data.workspaces.length) {
      var completed = await post('/onboarding/complete', {});
      data.workspaces = completed.workspaces;
    }
    if (new URLSearchParams(location.search).get('choose') !== '1') {
      var selected = window.SDocsCloudAccountSelection.resolve(data.workspaces, new URLSearchParams(location.search).get('workspace_id'), localStorage);
      if (selected) { location.assign('/cloud/admin?panel=install&workspace_id=' + encodeURIComponent(selected.id)); return; }
    }
    byId('show-team-upgrade').hidden = !personalWorkspace();
    byId('start-personal').hidden = !personalWorkspace();
    byId('personal-copy').hidden = !personalWorkspace();
    if (data.workspaces.some(function (workspace) { return workspace.kind === 'personal' && workspace.role === 'owner'; })) {
      byId('start-personal').textContent = 'Open my library';
      byId('personal-copy').textContent = 'Open your existing personal library. Its current subscription or trial is unchanged.';
    }
    byId('existing-libraries').hidden = !data.workspaces.length;
    data.workspaces.forEach(function (workspace) {
      var link = document.createElement('a'); link.className = 'provider-button provider-link';
      link.textContent = workspace.name; link.href = '/cloud/admin?panel=install&workspace_id=' + encodeURIComponent(workspace.id);
      byId('library-choices').appendChild(link);
    });
    byId('show-team-request').hidden = !data.company_domain;
    byId('shared-email-help').hidden = Boolean(data.company_domain);
    if (data.company_domain) {
      var heading = 'Request to join a team at ' + data.company_domain;
      byId('show-team-request').textContent = heading;
      byId('request-heading').textContent = heading;
      byId('request-consent-copy').textContent = 'I agree to share my name, verified email and note with team admins at ' + data.company_domain + ' who receive and open my request link.';
    }
    showRequest(data.request);
  }).catch(function (error) { status.textContent = error.message; if (error.code === 'trial_already_used') byId('trial-used-help').hidden = false; });
})();
