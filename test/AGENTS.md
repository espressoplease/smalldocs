# Tests

Read this file when running, adding, or debugging unit tests, Playwright specs, CLI setup scenarios, or visual previews.

## Commands

```bash
node test/run.js                              # starts server on :3099, runs unit/integration + CLI setup scenarios, kills it
npx playwright test test/write-mode.spec.js   # write mode browser tests (needs Chromium)
node test/preview.js file.md --screenshot out.png  # visual preview (needs server on :3000)

# Fast iteration on just the CLI setup / refresh scenarios (fake $HOME, no npm publish needed):
node -e "const h=require('./test/runner');const r=require('./test/test-setup-scenarios')(h);(async()=>{await r();h.report();})()"
```

## Suite layout

- **Node unit & integration tests**: `node test/run.js` - red/green, no test framework, uses Node `assert` + `http`.
  - `test/runner.js` - shared harness: `test()`, `testAsync()`, `get()`, `report()`
  - `test/test-yaml.js` - YAML front matter parse/serialize tests
  - `test/test-styles.js` - SDocStyles pure module tests
  - `test/test-cli.js` - CLI parseArgs/buildUrl + style merging tests
  - `test/test-slugify.js` - slugify + heading dedup tests
  - `test/test-base64.js` - browser base64 UTF-8 roundtrip tests
  - `test/test-files.js` - file existence + content assertions (including HTML asset-rewriter coverage)
  - `test/test-http.js` - HTTP server tests (async); includes the per-route asset-versioning assertions
  - `test/test-cache-bust.js` - two-server check that asset URLs change when `public/` contents change
  - `test/test-comments.js` - comment data-model + YAML/footnote round-trip + sanitisation tests
  - `test/test-code-comments.js` - code-comment model: add/remove/update, `block` tag scoping, sanitisation, anchor re-resolution after drift, JSON round-trip
  - `test/test-code-structural.js` - per-language structural-keyword tables (keep vs fold sample lines)
  - `test/test-mermaid.js` - directive stripping + marked output shape + hardening assertions
  - `test/test-cells-xlsx.js` - .xlsx writer tests (ZIP structure, worksheet XML, formula translation, number formats)
  - `test/test-setup-scenarios.js` - CLI setup/refresh scenarios against a fake `$HOME`
- **Playwright tests**: `playwright.config.js` (Chromium only, auto-starts server on :3000)
  - `test/write-mode.spec.js` - toolbar actions, toggles, shortcuts, block exits
  - `test/comment-mode.spec.js` - comment-mode integration: anchor resolution, composer, navigation
  - `test/code-comments.spec.js` - code-comment mode in the fullscreen view: add line/method notes, edit, delete, navigate, fold interaction, document-front-matter persistence, multi-block scoping, orphan handling
  - `test/code-comment-parity.spec.js` - headless geometry assertions ensuring no comment card overlaps code text
  - `test/footnote-input.spec.js` - parsing markdown-footnote-format comment input
  - `test/xss.spec.js` - script / event-handler / iframe injection through markdown
  - `test/mermaid.spec.js` - real-browser Mermaid render + XSS payloads + DoS cap (CDN-dependent)
  - `test/short-link.spec.js` - short-link load + staleness fix (edit clears the stale short URL)

For email template and SMTP tests, see `maintainers/email-testing.md`. For spreadsheet export validation, see `maintainers/spreadsheet-parity.md`.

## Playwright testing (write mode)

Write mode uses `contentEditable` which behaves differently under Playwright automation vs real browsers. Key things to know:

