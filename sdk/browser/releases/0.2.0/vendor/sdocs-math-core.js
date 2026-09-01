(function (exports) {
  'use strict';

  function escapeAttr(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var inlineMath = /^\$(?!\s)((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)/;
  var blockMath = /^\$\$([\s\S]+?)\$\$(?:\n|$)/;
  var blockMathStart = /(?<=^|\n)\$\$/;

  var extension = {
    extensions: [
      {
        name: 'sdocsMathBlock',
        level: 'block',
        start: function (source) {
          var match = blockMathStart.exec(source);
          return match ? match.index : undefined;
        },
        tokenizer: function (source) {
          var match = blockMath.exec(source);
          if (match) return { type: 'sdocsMathBlock', raw: match[0], tex: match[1].trim() };
        },
        renderer: function (token) {
          return '<div class="sdocs-math-display" data-tex="' + escapeAttr(token.tex) + '"></div>\n';
        },
      },
      {
        name: 'sdocsMathInline',
        level: 'inline',
        start: function (source) {
          var match = source.match(/(?<!\\)\$/);
          return match ? match.index : undefined;
        },
        tokenizer: function (source) {
          var match = inlineMath.exec(source);
          if (match) return { type: 'sdocsMathInline', raw: match[0], tex: match[1] };
        },
        renderer: function (token) {
          return '<span class="sdocs-math-inline" data-tex="' + escapeAttr(token.tex) + '"></span>';
        },
      },
    ],
  };

  var applied = [];
  function apply(parser) {
    if (!parser || typeof parser.use !== 'function' || applied.indexOf(parser) >= 0) return;
    applied.push(parser);
    parser.use(extension);
  }

  function createRenderer(environment) {
    var env = environment || {};
    var load = env.load;
    var render = env.render;
    var isActive = typeof env.isActive === 'function' ? env.isActive : function () { return true; };
    var isNodeActive = typeof env.isNodeActive === 'function'
      ? env.isNodeActive
      : function () { return true; };

    function showSource(nodes) {
      nodes.forEach(function (node) {
        if (isNodeActive(node) && !node.textContent) node.textContent = node.getAttribute('data-tex') || '';
      });
    }

    function processMath(container) {
      if (!container) return Promise.resolve();
      var nodes = Array.prototype.slice.call(container.querySelectorAll('.sdocs-math-display, .sdocs-math-inline'));
      if (!nodes.length) return Promise.resolve();
      if (typeof load !== 'function' || typeof render !== 'function') {
        showSource(nodes);
        return Promise.resolve();
      }
      return Promise.resolve(load()).then(function (katex) {
        if (!katex || !isActive()) return;
        nodes.forEach(function (node) {
          if (!isActive() || !isNodeActive(node) || node._katexDone) return;
          var tex = node.getAttribute('data-tex') || '';
          try {
            render(katex, tex, node, node.classList.contains('sdocs-math-display'));
            node._katexDone = true;
          } catch (_) {
            node.textContent = tex;
          }
        });
      }).catch(function () {
        showSource(nodes);
      });
    }

    return { processMath: processMath };
  }

  exports.extension = extension;
  exports.apply = apply;
  exports.createRenderer = createRenderer;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocMathCore = {}));
