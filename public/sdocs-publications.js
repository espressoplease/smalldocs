(function () {
  'use strict';
  var S = window.SDocs = window.SDocs || {};
  var state = { id: null, revision: null, publication: null, canPublish: false,
    loading: false, busy: false, error: '', signature: null, pending: null };
  var privateBusy = false, privateCreated = false, privateError = '';
  var moreIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>';

  function escape(value) {
    return String(value || '').replace(/[&<>"']/g,function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
  }
  function ordered(value) {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object') {
      var result = {}; Object.keys(value).sort().forEach(function (key) {result[key] = ordered(value[key]);});return result;
    }
    return value;
  }
  function signature(markdown) {
    var parsed = typeof markdown === 'string' ? SDocYaml.parseFrontMatter(markdown) : {meta:S.currentMeta || {},body:S.currentBody || ''};
    var meta = parsed.meta, styles = meta.styles || {};
    if (typeof markdown !== 'string' && typeof S.collectStyles === 'function') styles = S.collectStyles();
    if (window.SDocStyles) styles = SDocStyles.stripStyleDefaults(styles);
    styles = Object.assign({},styles);delete styles.fileinfo;
    return JSON.stringify(ordered([parsed.body,meta.title || '',meta.description || '',styles]));
  }
  function redraw() {
    if (S.renderFileInfoCard) S.renderFileInfoCard();
    if (S.refreshPublicationPanel) S.refreshPublicationPanel();
  }
  async function request(method, body) {
    var response = await fetch('/api/cloud/v1/documents/' + encodeURIComponent(state.id) + '/publication',{
      method: method || 'GET', credentials: 'same-origin',
      headers: {'Content-Type':'application/json'}, body: body == null ? undefined : JSON.stringify(body)
    });
    var data = await response.json();
    if (!response.ok) {
      var error = new Error(data.error || 'publication_failed'); error.code = data.error; throw error;
    }
    return data;
  }
  function apply(data) {
    state.publication = data.publication;
    state.canPublish = Boolean(data.can_publish);
    state.revision = data.head_revision_id || S.cloudDocument.current_revision_id;
    state.error = '';
  }
  async function refresh() {
    if (!state.id || state.loading) return;
    var owner = state, id = state.id, revision = S.cloudDocument.current_revision_id;
    state.loading = true;
    try {
      var data = await request();
      if (state !== owner || !S.cloudDocument || S.cloudDocument.id !== id) return;
      apply(data);
      // A status response describes the saved head, not edits typed while it was loading.
      var saved = S.cloudPublicationSource && S.cloudPublicationSource();
      state.signature = saved && typeof saved.markdown === 'string' ? signature(saved.markdown) : null;
      if (data.head_revision_id && data.head_revision_id !== revision) state.revision = revision;
    } catch (_) { if (state === owner) { state.error = 'Publishing details could not be loaded. Try again.'; state.revision = revision; } }
    finally { if (state === owner) {state.loading = false;redraw();} }
  }
  function observe() {
    var doc = S.cloudDocument;
    if (!doc) { if (state.id) state = {id:null,publication:null}; return; }
    if (state.id !== doc.id) state = {id:doc.id,revision:null,publication:null,canPublish:false,loading:false,busy:false,error:'',signature:null,pending:null};
    if (!state.loading && !state.busy && state.revision !== doc.current_revision_id) refresh();
  }
  function current() { observe(); return state.publication; }
  function dirty() {
    return state.publication && state.publication.active &&
      (!state.publication.is_current || state.signature !== signature());
  }
  function notify(message) { if (S.setStatus) S.setStatus(message); }
  async function publish() {
    if (!state.id || state.busy || !state.canPublish) return;
    var owner = state, id = state.id; state.busy = true; state.error = ''; redraw();
    try {
      if (S.saveCloudNow) await S.saveCloudNow();
      if (state !== owner || !S.cloudDocument || S.cloudDocument.id !== id) return;
      var source = S.cloudPublicationSource && S.cloudPublicationSource();
      if (!source || !source.saved || source.id !== id) throw new Error('unsaved_changes');
      var revision = S.cloudDocument.current_revision_id;
      if (!state.pending || state.pending.expected_revision_id !== revision) state.pending = {
        expected_revision_id:revision,idempotency_key:crypto.randomUUID()
      };
      var before = signature(), data = await request('POST',state.pending);
      if (state !== owner) return;
      state.pending = null; apply(data); state.signature = before;
      notify('Public page published.');
    } catch (error) {
      if (state !== owner) return;
      state.error = error.message === 'unsaved_changes' ? 'Save your latest edits to Cloud before publishing.' : error.code === 'revision_conflict'
        ? 'The document changed before publishing. Open the latest Cloud version, then try again.'
        : error.code === 'permission_denied' ? 'Only the document creator can publish this page.'
        : 'Publishing could not be confirmed. Refresh publishing details before trying again.';
    } finally { if (state === owner) {state.busy = false;redraw();} }
  }
  async function unpublish() {
    if (state.busy || !state.publication || !state.publication.can_manage) return;
    var owner = state; state.busy = true; state.error = ''; redraw();
    try {
      var data = await request('DELETE',{});
      if (state !== owner) return;
      apply(data); state.pending = null; notify('Public page unpublished.');
    } catch (_) { if (state === owner) state.error = 'The public page could not be unpublished. Try again.'; }
    finally { if (state === owner) {state.busy = false;redraw();} }
  }
  function action(label, handler, className) {
    var button = document.createElement('button'); button.type = 'button';
    button.className = className || 'fic-shorten-button'; button.textContent = label;
    button.addEventListener('click',handler); return button;
  }
  function help(text, section) {
    var link = document.createElement('a'); link.className = 'fic-short-intro-learn'; link.textContent = 'learn more';
    link.href = '/docs#sec=' + section; link.target = '_blank'; link.rel = 'noopener';
    link.setAttribute('aria-label',text); return link;
  }
  function renderActions(row) {
    observe();
    row.classList.add('fic-row-share');
    row.innerHTML = '<span class="fic-label">Share</span><div class="fic-share-actions"></div>';
    var actions = row.querySelector('.fic-share-actions');
    var privateGroup = document.createElement('span'); privateGroup.className = 'fic-share-option';
    var privateButton = action(privateBusy ? 'Creating private link...' : S.shortUrl || privateCreated ? 'Create new private link' : 'Create private link',async function () {
      if (privateBusy) return;
      var owner = state;
      privateBusy = true; privateError = ''; redraw();
      try {
        await S.generateShortLink();
        if (state === owner) {
          privateCreated = true;
          notify(S.shortUrl ? 'Private link created.' : 'The document changed while creating the link. Create a new link for the latest version.');
        }
      }
      catch (_) { if (state === owner) privateError = 'The private link could not be created. Try again.'; }
      finally { privateBusy = false; redraw(); }
    });
    privateButton.disabled = privateBusy;
    privateButton.title = 'Generate a short link for this document';
    privateGroup.append(privateButton,help('Learn about private links','short-links')); actions.appendChild(privateGroup);
    if (S.cloudDocument) {
      var publicGroup = document.createElement('span'); publicGroup.className = 'fic-share-option';
      var active = state.publication && state.publication.active;
      var publicButton = action(state.busy ? 'Publishing...' : state.error && !state.publication ? 'Retry publishing details'
        : !active ? 'Publish publicly' : dirty() ? 'Update public page' : 'Public page up to date',function () {
          if (state.error && !state.publication) { state.revision = null; refresh(); }
          else publish();
        });
      publicButton.disabled = state.loading || state.busy || (!state.canPublish && !state.error) || (active && !dirty());
      if (!state.canPublish && !state.loading) publicButton.title = 'Publishing requires the document creator and active Cloud access.';
      publicGroup.append(publicButton,help('Learn about public pages','public-pages')); actions.appendChild(publicGroup);
      if (state.publication && state.publication.can_manage) {
        var more = action('',function () { if (S.openPublicationPanel) S.openPublicationPanel(); },'fic-copy fic-publication-more');
        more.innerHTML = moreIcon; more.title = 'Manage public page';more.setAttribute('aria-label','Manage public page');
        row.appendChild(more);
      }
    }
    var message = privateError || state.error;
    if (message) { var error = document.createElement('span'); error.className = 'fic-shorten-error';error.setAttribute('role','status');error.textContent = message;actions.appendChild(error); }
  }
  function panelHtml() {
    var publication = state.publication;
    if (!publication || !publication.active) return '<p class="sdoc-cloud-lab-help">This document has no public page.</p>';
    return '<p class="sdoc-cloud-lab-help">Anyone can read this page. It can appear in search results.</p>' +
      '<label class="sdoc-cloud-lab-help">Public URL<input class="fic-publication-url" aria-label="Public URL" readonly value="'+escape(publication.url)+'"></label>' +
      '<p class="sdoc-cloud-lab-help">'+(dirty() ? 'Your latest edits are not published.' : 'Your public page is up to date.')+'</p>' +
      '<p class="sdoc-cloud-lab-help">Last published '+escape(new Date(publication.updated_at_ms || publication.published_at_ms).toLocaleString())+'.</p>' +
      '<p class="sdoc-cloud-lab-help"><a href="'+escape(publication.url)+'" target="_blank" rel="noopener">Open public page</a></p>' +
      '<div class="sdoc-cloud-lab-presets"><button type="button" data-publication-unpublish'+(state.busy?' disabled':'')+'>Unpublish</button></div>' +
      '<p class="sdoc-cloud-lab-help">Unpublishing removes the page from SmallDocs. Search engines and readers may retain copies.</p>' +
      (state.error ? '<p class="sdoc-cloud-lab-status" role="status">'+escape(state.error)+'</p>' : '');
  }
  function wirePanel(body) {
    var button = body.querySelector('[data-publication-unpublish]'); if (button) button.addEventListener('click',unpublish);
    var input = body.querySelector('.fic-publication-url'); if (input) input.addEventListener('click',function () {this.select();});
  }
  S.publications = {current:current,renderActions:renderActions,panelHtml:panelHtml,wirePanel:wirePanel,refresh:refresh};
  window.addEventListener('focus',function () { if (state.id) refresh(); });
})();
