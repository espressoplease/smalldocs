// Structural keywords for Python. See sdocs-code-focus.js.
(function (root) {
  (root.SDocsCodeLang = root.SDocsCodeLang || {}).python = {
    structural: [
      /^\s*class\b/,
      /^\s*(async\s+def|def)\b/,
      /^\s*@[\w.]+/,
      /^\s*(import|from)\b/,
      /^\s*[A-Z][A-Z0-9_]*\s*[:=]/
    ]
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
