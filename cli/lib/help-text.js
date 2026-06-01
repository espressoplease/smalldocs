// Long help strings printed by `sdoc help`, `sdoc schema`, `sdoc charts`,
// `sdoc diagrams`, `sdoc comments`. Kept as plain data with no logic.

const HELP = `
SDocs CLI
=========
Open, share, and style markdown files from the terminal.

USAGE
  sdoc <file>                      Open file in browser (read mode)
  sdoc <file> --write              Open in write mode
  sdoc <file> --style              Open with style panel
  sdoc <file> --raw                Open raw markdown source
  sdoc <file> --comment            Open in comment mode (review/annotate)
  sdoc new                         New blank document (write mode)
  sdoc share <file>                Copy shareable link to clipboard
  sdoc share <file> --section "X"  Link with section anchor
  sdoc share <file> --short        Encrypted /s/<id> short link (see SHORT LINKS)
  sdoc schema                      Print the full styles schema
  sdoc charts                      Chart types, options, and styling guide
  sdoc diagrams                    Mermaid diagrams reference (\`\`\`mermaid blocks)
  sdoc cells                       Inline spreadsheet reference (\`\`\`cells blocks)
  sdoc color-analysis <file>       Check custom colours for readable contrast
                                   (both themes). Run after styling a doc.
  sdoc comments                    Comment-format reference (for agents)
  sdoc feedback                    Interactive form DSL reference (\`\`\`form blocks)
  sdoc feedback <file>             Open <file> for the user to fill in; exits on first submit
  sdoc feedback <file> --keep-open Stay alive across many submits; tail stdout per click
  sdoc slides                      Slide DSL reference (grids, shapes, content)
  sdoc slides list                 Built-in slide template registry + slot names
  sdoc slides icons [query]        Lucide icon names available to the \`icon\` shape kind
  sdoc slides custom-shapes        Raw-shape primitives + design principles reference
  sdoc present <file>              Open <file> and jump straight into fullscreen slides
  sdoc library                     Open the personal markdown library at sdocs.dev/library
  sdoc library ls                  List markdown indexed in this project (walks up to .git)
  sdoc library ls --tags           Tag bag (tag - count) for this project
  sdoc library --help              Full library reference - commands, tagging, rescue, autostart
  sdoc <file> +tag1 +tag2          Inject tags into the file's front matter at open time
  sdoc defaults                    Show ~/.sdocs/styles.yaml
  sdoc defaults --reset            Remove default styles
  sdoc setup                       Wire SDocs into your coding agents
  sdoc refresh                     Update the SDocs section in agent files to the current version
  sdoc auto-update [on|off]        Toggle auto-install of sdoc updates
  sdoc safe                        Verify the SDocs server is running the published code
  sdoc safe --json                 Same, machine-readable (for agents)
  sdoc safe --audit                Same, plus GitHub links to server-side source files
  sdoc help                        Show this help
  cat file.md | sdoc               Pipe markdown from stdin
  cat file.md | sdoc share         Pipe to clipboard link

MODE FLAGS
  --read     Clean reading view (default when file given)
  --write    Opens the contentEditable writer
  --style    Styled preview with style panel visible
  --raw      Shows raw markdown source
  --comment  Comment mode: gutter buttons appear on each block; cards
             render under blocks that already have comments. Useful both
             for human review and for opening files an agent has annotated.

OPTIONS
  --section <heading>   Scroll to heading section on load
  --light               Open in light theme
  --dark                Open in dark theme
  --url <base>          Custom base URL (default: https://sdocs.dev)
  --mode <m>            Alias for --read / --write / --style / --raw / --comment
  --short               Use the encrypted /s/<id> short-URL form (share
                        subcommand only). See SHORT LINKS below.
  --json                Machine-readable output (safe subcommand only).
  --audit               Also print GitHub links to server-side source
                        files (safe subcommand only).
  --keep-open           feedback subcommand: keep the bridge alive across
                        many submits instead of exiting on the first one.
  --log-file <path>     feedback subcommand: append one JSON line per
                        submit to <path> (mirror of stdout, for harnesses
                        that can't tail a background process).
  --message <text>      feedback subcommand: show <text> as a banner
                        above the document.

ENVIRONMENT
  SDOCS_URL   Fallback base URL if --url is not passed.

INTERACTIVE FEEDBACK (sdoc feedback)
  An agent writes a fenced \`\`\`form block into a markdown file and runs
  \`sdoc feedback file.md\`. The browser renders real form controls
  (radio, checkbox, select, text, textarea, number, date). When the
  user clicks a submit button:

    - the bridge writes their answers into the same file
      (under \`answers:\` and \`submissions:\` inside the form block)
    - one JSON line lands on stdout: {event, by, at, scope, values, final}
    - in single-shot mode (no --keep-open) the process exits 0
    - in --keep-open mode the bridge stays alive for the next click

  Run \`sdoc feedback\` (no args) for the full DSL reference: field
  types, button options, the multi-round flow, and how agents on
  different harnesses should consume the events.

FILE INFO CARD
  When you \`sdoc <file>\`, the browser shows a small info card
  above the document with:
    file       The filename — included in the share URL.
    path       Relative path from the cwd — local only.
    fullPath   Absolute path on your machine — local only.
    tags       YAML front-matter tags. Editable when the Bridge is
               connected; read-only otherwise.

  Local fields (path, fullPath) are passed to the browser via a
  separate URL parameter that JS reads into memory and then strips
  from the address bar on load. They never appear in any URL the
  user can copy, and \`sdoc share <file>\` never includes them in
  the generated link. If someone opens your shared URL, only
  \`file\` is visible.

LIBRARY (personal, on-machine index)
  Every \`sdoc <file>\` records the file in ~/.sdocs/library-index.json -
  path, title, tags, last-touched. \`sdoc library\` opens a search UI at
  sdocs.dev/library that talks to a local loopback agent the CLI runs
  on 127.0.0.1:47843. Click a result to open the file for live editing.
  Nothing about the library ever leaves the machine.

  Top commands:
    sdoc library                Open the search UI.
    sdoc library ls             List indexed files in this project.
    sdoc library ls --tags      Tag bag (tag - count) for this project.
    sdoc library rebuild        Walk \$HOME and refresh every entry.
    sdoc library status         Show enabled/disabled + entry count.
    sdoc library autostart      Manage the macOS LaunchAgent.

  Tagging works two ways, both ending up in the file's YAML front
  matter on disk:
    1. Front-matter \`tags: [a, b]\` written directly (or edited via
       the Tags row in the file-info card when the Bridge is live).
    2. CLI flag at open time: \`sdoc plan.md +planning +q2\` injects
       those tags into the file's front matter. The \`+\` prefix is
       shell-safe (\`#\` would be eaten as a comment).

  Files in OS-managed temp folders (/tmp, ~/.cache, ~/.Trash, etc.)
  get a RESCUE COPY at index time so the entry survives when the OS
  cleans the original. Per-file opt-out: \`sdocs-library: false\` in
  the file's front matter. Per-directory opt-out: drop a .sdocsignore
  (subset of gitignore syntax) into any directory.

  Run \`sdoc library --help\` for the full reference - commands,
  tagging, rescue, autostart, security gates, and answers to common
  questions ("I added a tag and it didn't save", "an entry seems
  stale", "how do I keep this work folder out of the library").

SHORT LINKS (sdoc share --short)
  By default, \`sdoc share <file>\` encodes the document into the URL hash:
  \`https://sdocs.dev/#md=<base64url>\`. The whole document lives in the
  hash, which the browser does not send to any server.

  \`--short\` produces a shorter, encrypted form: \`https://sdocs.dev/s/<id>#k=<key>\`.

  How it works:
    1. The CLI brotli-compresses the content, generates a 256-bit AES-GCM
       key + 96-bit nonce locally, and encrypts the compressed bytes.
    2. The CLI POSTs the ciphertext (nonce + ct + auth tag, base64url) to
       /api/short. The server stores it under a random short id and
       returns the id. The key NEVER leaves the CLI.
    3. The CLI assembles \`https://sdocs.dev/s/<id>#k=<key>\` and copies
       it to the clipboard. The key lives in the URL fragment, which the
       browser does not send to the server on page load.
    4. Whoever opens the link: the browser fetches the ciphertext from
       /api/short/<id>, reads \`#k=\` from window.location.hash, decrypts
       in JavaScript, and renders.

  What the server can see:
    - That a ciphertext blob was uploaded under id <id>.
    - When it was fetched and from which IP (standard server logs).
  What the server cannot see:
    - The plaintext document. It does not have the key.
    - The key. The key never leaves the URL fragment.

  Trade-offs vs the default \`#md=\` hash form:
    - + Shorter URL.
    - + Survives URL-length limits (some chat apps truncate at ~2k chars).
    - - Requires the server to remain reachable (the default form does not).
    - - Stored ciphertext can be deleted by the operator at any time.
    - - Server logs reveal access patterns even though contents are encrypted.

  If you don't trust an SDocs operator with even those metadata, use the
  default \`sdoc share <file>\` (no --short) which never contacts the
  server at all.

VERIFYING THE SERVER (sdoc safe)
  \`sdoc safe\` asks https://sdocs.dev what commit it is running, pulls the
  authoritative fingerprint list for that commit from GitHub (published by the
  publish-manifest workflow on every push to main), downloads every frontend
  file from the host, hashes each one with SHA-256, and compares. Bytes come
  from the host; fingerprints come from GitHub. The host cannot produce a
  match it did not already publish to GitHub.

  It does not prove anything about server-side code (that runs on a machine
  we control). \`sdoc safe --audit\` prints GitHub links to the server files
  an agent or human would need to read to audit the rest.

  \`sdoc safe --json\` returns structured output for scripting.

MATH
  Inline $...$ and display $$...$$ are rendered as LaTeX via KaTeX.
    Inline:   The energy is $E = mc^2$.
    Display:  $$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$
  Supported commands: https://katex.org/docs/supported.html

STYLED MARKDOWN FORMAT
  SDocs extends standard .md files with an optional YAML
  front matter block (the same standard used by Jekyll, Hugo, Obsidian).
  The \`styles\` key controls every visual aspect of the rendered document.

  ---
  title: "My Document"
  styles:
    fontFamily: Inter
    baseFontSize: 16
    color: "#1c1917"
    h1: { fontSize: 2.2, color: "#1a3a5c", fontWeight: 700 }
    p:  { lineHeight: 1.85, marginBottom: 1.1 }
  ---
  # My Document
  Content here...

  Colors work in both themes automatically — dark mode versions
  are generated by inverting lightness. Use \`dark:\` to override.

COMMENTS
  SDocs files can carry reviewer comments in their YAML front matter
  under a \`comments:\` key. Comments do not modify the body — they're
  resolved at render time by index lookup with a text-based fallback.
  A typical use:
    1. an agent generates a draft .md file
    2. a human reads it via \`sdoc <file> --comment\`, leaves comments
    3. the user copies the .md back to the agent (with comments)
    4. the agent processes the comments and regenerates

  Or the inverse: an agent writes comments into the front matter to
  flag uncertainty, and runs \`sdoc <file> --comment\` to surface them
  for the human.

Run \`sdoc comments\` for the full format reference and authoring guide.
Run \`sdoc schema\` for the complete list of style properties.
Run \`sdoc charts\` for chart types, options, and styling.
Run \`sdoc library --help\` for the personal markdown library reference.
`;

