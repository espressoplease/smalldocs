// sdocs-code-reader.js - canonical inline controls for code blocks.
(function (exports) {
  'use strict';

  var COPY_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var WRAP_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><path d="m16 16-2 2 2 2"/><path d="M3 18h7"/></svg>';
  var CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  var EXPAND_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
  var COMMENT_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/></svg>';
  var AGENT_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 7.5 8 10l2 2.5"/><path d="m14 7.5 2 2.5-2 2.5"/><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  var RESERVED = { chart: 1, mermaid: 1, cells: 1, form: 1, math: 1, slide: 1, slides: 1 };

  function languageOf(code) {
    var match = (code && code.className || '').match(/(?:^|\s)language-([\w+#-]+)/i);
    return match ? match[1].toLowerCase() : '';
  }

  function refreshWrapButton(pre, button) {
    if (!pre || !button) return;
    if (pre.classList.contains('wrapped')) {
      button.style.display = '';
      return;
    }
    button.style.display = pre.scrollWidth > pre.clientWidth + 1 ? '' : 'none';
  }

  function create(options) {
    options = options || {};
    var destroyed = false;
    var ResizeObserverCtor = options.ResizeObserver || window.ResizeObserver;
    var resizeObserver = typeof ResizeObserverCtor === 'function'
      ? new ResizeObserverCtor(refresh)
      : null;

    function root() {
      return typeof options.root === 'function' ? options.root() : options.root;
    }

    function setHTML(node, html) {
      if (options.setHTML) options.setHTML(node, String(html));
      else node.innerHTML = html;
    }

    function focus() {
      return typeof options.focus === 'function' ? options.focus() : options.focus;
    }

    function controls(name) {
      var value = typeof options.controls === 'function' ? options.controls() : options.controls;
      return !value || value[name] !== false;
    }

    function copyText(text, button) {
      var clipboard = options.clipboard || (typeof navigator !== 'undefined' && navigator.clipboard);
      if (!clipboard || !clipboard.writeText) return;
      clipboard.writeText(text).then(function () {
        var before = button.innerHTML;
        setHTML(button, CHECK_SVG);
        setTimeout(function () {
          if (button && button.isConnected) setHTML(button, before || COPY_SVG);
        }, 1200);
      });
    }

    function refresh() {
      var currentRoot = root();
      if (!currentRoot) return;
      currentRoot.querySelectorAll('.pre-wrapper').forEach(function (wrapper) {
        var pre = wrapper.querySelector(':scope > pre');
        var button = wrapper.querySelector(':scope > .pre-tools > .wrap-btn');
        refreshWrapButton(pre, button);
      });
    }

    function attach(container) {
      if (destroyed || !container) return;
      if (resizeObserver) resizeObserver.disconnect();
      var agentShown = false;
      var agentTotal = options.agentAnnotationCount ? options.agentAnnotationCount() : 0;
      var isWalk = options.isWalkthrough ? !!options.isWalkthrough() : false;

      container.querySelectorAll('pre').forEach(function (pre, index) {
        if (pre.parentElement && pre.parentElement.classList.contains('pre-wrapper')) return;

        var wrapper = document.createElement('div');
        wrapper.className = 'pre-wrapper';
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        var tools = document.createElement('div');
        tools.className = 'pre-tools';
        wrapper.appendChild(tools);

        var wrapButton = document.createElement('button');
        wrapButton.type = 'button';
        wrapButton.className = 'wrap-btn';
        setHTML(wrapButton, WRAP_SVG);
        wrapButton.title = 'Toggle text wrap';
        wrapButton.setAttribute('aria-label', 'Toggle text wrap');
        wrapButton.addEventListener('click', function () {
          pre.classList.toggle('wrapped');
          wrapButton.classList.toggle('active', pre.classList.contains('wrapped'));
          refreshWrapButton(pre, wrapButton);
        });
        tools.appendChild(wrapButton);
        if (resizeObserver) resizeObserver.observe(pre);

        if (controls('copy')) {
          var copyButton = document.createElement('button');
          copyButton.type = 'button';
          copyButton.className = 'copy-btn';
          setHTML(copyButton, COPY_SVG);
          copyButton.title = 'Copy code';
          copyButton.setAttribute('aria-label', 'Copy code');
          copyButton.addEventListener('click', function () {
            var code = pre.querySelector('code');
            copyText(code ? code.textContent : pre.textContent, copyButton);
          });
          tools.appendChild(copyButton);
        }

        var code = pre.querySelector('code');
        var language = languageOf(code);
        var viewer = focus();
        if (viewer && controls('fullscreen') && !RESERVED[language]) {
          var expandButton = document.createElement('button');
          expandButton.type = 'button';
          expandButton.className = 'expand-btn';
          setHTML(expandButton, EXPAND_SVG);
          expandButton.title = 'Open in fullscreen';
          expandButton.setAttribute('aria-label', 'Open code in fullscreen');
          expandButton.addEventListener('click', function () {
            viewer.open(pre, { comment: options.isCommentMode ? !!options.isCommentMode() : false });
          });
          tools.appendChild(expandButton);

          if (options.comments && options.codeCommentCount) {
            var noteCount = options.codeCommentCount('pre:' + index);
            if (noteCount > 0) {
              var commentButton = document.createElement('button');
              commentButton.type = 'button';
              commentButton.className = 'code-comment-btn';
              setHTML(commentButton, COMMENT_SVG);
              commentButton.title = noteCount + (noteCount === 1 ? ' comment' : ' comments');
              commentButton.setAttribute('aria-label', commentButton.title);
              var dot = options.codeCommentColor ? options.codeCommentColor('pre:' + index) : '';
              if (dot) commentButton.style.setProperty('--dot', dot);
              commentButton.addEventListener('click', function () { viewer.open(pre, { comment: true }); });
              tools.appendChild(commentButton);
            }
          }

          if (options.annotations) {
            var walkFile = isWalk ? pre.getAttribute('data-file') : '';
            var agentHere = isWalk && options.agentAnnotationCountFor
              ? (walkFile ? options.agentAnnotationCountFor(walkFile) : 0)
              : agentTotal;
            if (agentHere > 0 && (isWalk || !agentShown)) {
              agentShown = true;
              var agentButton = document.createElement('button');
              agentButton.type = 'button';
              agentButton.className = 'agent-comment-btn';
              setHTML(agentButton, AGENT_SVG);
              agentButton.title = agentHere + (agentHere === 1 ? ' agent comment' : ' agent comments');
              agentButton.setAttribute('aria-label', agentButton.title);
              agentButton.style.setProperty('--dot', '#7c84d8');
              agentButton.addEventListener('click', function () {
                if (isWalk && viewer.openWalkthrough) viewer.openWalkthrough();
                else viewer.open(pre);
              });
              tools.appendChild(agentButton);
            }
          }
        }

        refreshWrapButton(pre, wrapButton);
      });
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener('resize', refresh);
      if (resizeObserver) resizeObserver.disconnect();
    }

    window.addEventListener('resize', refresh);
    return { attach: attach, refresh: refresh, destroy: destroy };
  }

  exports.create = create;
  exports.RESERVED = RESERVED;
  exports.languageOf = languageOf;
})(typeof module !== 'undefined' && module.exports
  ? module.exports
  : (window.SDocCodeReader = window.SDocCodeReader || {}));
