// sdocs-app-runner.js - bootstrap for one sandboxed `sdoc-app` iframe.
(function () {
  'use strict';

  var token = new URLSearchParams(window.location.search).get('token') || '';
  if (!token) return;
  var runnerScriptUrl = document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : window.location.href;
  var fontBase = new URL('./fonts/', runnerScriptUrl).href;

  function componentDefaults() {
    return [
      '@layer sdocs-component-defaults {',
      '@font-face { font-family: Inter; font-style: normal; font-weight: 400; font-display: swap; src: url("' + fontBase + 'inter-400.woff2") format("woff2"); }',
      '@font-face { font-family: Inter; font-style: normal; font-weight: 500; font-display: swap; src: url("' + fontBase + 'inter-500.woff2") format("woff2"); }',
      '@font-face { font-family: Inter; font-style: normal; font-weight: 600; font-display: swap; src: url("' + fontBase + 'inter-600.woff2") format("woff2"); }',
      ':root { }',
      'html { min-width: 0; color: var(--sdoc-app-color); background: var(--sdoc-app-background); font-family: var(--sdoc-app-font-family); font-size: var(--sdoc-app-font-size); line-height: var(--sdoc-app-line-height); color-scheme: var(--sdoc-app-color-scheme); }',
      '*, *::before, *::after { box-sizing: border-box; }',
      'body { min-width: 0; margin: 0; padding: var(--sdoc-app-padding, clamp(16px, 4vw, 32px)); color: var(--sdoc-app-color); background: var(--sdoc-app-background); font: inherit; }',
      'h1, h2, h3, h4, h5, h6 { color: var(--sdoc-app-heading-color); font-family: var(--sdoc-app-heading-font-family); line-height: 1.2; }',
      'h1 { margin: 0 0 .65em; font-size: calc(var(--sdoc-app-h1-size) * var(--sdoc-app-heading-scale)); font-weight: var(--sdoc-app-h1-weight); letter-spacing: -.02em; }',
      'h2 { margin: 1.35em 0 .55em; font-size: calc(var(--sdoc-app-h2-size) * var(--sdoc-app-heading-scale)); font-weight: var(--sdoc-app-h2-weight); letter-spacing: -.015em; }',
      'h3 { margin: 1.15em 0 .5em; font-size: calc(var(--sdoc-app-h3-size) * var(--sdoc-app-heading-scale)); font-weight: var(--sdoc-app-h3-weight); }',
      'h4, h5, h6 { margin: 1em 0 .45em; font-size: 1em; font-weight: 600; }',
      'p, ul, ol, dl, blockquote, pre, table { margin: 0 0 var(--sdoc-app-block-spacing); }',
      'small, caption, .muted { color: var(--sdoc-app-muted-color); }',
      'ul, ol { padding-left: 1.5em; }',
      'a { color: var(--sdoc-app-accent-color); text-decoration-thickness: .08em; text-underline-offset: .14em; }',
      'hr { margin: var(--sdoc-app-block-spacing) 0; border: 0; border-top: 1px solid var(--sdoc-app-border-color); }',
      'code, pre { font-family: var(--sdoc-app-code-font-family); }',
      ':not(pre) > code { padding: .12em .4em; background: var(--sdoc-app-surface); border-radius: calc(var(--sdoc-app-radius) * .5); font-size: .88em; }',
      'button, input, select, textarea { color: inherit; font: inherit; }',
      'button, input, select, textarea { border: 1px solid var(--sdoc-app-border-color); border-radius: var(--sdoc-app-radius); }',
      'button, select, input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), textarea { padding: .58em .75em; background: var(--sdoc-app-surface); }',
      'button { cursor: pointer; }',
      'button:hover { border-color: var(--sdoc-app-accent-color); }',
      'button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--sdoc-app-accent-color); outline-offset: 2px; }',
      'fieldset { min-width: 0; border: 1px solid var(--sdoc-app-border-color); border-radius: var(--sdoc-app-radius); }',
      'table { width: 100%; border-collapse: collapse; }',
      'th, td { padding: .55em .7em; border-bottom: 1px solid var(--sdoc-app-border-color); text-align: left; }',
      'img, svg, canvas, video { max-width: 100%; }',
      '}',
    ].join('');
  }

  function bridgeSource(design) {
    var encodedDesign = JSON.stringify(design || {}).replace(/</g, '\\u003c');
    return [
      '(function(){',
      'var token=' + JSON.stringify(token) + ';',
      'var design=' + encodedDesign + ';',
      'var defaultCss=' + JSON.stringify(componentDefaults()) + ';',
      'var lastHeight=0;',
      'function send(type,extra){var message=Object.assign({type:type,token:token},extra||{});parent.postMessage(message,"*");}',
      'function installDesign(){var style=document.createElement("style");style.id="sdocs-component-defaults";style.textContent=defaultCss;(document.head||document.documentElement).appendChild(style);var rule;var applied=[];try{var rules=style.sheet.cssRules[0].cssRules;for(var i=0;i<rules.length;i+=1){if(rules[i].selectorText===":root"){rule=rules[i];break;}}}catch(_){}if(!rule)return function(){};return function(next){next=next||{};applied.forEach(function(name){if(!Object.prototype.hasOwnProperty.call(next,name))rule.style.removeProperty(name);});applied=Object.keys(next).filter(function(name){return /^--sdoc-app-[a-z0-9-]+$/.test(name);});applied.forEach(function(name){rule.style.setProperty(name,String(next[name]));});};}',
      'var applyDesign=installDesign();applyDesign(design);',
      'function receiveDesign(event){var message=event.data;if(event.source!==parent||!message||message.type!=="sdocs-app-design"||message.token!==token)return;applyDesign(message.design);}',
      'addEventListener("message",receiveDesign);',
      'function px(value){var number=parseFloat(value);return Number.isFinite(number)?number:0;}',
      // scrollHeight includes transformed visual overflow and is never shorter than the
      // iframe viewport. Feeding it back into the viewport height can oscillate forever.
      'function measure(){var body=document.body;if(!body)return;var rect=body.getBoundingClientRect();var style=getComputedStyle(body);var height=Math.ceil(Math.max(body.offsetHeight,rect.height)+px(style.marginTop)+px(style.marginBottom));height=Math.max(0,height);if(height!==lastHeight){lastHeight=height;send("sdocs-app-size",{height:height});}}',
      'function start(){send("sdocs-app-mounted");measure();if(typeof ResizeObserver==="function"){var observer=new ResizeObserver(measure);if(document.documentElement)observer.observe(document.documentElement);if(document.body)observer.observe(document.body);}addEventListener("resize",measure);addEventListener("load",measure);setTimeout(measure,0);setTimeout(measure,250);}',
      'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();',
      '})();',
    ].join('');
  }

  function injectBridge(source, design) {
    var script = '<script>' + bridgeSource(design) + '</scr' + 'ipt>';
    var html = String(source == null ? '' : source);
    if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, '$&' + script);
    if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, '$&<head>' + script + '</head>');
    return script + html;
  }

  function receive(event) {
    var message = event.data;
    if (event.source !== parent || !message || message.type !== 'sdocs-app-load') return;
    if (message.token !== token || typeof message.source !== 'string') return;
    window.removeEventListener('message', receive);
    document.open();
    document.write(injectBridge(message.source, message.design));
    document.close();
  }

  window.addEventListener('message', receive);
  parent.postMessage({ type: 'sdocs-app-ready', token: token }, '*');
})();
