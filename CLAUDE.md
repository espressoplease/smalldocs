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
  - `test/test-http.js` - HTTP server tests (async)
  - `test/test-comments.js` - comment data-model + YAML/footnote round-trip + sanitisation tests
- **Playwright tests**: `npx playwright test test/write-mode.spec.js` - write mode editor tests
  - `test/write-mode.spec.js` - 42 tests for toolbar actions, toggles, shortcuts, block exits
  - `test/comment-mode.spec.js` - comment-mode integration: anchor resolution, composer, navigation
  - `test/footnote-input.spec.js` - parsing markdown-footnote-format comment input
  - `test/xss.spec.js` - script / event-handler / iframe injection through markdown
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

The `sdoc setup` command appends a SDocs explainer to coding-agent config files (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, etc.). The block lives as `AGENT_BLOCK` in `bin/sdocs-dev.js` and is duplicated as per-agent snippets in `public/sdoc.md` (the "Set up your agent" section). **If you reword one, reword the other.** The marker comment `<!-- sdocs-agent-block -->` on the first line is used for idempotent re-runs (skip files that already contain it).

## CLI state

All CLI-side state lives under `~/.sdocs/`:
- `styles.yaml` - user-editable default styles
- `update-check.json` - daily npm version cache
- `setup.json` - agent setup tracking (so `sdoc setup` only auto-prompts once)

## Architecture

The entire app is stateless. The server just serves static files. All state (current markdown content, parsed front matter, style values) lives in the `window.SDocs` namespace in the browser, primarily `SDocs.currentBody` and `SDocs.currentMeta`.

Styles are driven entirely by CSS custom properties on `#rendered`. Every control in the right panel maps to a `--md-*` variable. No style objects are stored separately - `collectStyles()` reads the DOM when exporting.

### JS module communication

All browser JS modules communicate through `window.SDocs` (created by `sdocs-state.js`). Modules register functions on `SDocs` for cross-module access (e.g. `SDocs.syncAll`, `SDocs.setColorValue`). Event handlers use late binding - they reference `SDocs.fn()` rather than capturing `fn` at parse time, so modules can load in sequence without forward-declaration issues.

**Script load order** (in `index.html`):
`marked` -> `purify` -> `sdocs-yaml.js` -> `sdocs-styles.js` -> `sdocs-state.js` -> `sdocs-slugify.js` -> `sdocs-theme.js` -> `sdocs-controls.js` -> `sdocs-chrome.js` -> `sdocs-export.js` -> `sdocs-write.js` -> `sdocs-charts.js` -> `sdocs-math.js` -> `sdocs-comments.js` -> `sdocs-app.js` -> `sdocs-info.js` -> `sdocs-comments-ui.js`

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

## Pre-deploy check: service-worker refresh

The service worker caches the app shell and serves stale copies for one page load after a deploy. On that load the SW posts `check-update`; when the server's `APP_VERSION` differs it purges the cache, re-fetches, and posts `sdocs-reload` to force the client onto the new code.

Returning users therefore see a brief (~0.5-2s) flash of the OLD HTML before the auto-reload. If the change reshapes the DOM (new toolbar buttons, renamed IDs, new panels, new script modules), that transient state can look broken and is easy to miss locally because fresh tabs never experience it.

**Before shipping any frontend change that adds or reshapes DOM:**

1. Start the server in prod mode (no `SDOCS_DEV=1`) on the current `main`. Load `http://localhost:3000/` and confirm in DevTools > Application > Service Workers that it registered.
2. Apply the intended change and restart the server. `APP_VERSION` shifts automatically because `walkPublic` rehashes everything under `public/`.
3. Reload the tab (not a hard reload). You should see: old shell renders briefly, console logs `sdocs-reload`, page auto-reloads into the new shell.
4. If the intermediate state is visibly broken, either defer-guard the JS (early-return on missing elements, which most modules already do) or call it out in the PR description so reviewers know the flash is expected.

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
