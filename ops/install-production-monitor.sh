#!/bin/sh
set -eu

release_root=${1:-/opt/smalldocs/current}
monitor_env=/etc/smalldocs/monitor.env
journal_source="$release_root/ops/systemd/60-smalldocs-journal-retention.conf"
journal_target=/etc/systemd/journald.conf.d/60-smalldocs-journal-retention.conf
service_source="$release_root/ops/systemd/smalldocs-monitor.service"
timer_source="$release_root/ops/systemd/smalldocs-monitor.timer"

if [ "$(id -u)" -ne 0 ]; then
  echo "install-production-monitor.sh must run as root" >&2
  exit 1
fi

systemd-analyze verify "$service_source" "$timer_source"

mkdir -p /etc/systemd/journald.conf.d
journal_changed=0
if ! cmp -s "$journal_source" "$journal_target"; then
  install -o root -g root -m 0644 "$journal_source" "$journal_target"
  journal_changed=1
fi

install -o root -g root -m 0644 "$service_source" /etc/systemd/system/smalldocs-monitor.service
install -o root -g root -m 0644 "$timer_source" /etc/systemd/system/smalldocs-monitor.timer
systemctl daemon-reload

if [ "$journal_changed" -eq 1 ]; then
  systemctl restart systemd-journald
fi

if [ ! -r "$monitor_env" ]; then
  echo "Installed journal retention and monitor units; monitor timer remains disabled because $monitor_env is absent"
  exit 0
fi

if ! grep -Eq '^SDOCS_ALERT_EMAIL_TO=.+$' "$monitor_env"; then
  echo "$monitor_env must set SDOCS_ALERT_EMAIL_TO before the monitor timer can start" >&2
  exit 1
fi

systemctl enable --now smalldocs-monitor.timer
systemctl is-active --quiet smalldocs-monitor.timer
echo "Installed 90-day journal retention and enabled smalldocs-monitor.timer"
