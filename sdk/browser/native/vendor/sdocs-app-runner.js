// sdocs-app-runner.js - bootstrap for one sandboxed `sdoc-app` iframe.
(function () {
  'use strict';

  var token = new URLSearchParams(window.location.search).get('token') || '';
  if (!token) return;

  function bridgeSource() {
    return [
      '(function(){',
      'var token=' + JSON.stringify(token) + ';',
      'var lastHeight=0;',
      'function send(type,extra){var message=Object.assign({type:type,token:token},extra||{});parent.postMessage(message,"*");}',
      'function px(value){var number=parseFloat(value);return Number.isFinite(number)?number:0;}',
      'function measure(){var root=document.documentElement;var body=document.body;if(!body)return;var rect=body.getBoundingClientRect();var style=getComputedStyle(body);var height=Math.ceil(Math.max(body.offsetHeight,rect.height)+px(style.marginTop)+px(style.marginBottom));var viewport=Math.max(innerHeight,root?root.clientHeight:0);var scroll=Math.max(root?root.scrollHeight:0,body.scrollHeight);if(scroll>viewport+1)height=Math.max(height,scroll);height=Math.max(0,height);if(height!==lastHeight){lastHeight=height;send("sdocs-app-size",{height:height});}}',
      'function start(){send("sdocs-app-mounted");measure();if(typeof ResizeObserver==="function"){var observer=new ResizeObserver(measure);if(document.documentElement)observer.observe(document.documentElement);if(document.body)observer.observe(document.body);}addEventListener("resize",measure);addEventListener("load",measure);setTimeout(measure,0);setTimeout(measure,250);}',
      'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();',
      '})();',
    ].join('');
  }

  function injectBridge(source) {
    var script = '<script>' + bridgeSource() + '</scr' + 'ipt>';
    var html = String(source == null ? '' : source);
    if (/<\/head\s*>/i.test(html)) return html.replace(/<\/head\s*>/i, script + '</head>');
    if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, script + '</body>');
    return html + script;
  }

  function receive(event) {
    var message = event.data;
    if (event.source !== parent || !message || message.type !== 'sdocs-app-load') return;
    if (message.token !== token || typeof message.source !== 'string') return;
    window.removeEventListener('message', receive);
    document.open();
    document.write(injectBridge(message.source));
    document.close();
  }

  window.addEventListener('message', receive);
  parent.postMessage({ type: 'sdocs-app-ready', token: token }, '*');
})();
