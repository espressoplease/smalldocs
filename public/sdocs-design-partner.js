/**
 * Design-partner nudge. Turns retained usage into leads: a top strip invites
 * visitors to leave a first name + work email for the (in-progress) teams
 * version. Submissions POST to /api/teams-interest - the same pipe as the
 * homepage Teams form - so nothing new is stored server-side. There is no
 * dismiss: only submitting hides it.
 *
 * Two nets, driven by `init(mode)`:
 *   - 'home': counts homepage loads, shows on the 5th and again on the 25th.
 *   - 'doc':  counts DISTINCT documents opened (by #md fingerprint), shows on
 *             the 5th and again on the 25th distinct doc. This catches CLI
 *             users, who land on document pages, not the homepage.
 *
 * Counting is entirely client-side (localStorage); nothing is sent unless the
 * visitor types an email and submits. Submitting anywhere suppresses the strip
 * everywhere. Dismissing at the 5th lets it return once at the 25th, then stop.
 */
(function () {
  var THRESHOLDS = [5, 25];
  var SUBMITTED_KEY = '_sd_dp_submitted';
  var DOC_OPENS_KEY = '_sd_doc_opens';   // JSON array of distinct doc fingerprints
  var HOME_COUNT_KEY = '_sd_home_visits'; // integer homepage load count
  var SHOWN_KEY = { home: '_sd_dp_home_shown', doc: '_sd_dp_doc_shown' };

  function getNum(key) {
    try { return parseInt(localStorage.getItem(key), 10) || 0; } catch (_) { return 0; }
  }
  function setNum(key, n) { try { localStorage.setItem(key, String(n)); } catch (_) {} }
  function submitted() {
    // Treat a storage failure as "already submitted" so a browser with storage
    // blocked never shows the strip on every single load.
    try { return localStorage.getItem(SUBMITTED_KEY) === '1'; } catch (_) { return true; }
  }

  function docFingerprint() {
    var h = location.hash || '';
    var m = /[#&]md=([^&]+)/.exec(h);
    return m ? m[1].slice(0, 48) : '';
  }

  // Record the current visit and return the running count for this mode.
  // Returns -1 for a 'doc' call that isn't actually on a document.
  function recordAndCount(mode) {
    if (mode === 'doc') {
      var fp = docFingerprint();
      if (!fp) return -1;
      var seen = [];
      try { seen = JSON.parse(localStorage.getItem(DOC_OPENS_KEY) || '[]'); } catch (_) { seen = []; }
      if (!Array.isArray(seen)) seen = [];
      if (seen.indexOf(fp) === -1) {
        seen.push(fp);
        if (seen.length > 60) seen = seen.slice(-60);
        try { localStorage.setItem(DOC_OPENS_KEY, JSON.stringify(seen)); } catch (_) {}
      }
      return seen.length;
    }
    var n = getNum(HOME_COUNT_KEY) + 1;
    setNum(HOME_COUNT_KEY, n);
    return n;
  }

  // Highest threshold this count has reached that hasn't been shown yet for
  // this mode. 0 means show nothing right now.
  function dueThreshold(mode, count) {
    var shown = getNum(SHOWN_KEY[mode]);
    var due = 0;
    for (var i = 0; i < THRESHOLDS.length; i++) {
      if (count >= THRESHOLDS[i] && THRESHOLDS[i] > shown) due = THRESHOLDS[i];
    }
    return due;
  }

  function post(name, email, sourceTag, honeypot) {
    // The teams-interest pipe has no dedicated name column, so the first name
    // rides in the message field (shows in the email ping and the stored row).
    var who = name ? name + ' - ' : '';
    return fetch('/api/teams-interest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        company: '',
        message: who + 'design-partner interest via in-app banner (' + sourceTag + ').',
        website: honeypot || '',
      }),
    });
  }

  function thanks(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    var ok = document.createElement('span');
    ok.className = 'sd-dp-text';
    ok.textContent = 'Thank you. We will be in touch.';
    el.appendChild(ok);
    el.hidden = false;
  }

  // Render the copy + capture form into `el`. `sourceTag` is a short string
  // recorded with the submission (e.g. 'homepage, 5 visits', 'info panel') so
  // leads are attributable. Shared by the top strips and the info panel.
  function renderForm(el, sourceTag) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);

    var text = document.createElement('span');
    text.className = 'sd-dp-text';
    text.textContent = "We're building SmallDocs for teams. Become a design partner and get a free plan for your org.";

    var form = document.createElement('form');
    form.className = 'sd-dp-form';
    form.setAttribute('novalidate', 'novalidate');

    var name = document.createElement('input');
    name.type = 'text';
    name.className = 'sd-dp-name';
    name.placeholder = 'first name';
    name.setAttribute('autocomplete', 'given-name');
    name.setAttribute('aria-label', 'First name');

    var input = document.createElement('input');
    input.type = 'email';
    input.className = 'sd-dp-email';
    input.placeholder = 'work email';
    input.setAttribute('autocomplete', 'email');
    input.setAttribute('aria-label', 'Work email');

    // Honeypot: off-screen via CSS, invisible to humans, tempting to naive
    // bots. A filled value is dropped server-side (see handleTeamsInterestPost).
    var hp = document.createElement('input');
    hp.type = 'text';
    hp.className = 'sd-dp-hp';
    hp.tabIndex = -1;
    hp.setAttribute('autocomplete', 'off');
    hp.setAttribute('aria-hidden', 'true');

    var submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'sd-dp-submit';
    submit.textContent = 'Learn More';

    var status = document.createElement('span');
    status.className = 'sd-dp-status';

    form.appendChild(name);
    form.appendChild(input);
    form.appendChild(hp);
    form.appendChild(submit);
    form.appendChild(status);

    // No dismiss on either surface. The doc net is gated (shows once at the
    // 5th distinct doc, once at the 25th, then never) and the homepage is a
    // standing strip, so a × does no real work - it only closes the current
    // instance, which the gate already controls. Only submitting hides it.
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      // No email filtering by design - any address (gmail included) is fine.
      // We only check the fields aren't blank so a stray click doesn't send an
      // empty row.
      var who = name.value.trim().slice(0, 60);
      var addr = input.value.trim();
      if (!who || !addr) {
        status.textContent = 'Enter your name and email.';
        status.classList.add('sd-dp-err');
        (who ? input : name).focus();
        return;
      }
      status.classList.remove('sd-dp-err');
      status.textContent = 'Sending…';
      submit.disabled = true;
      post(who, addr, sourceTag, hp.value).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        try { localStorage.setItem(SUBMITTED_KEY, '1'); } catch (_) {}
        thanks(el);
      }).catch(function () {
        submit.disabled = false;
        status.classList.add('sd-dp-err');
        status.textContent = 'Something went wrong; nothing was sent.';
      });
    });

    el.appendChild(text);
    el.appendChild(form);
    el.hidden = false;
  }

  function showBanner(mode, threshold) {
    renderForm(document.getElementById('_sd_dp-banner'), mode + ', ' + threshold + ' visits');
  }

  // Public: render the same form into an arbitrary container (the info side
  // panel). Always present; if the visitor already submitted, show the thanks
  // instead of the form.
  function mount(el, source) {
    if (!el) return;
    if (submitted()) { thanks(el); return; }
    renderForm(el, source || 'info panel');
  }

  function init(mode) {
    if (mode !== 'home' && mode !== 'doc') return;
    if (submitted()) return;
    var count;
    try { count = recordAndCount(mode); } catch (_) { return; }

    // Homepage: always visible (a standing "building for teams" strip). We
    // still count loads so the submission records how many visits it took to
    // convert, but the count never gates the banner.
    if (mode === 'home') {
      try { showBanner('home', count); } catch (_) {}
      return;
    }

    // Document pages: gated on distinct docs opened - the strip only appears
    // once someone has clearly used SmallDocs (5th doc, then again at the 25th).
    if (count < THRESHOLDS[0]) return;
    var due = dueThreshold(mode, count);
    if (!due) return;
    setNum(SHOWN_KEY[mode], due);
    try { showBanner(mode, due); } catch (_) {}
  }

  window.SDocsDesignPartner = { init: init, mount: mount };
})();
