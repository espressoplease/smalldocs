// Pure tag handling. Browser and Node both use this (UMD).
// Three things:
//   - extract #hashtag tokens from markdown body
//   - merge tags from multiple sources, deduped, preserving order
//   - inject CLI-provided tags into a file's YAML front matter

(function (exports) {

  const HASHTAG_RE = /(?:^|[^\w&#])#([A-Za-z][\w-]{0,63})\b/g;
  // CSS hex colours look like hashtags ("#c8c3bc", "#fff"). Skip the
  // three-, four-, six-, and eight-char hex patterns so colour-heavy
  // markdown does not flood the tag set.
  const HEX_COLOUR_RE = /^[0-9a-fA-F]{3,8}$/;

  // Strip fenced code blocks, inline code, headings, and YAML front matter,
  // then collect remaining #hashtag tokens. Returns a deduped array in
  // first-seen order.
  function extractBodyHashtags(body) {
    if (!body) return [];

    let stripped = body;

    if (stripped.startsWith('---\n')) {
      const end = stripped.indexOf('\n---', 4);
      if (end !== -1) stripped = stripped.slice(end + 4);
    }

    stripped = stripped.replace(/```[\s\S]*?```/g, '');
    stripped = stripped.replace(/`[^`\n]+`/g, '');
    stripped = stripped.replace(/^#{1,6} .*/gm, '');

    const seen = new Set();
    const out = [];
    let m;
    HASHTAG_RE.lastIndex = 0;
    while ((m = HASHTAG_RE.exec(stripped)) !== null) {
      const tag = m[1].toLowerCase();
      if (HEX_COLOUR_RE.test(tag) && (tag.length === 3 || tag.length === 4 || tag.length === 6 || tag.length === 8)) continue;
      if (!seen.has(tag)) {
        seen.add(tag);
        out.push(tag);
      }
    }
    return out;
  }

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

  exports.extractBodyHashtags = extractBodyHashtags;
  exports.mergeTags           = mergeTags;
  exports.parseTagArgs        = parseTagArgs;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.SDocLibraryTags = {}));