const COMMENTS_HELP = `
SDocs — Comments
================
Reviewer comments are stored in YAML front matter under \`comments:\`.
The body is never modified — anchoring happens at render time.
This makes the format safe for round-tripping through agents and
markdown tooling that doesn't understand SDocs-specific markers.

WHEN TO USE THIS
  Two flows benefit from comments:

  1. Human reviewing agent output. The agent generates a .md file,
     the human runs \`sdoc <file> --comment\`, leaves notes, and pastes
     the file (with its YAML) back to the agent. The agent reads
     \`comments:\` and acts on each entry.

  2. Agent flagging uncertainty for a human. The agent writes one or
     more comments into the front matter, then opens the file with
     \`sdoc <file> --comment\` so the user sees the annotations rendered
     beside the relevant blocks.

OPENING IN COMMENT MODE
  sdoc <file> --comment       Open in comment mode (or --mode comment)

  Comment mode shows a gutter "+" button beside every top-level block
  for adding new comments, and renders existing comments as yellow
  sidecar cards beneath their anchored blocks.

TWO INPUT FORMATS
  SDocs accepts comments in two interchangeable formats. Both render
  identically in comment mode. Pick whichever is more natural for the
  context:

  1. Markdown footnote format (RECOMMENDED FOR AGENTS).
     Standard markdown footnote syntax. The agent edits the body,
     adding [^cN] markers where the comment anchors. No counting of
     element indices required — anchoring is positional, computed
     from the marker's position in the body.

  2. YAML front-matter format.
     The canonical on-disk store. Used by the SDocs UI and round-trip
     export. Comments live as a structured list under \`comments:\`.

  At load time, SDocs parses both: footnote markers are lifted out of
  the body and merged with the YAML list. On save (round-trip export),
  comments are normalised to YAML.

AUTHORING VIA MARKDOWN FOOTNOTES
  Recommended path for agents that produce text. No tag:n counting,
  no block_text, just standard markdown. Two patterns:

  Inline (anchor a specific phrase):
    Wrap the phrase in [phrase][^cN] and add the definition at the
    end of the document.

      The migration was [implemented in three weeks][^c1] this quarter.

      [^c1]: agent - actually slipped to five weeks

  Block (anchor an entire paragraph or heading):
    Place a lone [^cN] at the end of the block (after the closing
    period) and add the definition at the end.

      The reliability picture was equally encouraging.[^c2]

      [^c2]: agent - need to specify what "incident-free" means

  Definitions support optional author and a [resolved] marker:
    [^c3]: priya [resolved] - already addressed
    [^c4]: agent - check Q2 numbers (block p:5)

  Only footnote ids matching the cN pattern (c1, c2, ...) are treated
  as comments. Other footnote ids (e.g. [^citation1]) keep standard
  footnote semantics.

  This format renders sensibly in any markdown viewer — refs as
  superscripts, definitions at the bottom — so the file is useful
  outside SDocs too.

COMMENT KINDS
  block   Anchored to an entire block element (paragraph, heading,
          list, code block, table, blockquote).
  inline  Anchored to a specific text span within a block.

THE BLOCK ID SCHEME
  Both kinds carry a \`block\` field of the form "tag:n":
    - tag is the lowercased HTML element name (p, h1, h2, h3, h4,
      ul, ol, pre, blockquote, table, plus "chart" for chart blocks).
    - n is the 0-indexed position of that element among siblings of
      the same tag, in render order across the entire document.

  Examples:
    "h2:0"    First <h2> in the document.
    "p:3"     Fourth <p> in render order (ignores headings/lists).
    "ul:0"    First unordered list.
    "pre:1"   Second code block.

  Per-tag-type indexing is more resilient to reordering than a single
  global ordinal, but indices still drift if blocks of the same type
  are inserted upstream. See "Survival hints" below.

SCHEMA — A FULLY-POPULATED EXAMPLE
  ---
  title: "Q2 Roadmap (Draft)"
  # Comments: block "tag:n" = nth (0-indexed) <tag> in render order.
  # block kind may carry block_text (first ~60 chars) as a survival hint when the index drifts.
  # inline kind anchors via quote (+ optional prefix/suffix). resolved: true marks addressed.
  comments:
    - id: c1
      kind: block
      block: "h2:0"
      block_text: "Context"
      author: priya
      color: "#ffbb00"
      at: "2026-04-22T09:14:00Z"
      text: "rename this to 'Where Q1 left us' — sharper"
    - id: c2
      kind: inline
      quote: "shipped on time"
      prefix: "every committed feature "
      suffix: " and within budget"
      block: "p:0"
      author: priya
      color: "#ffbb00"
      at: "2026-04-22T09:15:00Z"
      text: "auth migration slipped 2 weeks — please correct"
    - id: c3
      kind: block
      block: "p:5"
      block_text: "Cost discipline becomes more visible in Q2"
      author: priya
      color: "#ffbb00"
      at: "2026-04-22T09:24:00Z"
      text: "align the $180k figure with finance before publishing"
      resolved: true
  ---

  # Q2 Roadmap (Draft)
  ## Context
  Q1 closed strong: every committed feature shipped on time and within budget...

FIELDS
  Required for both kinds:
    id        Stable identifier. Convention: c1, c2, c3...
    kind      "block" or "inline"
    text      The reviewer's note (the comment body).

  Required for inline:
    quote     The exact text span in the rendered body to highlight.

  Optional but recommended:
    block         The "tag:n" anchor. Used as a fast lookup. Optional
                  for inline (the quote alone is enough), required for
                  block (it's the only anchor).
    block_text    For block kind only. The first ~60 characters of
                  the block's plain text at the time of writing.
                  Survival hint: when "tag:n" no longer matches (the
                  document was edited and indices drifted), readers
                  fall back to scanning for a block whose start
                  matches block_text.
    prefix        For inline kind. Up to 60 chars of the rendered
                  text immediately before the quote, used to
                  disambiguate when the quote appears multiple times.
    suffix        Same as prefix but for the text immediately after.
    resolved      true if the comment has been addressed. Preserved
                  for audit; readers should skip resolved comments
                  when generating action lists.
    author        Display name on the rendered card. Default: "user".
    color         Card tint, hex (#rrggbb). Default: "#ffbb00" (yellow).
    at            ISO 8601 timestamp. Default: now (browser side).

ID GENERATION
  Use c1, c2, c3... in chronological order. To pick the next id, take
  the highest cN currently in the file and add 1. Don't reuse ids of
  deleted comments — gaps are fine. Non-cN ids are tolerated but lose
  the auto-increment guarantee.

ANCHOR RESOLUTION (HOW READERS RECOVER FROM DRIFT)
  When a tool (the SDocs renderer or another agent) loads the file,
  each comment is resolved in this order:

  Block kind:
    1. Try \`block: "tag:n"\` exactly.
    2. If found, optionally verify the resolved block's leading text
       matches \`block_text\`. If not, fall through.
    3. Search the document for any block whose first ~60 chars start
       with \`block_text\`.
    4. Give up — comment is orphaned.

  Inline kind:
    1. Find the block via \`block: "tag:n"\`.
    2. Inside that block, find \`prefix + quote + suffix\`.
    3. Fall back to \`prefix + quote + suffix\` anywhere in the body.
    4. Fall back to \`quote\` alone, anywhere in the body.
    5. Give up — comment is orphaned.

AUTHORING TIPS FOR AGENTS
  - Prefer the markdown-footnote authoring path (above). It avoids
    the index-counting work the YAML path requires and is the most
    reliable way for an LLM to write a comment that anchors correctly.
  - If you do author in YAML directly:
      - Compute "tag:n" by counting same-tag elements in render order.
        Headings, paragraphs, lists each have their own counters.
      - Counting errors are common. The fallback tiers (block_text
        for block kind, prefix/suffix or quote-only search for inline)
        will rescue an off-by-one index — but only if you populate them.
      - For block comments, ALWAYS populate block_text (first ~60 chars
        of the block's plain text).
      - For inline comments, ensure the comment is uniquely resolvable:
        either pick a long unique quote, or populate prefix/suffix.
  - To mark a comment addressed without losing audit trail, set
    \`resolved: true\` (YAML) or add \`[resolved]\` after the author
    name in the footnote definition.
  - When acting on comments, skip those marked resolved — they
    describe past work, not pending requests.
`;

const SCHEMA = `
SDocs — Styles Schema
=====================
All style values live under the \`styles:\` key in YAML front matter.
Every property is optional — omit anything you want left at its default.

  ┌────────────────────────────────────────────────────────────┐
  │ IMPORTANT — if you set ANY custom colours, run:              │
  │     sdoc color-analysis <file>                               │
  │ It grades every text-on-background pair for BOTH the light   │
  │ and dark themes and flags anything unreadable. Hand-picked   │
  │ palettes (especially when you only looked at one theme) are  │
  │ the #1 source of unreadable docs. Run it before you ship.    │
  └────────────────────────────────────────────────────────────┘

GENERAL
  fontFamily    string   Any of the supported fonts (see FONTS below)
                         Default: "Inter"
  baseFontSize  number   Base font size in px. All rem/em values scale from this.
                         Default: 16
  background    string   Page background color (hex).
                         Default: "#ffffff" (light) / "#2c2a26" (dark)
  color         string   Master body text color (hex). Cascades to headings,
                         paragraphs, and lists unless those are overridden.
                         Default: "#1c1917"
  lineHeight    number   Global line-height multiplier.
                         Default: 1.75

HEADINGS  (general heading controls)
  headers:
    scale         number  Relative size multiplier applied across all heading levels.
                          Default: 1.0
    marginBottom  number  Space below headings (em). Default: 0.4
    color         string  Heading color — cascades to h1/h2/h3/h4 unless overridden.
                          Default: inherits \`color\`

PER-HEADING  (each independently overrides the heading defaults above)
  h1: { fontSize: number, color: string, fontWeight: number }
  h2: { fontSize: number, color: string, fontWeight: number }
  h3: { fontSize: number, color: string, fontWeight: number }
  h4: { fontSize: number, color: string, fontWeight: number }

  fontSize is in rem (relative to baseFontSize).
  Sensible defaults: h1 2.2, h2 1.55, h3 1.2, h4 1.0
  fontWeight: 400 (regular) · 600 (semibold) · 700 (bold)

PARAGRAPH
  p:
    lineHeight    number  Line height for body paragraphs. Default: 1.75
    marginBottom  number  Space between paragraphs (em). Default: 1.1
    color         string  Paragraph text color. Default: inherits \`color\`

LISTS
  list:
    color         string  Color for list items and bullet/number markers.
                          Default: inherits paragraph color

LINKS
  link:
    color       string   Link color. Default: "#2563eb"
    decoration  string   "underline" | "none". Default: "underline"

CODE
  code:
    fontFamily  string   Monospace font. Default: "ui-monospace, monospace"
    background  string   Inline/block code background color. Default: "#F1EDE8"
    padding     number   Inline code padding (em). Default: 0.2

BLOCKQUOTE
  blockquote:
    borderColor  string  Left border accent color. Default: "#2563eb"
    borderWidth  number  Left border thickness (px). Default: 3
    background   string  Quote background color. Default: "#f7f5f2"
    color        string  Quote text color. Default: "#6b6560"

BLOCKS (shared styling for code, blockquote, and chart blocks)
  blocks:
    background  string  Background for all block types. Cascades to code,
                        blockquote, and chart backgrounds unless overridden.
    color       string  Text color for all block types. Cascades to code,
                        blockquote, and chart text unless overridden.

CHARTS
  chart:
    accent      string  Palette base color (hex). Default: "#3b82f6"
    palette     string  Palette mode. Default: "monochrome"
                        Options: monochrome, complementary, analogous, triadic,
                        pastel, warm, cool, earth
    background  string  Chart background. Default: inherits blocks.background
    textColor   string  Chart labels/axes. Default: inherits blocks.color

  Run \`sdoc charts\` for the full chart reference — chart types, JSON
  format, axis/legend/annotation options, and per-chart styling overrides.

TABLES
  table:
    color             string  Text color for header and body cells.
                              Default: inherits \`color\`
    headerBackground  string  Background for the header row.
                              Default: "#f4f1ed" (light) / "#2c2926" (dark)
    oddBackground     string  Background for odd body rows.
                              Default: "#ffffff" (light) / "#2c2a26" (dark)
    evenBackground    string  Background for even body rows.
                              Default: "#fafaf8" (light) / "#242220" (dark)
    border            string  Cell border color.
                              Default: "#e2ddd6" (light) / "#3d3935" (dark)

SLIDES
  Slides embedded via \`\`\`slide / ~~~slide fenced blocks inherit these
  styles automatically (background, fonts, link color, code block colors,
  heading colors on shape markdown). For explicit references, shape
  attributes accept \$path.to.prop tokens - e.g. \`fill=\$h1.color\`,
  \`bg=\$blocks.background\`. You should now run \`sdoc slides\` for the
  full slide reference, so you don't guess at the DSL.

COLOR CASCADE
  Colors cascade from general → specific:
    color  →  headers.color  →  h1.color, h2.color, h3.color, h4.color
    color  →  p.color        →  list.color
    blocks.background  →  code.background, blockquote.background, chart.background
    blocks.color       →  code.color, blockquote.color, chart.textColor
  Set a child color only when you want it to differ from its parent.

THEME COLORS
  Top-level colors are light-mode colors. Dark mode is auto-generated
  by inverting lightness (same hue, flipped brightness). Light backgrounds
  become dark, dark text becomes light. Colors already very dark (like a
  dark code block background) are kept as-is.

  This means you only need to specify colors ONCE:

  ---
  styles:
    color: "#2d1810"
    background: "#fdf6f0"
    headers: { color: "#8b2500" }
    blocks:
      background: "#f5e6d8"
      color: "#5a3e2e"
  ---

  Dark mode will automatically get inverted versions of all colors above.

  To override specific dark-mode colors, add a \`dark:\` block:

  ---
  styles:
    color: "#2d1810"
    background: "#fdf6f0"
    blocks:
      background: "#f5e6d8"
    dark:
      background: "#1a1210"
      blocks:
        background: "#2a1a1a"
  ---

  Non-color properties (fonts, sizes, spacing, weights) remain at the
  top level and are shared across both themes.

  Because dark mode is auto-derived, a colour that reads fine in the
  light theme can invert to something unreadable in the dark theme (a
  mid-blue heading becomes dark navy, light text becomes near-black).
  ALWAYS run \`sdoc color-analysis <file>\` after setting colours — it
  checks both themes and tells you exactly which pair fails and why.

FONTS (24 supported, loaded lazily from Google Fonts)
  Inter · Roboto · Open Sans · Lato · Montserrat · Source Sans 3
  Oswald · Raleway · Poppins · Merriweather · Ubuntu · Nunito
  Playfair Display · Roboto Slab · PT Sans · Lora · Mulish · Noto Sans
  Rubik · Dosis · Josefin Sans · PT Serif · Libre Franklin · Crimson Text

EXAMPLE — editorial article with colored heading tiers
  ---
  styles:
    fontFamily: Lora
    baseFontSize: 17
    background: "#fffaf5"
    color: "#1a1a2e"
    h1: { fontSize: 2.3, fontWeight: 700, color: "#c0392b" }
    h2: { fontSize: 1.55, fontWeight: 600, color: "#8e44ad" }
    h3: { fontSize: 1.2, fontWeight: 600, color: "#16a085" }
    p: { lineHeight: 1.9, marginBottom: 1.2 }
    link: { color: "#e67e22" }
    blocks:
      background: "#faf0eb"
    blockquote: { borderColor: "#c0392b", color: "#7f8c8d" }
    dark:
      background: "#1a1520"
      h1: { color: "#ef6f5e" }
      h2: { color: "#c490e4" }
      blockquote: { borderColor: "#ef6f5e" }
  ---
`;

