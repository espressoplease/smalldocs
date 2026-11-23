# Frontend architecture (`public/`)

Read this guide when working on browser HTML, CSS, or JS under `public/` (note: this guide lives in `maintainers/` rather than `public/` because `walkPublic()` hashes and serves every non-dotfile inside `public/`).

## Architecture

The editor app is stateless in the browser. All state (current markdown content, parsed front matter, style values) lives in the `window.SDocs` namespace, primarily `SDocs.currentBody` and `SDocs.currentMeta`.

Styles are driven entirely by CSS custom properties on `#rendered`. Every control in the right panel maps to a `--md-*` variable. No style objects are stored separately - `collectStyles()` reads the DOM when exporting.

### JS module communication

All browser JS modules communicate through `window.SDocs` (created by `sdocs-state.js`). Modules register functions on `SDocs` for cross-module access (e.g. `SDocs.syncAll`, `SDocs.setColorValue`). Event handlers use late binding - they reference `SDocs.fn()` rather than capturing `fn` at parse time, so modules can load in sequence without forward-declaration issues.

**Script load order** (in `public/index.html`):
`marked` -> `sdocs-marked-del.js` -> `purify` -> `sdocs-yaml.js` -> `sdocs-styles.js` -> `sdocs-state.js` -> `sdocs-slugify.js` -> `sdocs-theme.js` -> `sdocs-controls.js` -> `sdocs-chrome.js` -> `sdocs-export.js` -> `sdocs-write.js` -> `sdocs-charts.js` -> `sdocs-math.js` -> `sdocs-mermaid.js` -> `sdocs-mermaid-focus.js` -> `sdocs-comments.js` -> `sdocs-app.js` -> `sdocs-info.js` -> `sdocs-comments-ui.js`

`sdocs-comments-ui.js` loads after `sdocs-app.js` because it hooks into `SDocs.commentsUi.{enter,exit}` from inside `setMode`; that wiring needs the orchestrator's `setMode` defined first.

## Module inventory (`public/`)

