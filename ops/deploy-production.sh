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

rollback_release() {
  if [ -n "$previous_release" ]; then
    sudo ln -sfn "$previous_release" /opt/smalldocs/current
  fi
  if [ "$unit_changed" -eq 1 ] && sudo test -f "$unit_backup"; then
    sudo cp "$unit_backup" "$unit_target"
    sudo systemctl daemon-reload
  fi
  sudo systemctl restart smalldocs || true
}

sudo mkdir -p "$release_dir"
sudo tar -xzf "$remote_archive" -C "$release_dir"
sudo rm -f "$remote_archive"
sudo mkdir -p "$release_dir/.git"
printf '%s\n' "$release_commit" | sudo tee "$release_dir/.git/HEAD" >/dev/null
sudo env PATH=/usr/local/bin:/usr/bin:/bin npm --prefix "$release_dir" ci --omit=dev
sudo chown -R root:root "$release_dir"
sudo chmod -R go-w "$release_dir"
sudo systemd-analyze verify "$unit_source"
if ! sudo cmp -s "$unit_source" "$unit_target"; then
  sudo cp "$unit_target" "$unit_backup"
  sudo install -o root -g root -m 0644 "$unit_source" "$unit_target"
  sudo systemctl daemon-reload
  unit_changed=1
fi
sudo ln -sfn "$release_dir" /opt/smalldocs/current

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

echo "Deployed $release_commit"
REMOTE
