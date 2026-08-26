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
(function (exports, core) {
  if (!core) throw new Error('SDocsMarkedDelCore is required');

  exports.extension = core.extension;
  exports.apply = core.apply;

  if (typeof window !== 'undefined' && window.marked) core.apply(window.marked);
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocsMarkedDel = {}),
  typeof module !== 'undefined' && module.exports
    ? require('./sdocs-marked-del-core.js')
    : window.SDocsMarkedDelCore);
