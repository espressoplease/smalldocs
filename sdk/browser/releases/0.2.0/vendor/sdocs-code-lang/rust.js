// Structural keywords for Rust. See sdocs-code-focus.js.
(function (root) {
  (root.SDocsCodeLang = root.SDocsCodeLang || {}).rust = {
    structural: [
      /^\s*(use|extern)\b/,
      /^\s*(pub\s+)?mod\b/,
      /^\s*(pub(\([\w:]+\))?\s+)?(fn|struct|enum|trait|impl|type|const|static|union)\b/,
      /^\s*#!?\[/,
      /^\s*(pub|pub\([\w:]+\))\b/
    ]
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
