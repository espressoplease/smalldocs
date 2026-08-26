// sdocs-marked-del-core.js - shared double-tilde strikethrough extension.
(function (exports) {
  'use strict';

  var DOUBLE_TILDE_DEL = /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\\]))\1(?=[^~]|$)/;

  var extension = {
    tokenizer: {
      del: function (source) {
        var match = DOUBLE_TILDE_DEL.exec(source);
        if (!match) return;
        return {
          type: 'del',
          raw: match[0],
          text: match[2],
          tokens: this.lexer.inlineTokens(match[2]),
        };
      },
    },
  };

  function apply(marked) {
    if (!marked || typeof marked.use !== 'function') return;
    marked.use(extension);
  }

  exports.extension = extension;
  exports.apply = apply;
})(typeof module !== 'undefined' && module.exports
  ? module.exports
  : (window.SDocsMarkedDelCore = {}));