- `index.html` - markup only
- `css/tokens.css` - CSS custom properties, dark theme, theme transitions
- `css/layout.css` - reset, body, topbar, main layout, left panel, divider
- `css/rendered.css` - `#rendered` markdown styles, collapsible sections, copy buttons
- `css/panel.css` - right panel, controls, statusbar
- `css/mobile.css` - mobile `@media` breakpoint
- `css/write.css` - write-mode contentEditable surface and toolbar
- `css/comments.css` - comment-mode card / popover / gutter styling
- `sdocs-yaml.js` - symlink to `../cli/shared/sdocs-yaml.js` (YAML front matter parse/serialize, UMD shared with Node)
- `sdocs-slugify.js` - symlink to `../cli/shared/sdocs-slugify.js` (slugify heading text to URL-safe IDs, UMD shared with Node)
- `sdocs-styles.js` - symlink to `../cli/shared/sdocs-styles.js` (pure style data tables + logic, UMD shared with tests)
- `sdocs-slide-stdlib.js` - symlink to `../cli/shared/sdocs-slide-stdlib.js` (UMD shared with Node)
- `sdocs-marked-del.js` - overrides marked's GFM strikethrough tokenizer to require double tildes (`~~x~~`); bare `~` pairs ("~$14,527 ... ~17-year") stay literal text instead of striking through the span between them. Loads right after `vendor/marked.min.js`. UMD shared with tests (`test/test-marked-del.js`)
- `sdocs-state.js` - shared `window.SDocs` mutable state namespace
- `sdocs-theme.js` - Google Fonts, font loading, dark mode, theme toggle
- `sdocs-controls.js` - CSS variable management, color cascade, control wiring
- `sdocs-chrome.js` - topbar / overflow menu / mobile sheet wiring
- `sdocs-export.js` - PDF/Word/MD export, save-default styles
- `sdocs-write.js` - write mode editor (contentEditable, toolbar, key handling)
- `sdocs-charts.js` - Chart.js integration for ```` ```chart ```` fenced blocks
- `sdocs-math.js` - KaTeX integration for `$$...$$` blocks
- `sdocs-mermaid.js` - Mermaid integration for ```` ```mermaid ```` fenced blocks (lazy CDN, post-sanitised SVG)
- `sdocs-mermaid-focus.js` - per-diagram fullscreen pan/zoom modal (drag, wheel, fit/100%/reset, ESC)
- `sdocs-comments.js` - pure comment data model (anchor resolution helpers, YAML round-trip, footnote serializer), UMD shared with tests
- `sdocs-comments-ui.js` - browser-only comment UI: rendering, selection popover, composer, navigation
- `sdocs-cells.js` - pure cells data model (CSV parse, type classify, column names, format directive, `workbook/sheet` fence split via `parseFenceInfo`, selection stats, sort, header detection), UMD shared with tests
- `sdocs-cells-formula.js` - pure formula engine for `=` cells (tokenize/parse/eval, refs + ranges, whole-model recalc with cycle detection), UMD shared with tests
- `sdocs-cells-xlsx.js` - pure `.xlsx` writer (stored ZIP + SpreadsheetML, live formulas, number formats), zero dependencies, UMD shared with tests. `buildXlsx` writes a single sheet; `buildXlsxWorkbook` writes a multi-sheet workbook (one shared styles part, per-sheet content-type/rels, cross-sheet formula qualifiers rewritten to sanitised + de-duped Excel sheet names)
- `sdocs-cells-ui.js` - ```` ```cells ```` renderer: CSS-grid sheet (inline + fullscreen via a `fullscreen` flag), formula display, number/format rendering, copy toolbar, xlsx download, JS scroller sizing. `processCells` partitions blocks by workbook id (the `workbook/sheet` fence): each workbook is named/recalced in isolation and renders as its own tab strip; the shared `S.cellsWorkbook` list is tagged so `cellsWorkbookFx` and the fullscreen overlay filter back to a sheet's own workbook
- `sdocs-cells-select.js` - cell + range selection and keyboard navigation for a cells grid
- `sdocs-cells-focus.js` - fullscreen "focus" overlay for a sheet (name box, formula bar, selection stats footer); hosts the editor
- `sdocs-cells-edit.js` - client-only in-cell editing for the fullscreen view (type/dblclick to edit, nav keys, undo/redo, delete-clear, TSV/CSV paste); mutates the shared model, never the document
- `sdocs-code-focus.js` - fullscreen view for a code block or whole opened code file (details below)
- `sdocs-code-comments.js` - pure data model for code comments, UMD shared with tests (details below)
- `sdocs-code-lang/<lang>.js` - per-language structural-keyword tables, lazy-loaded by file extension; drive the collapsed-class outline (a `structural` line survives the fold, a comment or stray statement does not)
- `sdocs-app.js` - render orchestration, hash encode/decode, Brotli compression, syncAll, mode switching, drag/drop, file info card, scroll hints, init
- `sdocs-info.js` - info panel, feedback link, notification dot

## Code focus and code comments

### Fullscreen code viewer (`sdocs-code-focus.js`)

Fullscreen view for a code block or whole opened file: line-number gutter, soft wrap, language-aware hierarchical folding (collapse-all master + per-row chevrons), and comment mode.

- **Comment UI**: hosts the comment UI directly, sharing the markdown reader's comment visual language: a "Commenting as" author + colour prefs cluster, the speech-bubble gutter add affordance, a comment-colour line tint (the `.sdoc-anchor` analogue) and method stripe, click-to-edit tinted cards, Lines/Methods granularity toggle, note navigation, and a drag-select "comment on selection" popover that creates a token comment (a precise mark over the chosen phrase plus a card below the line).
- **Cards-below layout invariant**: every code comment renders as a full-width card below its line, never inline. A box spliced into a preformatted code line collides with the monospace grid (prose reflows around an inline pill, code cannot), so cards-below is the only overlap-proof layout. A token comment additionally marks its phrase; only line/method draw the whole-line wash so a token reads precisely. (`test/code-comment-parity.spec.js` has a headless geometry test asserting no comment card ever overlaps code text.)
- **Cross-surface editing**: prose inline comments that fall in the open block render here too (mark + card below) and are fully editable: edit/delete dispatch by kind (a prose `inline` comment routes to the prose store, a code comment to the code store), so a comment behaves identically in the reader and the viewer regardless of where it was made.
- **Colour & entry**: new notes take the pref colour, which drives `--sdoc-cc-accent` so every affordance reads in one colour. `open(pre, {comment:true})` opens straight into comment mode (used by the reader-side indicator).
- **Topbar**: order is `wrap · fold · copy · comment · download | theme` (a `.sdoc-code-focus-sep` divider before the viewer-local light/dark toggle, mirroring the prose toolbar).
- **File-info card & short links**: carries the same short-link UI as the prose file-info card - a "Generate" intro row (`.sdoc-cf-shortbtn` + the encrypted-on-server note) that, once minted, shows the URL in a copyable "Short URL" row - via the shared `S.generateShortLink` (which also sets the staleness snapshot). A short link to a whole-file code doc auto-opens this view: `maybeAutoExpandCodeFile()` runs on both the `#md=` load and the `/s/` short-link load (and falls back from `.pre-wrapper > pre` to the first `pre` so it still fires when the page loads in comment mode). The short-link UI (and the local-path rows + footer note) only render when the whole document is one code file (`S.wholeFileCodeLang(S.currentBody)`): a short link always encodes the whole document, so offering it from a code block expanded out of a mixed prose+code doc would share the whole article and open it in reading mode, never that isolated block.

