(function () {
  'use strict';

  var state = {
    me: null,
    workspaces: [],
    workspace: null,
    members: [],
    invitations: [],
    projects: [],
    documents: [],
    credentials: [],
    audit: [],
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

  function apiPath(path) {
    return '/api/cloud/v1' + path;
  }

  async function request(path, options) {
    var response = await fetch(apiPath(path), Object.assign({ credentials: 'same-origin' }, options || {}));
    if (response.status === 401) {
      location.href = '/cloud/sign-in?return=' + encodeURIComponent(location.pathname + location.search);
      throw new Error('login_required');
    }
    var data = null;
    try { data = await response.json(); } catch (_) {}
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

  function humanError(error) {
    var messages = {
      permission_denied: 'Your workspace role does not allow this action.',
      resource_unavailable: 'This item is no longer available.',
      active_subscription_requires_cancellation: 'Cancel the workspace subscription in Billing before deleting it.',
      final_owner_required: 'Assign another owner before removing the final owner.',
      personal_workspace_cannot_be_deleted: 'Personal workspaces cannot be deleted here.',
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
    return member.email || 'User ' + String(member.user_id || '').slice(0, 8);
  }

  function formatRole(role) {
    if (!role) return 'Member';
    return role.charAt(0).toUpperCase() + role.slice(1);
  }

  function formatDate(value) {
    var date = typeof value === 'number' ? new Date(value) : new Date(String(value || ''));
    if (!Number.isFinite(date.getTime())) return 'Not recorded';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
  }

  function formatLastUsed(value) {
    if (value == null) return 'Not used yet';
    return formatDate(value);
  }

  function setCount(id, value) {
    byId(id).textContent = String(value);
  }

  function renderWorkspacePicker() {
    var picker = byId('workspace-switch');
    picker.replaceChildren();
    state.workspaces.forEach(function (workspace) {
      var option = element('option', '', workspace.name);
      option.value = workspace.id;
      option.selected = state.workspace && state.workspace.id === workspace.id;
      picker.appendChild(option);
    });
  }

  function renderInviteProjects() {
    var holder = byId('invite-projects');
    holder.replaceChildren();
    state.projects.forEach(function (project) {
      var label = element('label', 'project-option');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'invite-project';
      checkbox.value = project.id;
      label.append(checkbox, document.createTextNode(project.name));
      holder.appendChild(label);
    });
    if (!state.projects.length) holder.appendChild(element('span', 'muted', 'Create a project before inviting a member.'));
  }

  function renderMembers() {
    var rows = byId('member-rows');
    rows.replaceChildren();
    byId('members-empty').hidden = state.members.length > 0;
    state.members.forEach(function (member) {
      var row = document.createElement('tr');
      var personCell = document.createElement('td');
      var person = element('div', 'person');
      var avatar = element('span', 'avatar', initials(member.email));
      var identity = document.createElement('div');
      var identityLabel = displayIdentity(member);
      identity.append(element('strong', '', identityLabel),
        element('span', '', 'User ' + String(member.user_id || '').slice(0, 8)));
      person.append(avatar, identity);
      personCell.appendChild(person);

      var roleCell = element('td', '', formatRole(member.role));
      var accessCell = document.createElement('td');
      if (member.role === 'owner' || member.role === 'admin') {
        accessCell.textContent = 'All projects';
      } else {
        accessCell.appendChild(element('span', 'muted', 'Explicit project access'));
      }
      var statusCell = document.createElement('td');
      statusCell.appendChild(element('span', member.status === 'active' ? 'status' : 'status pending', formatRole(member.status)));
      var actionCell = document.createElement('td');
      var actions = element('div', 'row-actions');
      var isSelf = state.me && member.user_id === state.me.id;
      if (member.status === 'active' && !isSelf) {
        if (state.workspace && state.workspace.role === 'owner' && member.role !== 'owner') {
          var promote = element('button', 'btn small', 'Make owner');
          promote.type = 'button';
          promote.addEventListener('click', function () {
            ask('Make ' + identityLabel + ' an owner?',
              'They will be able to manage members, billing, ownership, and workspace deletion. You will remain an owner.',
              async function () {
                await mutation('POST', '/workspaces/' + encodeURIComponent(state.workspace.id) + '/owners', {
                  user_id: member.user_id,
                });
                await loadWorkspace(state.workspace.id);
              }, 'Make owner');
          });
          actions.appendChild(promote);
        }
        var remove = element('button', 'btn small danger', 'Remove');
        remove.type = 'button';
        remove.addEventListener('click', function () {
          ask('Remove ' + identityLabel + '?', 'They will lose access to this workspace and its projects immediately.', async function () {
            await mutation('DELETE', '/workspaces/' + encodeURIComponent(state.workspace.id) + '/members/' + encodeURIComponent(member.user_id));
            await loadWorkspace(state.workspace.id);
          });
        });
        actions.appendChild(remove);
      }
      actionCell.appendChild(actions);
      row.append(personCell, roleCell, accessCell, statusCell, actionCell);
      rows.appendChild(row);
    });
    state.invitations.forEach(function (invitation) {
      var row = document.createElement('tr');
      var personCell = document.createElement('td');
      var person = element('div', 'person');
      var identity = document.createElement('div');
      identity.append(element('strong', '', invitation.email),
        element('span', '', 'Invitation'));
      person.append(element('span', 'avatar', initials(invitation.email)), identity);
      personCell.appendChild(person);
      var roleCell = element('td', '', formatRole(invitation.role));
      var accessCell = document.createElement('td');
      var grants = invitation.project_grants || [];
      if (invitation.role === 'admin') {
        accessCell.textContent = 'All projects';
      } else if (!grants.length) {
        accessCell.appendChild(element('span', 'muted', 'No project access'));
      } else {
        grants.forEach(function (grant) {
          var project = state.projects.find(function (item) {
            return item.id === (grant.projectId || grant.project_id);
          });
          accessCell.appendChild(element('span', 'tag',
            (project ? project.name : 'Project') + ': ' + grant.role));
        });
      }
      var statusCell = document.createElement('td');
      statusCell.appendChild(element('span', 'status pending',
        'Invited until ' + formatDate(invitation.expires_at)));
      var actionCell = document.createElement('td');
      var revoke = element('button', 'btn small danger', 'Revoke');
      revoke.type = 'button';
      revoke.addEventListener('click', function () {
        ask('Revoke invite for ' + invitation.email + '?',
          'The invitation link will stop working immediately.', async function () {
            await mutation('DELETE', '/workspaces/' + encodeURIComponent(state.workspace.id) +
              '/invitations/' + encodeURIComponent(invitation.id));
            await loadWorkspace(state.workspace.id);
          }, 'Revoke invite');
      });
      actionCell.appendChild(revoke);
      row.append(personCell, roleCell, accessCell, statusCell, actionCell);
      rows.appendChild(row);
    });
  }

  function renderProjects() {
    var grid = byId('project-grid');
    grid.replaceChildren();
    byId('projects-empty').hidden = state.projects.length > 0;
    var documentCounts = {};
    state.documents.forEach(function (documentItem) {
      var projectId = documentItem.projectId || documentItem.project_id ||
        (documentItem.project && documentItem.project.id);
      documentCounts[projectId] = (documentCounts[projectId] || 0) + 1;
    });
    state.projects.forEach(function (project) {
      var card = element('article', 'project');
      var top = element('div', 'project-top');
      var heading = document.createElement('div');
      heading.append(element('h2', '', project.name), element('p', '', 'Documents with the same project access.'));
      top.appendChild(heading);
      var meta = element('div', 'project-meta');
      var count = documentCounts[project.id] || 0;
      meta.append(element('span', '', count + (count === 1 ? ' document' : ' documents')),
        element('span', '', formatRole(project.role) + ' access'));
      card.append(top, meta);
      grid.appendChild(card);
    });
    renderInviteProjects();
  }

  function activeCredentials() {
    return state.credentials.filter(function (credential) { return credential.revokedAtMs == null; });
  }

  function renderCredentials() {
    var credentials = activeCredentials();
    var rows = byId('credential-rows');
    rows.replaceChildren();
    byId('credentials-empty').hidden = credentials.length > 0;
    credentials.forEach(function (credential) {
      var row = document.createElement('tr');
      var nameCell = document.createElement('td');
      nameCell.append(element('strong', '', credential.displayName || 'SmallDocs CLI'), document.createElement('br'),
        element('span', 'muted', 'CLI credential'));
      var createdCell = element('td', '', formatDate(credential.createdAtMs));
      var usedCell = element('td', '', formatLastUsed(credential.lastUsedAtMs));
      var actionCell = document.createElement('td');
      var revoke = element('button', 'btn small danger', 'Revoke');
      revoke.type = 'button';
      revoke.addEventListener('click', function () {
        ask('Revoke ' + (credential.displayName || 'this credential') + '?', 'This credential will stop working immediately. Your other credentials are not affected.', async function () {
          await mutation('DELETE', '/cli/credentials/' + encodeURIComponent(credential.id));
          await loadCredentials();
          renderAll();
        });
      });
      actionCell.appendChild(revoke);
      row.append(nameCell, createdCell, usedCell, actionCell);
      rows.appendChild(row);
    });
  }

  function renderAudit() {
    var rows = byId('audit-rows');
    rows.replaceChildren();
    byId('audit-empty').hidden = state.audit.length > 0;
    state.audit.slice(0, 20).forEach(function (event) {
      var row = document.createElement('tr');
      row.append(element('td', '', event.action.replace(/\./g, ' ')),
        element('td', 'muted', formatDate(event.created_at)));
      rows.appendChild(row);
    });
  }

  function renderBilling() {
    var billing = state.billing;
    var plan = billing && billing.plan;
    byId('billing-plan').textContent = plan ? formatRole(plan) + ' Cloud' : 'No active subscription';
    byId('billing-status').textContent = billing
      ? 'Status: ' + String(billing.effectiveStatus || billing.subscriptionStatus).replace(/_/g, ' ')
      : 'Subscribe before storing or searching Cloud documents.';
    byId('billing-price').textContent = plan === 'team' ? '£7 / member / month' : plan === 'personal' ? '£4 / month' : '';
    var usage = billing && billing.usage;
    byId('billing-usage').textContent = usage
      ? usage.memberCount + ' members, ' + usage.projectCount + ' projects, ' + usage.storedBytes + ' stored bytes'
      : 'No paid Cloud usage is available.';
    var canManageBilling = state.workspace && state.workspace.role === 'owner';
    byId('manage-billing').hidden = !billing || !canManageBilling;
    byId('subscribe-row').hidden = Boolean(billing) || !canManageBilling;
    byId('subscribe-link').href = '/cloud/checkout?plan=' + (state.workspace.kind === 'team' ? 'team' : 'personal');
  }

  function renderPermissions() {
    var canAdminister = state.workspace && (state.workspace.role === 'owner' || state.workspace.role === 'admin');
    byId('invite-open').hidden = !canAdminister;
    byId('project-open').hidden = !canAdminister;
    byId('workspace-lifecycle').hidden = !state.workspace || state.workspace.kind !== 'team' ||
      state.workspace.role !== 'owner';
    var adminOption = byId('invite-role').querySelector('option[value="admin"]');
    adminOption.disabled = !state.workspace || state.workspace.role !== 'owner';
    if (adminOption.disabled && byId('invite-role').value === 'admin') byId('invite-role').value = 'member';
    syncInviteRole();
  }

  function syncInviteRole() {
    var isAdmin = byId('invite-role').value === 'admin';
    byId('invite-project-role').disabled = isAdmin;
    byId('invite-projects').classList.toggle('busy', isAdmin);
  }

  function renderAll() {
    if (!state.workspace) return;
    byId('overview-name').textContent = state.workspace.name;
    byId('account-label').textContent = state.me && state.me.email ? 'Signed in as ' + state.me.email : 'Signed in';
    setCount('member-count', state.members.filter(function (member) { return member.status === 'active'; }).length);
    setCount('project-count', state.projects.length);
    setCount('document-count', state.documents.length);
    setCount('credential-count', activeCredentials().length);
    renderWorkspacePicker();
    renderMembers();
    renderProjects();
    renderCredentials();
    renderAudit();
    renderBilling();
    renderPermissions();
  }

  async function loadCredentials() {
    var data = await request('/cli/credentials');
    state.credentials = data.credentials || [];
  }

  async function loadWorkspace(workspaceId) {
    clearError();
    var workspace = state.workspaces.find(function (item) { return item.id === workspaceId; });
    if (!workspace) workspace = state.workspaces[0];
    if (!workspace) throw new Error('resource_unavailable');
    state.workspace = workspace;
    var encoded = encodeURIComponent(workspace.id);
    var responses = await Promise.all([
      request('/workspaces/' + encoded + '/members'),
      request('/workspaces/' + encoded + '/invitations'),
      request('/workspaces/' + encoded + '/projects'),
      requestAllDocuments(encoded),
      request('/workspaces/' + encoded + '/audit'),
      request('/workspaces/' + encoded + '/billing'),
    ]);
    state.members = responses[0].members || [];
    state.invitations = responses[1].invitations || [];
    state.projects = responses[2].projects || [];
    state.documents = responses[3];
    state.audit = responses[4].events || [];
    state.billing = responses[5].billing || null;
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
      var page = await request(query);
      documents = documents.concat(page.documents || []);
      cursor = page.next_cursor || null;
    } while (cursor);
    return documents;
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

  function inviteGrants() {
    var role = byId('invite-project-role').value;
    return Array.from(document.querySelectorAll('input[name="invite-project"]:checked')).map(function (checkbox) {
      return { projectId: checkbox.value, role: role };
    });
  }

  async function submitInvitation(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var status = byId('invite-status');
    status.replaceChildren();
    setFormBusy(form, true);
    try {
      var data = await mutation('POST', '/workspaces/' + encodeURIComponent(state.workspace.id) + '/invitations', {
        email: byId('invite-email').value.trim(),
        role: byId('invite-role').value,
        project_grants: byId('invite-role').value === 'admin' ? [] : inviteGrants(),
      });
      var invitation = data.invitation || {};
      status.append(document.createTextNode('Invite created for ' + invitation.email + '. '));
      var copy = element('button', 'btn small', 'Copy invite link');
      copy.type = 'button';
      copy.addEventListener('click', async function () {
        try {
          await navigator.clipboard.writeText(invitation.accept_url);
          copy.textContent = 'Copied';
        } catch (_) {
          status.append(document.createTextNode(invitation.accept_url || ''));
          copy.remove();
        }
      });
      status.appendChild(copy);
      form.reset();
      await loadWorkspace(state.workspace.id);
    } catch (error) {
      status.textContent = humanError(error);
    } finally {
      setFormBusy(form, false);
      renderPermissions();
    }
  }

  async function submitProject(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var status = byId('project-status');
    setFormBusy(form, true);
    try {
      await mutation('POST', '/workspaces/' + encodeURIComponent(state.workspace.id) + '/projects', {
        name: byId('project-name').value.trim(),
      });
      form.reset();
      form.classList.remove('open');
      byId('project-create-card').hidden = true;
      await loadWorkspace(state.workspace.id);
      status.textContent = 'Owners and admins can create projects.';
    } catch (error) {
      status.textContent = humanError(error);
    } finally {
      setFormBusy(form, false);
      renderPermissions();
    }
  }

  function wireEvents() {
    var nav = Array.from(document.querySelectorAll('.nav'));
    var panels = Array.from(document.querySelectorAll('.panel'));
    nav.forEach(function (button) {
      button.addEventListener('click', function () {
        nav.forEach(function (item) { item.classList.toggle('active', item === button); });
        panels.forEach(function (panel) { panel.hidden = panel.id !== 'panel-' + button.dataset.panel; });
      });
    });
    byId('workspace-switch').addEventListener('change', function (event) {
      loadWorkspace(event.target.value).catch(showError);
    });
    byId('invite-open').addEventListener('click', function () {
      byId('invite-form').classList.toggle('open');
      if (byId('invite-form').classList.contains('open')) byId('invite-email').focus();
    });
    byId('invite-role').addEventListener('change', syncInviteRole);
    byId('invite-form').addEventListener('submit', submitInvitation);
    byId('project-open').addEventListener('click', function () {
      byId('project-create-card').hidden = !byId('project-create-card').hidden;
      byId('project-form').classList.toggle('open');
      if (byId('project-form').classList.contains('open')) byId('project-name').focus();
    });
    byId('project-form').addEventListener('submit', submitProject);
    byId('delete-workspace').addEventListener('click', function () {
      var workspace = state.workspace;
      ask('Delete ' + workspace.name + '?',
        'Everyone will lose access immediately. Encrypted documents and revisions are scheduled for permanent deletion after 30 days. Local SmallDocs files are not affected.',
        async function () {
          await mutation('DELETE', '/workspaces/' + encodeURIComponent(workspace.id));
          state.workspaces = state.workspaces.filter(function (item) { return item.id !== workspace.id; });
          if (state.workspaces.length) await loadWorkspace(state.workspaces[0].id);
          else location.assign('/library?scope=cloud');
        }, 'Delete workspace');
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
        var result = await mutation('POST', '/workspaces/' + encodeURIComponent(state.workspace.id) + '/billing/portal');
        location.assign(result.portal_url);
      } catch (error) { showError(error); }
    });
  }

  async function initialize() {
    wireEvents();
    try {
      var responses = await Promise.all([request('/me'), request('/workspaces'), loadCredentials()]);
      state.me = responses[0].user || null;
      state.workspaces = (responses[1].workspaces || []).filter(function (workspace) {
        return workspace.role === 'owner' || workspace.role === 'admin';
      });
      var requestedId = new URLSearchParams(location.search).get('workspace_id');
      await loadWorkspace(requestedId);
    } catch (error) {
      showError(error);
    }
  }

  initialize();
})();
