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
  sdoc comments                    Comment-format reference (for agents)
  sdoc feedback                    Interactive form DSL reference (\`\`\`form blocks)
  sdoc feedback <file>             Open <file> for the user to fill in; exits on first submit
  sdoc feedback <file> --keep-open Stay alive across many submits; tail stdout per click
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

  Local fields (path, fullPath) are passed to the browser via a
  separate URL parameter that JS reads into memory and then strips
  from the address bar on load. They never appear in any URL the
  user can copy, and \`sdoc share <file>\` never includes them in
  the generated link. If someone opens your shared URL, only
  \`file\` is visible.

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

module.exports = { HELP, COMMENTS_HELP, SCHEMA, CHARTS_HELP, DIAGRAMS_HELP };
