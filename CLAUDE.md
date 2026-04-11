# SDocs

Lightweight stateless markdown editor with live styling. Single Node.js file serves a single HTML file. No build step, no framework, one dependency (`marked` for MD parsing).

## Stack

- **Server**: `server.js` — pure Node `http` module, ~60 lines
- **Frontend**: split across `public/`:
  - `index.html` — markup only (~460 lines)
  - `css/tokens.css` — CSS custom properties, dark theme, theme transitions (~110 lines)
  - `css/layout.css` — reset, body, topbar, main layout, left panel, divider (~200 lines)
  - `css/rendered.css` — `#rendered` markdown styles, collapsible sections, copy buttons (~245 lines)
  - `css/panel.css` — right panel, controls, statusbar (~250 lines)
  - `css/mobile.css` — mobile `@media` breakpoint (~95 lines)
  - `sdocs-yaml.js` — YAML front matter parse/serialize, UMD shared with Node (~80 lines)
  - `sdocs-slugify.js` — slugify heading text to URL-safe IDs, UMD shared with Node (~12 lines)
  - `sdocs-styles.js` — pure style data tables + logic, UMD shared with tests (~285 lines)
  - `sdocs-state.js` — shared `window.SDocs` mutable state namespace (~40 lines)
  - `sdocs-theme.js` — Google Fonts, font loading, dark mode, theme toggle (~140 lines)
  - `sdocs-controls.js` — CSS variable management, color cascade, control wiring (~260 lines)
  - `sdocs-export.js` — PDF/Word/MD export, save-default styles (~200 lines)
  - `sdocs-app.js` — render, syncAll, loadText, setMode, drag/drop, init (~220 lines)
- **Tests**: `node test/run.js` — red/green, no test framework, uses Node `assert` + `http`
  - `test/runner.js` — shared harness: `test()`, `testAsync()`, `get()`, `report()`
  - `test/test-yaml.js` — YAML front matter parse/serialize tests
  - `test/test-styles.js` — SDocStyles pure module tests
  - `test/test-cli.js` — CLI parseArgs/buildUrl + style merging tests
  - `test/test-slugify.js` — slugify + heading dedup tests
  - `test/test-base64.js` — browser base64 UTF-8 roundtrip tests
  - `test/test-files.js` — file existence + content assertions
  - `test/test-http.js` — HTTP server tests (async)
- **Playwright tests**: `npx playwright test test/write-mode.spec.js` — write mode editor tests
  - `test/write-mode.spec.js` — 42 tests for toolbar actions, toggles, shortcuts, block exits
  - `playwright.config.js` — Chromium only, auto-starts server on :3000

## Architecture

The entire app is stateless. The server just serves static files. All state (current markdown content, parsed front matter, style values) lives in the `window.SDocs` namespace in the browser, primarily `SDocs.currentBody` and `SDocs.currentMeta`.

Styles are driven entirely by CSS custom properties on `#rendered`. Every control in the right panel maps to a `--md-*` variable. No style objects are stored separately — `collectStyles()` reads the DOM when exporting.

### JS module communication

All browser JS modules communicate through `window.SDocs` (created by `sdocs-state.js`). Modules register functions on `SDocs` for cross-module access (e.g. `SDocs.syncAll`, `SDocs.setColorValue`). Event handlers use late binding — they reference `SDocs.fn()` rather than capturing `fn` at parse time, so modules can load in sequence without forward-declaration issues.

**Script load order** (in `index.html`):
`marked` → `sdocs-yaml.js` → `sdocs-styles.js` → `sdocs-state.js` → `sdocs-slugify.js` → `sdocs-theme.js` → `sdocs-controls.js` → `sdocs-export.js` → `sdocs-app.js`

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

When hiding/showing UI elements (topbar, panels, toolbars), **always animate all affected properties** — not just the obvious ones. If an element collapses via `height`, also transition `opacity`, `padding`, `border-color`, and any other property that would cause a visual jump if it changed instantly. Neighboring elements that reposition (e.g. a sticky toolbar whose `top` changes when a bar above it hides) must use a matching transition curve and duration so everything moves in sync. The standard curve is `.3s cubic-bezier(.4,0,.2,1)`.

## Google Fonts

24 fonts listed in order of global popularity. Fonts are loaded lazily — a `<link>` tag is injected only when a font is first selected from the dropdown. Inter is preloaded in `<head>` as it's the default.

## Playwright testing (write mode)

Write mode uses `contentEditable` which behaves differently under Playwright automation vs real browsers. Key things to know:

- **`execCommand` doesn't work in Playwright keydown handlers.** When the real browser calls `e.preventDefault()` + `document.execCommand('insertLineBreak')` inside a keydown handler, it inserts `<br>` elements and fires `input` events. Under Playwright automation, `execCommand` silently does nothing after `preventDefault`. This means you **cannot test code block Enter behavior with real key presses** in Playwright.
- **Simulate state instead.** For tests that depend on `execCommand` results (e.g. code block exit), set up the DOM to the expected post-`execCommand` state, set any flags the handler would set, and dispatch a synthetic `InputEvent`. See the code block exit tests in `write-mode.spec.js` for the pattern.
- **`execCommand` fires `input` synchronously.** Any flags or state that an `input` handler needs to read must be set **before** calling `execCommand`, not after. The `input` event fires during `execCommand` execution, not after it returns.
- **Chromium represents newlines as `<br>` in contentEditable `<pre>`.** Both `insertText('\n')` and `insertLineBreak` produce `<br>` elements. `textContent` does **not** include these — only `innerHTML` and `childNodes` reveal them. When counting trailing BRs, skip whitespace-only text nodes (e.g. trailing `\n` from initialization).
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
node test/run.js                            # starts server on :3099, runs tests, kills it
npx playwright test test/write-mode.spec.js # write mode browser tests (needs Chromium)
node test/preview.js file.md --screenshot out.png  # visual preview (needs server on :3000)
```

## Visual preview testing

The dev server caches JS files for 24 hours (`Cache-Control: public, max-age=86400`). This means browser and Playwright sessions serve stale JS after code changes. The `test/preview.js` helper bypasses this by injecting fresh (cache-busted) JS modules on every run:

```bash
node server.js &                                     # start server first
node test/preview.js file.md --screenshot /tmp/out.png --wait 5000
node test/preview.js file.md                          # opens browser, stays open for inspection
```

Use this instead of `sdoc file.md` when you need to verify that code changes are reflected visually. The `--wait` flag controls how long to wait for Chart.js CDN load (default 4000ms).

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
