#!/bin/sh
set -eu

: "${SDOCS_BACKUP_BUCKET:?SDOCS_BACKUP_BUCKET is required}"
: "${SDOCS_BACKUP_REGION:?SDOCS_BACKUP_REGION is required}"
: "${SDOCS_BACKUP_ACCOUNT_ID:?SDOCS_BACKUP_ACCOUNT_ID is required}"

local_retention_days=${SDOCS_BACKUP_LOCAL_RETENTION_DAYS:-7}
case "$local_retention_days" in
  ''|*[!0-9]*|0) echo "SDOCS_BACKUP_LOCAL_RETENTION_DAYS must be a positive integer" >&2; exit 1 ;;
esac

backup_timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_day=$(date -u +%Y/%m/%d)
backup_host=$(hostname)
release_path=$(readlink -f /opt/smalldocs/current)
release_commit=$(basename "$release_path")
backup_name="smalldocs-$backup_timestamp-$release_commit"
backup_archive="/var/backups/smalldocs/$backup_name.tar.gz"
backup_checksum="$backup_archive.sha256"
backup_work=$(mktemp -d /var/backups/smalldocs/run.XXXXXX)
service_stopped=0

restart_service() {
  if [ "$service_stopped" -eq 1 ]; then
    systemctl start smalldocs || true
    service_stopped=0
  fi
}

cleanup() {
  restart_service
  rm -rf "$backup_work"
}

trap cleanup EXIT HUP INT TERM

printf '%s\n' \
  "created_at=$backup_timestamp" \
  "host=$backup_host" \
  "release_commit=$release_commit" \
  "node_version=$(node --version)" \
  > "$backup_work/metadata.txt"
chmod 0600 "$backup_work/metadata.txt"

systemctl stop smalldocs
service_stopped=1

tar -C / -czf "$backup_archive" \
  var/lib/smalldocs \
  etc/smalldocs/smalldocs.env \
  -C "$backup_work" metadata.txt
chmod 0600 "$backup_archive"
(cd "$(dirname "$backup_archive")" && sha256sum "$(basename "$backup_archive")") \
  > "$backup_checksum"
chmod 0600 "$backup_checksum"

restart_service

backup_key="daily/$backup_day/$backup_name.tar.gz"
checksum_key="$backup_key.sha256"
backup_sha256=$(awk '{print $1}' "$backup_checksum")

/snap/aws-cli/current/bin/aws s3api put-object \
  --region "$SDOCS_BACKUP_REGION" \
  --bucket "$SDOCS_BACKUP_BUCKET" \
  --key "$backup_key" \
  --body "$backup_archive" \
  --checksum-algorithm SHA256 \
  --expected-bucket-owner "$SDOCS_BACKUP_ACCOUNT_ID" \
  --metadata "sha256=$backup_sha256,release=$release_commit"

/snap/aws-cli/current/bin/aws s3api put-object \
  --region "$SDOCS_BACKUP_REGION" \
  --bucket "$SDOCS_BACKUP_BUCKET" \
  --key "$checksum_key" \
  --body "$backup_checksum" \
  --checksum-algorithm SHA256 \
  --expected-bucket-owner "$SDOCS_BACKUP_ACCOUNT_ID"

node /opt/smalldocs/current/ops/backup-heartbeat.js

# The off-site copy is the recovery boundary. Keep a short local window for
# fast restores, but do not let archives accumulate indefinitely on the same
# disk as the service. Cleanup runs only after both S3 uploads have succeeded.
local_retention_minutes=$((local_retention_days * 24 * 60))
find /var/backups/smalldocs -maxdepth 1 -type f \
  \( -name 'smalldocs-*.tar.gz' -o -name 'smalldocs-*.tar.gz.sha256' \) \
  -mmin "+$local_retention_minutes" -delete

echo "Uploaded s3://$SDOCS_BACKUP_BUCKET/$backup_key"
