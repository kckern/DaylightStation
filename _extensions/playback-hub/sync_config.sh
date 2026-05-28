#!/usr/bin/env bash
# Pull headset-hub/devices.yml from homeserver.local once.
# Homeserver hosts the canonical Dropbox-synced copy; this script
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

SRC="kckern@10.0.0.10:/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/household/config/playback-hub.yml"
DEST="/home/kckern/playback-hub/devices.yml"
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
