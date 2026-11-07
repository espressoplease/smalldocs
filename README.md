# SmallDocs

**Read, style, and share markdown files - privately.**

SmallDocs renders Markdown documents with live styling. SmallDocs Cloud adds a tagged library, search, shared access and revision history. URL-only documents carry their content in the browser's hash fragment.

**[smalldocs.org](https://smalldocs.org)** &nbsp;|&nbsp; **[npm](https://www.npmjs.com/package/sdocs-dev)** &nbsp;|&nbsp; **[Elastic License 2.0](LICENSE)** &nbsp;|&nbsp; **[Discord](https://discord.gg/8n6DR4v46f)**

---

## What it does

- **Read** - open any `.md` file with clean, styled formatting
- **Style** - customize fonts, colors, sizes, and spacing via a visual panel or YAML front matter
- **Share** - compress a document into a URL, or mint an encrypted short link the server can't read
- **Export** - PDF, Word (.docx), PowerPoint (slides), Excel (sheets), raw `.md`, or styled `.md` with front matter
- **Render more than text** - charts, Mermaid diagrams, slide decks, and live-formula spreadsheets from fenced code blocks
- **Bridge** - `sdoc bridge file.md` ties the open browser page to the file on disk: browser edits autosave to the file, file edits push to the page

URL-only document rendering runs in the browser. Snapshot short links store ciphertext with the decryption key in the URL fragment. Cloud documents use server-managed encryption at rest; authorized server operations decrypt content to read, search and edit it. Cloud permissions apply to browser and CLI access.

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
sdoc setup                              # install the SmallDocs skill for your coding agents
sdoc charts | diagrams | slides | cells # reference for each fenced-block type
cat notes.md | sdoc                     # pipe markdown to browser
```

## How it works

### Cloud documents and reviewer feedback

After connecting Cloud, run `sdoc setup --cloud --yes` to install the Cloud-first agent skill. Save documents with tags and use the returned Cloud URL in chat:

```sh
sdoc report.md --cloud --json +research +project
sdoc cloud search 'project report' --json
sdoc cloud read DOCUMENT_ID --section Summary --json
sdoc cloud edit DOCUMENT_ID --section Summary --old 'Draft' --new 'Reviewed' --base-revision READ_REVISION_ID --json
sdoc cloud comments DOCUMENT_ID --json
sdoc cloud comments DOCUMENT_ID --id c7 --reply 'Updated and checked.' --json
sdoc cloud comments DOCUMENT_ID --id c7 --resolve --json
sdoc cloud comments DOCUMENT_ID --id c7 --delete --json
```

Comment JSON includes replies, status, anchor diagnostics, source excerpts and Cloud links. Resolve keeps the discussion in the document. Delete removes the thread and its replies from the current document; earlier revisions follow the 90-day retention policy. Document text and other comments stay unchanged.

Direct edits and full-file pull/edit/push both save revisions at the same Cloud URL. The open browser checks for revisions and renders saved changes. Read the [Cloud editing and feedback guide](public/cloud-updates.md), or run `sdoc cloud edit --help` and `sdoc cloud comments --help` for targeting, pagination, concurrent changes and retry behavior.

### URL-only documents

URL-only documents are compressed with [Brotli](https://en.wikipedia.org/wiki/Brotli) and encoded as [base64url](https://en.wikipedia.org/wiki/Base64#URL_applications) in the URL hash fragment. The browser does not send that fragment to the server.

```
https://smalldocs.org/#md={brotli compressed + base64url encoded .md}
```

Styles are stored as [YAML front matter](https://jekyllrb.com/docs/front-matter/) in the `.md` file using a `styles:` key. Default style values are omitted from URLs to keep them short. Run `sdoc schema` to see all available properties.

## Repository layout

The repo holds two programs:

- **Server** (root `package.json`, private): `server.js` is a pure Node `http` server; the frontend is plain HTML, CSS, and JS under `public/` - no build step, no framework.
- **CLI** (`cli/package.json`, published to npm as `sdocs-dev`): `cli/bin/sdocs-dev.js` plus modules under `cli/lib/`. Zero runtime dependencies - plain Node standard library, so installing it pulls nothing and compiles nothing.

Shared modules use a UMD pattern; they live in `cli/shared/` with symlinks under `public/`.

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

[Elastic License 2.0](LICENSE). The source is public and you may use, copy, modify, and redistribute it. You may not offer SmallDocs to third parties as a hosted or managed service, strip its licensing notices, or circumvent its license-key functionality.
