# Server HTML routes, cache-busting, and deploy checks

Read this guide when adding or editing HTML routes in `server.js`, changing asset loading, or preparing a frontend deploy.

## Asset cache-busting

Every `<link rel="stylesheet" href="/public/...">` and `<script src="/public/...">` URL in **any** HTML the server serves is automatically rewritten to carry `?v=<APP_VERSION>` at HTML serve time. `APP_VERSION` is a 10-char hash of the contents of `public/`, so any deploy that touches a public file changes the query string and the browser HTTP cache misses on every asset URL.

**Don't write `?v=` by hand in HTML.** The rewriter lives in `rewriteAssets()` in `server.js`, and `serveHtmlWithRewrite()` is the single helper every HTML route goes through (`/`, `/new`, `/legal`, `/blogs/...`, `/s/...`, `/feedback`, `/trust`, `/analytics`). If you add a new HTML entry point, route it through `serveHtmlWithRewrite()` (or call `rewriteAssets()` directly) - otherwise its asset URLs ship un-versioned and returning users will see the new HTML against a stale browser HTTP cache.

What the rewriter does and doesn't touch:

- **Touches**: `<script src="/public/...">` and `<link rel="stylesheet" href="/public/...">` whose URL has no query string yet.
- **Skips**: cross-origin URLs (CDN, Google Fonts), already-versioned URLs, `<link rel="icon">`, inline `<style>` and `<script>`, and `url(...)` references inside CSS (e.g. `@font-face`). Inline-CSS-referenced fonts are immutable (`max-age=31536000`) so this is safe in practice - if you add a stylesheet that references mutable assets via `url(...)`, version the filename instead of the query.

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
