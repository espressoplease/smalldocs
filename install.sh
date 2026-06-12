#!/bin/sh
# SmallDocs CLI installer.
#
#   curl -fsSL https://smalldocs.org/install | sh
#
# Installs the `sdoc` command under ~/.sdocs, a directory you own. It never
# needs root and never writes to npm's global folder, so it cannot hit the
# EACCES permission error that a root-owned npm prefix causes.
#
# Re-running this script upgrades an existing install in place.
#
# Requirements: node (to run sdoc) and curl or wget (to download it).

set -eu

SDOCS_HOME="${SDOCS_HOME:-$HOME/.sdocs}"
CLI_DIR="$SDOCS_HOME/cli"
BIN_DIR="$SDOCS_HOME/bin"
LAUNCHER="$BIN_DIR/sdoc"
REGISTRY="https://registry.npmjs.org/sdocs-dev"

# Preview/test override. When SDOCS_TARBALL_URL is set (e.g. a file:// path to
# a locally `npm pack`ed tarball), the installer skips the npm registry lookup
# and installs that tarball instead. SDOCS_VERSION names it in log output.
# Both are unset in normal use, so production installs are unaffected.
SDOCS_TARBALL_URL="${SDOCS_TARBALL_URL:-}"
SDOCS_VERSION="${SDOCS_VERSION:-}"

err() { printf 'sdoc install: %s\n' "$1" >&2; }

# 1. Node is required to run sdoc.
if ! command -v node >/dev/null 2>&1; then
  err "Node.js was not found on your PATH."
  err "Install Node from https://nodejs.org (or via nvm, fnm, or Homebrew), then re-run this."
  exit 1
fi

# 2. A downloader is required to fetch the package.
if command -v curl >/dev/null 2>&1; then
  fetch()      { curl -fsSL "$1"; }
  fetch_file() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch()      { wget -qO- "$1"; }
  fetch_file() { wget -qO "$2" "$1"; }
else
  err "Need curl or wget to download sdoc."
  exit 1
fi

# 3. Resolve the tarball to install: an override URL when given, otherwise the
#    latest version from the npm registry (node parses the JSON).
if [ -n "$SDOCS_TARBALL_URL" ]; then
  VERSION="${SDOCS_VERSION:-local}"
  TARBALL_URL="$SDOCS_TARBALL_URL"
  printf 'Installing sdoc from %s...\n' "$SDOCS_TARBALL_URL"
else
  printf 'Resolving the latest sdoc version...\n'
  VERSION=$(fetch "$REGISTRY/latest" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{process.stdout.write(String(JSON.parse(s).version||""))}catch(e){}})')
  if [ -z "${VERSION:-}" ]; then
    err "Could not resolve the latest version from the npm registry."
    exit 1
  fi
  TARBALL_URL="$REGISTRY/-/sdocs-dev-$VERSION.tgz"
  printf 'Installing sdoc %s...\n' "$VERSION"
fi

# 4. Download and unpack the package into a temp directory.
TMP=$(mktemp -d 2>/dev/null || mktemp -d -t sdocs)
trap 'rm -rf "$TMP"' EXIT INT TERM

fetch_file "$TARBALL_URL" "$TMP/sdoc.tgz"
mkdir -p "$TMP/cli"
# npm tarballs wrap everything in a top-level package/ directory; strip it.
tar -xzf "$TMP/sdoc.tgz" -C "$TMP/cli" --strip-components=1

# The CLI needs its launcher plus the lib/ modules it requires at runtime.
# Checking both catches a tarball that shipped without lib/ (a files-array
# regression) before we install a CLI that would crash on first run.
if [ ! -f "$TMP/cli/bin/sdocs-dev.js" ] || [ ! -f "$TMP/cli/lib/constants.js" ]; then
  err "The downloaded package did not contain the expected files."
  exit 1
fi

# 5. Swap the new copy into place under ~/.sdocs/cli.
mkdir -p "$SDOCS_HOME"
rm -rf "$CLI_DIR"
mv "$TMP/cli" "$CLI_DIR"
chmod +x "$CLI_DIR/bin/sdocs-dev.js"

# 6. Link the `sdoc` command into ~/.sdocs/bin.
mkdir -p "$BIN_DIR"
ln -sf "$CLI_DIR/bin/sdocs-dev.js" "$LAUNCHER"

# 7. Put ~/.sdocs/bin on PATH via the shell's startup file.
MARKER='# added by the sdoc installer'
PATH_LINE='export PATH="$HOME/.sdocs/bin:$PATH"'

add_to_rc() {
  rc="$1"
  line="$2"
  if [ -f "$rc" ] && grep -qF "$MARKER" "$rc" 2>/dev/null; then
    return 0
  fi
  printf '\n%s\n%s\n' "$MARKER" "$line" >> "$rc"
  printf 'Added ~/.sdocs/bin to PATH in %s\n' "$rc"
}

case "${SHELL:-}" in
  */fish)
    FISH_RC="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"
    mkdir -p "$(dirname "$FISH_RC")"
    add_to_rc "$FISH_RC" 'set -gx PATH $HOME/.sdocs/bin $PATH'
    ;;
  */zsh)
    add_to_rc "$HOME/.zshrc" "$PATH_LINE"
    ;;
  */bash)
    add_to_rc "$HOME/.bashrc" "$PATH_LINE"
    [ -f "$HOME/.bash_profile" ] && add_to_rc "$HOME/.bash_profile" "$PATH_LINE"
    ;;
  *)
    add_to_rc "$HOME/.profile" "$PATH_LINE"
    ;;
esac

# 8. Report.
case ":${PATH}:" in
  *":$BIN_DIR:"*) ON_PATH=1 ;;
  *)              ON_PATH=0 ;;
esac

printf '\nsdoc %s installed to %s\n' "$VERSION" "$SDOCS_HOME"
if [ "$ON_PATH" -eq 1 ]; then
  printf 'Run `sdoc --help` to get started.\n'
else
  printf 'Restart your terminal, then run `sdoc --help` to get started.\n'
  printf 'To use it now without restarting:\n'
  printf '  export PATH="$HOME/.sdocs/bin:$PATH"\n'
fi
printf 'The first run will offer to wire SmallDocs into any coding agents you have installed.\n'
