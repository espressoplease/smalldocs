# SmallDocs

**Read, style, and share markdown files - privately.**

SmallDocs (formerly SDocs) is a lightweight, stateless markdown editor with live styling. Your document lives in the URL hash fragment - browsers never send it to the server.

**[smalldocs.org](https://smalldocs.org)** &nbsp;|&nbsp; **[npm](https://www.npmjs.com/package/sdocs-dev)** &nbsp;|&nbsp; **[MIT License](LICENSE)**

---

## What it does

- **Read** - open any `.md` file with clean, styled formatting
- **Style** - customize fonts, colors, sizes, and spacing via a visual panel or YAML front matter
- **Share** - compress a document into a URL, or mint an encrypted short link the server can't read
- **Export** - PDF, Word (.docx), PowerPoint (slides), Excel (sheets), raw `.md`, or styled `.md` with front matter
- **Render more than text** - charts, Mermaid diagrams, slide decks, and live-formula spreadsheets from fenced code blocks
- **Bridge** - `sdoc bridge file.md` ties the open browser page to the file on disk: browser edits autosave to the file, file edits push to the page

Everything that touches document content runs client-side. The server serves static files, stores ciphertext for short links, and counts anonymous visits (no IPs, no tracking IDs - see [smalldocs.org/analytics](https://smalldocs.org/analytics)). The `/trust` page explains how to verify the served code matches this repository.

## CLI

The `sdoc` command opens, shares, and styles markdown from the terminal.

```bash
curl -fsSL https://smalldocs.org/install | sh
```

This installs `sdoc` under `~/.sdocs`, a directory you own. It needs Node.js already on your machine, but never needs root and never writes to npm's global folder. Re-running the command upgrades in place, as does `sdoc upgrade`.

Prefer npm? `npm i -g sdocs-dev` also works. If npm fails with `EACCES: permission denied`, its global directory is owned by root; use the install script above, or point npm at a user-owned prefix. Avoid `sudo npm i -g`: it works once, then every later upgrade without sudo hits the same EACCES.

```bash
sdoc README.md                          # open styled in browser (read-only render)
sdoc bridge draft.md                    # live session: browser edits save to disk
sdoc share report.md                    # copy encrypted short link to clipboard
sdoc library                            # browse every .md under your home directory
sdoc new                                # blank document in write mode
sdoc setup                              # teach your coding agents about sdoc
sdoc charts | diagrams | slides | cells # reference for each fenced-block type
cat notes.md | sdoc                     # pipe markdown to browser
```

## How it works

Documents are compressed with [Brotli](https://en.wikipedia.org/wiki/Brotli) and encoded as [base64url](https://en.wikipedia.org/wiki/Base64#URL_applications) in the URL hash fragment. The hash fragment is never sent to the server by the browser - it stays entirely client-side.

```
https://smalldocs.org/#md={brotli compressed + base64url encoded .md}
```

Styles are stored as [YAML front matter](https://jekyllrb.com/docs/front-matter/) in the `.md` file using a `styles:` key. Default style values are omitted from URLs to keep them short. Run `sdoc schema` to see all available properties.

## Repository layout

The repo holds two programs:

- **Server** (root `package.json`, private): `server.js` is a pure Node `http` server; the frontend is plain HTML, CSS, and JS under `public/` - no build step, no framework.
- **CLI** (`cli/package.json`, published to npm as `sdocs-dev`): `cli/bin/sdocs-dev.js` plus modules under `cli/lib/`. Zero runtime dependencies - plain Node standard library, so installing it pulls nothing and compiles nothing.

Three small modules are shared between Node and the browser via a UMD pattern; they live in `cli/shared/` with symlinks under `public/`.

## Contributing

### Setup

```bash
git clone https://github.com/espressoplease/smalldocs.git
cd smalldocs
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

By default the CLI opens URLs on `https://smalldocs.org`. When developing, point it at your local instance:

```bash
# Per-command
node cli/bin/sdocs-dev.js README.md --url http://localhost:3000

# Or set once for your session
export SDOCS_URL=http://localhost:3000
node cli/bin/sdocs-dev.js README.md
```

### Guidelines

- No build step. All browser JS must work as plain `<script>` tags.
- The CLI has no runtime dependencies; audit standard-library options before adding one.
- Keep the server simple. Static files plus a small number of API routes (short links, feedback, analytics), each backed by a local SQLite file.
- Test everything that's testable without a browser in `test/run.js`. Use Playwright for browser-specific behavior.
- No em or en dashes anywhere; use plain hyphens.

`CLAUDE.md` in the repo root carries the detailed architecture notes (module map, shared-module pattern, release checklists) and is kept current.

## License

[MIT](LICENSE)
