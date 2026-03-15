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

## Architecture

The entire app is stateless. The server just serves static files. All state (current markdown content, parsed front matter, style values) lives in the `window.SDocs` namespace in the browser, primarily `SDocs.currentBody` and `SDocs.currentMeta`.

Styles are driven entirely by CSS custom properties on `#rendered`. Every control in the right panel maps to a `--md-*` variable. No style objects are stored separately — `collectStyles()` reads the DOM when exporting.

### JS module communication

All browser JS modules communicate through `window.SDocs` (created by `sdocs-state.js`). Modules register functions on `SDocs` for cross-module access (e.g. `SDocs.syncAll`, `SDocs.setColorValue`). Event handlers use late binding — they reference `SDocs.fn()` rather than capturing `fn` at parse time, so modules can load in sequence without forward-declaration issues.

**Script load order** (in `index.html`):
`marked` → `sdocs-yaml.js` → `sdocs-styles.js` → `sdocs-state.js` → `sdocs-theme.js` → `sdocs-controls.js` → `sdocs-export.js` → `sdocs-app.js`

## Shared modules (UMD pattern)

There is no build step, so we **cannot use ES modules** (`import`/`export`). Code that needs to run in both the browser and Node tests uses a UMD IIFE pattern:

```js
(function (exports) {
  // ... all code ...
  exports.foo = foo;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.MyLib = {}));
```

In the browser the IIFE writes to `window.MyLib`; in Node tests it writes to `module.exports`. Two modules use this pattern: `sdocs-yaml.js` (`window.SDocYaml`) and `sdocs-styles.js` (`window.SDocStyles`).

## File format

Styled exports are plain `.md` files with **YAML front matter** (the `---` block standard used by Jekyll, Hugo, Obsidian, Gatsby). The `styles:` key is our addition. Raw exports strip front matter entirely.

When a file is dropped or loaded, `parseFrontMatter()` splits it into `meta` (the YAML object) and `body` (everything after `---`). If `meta.styles` exists, `applyStylesFromMeta()` walks the object and sets each control + CSS var.

The YAML parser is hand-rolled (no `js-yaml` dep) and lives in `sdocs-yaml.js`, shared by the browser app, CLI (`bin/sdocs-dev.js`), and tests.

## Transitions & animations

When hiding/showing UI elements (topbar, panels, toolbars), **always animate all affected properties** — not just the obvious ones. If an element collapses via `height`, also transition `opacity`, `padding`, `border-color`, and any other property that would cause a visual jump if it changed instantly. Neighboring elements that reposition (e.g. a sticky toolbar whose `top` changes when a bar above it hides) must use a matching transition curve and duration so everything moves in sync. The standard curve is `.3s cubic-bezier(.4,0,.2,1)`.

## Google Fonts

24 fonts listed in order of global popularity. Fonts are loaded lazily — a `<link>` tag is injected only when a font is first selected from the dropdown. Inter is preloaded in `<head>` as it's the default.

## Running

```bash
node server.js          # http://localhost:3000
PORT=8080 node server.js
node test/run.js        # starts server on :3099, runs 66 tests, kills it
```
