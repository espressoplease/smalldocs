// Structural keywords for JavaScript. See sdocs-code-focus.js.
(function (root) {
  (root.SDocsCodeLang = root.SDocsCodeLang || {}).javascript = {
    structural: [
      /^\s*(export|import)\b/,
      /^\s*(class|enum|namespace)\b/,
      /^\s*(async\s+)?function\b/,
      /^\s*(get|set|static|constructor)\b/,
      /^\s*(export\s+)?(const|let|var)\b/
    ]
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
