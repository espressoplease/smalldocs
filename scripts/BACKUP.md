# SDocs backups

Nightly SQLite hot-backup of `analytics.db` and `short_links.db`, gzipped, uploaded to Cloudflare R2. A bucket lifecycle rule deletes objects after 7 days. Runs as a systemd timer on the Hetzner box.

## What's in this folder

| File | Role |
|------|------|
| `backup.sh` | Runs `sqlite3 .backup`, gzips, uploads to R2. |
| `sdocs-backup.service` | systemd one-shot that invokes `backup.sh`. |
| `sdocs-backup.timer` | systemd timer, fires `sdocs-backup.service` daily at 03:12 UTC. |
| `BACKUP.md` | This document. |

## One-time R2 setup (Cloudflare dashboard)

1. R2 > **Create bucket**
   - Name: `sdocs-backups`
   - Location hint: **North America (East)** - ENAM. Different region from Hetzner FSN gives disaster-recovery separation. If you prefer lower latency, pick WEUR instead.
2. Bucket > **Settings** > **Object lifecycle rules** > **Add rule**
   - Name: `delete-after-7-days`
   - Prefix: leave blank (applies to whole bucket)
   - Expire objects: **7 days after upload**
3. R2 > **Manage R2 API Tokens** > **Create API token**
   - Permissions: **Object Read & Write**
   - Specify bucket: `sdocs-backups` (scope the token to this bucket only)
   - Save the Access Key ID, Secret Access Key, and the endpoint URL `https://<account-id>.r2.cloudflarestorage.com`

## One-time server setup

```bash
# 1. Install dependencies
sudo apt-get update && sudo apt-get install -y sqlite3 awscli

# 2. Create env file with R2 credentials (outside the repo).
sudo -u deploy tee /home/deploy/apps/sdocs/.env.backup > /dev/null <<'EOF'
AWS_ACCESS_KEY_ID=replace_me
AWS_SECRET_ACCESS_KEY=replace_me
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET=sdocs-backups
EOF
sudo chmod 600 /home/deploy/apps/sdocs/.env.backup
sudo chown deploy:deploy /home/deploy/apps/sdocs/.env.backup

# 3. Install the systemd units and enable the timer.
sudo cp /home/deploy/apps/sdocs/scripts/sdocs-backup.service /etc/systemd/system/
sudo cp /home/deploy/apps/sdocs/scripts/sdocs-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sdocs-backup.timer
```

## Verify

```bash
# Next scheduled run and last trigger
systemctl list-timers sdocs-backup.timer

# One-off run right now (first-time sanity check)
sudo systemctl start sdocs-backup.service
journalctl -u sdocs-backup.service -n 100 --no-pager

# Confirm objects landed in R2
aws s3 ls s3://sdocs-backups/ --recursive \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com
```

First run should produce `analytics/analytics-*.db.gz` and `short_links/short_links-*.db.gz`. If the unit fails, `systemctl status sdocs-backup.service` will mark it failed and the journal has the log.

## Restore

```bash
# Stop the app so nothing writes during the swap
sudo systemctl stop sdocs

cd /home/deploy/apps/sdocs

# Download the snapshot you want
aws s3 cp \
  s3://sdocs-backups/short_links/short_links-2026-04-20T03-12-00Z.db.gz . \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com

gunzip short_links-2026-04-20T03-12-00Z.db.gz
mv short_links.db short_links.db.corrupt   # keep the old one for now
mv short_links-2026-04-20T03-12-00Z.db short_links.db

sudo systemctl start sdocs
```

Same procedure for `analytics.db`.

## What this does not do

- **Point-in-time recovery.** You can only restore to one of the daily snapshots, not to arbitrary timestamps. Fine for this scale; real PITR requires WAL-shipping or a managed DB.
- **Failure alerting.** No email or push. A failed run shows up in `systemctl status sdocs-backup.service` and `journalctl -u sdocs-backup.service`. To add a heartbeat, sign up at healthchecks.io, pick a daily schedule, and `curl -fsS -o /dev/null <ping-url>` at the end of `backup.sh`; you'll get notified when it stops pinging.
- **Cross-account isolation.** Everything lives in one Cloudflare account. A full account compromise loses primary DBs and backups together. To harden against that, add a second destination (e.g. a Hetzner Storage Box via `rsync`) as a cold copy.