- **`execCommand` doesn't work in Playwright keydown handlers.** When the real browser calls `e.preventDefault()` + `document.execCommand('insertLineBreak')` inside a keydown handler, it inserts `<br>` elements and fires `input` events. Under Playwright automation, `execCommand` silently does nothing after `preventDefault`. This means you **cannot test code block Enter behavior with real key presses** in Playwright.
- **Simulate state instead.** For tests that depend on `execCommand` results (e.g. code block exit), set up the DOM to the expected post-`execCommand` state, set any flags the handler would set, and dispatch a synthetic `InputEvent`. See the code block exit tests in `write-mode.spec.js` for the pattern.
- **`execCommand` fires `input` synchronously.** Any flags or state that an `input` handler needs to read must be set **before** calling `execCommand`, not after. The `input` event fires during `execCommand` execution, not after it returns.
- **Chromium represents newlines as `<br>` in contentEditable `<pre>`.** Both `insertText('\n')` and `insertLineBreak` produce `<br>` elements. `textContent` does **not** include these - only `innerHTML` and `childNodes` reveal them. When counting trailing BRs, skip whitespace-only text nodes (e.g. trailing `\n` from initialization).
- **N Enter presses = N+1 trailing `<br>` elements** (the extra one is the browser's caret placeholder).

## Testing the CLI install / setup flow

Historically the only way to verify `sdoc setup`, `sdoc refresh`, or any skill/block migration was: bump the version, publish to npm, run a real `npm i -g sdocs-dev` (or the curl installer), eyeball the result, then uninstall and try again. Slow, fragile, easy to skip - which is how regressions in the install / setup path used to ship.

`test/cli-harness.js` + `test/test-setup-scenarios.js` replace that loop. The harness spawns the real CLI binary (`cli/bin/sdocs-dev.js`) against a temp directory that pretends to be `$HOME`. Every path the CLI reads or writes is derived from `os.homedir()`, which reads `$HOME` on macOS / Linux, so the spawned process believes that temp dir is the world. The fixture is wiped at the end. Nothing escapes; no `npm publish` involved.

**Re-run these scenarios whenever you touch:**

- `cli/lib/setup.js` (the setup / refresh state machine, the `--yes` non-interactive path)
- `cli/lib/agent-block.js` (skill body / version, agent table, legacy-block detection, `~/.sdocs/setup.json` schema)
- `cli/lib/agent-files.js` (canonical write, symlink install, lock, block strip, sync dispatch)
- `cli/lib/constants.js` (paths like `SETUP_CACHE`)
- `cli/lib/io.js` parser, when adding flags consumed by setup / refresh

If a scenario fails after a change in any of those, the regression is real - a real user upgrading on the live CLI would hit it. Bumping `SKILL_VERSION` is the most common reason scenario 4 (stale/old block -> stripped + skill written) needs attention; that test pins the upgrade path.

Each scenario takes ~100ms; the nineteen together run well under a second.

**Scenarios covered:**

1. Fresh install, no agent configs -> `setup --yes` still writes the canonical skill
2. Repeated `setup --yes` with no detected agents -> canonical install remains accepted and refreshable
3. Fresh install, Claude detected -> `setup --yes` writes the canonical skill + symlinks Claude
4. Already current -> `setup --yes` is a no-op (skill byte-identical, symlink untouched, "Nothing to do")
5. Old (v6) bookended block -> `refresh` strips it, writes the skill, surrounding text preserved
6. Legacy open-marker block -> `refresh` strips it, writes the skill
7. Hand-edited legacy block -> `refresh` leaves it alone, prints a "local edits" hint
8. Legacy block in a symlinked agent config -> target preserved, skip reported, migration left retryable
9. Stale canonical skill -> `setup --yes` upgrades it to current
10. Existing user content in `CLAUDE.md` -> `setup --yes` strips the block without breaking the user's prior content
11. Multi-agent (claude + pi + codewhale + opencode) -> non-universal agents symlinked; opencode covered by canonical (no `~/.config/opencode/skills` link, avoids double-list)
12. Dry-run -> prints every path and the skill body, writes nothing, no state
13. Fresh auto-refresh gate -> no prior setup evidence means no implicit install
14. Legacy-block auto-refresh gate -> a recognised old block counts as prior consent
15. User-maintained agent skill directory -> left untouched and reported
16. User-maintained canonical skill -> left untouched; legacy block retained until setup succeeds
17. User-owned regular file at an agent skill path -> left untouched and reported
18. Agent skills parent symlinked to the canonical directory -> detected as the same filesystem path, no self-link or deletion
19. Interactive refresh opt-out -> persisted exactly as answered

**Idempotency contract:** `sdoc setup --yes` is the canonical "make my agent skill current" command and is safe to re-run any number of times. Internally it calls `syncAgentSkill()`: refresh the canonical skill, ensure every detected non-universal agent's symlink, and strip any legacy block that reappeared. Scenario 4 pins the no-op; scenarios 5, 6, 9, and 10 pin upgrade/migration behavior. If a re-run of `setup --yes` stops being a no-op on already-current state, or stops upgrading on stale state, the contract is broken.

**Harness API** (`test/cli-harness.js`):

```js
const { createFixture } = require('./cli-harness');

const fx = createFixture({
  agents:        ['claude', 'codex'],                  // create empty config files
  existingBlock: { in: 'claude', version: 6 },         // optional: seed a bookended block
  legacyBlock:   { in: 'claude', version: 2 },         // optional: seed a 1.4.x open-marker block
  fileSeed:      { claude: '# hand-written file\n' },  // optional: raw initial file content
  setupState:    { lastRunVersion: '1.10.0', autoRefreshAgentFiles: true }, // optional: seed ~/.sdocs/setup.json
});
const r = await fx.run('setup --yes');                 // { stdout, stderr, exitCode }
fx.readAgent('claude');                                // resulting file content (or null)
fx.readSetupState();                                   // parsed setup.json (or null)
fx.exists('.sdocs/setup.json');                        // relative-to-HOME existence check
fx.cleanup();                                          // always call in a finally
```

`fx.run(args, opts)` exposes `opts.stdin` for piping input, `opts.timeoutMs` (default 10s), `opts.env` for additional env vars, and `opts.allowAutoRefresh: true` to remove the default `SDOCS_NO_REFRESH=1` guard (set it when testing the auto-refresh-on-version-bump path through `postCommandHooks`). The harness already strips `CI` and sets `SDOCS_NO_UPDATE_CHECK=1` + `SDOCS_NO_SETUP=1` so spawned processes don't phone home or trigger first-run prompts.

**Adding a new scenario**: append to `test/test-setup-scenarios.js` using the `scenario(name, async () => { ... })` helper. Seed a fixture, run the CLI, assert on the resulting filesystem, `cleanup()` in `finally`. The runner is sequential and counted into the same total as the rest of `node test/run.js`.

**Running scenarios through a sub-agent**: a sub-agent in a fresh context can run `node test/run.js` and get clean pass / fail without any setup. To hand the agent one scenario at a time (e.g. "seed a v6 block, run setup --yes, tell me the resulting CLAUDE.md") point it at `test/cli-harness.js` - the API above is the contract and the comments at the top of that file are self-contained.

**End-to-end testing of `install.sh`** is a separate problem because the script downloads a tarball from the npm registry. Not covered by this harness. The natural next phase: add an `SDOCS_TARBALL_URL` env override to `install.sh`, `npm pack` the local CLI to a temp tarball, point the script at it via `file://`, run it with `HOME=<fixture>`, assert `~/.sdocs/cli/bin/sdocs-dev.js` exists and `~/.sdocs/bin/sdoc` symlinks onto it.

## Visual preview testing

The dev server caches JS files for 24 hours (`Cache-Control: public, max-age=86400`). This means browser and Playwright sessions serve stale JS after code changes. The `test/preview.js` helper bypasses this by injecting fresh (cache-busted) JS modules on every run:

```bash
node server.js &                                     # start server first
node test/preview.js file.md --screenshot /tmp/out.png --wait 5000
node test/preview.js file.md                          # opens browser, stays open for inspection
```

Use this instead of `sdoc file.md` when you need to verify that code changes are reflected visually. The `--wait` flag controls how long to wait for Chart.js CDN load (default 4000ms).