### Code comment data model (`sdocs-code-comments.js`)

Pure data model for code comments, UMD shared with tests:

- **Anchoring**: line-, method-, or token-anchored; a `token` comment carries the selected `quote` and degrades to a line comment without one; each is tagged with a `block` (`"pre:N"`) so multi-block docs keep their notes apart. Provides add/remove/update, colour + text sanitisation, `resolveLine()` re-anchoring after the file shifts, and JSON serialize/parse.
- **Copy-with-comments**: `serializeBlockComments()` is the single copy-with-comments serializer both the reader and the viewer call: clean fenced source plus an ordered notes list that locates every comment kind (inline/token by quote, line/method by line, block as whole-block), so both copy buttons produce identical, complete output. (`serializeAnnotations()` is the older code-only version, kept for back-compat.)
- **Unified comment store**: code comments live in the document's single comment store (`currentMeta.comments`, the same array as prose comments), tagged by kind (`line`/`method`/`token` for code vs `inline`/`block`/`slide` for prose) - so they travel with a short link, share, or export and the one store is rendered and edited by both surfaces.
- **Kind-routed normalisation on load (`loadText`)**: each note must be routed to its kind's normaliser - code kinds go through `SDocsCodeComments.normalize`, prose kinds through `SDocComments.normalizeComment`. The prose normaliser drops the `line`/`anchorText`/`quote` fields a code note anchors on; running a code note through it silently strips its anchor on shared load.
- **Reader vs viewer responsibilities**: the viewer renders and edits every kind on its block (edit/delete dispatch by kind). The reader renders its own prose kinds and surfaces code-kind comments read-only on the code block via `renderCodeComments()` (anchored by quote: the selection for a token, the source line for line/method; edited in the viewer). Comment mode follows you across expand/close.
- **Reader corner buttons & indicators**: all of a code block's corner buttons (wrap / copy / expand / indicators) live in one flex cluster (`.pre-tools` in `attachCodeCopyButtons`) so they always pack together with no gaps whatever subset is shown; order is set with the CSS `order` property, not fixed offsets. The reader shows two per-block indicators: `.code-comment-btn` when a block carries user code comments (opens the viewer in comment mode) and `.agent-comment-btn` when the doc carries agent annotations (opens the viewer to read them). The user indicator uses the `message-square-more` glyph and the agent indicator uses `message-square-code`, both in the standard icon colour, each with a small dot inset in the corner whose colour matches the comment (the user comment's own colour via `--dot`; periwinkle for agent). Agent annotations are line-numbered and not block-tagged, so the agent indicator goes on the first code block.

## Shared modules (UMD pattern)

There is no build step, so we **cannot use ES modules** (`import`/`export`). Code that needs to run in both the browser and Node tests uses a UMD IIFE pattern:

```js
(function (exports) {
  // ... all code ...
  exports.foo = foo;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.MyLib = {}));
```

