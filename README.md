# SDocs

**Read, style, and share markdown files — privately.**

SDocs is a lightweight, stateless markdown editor with live styling. Your entire document lives in the URL hash — nothing is ever sent to a server.

**[sdocs.dev](https://sdocs.dev)** &nbsp;|&nbsp; **[npm](https://www.npmjs.com/package/sdocs-dev)** &nbsp;|&nbsp; **[MIT License](LICENSE)**

---

## What it does

- **Read** — open any `.md` file with clean, styled formatting
- **Style** — customize fonts, colors, sizes, and spacing via a visual panel or YAML front matter
- **Share** — compress a document into a URL and share it with anyone (no server, no account)
- **Export** — PDF, Word (.docx), raw `.md`, or styled `.md` with front matter

Everything runs client-side. The server is a small Node.js script that serves static files. The hosted instance at sdocs.dev counts anonymous visits (no IPs, no tracking IDs) which you can see at [sdocs.dev/analytics](https://sdocs.dev/analytics); self-hosted and CLI use never phone home.

## CLI

```bash
npm i -g sdocs-dev
```

```bash
sdoc README.md                          # open styled in browser
sdoc share report.md                    # copy shareable link to clipboard
sdoc share report.md --dark             # link opens in dark theme
sdoc share report.md --section "Results"  # deep-link to a heading
sdoc new                                # blank document in write mode
sdoc schema                             # print all style properties
cat notes.md | sdoc                     # pipe markdown to browser
```

## How it works

Documents are compressed with [Brotli](https://en.wikipedia.org/wiki/Brotli) and encoded as [base64url](https://en.wikipedia.org/wiki/Base64#URL_applications) in the URL hash fragment. The hash fragment is never sent to the server by the browser — it stays entirely client-side.

```
https://sdocs.dev/#md={brotli compressed + base64url encoded .md}
```

Styles are stored as [YAML front matter](https://jekyllrb.com/docs/front-matter/) in the `.md` file using a `styles:` key. Default style values are omitted from URLs to keep them short. Run `sdoc schema` to see all available properties.

## Stack

- **Server**: `server.js` — pure Node.js `http` module
- **Frontend**: plain HTML, CSS, and JS in `public/` — no build step, no framework
- **Markdown parsing**: [marked](https://github.com/markedjs/marked) (the only runtime dependency)
- **Compression**: [brotli-wasm](https://github.com/nicolo-ribaudo/brotli-wasm) (WebAssembly, loaded in browser)
- **Tests**: `node test/run.js` — custom red/green harness using Node `assert`
- **Browser tests**: [Playwright](https://playwright.dev/) (Chromium)

## Contributing

### Setup

```bash
git clone https://github.com/espressoplease/SDocs.git
cd SDocs
npm install
```

### Run locally

```bash
node server.js                    # http://localhost:3000
PORT=8080 node server.js          # custom port
SDOCS_DEV=1 node server.js        # dev mode: no-cache headers, service worker disabled
```

`SDOCS_DEV=1` (or `NODE_ENV=development`) disables browser caching for CSS/JS and tells the app to unregister the service worker and clear its caches on load, so edits to frontend code are picked up instantly without hard-refreshing. Leave it unset in production.

### Run tests

```bash
node test/run.js                              # unit + integration tests
npx playwright test test/write-mode.spec.js   # browser tests (needs Chromium)
```

### Point the CLI at your local server

By default the CLI opens URLs on `https://sdocs.dev`. When developing, point it at your local instance:

```bash
# Per-command
sdoc README.md --url http://localhost:3000
sdoc share README.md --url http://localhost:3000

# Or set once for your session
export SDOCS_URL=http://localhost:3000
sdoc README.md
sdoc share README.md
```

### Project structure

```
server.js                   # Node.js static file server
bin/sdocs-dev.js            # CLI entry point
public/
  index.html                # Single HTML file (markup only)
  css/                      # Modular CSS (tokens, layout, rendered, panel, mobile)
  sdocs-yaml.js             # YAML front matter parser (UMD, shared with Node)
  sdocs-styles.js           # Style data tables + logic (UMD, shared with tests)
  sdocs-state.js            # Shared mutable state namespace (window.SDocs)
  sdocs-theme.js            # Fonts, dark mode, theme toggle
  sdocs-controls.js         # CSS variable management, color cascade
  sdocs-export.js           # PDF/Word/MD export
  sdocs-write.js            # Write mode (contentEditable)
  sdocs-app.js              # Core app: render, sync, modes, compression, init
  brotli-wasm-v1.js         # Brotli WASM wrapper (IIFE)
  brotli_wasm_bg.wasm       # Brotli WebAssembly binary
  vendor/marked.min.js      # Markdown parser
  sw.js                     # Service worker (stale-while-revalidate + version check)
  sdoc.md                   # Landing page content
test/
  run.js                    # Test runner entry point
  runner.js                 # Shared test harness
  test-yaml.js              # YAML parser tests
  test-styles.js            # Style system tests (including stripStyleDefaults)
  test-cli.js               # CLI argument parsing + URL building tests
  test-slugify.js           # Slugify + heading dedup tests
  test-base64.js            # Base64 UTF-8 roundtrip tests
  test-files.js             # File existence + content assertions
  test-http.js              # HTTP server tests
  write-mode.spec.js        # Playwright write mode tests
  sample.smd                # Test fixture (styled markdown)
  bench-compression.js      # Compression benchmark (deflate vs brotli)
```

### Architecture notes

The app is entirely stateless. All state lives in `window.SDocs` in the browser. There is no build step — all JS loads as plain `<script>` tags. Modules that need to run in both the browser and Node (for tests) use a UMD IIFE pattern.

Styles are driven by CSS custom properties on `#rendered`. Every control in the style panel maps to a `--md-*` CSS variable. When exporting, `collectStyles()` reads the current control values from the DOM.

### Guidelines

- No build step. All browser JS must work as plain `<script>` tags.
- One runtime dependency (`marked`). Add dependencies only when there's no reasonable alternative.
- Keep the server simple. It serves static files — no API routes, no database.
- Test everything that's testable without a browser in `test/run.js`. Use Playwright for browser-specific behavior.
- Style properties that match defaults should be omitted (see `stripStyleDefaults` in `sdocs-styles.js`).

## License

[MIT](LICENSE)
