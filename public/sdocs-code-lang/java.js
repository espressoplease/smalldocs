// Structural keywords for Java. See sdocs-code-focus.js.
(function (root) {
  (root.SDocsCodeLang = root.SDocsCodeLang || {}).java = {
    structural: [
      /^\s*(package|import)\b/,
      /^\s*@[\w.]+/,
      /^\s*(public|private|protected)\b/,
      /^\s*(class|interface|enum|record)\b/,
      /^\s*(static|final|abstract|synchronized|native|transient|volatile|default)\b/
    ]
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
