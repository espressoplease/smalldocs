#!/usr/bin/env bash
# Local release rehearsal for sdocs-dev.
#
# Builds a real tarball with `npm pack`, installs it into a sandboxed
# npm prefix (so postinstall fires), and seeds two sandbox HOMEs - one
# for the fresh-install flow and one for the v=2 -> v=3 upgrade flow.
#
# Usage:
#   test/release-rehearsal.sh           # set up + print next steps
#   test/release-rehearsal.sh --cleanup # remove sandbox + repo tarball

set -euo pipefail

ROOT=/tmp/sdoc-rehearsal

cleanup() {
  echo "Removing $ROOT and any sdocs-dev-*.tgz from repo root..."
  rm -rf "$ROOT"
  rm -f sdocs-dev-*.tgz
  echo "Done."
}

if [ "${1:-}" = "--cleanup" ]; then cleanup; exit 0; fi

if [ ! -f package.json ] || ! grep -q '"name": "sdocs-dev"' package.json; then
  echo "Run from the sdocs-dev repo root (or worktree)." >&2
  exit 1
fi

VERSION=$(node -p "require('./package.json').version")
TARBALL="sdocs-dev-${VERSION}.tgz"

echo "==> Building tarball (sdocs-dev ${VERSION})"
rm -f sdocs-dev-*.tgz
npm pack --silent >/dev/null
[ -f "$TARBALL" ] || { echo "tarball missing: $TARBALL"; exit 1; }

echo "==> Resetting sandbox at $ROOT"
rm -rf "$ROOT"
mkdir -p "$ROOT/npm"
mkdir -p "$ROOT/home-fresh/.claude" "$ROOT/home-fresh/.codex"
mkdir -p "$ROOT/home-upgrade/.claude" "$ROOT/home-upgrade/.sdocs"

echo "==> Installing tarball into sandbox prefix (postinstall fires below)"
echo "----------------------------------------"
# --foreground-scripts streams lifecycle script output to stdout. Without
# it, npm runs postinstall in the background and discards its output, so
# the SDocs install hint would appear silently.
npm install --foreground-scripts --prefix "$ROOT/npm" -g "./$TARBALL" 2>&1 | sed 's/^/  /'
echo "----------------------------------------"

echo "==> Seeding upgrade fixture (legacy v=2 block + pre-1.5.0 setup state)"
cat > "$ROOT/home-upgrade/.claude/CLAUDE.md" <<'CLAUDE_EOF'
# Existing user rules

Some pre-existing content above the SDocs block.

<!-- sdocs-agent-block -->
## SDocs

SDocs (sdocs.dev) renders markdown with clean styling you can adjust.
Content lives in the URL hash - nothing hits a server.

Use it (or offer it) when the user wants to read, share, or export a `.md` file.
Also handy for copying specific code - SDocs code blocks have copy buttons.

The `sdoc` CLI is installed globally:
- `sdoc file.md` - open styled in browser (great for easy reading).
- `sdoc share file.md` - copy shareable URL to clipboard.
- `sdoc schema` - how to adjust all stylable properties (fonts, colors, spacing).
- `sdoc charts` - chart types, JSON format, and styling. Charts render via Chart.js from ```chart code blocks.
- `sdoc --help` - full usage.

Source: https://github.com/JoshInLisbon/SDocs
CLAUDE_EOF

cat > "$ROOT/home-upgrade/.sdocs/setup.json" <<'STATE_EOF'
{
  "setupCompleted": "2026-04-15T12:00:00Z",
  "writtenTo": ["/Users/x/.claude/CLAUDE.md"],
  "declined": false
}
STATE_EOF

cat > "$ROOT/test.md" <<'MD_EOF'
# Rehearsal test

A throwaway markdown file. `sdoc share` against this triggers the
file-handling path, which runs the auto-refresh check.
MD_EOF

cat <<MSG

Sandbox ready.

============== 1) Fresh-install rehearsal ==============

  HOME=$ROOT/home-fresh $ROOT/npm/bin/sdoc setup

You should see the three-prompt setup wizard:
  - Prompt 1: write the SDocs block (with reason + examples)
  - Prompt 2: keep block updated on future sdoc upgrades
  - Prompt 3: auto-install sdoc updates

Then inspect:
  cat $ROOT/home-fresh/.claude/CLAUDE.md
  cat $ROOT/home-fresh/.sdocs/setup.json

============== 2) Upgrade rehearsal (v=2 -> v=3) ==============

  HOME=$ROOT/home-upgrade $ROOT/npm/bin/sdoc share $ROOT/test.md

Expected output includes the auto-refresh notice:
  ✓ SDocs agent block updated to v3 in 1 file
    Changes: https://sdocs.dev/agent-changes#v3

\`sdoc share\` copies a URL to your real clipboard. Cosmetic.

Then inspect:
  cat $ROOT/home-upgrade/.claude/CLAUDE.md
  cat $ROOT/home-upgrade/.sdocs/setup.json

The CLAUDE.md should now have bookend markers around the v=3 body
(new chart wording, "prefer sdoc over sdoc share" paragraph, plain
hyphens). The pre-1.5.0 setup.json should be migrated in place to
schemaVersion 1 with autoRefreshAgentFiles=true.

============== Cleanup ==============

  test/release-rehearsal.sh --cleanup
MSG
