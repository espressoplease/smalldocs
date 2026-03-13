# SDocs

Lightweight stateless markdown editor with live styling. Single Node.js file serves a single HTML file. No build step, no framework, one dependency (`marked` for MD parsing).

## Stack

- **Server**: `server.js` — pure Node `http` module, ~60 lines
- **Frontend**: split across `public/`:
  - `index.html` — markup only (~420 lines)
  - `styles.css` — all CSS (~880 lines)
  - `app.js` — all application JS (~600 lines)
  - `sdocs-styles.js` — pure style data tables + logic, shared with tests (UMD)
- **Tests**: `node test/run.js` — red/green, no test framework, uses Node `assert` + `http`

## Architecture

The entire app is stateless. The server just serves static files. All state (current markdown content, parsed front matter, style values) lives in two JS variables in the browser: `currentBody` and `currentMeta`.

Styles are driven entirely by CSS custom properties on `#rendered`. Every control in the right panel maps to a `--md-*` variable. No style objects are stored separately — `collectStyles()` reads the DOM when exporting.

## Shared modules (UMD pattern)

There is no build step, so we **cannot use ES modules** (`import`/`export`). Code that needs to run in both the browser and Node tests uses a UMD IIFE pattern:

```js
(function (exports) {
  // ... all code ...
  exports.foo = foo;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.MyLib = {}));
```

In the browser the IIFE writes to `window.MyLib`; in Node tests it writes to `module.exports`. `public/sdocs-styles.js` is the main example — it holds pure style data tables and logic shared by `app.js` and `test/run.js`.

## File format

Styled exports are plain `.md` files with **YAML front matter** (the `---` block standard used by Jekyll, Hugo, Obsidian, Gatsby). The `styles:` key is our addition. Raw exports strip front matter entirely.

When a file is dropped or loaded, `parseFrontMatter()` splits it into `meta` (the YAML object) and `body` (everything after `---`). If `meta.styles` exists, `applyStylesFromMeta()` walks the object and sets each control + CSS var.

The YAML parser is hand-rolled (no `js-yaml` dep) and handles the subset needed: scalars, nested blocks, and inline objects like `h1: { fontSize: 2.1, color: "#fff" }`.

## Google Fonts

24 fonts listed in order of global popularity. Fonts are loaded lazily — a `<link>` tag is injected only when a font is first selected from the dropdown. Inter is preloaded in `<head>` as it's the default.

## Running

```bash
node server.js          # http://localhost:3000
PORT=8080 node server.js
node test/run.js        # starts server on :3099, runs 18 tests, kills it
```