const CHARTS_HELP = `
SDocs — Charts
==============
Render beautiful charts in markdown using \`\`\`chart code blocks.
Charts are powered by Chart.js, loaded lazily from CDN only when needed.

BASIC SYNTAX
  Wrap a JSON object in a \`\`\`chart fenced code block:

  \`\`\`chart
  {
    "type": "bar",
    "title": "Monthly Revenue",
    "labels": ["Jan", "Feb", "Mar"],
    "values": [100, 150, 130]
  }
  \`\`\`

CHART TYPES
  pie              Circular segments (use "color" for monochrome shading)
  doughnut         Hollow-center pie (alias: donut)
  bar              Vertical bars
  horizontal_bar   Horizontal bars (alias: hbar)
  stacked_bar      Stacked vertical bars
  line             Line graph with data points
  area             Line with filled area beneath
  stacked_area     Multiple filled areas stacked (alias: stacked_line)
  radar            Spider/web chart for multi-axis comparison
  polarArea        Like pie but equal angles, varying radius
  scatter          X/Y point plots
  bubble           Like scatter with size dimension
  mixed            Combo chart — bar + line on same plot (alias: combo)

DATA FORMATS
  Simple (single dataset):
    "labels": ["A", "B", "C"],
    "values": [10, 20, 15]

  Multi-dataset:
    "labels": ["Q1", "Q2"],
    "datasets": [
      { "label": "2024", "values": [10, 20] },
      { "label": "2025", "values": [12, 25] }
    ]

  Scatter/Bubble:
    "datasets": [
      { "label": "Group", "data": [{"x": 1, "y": 2}, {"x": 3, "y": 5}] }
    ]

CHART OPTIONS
  title           string     Chart heading
  subtitle        string     Smaller text below title
  labels          string[]   Category labels
  values          number[]   Data for a single dataset
  datasets        array      Multiple datasets (see above)
  color           string     Single accent color (hex)
  colors          string[]   Per-segment/bar custom colors

AXIS OPTIONS
  xAxis / xLabel  string     X-axis label
  yAxis / yLabel  string     Y-axis label
  y2Axis          string     Right y-axis label (enables dual axis)
  min             number     Minimum value on value axis
  max             number     Maximum value on value axis
  stepSize        number     Tick interval
  beginAtZero     boolean    Default true. Set false for auto-range.

NUMBER FORMATTING
  format          string     "currency" ($), "euro" (€), "pound" (£),
                             "percent" (%), "comma" (1,000)
  prefix          string     Custom value prefix (e.g. "£")
  suffix          string     Custom value suffix (e.g. " kg", "°C")
  y2Format        string     Format for right y-axis
  y2Prefix        string     Prefix for right y-axis
  y2Suffix        string     Suffix for right y-axis

DISPLAY OPTIONS
  legend          boolean    Show/hide legend (auto by default)
  legendPosition  string     "top", "bottom" (default), "left", "right"
  dataLabels      boolean    Show values on chart (default true). Set false for clean look.
  aspectRatio     number     Width/height ratio (e.g. 2 for wide, 0.8 for tall)
  stacked         boolean    Force stacking on bar/line charts

DATASET OPTIONS (inside each dataset object)
  label           string     Name shown in legend
  values          number[]   Data points
  data            object[]   For scatter: [{x, y}], for bubble: [{x, y, r}]
  color           string     Dataset color (hex)
  colors          string[]   Per-bar colors within dataset
  type            string     Override type in mixed charts ("bar" or "line")
  yAxisID         string     "y" (left) or "y2" (right) for dual-axis charts
  fill            boolean    Fill area under line
  tension         number     Line smoothing (0 = straight, 0.4 = smooth)
  order           number     Draw order (lower = rendered on top)

ANNOTATIONS (reference lines)
  "annotations": [
    { "y": 60, "label": "Target", "color": "#ef4444" },
    { "x": "Mar", "label": "Launch", "dashed": true }
  ]

  y / x           number/string   Position of the reference line
  label           string          Text label on the line
  color           string          Line color
  width           number          Line thickness (default 2)
  dashed          boolean         Dashed style (default true)
  position        string          Label position: "start", "center", "end"

CHART STYLING (via front matter or style panel)
  Charts inherit background and text colors from the block cascade:

  ---
  styles:
    blocks:
      background: "#1a1a2e"     # all blocks: code, blockquote, charts
      color: "#c8c3bc"          # text in all blocks
    chart:
      accent: "#6366f1"         # palette base color
      palette: monochrome       # palette generation mode
      background: "#0e4a1a"     # override blocks.background for charts only
      textColor: "#c8f0d8"      # override blocks.color for charts only
  ---

  COLOR CASCADE FOR BLOCKS
    blocks.background  →  code.background, blockquote.background, chart.background
    blocks.color       →  code.color, blockquote.color, chart.textColor
    Set a child value only when you want it to differ from the parent.

  DARK MODE
    All colors auto-generate dark-mode counterparts (lightness inverted).
    Add a \`dark:\` block to override specific values:
      dark:
        blocks:
          background: "#2a1a1a"

  PALETTE MODES
    monochrome      Same hue, varying lightness (default)
    complementary   Hues spread evenly around the color wheel
    analogous       Neighboring hues for a harmonious feel
    triadic         Three base hues 120° apart
    pastel          Soft, light colors
    warm            Reds, oranges, yellows
    cool            Blues, teals, purples
    earth           Browns, olives, muted greens

  Per-chart override: set "accent" and/or "palette" directly in the chart JSON.
  Per-chart colors: set "colors": ["#hex", ...] to override the palette entirely.
  Single-color pie: set "color": "#hex" on a pie/doughnut for monochrome shading.

MIXED CHART EXAMPLE (dual y-axis)
  \`\`\`chart
  {
    "type": "mixed",
    "title": "Revenue vs Growth",
    "labels": ["Q1", "Q2", "Q3", "Q4"],
    "datasets": [
      { "label": "Revenue", "type": "bar", "values": [50, 65, 80, 95], "yAxisID": "y" },
      { "label": "Growth", "type": "line", "values": [12, 30, 23, 19], "yAxisID": "y2" }
    ],
    "yAxis": "Revenue ($M)",
    "y2Axis": "Growth %",
    "format": "currency",
    "y2Format": "percent"
  }
  \`\`\`
`;

const DIAGRAMS_HELP = `
SDocs — Diagrams
================
Render Mermaid diagrams in markdown using \`\`\`mermaid code blocks.
Mermaid is loaded lazily from CDN only when a diagram is present.

BASIC SYNTAX
  \`\`\`mermaid
  graph TD
    A[Start] --> B{Decision}
    B -- yes --> C[Do this]
    B -- no  --> D[Do that]
  \`\`\`

STANDALONE .mmd FILES
  \`sdoc graph.mmd\` works like \`sdoc file.md\` - the CLI wraps the
  contents in a \`\`\`mermaid fence before opening. Same for share:
  \`sdoc share graph.mmd\`. \`.mermaid\` files work the same way.

SUPPORTED DIAGRAM TYPES
  flowchart / graph         flowchart TD, LR, etc.
  sequenceDiagram           interaction sequences
  classDiagram              UML-style class relationships
  stateDiagram-v2           state machines
  erDiagram                 entity-relationship
  gantt                     timelines
  pie                       proportional breakdown
  journey                   user-journey diagrams
  gitGraph                  git history visualisation
  mindmap                   mind maps
  timeline                  chronological events
  quadrantChart             2x2 matrix
  sankey-beta               flow diagrams
  See https://mermaid.js.org for the full syntax reference.

THEMING
  Diagrams inherit colors from the SDocs blocks cascade:

    \`\`\`yaml
    styles:
      blocks:
        background: "#f4f1ed"   # diagram wrapper bg
        color: "#6b6560"        # node text / lines
    \`\`\`

  In dark mode the inverted block colors apply automatically.
  For finer-grained control, set Mermaid theme variables in the
  diagram source itself, but note that \`%%{init:...}%%\` directives
  are stripped by SDocs as a security measure (they can otherwise
  override sanitisation settings at parse time).

LIMITS
  - Per-diagram source cap: 64 KB.
  - Per-document diagram cap: 50 (excess rendered as plain code).
  - Per-render timeout: 5 seconds (large or pathological graphs error out).

SECURITY
  Mermaid runs with \`securityLevel: 'strict'\` and \`htmlLabels: true\`.
  htmlLabels lets long node labels wrap inside a \`<foreignObject>\`,
  which is otherwise a script-injection vector; SDocs makes that safe
  by post-sanitising the SVG before render. \`<script>\`, \`<iframe>\`,
  \`<form>\`, \`<input>\`, \`<use>\`, animation tags, \`on*\` event handlers
  and \`javascript:\` URLs are stripped (inside foreignObject and out).
  Source caps and a render timeout cover the DoS surface. Treat diagram
  source as untrusted - it travels in the URL hash with the rest of
  the document.

EXAMPLE
  \`\`\`mermaid
  sequenceDiagram
    participant U as User
    participant S as SDocs
    participant C as CDN
    U->>S: open page with diagram
    S->>C: load mermaid.min.js (lazy, first time only)
    C-->>S: script
    S->>S: render() → SVG
    S->>U: paint diagram
  \`\`\`
`;


const CELLS_HELP = `
SDocs - Cells (sheets)
======================
Render data as an inline spreadsheet using \`\`\`cells fenced code blocks.
The body is CSV; the grid shows column letters, row numbers, type-aware
alignment, click-and-drag selection, and a small copy toolbar. No CDN and
no dependency - it renders from the markdown itself.

BASIC SYNTAX
  Put CSV inside a \`\`\`cells fence:

  \`\`\`cells
  Region,Q1,Q2,Q3
  North,100,150,130
  South,90,95,-7
  \`\`\`

  Every row is a row (numbered from 1); every column gets a letter
  (A, B, C ...). A text first row over numeric data is auto-detected as a
  header: shown bold and kept pinned to the top when you sort.

DATA & TYPES
  Numbers are detected and align right; text aligns left; blank fields are
  empty cells. Negatives and decimals are numbers. A quoted value like
  "1,200" stays text (no locale guessing). Full CSV quoting is supported:
  commas inside "quotes", escaped ""quotes"", and quoted fields spanning
  multiple lines.

WRAPPING
  A long value wraps once its column hits a width cap (rather than running
  ever wider), growing the row. A literal <br> becomes a line break, and a
  quoted cell with a real newline keeps it. Cell content is always plain
  text - markup never renders.

FORMATTING
  Numbers display with thousands separators and negatives in red by default.
  An optional first line sets per-column formats by column letter:

  \`\`\`cells
  format: A=plain B=$ C=%
  Year,Revenue,Margin
  2024,12000,0.23
  \`\`\`

  Renders 2024 (plain - no comma), $12,000.00, 23%.

  Format tokens (keyed by column letter):
    $ / usd        currency, e.g. $12,000.00   (also £ / gbp, € / eur)
    %              percent - multiplies by 100, e.g. 0.23 -> 23%
    , / number     thousands separators (the default)
    plain / text   no number formatting (good for years, ids, codes)
    .N suffix      fixed decimals, e.g. $.0 (no cents), %.1, .2

  Formatting is display only - copy and export always emit the original
  values. This is what makes a cells block more than a CSV: the author
  chooses how each column reads.

FORMULAS
  A cell whose value starts with = is a formula, evaluated in the browser.
  The cell shows the result; the formula stays underneath (copy / export and
  the formula bar show the =formula, hovering shows it as a tooltip).

  \`\`\`cells
  Item,Qty,Price,Total
  Widget,10,12,=B2*C2
  Gadget,15,8,=B3*C3
  Total,=SUM(B2:B3),,=SUM(D2:D3)
  \`\`\`

  Supported:
    arithmetic    + - * / ^ %  with parentheses, e.g. =(A1+B1)*2
    references    A1, B12; ranges A1:B3 inside a function
    aggregates    SUM AVERAGE (AVG) MIN MAX COUNT COUNTA PRODUCT
    functions     ROUND(x,n) ABS(x) IF(cond, a, b)
    comparisons   = <> < <= > >=   (mostly for IF)

  A failed formula shows a short red error code: #DIV/0!, #NAME? (unknown
  name), #REF! (bad range), #VALUE! (e.g. text in arithmetic), #CIRC! (a
  circular reference). Formulas recalculate live while you edit.

SORTING
  Hover a column letter: an arrow appears on its right showing what a click
  will do (up = sort ascending, down = descending, x = clear the sort). The
  current sort shows as a colored arrow. A text first row is kept pinned as
  a header. Sorting is a view reorder - it does not change the document;
  copy reflects what is on screen.

  Formula cells sort by their computed value, and that value travels with
  its row: references keep meaning what the author wrote, so a sorted
  =SUM(...) row never recomputes against the shuffled view.

  A trailing summary row - one whose formula aggregates a range of other
  rows, like a Total row with =SUM(D2:D5) - is pinned to the bottom and
  stays there through any sort, the same way a header row stays at the top.
  Per-row formulas like =B2*C2 sort with the data as normal.

RESIZING
  Drag a column header's right edge to set an explicit width; it persists
  through sorts. Otherwise columns size to their content.

SELECTING
  Click a cell to select it; its column letter and row number light up.
  Click a column letter / row number to select the whole column / row.
  Drag to select a range; Shift+Click or Shift+Arrow extends it. Arrow
  keys move the selection; Cmd/Ctrl+Arrow jumps to the far edge;
  Shift+(Cmd/Ctrl+)Arrow extends to it. Dragging to the left/right edge of
  a wide sheet auto-scrolls. Esc clears the selection.

TOOLBAR
  A white bar sits above each sheet:
    - Left: the selection address (e.g. B3 or B2:C3) and, for a sheet
      loaded from a file, the source filename - "B3 · report.csv".
    - Right: a copy icon that copies the WHOLE sheet as CSV (values only,
      no row / column labels).
    - When something is selected, a second button copies just the
      selection ("cell" for one cell, "selection" for a range).
    - A fullscreen expand button opens the sheet as a full-window,
      editable spreadsheet (see FULLSCREEN & EDITING).

LOADING FROM A CSV FILE
  Reference a file instead of typing data inline:

  \`\`\`cells
  {{path/to/report.csv}}
  \`\`\`

  sdoc reads that file (resolved relative to the markdown document), reads
  the whole thing, and bakes the CSV straight into the document. The result
  is self-contained: a shared link shows the data, never a "file not
  found". Only the filename is recorded as the source (shown in the bar),
  not the full path.

  - One reference per cells block (the block's entire body is the
    reference).
  - \`sdoc report.csv\` opens a CSV file directly as a sheet.

LIMITS
  - Per-block source-size cap and a per-document block cap.
  - The inline preview bounds very large grids and notes what it clipped
    ("Showing 200 × 50 of 231 × 60 cells"); the full data still travels and
    copies.

FULLSCREEN & EDITING
  The expand button opens the sheet full-window: frozen headers, both-axis
  scroll, a name box + formula bar, and a Sum / Avg / Min / Max / Count
  footer for the selection. Formula cells count toward those stats by
  their computed value. The fullscreen sheet is editable (the inline one
  stays read-only):
    - Double-click a cell, or just start typing, to edit it.
    - Enter / Tab (and Shift+ to go back) commit and move on.
    - The formula bar edits the active cell; type a value or =formula, Enter.
    - Delete / Backspace clears the selected cell(s).
    - Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z (or Ctrl+Y) redoes.
    - Paste TSV or CSV to drop a block of values in at the selection.
    - Point mode: while typing a formula, arrow keys point at cells and
      write their reference into the formula. Type =SUM( then arrow to a
      cell, hold Shift+Arrow to grow it into a range, type ) and Enter.
      Or arrow to the range start, type :, arrow to the end. Works in the
      cell editor and the formula bar; the pointed cells highlight violet.
  Editing is client-side and ephemeral: changes show in the inline grid when
  you close, but nothing is written back to the document or to any file.

EXPORT
  HTML / Word / PDF export emit a real table of the values (the source
  label and the row / column chrome are dropped).
`;

