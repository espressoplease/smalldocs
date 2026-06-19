# Contributing to SmallDocs

Thanks for your interest. This guide covers how to get set up, what the project expects from contributions, and how to get a change merged.

## Questions

For questions, discussion, or help before opening an issue, join the [Discord server](https://discord.gg/8n6DR4v46f).

## Before you start

- Check the [open issues](https://github.com/espressoplease/smalldocs/issues) to see if something is already being worked on.
- For a small bug fix or typo, just open a PR. For anything larger, open an issue first to align on scope before you write code.
- Issues labelled **good first issue** are scoped to a single module with the approach already described.

## Setup

You need Node.js (v18+) and Git.

```bash
git clone https://github.com/espressoplease/smalldocs.git
cd smalldocs
npm install
```

Start the local server:

```bash
SDOCS_DEV=1 node server.js    # http://localhost:3000
```

`SDOCS_DEV=1` disables browser caching and the service worker so frontend edits show up immediately without hard-reloading.

Run the test suite:

```bash
node test/run.js                              # unit + integration tests
npx playwright test                           # browser tests (needs Chromium)
```

To run browser tests you need Chromium:

```bash
npx playwright install chromium
```

## Repository layout

The repo has two independent programs:

- **Server** - `server.js` plus everything outside `cli/`. Pure Node `http` module, no framework, no build step. Managed by the root `package.json` (private, never published).
- **CLI** - everything under `cli/`. Published to npm as `sdocs-dev`. Zero runtime dependencies.

Frontend code lives under `public/` as plain `<script>` tags. There is no bundler. All browser JS must work without a build step.

Three modules are shared between the browser and Node via a UMD pattern. The real files live under `cli/shared/`; `public/` holds symlinks to them. If you edit one, edit it via `cli/shared/`.

## Making changes

### Server and frontend

- No build step. Do not introduce one.
- Keep script load order in mind - new browser modules go in the correct slot in `public/index.html`. Renderers (charts, diagrams) load after `sdocs-charts.js` and before `sdocs-app.js`.
- New HTML entry points must go through `serveHtmlWithRewrite()` in `server.js` - this is what applies asset cache-busting. The test `test/test-files.js` will fail if you skip it.
- Animate all affected CSS properties together (height, opacity, padding, border-color). The standard curve is `.3s cubic-bezier(.4,0,.2,1)`.

### CLI

- No runtime dependencies. Audit standard-library options before adding one. `cli/package.json` must stay dependency-free.
- The `sdoc` command lives in `cli/bin/sdocs-dev.js`. Supporting modules are under `cli/lib/`.
- Three modules under `cli/shared/` are shared with the browser. Edit them there (not via the `public/` symlinks).

### Tests

Every change should have a test. The project has two test layers:

- **Unit + integration** (`node test/run.js`) - plain Node `assert`, no test framework. Add new test files under `test/` and wire them into `test/run.js`. Look at `test/test-cli.js` or `test/test-library-scan.js` for the pattern.
- **Browser (Playwright)** (`npx playwright test`) - for behavior that requires a real browser. Look at `test/write-mode.spec.js` for the pattern.

For CLI install/setup changes, the harness in `test/cli-harness.js` lets you run the real CLI binary against a fake `$HOME` without publishing to npm. Use it. See `test/test-setup-scenarios.js` for examples.

### Adding a new markdown render feature

This involves more surfaces than a typical change. The full checklist is in `CLAUDE.md` under "Adding a new markdown feature" - read it before starting. Key points:

1. Lazy-load any CDN renderer on first use, not on page load.
2. Post-sanitize renderer output (strip `<script>`, `<iframe>`, `on*` handlers, `javascript:` URLs).
3. Add both a size cap per block and a count cap per document.
4. Add XSS Playwright tests mirroring `test/xss.spec.js` and `test/mermaid.spec.js`.
5. Add an export path in `public/sdocs-export.js`.

## Code style

- **No build step.** All browser JS as plain `<script>` tags. No ES modules (`import`/`export`). Shared modules use the UMD IIFE pattern documented in `CLAUDE.md`.
- **No em or en dashes** anywhere - source, comments, commit messages, docs. Use a plain hyphen.
- **No comments** unless the why is non-obvious. Do not describe what the code does; well-named identifiers do that.
- **No error handling for impossible cases.** Only validate at real boundaries (user input, external API responses).

## Writing style (docs, UI strings, commit messages)

- State what something does. Skip adjectives the reader can judge themselves.
- Name trade-offs. If something has a cost, say so.
- No "simply", "just", "seamless", "blazing". No exclamation marks in technical copy.
- Write to the reader's question, not your design rationale.

See the "Writing style" section of `CLAUDE.md` for the full guide.

## Commit messages

Follow the style of recent commits: `Component: short imperative description`. Examples:

```
CLI: add --dry-run flag to setup
Library: fall back to first heading when file has no title
Tests: add install.sh end-to-end harness
```

No period at the end. Keep the subject line under 72 characters. If more context is needed, add a blank line then a short paragraph - not a bulleted list of what you changed.

## Pull requests

- One logical change per PR. Split unrelated fixes into separate PRs.
- Link the issue the PR closes (`Closes #N` in the description).
- All tests must pass: `node test/run.js` and any relevant Playwright specs.
- If the change touches the frontend, run the service-worker refresh check described in `CLAUDE.md` under "Pre-deploy check: service-worker refresh".
- If the change modifies the agent integration block (`cli/lib/agent-block.js`), follow the release checklist in `CLAUDE.md` under "Agent integration block".

## License

By contributing you agree your work is released under the [Elastic License 2.0](LICENSE).
