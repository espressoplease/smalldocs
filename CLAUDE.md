# SDocs

Lightweight stateless markdown editor with live styling. Single Node.js file serves a single HTML file. No build step, no framework, one dependency (`marked` for MD parsing).

## Stack

- **Server**: `server.js` - pure Node `http` module, small
- **Frontend**: split across `public/`:
  - `index.html` - markup only
  - `css/tokens.css` - CSS custom properties, dark theme, theme transitions
  - `css/layout.css` - reset, body, topbar, main layout, left panel, divider
  - `css/rendered.css` - `#rendered` markdown styles, collapsible sections, copy buttons
  - `css/panel.css` - right panel, controls, statusbar
  - `css/mobile.css` - mobile `@media` breakpoint
  - `css/write.css` - write-mode contentEditable surface and toolbar
  - `css/comments.css` - comment-mode card / popover / gutter styling
  - `sdocs-yaml.js` - YAML front matter parse/serialize, UMD shared with Node
  - `sdocs-slugify.js` - slugify heading text to URL-safe IDs, UMD shared with Node
  - `sdocs-styles.js` - pure style data tables + logic, UMD shared with tests
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
  - `test/test-mermaid.js` - directive stripping + marked output shape + hardening assertions
- **Playwright tests**: `npx playwright test test/write-mode.spec.js` - write mode editor tests
  - `test/write-mode.spec.js` - 42 tests for toolbar actions, toggles, shortcuts, block exits
  - `test/comment-mode.spec.js` - comment-mode integration: anchor resolution, composer, navigation
  - `test/footnote-input.spec.js` - parsing markdown-footnote-format comment input
  - `test/xss.spec.js` - script / event-handler / iframe injection through markdown
  - `test/mermaid.spec.js` - real-browser Mermaid render + XSS payloads + DoS cap (CDN-dependent)
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

## Dashes

Never use em dashes (`-`) or en dashes (`-`) anywhere: source files, comments, commit messages, docs. Use a plain hyphen (`-`) instead. This also means no `\u2014` / `\u2013` Unicode escapes.

## Agent integration block

The `sdoc setup` command writes a SDocs explainer into coding-agent config files (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, etc.). The block lives as `AGENT_BLOCK_BODY` in `bin/sdocs-dev.js` and is duplicated as per-agent snippets in `public/sdoc.md` (the "Set up your agent" section). **If you reword one, reword the other.**

The block is wrapped in HTML-comment bookend markers:

```
<!-- sdocs-agent-block:start v=N -->
[block body]
<!-- sdocs-agent-block:end -->
```

Claude Code strips block-level HTML comments before context injection (zero token cost). Codex / Gemini / opencode treat them as inert markdown. The `v=N` token lets future sdoc versions detect drift via regex.

### Release checklist when AGENT_BLOCK_BODY changes

1. Bump `AGENT_BLOCK_VERSION` in `bin/sdocs-dev.js`.
2. Set `AGENT_BLOCK_REASON` to a one-line summary of what changed.
3. Prepend a new `## v<N>` section to `public/agent-changes.md` with the reason and full block body.
4. Reword the per-agent snippets in `public/sdoc.md` (Set up your agent section) to match.
5. After release: `git tag v<X.Y.Z> && git push origin v<X.Y.Z>` so the source-diff URL printed during auto-install resolves.

### Legacy migration

Pre-1.5.0 sdoc wrote the block with a single open-only marker `<!-- sdocs-agent-block -->`. `findLegacyBlock()` in `bin/sdocs-dev.js` matches v1 (1.4.0/1.4.1) and v2 (1.4.2) bodies by their `Source: https://github.com/JoshInLisbon/SDocs` terminator and rewrites them with bookend markers. After the install base has rotated through 1.5.0+, this code path can be removed.

## CLI state

All CLI-side state lives under `~/.sdocs/`:
- `styles.yaml` - user-editable default styles
- `update-check.json` - daily npm version cache
- `setup.json` - agent setup tracking. Schema v1 fields (added in 1.5.0): `schemaVersion`, `setupCompleted`, `writtenTo`, `declined`, `autoRefreshAgentFiles`, `autoInstallUpdates`, `lastRunVersion`. Pre-1.5.0 state files are migrated transparently on first read by `migrateSetupState()`.

