#!/usr/bin/env bash
# Pull headset-hub/devices.yml from the DaylightStation server once.
# The server hosts the canonical Dropbox-synced copy; this script
# mirrors any change made on the Mac (via Dropbox -> homeserver)
# onto the hub's working file. headset-hub.sh's refresh_loop picks
# up the new content within REFRESH_INTERVAL.
#
# Hardening:
#   - Stages download to .staging path so a partial / failed transfer
#     never replaces the known-good file.
#   - Validates YAML parseability AND minimal structure (has a non-empty
#     devices list) before committing the swap. Refuses to deploy a
#     malformed config that would break headsets for kids.
set -euo pipefail

# Path per the household config registry (shared/contracts/householdConfig.mjs):
# 'playback-hub' -> 'playback-hub/config'. The old household/config/ directory
# was retired 2026-08, which silently broke this sync until 2026-08-31.
HUB_DIR="${PLAYBACK_HUB_DIR:-$HOME/playback-hub}"
# SYNC_SRC (the rsync source for the household playback-hub config.yml, as
# user@host:/path) is setup-specific, so it lives on the hub, not in the repo.
# shellcheck source=/dev/null
[[ -f "$HUB_DIR/sync.env" ]] && source "$HUB_DIR/sync.env"
if [[ -z "${SYNC_SRC:-}" ]]; then
  logger -t playback-hub-sync "SYNC_SRC unset; create $HUB_DIR/sync.env"
  echo "SYNC_SRC unset; create $HUB_DIR/sync.env" >&2
  exit 1
fi
SRC="$SYNC_SRC"
DEST="$HUB_DIR/devices.yml"
STAGING="${DEST}.staging"

old_md5=""
[[ -f "$DEST" ]] && old_md5=$(md5sum "$DEST" | awk "{print \$1}")

rsync --quiet -e "ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=5" "$SRC" "$STAGING"

if ! python3 -c "import yaml,sys; d=yaml.safe_load(open(sys.argv[1])); assert isinstance(d, dict), \"not a YAML mapping\"; assert isinstance(d.get(\"devices\"), list), \"devices key missing or not a list\"; assert len(d[\"devices\"]) > 0, \"devices list is empty\"" "$STAGING" 2>/tmp/playback-hub-sync-validation.err; then
    err=$(cat /tmp/playback-hub-sync-validation.err 2>/dev/null | tail -3)
    logger -t playback-hub-sync "downloaded config FAILED validation, keeping previous. err: $err"
    echo "[$(date +%H:%M:%S)] config validation failed: $err" >&2
    rm /tmp/playback-hub-sync-validation.err 2>/dev/null || true
    exit 1
fi
rm /tmp/playback-hub-sync-validation.err 2>/dev/null || true

mv "$STAGING" "$DEST"

new_md5=$(md5sum "$DEST" | awk "{print \$1}")

if [[ "$old_md5" != "$new_md5" ]]; then
    logger -t playback-hub-sync "config changed: $old_md5 -> $new_md5"
    echo "[$(date +%H:%M:%S)] config changed: $old_md5 -> $new_md5"
fi
