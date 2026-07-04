// sdocs-marked-del.js - restrict GFM strikethrough to double tildes.
//
// marked's default GFM tokenizer treats a SINGLE-tilde pair as
// strikethrough (~like this~). In real documents a bare ~ almost always
// means "approximately" (~$14,527, ~17 years); two of them in one
// paragraph silently strike through everything between them, and the
// match can swallow a ** marker, breaking bold for the rest of the
// paragraph. The GFM spec defines strikethrough as two tildes, so we
// pin the tokenizer to ~~this~~ and leave single tildes as literal text.
//
// UMD: in the browser this applies itself to window.marked at load time
// (the script tag sits right after vendor/marked.min.js); Node tests
// require this file and call apply() on the vendored marked.
(function (exports) {
  // marked's own del rule with the `~~?` alternation pinned to `~~`.
  var DOUBLE_TILDE_DEL = /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\\]))\1(?=[^~]|$)/;

  var extension = {
    tokenizer: {
      del: function (src) {
        var m = DOUBLE_TILDE_DEL.exec(src);
        if (m) {
          return {
            type: 'del',
            raw: m[0],
            text: m[2],
            tokens: this.lexer.inlineTokens(m[2]),
          };
        }
        // No return value on miss. Returning `false` here would tell
        // marked.use to fall back to the default del tokenizer, which
        // matches the single-tilde form we are removing.
      },
    },
  };

  function apply(marked) {
    if (!marked || typeof marked.use !== 'function') return;
    marked.use(extension);
  }

  exports.extension = extension;
  exports.apply = apply;

  if (typeof window !== 'undefined' && window.marked) apply(window.marked);
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocsMarkedDel = {}));
