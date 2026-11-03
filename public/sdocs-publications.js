(function () {
  'use strict';
  var S = window.SDocs = window.SDocs || {};
  var state = { id: null, revision: null, publication: null, canPublish: false,
    loading: false, busy: false, error: '', signature: null, pending: null };
  var privateBusy = false, privateError = '';
  var panelSignature = null;
  var expanded = {private:false,public:false};
  var keyIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>';
  var globeIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';

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
    update();
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
    var owner = state; state.busy = true; state.removing = true; state.error = ''; redraw();
    try {
      var data = await request('DELETE',{});
      if (state !== owner) return;
      apply(data); state.pending = null; notify('Public page unpublished.');
    } catch (_) { if (state === owner) state.error = 'The public page could not be unpublished. Try again.'; }
    finally { if (state === owner) {state.busy = false;state.removing = false;redraw();} }
  }
  function viewingPublic() { return S.publicationSource && S.publicationSource.isViewing(); }
  function sharedPublication() {
    return viewingPublic() ? {active:true,url:S.publicationSnapshot.url,is_current:true} : state.publication;
  }
  function publicationStatus() {
    var publication=sharedPublication();
    if (!publication || !publication.active) return '';
    if (viewingPublic()) return 'published';
    if (dirty()) return 'outdated';
    return state.error || state.loading || state.busy ? 'checking' : 'current';
  }
  function help(text, section) {
    return '<a href="/docs#sec='+section+'" target="_blank" rel="noopener">'+text+'</a>';
  }
  function linkControls(label,url) {
    return '<label class="sdoc-share-label">'+label+'<span class="sdoc-share-url">'
      +'<input aria-label="'+label+'" readonly value="'+escape(url)+'">'
      +'<button type="button" class="btn sdoc-share-copy" data-share-copy="'+escape(url)+'" aria-label="Copy '+label.charAt(0).toLowerCase()+label.slice(1)+'">'+(S.copyIcon || 'Copy')+'</button></span></label>';
  }
  function actionContent(label,icon,description,id) {
    return icon+'<span class="export-option-text"><span class="export-option-title">'+label+'</span><span class="export-option-desc"'+(id?' id="'+id+'-summary"':'')+'>'+description+'</span></span>';
  }
  function button(label,attribute,disabled) {
    var primary=attribute==='data-share-private'||attribute==='data-share-publish';
    return '<button type="button" class="btn'+(primary?' sdoc-share-primary':'')+'" aria-label="'+label+'" '+attribute+(disabled?' disabled':'')+'>'+label+'</button>';
  }
  function disclosure(kind,title,icon,description,content) {
    var isOpen=expanded[kind], id='_sd_share-'+kind;
    return '<section class="panel-section"><button type="button" class="export-option panel-header sdoc-share-toggle'+(isOpen?' open':'')+'" data-share-toggle="'+kind+'" aria-label="'+title+'" aria-describedby="'+id+'-summary" aria-expanded="'+isOpen+'" aria-controls="'+id+'">'
      +actionContent(title,icon,description,id)+'<span class="arrow" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></span></button>'
      +'<div id="'+id+'" class="sdoc-share-disclosure'+(isOpen?' open':'')+'" aria-hidden="'+!isOpen+'"'+(isOpen?'':' inert')+'><div><div class="sdoc-share-section">'+content+'</div></div></div></section>';
  }
  async function createPrivate() {
    if (privateBusy) return;
    privateBusy=true;privateError='';redraw();
    try {
      await S.generateShortLink();
      notify(S.shortUrl ? 'Private link created.' : 'The document changed while creating the link. Create a new link for the latest version.');
    } catch (_) {privateError='The private link could not be created. Try again.';}
    finally {privateBusy=false;redraw();}
  }
  function panelHtml() {
    var publication=sharedPublication(), active=publication&&publication.active;
    var privateHtml=button(privateBusy?'Creating private link...':S.shortUrl?'Create new private link':'Create private link','data-share-private',privateBusy)
      +(S.shortUrl?linkControls('Private URL',S.shortUrl):'')
      +(privateError?'<p class="sdoc-share-status sdoc-share-error" role="status">'+escape(privateError)+'</p>':'')
      +'<p>Anyone with the complete link can read this copy, without signing in. They can also pass the link on.</p>'
      +'<p>Your browser encrypts this copy before uploading it. The decryption key is included after <code>#k=</code> in the URL. The reader&#39;s browser uses it to open the copy; the key is not sent to our server.</p>'
      +'<p>This link opens a fixed copy. Later edits do not change it; create a new link to share a newer version.</p>'
      +help('Learn about private links','short-links');
    var publicHtml='';
    if(S.cloudDocument){
      publicHtml+=button(state.busy&&!state.removing?'Publishing...':state.error&&!state.publication?'Retry publishing details':!active?'Publish publicly':dirty()?'Update public page':'Public page up to date','data-share-publish',state.loading||state.busy||(!state.canPublish&&!state.error)||(active&&!dirty()));
    }else if(active){
      publicHtml+='<a class="export-option sdoc-share-action" aria-label="Open public page" href="'+escape(publication.url)+'" target="_blank" rel="noopener">'+actionContent('Open public page',globeIcon,'Read the published version')+'</a>';
    }
    if(active){
      publicHtml+=linkControls('Public URL',publication.url)
        +'<p class="sdoc-share-status" role="status">'+(publicationStatus()==='outdated'?'Your latest edits are not published.':publicationStatus()==='current'?'Your public page is up to date.':publicationStatus()==='published'?'This is the published copy.':'Checking publishing details...')+'</p>'
        +(publication.updated_at_ms||publication.published_at_ms?'<p>Last published '+escape(new Date(publication.updated_at_ms||publication.published_at_ms).toLocaleString())+'.</p>':'');
      if(S.cloudDocument)publicHtml+='<a aria-label="Open public page" href="'+escape(publication.url)+'" target="_blank" rel="noopener">Open public page</a>';
    }
    publicHtml+='<p>Publish a public copy of this document on the web. Anyone can open it, and search engines may crawl it and show it in search results.</p>'
      +'<p>Edits are not published automatically. Choose <strong>Update public page</strong> to publish your latest version at the same URL.</p>'
      +help('Learn about public pages','public-pages');
    if(S.cloudDocument){
      if(!state.canPublish&&!state.loading)publicHtml+='<p>Only the document creator with active Cloud access can publish or update this page.</p>';
      if(active&&publication.can_manage){
        publicHtml+=button(state.removing?'Unpublishing...':'Unpublish','data-publication-unpublish',state.busy)
          +'<p>Unpublishing removes the page from SmallDocs. Search engines and readers may retain copies.</p>';
      }
      if(state.error)publicHtml+='<p class="sdoc-share-status sdoc-share-error" role="status">'+escape(state.error)+'</p>';
    }else if(!viewingPublic()){
      publicHtml+='<p>Save this document to Cloud to publish a public page.</p>';
    }
    return disclosure('private','Private link',keyIcon,'An encrypted copy for people with the link',privateHtml)
      +disclosure('public','Public page',globeIcon,'A web page anyone can read and search engines may find',publicHtml);
  }
  function wirePanel(body) {
    body.querySelectorAll('[data-share-toggle]').forEach(function(toggle){toggle.addEventListener('click',function(){
      var kind=toggle.dataset.shareToggle, isOpen=!expanded[kind], content=body.querySelector('#'+toggle.getAttribute('aria-controls'));
      expanded[kind]=isOpen;toggle.classList.toggle('open',isOpen);toggle.setAttribute('aria-expanded',String(isOpen));
      content.classList.toggle('open',isOpen);content.setAttribute('aria-hidden',String(!isOpen));content.inert=!isOpen;
      panelSignature=panelHtml();
    });});
    var privateButton=body.querySelector('[data-share-private]');if(privateButton)privateButton.addEventListener('click',createPrivate);
    var publicButton=body.querySelector('[data-share-publish]');if(publicButton)publicButton.addEventListener('click',function(){
      if(state.error&&!state.publication){state.revision=null;refresh();}else publish();
    });
    var withdraw=body.querySelector('[data-publication-unpublish]');if(withdraw)withdraw.addEventListener('click',unpublish);
    body.querySelectorAll('input[readonly]').forEach(function(input){input.addEventListener('click',function(){this.select();});});
    body.querySelectorAll('[data-share-copy]').forEach(function(copy){copy.addEventListener('click',async function(){
      try{await S.copyWithIconFeedback(copy.dataset.shareCopy,copy);notify('Link copied.');}
      catch(_){notify('The link could not be copied. Select and copy it from the field.');}
    });});
  }
  function update() {
    observe();
    var share=document.getElementById('_sd_btn-share');if(!share)return;
    var status=publicationStatus();
    share.dataset.publicationStatus=status;
    share.classList.toggle('has-unseen',status==='current'||status==='published'||status==='outdated');
    share.style.setProperty('--btn-dot-color',status==='outdated'?'#f59e0b':'#16a34a');
    var description=status==='published'?'Already shared: public page':status==='current'?'Already shared: public page up to date':status==='outdated'?'Already shared: public page needs updating':status==='checking'?'Checking public page status':'Share outside of your cloud';
    share.setAttribute('aria-description',description);
    share.dataset.tip=description;
    share.disabled=!S.currentBody||S._isDefaultState;
    var body=document.getElementById('_sd_share-panel');
    if(body&&S.currentMode==='share'){
      var html=panelHtml();
      if(html!==panelSignature){
        var focusedToggle=body.contains(document.activeElement)&&document.activeElement.getAttribute('data-share-toggle');
        panelSignature=html;body.innerHTML=html;wirePanel(body);
        if(focusedToggle)body.querySelector('[data-share-toggle="'+focusedToggle+'"]').focus({preventScroll:true});
      }
    }
  }
  function open() {if(S.setMode)S.setMode(S.currentMode==='share'?'read':'share');}
  var shareButton=document.getElementById('_sd_btn-share');if(shareButton)shareButton.addEventListener('click',open);
  document.addEventListener('keydown',function(event){if(event.key==='Escape'&&S.currentMode==='share'){S.setMode('read');shareButton.focus();}});
  S.publications={current:current,update:update,open:open,refresh:refresh,
    // A cached pre-update app may briefly call the old file-info entry point.
    renderActions:function(row){row.hidden=true;}};
  window.addEventListener('focus',function(){if(state.id)refresh();});
})();
