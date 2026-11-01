(function (exports) {
  'use strict';

  var icons = {
    local: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5"/><path d="M8 19V7"/><path d="M12 19V4"/><path d="m16 5 4 14"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>',
    capabilities: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20"/><path d="m4.93 4.93 14.14 14.14"/><path d="M2 12h20"/><path d="m19.07 4.93-14.14 14.14"/></svg>',
    signIn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path d="m16 19 2 2 4-4"/></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3z"/><path d="m9 12 2 2 4-4"/></svg>',
    github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v12"/><path d="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M15 6a9 9 0 0 0-9 9"/><path d="M18 15v6"/><path d="M21 18h-6"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    external: '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7"/><path d="m9 15 12-12"/><path d="M15 3h6v6"/></svg>',
    chevron: '<svg class="sdocs-sidebar-row-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'
  };
  icons.refer = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12"/><path d="M12 8H7.5A2.5 2.5 0 1 1 10 5.5L12 8Zm0 0h4.5A2.5 2.5 0 1 0 14 5.5L12 8Z"/></svg>';
  icons.learn = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3Z"/></svg>';

  function discoveryHtml(options) {
    var prefix = options.idPrefix;
    var refer = options.authenticated ? sectionHtml({ id: 'refer', idPrefix: prefix,
      rowClass: options.rowClass, label: 'Refer', icon: icons.refer,
      content: '<div class="sdocs-sidebar-preview" data-referral-panel>' +
        '<p class="sdocs-sidebar-explainer">Share your link. Every time someone joins, connects an agent and makes their first monthly payment, you earn credit for one person for one month. Credits add up and carry forward.</p>' +
        '<label class="sdocs-sidebar-explainer sdocs-referral-link-label">Your referral link<input class="sdocs-referral-link" aria-label="Your referral link" readonly></label>' +
        '<button class="sdocs-sidebar-cta" type="button" data-referral-copy disabled>Copy link</button>' +
        '<p class="sdocs-sidebar-explainer" data-referral-balance></p>' +
        '<div class="sdocs-sidebar-referral-history"><button class="sdocs-sidebar-top-row sdocs-referral-history-toggle" type="button" aria-expanded="false" aria-controls="' + prefix + '_referral_history">Referrals <span data-referral-total></span>' + icons.chevron + '</button>' +
        '<div class="sdocs-sidebar-expander" id="' + prefix + '_referral_history"><div class="sdocs-sidebar-expander-clip">' +
        '<ul class="sdocs-referral-list" aria-label="People you referred"></ul>' +
        '<button class="sdocs-sidebar-cta" type="button" data-referral-more hidden>Show more</button></div></div></div>' +
        '<p class="sdocs-sidebar-explainer" data-referral-status role="status">Loading your referral link...</p></div>' }) : '';
    return refer + sectionHtml({ id: 'learn', idPrefix: prefix, rowClass: options.rowClass,
      label: 'Learn', icon: icons.learn,
      content: '<div class="sdocs-sidebar-preview sdocs-sidebar-actions">' +
        '<a class="sdocs-sidebar-subitem" href="/learn">Getting started</a>' +
        '<a class="sdocs-sidebar-subitem" href="/learn#your-library-and-tags">Library and tags</a>' +
        '<a class="sdocs-sidebar-subitem" href="/cloud-search">Search with your agent</a>' +
        '<a class="sdocs-sidebar-subitem" href="/cloud-updates">Editing and comments</a>' +
        '<a class="sdocs-sidebar-subitem" href="/learn#manage-smalldocs-from-chat">Manage SmallDocs from chat</a>' +
        '<a class="sdocs-sidebar-subitem" href="/home#learn">Examples</a></div>' });
  }

  function bindReferrals(sidebar) {
    var panel = sidebar.querySelector('[data-referral-panel]');
    if (!panel) return;
    var state, loading = false, loadedAt = 0;
    var input = panel.querySelector('.sdocs-referral-link');
    var copy = panel.querySelector('[data-referral-copy]');
    var status = panel.querySelector('[data-referral-status]');
    var history = panel.querySelector('.sdocs-sidebar-referral-history');
    var historyToggle = panel.querySelector('.sdocs-referral-history-toggle');
    var more = panel.querySelector('[data-referral-more]');
    var top = panel.closest('[data-sidebar-section="refer"]').querySelector('.sdocs-sidebar-top-row');
    var unread = document.createElement('span'); unread.className = 'sdocs-sidebar-count'; unread.hidden = true;
    top.insertBefore(unread, top.querySelector('.sdocs-sidebar-row-chevron'));
    function appendPeople(people) {
      var list = panel.querySelector('.sdocs-referral-list');
      people.forEach(function (person) {
        var item = document.createElement('li');
        var name = document.createElement('span'); name.textContent = person.name;
        var detail = document.createElement('small');
        detail.textContent = person.status === 'rewarded' ? '1 person-month earned'
          : person.status === 'installed' ? 'Agent connected, reward pending' : 'Signed up';
        item.appendChild(name); item.appendChild(detail); list.appendChild(item);
      });
    }
    async function markSeen() {
      if (!state) return;
      try {
        var response = await fetch('/api/cloud/v1/referrals/seen', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seen_through_ms: state.as_of_ms }) });
        if (response.ok) unread.hidden = true;
      } catch (_) {}
    }
    async function load(append) {
      if (loading) return;
      loading = true;
      try {
        var response = await fetch('/api/cloud/v1/referrals' + (append && state.next_cursor ? '?after=' + encodeURIComponent(state.next_cursor) : ''), { credentials: 'same-origin' });
        if (!response.ok) throw new Error('unavailable');
        state = await response.json(); loadedAt = Date.now();
        input.value = state.url; copy.disabled = false;
        panel.querySelector('[data-referral-balance]').textContent = state.available_person_months +
          (state.available_person_months === 1 ? ' person-month available.' : ' person-months available.') +
          (state.reserved_person_months ? ' ' + state.reserved_person_months +
            (state.reserved_person_months === 1 ? ' person-month set aside for a pending bill.' : ' person-months set aside for a pending bill.') : '');
        panel.querySelector('[data-referral-total]').textContent = String(state.total_referrals);
        if (!append) panel.querySelector('.sdocs-referral-list').replaceChildren();
        appendPeople(state.referrals);
        status.textContent = state.total_referrals ? '' : 'People who join through your link will appear here.';
        more.hidden = !state.next_cursor;
        unread.textContent = String(state.unread_count); unread.hidden = !state.unread_count;
        unread.setAttribute('aria-label', state.unread_count + ' referral updates');
        if (history.classList.contains('is-expanded')) await markSeen();
      } catch (_) { status.textContent = 'Referrals could not be loaded. Try again.'; }
      finally { loading = false; }
    }
    input.addEventListener('click', function () { input.select(); });
    copy.addEventListener('click', async function () {
      try { await navigator.clipboard.writeText(input.value); status.textContent = 'Link copied.'; }
      catch (_) { input.focus(); input.select(); status.textContent = 'Copy the selected link.'; }
    });
    more.addEventListener('click', function () { load(true); });
    historyToggle.addEventListener('click', function () {
      var expanded = history.classList.toggle('is-expanded');
      historyToggle.setAttribute('aria-expanded', String(expanded));
      if (expanded) markSeen();
    });
    top.addEventListener('click', function () { if (Date.now() - loadedAt > 60000) load(false); });
    window.addEventListener('focus', function () { if (Date.now() - loadedAt > 60000) load(false); });
    load(false);
  }

  function topRowHtml(options) {
    options = options || {};
    var tag = options.href ? 'a' : 'button';
    var classes = 'sdocs-sidebar-top-row' + (options.rowClass ? ' ' + options.rowClass : '') +
      (options.className ? ' ' + options.className : '') + (options.active ? ' is-active' : '');
    var attrs = options.href ? ' href="' + options.href + '"' : ' type="button"';
    if (options.id) attrs += ' id="' + options.id + '"';
    if (options.controls) attrs += ' aria-controls="' + options.controls + '" aria-expanded="false"';
    if (options.dataHref) attrs += ' data-sidebar-href="' + options.dataHref + '"';
    if (options.active) attrs += ' aria-current="page"';
    attrs += ' data-rail-label="' + options.label + '"';
    return '<' + tag + ' class="' + classes + '"' + attrs + '>' + options.icon +
      '<span' + (options.labelClass ? ' class="' + options.labelClass + '"' : '') + '>' +
      options.label + '</span>' + (options.controls ? icons.chevron : '') + '</' + tag + '>';
  }

  function sectionHtml(options) {
    var panelId = options.panelId || options.idPrefix + '_' + options.id + '_panel';
    return '<div class="sdocs-sidebar-section' + (options.className ? ' ' + options.className : '') +
      '" data-sidebar-section="' + options.id + '">' + topRowHtml({
        rowClass: options.rowClass,
        id: options.buttonId,
        icon: options.icon,
        label: options.label,
        labelClass: options.labelClass,
        controls: panelId,
        dataHref: options.dataHref,
      }) + '<div class="sdocs-sidebar-expander" id="' + panelId + '">' +
      '<div class="sdocs-sidebar-expander-clip">' + options.content + '</div></div></div>';
  }

  function sitePrimaryHtml(active, rowClass) {
    var legacy = typeof document === 'undefined' || !document.querySelector('[data-legacy-library="false"]');
    if (!legacy) return topRowHtml({ href: '/library?scope=cloud', rowClass: rowClass,
      icon: icons.local, label: 'Library', active: active === 'cloud' });
    return topRowHtml({
      href: '/library',
      rowClass: rowClass,
      className: 'sdocs-site-sidebar-local',
      icon: icons.local,
      label: 'Local library',
      active: active === 'local',
    }) + topRowHtml({
      href: '/library?scope=cloud',
      rowClass: rowClass,
      icon: icons.cloud,
      label: 'Cloud library',
      active: active === 'cloud',
    });
  }

  function applyLibraryPreference(legacy) {
    if (typeof document === 'undefined') return;
    document.body.dataset.legacyLibrary = legacy ? 'true' : 'false';
    var reader = document.getElementById('_sd_sidebar');
    if (reader) {
      reader.dataset.legacyLibrary = legacy ? 'true' : 'false';
      var local = reader.querySelector('[data-sidebar-section="library"]');
      if (local) local.hidden = !legacy;
      var cloud = reader.querySelector('[data-sidebar-section="cloud"] > .sdocs-sidebar-top-row');
      if (cloud) {
        var label = cloud.querySelector('span');
        if (label) label.textContent = legacy ? 'Cloud library' : 'Library';
        var icon = cloud.querySelector('svg');
        if (icon) icon.outerHTML = legacy ? icons.cloud : icons.local;
        cloud.dataset.railLabel = legacy ? 'Cloud library' : 'Library';
      }
    }
    var site = document.querySelector('.sdocs-site-sidebar');
    if (site) {
      var localLink = site.querySelector('.sdocs-site-sidebar-local');
      if (localLink) localLink.hidden = !legacy;
      var link = site.querySelector('a[href="/library?scope=cloud"]');
      if (link) {
        link.querySelector('span').textContent = legacy ? 'Cloud library' : 'Library';
        link.querySelector('svg').outerHTML = legacy ? icons.cloud : icons.local;
        link.dataset.railLabel = legacy ? 'Cloud library' : 'Library';
      }
    }
  }

  async function bindSubscriptionUi() {
    if (typeof document === 'undefined') return;
    var marker = document.querySelector('[data-legacy-library]');
    if (marker) applyLibraryPreference(marker.dataset.legacyLibrary !== 'false');
    if (!document.querySelector('[data-cloud-authenticated="true"]')) return;
    var sidebar = document.querySelector('.sdocs-sidebar-shell');
    if (!sidebar) return;
    try {
      var response = await fetch('/api/cloud/billing/subscription');
      if (!response.ok) return;
      var data = await response.json();
      var status = data.subscription || data;
      var previous = sidebar.querySelector('[data-subscription-status]');
      if (previous) previous.remove();
      if (status.phase === 'active') return;
      var footer = sidebar.querySelector('.sdocs-sidebar-footer');
      if (!footer) return;
      var section = document.createElement('div');
      section.className = 'sdocs-sidebar-subscription';
      section.setAttribute('data-subscription-status', status.phase);
      var trial = status.phase === 'trial';
      var warning = status.phase === 'trial_warning';
      var paymentIssue = ['past_due_grace', 'past_due', 'read_only'].includes(status.phase);
      var end = trial ? status.trial_ends_at_ms : status.paywall_starts_at_ms;
      var now = Date.now();
      var heading = document.createElement('div');
      heading.className = 'sdocs-sidebar-subscription-heading';
      var label = document.createElement('strong');
      label.textContent = trial ? 'Free trial' : warning ? 'Trial ended'
        : status.phase === 'payment_required' ? 'Subscription required'
        : status.phase === 'past_due_grace' ? 'Payment needs attention'
        : paymentIssue || status.phase === 'canceled' ? 'Read-only access' : 'Subscription inactive';
      heading.appendChild(label);
      if ((trial || warning) && Number.isFinite(end)) {
        var days = Math.max(0, Math.ceil((end - now) / 86400000));
        var remaining = document.createElement('span');
        remaining.textContent = days + (days === 1 ? ' day' : ' days') + (warning ? ' of access left' : ' left');
        heading.appendChild(remaining);
        section.title = (trial ? 'Trial ends ' : 'Cloud access ends ') + new Date(end).toLocaleString(undefined,
          { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
      }
      section.appendChild(heading);
      var start = trial ? status.trial_starts_at_ms : status.trial_ends_at_ms;
      if ((trial || warning) && Number.isFinite(start) && Number.isFinite(end) && end > start) {
        var percent = Math.max(0, Math.min(100, (end - now) / (end - start) * 100));
        var progress = document.createElement('div');
        progress.className = 'sdocs-sidebar-subscription-progress';
        progress.setAttribute('role', 'meter');
        progress.setAttribute('aria-label', trial ? 'Free trial remaining' : 'Cloud access remaining');
        progress.setAttribute('aria-valuemin', '0');
        progress.setAttribute('aria-valuemax', '100');
        progress.setAttribute('aria-valuenow', String(Math.round(percent)));
        progress.setAttribute('aria-valuetext', remaining.textContent);
        var fill = document.createElement('span');
        fill.style.width = percent + '%';
        progress.appendChild(fill);
        section.appendChild(progress);
      }
      var link = document.createElement('a');
      link.className = 'sdocs-sidebar-subscribe';
      link.href = paymentIssue ? status.billing_url || '/cloud/admin?panel=billing' : status.subscribe_url || '/cloud/subscribe';
      link.textContent = paymentIssue ? 'Update billing' : 'Subscribe';
      section.appendChild(link);
      if ((warning || status.phase === 'payment_required') && status.feedback_url) {
        var feedback = document.createElement('a');
        feedback.className = 'sdocs-sidebar-trial-feedback'; feedback.href = status.feedback_url;
        feedback.textContent = 'Share feedback'; section.appendChild(feedback);
      }
      footer.appendChild(section);
    } catch (_) { /* Navigation stays usable when billing status is unavailable. */ }
  }

  function brandHtml(options) {
    options = options || {};
    var text = options.responsive
      ? '<span class="toolbar-brand-text toolbar-brand-full">SmallDocs</span>' +
        '<span class="toolbar-brand-text toolbar-brand-short">SDocs</span>' +
        '<span class="toolbar-brand-text toolbar-brand-tiny">SD</span>'
      : '<span>SmallDocs</span>';
    return '<a' + (options.id ? ' id="' + options.id + '"' : '') +
      ' class="sdocs-sidebar-brand" href="/" title="SmallDocs homepage">' + text + '</a>';
  }

  function accountActionsHtml(options) {
    options = options || {};
    var label = options.authenticated ? 'Account settings' : 'Sign in';
    var href = options.authenticated ? '/cloud/admin'
      : '/cloud/sign-in?return=' + encodeURIComponent(options.returnTo || '/docs');
    return '<div class="sdocs-sidebar-account-actions">' +
      '<a class="sdocs-sidebar-icon-shortcut sdocs-sidebar-settings-shortcut" href="' + href +
      '" aria-label="' + label + '" title="' + label + '"' +
      (options.authenticated ? '' : ' data-sdocs-sign-in-return') + '>' +
      (options.authenticated ? icons.settings : icons.signIn) + '</a>' +
      '<button class="sdocs-sidebar-icon-shortcut btn-with-dot" id="_sd_btn-info" type="button" aria-label="What\'s new" title="What\'s new" aria-controls="_sd_info-panel" aria-pressed="false">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>' +
      '<span class="info-dot" aria-hidden="true"></span></button></div>';
  }

  function renderShell(element, options) {
    options = options || {};
    var status = options.statusId
      ? '<div id="' + options.statusId + '" hidden aria-live="polite"></div>' : '';
    element.innerHTML = '<div class="sdocs-sidebar-main"><div class="sdocs-sidebar-header">' + brandHtml({
      id: options.brandId,
      responsive: options.responsiveBrand,
    }) + '<button class="sdocs-sidebar-collapse-toggle" type="button" aria-label="Collapse sidebar" aria-expanded="true">' +
      '<span class="sdocs-sidebar-rail-mark" aria-hidden="true">SD</span>' +
      '<svg class="sdocs-sidebar-collapse-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>' +
      '</button></div><nav class="sdocs-sidebar-nav' + (options.navClass ? ' ' + options.navClass : '') +
      '" aria-label="SmallDocs navigation">' + (options.primaryHtml || '') + discoveryHtml({
        idPrefix: options.idPrefix || element.id, rowClass: options.rowClass, authenticated: options.authenticated,
      }) +
      '</nav></div>' + status + '<footer class="sdocs-sidebar-footer sdocs-sidebar-account-footer">' +
      accountActionsHtml(options) + '</footer>';
    element.setAttribute('data-sdocs-sidebar-renderer', 'shared');
    bindReferrals(element);
    if (options.active === 'settings') {
      var accountSettings = element.querySelector('a[href="/cloud/admin"]');
      if (accountSettings) {
        accountSettings.classList.add('is-active');
        accountSettings.setAttribute('aria-current', 'page');
      }
    }
    Array.from(element.querySelectorAll('.sdocs-sidebar-top-row:not([data-rail-label])')).forEach(function (row) {
      var label = row.querySelector('span');
      if (label) row.setAttribute('data-rail-label', label.textContent.trim());
    });
    return element;
  }

  function setExpanded(section, expanded) {
    var trigger = section.querySelector(':scope > .sdocs-sidebar-top-row');
    section.classList.toggle('is-expanded', expanded);
    if (trigger) trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function bindExpandableSections(root, options) {
    options = options || {};
    Array.from(root.querySelectorAll('.sdocs-sidebar-section')).forEach(function (section) {
      var trigger = section.querySelector(':scope > .sdocs-sidebar-top-row');
      if (!trigger || trigger.getAttribute('data-sdocs-expander-bound') === 'true') return;
      trigger.setAttribute('data-sdocs-expander-bound', 'true');
      trigger.addEventListener('click', function () {
        var shouldExpand = !section.classList.contains('is-expanded');
        Array.from(root.querySelectorAll('.sdocs-sidebar-section.is-expanded')).forEach(function (openSection) {
          if (openSection !== section) setExpanded(openSection, false);
        });
        setExpanded(section, shouldExpand);
        if (typeof options.onToggle === 'function') {
          options.onToggle(section.getAttribute('data-sidebar-section'), shouldExpand, section);
        }
      });
    });
  }

  function bindMobileDrawer(options) {
    options = options || {};
    var button = options.button;
    var sidebar = options.sidebar;
    if (!button || !sidebar) return null;
    var body = options.body || document.body;
    var openClass = options.openClass || 'sdocs-mobile-nav-open';
    var backgrounds = options.backgrounds || [];
    var breakpoint = options.breakpoint || 768;

    function focusWithoutScrolling(element) {
      if (!element) return;
      try {
        element.focus({ preventScroll: true });
      } catch (_) {
        element.focus();
      }
    }

    function focusables() {
      return Array.from(sidebar.querySelectorAll(
        'a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
      )).filter(function (element) {
        return !element.hidden && element.getClientRects().length > 0;
      });
    }

    function setOpen(open, restoreFocus) {
      body.classList.toggle(openClass, open);
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      button.setAttribute('aria-label', open ? options.closeLabel : options.openLabel);
      backgrounds.forEach(function (element) { element.inert = open; });
      if (open) {
        window.requestAnimationFrame(function () {
          var first = focusables()[0];
          focusWithoutScrolling(first);
        });
      } else if (restoreFocus) {
        focusWithoutScrolling(button);
      }
    }

    button.addEventListener('click', function () {
      setOpen(!body.classList.contains(openClass), true);
    });
    // The mobile CSS backdrop is body::after, so a tap on the exposed area
    // arrives as a click on the body itself. Close through the same path as
    // the menu button and Escape, including focus restoration.
    body.addEventListener('click', function (event) {
      if (event.target !== body || !body.classList.contains(openClass)) return;
      if (!window.matchMedia('(max-width: ' + breakpoint + 'px)').matches) return;
      setOpen(false, true);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && body.classList.contains(openClass)) {
        setOpen(false, true);
        return;
      }
      if (event.key !== 'Tab' || !body.classList.contains(openClass)) return;
      var available = focusables();
      available.push(button);
      if (!available.length) return;
      var first = available[0];
      var last = available[available.length - 1];
      if (event.shiftKey && (document.activeElement === first || available.indexOf(document.activeElement) === -1)) {
        event.preventDefault();
        focusWithoutScrolling(last);
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        focusWithoutScrolling(first);
      }
    });
    window.addEventListener('resize', function () {
      if (!window.matchMedia('(max-width: ' + breakpoint + 'px)').matches) setOpen(false, false);
    });
    sidebar.addEventListener('click', function (event) {
      if (event.target.closest('a')) setOpen(false, false);
    });
    return { setOpen: setOpen };
  }

  function bindDesktopRail(options) {
    options = options || {};
    var body = options.body || document.body;
    var sidebar = options.sidebar;
    if (!sidebar) return null;
    var toggle = sidebar.querySelector('.sdocs-sidebar-collapse-toggle');
    if (!toggle) return null;
    var compactBreakpoint = options.compactBreakpoint || 950;
    var mobileBreakpoint = options.mobileBreakpoint || 768;
    var manualState = null;

    function isMobile() {
      return window.matchMedia('(max-width: ' + mobileBreakpoint + 'px)').matches;
    }

    function isCompact() {
      return window.matchMedia('(max-width: ' + compactBreakpoint + 'px)').matches;
    }

    function setCollapsed(collapsed, restoreFocus) {
      collapsed = Boolean(collapsed) && !isMobile() && isCompact();
      if (collapsed) {
        Array.from(sidebar.querySelectorAll('.sdocs-sidebar-section.is-expanded')).forEach(function (section) {
          setExpanded(section, false);
        });
        Array.from(sidebar.querySelectorAll('.sdocs-sidebar-library-subsection.is-expanded')).forEach(function (section) {
          section.classList.remove('is-expanded');
          var trigger = section.querySelector(':scope > .sdocs-sidebar-library-toggle');
          if (trigger) trigger.setAttribute('aria-expanded', 'false');
        });
      }
      body.classList.toggle('sdocs-sidebar-collapsed', collapsed);
      sidebar.setAttribute('data-sidebar-collapsed', collapsed ? 'true' : 'false');
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      if (restoreFocus) toggle.focus();
    }

    function syncToViewport() {
      if (isMobile() || !isCompact()) {
        setCollapsed(false, false);
      } else if (manualState) {
        setCollapsed(manualState === 'collapsed', false);
      } else {
        setCollapsed(isCompact(), false);
      }
    }

    toggle.addEventListener('click', function () {
      if (isMobile() || !isCompact()) return;
      var shouldCollapse = !body.classList.contains('sdocs-sidebar-collapsed');
      manualState = shouldCollapse ? 'collapsed' : 'expanded';
      setCollapsed(shouldCollapse, true);
    });

    sidebar.addEventListener('click', function (event) {
      if (!body.classList.contains('sdocs-sidebar-collapsed')) return;
      if (event.target.closest('.sdocs-sidebar-collapse-toggle, .sdocs-sidebar-account-actions')) return;
      var interactive = event.target.closest('a, button');
      if (interactive && interactive.matches('a')) event.preventDefault();
      manualState = 'expanded';
      setCollapsed(false, false);
    });

    window.addEventListener('resize', syncToViewport);
    syncToViewport();
    return { setCollapsed: setCollapsed, syncToViewport: syncToViewport };
  }

  function hydrate(root) {
    root = root || document;
    Array.from(root.querySelectorAll('[data-sdocs-sidebar-shell]')).forEach(function (element) {
      var template = document.getElementById(element.getAttribute('data-primary-template'));
      renderShell(element, {
        idPrefix: element.getAttribute('data-id-prefix') || element.id,
        rowClass: element.getAttribute('data-row-class') || '',
        navClass: element.getAttribute('data-nav-class') || '',
        brandId: element.getAttribute('data-brand-id') || '',
        responsiveBrand: element.hasAttribute('data-responsive-brand'),
        primaryHtml: template ? template.innerHTML : '',
        statusId: element.getAttribute('data-status-id') || '',
        authenticated: element.getAttribute('data-cloud-authenticated') === 'true',
        termsAccepted: element.getAttribute('data-cloud-terms-accepted') === 'true',
        returnTo: window.location.pathname + window.location.search,
      });
    });
    var marker = document.querySelector('[data-legacy-library]');
    if (marker) applyLibraryPreference(marker.dataset.legacyLibrary !== 'false');
  }

  exports.icons = icons;
  exports.topRowHtml = topRowHtml;
  exports.sectionHtml = sectionHtml;
  exports.sitePrimaryHtml = sitePrimaryHtml;
  exports.applyLibraryPreference = applyLibraryPreference;
  exports.bindSubscriptionUi = bindSubscriptionUi;
  exports.brandHtml = brandHtml;
  exports.accountActionsHtml = accountActionsHtml;
  exports.renderShell = renderShell;
  exports.setExpanded = setExpanded;
  exports.bindExpandableSections = bindExpandableSections;
  exports.bindMobileDrawer = bindMobileDrawer;
  exports.bindDesktopRail = bindDesktopRail;
  exports.hydrate = hydrate;
})(typeof module !== 'undefined' && module.exports
  ? module.exports : (window.SDocsSidebarShared = {}));

if (typeof document !== 'undefined') {
  window.SDocsSidebarShared.hydrate(document);
  if (document.readyState !== 'complete') document.addEventListener('DOMContentLoaded', window.SDocsSidebarShared.bindSubscriptionUi, { once: true });
  else window.SDocsSidebarShared.bindSubscriptionUi();
}
