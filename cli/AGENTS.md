# CLI (`sdoc` / `sdocs-dev`)

Read this file when working on `cli/`, `install.sh`, the published npm tarball, or the installed agent skill.

## Layout

- `cli/package.json` (`name: sdocs-dev`) - published to npm. Zero runtime dependencies.
- `cli/bin/sdocs-dev.js` - the `sdoc` command (UMD-shared modules under `cli/shared/`).
- `cli/bin/sdocs-postinstall.js` - global-install hint, no-op otherwise.
- `cli/lib/` - CLI runtime modules (`setup.js`, `agent-block.js`, `agent-files.js`, `update-check.js`, `constants.js`, `io.js`, etc.).
- `cli/shared/` - real files for the four UMD modules shared with the browser (`sdocs-yaml.js`, `sdocs-styles.js`, `sdocs-slugify.js`, `sdocs-slide-stdlib.js`), symlinked back into `public/`.

## Running the local CLI (not the global install)

The globally-installed `sdoc` is the published release and lags this repo. To exercise the CLI you are editing, run it straight from source:

```bash
node cli/bin/sdocs-dev.js <file.md> [args]   # the `sdoc` command, from this branch
node cli/bin/sdocs-dev.js --help             # same flags as the installed sdoc
```

To preview a doc against a **local** dev server - so it renders this branch's frontend (new modules, CSS) rather than production `smalldocs.org` - start a server and point the CLI at it with `--url`:

```bash
PORT=3210 SDOCS_DEV=1 node server.js                              # serve this branch's frontend
node cli/bin/sdocs-dev.js file.md --url http://localhost:3210     # open it against that server
```

`--url <base>` (or the `SDOCS_URL` env var) overrides the default base (`https://smalldocs.org`). The document still travels in the URL hash; the local server only serves the HTML/JS that renders it. This is the way to see in-progress frontend features (e.g. a new fenced-block type) actually render, since the installed CLI and production both point at the released frontend.

## Agent skill

`sdoc setup` installs a discoverable **skill** (a `SKILL.md`) instead of pasting an always-on block into agent config files. The skill carries a short `description` preamble that stays in agent context and a full reference body that loads on demand via the agent's `skill` tool, so it costs almost nothing until an agent reaches for it.

- Canonical copy: `~/.agents/skills/smalldocs/SKILL.md` (the single source of truth).
- Every other supported agent gets a relative symlink from its own skills directory into the canonical dir. Universal agents (whose discovery path *is* `~/.agents/skills` - opencode, Codex, Gemini CLI, Cursor, ...) pick up the canonical copy directly and are skipped to avoid double-listing.
- The agent table is `resolveSkillAgents()` in `cli/lib/agent-block.js` and is derived from `vercel-labs/skills/src/agents.ts`. Refresh it from upstream when new agents land.
- The skill body is `SKILL_BODY` in the same module; `formatSkill(v)` emits frontmatter + a `<!-- sdocs-skill: v=N -->` version comment + body. `readSkillVersion()` parses it back for refresh.
- `syncAgentSkill()` in `cli/lib/agent-files.js` does the full sync: write/refresh the canonical skill, symlink every detected non-universal agent, and strip any legacy always-on block from the historical config files.

### Release checklist when the skill changes

1. Bump `SKILL_VERSION` in `cli/lib/agent-block.js`.
2. Set `SKILL_REASON` to a one-line summary of what changed.
3. Prepend a new `## v<N>` section to `public/agent-changes.md` with the reason and the skill body.
4. Reword the setup copy in `public/sdoc.md` if the install flow changed.
5. Get user sign-off on the skill copy before shipping (see root `AGENTS.md`).
6. After release: `git tag v<X.Y.Z> && git push origin v<X.Y.Z>` so the source-diff URL printed during auto-install resolves.

Re-run the CLI setup scenarios in `test/test-setup-scenarios.js` (documented in `test/AGENTS.md`) whenever touching `setup.js`, `agent-block.js`, `agent-files.js`, `constants.js`, or setup/refresh flags in `io.js`.

### Legacy block migration

Before the skill model, `sdoc setup` wrote a `## SmallDocs` block wrapped in `<!-- sdocs-agent-block:start v=N -->` / `<!-- sdocs-agent-block:end -->` into a handful of config files. `findBookendedBlock()` / `findLegacyBlock()` in `cli/lib/agent-block.js` detect those (and the pre-1.5.0 open-only `<!-- sdocs-agent-block -->` form, recognised by its `Source: https://github.com/JoshInLisbon/SDocs` terminator). `removeBlockContent()` strips them, preserving surrounding user text. `legacyBlockTargets()` is the fixed list of six files that ever received a block: `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`, `~/.config/opencode/AGENTS.md`, `~/.pi/agent/AGENTS.md`, `~/.codewhale/AGENTS.md`. Once the install base has rotated through the skill model, the block-detection code can be removed.

