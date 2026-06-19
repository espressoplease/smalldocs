// Structural keywords for C#. See sdocs-code-focus.js.
(function (root) {
  (root.SDocsCodeLang = root.SDocsCodeLang || {}).csharp = {
    structural: [
      /^\s*(using|namespace)\b/,
      /^\s*\[[\w.]+/,
      /^\s*(public|private|protected|internal)\b/,
      /^\s*(class|interface|enum|struct|record)\b/,
      /^\s*(static|abstract|sealed|virtual|override|async|partial)\b/
    ]
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
