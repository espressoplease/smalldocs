(function () {
  'use strict';

  var EMPTY_INVITE_POLICY = { domains: [], can_manage: false, can_invite: false };
  var state = {
    me: null,
    workspaces: [],
    workspace: null,
    members: [],
    invitations: [],
    invitePolicy: EMPTY_INVITE_POLICY,
    documents: [],
    credentials: [],
    deletedWorkspaces: [],
    deletedDocuments: [],
    billing: null,
    pendingAction: null,
  };

  function byId(id) { return document.getElementById(id); }
  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }
  function apiPath(path) { return '/api/cloud/v1' + path; }

  async function request(path, options) {
    var response = await fetch(apiPath(path), Object.assign({ credentials: 'same-origin' }, options || {}));
    var data = null;
    try { data = await response.json(); } catch (_) {}
    if (response.status === 401 && (!data || data.error !== 'recent_auth_required')) {
      location.href = '/cloud/sign-in?return=' + encodeURIComponent(location.pathname + location.search);
      throw new Error('login_required');
    }
    if (data && data.error === 'recent_auth_required') {
      var box = byId('page-error');
      box.replaceChildren(document.createTextNode('Sign in again to continue. Your changes are still on this page. '));
      var link = element('a', '', 'Sign in');
      link.href = '/cloud/sign-in?return=' + encodeURIComponent(location.pathname + location.search);
      link.target = '_blank'; link.rel = 'noopener'; box.appendChild(link); box.classList.add('visible');
    }
    if (!response.ok) {
      var error = new Error(data && data.error ? data.error : 'request_failed');
      error.code = data && data.error;
      throw error;
    }
    return data || {};
  }

  function mutation(method, path, body) {
    var options = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body != null) options.body = JSON.stringify(body);
    return request(path, options);
  }

  async function requestWithoutSubscription(path, fallback) {
    try {
      return await request(path);
    } catch (error) {
      if (['subscription_required', 'trial_payment_required'].includes(error.code)) return fallback;
      throw error;
    }
  }

  function humanError(error) {
    var messages = {
      recent_auth_required: 'Sign in again using the link above, then retry this action.',
      permission_denied: 'Your account role does not allow this action.',
      resource_unavailable: 'This item is no longer available.',
      active_subscription_requires_cancellation: 'Cancel the team subscription in Billing before deleting it.',
      final_owner_required: 'Add another admin before removing the final admin.',
      personal_workspace_cannot_be_deleted: 'This account cannot be deleted here.',
      personal_library_private: 'Your Personal library is private. Create a team library to invite people.',
      public_email_domain: 'Use a company domain rather than a public email provider.',
      email_delivery_unavailable: 'The invitation email was not sent. Try again.',
      subscription_required: 'Subscribe to Cloud before inviting people.',
      invalid_request: 'Check the submitted details and try again.',
      temporary_service_failure: 'Cloud is temporarily unavailable.',
    };
    return messages[error && error.code] || 'Cloud is temporarily unavailable. Try again.';
  }

  function showError(error) {
    var box = byId('page-error');
    box.textContent = humanError(error);
    box.classList.add('visible');
  }
  function clearError() {
    byId('page-error').classList.remove('visible');
    byId('page-error').textContent = '';
  }
  function initials(email) {
    var local = String(email || '?').split('@')[0];
    var parts = local.split(/[._\s-]+/).filter(Boolean);
    return parts.slice(0, 2).map(function (part) { return part.charAt(0).toUpperCase(); }).join('') || '?';
  }
  function displayIdentity(member) {
    return member.name || member.email || 'User ' + String(member.user_id || '').slice(0, 8);
  }
  function formatRole(role) { return role === 'owner' || role === 'admin' ? 'Admin' : 'Member'; }
  function formatStatus(status) {
    if (!status) return 'Active';
    return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  }
  function formatDate(value) {
    var date = typeof value === 'number' ? new Date(value) : new Date(String(value || ''));
    if (!Number.isFinite(date.getTime())) return 'Not recorded';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
  }
  function formatDateTime(value) {
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Not recorded';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
  function setCount(id, value) { byId(id).textContent = String(value); }
  function isTeam() { return Boolean(state.workspace && state.workspace.kind === 'team'); }

  function libraryMark(workspace) {
    var mark = element('span', 'account-switcher-mark');
    mark.innerHTML = window.SDocsCloudAccountSelection.icon(workspace && workspace.kind);
    if (workspace) mark.style.color = window.SDocsCloudAccountSelection.color(workspace.id);
    return mark;
  }

  function accountName(workspace) {
    return window.SDocsCloudAccountSelection.label(workspace, state.me);
  }

  function renderAccountSwitcher() {
    var menu = byId('account-switcher-menu');
    menu.replaceChildren();
    window.SDocsCloudAccountSelection.orderedLibraries(state.workspaces).forEach(function (workspace) {
      var button = element('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.append(libraryMark(workspace), element('strong', '', accountName(workspace)));
      if (state.workspace && state.workspace.id === workspace.id) {
        var check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        check.setAttribute('viewBox', '0 0 24 24');
        var path = document.createElementNS(check.namespaceURI, 'path');
        path.setAttribute('d', 'm20 6-11 11-5-5');
        check.appendChild(path);
        button.appendChild(check);
      }
      button.addEventListener('click', function () {
        window.SDocsCloudAccountSelection.remember(localStorage, workspace.id);
        menu.hidden = true;
        byId('account-switcher-button').setAttribute('aria-expanded', 'false');
        loadWorkspace(workspace.id).catch(showError);
      });
      menu.appendChild(button);
    });
    byId('account-switcher').hidden = state.workspaces.length === 0;
    byId('account-switcher-button').disabled = false;
    var name = state.workspace ? accountName(state.workspace) : 'Choose library';
    byId('account-switcher-name').textContent = name;
    byId('account-switcher-mark').style.color = state.workspace ? window.SDocsCloudAccountSelection.color(state.workspace.id) : '';
    byId('account-switcher-mark').innerHTML = window.SDocsCloudAccountSelection.icon(state.workspace && state.workspace.kind);
  }

  function renderMembers() {
    var rows = byId('member-rows');
    rows.replaceChildren();
    var activeMembers = state.members.filter(function (member) { return member.status !== 'disabled'; });
    byId('members-empty').hidden = activeMembers.length + state.invitations.length > 0;
    activeMembers.forEach(function (member) {
      var row = document.createElement('tr');
      var personCell = document.createElement('td');
      var person = element('div', 'person');
      var identity = document.createElement('div');
      identity.className = 'person-copy';
      var identityLabel = displayIdentity(member);
      var isSelf = state.me && member.user_id === state.me.id;
      var memberDetail = member.email || 'Team member';
      if (isSelf) memberDetail += ' - You';
      identity.append(element('strong', '', identityLabel), element('span', '', memberDetail));
      person.append(element('span', 'avatar', member.initials || initials(member.email)), identity);
      personCell.appendChild(person);
      var roleCell = element('td', '', formatRole(member.role));
      var statusCell = document.createElement('td');
      statusCell.appendChild(element('span', 'status', formatStatus(member.status)));
      var actionCell = document.createElement('td');
      var canAdminister = state.workspace.role === 'owner' || state.workspace.role === 'admin';
      if (canAdminister && !isSelf && member.role === 'member') {
        var remove = element('button', 'btn small danger', 'Remove');
        remove.type = 'button';
        remove.addEventListener('click', function () {
          ask('Remove ' + identityLabel + '?', 'They will lose access to this team immediately.', async function () {
            await mutation('DELETE', '/workspaces/' + encodeURIComponent(state.workspace.id)
              + '/members/' + encodeURIComponent(member.user_id));
            await loadWorkspace(state.workspace.id);
          });
        });
        actionCell.appendChild(remove);
      }
      row.append(personCell, roleCell, statusCell, actionCell);
      rows.appendChild(row);
    });
    state.invitations.forEach(function (invitation) {
      var row = document.createElement('tr');
      var personCell = document.createElement('td');
      var person = element('div', 'person');
      var identity = document.createElement('div');
      identity.className = 'person-copy';
      identity.append(element('strong', '', invitation.email), element('span', '', 'Invitation'));
      person.append(element('span', 'avatar', initials(invitation.email)), identity);
      personCell.appendChild(person);
      var statusCell = document.createElement('td');
      statusCell.appendChild(element('span', 'status pending', 'Pending until ' + formatDate(invitation.expires_at)));
      var actionCell = document.createElement('td');
      var revoke = element('button', 'btn small danger', 'Revoke');
      revoke.type = 'button';
      revoke.addEventListener('click', function () {
        ask('Revoke invitation for ' + invitation.email + '?',
          'The invitation link will stop working immediately.', async function () {
            await mutation('DELETE', '/account/invitations/' + encodeURIComponent(invitation.id), {
              account_id: state.workspace.id,
            });
            await loadWorkspace(state.workspace.id);
          }, 'Revoke invitation');
      });
      actionCell.appendChild(revoke);
      row.append(personCell, element('td', '', 'Member'), statusCell, actionCell);
      rows.appendChild(row);
    });
  }

  function activeCredentials() {
    return state.credentials.filter(function (credential) { return credential.revokedAtMs == null; });
  }

  function renderCredentials() {
    var rows = byId('credential-rows');
    var credentials = activeCredentials();
    rows.replaceChildren();
    byId('credentials-empty').hidden = credentials.length > 0;
    credentials.forEach(function (credential) {
      var row = element('div', 'machine-row');
      var name = element('strong', 'machine-name', credential.displayName || 'SmallDocs CLI');
      var details = document.createElement('div');
      details.append(name,
        element('p', '', 'Connected ' + formatDateTime(credential.createdAtMs)),
        element('p', '', 'Last authenticated ' + (credential.lastUsedAtMs == null ? 'not yet'
          : formatDateTime(credential.lastUsedAtMs))));
      var revoke = element('button', 'btn small danger', 'Revoke');
      revoke.type = 'button';
      revoke.setAttribute('aria-label', 'Revoke ' + name.textContent);
      revoke.addEventListener('click', function () {
        ask('Revoke ' + name.textContent + '?',
          'This machine will lose Cloud access immediately. Your other machines are not affected.',
          async function () {
            await mutation('DELETE', '/cli/credentials/' + encodeURIComponent(credential.id), {});
            await loadCredentials();
          }, 'Revoke machine');
      });
      row.append(details, revoke);
      rows.appendChild(row);
    });
  }

  function renderRecovery() {
    var recovery = byId('recovery-list');
    recovery.replaceChildren();
    state.deletedWorkspaces.forEach(function (workspace) {
      var row = element('div', 'recovery-row');
      var details = document.createElement('div');
      details.append(element('strong', '', workspace.name),
        element('p', '', 'Team available until ' + formatDateTime(workspace.purge_after)));
      var restore = element('button', 'btn small', 'Restore');
      restore.type = 'button';
      restore.addEventListener('click', async function () {
        restore.disabled = true;
        try {
          await mutation('POST', '/workspaces/' + encodeURIComponent(workspace.id) + '/restore', {});
          await loadDeletedItems();
        } catch (error) {
          restore.disabled = false;
          showError(error);
        }
      });
      row.append(details, restore);
      recovery.appendChild(row);
    });
    state.deletedDocuments.forEach(function (documentItem) {
      var row = element('div', 'recovery-row');
      var details = document.createElement('div');
      details.append(element('strong', '', documentItem.title || documentItem.filename),
        element('p', '', 'Available until ' + formatDateTime(documentItem.purge_after)));
      var restore = element('button', 'btn small', 'Restore');
      restore.type = 'button';
      restore.addEventListener('click', async function () {
        restore.disabled = true;
        try {
          await mutation('POST', '/documents/' + encodeURIComponent(documentItem.id) + '/restore', {
            expected_head_revision_id: documentItem.current_revision_id,
          });
          await loadDeletedItems();
          await loadWorkspace(state.workspace.id);
        } catch (error) {
          restore.disabled = false;
          showError(error);
        }
      });
      row.append(details, restore);
      recovery.appendChild(row);
    });
    byId('recovery-section').hidden = recovery.children.length === 0;
  }

  async function saveInviteDomains(domains) {
    var data = await mutation('PATCH', '/account/invite-policy', {
      account_id: state.workspace.id,
      domains: domains,
    });
    state.invitePolicy = data.policy || EMPTY_INVITE_POLICY;
    renderInvitePolicy();
  }

  function renderInvitePolicy() {
    var domains = state.invitePolicy.domains || [];
    var list = byId('domain-list');
    var status = byId('domain-status');
    list.replaceChildren();
    status.textContent = domains.length
      ? 'Members can invite people whose email ends with an allowed domain.'
      : 'Members cannot send invitations until a company domain is allowed.';
    domains.forEach(function (domain) {
      var pill = element('span', 'domain-pill');
      pill.appendChild(document.createTextNode('@' + domain));
      var remove = element('button', '', '\u00d7');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove ' + domain);
      remove.addEventListener('click', async function () {
        remove.disabled = true;
        try {
          await saveInviteDomains(domains.filter(function (item) { return item !== domain; }));
        } catch (error) {
          status.textContent = humanError(error);
          remove.disabled = false;
        }
      });
      pill.appendChild(remove);
      list.appendChild(pill);
    });
  }

  function renderBilling() {
    var billing = state.billing;
    var plan = billing && billing.plan;
    byId('billing-plan').textContent = plan ? 'Cloud subscription' : 'No active subscription';
    byId('billing-status').textContent = plan
      ? 'Status: ' + String(billing.effectiveStatus || billing.subscriptionStatus).replace(/_/g, ' ')
      : 'Subscribe before storing or searching Cloud documents.';
    if (billing && billing.trialEndsAtMs) {
      byId('billing-plan').textContent = (isTeam() ? 'Team library' : 'Personal library') + ' trial';
      if (billing.effectiveStatus === 'trial') {
        byId('subscribe-link').textContent = 'Subscribe now';
        byId('subscribe-row').querySelector('p').textContent = 'Subscribing now starts a paid subscription immediately. Otherwise your trial continues until its end date.';
      }
      byId('billing-status').textContent = (billing.effectiveStatus === 'trial' ? 'Free until ' : 'Trial ended ') + formatDateTime(billing.trialEndsAtMs) + '. Subscribe to continue saving after the trial.';
    }
    byId('billing-price').textContent = plan === 'team' ? '\u00a37 / person / month'
      : plan === 'personal' ? '\u00a34 / month' : '';
    var usage = billing && billing.usage;
    if (!usage) byId('billing-usage').textContent = 'No paid Cloud usage is available.';
    else if (isTeam()) byId('billing-usage').textContent = usage.memberCount
      + (usage.memberCount === 1 ? ' person, ' : ' people, ') + usage.storedBytes + ' stored bytes';
    else byId('billing-usage').textContent = usage.storedBytes + ' stored bytes';
    var hasSubscription = Boolean(plan) && !billing.trialEndsAtMs;
    var canManageBilling = state.workspace && state.workspace.role === 'owner';
    byId('manage-billing').hidden = !hasSubscription || !canManageBilling ||
      !billing.canManagePayment;
    byId('subscribe-row').hidden = hasSubscription || !canManageBilling;
    byId('install-team-link').href = '/cloud/start?choose=1' + (state.workspace ? '&workspace_id=' + encodeURIComponent(state.workspace.id) : '');
    byId('subscribe-link').href = state.singlePlan ? '/cloud/subscribe' : '/cloud/checkout?plan=' + (isTeam() ? 'team' : 'personal');
    if (state.singlePlan) {
      byId('billing-plan').textContent = 'SmallDocs, all features';
      byId('billing-price').textContent = window.SDocsCloudPricing.primaryAmount('standard', window.SDocsCloudPricing.currentCurrency()) + ' / person / month';
      if (billing && billing.legacy_price) byId('billing-price').textContent = 'Your existing subscription rate is unchanged. View your current price in Stripe.';
      if (billing && !billing.trialEndsAtMs) byId('billing-status').textContent = billing.covered ? 'Your subscription is covered.' : 'Subscribe, or ask a library administrator to cover your subscription.';
      if (billing && billing.effectiveStatus === 'past_due_grace') byId('billing-status').textContent = 'Payment needs attention. You can keep saving until ' + formatDateTime(billing.graceEndsAtMs) + '. Update your payment details in Billing.';
      if (billing && ['past_due', 'read_only'].includes(billing.effectiveStatus)) byId('billing-status').textContent = 'Your subscription is read-only. You can open and export documents. Update Billing to save changes.';
      if (billing && billing.effectiveStatus === 'canceled') byId('billing-status').textContent = 'Your subscription has ended. You can open and export your documents. Subscribe again to save changes.';
      if (billing && billing.effectiveStatus === 'trial') byId('billing-status').textContent = 'Free until ' + formatDateTime(billing.trialEndsAtMs) + '. Cloud access continues for seven more days after the trial ends.';
      if (billing && billing.effectiveStatus === 'trial_warning') byId('billing-status').textContent = 'Your trial has ended. Subscribe by ' + formatDateTime(billing.trialPaywallAtMs) + ' to keep using SmallDocs.';
      if (billing && billing.effectiveStatus === 'payment_required') byId('billing-status').textContent = 'Your free trial and extra week have ended. Subscribe to continue using SmallDocs.';
      byId('billing-usage').textContent = billing && billing.sponsored_seats ? 'Your billing account covers ' + billing.sponsored_seats + ' people across your libraries.' : 'One paid subscription per person, across libraries.';
      byId('subscribe-row').hidden = Boolean(billing && billing.covered && !billing.trialEndsAtMs);
      byId('manage-billing').hidden = !(billing && billing.canManagePayment);
      byId('install-team-link').textContent = 'Manage libraries';
      byId('install-team-link').href = '/cloud/admin?panel=libraries';
    }
  }

  function activatePanel(name, updateLocation) {
    Array.from(document.querySelectorAll('.nav')).forEach(function (button) {
      button.classList.toggle('active', button.dataset.panel === name);
    });
    Array.from(document.querySelectorAll('.panel')).forEach(function (panel) {
      panel.hidden = panel.id !== 'panel-' + name;
    });
    if (name === 'machines') loadCredentials().catch(showError);
    if (updateLocation !== false) {
      var url = new URL(location.href);
      if (name === 'overview') url.searchParams.delete('panel');
      else url.searchParams.set('panel', name);
      history.replaceState(null, '', url.pathname + url.search);
    }
  }

  function renderPermissions() {
    var team = isTeam();
    var teamActive = Boolean(state.billing && state.billing.plan);
    var canChooseInviteRole = team && state.workspace &&
      (state.workspace.role === 'owner' || state.workspace.role === 'admin');
    document.querySelector('[data-panel="people"]').hidden = !team;
    byId('people-stat').hidden = !team;
    byId('invite-open').hidden = !team || !teamActive || !state.invitePolicy.can_invite;
    byId('invite-role-choice').hidden = !canChooseInviteRole;
    if (!canChooseInviteRole) byId('invite-role-member').checked = true;
    updateInviteRoleCopy();
    byId('domain-form').hidden = !team || !teamActive || !state.invitePolicy.can_manage;
    byId('workspace-lifecycle').hidden = !team || state.workspace.role !== 'owner';
    if (!team && !byId('panel-people').hidden) activatePanel('overview');
  }

  function renderAll() {
    if (!state.workspace) return;
    var team = isTeam();
    byId('overview-name').textContent = 'Overview';
    byId('overview-description').textContent = team
      ? 'Documents, people, and billing.' : 'Your Cloud documents and billing.';
    byId('account-label').textContent = state.me && state.me.email
      ? [state.me.first_name, state.me.last_name].filter(Boolean).join(' ') + ' · ' + state.me.email : 'Signed in';
    setCount('member-count', state.members.filter(function (member) { return member.status !== 'disabled'; }).length);
    setCount('document-count', state.documents.length);
    renderAccountSwitcher();
    if (team) {
      renderMembers();
      renderInvitePolicy();
    }
    renderCredentials();
    renderRecovery();
    renderBilling();
    renderPermissions();
  }

  async function loadWorkspace(workspaceId) {
    clearError();
    var workspace = state.workspaces.find(function (item) { return item.id === workspaceId; });
    if (!workspace && state.workspaces.length === 1) workspace = state.workspaces[0];
    if (!workspace) throw new Error('resource_unavailable');
    state.workspace = workspace;
    byId('install-library-link').href = '/library?scope=cloud&workspace=' + encodeURIComponent(workspace.id);
    byId('install-destination-note').textContent = 'To save new documents to ' + accountName(workspace) + ', use --account ' + workspace.id + '.';
    renderInstall(workspace.id);
    window.SDocsCloudAccountSelection.remember(localStorage, workspace.id);
    var encoded = encodeURIComponent(workspace.id);
    var team = workspace.kind === 'team';
    var canAdminister = workspace.role === 'owner' || workspace.role === 'admin';
    var responses = await Promise.all([
      team ? request('/account/members?account_id=' + encoded) : Promise.resolve({ members: [] }),
      team && canAdminister
        ? requestWithoutSubscription('/account/invitations?account_id=' + encoded, { invitations: [] })
        : Promise.resolve({ invitations: [] }),
      requestAllDocuments(encoded),
      request('/workspaces/' + encoded + '/billing'),
      team ? request('/account/invite-policy?account_id=' + encoded)
        : Promise.resolve({ policy: EMPTY_INVITE_POLICY }),
    ]);
    state.members = responses[0].members || [];
    state.invitations = responses[1].invitations || [];
    state.documents = responses[2];
    state.billing = responses[3].billing || null;
    state.invitePolicy = responses[4].policy || EMPTY_INVITE_POLICY;
    var url = new URL(location.href);
    url.searchParams.set('workspace_id', workspace.id);
    history.replaceState(null, '', url.pathname + url.search);
    renderAll();
  }
  async function requestAllDocuments(encodedWorkspaceId) {
    var documents = [];
    var cursor = null;
    do {
      var query = '/documents?workspace_id=' + encodedWorkspaceId + '&limit=100';
      if (cursor) query += '&cursor=' + encodeURIComponent(cursor);
      var page = await requestWithoutSubscription(query, { documents: [], next_cursor: null });
      documents = documents.concat(page.documents || []);
      cursor = page.next_cursor || null;
    } while (cursor);
    return documents;
  }

  async function loadCredentials() {
    var response = await request('/cli/credentials');
    state.credentials = response.credentials || [];
    renderCredentials();
  }

  async function loadDeletedItems() {
    var responses = await Promise.all([request('/workspaces/deleted'), request('/documents/deleted')]);
    state.deletedWorkspaces = responses[0].workspaces || [];
    state.deletedDocuments = responses[1].documents || [];
    renderRecovery();
  }

  function ask(title, copy, action, confirmText) {
    state.pendingAction = action;
    byId('confirm-title').textContent = title;
    byId('confirm-copy').textContent = copy;
    byId('confirm-action').textContent = confirmText || 'Confirm';
    byId('confirm').hidden = false;
  }
  function closeConfirm() {
    byId('confirm').hidden = true;
    state.pendingAction = null;
  }
  function setFormBusy(form, busy) {
    form.classList.toggle('busy', busy);
    Array.from(form.elements).forEach(function (control) { control.disabled = busy; });
  }

  function selectedInviteRole() {
    var selected = document.querySelector('input[name="invite-role"]:checked');
    return selected ? selected.value : 'member';
  }

  function updateInviteRoleCopy() {
    byId('invite-role-copy').textContent = selectedInviteRole() === 'admin'
      ? 'Can manage people and allowed domains, and invite any email.'
      : 'Can access documents shared with them and invite people at allowed domains.';
  }

  async function submitInvitation(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var status = byId('invite-status');
    var email = byId('invite-email').value.trim();
    var role = selectedInviteRole();
    setFormBusy(form, true);
    try {
      var result = await mutation('POST', '/account/invitations', {
        account_id: state.workspace.id, email: email, role: role,
      });
      form.reset();
      updateInviteRoleCopy();
      status.replaceChildren(document.createTextNode(result.invitation.notification_scheduled
        ? 'Invitation created. An email will be sent to ' + email + '. '
        : 'Invitation created. Share this link with ' + email + ': '));
      var inviteLink = element('a', '', 'Invitation link');
      inviteLink.href = result.invitation.accept_url; status.appendChild(inviteLink);
      await loadWorkspace(state.workspace.id);
    } catch (error) {
      status.textContent = humanError(error);
    } finally {
      setFormBusy(form, false);
    }
  }
  async function submitDomain(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var status = byId('domain-status');
    var domain = byId('domain-input').value.trim().replace(/^@+/, '').toLowerCase();
    if (!domain || state.invitePolicy.domains.indexOf(domain) !== -1) return;
    setFormBusy(form, true);
    try {
      await saveInviteDomains(state.invitePolicy.domains.concat(domain));
      form.reset();
    } catch (error) {
      status.textContent = humanError(error);
    } finally {
      setFormBusy(form, false);
    }
  }

  function wireEvents() {
    Array.from(document.querySelectorAll('.nav')).forEach(function (button) {
      button.addEventListener('click', function () { activatePanel(button.dataset.panel); });
    });
    byId('account-switcher-button').addEventListener('click', function () {
      var menu = byId('account-switcher-menu');
      var open = menu.hidden;
      menu.hidden = !open;
      byId('account-switcher-button').setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('#account-switcher')) {
        byId('account-switcher-menu').hidden = true;
        byId('account-switcher-button').setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        byId('account-switcher-menu').hidden = true;
        byId('account-switcher-button').setAttribute('aria-expanded', 'false');
      }
    });
    byId('invite-open').addEventListener('click', function () {
      byId('invite-form').classList.toggle('open');
      if (byId('invite-form').classList.contains('open')) byId('invite-email').focus();
    });
    byId('invite-form').addEventListener('submit', submitInvitation);
    Array.from(document.querySelectorAll('input[name="invite-role"]')).forEach(function (input) {
      input.addEventListener('change', updateInviteRoleCopy);
    });
    byId('domain-form').addEventListener('submit', submitDomain);
    byId('delete-workspace').addEventListener('click', function () {
      var workspace = state.workspace;
      ask('Delete ' + workspace.name + '?',
        'Everyone will lose access immediately. Encrypted documents and revisions are scheduled for permanent deletion after 30 days. Local SmallDocs files are not affected.',
        async function () {
          await mutation('DELETE', '/workspaces/' + encodeURIComponent(workspace.id));
          state.workspaces = state.workspaces.filter(function (item) { return item.id !== workspace.id; });
          if (state.workspaces.length) await loadWorkspace(state.workspaces[0].id);
          else location.assign('/library?scope=cloud');
        }, state.singlePlan ? 'Delete library' : 'Delete team');
    });
    byId('confirm-cancel').addEventListener('click', closeConfirm);
    byId('confirm-action').addEventListener('click', async function () {
      var action = state.pendingAction;
      if (!action) return closeConfirm();
      byId('confirm-action').disabled = true;
      try {
        await action();
        closeConfirm();
      } catch (error) {
        closeConfirm();
        showError(error);
      } finally {
        byId('confirm-action').disabled = false;
      }
    });
    byId('manage-billing').addEventListener('click', async function () {
      try {
        var result = await mutation('POST', '/workspaces/' + encodeURIComponent(state.workspace.id)
          + '/billing/portal');
        location.assign(result.portal_url);
      } catch (error) { showError(error); }
    });
  }

  function renderInstall(workspaceId) {
    var setup = window.SDocCliSetup;
    var instructions = setup.cloudInstructions({ origin: location.origin, workspaceId: workspaceId,
      workspaceName: state.workspace && accountName(state.workspace), windows: setup.isWindows() });
    byId('install-command').textContent = instructions.commands;
    byId('install-prompt').textContent = instructions.prompt;
  }

  function setupInstall() {
    renderInstall();
    document.querySelectorAll('[data-install-copy]').forEach(function (button) {
      button.addEventListener('click', async function () {
        try { await navigator.clipboard.writeText(byId(button.dataset.installCopy).textContent); byId('install-copy-status').textContent = 'Copied'; }
        catch (_) { byId('install-copy-status').textContent = 'Select the text and copy it.'; }
      });
    });
    byId('install-machines-link').addEventListener('click', function (event) { event.preventDefault(); activatePanel('machines'); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !byId('panel-machines').hidden) loadCredentials().catch(showError);
    });
  }

  function setupLibraries() {
    var list = byId('all-libraries'); list.replaceChildren();
    window.SDocsCloudAccountSelection.orderedLibraries(state.workspaces).forEach(function (library) {
      var row = element('div', 'machine-row library-row');
      var link = element('a', 'btn library-link'); link.href = '/cloud/admin?panel=install&workspace_id=' + encodeURIComponent(library.id);
      link.append(libraryMark(library), element('span', '', accountName(library)));
      row.appendChild(link);
      if (library.kind === 'personal') row.appendChild(element('span', 'description', "Others can't join this library."));
      list.appendChild(row);
    });
    byId('create-library-form').onsubmit = async function (event) {
      event.preventDefault(); var button = this.querySelector('button'); button.disabled = true;
      try {
        var result = await mutation('POST', '/workspaces', { name: byId('new-library-name').value.trim() });
        location.assign('/cloud/admin?panel=install&workspace_id=' + encodeURIComponent(result.workspace.workspaceId));
      } catch (_) { byId('library-create-status').textContent = 'The library could not be created. Try again.'; button.disabled = false; }
    };
    request('/onboarding').then(function (data) {
      byId('library-request-form').hidden = !data.company_domain;
      var select = byId('library-request-email'); select.replaceChildren();
      (data.company_emails || []).forEach(function (email) {
        var option = element('option', '', email); option.value = email; select.appendChild(option);
      });
    }).catch(function () {});
    byId('library-request-form').onsubmit = async function (event) {
      event.preventDefault(); var button = this.querySelector('button'); button.disabled = true;
      try {
        var result = await mutation('POST', '/join-requests', { email: byId('library-request-email').value, consented: byId('library-request-consent').checked, note: byId('library-request-note').value });
        byId('library-request-url').value = result.request.handoff_url; byId('library-request-url').hidden = false;
        byId('library-request-status').textContent = 'Send this link to your library administrator. Nothing has been sent automatically.';
      } catch (_) { byId('library-request-status').textContent = 'The request could not be created. Try again.'; }
      button.disabled = false;
    };
  }

  async function initialize() {
    setupInstall();
    wireEvents();
    try {
      var responses = await Promise.all([
        request('/me'), request('/workspaces'), request('/cli/credentials'),
      ]);
      state.singlePlan = Boolean(responses[0].single_plan);
      state.me = responses[0].user || null;
      byId('connect-google').hidden = !responses[0].google_enabled;
      byId('sign-in-methods').replaceChildren();
      (responses[0].sign_in_methods || []).forEach(function (method) {
        var line = document.createElement('p');
        line.textContent = (method.provider === 'google' ? 'Google' : method.provider === 'email' ? 'Email code' : method.provider) + ': ' + method.email;
        byId('sign-in-methods').appendChild(line);
      });
      document.querySelector('[data-panel="libraries"]').hidden = !state.singlePlan;
      if (state.singlePlan) {
        byId('install-team-link').textContent = 'Manage libraries';
        byId('install-team-link').href = '/cloud/admin?panel=libraries';
        byId('members-empty').textContent = 'No other people have joined this library yet.';
        byId('invite-status').textContent = 'After acceptance, people without a paid subscription elsewhere are covered by your billing account.';
        byId('delete-workspace').textContent = 'Delete library';
        byId('workspace-lifecycle').querySelector('strong').textContent = 'Delete library';
      }
      var preference = byId('legacy-library');
      preference.checked = Boolean(state.me.legacy_library_enabled);
      preference.addEventListener('change', async function () {
        preference.disabled = true;
        try {
          await mutation('PATCH', '/me/preferences', { legacy_library_enabled: preference.checked });
          state.me.legacy_library_enabled = preference.checked;
          byId('library-preference-status').textContent = 'Saved. Navigation updates when you open another page.';
        } catch (_) {
          preference.checked = !preference.checked;
          byId('library-preference-status').textContent = 'Your preference could not be saved. Try again.';
        } finally { preference.disabled = false; }
      });
      state.workspaces = responses[1].workspaces || [];
      state.credentials = responses[2].credentials || [];
      if (state.singlePlan) setupLibraries();
      state.deletedWorkspaces = [];
      state.deletedDocuments = [];
      var params = new URLSearchParams(location.search);
      byId('account-label').textContent = state.me && state.me.email ? [state.me.first_name, state.me.last_name].filter(Boolean).join(' ') + ' · ' + state.me.email : 'Signed in';
      if (!state.workspaces.length) {
        var panel = params.get('panel');
        if (panel === 'install' || panel === 'machines') {
          if (!state.me.first_name || !state.me.last_name) { location.assign('/cloud/profile'); return; }
          document.querySelector('.account-switcher').hidden = true;
          ['overview', 'billing'].forEach(function (name) { document.querySelector('[data-panel="' + name + '"]').hidden = true; });
          var fullName = [state.me.first_name, state.me.last_name].filter(Boolean).join(' ');
          byId('account-label').textContent = fullName + ' · ' + state.me.email;
          renderCredentials();
          activatePanel(panel, false);
          return;
        }
        location.assign(state.singlePlan ? '/cloud/start' : '/cloud/checkout');
        return;
      }
      var deleted = await Promise.all([requestWithoutSubscription('/workspaces/deleted', { workspaces: [] }), requestWithoutSubscription('/documents/deleted', { documents: [] })]);
      state.deletedWorkspaces = deleted[0].workspaces || [];
      state.deletedDocuments = deleted[1].documents || [];
      var selected = window.SDocsCloudAccountSelection.resolve(
        state.workspaces, params.get('workspace_id'), localStorage);
      if (!selected) {
        renderAccountSwitcher();
        if (state.singlePlan && params.get('panel') === 'libraries') { activatePanel('libraries', false); return; }
        byId('overview-name').textContent = 'Choose an account';
        byId('overview-description').textContent = 'Select the Cloud account you want to manage.';
        return;
      }
      await loadWorkspace(selected.id);
      byId('install-library-link').href = '/library?scope=cloud&workspace=' + encodeURIComponent(selected.id);
      var requestedPanel = params.get('panel');
      var panelExists = requestedPanel && byId('panel-' + requestedPanel);
      if (panelExists && !(requestedPanel === 'people' && !isTeam())) {
        activatePanel(requestedPanel, false);
      }
    } catch (error) {
      showError(error);
    }
  }

  initialize();
})();