## CLI state

All CLI-side state lives under `~/.sdocs/`:

- `styles.yaml` - user-editable default styles
- `update-check.json` - daily npm version cache
- `setup.json` - agent setup tracking. Schema v1 fields (added in 1.5.0): `schemaVersion`, `setupCompleted`, `writtenTo`, `declined`, `autoRefreshAgentFiles`, `autoInstallUpdates`, `lastRunVersion`. Pre-1.5.0 state files are migrated transparently on first read by `migrateSetupState()`.

When the CLI was installed via the install script (see "Installer" below), `~/.sdocs/` also holds `cli/` (the unpacked npm tarball) and `bin/sdoc` (a symlink onto `cli/bin/sdocs-dev.js`).

## Installer

`install.sh` (repo root) is the URL-based installer: `curl -fsSL https://smalldocs.org/install | sh`. The server serves it at the apex path `/install` (the URL drops the `.sh` for a cleaner one-liner; the file on disk keeps its extension so `serveFile` picks the right MIME). It resolves the latest version from the npm registry, downloads the `sdocs-dev` tarball, unpacks it into `~/.sdocs/cli`, symlinks `sdoc` into `~/.sdocs/bin`, and adds that directory to PATH via the shell rc. It needs Node and curl/wget present; it never uses npm and never needs root, so it cannot hit the EACCES error a root-owned npm prefix causes. Re-running it upgrades in place. npm (`npm i -g sdocs-dev`) stays as a fallback, so the package name keeps its install history.

The CLI detects which way it was installed (`isUrlInstall()` in `cli/lib/update-check.js`: true when the package root resolves under `~/.sdocs/cli`). Every upgrade path - `sdoc upgrade`, the daily auto-update prompt, the silent auto-install, the `sdoc setup` consent copy - branches through `upgradeCommand()`: URL installs re-run `install.sh` (via `INSTALL_SH_URL` in `constants.js`), npm installs run `npm i -g sdocs-dev@latest`. If you change the installed layout in `install.sh`, update `isUrlInstall()` to match.

## Published npm tarball

`sdocs-dev` on npm is published from `cli/`. Its `files` array is `["bin/", "lib/", "shared/"]`, so the tarball contains `cli/bin/sdocs-dev.js`, `cli/bin/sdocs-postinstall.js`, every runtime module under `cli/lib/`, and the four browser-shared modules under `cli/shared/`. `lib/` is mandatory: the thin `bin/sdocs-dev.js` entrypoint `require`s `../lib/*` at startup, so a tarball without it installs a CLI that crashes on first run. Everything else - `server.js`, `short-links/`, `feedback/`, `analytics/`, all of `public/` (including the symlinks to `cli/shared/`), `cli/AGENTS.md`, and the tests - belongs outside the tarball and never reaches a user via `npm i -g`. (`install.sh` smoke-checks both `bin/sdocs-dev.js` and `lib/constants.js` after unpacking, so a future `files` regression fails the install instead of shipping a broken CLI.)

The symlinks under `public/` resolve into `cli/`, but `npm pack` only follows files that already live under the package root, so the published tarball contains the four shared modules as real files and no symlinks.

**Why the split exists:**

Before the split, both programs shared a single root `package.json`. `better-sqlite3` and friends had to live in `devDependencies` because shipping them with `npm i -g sdocs-dev` would have forced every CLI user to build a native module they never load. That meant `npm install --production` on the server skipped them and the server crashed at boot. The split gives each program its own dependency list and removes the footgun entirely.

**Distribution rule for the two `package.json` files:**

- **Root `package.json` (`sdocs-server`, `"private": true`)**: `dependencies` for everything `server.js` and the server-side libraries load at runtime (`better-sqlite3`, `marked`, `brotli`...). `devDependencies` for tests (`@playwright/test`). `npm install` at root is now safe under any flag.
- **`cli/package.json` (`sdocs-dev`)**: no `dependencies`, no `devDependencies`. The CLI is plain Node standard library only, so `npm i -g sdocs-dev` pulls nothing and compiles nothing. Before adding any runtime dep here, audit standard-library options first. The supply-chain story in `public/agent-evaluation.md` (and the byte-comparison fallback for pre-provenance versions) leans on the CLI being auditable code with no third-party runtime surface.
- The CLI's four shared modules are the only files that span the boundary. They live in `cli/shared/` (so `npm pack` ships them) and the browser sees them via symlinks under `public/` (so the trust manifest and cache-busting hash keep covering them automatically).

When in doubt: if a runtime require lives in `cli/bin/` or `cli/lib/`, its dep goes in `cli/package.json`. Everything else goes in the root.
