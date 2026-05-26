// Pure tag handling. Browser and Node both use this (UMD).
// Two things:
//   - merge tags from multiple sources, deduped, preserving order
//   - parse `+tag` argv tokens into bare tag strings

(function (exports) {

  function mergeTags(...sources) {
    const seen = new Set();
    const out = [];
    for (const source of sources) {
      if (!source) continue;
      for (const raw of source) {
        if (raw == null) continue;
        const tag = String(raw).trim().replace(/^#/, '').toLowerCase();
        if (!tag) continue;
        if (seen.has(tag)) continue;
        seen.add(tag);
        out.push(tag);
      }
    }
    return out;
  }

  // Tokens of the form "+word" in argv; returns the bare tag strings.
  // `+` is shell-safe; we don't accept `#` here because shells treat it
  // as a comment marker, so the args would never reach the CLI.
  function parseTagArgs(args) {
    const tags = [];
    for (const a of args || []) {
      if (typeof a === 'string' && /^\+[A-Za-z][\w-]{0,63}$/.test(a)) {
        tags.push(a.slice(1).toLowerCase());
      }
    }
    return tags;
  }

  exports.mergeTags    = mergeTags;
  exports.parseTagArgs = parseTagArgs;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocLibraryTags = {}));
