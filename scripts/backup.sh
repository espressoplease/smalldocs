#!/usr/bin/env bash
# Nightly SDocs backup: sqlite hot-copy of analytics.db + short_links.db,
# gzip, upload to Cloudflare R2.
#
# Retention (delete after 7 days) is handled by an R2 lifecycle rule on the
# bucket, not by this script. See scripts/BACKUP.md.
#
# Env file: /home/deploy/apps/sdocs/.env.backup
#   AWS_ACCESS_KEY_ID      = R2 API token Access Key ID
#   AWS_SECRET_ACCESS_KEY  = R2 API token Secret
#   R2_ENDPOINT            = https://<account-id>.r2.cloudflarestorage.com
#   R2_BUCKET              = sdocs-backups
#
# Idempotent and safe to re-run by hand:
#   /home/deploy/apps/sdocs/scripts/backup.sh

set -euo pipefail

APP_DIR=${APP_DIR:-/home/deploy/apps/sdocs}
STAGE_DIR=${STAGE_DIR:-/tmp/sdocs-backup}
ENV_FILE=${ENV_FILE:-$APP_DIR/.env.backup}

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi

: "${AWS_ACCESS_KEY_ID:?missing in $ENV_FILE}"
: "${AWS_SECRET_ACCESS_KEY:?missing in $ENV_FILE}"
: "${R2_ENDPOINT:?missing in $ENV_FILE}"
: "${R2_BUCKET:?missing in $ENV_FILE}"

# R2 accepts any region string; aws-cli requires one to be set.
export AWS_DEFAULT_REGION=auto
export AWS_EC2_METADATA_DISABLED=true

DATE=$(date -u +%Y-%m-%dT%H-%M-%SZ)

mkdir -p "$STAGE_DIR"
trap 'rm -rf "$STAGE_DIR"' EXIT

for db in analytics.db short_links.db; do
  src="$APP_DIR/$db"
  if [ ! -f "$src" ]; then
    echo "skip $db (not present)"
    continue
  fi
  stem="${db%.db}"
  name="${stem}-${DATE}.db"
  stage="${STAGE_DIR}/${name}"
  echo "backing up $db"
  sqlite3 "$src" ".backup '$stage'"
  gzip -f "$stage"
  aws s3 cp "${stage}.gz" "s3://${R2_BUCKET}/${stem}/${name}.gz" \
    --endpoint-url "$R2_ENDPOINT" \
    --only-show-errors
  echo "uploaded ${stem}/${name}.gz"
done

echo "done"
