#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
  echo "Usage: ops/deploy-production.sh USER@HOST SSH_KEY KNOWN_HOSTS" >&2
  exit 2
fi

deploy_target=$1
deploy_key=$2
known_hosts=$3
release_commit=$(git rev-parse HEAD)
release_tmp=$(mktemp -d)
release_archive="$release_tmp/smalldocs-$release_commit.tar.gz"
remote_archive="/tmp/smalldocs-$release_commit.tar.gz"
trap 'rm -rf "$release_tmp"' EXIT

git archive --format=tar.gz --output="$release_archive" HEAD

scp -i "$deploy_key" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$known_hosts" \
  "$release_archive" "$deploy_target:$remote_archive"

ssh -i "$deploy_key" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$known_hosts" \
  "$deploy_target" sh -s -- "$release_commit" "$remote_archive" <<'REMOTE'
set -eu
release_commit=$1
remote_archive=$2
release_dir="/opt/smalldocs/releases/$release_commit"
previous_release=$(readlink -f /opt/smalldocs/current 2>/dev/null || true)
unit_source="$release_dir/ops/systemd/smalldocs.service"
unit_target="/etc/systemd/system/smalldocs.service"
unit_backup="/etc/systemd/system/smalldocs.service.smalldocs-deploy-backup"
unit_changed=0
compiler_unit="/etc/systemd/system/smalldocs-compiler.service"
compiler_backup="$compiler_unit.smalldocs-deploy-backup"
compiler_existed=0
compiler_changed=0

cleanup_remote_archive() {
  sudo rm -f -- "$remote_archive"
}
trap cleanup_remote_archive EXIT HUP INT TERM

rollback_release() {
  if [ -n "$previous_release" ]; then
    sudo ln -sfn "$previous_release" /opt/smalldocs/current
  fi
  if [ "$unit_changed" -eq 1 ] && sudo test -f "$unit_backup"; then
    sudo cp "$unit_backup" "$unit_target"
    sudo systemctl daemon-reload
  fi
  if [ "$compiler_changed" -eq 1 ]; then
    if [ "$compiler_existed" -eq 1 ]; then
      sudo cp "$compiler_backup" "$compiler_unit"
    else
      sudo systemctl disable --now smalldocs-compiler || true
      sudo rm -f "$compiler_unit"
    fi
    sudo systemctl daemon-reload
  fi
  if [ -f "$previous_release/ops/publication-compiler-worker.js" ]; then
    sudo systemctl restart smalldocs-compiler || true
  else
    sudo systemctl stop smalldocs-compiler || true
  fi
  sudo systemctl restart smalldocs || true
}

# Staging may already have built this immutable release on the shared host.
if ! sudo test -e "$release_dir"; then
  sudo mkdir -p "$release_dir"
  sudo tar -xzf "$remote_archive" -C "$release_dir"
  sudo mkdir -p "$release_dir/.git"
  printf '%s\n' "$release_commit" | sudo tee "$release_dir/.git/HEAD" >/dev/null
  sudo env PATH=/usr/local/bin:/usr/bin:/bin npm --prefix "$release_dir" ci --omit=dev
  sudo chown -R root:root "$release_dir"
  sudo chmod -R go-w "$release_dir"
else
  existing_commit=$(sudo cat "$release_dir/.git/HEAD")
  if [ "$existing_commit" != "$release_commit" ]; then
    echo "Existing release does not match the requested commit." >&2
    exit 1
  fi
fi
sudo rm -f -- "$remote_archive"
sudo sh "$release_dir/ops/install-publication-browser.sh"
if ! id smalldocs-compiler >/dev/null 2>&1; then
  sudo useradd --system --gid smalldocs --home-dir /var/cache/smalldocs-compiler --shell /usr/sbin/nologin smalldocs-compiler
fi
sudo systemd-analyze verify "$release_dir/ops/systemd/smalldocs-compiler.service"
if sudo test -f "$compiler_unit"; then
  compiler_existed=1
  sudo cp "$compiler_unit" "$compiler_backup"
fi
sudo install -o root -g root -m 0644 "$release_dir/ops/systemd/smalldocs-compiler.service" "$compiler_unit"
compiler_changed=1
sudo systemctl daemon-reload
sudo systemd-analyze verify "$unit_source"
if ! sudo cmp -s "$unit_source" "$unit_target"; then
  sudo cp "$unit_target" "$unit_backup"
  sudo install -o root -g root -m 0644 "$unit_source" "$unit_target"
  sudo systemctl daemon-reload
  unit_changed=1
fi
sudo ln -sfn "$release_dir" /opt/smalldocs/current

sudo systemctl enable smalldocs-compiler >/dev/null
if ! sudo systemctl restart smalldocs-compiler; then rollback_release; exit 1; fi
compiler_attempt=0
while ! sudo test -S /run/smalldocs-compiler/worker.sock; do
  compiler_attempt=$((compiler_attempt + 1))
  if [ "$compiler_attempt" -ge 20 ]; then rollback_release; exit 1; fi
  sleep 1
done
if ! sudo systemctl restart smalldocs; then
  rollback_release
  exit 1
fi

healthy=0
attempt=0
while [ "$attempt" -lt 20 ]; do
  if curl -fsS --max-time 2 http://127.0.0.1:3003/ >/dev/null; then
    healthy=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done

if [ "$healthy" -ne 1 ]; then
  sudo journalctl -u smalldocs -n 40 --no-pager >&2
  rollback_release
  exit 1
fi

sudo sh /opt/smalldocs/current/ops/install-production-monitor.sh /opt/smalldocs/current

if [ -n "$previous_release" ] && [ "$previous_release" != "$release_dir" ]; then
  sudo ln -sfn "$previous_release" /opt/smalldocs/previous
fi
sudo sh "$release_dir/ops/prune-releases.sh" \
  /opt/smalldocs/releases \
  /opt/smalldocs/current \
  /opt/smalldocs/current \
  /opt/smalldocs/previous \
  /opt/smalldocs/staging-current \
  /opt/smalldocs/staging-previous

echo "Deployed $release_commit"
REMOTE
