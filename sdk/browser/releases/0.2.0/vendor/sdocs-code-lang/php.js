// Structural keywords for PHP. See sdocs-code-focus.js.
(function (root) {
  (root.SDocsCodeLang = root.SDocsCodeLang || {}).php = {
    structural: [
      /^\s*(namespace|use)\b/,
      /^\s*(abstract\s+|final\s+)?(class|interface|trait|enum)\b/,
      /^\s*(public|private|protected)\b/,
      /^\s*(function|static|const)\b/
    ]
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
