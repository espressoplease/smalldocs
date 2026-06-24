# SDocs

Lightweight stateless markdown editor with live styling. Single Node.js file serves a single HTML file. No build step, no framework, one dependency (`marked` for MD parsing).

## Stack

The repo holds two programs:

- **Server** (root `package.json`, `"private": true`, `name: sdocs-server`) - `server.js` plus everything outside `cli/`.
- **CLI** (`cli/package.json`, `name: sdocs-dev`) - published to npm. Zero runtime dependencies.

The two never share a `package.json` again. See "Published npm tarball" below for why this matters.

- **Server**: `server.js` - pure Node `http` module, small
- **CLI**: lives entirely under `cli/`:
  - `cli/bin/sdocs-dev.js` - the `sdoc` command (UMD-shared modules under `cli/shared/`)
  - `cli/bin/sdocs-postinstall.js` - global-install hint, no-op otherwise
  - `cli/shared/sdocs-yaml.js`, `sdocs-styles.js`, `sdocs-slugify.js` - real files (symlinked back into `public/` for the browser)
- **Frontend**: split across `public/`:
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
  - `sdocs-state.js` - shared `window.SDocs` mutable state namespace
  - `sdocs-theme.js` - Google Fonts, font loading, dark mode, theme toggle
  - `sdocs-controls.js` - CSS variable management, color cascade, control wiring
  - `sdocs-chrome.js` - topbar / overflow menu / mobile sheet wiring
  - `sdocs-export.js` - PDF/Word/MD export, save-default styles
  - `sdocs-write.js` - write mode editor (contentEditable, toolbar, key handling)
  - `sdocs-charts.js` - Chart.js integration for ```chart fenced blocks
  - `sdocs-math.js` - KaTeX integration for `$$...$$` blocks
  - `sdocs-mermaid.js` - Mermaid integration for ```mermaid fenced blocks (lazy CDN, post-sanitised SVG)
  - `sdocs-mermaid-focus.js` - per-diagram fullscreen pan/zoom modal (drag, wheel, fit/100%/reset, ESC)
  - `sdocs-comments.js` - pure comment data model (anchor resolution helpers, YAML round-trip, footnote serializer), UMD shared with tests
  - `sdocs-comments-ui.js` - browser-only comment UI: rendering, selection popover, composer, navigation
  - `sdocs-cells.js` - pure cells data model (CSV parse, type classify, column names, format directive, `workbook/sheet` fence split via `parseFenceInfo`, selection stats, sort, header detection), UMD shared with tests
  - `sdocs-cells-formula.js` - pure formula engine for `=` cells (tokenize/parse/eval, refs + ranges, SUM/AVG/MIN/MAX/COUNT/COUNTA/PRODUCT/ROUND/ABS/IF, whole-model recalc with cycle detection), UMD shared with tests
  - `sdocs-cells-xlsx.js` - pure .xlsx writer (stored ZIP + SpreadsheetML, live formulas, number formats), zero dependencies, UMD shared with tests. `buildXlsx` writes a single sheet; `buildXlsxWorkbook` writes a multi-sheet workbook (one shared styles part, per-sheet content-type/rels, cross-sheet formula qualifiers rewritten to sanitised + de-duped Excel sheet names)
  - `sdocs-cells-ui.js` - ```cells renderer: CSS-grid sheet (inline + fullscreen via a `fullscreen` flag), formula display, number/format rendering, copy toolbar, xlsx download, JS scroller sizing. `processCells` partitions blocks by workbook id (the `workbook/sheet` fence): each workbook is named/recalced in isolation and renders as its own tab strip; the shared `S.cellsWorkbook` list is tagged so `cellsWorkbookFx` and the fullscreen overlay filter back to a sheet's own workbook
  - `sdocs-cells-select.js` - cell + range selection and keyboard navigation for a cells grid
  - `sdocs-cells-focus.js` - fullscreen "focus" overlay for a sheet (name box, formula bar, selection stats footer); hosts the editor
  - `sdocs-cells-edit.js` - client-only in-cell editing for the fullscreen view (type/dblclick to edit, nav keys, undo/redo, delete-clear, TSV/CSV paste); mutates the shared model, never the document
  - `sdocs-code-focus.js` - fullscreen view for a code block / whole opened file: line-number gutter, soft wrap, language-aware hierarchical folding (collapse-all master + per-row chevrons), and comment mode. Hosts the comment UI directly, sharing the markdown reader's comment visual language: a "Commenting as" author + colour prefs cluster, the speech-bubble gutter add affordance, a comment-colour line tint (the `.sdoc-anchor` analogue) and method stripe, click-to-edit tinted cards, Lines/Methods granularity toggle, note navigation, and a drag-select "comment on selection" popover that creates a token comment (a precise mark over the chosen phrase plus a card BELOW the line). EVERY code comment renders as a full-width card below its line, never inline: a box spliced into a preformatted code line collides with the monospace grid (prose reflows around an inline pill, code cannot), so cards-below is the only overlap-proof layout. A token comment additionally marks its phrase; only line/method draw the whole-line wash so a token reads precisely. Prose inline comments that fall in the open block render here too, the same way (mark + card below), and are fully editable: edit/delete dispatch by kind (a prose `inline` comment routes to the prose store, a code comment to the code store), so a comment behaves identically in the reader and the viewer regardless of where it was made. (`test/code-comment-parity.spec.js` has a headless geometry test asserting no comment card ever overlaps code text.) New notes take the pref colour, which drives `--sdoc-cc-accent` so every affordance reads in one colour. `open(pre, {comment:true})` opens straight into comment mode (used by the reader-side indicator below). Topbar order is `wrap · fold · copy · comment · download | theme` (a `.sdoc-code-focus-sep` divider before the viewer-local light/dark toggle, mirroring the prose toolbar). The file-info card carries the same short-link UI as the prose file-info card - a "Generate" intro row (`.sdoc-cf-shortbtn` + the encrypted-on-server note) that, once minted, shows the URL in a copyable "Short URL" row - via the shared `S.generateShortLink` (which also sets the staleness snapshot). A short link to a whole-file code doc auto-opens this view: `maybeAutoExpandCodeFile()` runs on BOTH the `#md=` load and the `/s/` short-link load, so a developer can hand someone a code file as a short link that opens straight into the expanded, commentable view
  - `sdocs-code-comments.js` - pure data model for code comments (line-, method-, or token-anchored; a `token` comment carries the selected `quote` and degrades to a line comment without one; each tagged with a `block` "pre:N" so multi-block docs keep their notes apart), UMD shared with tests: add/remove/update, colour + text sanitisation, `resolveLine()` re-anchoring after the file shifts, JSON serialize/parse, and `serializeBlockComments()` - the ONE copy-with-comments serializer both the reader and the viewer call: clean fenced source plus an ordered notes list that locates every comment kind (inline/token by quote, line/method by line, block as whole-block), so both copy buttons produce identical, complete output (`serializeAnnotations()` is the older code-only version, kept for back-compat). Code comments live in the document's ONE comment store (`currentMeta.comments`, the same array as prose comments), tagged by kind (`line`/`method`/`token` for code vs `inline`/`block`/`slide` for prose) - so they travel with a short link / share / export and the one store is rendered + edited by both the reader and the viewer. Both surfaces render the one store: the viewer reads/writes code-kind entries AND shows prose inline comments that fall in its block (read-only); the reader renders its own prose kinds AND surfaces code-kind comments on the code block via `renderCodeComments()` (read-only, anchored by quote: the selection for a token, the source line for line/method). The viewer renders AND edits every kind on its block (edit/delete dispatch by kind: a prose comment routes to the prose store, a code comment to the code store); the reader shows code-kind comments read-only (edited in the viewer). Comment mode follows you across expand/close. All of a code block's corner buttons (wrap / copy / expand / indicators) live in one flex cluster (`.pre-tools` in `attachCodeCopyButtons`) so they always pack together with no gaps whatever subset is shown; order is set with the CSS `order` property, not fixed offsets. The reader shows two per-block indicators: a `.code-comment-btn` when a block carries user code comments (opens the viewer in comment mode) and a `.agent-comment-btn` when the doc carries agent annotations (opens the viewer to read them). The user indicator uses the `message-square-more` glyph and the agent indicator uses `message-square-code`, both in the standard icon colour, each with a small dot inset in the corner whose colour matches the comment (the user comment's own colour via `--dot`; periwinkle for agent). Agent annotations are line-numbered and not block-tagged, so the agent indicator goes on the first code block
  - `sdocs-code-lang/<lang>.js` - per-language structural-keyword tables, lazy-loaded by file extension; drive the collapsed-class outline (a `structural` line survives the fold, a comment or stray statement does not)
  - `sdocs-app.js` - render orchestration, hash encode/decode, Brotli compression, syncAll, mode switching, drag/drop, file info card, scroll hints, init
  - `sdocs-info.js` - info panel, feedback link, notification dot
- **Tests**: `node test/run.js` - red/green, no test framework, uses Node `assert` + `http`
  - `test/runner.js` - shared harness: `test()`, `testAsync()`, `get()`, `report()`
  - `test/test-yaml.js` - YAML front matter parse/serialize tests
  - `test/test-styles.js` - SDocStyles pure module tests
  - `test/test-cli.js` - CLI parseArgs/buildUrl + style merging tests
  - `test/test-slugify.js` - slugify + heading dedup tests
  - `test/test-base64.js` - browser base64 UTF-8 roundtrip tests
  - `test/test-files.js` - file existence + content assertions
  - `test/test-http.js` - HTTP server tests (async); includes the per-route asset-versioning assertions
  - `test/test-cache-bust.js` - two-server check that asset URLs change when public/ contents change
  - `test/test-comments.js` - comment data-model + YAML/footnote round-trip + sanitisation tests
  - `test/test-code-comments.js` - code-comment model: add/remove/update, `block` tag scoping, sanitisation, anchor re-resolution after drift, JSON round-trip
  - `test/test-code-structural.js` - per-language structural-keyword tables (keep vs fold sample lines)
  - `test/test-mermaid.js` - directive stripping + marked output shape + hardening assertions
  - `test/test-cells-xlsx.js` - .xlsx writer tests (ZIP structure, worksheet XML, formula translation, number formats)
- **Playwright tests**: `npx playwright test test/write-mode.spec.js` - write mode editor tests
  - `test/write-mode.spec.js` - 42 tests for toolbar actions, toggles, shortcuts, block exits
  - `test/comment-mode.spec.js` - comment-mode integration: anchor resolution, composer, navigation
  - `test/code-comments.spec.js` - code-comment mode in the fullscreen view: add line/method notes, edit, delete, navigate, fold interaction, document-front-matter persistence (travels with the doc), multi-block scoping, orphan handling
  - `test/footnote-input.spec.js` - parsing markdown-footnote-format comment input
  - `test/xss.spec.js` - script / event-handler / iframe injection through markdown
  - `test/mermaid.spec.js` - real-browser Mermaid render + XSS payloads + DoS cap (CDN-dependent)
  - `test/short-link.spec.js` - short-link load + staleness fix (edit clears the stale short URL)
  - `playwright.config.js` - Chromium only, auto-starts server on :3000

## Writing style (docs, copy, UI strings, commit messages)

Calm, explicit, honest. Not salesy, not defensive, not cute.

- **State what something does, not how great it is.** "The server stores ciphertext," not "Our server never sees your data, your privacy is protected!"
- **Name trade-offs out loud.** If something costs you privacy, latency, or uptime compared to the alternative, say so plainly. Don't front-load reassurance to bury a caveat.
- **Skip rhetorical questions and self-defense.** "Doesn't this break privacy? It doesn't, and here's why..." is PR framing. Just describe what happens step by step; the reader forms their own view.
- **No hype words.** Avoid "simply", "just", "blazing", "seamless", "best-in-class", "trust us", "rest assured", "don't worry". Remove exclamation points from technical copy.
- **Imperative over aspirational.** "To verify, open devtools and watch the Network tab" beats "You don't have to take our word for it, feel free to verify it yourself!" Same information, half the words, no persuasion.
- **Show the mechanism, let the reader judge.** Diagrams, code, and HTTP traces are more convincing than adjectives. The Privacy section's MDN quote does this; follow that shape.
- **Boring is fine.** If a paragraph reads like documentation instead of marketing, that's the goal.

When you catch yourself writing a sentence that tries to *make the reader feel good about a choice*, delete it and write the one that explains what actually happens.

### Public-facing copy: write to the reader, not about the product

The rules above are about *what to avoid*. The deeper failure mode is *who you are writing to*.

When you write user-facing copy (homepage, install page, marketing sections, README intros, UI strings, error messages, empty states), you are talking to someone who has not built this thing, has not read the design doc, and has not raised any objection. They want to know:

1. What is this, in plain words.
2. What does it do for me.
3. What do I do next.
4. Can I trust it.

That is the entire payload. Everything else is for a different audience.

Watch for these tells that you have drifted into maker-perspective:

- **"No X, no Y"** framing - flags an objection the reader did not raise. Just state what does happen.
- **Long because-clauses** justifying a design choice - belongs in a "why this works this way" expandable, or in a design doc, not in the lead.
- **Comparisons the reader did not ask for** - "Instead of going through npm..." - the reader does not have the npm baggage in their head; do not put it there.
- **Adjectives the reader can verify themselves** - "simple", "clean", "fast". Cut. Let them decide after using it.
- **Three justifications stacked in one sentence** - that energy reads as panic, not confidence. Pick one.

Before writing any user-facing block, name the three things the reader needs to know at this exact point on the page, ranked. Write to those. No fourth thing.

### Pressure-testing public-facing copy with the `copywriter` reviewer

`~/review_room/reviewers/copywriter/` is a persona tuned for this failure mode. When you have edited user-facing copy and are not sure it lands, spawn the copywriter reviewer the same way you would `kent_beck` or `security` (see the Review Room section in `~/.claude/CLAUDE.md`). It reads every sentence as the reader and flags perspective drift, defensive framing, sales energy, and unnatural rhythm.

Use it whenever a change touches the homepage, install copy, README, public docs, or user-visible strings. The cost is one extra reviewer pass; the upside is catching the maker-voice drift before it ships.

## Dashes

Never use em dashes (`-`) or en dashes (`-`) anywhere: source files, comments, commit messages, docs. Use a plain hyphen (`-`) instead. This also means no `\u2014` / `\u2013` Unicode escapes.

## Agent integration block

The `sdoc setup` command writes a SDocs explainer into coding-agent config files (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, etc.). The block lives as `AGENT_BLOCK_BODY` in `cli/lib/agent-block.js` (re-exported through `cli/bin/sdocs-dev.js`) and is duplicated as per-agent snippets in `public/sdoc.md` (the "Set up your agent" section). The set of config files it gets written to is `AGENT_TARGETS` in the same module. **If you reword one, reword the other.**

The block is wrapped in HTML-comment bookend markers:

```
<!-- sdocs-agent-block:start v=N -->
[block body]
<!-- sdocs-agent-block:end -->
```

Claude Code strips block-level HTML comments before context injection (zero token cost). Codex / Gemini / opencode treat them as inert markdown. The `v=N` token lets future sdoc versions detect drift via regex.

### Release checklist when AGENT_BLOCK_BODY changes

1. Bump `AGENT_BLOCK_VERSION` in `cli/lib/agent-block.js`.
2. Set `AGENT_BLOCK_REASON` to a one-line summary of what changed.
3. Prepend a new `## v<N>` section to `public/agent-changes.md` with the reason and full block body.
4. Reword the per-agent snippets in `public/sdoc.md` (Set up your agent section) to match.
5. After release: `git tag v<X.Y.Z> && git push origin v<X.Y.Z>` so the source-diff URL printed during auto-install resolves.

### Legacy migration

Pre-1.5.0 sdoc wrote the block with a single open-only marker `<!-- sdocs-agent-block -->`. `findLegacyBlock()` in `cli/lib/agent-block.js` matches v1 (1.4.0/1.4.1) and v2 (1.4.2) bodies by their `Source: https://github.com/JoshInLisbon/SDocs` terminator and rewrites them with bookend markers. After the install base has rotated through 1.5.0+, this code path can be removed.

## CLI state

All CLI-side state lives under `~/.sdocs/`:
- `styles.yaml` - user-editable default styles
- `update-check.json` - daily npm version cache
- `setup.json` - agent setup tracking. Schema v1 fields (added in 1.5.0): `schemaVersion`, `setupCompleted`, `writtenTo`, `declined`, `autoRefreshAgentFiles`, `autoInstallUpdates`, `lastRunVersion`. Pre-1.5.0 state files are migrated transparently on first read by `migrateSetupState()`.

When the CLI was installed via the install script (see "Installer" below), `~/.sdocs/` also holds `cli/` (the unpacked npm tarball) and `bin/sdoc` (a symlink onto `cli/bin/sdocs-dev.js`).

## Installer

`install.sh` (repo root) is the URL-based installer: `curl -fsSL https://smalldocs.org/install | sh`. The server serves it at the apex path `/install` (the URL drops the `.sh` for a cleaner one-liner; the file on disk keeps its extension so `serveFile` picks the right MIME). It resolves the latest version from the npm registry, downloads the `sdocs-dev` tarball, unpacks it into `~/.sdocs/cli`, symlinks `sdoc` into `~/.sdocs/bin`, and adds that directory to PATH via the shell rc. It needs Node and curl/wget present; it never uses npm and never needs root, so it cannot hit the EACCES error a root-owned npm prefix causes. Re-running it upgrades in place. npm (`npm i -g sdocs-dev`) stays as a fallback, so the package name keeps its install history.

The CLI detects which way it was installed (`isUrlInstall()` in `cli/lib/update-check.js`: true when the package root resolves under `~/.sdocs/cli`). Every upgrade path - `sdoc upgrade`, the daily auto-update prompt, the silent auto-install, the `sdoc setup` consent copy - branches through `upgradeCommand()`: URL installs re-run `install.sh` (via `INSTALL_SH_URL` in `constants.js`), npm installs run `npm i -g sdocs-dev@latest`. If you change the installed layout in `install.sh`, update `isUrlInstall()` to match.

## Published npm tarball

`sdocs-dev` on npm is published from `cli/`. Its `files` array is `["bin/", "lib/", "shared/"]`, so the tarball contains `cli/bin/sdocs-dev.js`, `cli/bin/sdocs-postinstall.js`, every runtime module under `cli/lib/`, and the three browser-shared modules under `cli/shared/`. `lib/` is mandatory: the thin `bin/sdocs-dev.js` entrypoint `require`s `../lib/*` at startup, so a tarball without it installs a CLI that crashes on first run. Everything else - `server.js`, `short-links/`, `feedback/`, `analytics/`, all of `public/` (including the symlinks to `cli/shared/`), and the tests - belongs to the server and never reaches a user via `npm i -g`. (`install.sh` smoke-checks both `bin/sdocs-dev.js` and `lib/constants.js` after unpacking, so a future `files` regression fails the install instead of shipping a broken CLI.)

The symlinks under `public/` resolve into `cli/`, but `npm pack` only follows files that already live under the package root, so the published tarball contains the three shared modules as real files and no symlinks.

**Why the split exists:**

Before the split, both programs shared a single root `package.json`. `better-sqlite3` and friends had to live in `devDependencies` because shipping them with `npm i -g sdocs-dev` would have forced every CLI user to build a native module they never load. That meant `npm install --production` on the server skipped them and the server crashed at boot. The split gives each program its own dependency list and removes the footgun entirely.

**Distribution rule for the two `package.json` files:**

- **Root `package.json` (`sdocs-server`, `"private": true`)**: `dependencies` for everything `server.js` and the server-side libraries load at runtime (`better-sqlite3`, `marked`, `brotli`...). `devDependencies` for tests (`@playwright/test`). `npm install` at root is now safe under any flag.
- **`cli/package.json` (`sdocs-dev`)**: no `dependencies`, no `devDependencies`. The CLI is plain Node standard library only, so `npm i -g sdocs-dev` pulls nothing and compiles nothing. Before adding any runtime dep here, audit standard-library options first. The supply-chain story in `public/agent-evaluation.md` (and the byte-comparison fallback for pre-provenance versions) leans on the CLI being auditable code with no third-party runtime surface.
- The CLI's three shared modules are the only files that span the boundary. They live in `cli/shared/` (so `npm pack` ships them) and the browser sees them via symlinks under `public/` (so the trust manifest and cache-busting hash keep covering them automatically).

When in doubt: if a runtime require lives in `cli/bin/`, its dep goes in `cli/package.json`. Everything else goes in the root.

## Architecture

The entire app is stateless. The server just serves static files. All state (current markdown content, parsed front matter, style values) lives in the `window.SDocs` namespace in the browser, primarily `SDocs.currentBody` and `SDocs.currentMeta`.

Styles are driven entirely by CSS custom properties on `#rendered`. Every control in the right panel maps to a `--md-*` variable. No style objects are stored separately - `collectStyles()` reads the DOM when exporting.

### JS module communication

All browser JS modules communicate through `window.SDocs` (created by `sdocs-state.js`). Modules register functions on `SDocs` for cross-module access (e.g. `SDocs.syncAll`, `SDocs.setColorValue`). Event handlers use late binding - they reference `SDocs.fn()` rather than capturing `fn` at parse time, so modules can load in sequence without forward-declaration issues.

**Script load order** (in `index.html`):
`marked` -> `purify` -> `sdocs-yaml.js` -> `sdocs-styles.js` -> `sdocs-state.js` -> `sdocs-slugify.js` -> `sdocs-theme.js` -> `sdocs-controls.js` -> `sdocs-chrome.js` -> `sdocs-export.js` -> `sdocs-write.js` -> `sdocs-charts.js` -> `sdocs-math.js` -> `sdocs-mermaid.js` -> `sdocs-mermaid-focus.js` -> `sdocs-comments.js` -> `sdocs-app.js` -> `sdocs-info.js` -> `sdocs-comments-ui.js`

`sdocs-comments-ui.js` loads after `sdocs-app.js` because it hooks into `SDocs.commentsUi.{enter,exit}` from inside `setMode`; that wiring needs the orchestrator's `setMode` defined first.

## Shared modules (UMD pattern)

There is no build step, so we **cannot use ES modules** (`import`/`export`). Code that needs to run in both the browser and Node tests uses a UMD IIFE pattern:

```js
(function (exports) {
  // ... all code ...
  exports.foo = foo;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.MyLib = {}));
```

In the browser the IIFE writes to `window.MyLib`; in Node tests it writes to `module.exports`. Three modules use this pattern: `sdocs-yaml.js` (`window.SDocYaml`), `sdocs-slugify.js` (`window.SDocSlugify`), and `sdocs-styles.js` (`window.SDocStyles`).

**Where the real files live**: under `cli/shared/`. `public/` only holds symlinks to them. The browser, the trust manifest, and the cache-busting hash all walk `public/` and follow the symlinks transparently. The npm tarball ships them as real files because they sit inside `cli/`. If you edit one of the three, edit it under `cli/shared/` (the symlink target). Reading or requiring it via `public/` works either way.

## File format

Styled exports are plain `.md` files with **YAML front matter** (the `---` block standard used by Jekyll, Hugo, Obsidian, Gatsby). The `styles:` key is our addition. Raw exports strip front matter entirely.

When a file is dropped or loaded, `parseFrontMatter()` splits it into `meta` (the YAML object) and `body` (everything after `---`). If `meta.styles` exists, `applyStylesFromMeta()` walks the object and sets each control + CSS var.

The YAML parser is hand-rolled (no `js-yaml` dep) and lives in `cli/shared/sdocs-yaml.js`, shared by the browser app (via the `public/` symlink), CLI (`cli/bin/sdocs-dev.js`), and tests.

## Transitions & animations

When hiding/showing UI elements (topbar, panels, toolbars), **always animate all affected properties** - not just the obvious ones. If an element collapses via `height`, also transition `opacity`, `padding`, `border-color`, and any other property that would cause a visual jump if it changed instantly. Neighboring elements that reposition (e.g. a sticky toolbar whose `top` changes when a bar above it hides) must use a matching transition curve and duration so everything moves in sync. The standard curve is `.3s cubic-bezier(.4,0,.2,1)`.

## Google Fonts

24 fonts listed in order of global popularity. Fonts are loaded lazily - a `<link>` tag is injected only when a font is first selected from the dropdown. Inter is preloaded in `<head>` as it's the default.

## Playwright testing (write mode)

Write mode uses `contentEditable` which behaves differently under Playwright automation vs real browsers. Key things to know:

- **`execCommand` doesn't work in Playwright keydown handlers.** When the real browser calls `e.preventDefault()` + `document.execCommand('insertLineBreak')` inside a keydown handler, it inserts `<br>` elements and fires `input` events. Under Playwright automation, `execCommand` silently does nothing after `preventDefault`. This means you **cannot test code block Enter behavior with real key presses** in Playwright.
- **Simulate state instead.** For tests that depend on `execCommand` results (e.g. code block exit), set up the DOM to the expected post-`execCommand` state, set any flags the handler would set, and dispatch a synthetic `InputEvent`. See the code block exit tests in `write-mode.spec.js` for the pattern.
- **`execCommand` fires `input` synchronously.** Any flags or state that an `input` handler needs to read must be set **before** calling `execCommand`, not after. The `input` event fires during `execCommand` execution, not after it returns.
- **Chromium represents newlines as `<br>` in contentEditable `<pre>`.** Both `insertText('\n')` and `insertLineBreak` produce `<br>` elements. `textContent` does **not** include these - only `innerHTML` and `childNodes` reveal them. When counting trailing BRs, skip whitespace-only text nodes (e.g. trailing `\n` from initialization).
- **N Enter presses = N+1 trailing `<br>` elements** (the extra one is the browser's caret placeholder).

## Testing the CLI install / setup flow

Historically the only way to verify `sdoc setup`, `sdoc refresh`, or any agent-block migration was: bump the version, publish to npm, run a real `npm i -g sdocs-dev` (or the curl installer), eyeball the result, then uninstall and try again. Slow, fragile, easy to skip - which is how regressions in the install / setup path used to ship.

`test/cli-harness.js` + `test/test-setup-scenarios.js` replace that loop. The harness spawns the real CLI binary (`cli/bin/sdocs-dev.js`) against a temp directory that pretends to be `$HOME`. Every path the CLI reads or writes is derived from `os.homedir()`, which reads `$HOME` on macOS / Linux, so the spawned process believes that temp dir is the world. The fixture is wiped at the end. Nothing escapes; no `npm publish` involved.

**Re-run these scenarios whenever you touch:**
- `cli/lib/setup.js` (the setup / refresh state machine, the `--yes` non-interactive path)
- `cli/lib/agent-block.js` (block format, `AGENT_BLOCK_VERSION`, `AGENT_BLOCK_BODY`, legacy-migration logic, `~/.sdocs/setup.json` schema)
- `cli/lib/agent-files.js` (detection, atomic write, lock, refresh dispatch)
- `cli/lib/constants.js` (paths like `SETUP_CACHE`)
- `cli/lib/io.js` parser, when adding flags consumed by setup / refresh

If a scenario fails after a change in any of those, the regression is real - a real user upgrading on the live CLI would hit it. Bumping `AGENT_BLOCK_VERSION` is the most common reason scenario 4 (v6 → current) needs attention; that test pins the upgrade path.

**Run:**

```bash
node test/run.js                             # full suite, scenarios live under "── CLI Setup Scenarios ──"

# Fast iteration on just the scenarios:
node -e "const h=require('./test/runner');const r=require('./test/test-setup-scenarios')(h);(async()=>{await r();h.report();})()"
```

Each scenario takes ~100ms; the seven together run well under a second.

**Scenarios covered:**

1. Fresh install, no agent configs → `setup --yes` records `declined: true`, writes nothing
2. Fresh install, Claude detected → `setup --yes` appends current-version bookended block
3. Already current → `setup --yes` is a no-op (no stacked blocks, file byte-identical, "already at current version" message)
4. Old (v6) block → `refresh` rewrites at current version, old marker gone
5. Legacy open-marker block → `refresh` rewrites as bookended at current version
6. Hand-edited legacy block → `refresh` leaves it alone, prints a "local edits" hint
7. Outdated v6 block → `setup --yes` ALSO upgrades it (idempotency: setup is safe to re-run on a stale install)
8. Existing user content in `CLAUDE.md` → `setup --yes` appends the block without breaking the user's prior content
9. Multiple agents detected → `setup --yes` writes to all in one pass (catches loop-bail regressions)

**Idempotency contract:** `sdoc setup --yes` is the canonical "make my agent config current" command and is safe to re-run any number of times. Internally it calls `refreshAllAgentFiles()` first (handles upgrades + legacy migration), then `writeBookendedBlock()` for any detected agent without a block. Scenarios 3, 7, 8 all pin this. If you change `runSetup` and a re-run of `setup --yes` stops being a no-op on already-current state, or stops upgrading on stale state, the contract is broken.

**Harness API** (`test/cli-harness.js`):

```js
const { createFixture } = require('./cli-harness');

const fx = createFixture({
  agents:        ['claude', 'codex'],                  // create empty config files
  existingBlock: { in: 'claude', version: 6 },         // optional: seed a bookended block
  legacyBlock:   { in: 'claude', version: 2 },         // optional: seed a 1.4.x open-marker block
  fileSeed:      { claude: '# hand-written file\n' },  // optional: raw initial file content
  setupState:    { lastRunVersion: '1.10.0', autoRefreshAgentFiles: true }, // optional: seed ~/.sdocs/setup.json
});
const r = await fx.run('setup --yes');                 // { stdout, stderr, exitCode }
fx.readAgent('claude');                                // resulting file content (or null)
fx.readSetupState();                                   // parsed setup.json (or null)
fx.exists('.sdocs/setup.json');                        // relative-to-HOME existence check
fx.cleanup();                                          // always call in a finally
```

`fx.run(args, opts)` exposes `opts.stdin` for piping input, `opts.timeoutMs` (default 10s), `opts.env` for additional env vars, and `opts.allowAutoRefresh: true` to remove the default `SDOCS_NO_REFRESH=1` guard (set it when testing the auto-refresh-on-version-bump path through `postCommandHooks`). The harness already strips `CI` and sets `SDOCS_NO_UPDATE_CHECK=1` + `SDOCS_NO_SETUP=1` so spawned processes don't phone home or trigger first-run prompts.

**Adding a new scenario**: append to `test/test-setup-scenarios.js` using the `scenario(name, async () => { ... })` helper. Seed a fixture, run the CLI, assert on the resulting filesystem, `cleanup()` in `finally`. The runner is sequential and counted into the same total as the rest of `node test/run.js`.

**Running scenarios through a sub-agent**: a sub-agent in a fresh context can run `node test/run.js` and get clean pass / fail without any setup. To hand the agent one scenario at a time (e.g. "seed a v6 block, run setup --yes, tell me the resulting CLAUDE.md") point it at `test/cli-harness.js` - the API above is the contract and the comments at the top of that file are self-contained.

**End-to-end testing of `install.sh`** is a separate problem because the script downloads a tarball from the npm registry. Not covered by this harness. The natural next phase: add an `SDOCS_TARBALL_URL` env override to `install.sh`, `npm pack` the local CLI to a temp tarball, point the script at it via `file://`, run it with `HOME=<fixture>`, assert `~/.sdocs/cli/bin/sdocs-dev.js` exists and `~/.sdocs/bin/sdoc` symlinks onto it.

## Toolbar overflow & scroll hints

Both `#left-toolbar` and `#write-toolbar` can overflow horizontally on narrow screens. The pattern:

- **Hidden scrollbars**: `overflow-x: auto; overflow-y: hidden; scrollbar-width: none` + `::-webkit-scrollbar { display: none }`. Both toolbars use this so content is scrollable but scrollbars never appear.
- **Fade gradient**: A `::after` pseudo-element with `linear-gradient(to right, transparent, var(--bg) 90%)` on the right edge signals hidden content. Add class `has-overflow` when `scrollWidth > clientWidth`, and class `scrolled-end` (which sets `opacity: 0` on the `::after`) when scrolled to the end.
- **Bounce-peek**: On first display, auto-scroll 28px right then smoothly back to 0 to hint that horizontal scroll is available. Only fires once and only when content overflows.
- **Breakpoints**: Write toolbar hints activate below 560px, left toolbar hints below 342px. These are in `css/mobile.css`.
- **`position: relative`** on toolbars is required for the `::after` overlay. For `#write-toolbar`, this must be in the `body.write-mode` rule (not a bare media query) to avoid ghost borders when the toolbar is hidden.

## Running

```bash
node server.js                              # http://localhost:3000
PORT=8080 node server.js
SDOCS_DEV=1 node server.js                  # dev mode: no-cache, SW disabled
node test/run.js                            # starts server on :3099, runs tests, kills it (includes CLI setup scenarios)
npx playwright test test/write-mode.spec.js # write mode browser tests (needs Chromium)
node test/preview.js file.md --screenshot out.png  # visual preview (needs server on :3000)

# Just the CLI setup / refresh scenarios (fake $HOME, no npm publish needed - see "Testing the CLI install / setup flow"):
node -e "const h=require('./test/runner');const r=require('./test/test-setup-scenarios')(h);(async()=>{await r();h.report();})()"
```

**Dev mode (`SDOCS_DEV=1` or `NODE_ENV=development`)**: serves CSS/JS with `Cache-Control: no-store`, injects a flag into the HTML that unregisters the service worker and clears its caches on load. Use this when iterating on frontend code so changes appear without hard-refreshing. The service worker normally caches the app shell and serves stale files even through hard reloads - dev mode sidesteps both layers.

## Running the local CLI (not the global install)

The globally-installed `sdoc` is the published release and lags this repo. To exercise the CLI you are editing, run it straight from source:

```bash
node cli/bin/sdocs-dev.js <file.md> [args]   # the `sdoc` command, from this branch
node cli/bin/sdocs-dev.js --help             # same flags as the installed sdoc
```

To preview a doc against a **local** dev server - so it renders this branch's frontend (new modules, CSS) rather than production `smalldocs.org` - start a server and point the CLI at it with `--url`:

```bash
PORT=3210 SDOCS_DEV=1 node server.js                              # serve this branch's frontend
node cli/bin/sdocs-dev.js file.md --url http://localhost:3210     # open it against that server
```

`--url <base>` (or the `SDOCS_URL` env var) overrides the default base (`https://smalldocs.org`). The document still travels in the URL hash; the local server only serves the HTML/JS that renders it. This is the way to see in-progress frontend features (e.g. a new fenced-block type) actually render, since the installed CLI and production both point at the released frontend.

## Visual preview testing

The dev server caches JS files for 24 hours (`Cache-Control: public, max-age=86400`). This means browser and Playwright sessions serve stale JS after code changes. The `test/preview.js` helper bypasses this by injecting fresh (cache-busted) JS modules on every run:

```bash
node server.js &                                     # start server first
node test/preview.js file.md --screenshot /tmp/out.png --wait 5000
node test/preview.js file.md                          # opens browser, stays open for inspection
```

Use this instead of `sdoc file.md` when you need to verify that code changes are reflected visually. The `--wait` flag controls how long to wait for Chart.js CDN load (default 4000ms).

## Asset cache-busting

Every `<link rel="stylesheet" href="/public/...">` and `<script src="/public/...">` URL in **any** HTML the server serves is automatically rewritten to carry `?v=<APP_VERSION>` at HTML serve time. `APP_VERSION` is a 10-char hash of the contents of `public/`, so any deploy that touches a public file changes the query string and the browser HTTP cache misses on every asset URL.

**Don't write `?v=` by hand in HTML.** The rewriter lives in `rewriteAssets()` in `server.js`, and `serveHtmlWithRewrite()` is the single helper every HTML route goes through (`/`, `/new`, `/legal`, `/blogs/...`, `/s/...`, `/feedback`, `/trust`, `/analytics`). If you add a new HTML entry point, route it through `serveHtmlWithRewrite()` (or call `rewriteAssets()` directly) — otherwise its asset URLs ship un-versioned and returning users will see the new HTML against a stale browser HTTP cache.

What the rewriter does and doesn't touch:
- **Touches**: `<script src="/public/...">` and `<link rel="stylesheet" href="/public/...">` whose URL has no query string yet.
- **Skips**: cross-origin URLs (CDN, Google Fonts), already-versioned URLs, `<link rel="icon">`, inline `<style>` and `<script>`, and `url(...)` references inside CSS (e.g. `@font-face`). Inline-CSS-referenced fonts are immutable (`max-age=31536000`) so this is safe in practice — if you add a stylesheet that references mutable assets via `url(...)`, version the filename instead of the query.

Markup constraints the regex relies on (write tags this way or they ship un-versioned):
- Keep `src=` / `href=` on the same line as the opening `<script` / `<link`. The rewriter is single-line.
- Don't put a literal `>` inside a quoted attribute value. The greedy stop-at-`>` would terminate early.

The static check in `test/test-files.js` ("every HTML route in server.js goes through serveHtmlWithRewrite") fails CI if a future route is wired to `serveFile()` with a `.html` argument, which would silently bypass the rewriter.

The two-server cache-bust check in `test/test-cache-bust.js` is the tripwire: it starts a server, captures `APP_VERSION` and the rewritten HTML, mutates `public/` (writes a non-dotfile so `walkPublic` picks it up), restarts the server, and asserts every `/public/` URL on `/`, `/feedback`, and `/trust` carries the new version. If you change anything about the rewriter, this test must still pass.

## Pre-deploy check: service-worker refresh

The service worker caches the app shell and serves stale copies for one page load after a deploy. On that load the SW posts `check-update`; when the server's `APP_VERSION` differs it purges the cache, re-fetches, and posts `sdocs-reload` to force the client onto the new code.

Returning users therefore see a brief (~0.5-2s) flash of the OLD HTML before the auto-reload. If the change reshapes the DOM (new toolbar buttons, renamed IDs, new panels, new script modules), that transient state can look broken and is easy to miss locally because fresh tabs never experience it.

**Before shipping any frontend change that adds or reshapes DOM:**

1. Start the server in prod mode (no `SDOCS_DEV=1`) on the current `main`. Load `http://localhost:3000/` and confirm in DevTools > Application > Service Workers that it registered.
2. Apply the intended change and restart the server. `APP_VERSION` shifts automatically because `walkPublic` rehashes everything under `public/`.
3. Reload the tab (not a hard reload). You should see: old shell renders briefly, console logs `sdocs-reload`, page auto-reloads into the new shell.
4. If the intermediate state is visibly broken, either defer-guard the JS (early-return on missing elements, which most modules already do) or call it out in the PR description so reviewers know the flash is expected.

## Adding a new markdown feature

Every fenced-block / inline-render feature (charts, math, mermaid, future ones) touches the same set of surfaces. Mermaid is the most recent worked example; mirror that shape unless there's a reason not to. Skipping any of these tends to ship in a half-broken state that only shows up after a deploy.

1. **Render module** (`public/sdocs-X.js`). Lazy-load the renderer's CDN bundle on first use, never on `DOMContentLoaded`. Run on the rendered output, not the source markdown. **Post-sanitize the produced DOM** (strip `<script>`, `<iframe>`, `<use>`, animation tags, `javascript:` URLs); a renderer's own "safe mode" is not enough. Apply hard limits: per-block source size, per-document block count, per-render timeout.
2. **Script load order** in `public/index.html`. Add the new script in the correct slot (renderers go after `sdocs-charts.js` / before `sdocs-app.js` unless they hook orchestrator state). `sdocs-app.js`'s render orchestration must call into the new module after marked + DOMPurify; charts/math/mermaid all do this through `SDocs.fn()` late binding.
3. **Cache-bust on the HTML route.** Adding a new `<script src="/public/...">` only works because every HTML route runs through `serveHtmlWithRewrite()`. If the feature also adds a new HTML entry point, that route must use the same helper or its asset URLs ship un-versioned.
4. **Service-worker flash**. Adding a new script reshapes the DOM. Run the prod-mode SW refresh check (see "Pre-deploy check: service-worker refresh") and verify modules early-return on missing elements so the brief stale-shell window doesn't render visibly broken.
5. **Sanitization tests**. Add a Playwright XSS spec covering `<script>`, `on*=` handlers, `javascript:` URLs, `<iframe>` payloads, and `<use href>` smuggling. `test/mermaid.spec.js` is the template. Add a Node-side test (`test/test-X.js`) for any pure transform (directive stripping, parser shape, marked output).
6. **DoS limits and tests.** Cover both per-block size and per-document count caps in tests. Renderers can hang on adversarial input; without a timeout one bad block freezes the page.
7. **Export pipeline** (`public/sdocs-export.js`). Anything that renders to live DOM beyond plain HTML (canvas, SVG, foreignObject) needs a rasterization path:
   - Add `S.getXImages()` to the render module that returns `[{wrapper, dataUrl}]`. SVG sources need an inline `<style>` child injected before `XMLSerializer` because CSS variables don't cascade into a serialized standalone SVG. Pull theme colors off `getComputedStyle(wrapper)` for `--md-block-bg` / `--md-block-text` so dark mode survives.
   - Rasterize at 2x DPR via canvas, `toDataURL('image/png')`, then divide back to natural pixels in the PDF draw step so the page-fit math is correct.
   - Wire it into both paths: `inlineX(clone, images)` swaps wrappers for `<img>` in the HTML/Word path, `drawX()` embeds via `doc.embedPng()` + `page.drawImage()` in the pdf-lib path. Walk dispatch in `renderPdf` needs an `else if (el.classList.contains('sdoc-X'))` branch.
   - Thread the images list through `buildExportHTML(...)`, `renderPdf(...)`, and both `exportPDF` / `exportWord` entry points.
   - **Word export currently breaks on data-URL `<img>` tags** (html-to-docx Buffer-polyfill bug) — affects charts and mermaid. Not a regression to fix per-feature; flag if a user reports it.
8. **Section toggles.** Diagrams/charts inside collapsed `.md-section-body` measure 0×0. Anything that calls `getBoundingClientRect` (rasterizer, focus modal sizing) must run after `expandAllSections()` or be defensive when called on a hidden element.
9. **CDN load resilience.** First-use CDN load can fail or be slow. Lazy-load helpers should resolve a single shared promise and surface an inline error in the wrapper rather than throwing into render orchestration.
10. **CLI reference.** Add `sdoc <feature>` (e.g. `sdoc diagrams`) that prints the type list, syntax, and security model. Agents read this themselves before writing fenced blocks; the agent integration block points at it instead of duplicating syntax.
11. **`sdoc <file>` integration**. If the feature owns a file extension (`.mmd`, `.mermaid`), wrap the file in the appropriate fence in `cli/bin/sdocs-dev.js` so `sdoc graph.mmd` works out of the box.
12. **Showcase + feature-intro docs**. Build a gallery page covering every supported sub-type with source blocks, plus a separate feature-introduction doc with intro paragraph, agent-prompt examples, CLI upgrade note, then the gallery. Keep them as two files: gallery is reference, intro is the announcement payload.
13. **`public/sdoc.md`**. Add a feature section with a link to the gallery; mirror the way charts and diagrams are listed.
14. **Agent integration block** (`cli/bin/sdocs-dev.js`). Only update if agents need to know the feature exists to use it (Mermaid + Charts qualify; styling tweaks don't). Bump `AGENT_BLOCK_VERSION`, set `AGENT_BLOCK_REASON`, prepend a `## v<N>` section to `public/agent-changes.md`, reword the per-agent snippets in `public/sdoc.md`, and tag the release. (Full release checklist is in the "Agent integration block" section above.)
15. **Notification entry** (`public/notifications.json`). Add an entry at the top with a fresh `id`, today's date, calm title, and a hash-encoded link to the feature-introduction doc. The user-facing notification dot lights up only for entries newer than the user's last-seen mark.

## Charts

Render charts in markdown via ` ```chart ` fenced code blocks with JSON data. Charts are powered by Chart.js v4 (lazy-loaded from CDN on first use).

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
