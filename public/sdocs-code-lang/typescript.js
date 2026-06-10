// Structural keywords for TypeScript. See sdocs-code-focus.js.
(function (root) {
  (root.SDocsCodeLang = root.SDocsCodeLang || {}).typescript = {
    structural: [
      /^\s*(export|import)\b/,
      /^\s*(class|interface|enum|namespace|module|declare)\b/,
      /^\s*(abstract\s+class)\b/,
      /^\s*(async\s+)?function\b/,
      /^\s*(get|set|static|constructor)\b/,
      /^\s*(public|private|protected|readonly|abstract)\b/,
      /^\s*type\s+\w/,
      /^\s*@[\w.]+/,
      /^\s*(export\s+)?(const|let|var)\b/
    ]
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
