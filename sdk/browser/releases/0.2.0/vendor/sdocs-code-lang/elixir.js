// Structural keywords for Elixir. @doc and @moduledoc are documentation, not
// structure, so they are intentionally absent and fold into the ellipsis.
// See sdocs-code-focus.js.
(function (root) {
  (root.SDocsCodeLang = root.SDocsCodeLang || {}).elixir = {
    structural: [
      /^\s*(defmodule|defprotocol|defimpl)\b/,
      /^\s*(def|defp|defmacro|defmacrop|defguard|defguardp|defdelegate|defstruct|defexception)\b/,
      /^\s*(use|import|alias|require)\b/,
      /^\s*@(type|typep|spec|callback|macrocallback|behaviour|enforce_keys|derive|impl)\b/
    ]
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
