#!/bin/sh
# Install the browser used by the isolated staging publication compiler.
set -eu
root=/opt/smalldocs-publication-browser
version=1.59.1
if [ "$(id -u)" -ne 0 ]; then echo 'Run this installer as root.' >&2; exit 1; fi
if [ ! -x "$root/chromium" ] || [ "$(cat "$root/version" 2>/dev/null || true)" != "$version" ]; then
  install -d -m 0755 "$root/tools" "$root/browsers"
  npm install --prefix "$root/tools" --ignore-scripts --no-audit --no-fund --save-exact "playwright-core@$version"
  PLAYWRIGHT_BROWSERS_PATH="$root/browsers" NEEDRESTART_MODE=l \
    node "$root/tools/node_modules/playwright-core/cli.js" install --with-deps --only-shell chromium
  browser=$(find "$root/browsers" -type f \( -name chrome-headless-shell -o -name headless_shell \) -print -quit)
  test -n "$browser"
  ln -sfn "$browser" "$root/chromium"
  printf '%s\n' "$version" > "$root/version"
  chown -R root:root "$root"
  chmod -R go-w "$root"
fi
# Ubuntu restricts user namespaces for unprofiled executables. Permit them for
# this browser binary so Chromium keeps its own sandbox enabled.
if command -v apparmor_parser >/dev/null 2>&1 && [ -d /sys/module/apparmor ]; then
  cat > /etc/apparmor.d/smalldocs-publication-browser <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>
profile smalldocs-publication-browser /opt/smalldocs-publication-browser/browsers/**/chrome-headless-shell flags=(unconfined) {
  userns,
}
PROFILE
  apparmor_parser -r /etc/apparmor.d/smalldocs-publication-browser
fi
"$root/chromium" --version
