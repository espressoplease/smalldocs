// Structural keywords for Ruby. A line matching one of these survives the
// outline when its class/module is collapsed; everything else (comments, plain
// statements) folds into a single ellipsis. See sdocs-code-focus.js.
(function (root) {
  (root.SDocsCodeLang = root.SDocsCodeLang || {}).ruby = {
    structural: [
      /^\s*(class|module)\b/,
      /^\s*(def|define_method)\b/,
      /^\s*(private|protected|public)\b/,
      /^\s*(attr_reader|attr_writer|attr_accessor)\b/,
      /^\s*(include|extend|prepend|using)\b/,
      /^\s*[A-Z][A-Za-z0-9_]*\s*=(?!=)/,
      /^\s*(has_many|has_one|belongs_to|has_and_belongs_to_many|scope|validates|validate)\b/
    ]
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
