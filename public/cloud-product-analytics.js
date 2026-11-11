(function () {
  'use strict';
  var root = document.querySelector('[data-product-analytics]');
  if (!root) return;
  var privateView = root.dataset.productAnalytics === 'private';
  var status = root.querySelector('[data-product-status]');
  var results = root.querySelector('[data-product-results]');
  var refresh = root.querySelector('[data-product-refresh]');
  var days = root.querySelector('[data-product-days]');
  var data = null, generation = 0, controller = null;
  var userRows = root.querySelector('[data-product-users]');
  var userStatus = root.querySelector('[data-product-users-status]');
  var userPrevious = root.querySelector('[data-product-users-previous]');
  var userNext = root.querySelector('[data-product-users-next]');
  var userCursors = [null], userPage = 0, userNextCursor = null, userGeneration = 0, userController = null, usersLoading = false;
  function node(tag, text, className) {
    var element = document.createElement(tag);
    if (text != null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }
  function cards(target, values) {
    target.replaceChildren();
    values.forEach(function (item) {
      var card = node('div', null, privateView ? 'stat' : 'chart-card');
      card.append(node('strong', item[1].toLocaleString()), node('span', item[0])); target.append(card);
    });
  }
  function rows(target, values) {
    target.replaceChildren();
    values.forEach(function (values) {
      var row = node('tr');
      values.forEach(function (value, index) {
        var cell = node(index === 0 ? 'th' : 'td', typeof value === 'number' ? value.toLocaleString() : value);
        if (index === 0) cell.scope = 'row';
        row.append(cell);
      });
      target.append(row);
    });
  }
  function renderDays() {
    if (!data) return;
    var source = privateView ? data.cohorts : data.daily;
    rows(root.querySelector('[data-product-days-body]'), source.slice(-Number(days.value)).reverse().map(function (day) {
      return privateView ? [day.date, day.accounts, day.profile_complete, day.ready, day.agent_connected, day.document_created, data.billing ? day.paid_people : 'Not available'] : [day.date, day.accounts];
    }));
  }
  function render() {
    var summary = privateView ? data.signups : data.summary;
    cards(root.querySelector('[data-signup-summary]'), [['Today (UTC)', summary.today], ['Last 7 days', summary.last_7_days], ['Last 30 days', summary.last_30_days], ['All accounts', summary.total]]);
    if (privateView) {
      var t = data.totals;
      var progress = root.querySelector('[data-product-progress]');
      progress.replaceChildren();
      [
        ['Account created', t.accounts, 'A verified sign-in created an account.'],
        ['Profile completed', t.profile_complete, 'First and last name supplied.'],
        ['Ready to use', t.ready, 'Enabled account, completed profile, current Terms accepted, and membership of a library with a project.'],
        ['Agent authorized at least once', t.agent_connected, 'At least one CLI connection has been authorized, including connections later revoked.'],
        ['Document created', t.document_created, 'Has created a Cloud document, including a subsequently deleted document while its metadata is retained.'],
        ['On paid subscription', data.billing ? t.paid_people : 'Not available', 'Enabled people covered by an active, confirmed Stripe subscription. Sponsored people count once.'],
      ].forEach(function (item) {
        var row = node('div', null, 'billing-row');
        var copy = node('div'); copy.append(node('strong', item[0]), node('p', item[2]));
        row.append(copy, node('strong', item[1].toLocaleString(), 'price')); progress.append(row);
      });
      var b = data.billing;
      rows(root.querySelector('[data-product-billing]'), b ? [
        ['Trials started', b.trials_started], ['Active subscriptions', b.active_subscriptions],
        ['Billed seats', b.billed_seats], ['Payment confirmation pending', b.pending_subscriptions],
        ['Past-due subscriptions', b.past_due_subscriptions], ['Canceled subscriptions', b.canceled_subscriptions],
      ] : []);
      root.querySelector('[data-product-billing-note]').hidden = Boolean(b);
      cards(root.querySelector('[data-product-libraries]'), data.libraries ? [['Personal', data.libraries.personal], ['Team', data.libraries.team]] : []);
    }
    renderDays(); results.hidden = false;
    status.textContent = 'Updated ' + new Date(data.generated_at).toLocaleString() + '. Figures are cached for up to one minute.';
  }
  function clear() {
    data = null; results.hidden = true;
    if (privateView) root.querySelectorAll('[data-signup-summary], [data-product-progress], [data-product-billing], [data-product-libraries], [data-product-days-body]').forEach(function (element) { element.replaceChildren(); });
    if (privateView) {
      userGeneration++; if (userController) userController.abort();
      userRows.replaceChildren(); userStatus.textContent = 'Loading accounts...';
      userCursors = [null]; userPage = 0; userNextCursor = null; usersLoading = false;
      userPrevious.disabled = userNext.disabled = true;
    }
  }
  async function loadUsers(index) {
    if (usersLoading) return;
    usersLoading = true; userPrevious.disabled = userNext.disabled = true;
    var current = ++userGeneration;
    userController = new AbortController();
    userRows.replaceChildren(); userStatus.textContent = 'Loading accounts...';
    try {
      var after = userCursors[index];
      var response = await fetch('/api/cloud/v1/admin/users' + (after ? '?after=' + encodeURIComponent(after) : ''),
        { credentials: 'same-origin', cache: 'no-store', signal: userController.signal });
      if (current !== userGeneration) return;
      if (response.status === 401) { clear(); location.assign('/cloud/sign-in?return=%2Fcloud%2Foverview'); return; }
      if (response.status === 403 || response.status === 404) { clear(); status.textContent = 'This overview is not available for this account.'; return; }
      if (!response.ok) throw new Error('unavailable');
      var value = await response.json();
      if (current !== userGeneration) return;
      value.items.forEach(function (item) {
        var row = node('tr'); var email = node('td');
        if (item.emails.length) item.emails.forEach(function (address) { email.append(node('span', address)); });
        else email.textContent = 'No verified email retained';
        var date = node('time', new Date(item.created_at).toLocaleString(undefined, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }));
        date.dateTime = item.created_at;
        var created = node('td'); created.append(date);
        var subscription = item.subscribed == null ? 'Not available' : item.subscribed ? 'Subscribed'
          : item.paid_coverage ? 'Sponsored' : item.manual_access ? 'Free access' : 'Not paid';
        row.append(email, created, node('td', item.disabled ? 'Disabled' : 'Enabled'), node('td', item.profile_complete ? 'Complete' : 'Incomplete'),
          node('td', item.agent_connected ? 'Yes' : 'No'), node('td', item.document_created ? 'Yes' : 'No'), node('td', subscription));
        userRows.append(row);
      });
      userPage = index; userNextCursor = value.next_cursor;
      userStatus.textContent = value.items.length ? 'Page ' + (index + 1) + ' · ' + value.items.length + (value.items.length === 1 ? ' account shown.' : ' accounts shown.') : 'No accounts to show.';
    } catch (_) { if (current === userGeneration) userStatus.textContent = 'Accounts could not be loaded. Try Refresh.'; }
    finally {
      if (current === userGeneration) { usersLoading = false; userPrevious.disabled = userPage === 0; userNext.disabled = !userNextCursor; }
    }
  }
  async function load() {
    var current = ++generation;
    if (controller) controller.abort();
    controller = new AbortController();
    if (privateView) clear();
    status.textContent = privateView ? 'Loading overview...' : 'Loading signup totals...';
    if (refresh) refresh.disabled = true;
    try {
      var response = await fetch(privateView ? '/api/cloud/v1/admin/overview' : '/analytics/signups',
        { credentials: privateView ? 'same-origin' : 'omit', cache: 'no-store', signal: controller.signal });
      if (current !== generation) return;
      if (privateView && response.status === 401) { location.assign('/cloud/sign-in?return=%2Fcloud%2Foverview'); return; }
      if (privateView && (response.status === 403 || response.status === 404)) {
        status.textContent = 'This overview is not available for this account.'; return;
      }
      if (!response.ok) throw new Error('unavailable');
      var value = await response.json();
      if (current !== generation) return;
      if (!privateView && !value.available) { clear(); status.textContent = 'Signup totals are not available on this deployment.'; return; }
      data = value; render();
      if (privateView) loadUsers(0);
    } catch (_) {
      if (current !== generation) return;
      clear(); status.textContent = privateView ? 'The overview could not be loaded. Try Refresh.' : 'Signup totals could not be loaded. Reload to try again.';
    } finally { if (current === generation && refresh) refresh.disabled = false; }
  }
  days.addEventListener('change', renderDays);
  if (refresh) refresh.addEventListener('click', load);
  if (privateView) {
    userPrevious.addEventListener('click', function () { if (userPage > 0) loadUsers(userPage - 1); });
    userNext.addEventListener('click', function () { if (userNextCursor) { userCursors[userPage + 1] = userNextCursor; loadUsers(userPage + 1); } });
    fetch('/api/cloud/v1/admin/status', { credentials: 'same-origin', cache: 'no-store' }).then(function (response) {
      return response.ok ? response.json() : {};
    }).then(function (value) { root.querySelector('[data-product-feedback]').hidden = !value.can_view_feedback; }).catch(function () {});
    window.addEventListener('pagehide', function () {
      generation++; if (controller) controller.abort(); clear(); status.textContent = 'Loading overview...';
    });
    window.addEventListener('pageshow', function (event) { if (event.persisted) load(); });
    window.addEventListener('focus', load);
  }
  load();
})();