const SLIDES_HELP = `
SDocs — Slides
==============
Embed presentation slides in any markdown document using fenced
slide blocks. Slides render as thumbnails inline; click the small
present-mode icon in the slide's top-right corner to enter fullscreen.
Text inside a slide thumbnail is selectable. Esc to exit, arrows to
navigate.

\u2500\u2500 COMMANDS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  sdoc present <file>              Open file directly in fullscreen slide view
  sdoc <file>                      Open normally (click a slide's present icon)
  sdoc slides                      This help
  sdoc slides list                 List built-in templates + slot names
  sdoc slides icons [query]        List the Lucide icons available to the
                                   \`icon\` shape kind. Optional substring filter.
  sdoc slides custom-shapes        Long-tail notes for raw-shape custom slides
                                   (polygon text, composite patterns, layering).
                                   Most decks use \`@extends\` and never need this.

── DESIGN GUIDELINES ────────────────────────────────────
  The built-in templates encode a few rules that separate professional
  slides from amateur ones. When you compose slides by hand (no
  template), keep these in mind - they're the difference between a
  deck that lands and one that doesn't.

  Margins. Keep all content inside a 1-unit safe area on every side
  of a 16x9 grid (so x ∈ [1, 15], y ∈ [0.5, 8.5]). Nothing touches
  the slide edge except a deliberate full-bleed background (\`section\`
  uses this; nothing else should).

  No auto-flow. Every shape claims its full (x, y, w, h) rect.
  Source order is paint order, so a later filled rectangle that
  overlaps an earlier text shape's bbox covers its content. Place
  each shape at the previous shape's bottom edge (y + h) or later.
  Common slip: putting content at y=12 right under
  \`r 6 9 88 5 text=subtitle ...\` - the subtitle reserves y=9..14;
  starting the body at y=12 puts the fill on top of the subtitle's
  bottom half. For \`text=title\` and \`text=subtitle\` add another
  ~0.5 grid unit on top to clear glyph descenders; see
  \`slides custom-shapes\` for the fine print.

  No fill colours behind body or title text. The slide background IS
  your canvas. Saturated rectangles compete with content and read as
  "PowerPoint 2003". The only exception: section dividers, which want
  contrast against content slides - use \`grid bg=\` there, not a
  shape \`fill=\`.

  Two or three sizes per slide, max. Stick to the role table:
    text=title    (64px)  for cover, quote, section, metric
    text=subtitle (40px)  for in-deck content-slide titles
    text=body     (24px)  default; bullets, paragraphs
    text=caption  (14px)  ONLY for footers, eyebrows, attributions
  Caption renders as ~3px in a 240px-wide thumbnail - never put
  load-bearing content in caption role.

  Default \`valign=center\`. \`valign=top\` reads right only when the
  body shape is sized to its content. On an oversized body shape
  top-anchoring leaves dead space underneath; centering balances it.

  Content fills 55-65% of the safe area, no more. Empty space is a
  feature: it's what makes a deck feel confident rather than crowded.
  If a shape is mostly empty, shrink the shape - don't fill it.

  Action titles versus topic titles. An action title states the
  claim ("Method X reduced error 40%") and reads like prose. A topic
  title labels what's below ("Methodology"). Both are fine; pick
  one. Action titles tend to wrap to two lines, which is why
  in-deck titles use subtitle role (40px) not title role (64px).

  Body bullets should be parallel. If your bullets don't read like
  a list - if the items have different shapes, weights, or
  connective tissue (because, but, so) - write a sentence instead.
  A bulleted paragraph is hiding the fact that you haven't decided
  what you're claiming.

  When in doubt, \`@extends\` a built-in template instead of
  composing from raw shapes. Run \`sdoc slides list\` to see the
  registry.

\u2500\u2500 FENCE SYNTAX \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  Wrap shape DSL in a ~~~slide fenced block:

  ~~~slide
  grid 100 56.25
  r 5 5 90 15 fill=#1e40af color=#fff text=title | Q4 Review
  r 5 22 42 26 align=left |
    ## Wins
    - Shipped slides
    - Tilde fences
  ~~~

  Tildes (not backticks) so shape content can include \`\`\` code blocks
  without closing the fence early. Triple-backtick \`\`\`slide also works
  (marked accepts either) - but prefer tildes so a nested \`\`\`python
  inside a shape doesn't end the slide block prematurely.

\u2500\u2500 GRID \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  First line: \`grid W H [key=val ...]\`. Default 100 56.25 (16:9).
  All shape coordinates are in grid units.
    grid 100 56.25
    grid 100 75              (4:3)
    grid 100 100             (square)
    grid 100 56.25 bg=#0f172a   (set slide background color)

  W x H defines the aspect ratio and coordinate system, not a pixel size.
  Slides fill whatever space they're rendered into - inline thumbnail in
  a doc, small rail thumbnail in present mode, fullscreen stage, PDF page -
  and text auto-fits via container queries. Pick numbers for the aspect
  ratio you want; 100 on one axis is the convention, making the other
  axis a simple percentage.

\u2500\u2500 RAW SHAPES \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  Templates encode their layouts in shape DSL (\`r\` / \`p\` / \`c\` /
  \`e\` / \`l\` / \`a\` / \`chev\` / \`bub\` / \`cyl\`). As a consumer of a
  template, you don't see these - you fill slots via \`#name: value\`
  (see TEMPLATES below). If you're defining your own \`@template\`,
  or composing a custom slide from raw shapes, run:

    sdoc slides custom-shapes        Shape kinds, ids / @refs, layering,
                                     polygon gotchas, composite patterns

  Three high-level shapes (\`chev\`, \`bub\`, \`cyl\`) ship with their
  text-centring rect already tuned to the visual body, not the
  bounding box. Reach for them before composing the equivalent
  polygon by hand - they save lines AND get the text positioning
  right by default.

\u2500\u2500 ICONS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  The \`icon\` shape kind renders an inline outline icon from the
  bundled Lucide library (https://lucide.dev/icons/, ~1960 icons).
  Use it to mark concepts on a slide - a user, a database, a cloud,
  a lock - without resorting to emoji or raster images.

    icon 8 30 6 6 name=user color=#0F1E3A
    icon 20 30 6 6 name=database
    icon 32 30 6 6 name=cloud-upload strokeWidth=2

  Unknown names render a pink struck-through placeholder, so typos
  are visible rather than silent. To find an icon name, run:

    sdoc slides icons              List every available name
    sdoc slides icons cloud        Filter by substring

  Full attribute reference (color, strokeWidth, lazy-load behaviour)
  lives in \`sdoc slides custom-shapes\` under the \`icon\` shape entry.

\u2500\u2500 SHAPE ATTRIBUTES \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  Between geometry and \`|\`:

  The text-related attributes below apply to BOTH the shapes a
  template defines and the slot content you write as a consumer.
  Visual attributes (fill, stroke, strokeWidth, radius, etc.) are
  documented in \`sdoc slides custom-shapes\`.

  Padding:
    padding=N           Inner padding in grid units (0 disables). On a
                        100-wide grid, \`padding=2\` is ~2% of slide width.

  Alignment:
    align=<a>           Horizontal: center (default), left, right
    valign=<v>          Vertical: center (default), top, bottom

  Text body box:
    textBox=x,y,w,h     Override the rectangle that holds the shape's
                        text content. Values are grid units, relative
                        to the shape's bounding-box top-left. The shape
                        itself (fill, stroke, geometry) is unchanged -
                        only the text inside shifts. Use when the
                        shape is asymmetric and centering text in its
                        bounding box drifts the text off the visual
                        mass.

                        The classic case: a right-pointing chevron
                        polygon. Its bounding box includes the tip,
                        so centred text sits to the right of the
                        chevron body. Set textBox to the body region
                        only:

                          p 6,20 19,20 22,24 19,28 6,28 9,24
                            fill=#4f8aff textBox=0,0,14,8
                            color=#fff text=subtitle | Tokenize

                        Bbox of the polygon is (6,20)-(22,28). The
                        body (excluding the 3u tip) is 13 wide x 8
                        tall starting at (6,20); textBox=0,0,14,8 puts
                        text inside that region.

  Text rotation:
    textAngle=N         Rotate the text WITHIN the shape by N degrees.
                        The shape's geometry (x, y, w, h) is untouched -
                        only the text inside rotates. Useful for vertical
                        axis labels, diagonal stamps, and skewed callouts.
                        Default 0 (no rotation).

                        Cardinal angles (0, 90, -90, 180) "just work":
                          - 90 / -90: text is laid out using the shape's
                            SWAPPED dimensions, so "More autonomous" in a
                            tall narrow shape wraps along the long axis
                            and reads top-to-bottom (90) or
                            bottom-to-top (-90).
                          - 180: text is flipped in place.

                        Non-cardinal angles (e.g. textAngle=37) render
                        but get NO dimension swap and NO autofit help.
                        The text is rotated around the shape's centre;
                        its visible extent will usually exceed the
                        shape's (w, h) box. Size the container so the
                        rotated text lands where you want:
                          rotatedW = |w * cos N| + |h * sin N|
                          rotatedH = |w * sin N| + |h * cos N|
                        The shape's own bbox doesn't change - only the
                        rendered text sticks out. Place neighbouring
                        shapes accordingly, or accept the overlap as
                        intentional.

                        Example (vertical y-axis label):
                          r 8 16 4 32 textAngle=-90 text=caption
                            align=center | More autonomous

  Text sizing (role first, escape hatches second):
    text=<role>         Pick a role from a fixed table. Roles give a
                        deck consistent typography. Default is \`body\`.
                          text=title       64px  (slide titles)
                          text=subtitle    40px  (section heads, sub-titles)
                          text=body        24px  (default; paragraphs, bullets)
                          text=caption     14px  (footnotes, fine print)
                        Unknown roles fall back to \`body\` silently.

    size=Npx            Literal size override; takes precedence over the
                        role. Units: px | pt | em | rem (bare number = px).
                        Use sparingly - the role table is what keeps the
                        deck rhythm consistent.
    size=fit            Opt into auto-fit: binary search for the largest
                        font that fits the shape, capped at 12% of stage
                        height (or the per-shape maxfont= value).

    maxfont=Npx         Caps \`size=fit\` higher or lower than the default
                        stage cap. Has no effect when size= isn't \`fit\`.

    Px values size as if the stage were 720px tall and scale proportionally
    in smaller views (rail thumbnails, inline thumbs), so \`size=18px\` reads
    as "18px on a fullscreen slide".

    A deck that uses only roles (no \`size=\`) lands at 2-3 distinct font
    sizes across all slides, which is what makes presentations look
    professional. Reach for \`size=Npx\` only for hero numbers or other
    one-off treatments.

  Per-element scale (applied inside the shape's shadow root):
    h1Scale=N           h1 is N\u00d7 the shape's resolved font size.
    h2Scale=N           h2 is N\u00d7 the shape's resolved font size.
    h3Scale=N, h4Scale=N, h5Scale=N, h6Scale=N
    pScale=N            Scale paragraph text (default 1).

    Each scale affects ONLY that element type. \`h1Scale=3\` enlarges
    h1 headings, leaves paragraphs alone. The shape's resolved font
    size (the role's px from \`text=\`, the \`size=Npx\` override, or the
    autofit output when \`size=fit\`) is the base for the multiplier.

    Defaults without overrides: h1 1.4, h2 1.2, h3 1.05, h4-h6 1.0,
    p 1.0. Note that h4/h5/h6 render at the SAME size by default, so
    they don't give you three-step hierarchy out of the box - use
    explicit h4Scale/h5Scale/h6Scale if you need a h4>h5>h6 spread.

    When to use: one shape holds mixed content (heading + body) and
    you want the heading BIGGER or the body SMALLER than the 1.4 / 1.0
    default. Two common patterns:

      Hero number (giant + tiny caption, one shape):
        r 10 15 80 30 h1Scale=3 pScale=0.4 |
          # 87%
          of teams ship faster with one-page decks

      Quote card (prominent body, small attribution):
        r 10 15 80 30 h2Scale=0.5 |
          Quote text in body size here.
          ## - Attribution

    Invalid or \u2264 0 values are ignored (fallback to defaults).

  Identification:
    #id                 Reference target for @refs

  Stacking:
    layer=<v>           top | mid | bottom. Default \`mid\` for every
                        kind. Source order alone normally decides paint
                        order; \`layer=\` is an escape hatch for shapes
                        that must sit on top of (or below) everything
                        regardless of where they were declared. See
                        STACKING section below.

\u2500\u2500 CONTENT \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  Everything after \`|\` is standard markdown. Multi-line uses
  indentation under the shape line - continuation lines MUST be
  indented at least 2 spaces, or the parser treats them as fresh
  top-level shape lines (and fails).

    r 5 20 90 60 align=left |
      ## Heading
      Some body paragraph.

      - list item one
      - list item two

      \`\`\`python
      def hi():
          print("hello")
      \`\`\`

  Prefer putting the \`|\` on its own line (empty) with all content
  indented below. Mixing "first line after |" with unindented lines
  is a common parser error.

\u2500\u2500 ALIGNMENT GUIDELINES \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  Default: \`align=center valign=center\`. Good for:
    - Title shapes (one heading or phrase)
    - Subheaders, section labels
    - Standalone caption text

  Switch to \`align=left\` when the shape holds body copy - paragraphs,
  bullet lists, numbered lists, blockquotes. Left-aligned reads better
  once you have multiple lines. Keep \`valign=center\` (the default) so
  the block floats in the middle of the shape; switch to \`valign=top\`
  only when the shape is sized exactly to the content and you want it
  anchored to the top.

  Rule of thumb:
    ONE short phrase  \u2192  leave centered
    MULTIPLE lines    \u2192  align=left, keep valign=center

\u2500\u2500 PULLING FROM DOC STYLES \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  Slides pick up the host document's styles so a deck feels visually
  part of its doc. Two mechanisms, both resolved at render time against
  the active theme (so dark mode just works).

  AUTOMATIC INHERITANCE (no DSL needed)
    - Slide background   = styles.background (unless grid has bg=)
    - Body font          = styles.fontFamily
    - Heading fonts      = styles.headers.fontFamily
    - Code / pre / link  = their respective styles.* values
    - Heading text inside a shape's markdown content adopts the doc's
      h1/h2/h3/h4 color. Example: \`# Title\` in a shape uses styles.h1.color.
      A shape's own \`color=\` always overrides this.

  EXPLICIT REFERENCES ($path.to.prop)
    Any shape or grid attribute value can be a \`\$path.to.prop\` token,
    which resolves to the doc's live value for that style. Common cases:
    \`fill=\$h1.color\`, \`color=\$chart.accent\`, grid \`bg=\$background\`.
    Vocabulary = the YAML schema (run \`sdoc schema\`).

      r 5 5 90 15 fill=\$h1.color color=#fff text=title | Title
      r 5 25 90 25 color=\$chart.accent      | ## 40% growth
      grid 100 56.25 bg=\$blocks.background  (subtle block-tinted slide)

    Supported paths:
      \$background     \$color           \$fontFamily
      \$h.color        \$h1.color  \$h2.color  \$h3.color  \$h4.color
      \$headers.color  \$headers.fontFamily
      \$p.color        \$list.color      \$link.color
      \$blocks.background    \$blocks.color
      \$code.background      \$code.color   \$code.font
      \$blockquote.background  \$blockquote.color  \$blockquote.borderColor
      \$chart.accent   \$chart.background   \$chart.textColor

    Unknown paths surface in the error badge with the rest of the
    diagnostics. Literal hex (#1e40af) still works when you want a
    one-off color that isn't in the doc's styles.

    Blockquote-style card (tinted bg + left accent border): use a
    markdown \`>\` inside any shape. The quote picks up the doc's
    blockquote styling automatically - no \`stroke=\` workaround needed.
      r 50 15 42 30 padding=3 |
        > Our customers are the product
        >
        > - Jordan, CEO

\u2500\u2500 IMAGES \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  Any shape (\`r\`, \`c\`, \`p\`) can hold a bitmap via \`image=<url>\`.
  The URL accepts whatever the browser would load for a standard
  markdown \`![]()\`:

    - \`data:\` URIs       inlined in the DSL, no network fetch
    - \`https://\` URLs    fetched at render time (CORS applies)

  SDocs does not host image bytes. Data URIs live in your document
  (and share URL); external URLs fetch from whatever host you pick.

  Attributes (apply to every shape kind):

    image=<url>              the bitmap source
    imageFit=cover|contain   cover (default) fills the shape box and
                             crops overflow; contain preserves aspect
                             and letterboxes inside the shape
    imagePos=center|top|bottom|left|right
                             which edge is pinned when cover crops or
                             contain letterboxes; default center

  Stacking inside a shape (bottom to top):
    1. \`fill=\` colour backdrop
    2. \`image=\` bitmap (shows fill through image alpha / on load fail)
    3. \`stroke=\` border
    4. \`| content\` markdown text

  Examples:

    # Small corner logo on a rect
    r 14 0.5 1.5 1 image=https://lucide.dev/logo.light.svg imageFit=contain

    # Full-bleed hero with a title overlay (one shape, not two)
    r 0 0 16 9 image=data:image/png;base64,iVBORw0K... align=left valign=bottom padding=0.5 |
      # Q4 review

    # Photo clipped inside a hand-drawn polygon
    p 3,1 13,1 14,5 10,8 6,8 2,5 image=https://example.com/team.jpg

    # Circle avatar with a gold ring (stroke paints above image)
    c 8 4.5 2.2 image=/avatar.jpg stroke=#d4af37 strokeWidth=0.12

  Shorthand: \`i x y w h src=<url>\` is parser sugar for
  \`r x y w h image=<url>\`, a friendly keystroke for the common case.
  \`src=\` is treated as a valid alias for \`image=\` everywhere.

  PDF export embeds PNG and JPEG natively. SVG / WebP / GIF are
  skipped silently (console warning is logged). External URL fetches
  need CORS headers on the host, same constraint as any browser fetch.

\u2500\u2500 STACKING \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  Source order = paint order. A shape declared later in the slide
  paints above shapes declared earlier - regardless of whether it is
  a rectangle, polygon, circle, line, or arrow. To put a connector
  above its cards, declare the arrow after the cards. To put a
  backdrop behind a card, declare the backdrop first.

  Escape hatch: \`layer=top | mid | bottom\` (default \`mid\`) promotes
  or demotes a shape across coarse sublayers, overriding source order.
  Useful inside templates where a consumer slide adds more shapes
  whose declaration order you cannot predict. See the LAYERING
  section of \`sdoc slides custom-shapes\` for the full model.

\u2500\u2500 TEMPLATES \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  Define a shape layout once, reuse across slides. Two directives,
  each must be the first non-blank line inside a slide block:

    @template NAME    Register this slide's DSL as a template.
                      The slide DOES NOT RENDER - it's a definition.
    @extends NAME     Inherit NAME's shapes; fill slot content below.

  Shapes in the template carry an \`#id\` to mark slots. Consumers
  override those slots with \`#id: value\` blocks (inline for a single
  line, colon-only + following lines for multi-line content).

  Author ordering doesn't matter - the consumer can appear before or
  after the template in the document. Templates never render, so they
  don't show up in the thumbnail flow or present mode.

  Example:

    ~~~slide
    @template title-body
    grid 16 9
    r 0 0 16 3 #title fill=\$h1.color color=#fff text=title | placeholder title
    r 0 3 16 6 #body align=left |
      placeholder body
    ~~~

    ~~~slide
    @extends title-body
    #title: What is SDocs?
    #body:
    - Markdown in, styled docs out
    - No server, hash-only state
    - Slides from fenced blocks
    ~~~

    ~~~slide
    @extends title-body
    #title: Why templates
    #body: Define shape once, fill slots N times. Recolor once in front
           matter and every slide that uses the template picks it up.
    ~~~

  Partial fills: if a consumer omits an optional slot (provides
  \`#title\` but not \`#body\`), the template's placeholder content
  stays - so templates are self-documenting when first authored.

  Required slots: mark a slot with a trailing \`!\` (e.g. \`#title!\`)
  in the template. If a consumer omits a required slot, the resolver
  surfaces an error in the slide's error badge. Optional slots have
  no marker.

  Unknown template names, slots that don't match any shape id in the
  template, and missing required slots all surface in the error badge
  alongside any DSL errors.

  Deliberately simple in v1: no attribute overrides (can't change
  \`fill=\` per consumer - fork the template if you need variants),
  no nested templates (a consumer can't extend another consumer).

── BUILT-IN TEMPLATES ───────────────────────────────────
  SDocs ships a small library of opinionated templates. \`@extends\`
  any of them without declaring a user \`@template\` first. Run
  \`sdoc slides list\` for the names + slot lists; the templates all
  use a 1-unit safe margin and avoid full-bleed coloured bars (the
  one exception is \`section\`, which uses \`grid bg=\` for contrast
  between deck sections).

    cover
      Opening slide of a deck. Once per deck. Sets the tone before
      anything else.

    title-body
      The workhorse for content slides - 60-70% of slides in any
      real deck. Title at top in subtitle role (40px) so an action
      title can wrap to two lines without crowding the body.
      Optional footer slot for source, page number, or context.

    two-column
      Compare / contrast (before/after, A vs B, problem / solution).
      A 1-unit gutter splits the columns; optional column headers
      above each. Bodies anchor top so matched-length content reads
      as parallel - keep both columns roughly the same length, or
      switch to title-body and explain the asymmetry in prose.

    three-column
      Three-way compare. A/B/C variants, before/during/after, three
      perspectives on the same question. Equal columns separated by
      a small gutter; optional headers above each. Bias toward
      keeping all three columns roughly the same length - if one is
      half-empty, drop it and use two-column instead.

    exhibit
      Chart on the left (~64% of safe area), takeaway column on the
      right (~32%), optional source caption underneath, required
      action title at the top. The chart is the evidence; the
      takeaway tells the audience what to see. Reserve for business
      decks where the audience needs a verbal handle on the chart
      under time pressure. Sibling templates: \`image-and-text\`
      when image and body should read as balanced peers (54/46,
      title optional and small); \`figure-hero\` when the chart
      should fill the slide with no right column at all.

    image-and-text
      Image on the left (~54% of safe area), supporting body on
      the right (~43%), balanced. Optional small caption-style
      title at the top. Use when the image and the body are about
      equal in weight - "here's a thing + here's what it is".
      Sibling templates: \`exhibit\` when the chart should
      dominate and the right column is a narrow set of takeaway
      bullets; \`figure-hero\` when the image IS the argument
      (no body column). The image slot accepts markdown image
      syntax: \`#image: ![alt](url)\`.

    figure-hero
      Image-dominant slide. The figure carries the whole slide
      and a small caption sits below; no body or takeaway column.
      The workhorse for research talks and any deck where a chart,
      screenshot, or photograph is the point. Sibling templates:
      \`image-and-text\` when you also want a body column;
      \`exhibit\` when you want a chart plus a narrow takeaway
      column for a business audience.

    quote
      Single big idea, customer voice, or a manifesto sentence.
      Centered both axes so short content sits balanced rather
      than drifting top-left. Use for sentences, not numbers -
      reach for \`metric\` when the slide IS a number.

    metric
      One hero number plus a line of context. \`size=fit\` lets the
      number scale to its shape; \`maxfont=300px\` is baked in so it
      can actually feel hero-sized. One short sentence in the
      \`context\` slot is the rule, not three - more text fights
      the number for attention and the slide stops feeling like a
      headline. Use sparingly: one metric slide per deck is the
      pattern, not three.

    section
      Section divider between deck parts. The one template that
      uses a full-bleed background (via \`grid bg=\`) - the contrast
      against content slides is what signals "we're switching
      gears" to the audience. Shape fills are still avoided
      (Consultant-2 rule); only the slide bg is coloured.

    closing
      Quiet bookend at the end of a deck. Center-aligned, minimal.
      Don't write "Thanks for listening" or "Questions?" here -
      both signal "I've run out of content" and the room tunes
      out. Pick something the audience will remember instead
      ("Start this week, not next", "Boring is the goal", the
      one number that summarises the deck, etc.). The contact
      slot is for one short line of channels, not a paragraph.

  A user \`@template <name>\` with the same name as a built-in overrides
  it for the rest of the document, with a warning surfaced on the
  template's slide. So shipping a custom \`title-body\` is fine - the
  resolver just lets you know the stdlib version got shadowed.

\u2500\u2500 ERRORS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  A slide with parse/render errors shows a red badge at the bottom
  of the thumbnail listing every problem by line number. The badge
  has a "Copy" button that puts a diagnostic on the clipboard —
  errors + the full slide source — for pasting back to an agent.

  Common errors:
    - "shape extends outside grid WxH"   y+h > H (or x+w > W)
    - \`unknown id "@name"\`               @-ref before the shape is declared
    - \`duplicate id "#name"\`             two shapes share an id
    - \`invalid attribute key\`            key must start with a letter

\u2500\u2500 LIMITATIONS TODAY \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  - Templates: no per-consumer attribute overrides; no nested templates.
  - Arrows draw as straight lines; no routing around other shapes.
  - No drag/resize edit mode yet; shapes are authored by typing DSL.
`;