In the browser the IIFE writes to `window.MyLib`; in Node tests it writes to `module.exports`. Four browser and CLI modules use this pattern: `sdocs-yaml.js` (`window.SDocYaml`), `sdocs-slugify.js` (`window.SDocSlugify`), `sdocs-styles.js` (`window.SDocStyles`), and `sdocs-slide-stdlib.js` (`window.SDocSlideStdlib`).

**Where the real files live**: under `cli/shared/`. `public/` only holds symlinks to them. The browser, the trust manifest, and the cache-busting hash all walk `public/` and follow the symlinks transparently. The npm tarball ships them as real files because they sit inside `cli/`. If you edit one of the four, edit it under `cli/shared/` (the symlink target). Reading or requiring it via `public/` works either way.

## File format

Styled exports are plain `.md` files with **YAML front matter** (the `---` block standard used by Jekyll, Hugo, Obsidian, Gatsby). The `styles:` key is our addition. Raw exports strip front matter entirely.

When a file is dropped or loaded, `parseFrontMatter()` splits it into `meta` (the YAML object) and `body` (everything after `---`). If `meta.styles` exists, `applyStylesFromMeta()` walks the object and sets each control + CSS var.

The YAML parser is hand-rolled (no `js-yaml` dep) and lives in `cli/shared/sdocs-yaml.js`, shared by the browser app (via the `public/` symlink), CLI (`cli/bin/sdocs-dev.js`), and tests.

## Transitions & animations

When hiding/showing UI elements (topbar, panels, toolbars), **always animate all affected properties** - not just the obvious ones. If an element collapses via `height`, also transition `opacity`, `padding`, `border-color`, and any other property that would cause a visual jump if it changed instantly. Neighboring elements that reposition (e.g. a sticky toolbar whose `top` changes when a bar above it hides) must use a matching transition curve and duration so everything moves in sync. The standard curve is `.3s cubic-bezier(.4,0,.2,1)`.

## Google Fonts

24 fonts listed in order of global popularity. Fonts are loaded lazily - a `<link>` tag is injected only when a font is first selected from the dropdown. Inter is preloaded in `<head>` as it's the default.

## Toolbar overflow & scroll hints

Both `#left-toolbar` and `#write-toolbar` can overflow horizontally on narrow screens. The pattern:

- **Hidden scrollbars**: `overflow-x: auto; overflow-y: hidden; scrollbar-width: none` + `::-webkit-scrollbar { display: none }`. Both toolbars use this so content is scrollable but scrollbars never appear.
- **Fade gradient**: A `::after` pseudo-element with `linear-gradient(to right, transparent, var(--bg) 90%)` on the right edge signals hidden content. Add class `has-overflow` when `scrollWidth > clientWidth`, and class `scrolled-end` (which sets `opacity: 0` on the `::after`) when scrolled to the end.
- **Bounce-peek**: On first display, auto-scroll 28px right then smoothly back to 0 to hint that horizontal scroll is available. Only fires once and only when content overflows.
- **Breakpoints**: Write toolbar hints activate below 560px, left toolbar hints below 342px. These are in `css/mobile.css`.
- **`position: relative`** on toolbars is required for the `::after` overlay. For `#write-toolbar`, this must be in the `body.write-mode` rule (not a bare media query) to avoid ghost borders when the toolbar is hidden.

## Charts

Render charts in markdown via ```` ```chart ```` fenced code blocks with JSON data. Charts are powered by Chart.js v4 (lazy-loaded from CDN on first use).

Run `sdoc charts` for the complete reference of chart types, options, and styling.

### Chart styling

Charts inherit colors from the block cascade system:

```yaml
styles:
  blocks:
    background: "#1a1a2e"    # sets bg for code, blockquote, AND charts
    color: "#c8c3bc"         # sets text for code, blockquote, AND charts
  code:
    background: "#282c34"    # overrides blocks.background for code only
  chart:
    accent: "#6366f1"        # palette base color
    palette: monochrome      # or: complementary, analogous, triadic, pastel, warm, cool, earth
    background: "#0e4a1a"    # overrides blocks.background for charts only
    textColor: "#c8f0d8"     # overrides blocks.color for charts only
```

The accent color + palette mode generates chart colors (bar colors, pie segments, line colors). Per-chart `"colors": [...]` in the JSON overrides the palette.
