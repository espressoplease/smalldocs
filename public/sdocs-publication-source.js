/* Public copies use the same app and document renderer as private share links. */
(function () {
  'use strict';
  var S=window.SDocs, element=document.getElementById('sdocs-publication-data');
  if (!element) return;
  var snapshot;
  try {snapshot=JSON.parse(element.textContent);} catch (_) {return;}
  if (!snapshot || typeof snapshot.url!=='string') return;
  S.publicationCompile = snapshot.compile === true;
  S.publicationSnapshot = snapshot;
  var baseline=null;
  function legacyStyles(parsed) {
    var css=Array.prototype.map.call(parsed.querySelectorAll('style'),function(style){return style.textContent;}).join('\n');
    function recover(selector) {
      var match=selector.exec(css), values=S.readAllControlValues(), colors=new Set();
      if(!match)return {};
      var declaration=document.createElement('div').style;declaration.cssText=match[1];
      Object.keys(SDocStyles.CTRL_CSS_MAP).forEach(function(id){
        var entry=SDocStyles.CTRL_CSS_MAP[id],value=declaration.getPropertyValue(entry.cssVar).trim();
        if(!value)return;
        if(entry.compound){var border=value.match(/^([\d.]+)px solid (#[a-f0-9]{6})$/i);if(border)value=border[id==='_sd_ctrl-bq-bw-num'?1:2];else return;}
        else if(entry.template){var margin=value.match(/^0 0 ([\d.]+)em$/);if(margin)value=margin[1];else return;}
        else if(entry.suffix&&value.endsWith(entry.suffix))value=value.slice(0,-entry.suffix.length);
        values[id]=value;if(SDocStyles.ALL_COLOR_IDS.indexOf(id)>=0)colors.add(id);
      });
      Object.keys(SDocStyles.COLOR_VAR_MAP).forEach(function(id){
        var variable=SDocStyles.COLOR_VAR_MAP[id],value=declaration.getPropertyValue(Array.isArray(variable)?variable[0]:variable).trim();
        if(value){values[id]=value;colors.add(id);}
      });
      return SDocStyles.collectStyles(values,colors);
    }
    var styles=recover(/html #_sd_rendered\{([^}]*)\}/);
    var dark=recover(/html\[data-theme="dark"\] #_sd_rendered\{([^}]*)\}/);
    if(Object.keys(dark).length)styles.dark=dark;
    return styles;
  }
  function legacyMarkdown() {
    var parsed=new DOMParser().parseFromString(snapshot.legacyHtml,'text/html');
    var root=parsed.getElementById('_sd_rendered');
    if (!root) return '';
    var metadata=root.querySelector('.publication-meta');if(metadata) metadata.remove();
    var generated=root.querySelector(':scope > h1:not([id])');if(generated) generated.remove();
    root.querySelectorAll('pre > code').forEach(function(code){
      if(!root.contains(code))return;
      var source=code.textContent, language=(code.className.match(/(?:^|\s)language-([\w+-]+)/)||[,''])[1];
      var fence='`'.repeat(Math.max(3,Math.max.apply(null,(source.match(/`+/g)||['']).map(function(run){return run.length;}))+1));
      (code.closest('.publication-rich')||code.parentElement).replaceWith(parsed.createTextNode('\n\n'+fence+language+'\n'+source.replace(/\n$/,'')+'\n'+fence+'\n\n'));
    });
    return SDocYaml.serializeFrontMatter({styles:legacyStyles(parsed)})+'\n'+Array.prototype.map.call(root.childNodes,function(node){return node.nodeType===3?node.textContent:node.outerHTML;}).join('\n\n');
  }
  function viewState() {
    var params=new URLSearchParams(location.hash.slice(1));
    var mode=params.get('mode');S.setMode(['read','style','write','raw','export','info','comment'].indexOf(mode)>=0?mode:'read',true);
    var section=params.get('sec');
    if(section){var target=document.getElementById(section);if(target){if(S.openSectionAncestors)S.openSectionAncestors(target);target.scrollIntoView({block:'start'});}}
  }
  async function load() {
    S._isDefaultState=false;S._loadingDocument=true;
    S.localMeta={};S.resetAllStyles();
    var markdown=typeof snapshot.markdown==='string'?snapshot.markdown:legacyMarkdown();
    if(snapshot.legacyHtml&&typeof snapshot.markdown==='string'){
      var source=SDocYaml.parseFrontMatter(markdown);
      if(!source.meta.styles){source.meta.styles=legacyStyles(new DOMParser().parseFromString(snapshot.legacyHtml,'text/html'));markdown=SDocYaml.serializeFrontMatter(source.meta)+'\n'+source.body;}
    }
    S.loadText(markdown);
    clearTimeout(S._hashTimer);
    S._loadingDocument=false;
    baseline=S.serializeCurrentDocument();
    S.renderFileInfoCard();
    viewState();
    await S.publicationRenderReady;
    if(window.SDocSlides)await window.SDocSlides.ready();
    document.documentElement.dataset.publicationReady='true';
  }
  S.publicationSource={
    snapshot:snapshot,
    isViewing:function(){return snapshot.compile===true||/^\/p\//.test(location.pathname);},
    unchanged:function(){return !S.cloudDocument&&baseline!==null&&baseline===S.serializeCurrentDocument();},
    reconcile:function(source){if(source==='theme'){baseline=S.serializeCurrentDocument();S.renderFileInfoCard();}},
    viewState:viewState,
    rootLoaded:function(){return baseline!==null;}
  };
  S.Sources.register({name:'public-publication',matches:function(){return /^\/p\//.test(location.pathname)||snapshot.compile===true;},create:function(){return {name:'public-publication',capabilities:{canSave:false,canWatch:false,canSubmit:false},load:load};}});
})();