## Published npm tarball

`sdocs-dev` on npm ships only what's in the `files` array of `package.json`: `bin/sdocs-dev.js`, `bin/sdocs-postinstall.js`, and three browser-shared modules under `public/` (`sdocs-yaml.js`, `sdocs-styles.js`, `sdocs-slugify.js`). Everything else - `server.js`, `short-links/`, `feedback/`, `analytics/`, the rest of `public/`, the tests - runs from a git checkout (local dev, production) and never reaches a user via `npm i -g`.

**Distribution rule for `package.json` deps:**

- `dependencies` ship with `npm i -g sdocs-dev`. Reserve this section for modules `bin/` actually loads. The CLI currently has zero runtime deps - `bin/sdocs-dev.js` is plain Node standard library - so a global install pulls no native modules and runs no third-party postinstall. Promoting a server-only module here forces every CLI user to download and (for native modules) build it for nothing.
- `devDependencies` cover everything else: tests, the server, browser bundles loaded only by `index.html`. `better-sqlite3` lives here even though it is loaded at runtime by `short-links/db.js`, `feedback/db.js`, and `analytics/db.js` - those files are server-only and lazy-`require` it from inside `init()`, so test runs and the server pick it up via the dev-deps install, but CLI users never see it.
- Before adding a new runtime dep to `bin/`, audit standard-library options first. The supply-chain story in `public/agent-evaluation.md` (and the byte-comparison fallback for pre-provenance versions) leans on the CLI being a single auditable file with no third-party runtime surface.

When in doubt: if a file's path is not in the `files` array, it is server-side and its deps belong in `devDependencies`.

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

## File format

Styled exports are plain `.md` files with **YAML front matter** (the `---` block standard used by Jekyll, Hugo, Obsidian, Gatsby). The `styles:` key is our addition. Raw exports strip front matter entirely.

When a file is dropped or loaded, `parseFrontMatter()` splits it into `meta` (the YAML object) and `body` (everything after `---`). If `meta.styles` exists, `applyStylesFromMeta()` walks the object and sets each control + CSS var.

The YAML parser is hand-rolled (no `js-yaml` dep) and lives in `sdocs-yaml.js`, shared by the browser app, CLI (`bin/sdocs-dev.js`), and tests.

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
node test/run.js                            # starts server on :3099, runs tests, kills it
npx playwright test test/write-mode.spec.js # write mode browser tests (needs Chromium)
node test/preview.js file.md --screenshot out.png  # visual preview (needs server on :3000)
```

**Dev mode (`SDOCS_DEV=1` or `NODE_ENV=development`)**: serves CSS/JS with `Cache-Control: no-store`, injects a flag into the HTML that unregisters the service worker and clears its caches on load. Use this when iterating on frontend code so changes appear without hard-refreshing. The service worker normally caches the app shell and serves stale files even through hard reloads - dev mode sidesteps both layers.

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
11. **`sdoc <file>` integration**. If the feature owns a file extension (`.mmd`, `.mermaid`), wrap the file in the appropriate fence in `bin/sdocs-dev.js` so `sdoc graph.mmd` works out of the box.
12. **Showcase + feature-intro docs**. Build a gallery page covering every supported sub-type with source blocks, plus a separate feature-introduction doc with intro paragraph, agent-prompt examples, CLI upgrade note, then the gallery. Keep them as two files: gallery is reference, intro is the announcement payload.
13. **`public/sdoc.md`**. Add a feature section with a link to the gallery; mirror the way charts and diagrams are listed.
14. **Agent integration block** (`bin/sdocs-dev.js`). Only update if agents need to know the feature exists to use it (Mermaid + Charts qualify; styling tweaks don't). Bump `AGENT_BLOCK_VERSION`, set `AGENT_BLOCK_REASON`, prepend a `## v<N>` section to `public/agent-changes.md`, reword the per-agent snippets in `public/sdoc.md`, and tag the release. (Full release checklist is in the "Agent integration block" section above.)
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
