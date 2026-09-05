#!/bin/sh
set -eu

if [ "$#" -lt 2 ]; then
  echo "Usage: ops/prune-releases.sh RELEASE_ROOT ACTIVE_POINTER [PROTECTED_POINTER ...]" >&2
  exit 2
fi

release_root=$1
shift
active_pointer=$1

case "$release_root" in
  /*) ;;
  *) echo "Release root must be an absolute path" >&2; exit 2 ;;
esac

release_root=$(readlink -f "$release_root")
if [ ! -d "$release_root" ] || [ "$release_root" = / ]; then
  echo "Release root must be an existing directory other than /" >&2
  exit 2
fi

active_release=$(readlink -f "$active_pointer" 2>/dev/null || true)
case "$active_release" in
  "$release_root"/*) ;;
  *) echo "Active pointer must resolve inside the release root" >&2; exit 2 ;;
esac
if [ ! -d "$active_release" ]; then
  echo "Active pointer must resolve to an existing release" >&2
  exit 2
fi

for candidate in "$release_root"/*; do
  [ -d "$candidate" ] || continue
  protected=0
  for pointer in "$@"; do
    target=$(readlink -f "$pointer" 2>/dev/null || true)
    if [ "$candidate" = "$target" ]; then
      protected=1
      break
    fi
  done
  [ "$protected" -eq 0 ] || continue

  release_name=${candidate##*/}
  if ! printf '%s\n' "$release_name" | grep -Eq '^[0-9a-f]{7,40}$'; then
    echo "Skipping non-release directory $candidate" >&2
    continue
  fi
  rm -rf -- "$candidate"
  echo "Removed inactive release $release_name"
done
