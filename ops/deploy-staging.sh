#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: ops/deploy-staging.sh SSH_TARGET" >&2
  exit 2
fi

deploy_target=$1
release_commit=$(git rev-parse HEAD)
remote_commit=$(git ls-remote --heads origin refs/heads/feature/cloud-foundation | cut -f1)
release_tmp=$(mktemp -d)
release_archive="$release_tmp/smalldocs-$release_commit.tar.gz"
remote_archive="/tmp/smalldocs-$release_commit.tar.gz"
public_origin=https://cloud-staging.smalldocs.org
trap 'rm -rf "$release_tmp"' EXIT

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing to deploy tracked changes that are not committed." >&2
  exit 1
fi
if [ -z "$remote_commit" ] || [ "$remote_commit" != "$release_commit" ]; then
  echo "Refusing to deploy a commit that is not the published feature/cloud-foundation tip." >&2
  exit 1
fi

git archive --format=tar.gz --output="$release_archive" "$release_commit"

scp -o BatchMode=yes -o StrictHostKeyChecking=yes \
  "$release_archive" "$deploy_target:$remote_archive"

ssh -o BatchMode=yes -o StrictHostKeyChecking=yes \
  "$deploy_target" sh -s -- "$release_commit" "$remote_archive" "$public_origin" <<'REMOTE'
set -eu
release_commit=$1
remote_archive=$2
public_origin=$3
release_dir="/opt/smalldocs/releases/$release_commit"
previous_release=$(readlink -f /opt/smalldocs/staging-current 2>/dev/null || true)
unit_source="$release_dir/ops/systemd/smalldocs-staging.service"
unit_target="/etc/systemd/system/smalldocs-staging.service"
unit_backup="/etc/systemd/system/smalldocs-staging.service.smalldocs-deploy-backup"
unit_changed=0

rollback_staging() {
  if [ -n "$previous_release" ]; then
    sudo ln -sfn "$previous_release" /opt/smalldocs/staging-current
  fi
  if [ "$unit_changed" -eq 1 ] && sudo test -f "$unit_backup"; then
    sudo cp "$unit_backup" "$unit_target"
    sudo systemctl daemon-reload
  fi
  sudo systemctl restart smalldocs-staging || true
}

if sudo test -e "$release_dir"; then
  echo "The immutable staging release already exists: $release_dir" >&2
  exit 1
fi
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
sudo ln -sfn "$release_dir" /opt/smalldocs/staging-current

if ! sudo systemctl restart smalldocs-staging; then
  rollback_staging
  exit 1
fi

healthy=0
attempt=0
while [ "$attempt" -lt 20 ]; do
  if curl -fsS --max-time 2 http://127.0.0.1:3004/version-check >/dev/null; then
    healthy=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ "$healthy" -ne 1 ]; then
  sudo journalctl -u smalldocs-staging -n 60 --no-pager >&2
  rollback_staging
  exit 1
fi
running_commit=$(curl -fsSI http://127.0.0.1:3004/public/sdocs-cloud-prototype.js |
  sed -n 's/^[Xx]-[Ss]docs-[Cc]ommit:[[:space:]]*//p' | tr -d '\r')
if [ "$running_commit" != "$release_commit" ]; then
  echo "Staging commit check failed: $running_commit" >&2
  rollback_staging
  exit 1
fi
public_commit=$(curl -fsSI --max-time 10 \
  --resolve cloud-staging.smalldocs.org:443:127.0.0.1 \
  "$public_origin/public/sdocs-cloud-prototype.js" |
  sed -n 's/^[Xx]-[Ss]docs-[Cc]ommit:[[:space:]]*//p' | tr -d '\r')
if [ "$public_commit" != "$release_commit" ]; then
  echo "Public staging commit check failed: $public_commit" >&2
  rollback_staging
  exit 1
fi
if ! curl -fsS --max-time 10 \
  --resolve cloud-staging.smalldocs.org:443:127.0.0.1 \
  "$public_origin/version-check" >/dev/null; then
  rollback_staging
  exit 1
fi
printf 'Deployed staging commit %s\n' "$release_commit"
REMOTE

public_commit=$(curl -fsSI --max-time 10 \
  "$public_origin/public/sdocs-cloud-prototype.js" |
  sed -n 's/^[Xx]-[Ss]docs-[Cc]ommit:[[:space:]]*//p' | tr -d '\r')
if [ "$public_commit" != "$release_commit" ]; then
  echo "Public staging commit check failed: $public_commit" >&2
  exit 1
fi
curl -fsS --max-time 10 "$public_origin/version-check" >/dev/null
printf 'Verified %s at %s\n' "$release_commit" "$public_origin"
