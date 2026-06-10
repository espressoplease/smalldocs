// Structural keywords for Go. See sdocs-code-focus.js.
(function (root) {
  (root.SDocsCodeLang = root.SDocsCodeLang || {}).go = {
    structural: [
      /^\s*package\b/,
      /^\s*import\b/,
      /^\s*func\b/,
      /^\s*type\b/,
      /^\s*(const|var)\b/
    ]
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