const SLIDES_CUSTOM_SHAPES_HELP = `
SDocs — Slides (raw shapes)
===========================
Reference + design notes for slides built from raw shapes rather than
the stdlib templates. Most decks won't need any of this - if you can
express the slide via \`@extends\` on a built-in (cover, title-body,
two-column, exhibit, etc.), do that.

Read DESIGN PRINCIPLES first. The syntax reference below assumes you've
made the visual choices the principles describe. Without them, raw
shapes consistently produce decks that read as "default PowerPoint"
rather than as designed.

── DESIGN PRINCIPLES ─────────────────────────────────
  Raw shapes give geometric freedom that templates don't. That
  freedom is also rope. The notes below are what separate a deck
  that reads as designed from one that reads as amateur.
  Internalise them before reaching for the syntax.

  Stroke.
    Default: NO stroke. Reads modern and confident. The slide
    background carries the silhouette via fill or whitespace; shapes
    don't compete with their own outlines.

    Thin neutral stroke (\`strokeWidth\` <= 0.03, \`stroke=#94a3b8\` or
    a similar cool grey). Reads technical, detail-oriented. Reach
    for this when several shapes' contours need to be visible AND
    the fill contrast isn't doing the work on its own. Good for
    matrices, small multiples, schematic diagrams.

    Thick coloured stroke. AVOID. The strongest tell that a deck
    wasn't designed. It almost never improves the slide. If a shape
    needs a thick coloured border to read, the geometry or fill is
    doing too little work. The only exception is a deliberately
    drawn arrow or callout where the line itself IS the message;
    even then, take the colour from the doc accent, not from a
    third hue.

  Fill.
    Default: NO fill. Most shapes don't need one - the slide
    background reads through and the silhouette is implicit.

    Subtle tint (\`#eef2ff\`, \`#f8fafc\`, or similar near-background
    values). For containers that hold body content - a card around
    a paragraph, a column header strip. The tint should look like a
    faint shadow, not a coloured panel.

    Saturated fill. Reserved for the ONE focal element per slide -
    the navy cell on a segmentation matrix, the SOM tier on a
    market-sizing diagram, the focal band on a funnel. Saturated
    fill is your single "look here" gesture. Spend it once.

  Typography-only is not a custom shape.
    A shape with neither stroke nor fill is invisible - it reads as
    floating text. If you're not encoding geometry (a position, a
    size, a relationship, a comparison), you're writing an
    annotation, and an annotation belongs in a plain text shape or
    in markdown content. The point of a custom shape is the shape;
    if it isn't visible, drop it and use a template slot.

  One deviation per slide.
    Repetition + deviation = recognition. If five shapes share a
    treatment and the sixth doesn't, the eye lands on the sixth
    before reading a single label. The deviation IS the slide.
    Wanting two deviations is usually wanting two slides.

  Shape vocabulary.
    Limit to two shape primitives per deck - typically a rectangle
    for cards / containers, plus one polygon (or circle / ellipse)
    as the variant. Using one primitive consistently across slides
    builds a visual language the audience learns by slide three.
    Six different shapes used once each flat-lines that recognition
    and reads as ornament rather than system.

  Geometry as data.
    Where a shape's size, position, slope, or area corresponds to a
    number in the content, make it accurate. SOM at 4.7% of TAM
    should occupy 4.7% of TAM's area, not 30% because that's what
    fits the layout. A funnel band's width should be proportional
    to its population, not chosen for visual balance. Where shapes
    carry data, geometry IS the argument; labels confirm it.

    When the magnitudes span more than ~50x and a linear scale
    collapses the tail to a hairline, two honest positions:
      a) Linear scale. Let the tail be a hairline. The
         disappearance IS the data (250k next to 28M looks like
         what 250k actually is next to 28M).
      b) Square-root or log scale. Readable across the range; state
         which you used in a caption so the geometry isn't lying.
    Either is fine. Pick deliberately. Don't fudge a linear scale
    into "what looks good" - that is lying with shapes.

  Labels outside the shape when the shape is too narrow.
    A magnitude-proportional shape will sometimes be smaller than
    its label. Pull the label outside (column-aligned, or with a
    short leader line) - shrinking the label to fit a hairline
    shape destroys the only data the shape was carrying. See the
    TEXT INSIDE NON-RECT SHAPES section for the mechanics.

  Visual rhymes across slides.
    A shared element that recurs on every custom-shape slide - a
    horizontal rule at a consistent y, a footer caption pinned to
    the same line, an accent colour reserved for one role - is
    what makes a custom-shape deck feel deliberate rather than
    improvised. Pick one or two such rhymes and hold them across
    every slide you author.

  Restraint over ornament.
    The decision to ADD any visual element should require a reason.
    No fill, no stroke, no extra shape, no second colour is the
    default. Spend visual weight only on the one or two things the
    slide is about. Empty space is half the design.

── SHAPE KINDS ───────────────────────────────────────
  r x y w h            rectangle  (x,y = top-left; w,h = size)
  i x y w h            image rect (sugar for \`r\` with \`image=\`; see IMAGES)
  c cx cy radius       circle     (cx,cy = center)
  e cx cy rx ry        ellipse    (cx,cy = center; rx,ry = half-sizes)
  l x1 y1 x2 y2        line       (decorative, no content)
  a x1 y1 x2 y2        arrow      (decorative, tip lands on (x2,y2);
                                   accepts \`^h\` between endpoints to bow)
  p x1,y1 x2,y2 ...    polygon    (segment operators between points:
                                   ~  ^h  >P  * P1 P2; see below)
  chev x y w h         chevron / arrow-block (x,y = top-left; w,h = bbox
                                   including the pointed right tip).
                                   Text centres on the BODY (excluding
                                   tip), not the bbox.
                                   Attrs: tip=N (tip width, default
                                   min(h/2, w*0.25)); notch=N (V-shaped
                                   left edge for interlocking chevrons,
                                   default 0).
  bub x y w h          speech bubble / callout. Rounded rect body at
                                   (x,y,w,h); the tail points from the
                                   nearest edge to \`tail=tx,ty\` (target
                                   point in grid units, REQUIRED).
                                   Text centres in the body; the tail
                                   does not displace text.
                                   Attrs:
                                     tail=tx,ty (required)
                                     radius=N (corner radius, default 1)
                                     tailStyle=concave (default) | sharp | wide
                                       concave: sides curve toward tail
                                                axis (elegant horn /
                                                teardrop, reads as
                                                designed)
                                       sharp:   straight narrow triangle
                                                (schematic, "needle")
                                       wide:    straight broader triangle
                                                (friendly, generic
                                                callout)
  cyl x y w h          cylinder (database / storage shape). Top and
                                   bottom ellipse caps each take \`lip\`
                                   height (default ~20% of h, capped
                                   by w). Text centres in the body
                                   between the caps.
                                   Attrs: lip=N (cap height).
  tab x y w h          folder / step-marker tab. Body rectangle with
                                   a smaller rectangular tab on top-left
                                   joined by a slope. Text centres in
                                   the body (below the tab).
                                   Attrs: tabW=N (tab width, default
                                   ~38% of w); tabH=N (tab height,
                                   default min(0.22*h, 0.18*w)).
  doc x y w h          document / page with a folded top-right corner.
                                   Text centres in the body; the fold
                                   triangle is rendered as an 18% black
                                   overlay so the corner reads as a 3D
                                   fold over any fill colour.
                                   Attrs: fold=N (fold size, default
                                   15% of min(w, h)).
  cloud x y w h        cloud shape (abstract source / sink for arch
                                   diagrams). Single SVG path adapted
                                   from a real icon library; no internal
                                   seams. Text centres in an inset body
                                   (~15% horizontal, 20% vertical) so
                                   it doesn't float over the bumps.
                                   Attrs: variant=heroicons (default,
                                   sharp / modern) | material (puffy /
                                   friendly) | bootstrap (smooth /
                                   balanced).
  icon x y w h         inline icon from the bundled Lucide library
                                   (~1960 icons). Outline-only, no fill
                                   by default; stroke colour from
                                   \`color=\` attribute.
                                   Attrs:
                                     name=<icon>  (required) - any name
                                                  from the bundled Lucide
                                                  set. Run
                                                  \`sdoc slides icons\` to
                                                  list everything, or
                                                  \`sdoc slides icons cloud\`
                                                  to filter by substring.
                                                  Common ones: user,
                                                  database, server, lock,
                                                  cloud, search,
                                                  trending-up. Unknown
                                                  names render a pink
                                                  struck-through rect
                                                  placeholder so typos
                                                  are visible.
                                     color=<hex>  stroke colour
                                                  (default #0F1E3A).
                                     strokeWidth=N  outline width
                                                    (default 2; Lucide
                                                    convention).
                                   The full icon bundle (~81 KB gzipped)
                                   is lazy-loaded on first use, then
                                   cached for the session. Until the
                                   bundle arrives, a dashed-rect
                                   placeholder marks each icon position
                                   so the layout doesn't reflow when
                                   icons swap in.

  Arrow geometry: the coordinates are the line's centerline. The head is
  symmetric around the line, extending up to 3 * strokeWidth perpendicular
  on each side. So a horizontal arrow at y=5.78 with strokeWidth=0.06
  lines up cleanly with a horizontal line at y=5.78 (same centerline) -
  no need to offset the arrow's y to "clear" the head. For arrows shorter
  than 12 * strokeWidth the renderer scales the stroke (and head) down so
  the tip stays on (x2,y2); the arrow renders thinner than declared, but
  the endpoints stay honest.

  Polygon segment operators (between adjacent point tokens).
  All curve operators use through-point semantics: the value you write
  is a point the curve actually passes through, not a hidden SVG control
  point. "Place the dot where you want the curve to go" works.

    (none)        straight line from previous point
    ~             soft bow with default sagitta = 10% of chord length
                  (shorthand for a gentle ^h; use ^h when you need a
                  specific bow depth)
    ^h            arc / bow by sagitta h perpendicular to the chord;
                  h is the actual peak height at t=0.5. Positive h bows
                  to the LEFT of direction-of-travel (for a rightward
                  chord, that is upward)
    >P            quadratic Bezier whose midpoint passes through P
                  (P is \`x,y\` or \`@ref\`; attached: \`>5,3\` / \`>@card.top\`)
    * P1 P2       cubic Bezier passing through P1 at t=1/3 and P2 at
                  t=2/3 (P1, P2 each \`x,y\` or @ref). For predictable
                  results, keep P1 / P2 within ~20% of chord length
                  perpendicular to the chord; the closed-form cubic
                  through both points uses SVG controls that amplify
                  the offset ~4x, so far-from-chord through-points
                  overshoot dramatically beyond the curve itself.

  Polygon point modifiers (attach to the next point, not to an edge):

    (r            round the corner at the next point with radius r.
                  Walks each adjacent edge back by r / tan(half-angle),
                  replaces the sharp vertex with a circular arc tangent
                  to both edges. Only takes effect when both adjacent
                  segments are straight; silently no-ops if either is
                  curved (~, ^, >, *). If r would consume more than half
                  of either neighbouring chord, it shrinks to fit so
                  adjacent rounded corners cannot overlap.

                  Example, all four corners of a card softened:
                    p (0.4 0,0 (0.4 8,0 (0.4 8,5 (0.4 0,5 fill=#dbeafe

  The same \`^h\` operator works between an arrow's two endpoints to bow
  the arrow into a curve:
    a 2 5 ^0.8 12 5            (rightward arrow bowing upward by 0.8u)
    a @plan.right ^-0.5 @ship.left   (gentle downward bow between two shapes)

  Polygon points are written \`x,y\` (one token per point), not space-
  separated like \`r x y w h\`. The variable point count needs a delimiter,
  so a comma is required inside each point.

  All shapes EXCEPT \`l\` and \`a\` can hold markdown after \`|\` - full
  markdown (headings, lists, bold/italic, code, blockquote, tables).
  Non-rectangle shapes use their bounding box as the text area (see
  the TEXT INSIDE NON-RECT SHAPES section).

  No \`fill=\` on a shape -> transparent (slide background shows through).
  Color values accept any CSS colour: hex (#1e40af), named (tomato),
  rgb(...), rgba(...).

  Polygon examples:
    p 50,10 90,50 10,50 | Triangle
    p 10,10 90,10 ~ 90,50 10,50 | Rounded right edge (the ~ before
                                  a point softens that segment)
    p 2,6 ^0.8 9,6 9,8 2,8 fill=#e9d4a6
                                  (loaf-shaped card: arched top, three
                                  straight sides. Sagitta 0.8 sets the
                                  dome height in grid units)
    p 1,5 >5,1 9,5 1,8 fill=#dbeafe
                                  (one quadratic control point at (5,1)
                                  pulls the top edge into a peak)
    p 0,5 * 4,0 8,10 12,5 fill=#fee2e2
                                  (cubic with two controls: classic S-curve
                                  signature - rises early, falls late)
    p 10,20 60,20 60,10 90,30 60,50 60,40 10,40 | Next steps
                                  (right-pointing arrow shape - text
                                  renders in the polygon's bounding box)

── COMMON PITFALLS ──────────────────────────────────

  1. \`^h\` is perpendicular to the chord, NOT vertical.

     The docs note that "for a rightward chord, positive bows upward"
     - true, but for any other chord direction the bow follows the
     PERPENDICULAR. To dome the top of a polygon across a slanted
     span, use ONE \`^h\` across the whole top, not two arcs meeting
     at an apex:

       p 3,7 ^1.8 13,7 13,8 3,8        smooth dome
       p 3,7 ^1.8 8,2.5 ^-1.8 13,7 13,8 3,8     NOT a dome

     The second form has slanted chords (3,7)->(8,2.5) and
     (8,2.5)->(13,7). Positive \`h\` bows perpendicular-left of each
     chord direction, which points AWAY from the would-be apex - the
     arcs flare outward and meet at a sharp peak, not a smooth dome.

  2. Polygon points use \`x,y\` (one comma-separated token per point).

     Rectangles, lines, and arrows use space-separated coords (\`r x y
     w h\`, \`a x1 y1 x2 y2\`). Polygons need an in-token delimiter so
     the parser knows where one point ends and the next begins:

       p 2,7 8,3 13,7 fill=...     YES
       p 2 7 8 3 13 7 fill=...     parse error

     The parser flags this with a clear "polygon: points use 'x,y'"
     error pointing to the offending line.

  3. Shapes don't auto-flow - overlapping bboxes paint over each
     other.

     Every shape reserves its full (x, y, w, h). Source order is
     paint order, so a later shape with a fill that overlaps an
     earlier text shape's bbox covers that text:

       r 6 9 88 5 text=subtitle | Three nested envelopes
       r 10 12 60 40 fill=#f1f5f9     <- starts at y=12, inside the
                                         subtitle bbox (y=9..14);
                                         subtitle hidden from y=12 down

     The fix: place the next shape at y + h or later (here, y >= 14).
     The standard pattern from the gallery is subtitle at \`y=9 h=5\`,
     so the first content shape goes at y >= 14 (15 is the round
     number most templates use).

     For \`text=title\` and \`text=subtitle\` add another ~0.6 grid
     unit because the glyph itself extends below the baseline. A
     text shape's \`h\` is the layout rect, not a hard clip - letters
     with descenders (g, p, q, y, j) draw about 20% of the font
     size below the baseline, which would hang into a perfectly
     bbox-aligned neighbour:

       r 6 9 88 5 text=subtitle | The team after the Q1 reorg
       r 40 14 20 8 fill=#1e40af | CEO    <- the g in "reorg"
                                            still crosses into the
                                            top of this box

     Two safe budgets:
       a) 1 full grid unit of clearance below a text=subtitle row
          (next shape at y >= 15), or
       b) at least \`0.2 * fontSize\` in grid units (\`text=subtitle\`
          is 40px on REF_H=720, so ~0.6 grid units on a 56.25-tall
          grid).

     The gotcha is loudest under \`text=title\` and \`text=subtitle\`
     because the font is large; \`text=body\` and \`text=caption\` rarely
     trip on it.

     Circles and ellipses paint only the inscribed disc, but their
     bbox still claims the full (cx-r, cy-r, 2r, 2r). A label rect
     that overlaps the bbox CORNERS (outside the disc) is fine; a
     label rect that crosses the disc itself gets painted over,
     even when the label's own bbox doesn't fully overlap the
     bubble's bbox. The safe rule for bubble + label compositions:
     place the label's nearest edge at distance >= r + 0.5 grid
     units from the bubble centre. Common patterns that work:
       a) label centred BELOW the bubble at y = cy + r + 0.5
       b) label to the side at x = cx + r + 0.5 (left edge of label)
     Sizing the label rect to the bubble's bbox - e.g. r 76 18 12 3
     next to c 84 18 2.4 - puts the text directly under the disc
     and the bubble fill covers the end of the label.

  4. Code blocks inside shapes look randomly sized across siblings.

     A \`\`\`fenced code block\`\`\` inside a slide shape sizes its OWN
     font and padding based on its content, not on the surrounding
     shape. Three sibling shapes with identical \`r ... 14 8\` end
     up looking different because their code samples differ in
     line count and line length. The cards then read as a sloppy
     row instead of a parallel set.

     The fix is discipline at author-time:

       a) Give every code-bearing shape the SAME (w, h). Don't let
          the longest sample dictate one card's size and the
          shortest dictate another.
       b) Set an explicit \`size=Npx\` on every code-bearing shape
          so the font matches across the row. Auto-fit picks per
          shape, which is exactly what you don't want for sibling
          comparison.
       c) Set an explicit \`padding=N\` on every code-bearing shape
          to control the inset uniformly.
       d) Truncate examples with \`...\` rather than letting one
          card carry six lines and another two. The point of a
          sibling row is comparison; the longest item sets the
          shape height for everyone.

     Example - three comparable code cards:

       r 6  35 26 12 fill=#F4F6FA size=14px padding=1 |
         \`\`\`json
         ["The", " quick", "..."]
         \`\`\`
       r 36 35 26 12 fill=#F4F6FA size=14px padding=1 |
         \`\`\`json
         [464, 4391, ...]
         \`\`\`
       r 66 35 26 12 fill=#F4F6FA size=14px padding=1 |
         \`\`\`json
         [[0.12, ...], ...]
         \`\`\`

     Same w, same h, same size, same padding, truncated to fit.
     The three cards then read as a parallel set rather than three
     improvisations.

── SHAPE ATTRIBUTES ──────────────────────────────────
  Between geometry and \`|\`:

  Visual:
    fill=<color>        Shape fill
    stroke=<color>      Outline colour
    strokeWidth=N       Outline width (grid units)
    radius=N            Corner radius (rectangles)
    color=<color>       Text colour inside the shape
    image=<url>         Bitmap fill (see IMAGES section)
    opacity=N           0..1; fades the whole shape (fill + stroke +
                        text overlay) at once. Useful for translucent
                        backdrops, ghosted "previous state" shapes,
                        overlapping highlights. Out-of-range values
                        clamp.

  Numeric attributes (strokeWidth, radius) are in grid units - pick
  values relative to your grid size, no prescribed defaults. On a
  100-wide grid, \`radius=2\` is ~2% of slide width.

  For text sizing (text=role, size=, h*Scale=), padding, alignment,
  and slot ids inside templates, see \`sdoc slides\` - those work the
  same in raw shapes and template shapes.

── IDS AND @REFERENCES ──────────────────────────────
  Declare an id with \`#name\`; reference with \`@name\` or \`@name.anchor\`
  from line / arrow endpoints. Omit the anchor to default to centre.

    r 10 10 30 20 #title  | # Main Point
    r 60 10 30 20 #detail | Supporting detail

    a @title @detail               (default: centres of both shapes)
    a @title.right @detail.left    (explicit: right edge to left edge)

  Each endpoint picks its own anchor independently, so you can connect
  the bottom of one box to the top of another:
    l @box-a.bottom @box-b.top

  9 anchors: center (default), top, bottom, left, right, topleft,
  topright, bottomleft, bottomright.

  Anchors resolve against each shape's BOUNDING BOX. For circles and
  ellipses that means the circumscribing rectangle, not the perimeter -
  so @circle.right lands at the box edge, not the curve.

  \`l\` and \`a\` endpoints can mix \`@ref\` with raw \`x y\` coords freely,
  e.g. \`l @title.bottom 50 30\`.

  Note that \`#name\` is overloaded: in a \`@template\` declaration it
  marks a slot for consumers to fill; in a raw slide it marks an id
  for @refs. Same syntax, two purposes - context decides.

── TEXT INSIDE NON-RECT SHAPES ──────────────────────
  Text inside a polygon, circle, or ellipse lays out in the shape's
  AXIS-ALIGNED BOUNDING BOX, not the visible silhouette. For a trapezoid,
  triangle, or arrow this means the text rectangle is larger than the
  filled shape - long labels can overhang the slanted edges and end up
  partly outside the visible polygon.

  Example. A funnel band:
    p 1,1.8 15,1.8 14.2,3 1.8,3 fill=#e0e7ff align=left | 28M devs
  The bounding box is x ∈ [1, 15], y ∈ [1.8, 3]. \`align=left\` parks the
  text at x ≈ 1, which is the leftmost point of the WIDEST corner.
  At the bottom of the band the silhouette only reaches x ≈ 1.8, so a
  two-line label would clip on the second line.

  Two ways to handle this:

  1. Short, centered labels.
     Use \`align=center\` and keep the label short enough that it fits
     within the silhouette's narrowest waist. Works for symmetric
     trapezoids, hexagons, ellipses.

       p 5.4,7.4 10.6,7.4 9.4,8.3 6.6,8.3 fill=#312e81 color=#fff align=center |
         **250k**

  2. Shape-only + separate text-r on top.
     Draw the polygon WITHOUT content (no \`|\`), then place an \`r\` shape
     on top, sized to fit safely inside the silhouette. Lets the text
     box be a clean rectangle while the visible silhouette stays slanted.

       p 1,1.8 15,1.8 14.2,3 1.8,3 fill=#e0e7ff
       r 2,2 12,0.8 align=center valign=center |
         **21M** use any AI tool at work

     The \`r\` paints above the \`p\` because it is declared after the \`p\`
     in source order. Reverse the lines and the polygon would cover the
     rect instead.

── POLYGON GEOMETRY ──────────────────────────────────
  Slant strength. A trapezoid where each side indents 0.8u over a
  1.2u height (a ~6% slant) reads as a rectangle. If you want the
  viewer's eye to see "narrowing", make each side indent at least
  ~15% of the band's height. For a stack of bands (funnel, pyramid),
  pick a constant slant ratio across all bands so the silhouette
  reads as one continuous taper rather than a hinge between
  rectangles and triangles.

  Order matters within a slide. Shapes declared later paint over
  shapes declared earlier (this applies across types — see LAYERING).
  For nested concentric shapes (TAM/SAM/SOM), declare the outermost
  first; inner shapes cover the outers' label space. Plan your label
  positions in the VISIBLE RING between each shape and its inner
  neighbour - or move labels out to an adjacent \`r\` column.

  Curved segments. Five operators between adjacent points: no operator
  is a straight segment; \`~\` gives a soft bow at 10% of chord length;
  \`^h\` arcs / bows the segment by an explicit sagitta h; \`>P\` is a
  quadratic that passes through P at its midpoint; \`* P1 P2\` is a cubic
  that passes through P1 and P2 at the curve's third-points. Controls
  can be \`@refs\`, so the curve docks exactly onto another shape's edge:

    r 1 2 4 3 #card
    r 11 2 4 3 #note
    a @card.right ^0.6 @note.left   (curved arrow between two cards)

    p @card.bottomleft >@card.bottom @note.bottomleft @note.bottom \\
      @note.bottomright @card.bottomright fill=#f1f5f9
                                  (banded shape: top edge dips between
                                  the two cards' bottom centers)

  Bow direction. Positive sagitta bows to the LEFT of direction-of-
  travel. For a horizontal chord moving right, positive bow = upward.
  Negative bow flips the curve to the opposite side. The same
  convention applies to polygon \`^h\` segments and bowed arrows.

  Useful for: rounded card corners, dome / loaf tops, speech-bubble
  tails, curved connectors, organic silhouettes (leaves, clouds, lenses),
  S-curve callouts. Bad for text-bearing shapes because the bounding
  box still treats the curve as if it were a straight chord, so labels
  may overhang the visible silhouette.

  Concave polygons. The bounding box of a concave shape includes the
  concavity - text can sit in the notch and overlap a neighbouring
  shape. For concave shapes (arrows, callouts, chevrons), use the
  shape-only + r-overlay pattern.

── COMPOSITE PATTERNS ───────────────────────────────
  Each pattern obeys the DESIGN PRINCIPLES above: at most one
  saturated fill per slide (used as the focal element), thin neutral
  strokes only when contour is doing real work, labels outside the
  shape when the shape is too narrow to hold them.

  Process flow with a focal step.
    Two pale frames + one navy focal step. The navy IS the slide's
    one deviation - it tells the audience which step matters.
    r 1,3.5 3,1.5 stroke=#cbd5e1 strokeWidth=0.02 align=center valign=center | **Plan**
    r 4.5,3.5 3,1.5 stroke=#cbd5e1 strokeWidth=0.02 align=center valign=center | **Build**
    r 8,3.5 3,1.5 fill=#1e40af color=#ffffff align=center valign=center | **Ship**
    a @plan.right @build.left
    a @build.right @ship.left

  TAM/SAM/SOM with magnitude-proportional rectangles.
    All three rects share their top-left corner; sides scale by
    \`sqrt(value / 32)\` so the AREAS read as the dollar values, not
    just "three nested shapes". Labels live in the right column with
    short leaders - the inner rects are too small to hold them and
    putting labels inside would hide some behind others. Only the
    focal SOM uses saturated fill.

    # TAM 32 -> sqrt(32/32) = 1.0  (9.0 x 6.0 = 54 sq u)
    # SAM  8 -> sqrt( 8/32) = 0.5  (4.5 x 3.0 = 13.5)
    # SOM 1.5 -> sqrt(1.5/32) ~ 0.22  (2.0 x 1.3 ~ 2.6)
    r 1,2 9 6   stroke=#94a3b8 strokeWidth=0.02
    r 1,2 4.5 3 stroke=#94a3b8 strokeWidth=0.02
    r 1,2 2.0 1.3 fill=#1e40af
    r 11,2 4 6 align=left valign=top |
      **TAM** $32B - global developer tools
      **SAM**  $8B - AI-coding subset
      **SOM** $1.5B - CLI-agent slice (4.7% of TAM by area)

  Callout / speech bubble.
    Polygon for the bubble outline (thin neutral stroke; no fill),
    \`r\` for the text content positioned to avoid the bubble's tail.
    Reserved for genuine annotation - if the callout could be a
    body paragraph, make it one.

── LAYERING ────────────────────────────────────────
  Source order = paint order. The shape declared later in the slide
  paints on top of shapes declared earlier. This holds across shape
  types — a polygon declared after a rectangle paints above that
  rectangle and vice versa.

    # Rect first, polygon second - polygon paints on top.
    r 2 2 10 5 fill=#1e40af
    p 4,3 12,3 12,6 4,6 fill=#fde68a

    # Reverse the lines, the rect is on top instead.

  That's the whole rule for 95% of decks. If you want a connector
  arrow above the cards it joins, declare the arrow last. If you want
  a backdrop behind a card, declare the backdrop first.

  Escape hatch: \`layer=top | mid | bottom\` (default \`mid\`)

  When source order isn't enough — usually inside a template whose
  consumer adds more shapes — set \`layer=\` to promote or demote a
  shape across the three coarse sublayers:

    bottom  - paints before everything regardless of source position
    mid     - the default
    top     - paints after everything regardless of source position

  Invalid values surface in the error badge. For hand-authored slides
  you should rarely need \`layer=\` at all; reaching for it is a hint
  that the shape order itself wants reordering.

── IMAGES IN SHAPES ────────────────────────────────
  Any shape (\`r\`, \`c\`, \`p\`, etc.) can hold a bitmap via \`image=<url>\`
  or the \`i x y w h\` shape sugar (parser-equivalent to \`r\` + \`image=\`).
  See the IMAGES section in \`sdoc slides\` for the full reference -
  it works the same in raw shapes and template image slots.

── WHEN TO STOP AND USE A TEMPLATE ─────────────────
  If your custom slide ends up being "title at top + body below" or
  "title + two columns" or "title + chart + takeaway", you're
  re-implementing a stdlib template. Run \`sdoc slides list\` and pick
  the closest match - the templates encode safe margins, role
  typography, and slot semantics that you'd otherwise have to re-derive.

  Raw shapes earn their keep for: market sizing diagrams, custom
  funnels / pyramids / matrices, decision trees, process flows with
  arrows between named blocks, anything where the GEOMETRY is the
  message. For everything else, \`@extends\` first.

See also:
  sdoc slides            Main slide DSL reference
  sdoc slides list       Built-in templates + slot lists
  sdoc charts            Chart fenced blocks (\`\`\`chart)
  sdoc diagrams          Mermaid fenced blocks (\`\`\`mermaid)
`;

const LIBRARY_HELP = `
SDocs - Library
===============
The library is a personal, on-machine index of every markdown file you
open with \`sdoc <file>\`. It lets you search, browse, and re-open your
notes without remembering where they live on disk.

WHAT IT IS, IN ONE PARAGRAPH
  Every \`sdoc <file>\` writes a small record into ~/.sdocs/library-
  index.json - the file path, its title, its tags, when it was last
  touched. A small loopback HTTP server reads that index when you visit
  sdocs.dev/library in a browser, so the page can show your files
  without anything leaving your machine. Click a result and SDocs spins
  up a live editing session against the file on disk. Nothing about
  the library ever touches a remote server.

COMMANDS
  Open and inspect
    sdoc library                          Open the library UI at
                                          sdocs.dev/library (or
                                          localhost:3000/library when
                                          running the dev server).
                                          Starts the local agent if it
                                          isn't already running.
    sdoc library ls                       List markdown indexed under
                                          this project (walks up to the
                                          nearest .git, falls back to
                                          cwd). Pass a path to override
                                          scope: \`sdoc library ls ~/notes\`.
    sdoc library ls --tags                Same scope, but prints the tag
                                          bag (tag - count, sorted by
                                          frequency). Run before tagging
                                          a new file to stay consistent.
    sdoc library status                   Print enabled/disabled, entry
                                          count, last scan time.

  Refresh
    sdoc library rebuild                  Walk \$HOME again from scratch
                                          and refresh every entry. Use
                                          after moving files around or
                                          when an entry seems stale.

  On/off
    sdoc library enable                   Re-enable indexing-on-open if
                                          you had turned it off. New
                                          opens will be recorded again.
    sdoc library disable                  Stop indexing on \`sdoc <file>\`.
                                          The existing index is left in
                                          place; the library page still
                                          shows what's already there.

  Autostart (macOS)
    sdoc library autostart                Same as \`autostart status\`:
                                          print whether the LaunchAgent
                                          is installed.
    sdoc library autostart enable         Install the LaunchAgent so the
                                          loopback agent comes back on
                                          every login. This is the
                                          default the first time you run
                                          \`sdoc library\`.
    sdoc library autostart disable        Remove the LaunchAgent and
                                          record that you turned it off;
                                          the default-on logic respects
                                          this until you re-enable.
    sdoc library autostart status         Print whether the LaunchAgent
                                          is installed and where its
                                          plist lives.

  Help
    sdoc library --help                   This help.
    sdoc library help                     Same.

WHAT GETS INDEXED
  Every file you open with \`sdoc <file>\` is recorded at open time.
  \`sdoc library rebuild\` additionally walks \$HOME looking for
  markdown that fits these rules:
    - extension is .md, .mdx, or .markdown
    - size is at most 1 MB
    - not under a hidden directory (.git, .venv, .cache, ...)
    - not under a system / framework directory (node_modules, dist,
      build, target, vendor, .next, __pycache__, ...)
    - not under a sensitive directory (.ssh, .aws, .gnupg, .docker,
      .kube, .gcloud, .azure, .bitwarden, .password-store)
    - the file's basename does not match the deny list (SSH keys,
      .env files, .key/.pem/.crt/.kdbx etc., credentials.json,
      api-secret.yaml, ...). Markdown is deliberately NOT denied by
      name - \`credentials-handling.md\` is a legitimate note about
      secrets, not a secret.
    - the file is not excluded by a .sdocsignore (see below)
    - the file's front matter does not contain \`sdocs-library: false\`
      (per-file opt-out)

PER-FILE OPT-OUT
  Add \`sdocs-library: false\` to a file's YAML front matter to keep
  it out of the library. The file still opens with \`sdoc <file>\`,
  it just isn't indexed.

  ---
  title: My private notes
  sdocs-library: false
  ---

PER-DIRECTORY EXCLUDES (.sdocsignore)
  Drop a \`.sdocsignore\` file into any directory. Subset of gitignore
  syntax:
    # comments and blank lines are skipped
    drafts/                  exclude this directory
    *.local.md               exclude by glob, basename match
    sub/secret.md            anchored path match (relative to this file)
    **/scratch/              cross-directory globstar
  Patterns inherit downward. Negation (\`!\`) and other gitignore
  niceties are not in v1.

EPHEMERAL PATHS AND RESCUE
  Files opened from OS-managed temp folders are special: the OS will
  clean them on its own schedule (next reboot, days later, when you
  empty the trash). The library handles this by taking a one-shot
  RESCUE COPY at index time and pointing the entry at the copy.

  Rescue triggers when the path sits inside any of:
    macOS    /tmp, /private/tmp, /var/tmp, /private/var/tmp,
             ~/.Trash, plus Node's os.tmpdir()
    Linux    /tmp, /var/tmp, /run, /dev/shm, ~/.cache, plus os.tmpdir()
    Windows  %TEMP%, %TMP%, C:\\Windows\\Temp

  The copy lives at ~/.sdocs/library/rescued/<hash>-<basename>. The
  hash prefix avoids name collisions between two /tmp/notes.md from
  different sessions. The entry's \`rescuedFrom\` field records the
  original path; the agent's security gate accepts requests for both
  the rescued copy and the original path.

  Caveat: rescue is a SNAPSHOT, not a live mirror. Edit \`/tmp/foo.md\`
  after the first \`sdoc\` and the rescued copy is stale until you
  re-open the file (which triggers an index update). Once the OS
  deletes the original, the rescued copy is what you have.

TAGGING (TWO WAYS TO TAG)
  Tags live in the file's YAML front matter on disk. There are two
  ways to put them there:

  1. Write the front matter directly. The canonical place; survives
     every export and round-trip.

       ---
       title: Q2 plan
       tags:
         - planning
         - q2
         - finance
       ---

     The Tags row in the file-info card (browser editor) is also a
     write into the file's front matter, performed by the Bridge.

  2. CLI flag at open time. Append \`+tag\` to any \`sdoc\` invocation:

       sdoc plan.md +planning +q2

     SDocs injects those tags into the file's YAML front matter
     before the browser receives the content, so they survive future
     opens, exports, and any sync. The \`+\` prefix is shell-safe
     (\`#\` would be eaten as a comment). Multiple \`+tag\` args
     anywhere on the command line are allowed.

  #words in prose are NOT extracted as tags. Front matter is the
  one source of truth; everything else is a way to write to it.

EDITING TAGS FROM THE BROWSER
  Open any indexed file (\`sdoc <file>\`) and look at the file info
  card above the document. There is a Tags row with chips. Hover a
  chip for an \`x\` to drop it; click \`+\` at the end of the row to
  add a new one.

  Edits happen through the BRIDGE (the WebSocket connection that
  also handles live save). The library agent never writes content -
  exactly one process writes to your file at a time, which avoids
  the race condition two parallel writers would create.

  If the Tags row is read-only with a hint, you opened the file via
  a short link or hash URL and there is no Bridge to save through.
  Open the file via \`sdoc <file>\` to get an editable Tags row.

CONSISTENCY HINTS FOR AGENTS
  Before tagging a new file in a project, run:

      sdoc library ls --tags

  This prints the project's current tag vocabulary (tag - count). Re-use
  existing tags where possible so the library stays consistent. The
  scope walks up to the nearest .git, so cd anywhere inside the repo
  works.

  To see what's already in the project:

      sdoc library ls

THE LOCAL AGENT
  The library page (sdocs.dev/library or localhost:3000/library) is
  hosted from the SDocs server; the data it shows comes from a tiny
  HTTP server the CLI runs at 127.0.0.1:47843. That server:
    - reads ~/.sdocs/library-index.json
    - never writes user content (writes go through the Bridge)
    - refuses any browser request whose Origin is not sdocs.dev,
      smalldocs.org, or localhost:3000 (extend with SDOCS_URL or
      SDOCS_AGENT_ALLOWED_ORIGINS)
    - refuses requests whose Host header is not 127.0.0.1 / localhost
      (DNS-rebinding guard)
    - refuses path arguments outside the library, on the deny list,
      or behind a symlink that resolves outside the library
  If port 47843 is busy, the CLI falls back to a random port and
  prints the URL with the port baked in.

AUTOSTART (macOS)
  The first time you run \`sdoc library\`, a LaunchAgent plist is
  written to ~/Library/LaunchAgents so the agent comes back after
  every reboot. Turn it off explicitly with:

      sdoc library autostart disable

  Once disabled, the default-on logic does not re-enable it without
  you running \`sdoc library autostart enable\` again. The browser
  shows a small recovery banner only when autostart was enabled but
  the agent isn't actually answering.

  Linux and Windows do not have autostart in v1. The agent only
  runs when you start it explicitly with \`sdoc library\`.

CLI INTERACTION CHEAT SHEET FOR AGENTS
  Before authoring a new note inside a project:
    sdoc library ls --tags         see the project's tag vocabulary

  When opening or creating a file with tags:
    sdoc draft.md +planning +q2    tags get written into front matter

  When you want a file kept OUT of the library:
    add \`sdocs-library: false\` to its YAML front matter

  When the user asks "where is X?":
    sdoc library                   opens the search UI in their browser

PRIVACY MODEL
  The library is per-machine and per-user. Nothing about it is
  uploaded to sdocs.dev or any other server. The browser page on
  sdocs.dev calls the local agent over plain HTTP on 127.0.0.1; it
  cannot see file content the agent doesn't already have indexed,
  and the agent cannot read files outside the library.

COMMON QUESTIONS
  Q: I opened a file but I don't see it in the library.
  A: Check \`sdoc library status\` (is it enabled?), then
     \`sdoc library rebuild\`. If the file is in front matter
     \`sdocs-library: false\`, that's the opt-out. Also check for a
     .sdocsignore in the file's directory or any ancestor.

  Q: The library page shows "agent is not running".
  A: Run \`sdoc library\` once to start it, or enable autostart with
     \`sdoc library autostart enable\`. The banner is dismissible if
     you don't want one running.

  Q: A tag I added in the browser didn't save.
  A: The Tags row needs a connected Bridge. Open the file via
     \`sdoc <file>\` (not via a share URL or short link) so the
     editor knows the on-disk path.

  Q: I added a tag with \`+tag\` but it didn't appear.
  A: The \`+\` is what makes it a tag arg; \`tag\` alone would be read
     as a filename. Valid form: \`+name\` where name starts with a
     letter and contains letters, digits, underscores, or hyphens
     (max 64 chars).

  Q: I want to keep work notes out of the library.
  A: Add \`sdocs-library: false\` to the file's front matter, or
     drop a \`.sdocsignore\` into the directory with the pattern.
`;

module.exports = { HELP, COMMENTS_HELP, SCHEMA, CHARTS_HELP, DIAGRAMS_HELP, CELLS_HELP, SLIDES_HELP, SLIDES_CUSTOM_SHAPES_HELP, LIBRARY_HELP };
