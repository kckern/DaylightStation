#!/usr/bin/env bash
# Unit E: membership_tick reconciles only slots with a live mpv, resolves the
# schedule-correct queue, and skips public-no-queue slots cleanly.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e

# Point CONFIG_FILE at a test config: slot 0 (private, has queue, mpv live),
# slot 1 (private, has queue, mpv NOT live), slot 5 (public, no queue, mpv live).
CONFIG_FILE="$HOME/devices.runtime.json"
cat > "$CONFIG_FILE" <<'JSON'
{
  "queue_base": "http://api/q/",
  "devices": [
    {"slot": 0, "name": "red",   "mac": "AA:00", "queue": "111", "class": "private"},
    {"slot": 1, "name": "green", "mac": "AA:01", "queue": "222", "class": "private"},
    {"slot": 5, "name": "white", "mac": "AA:05", "class": "public"}
  ]
}
JSON

# Record reconcile invocations instead of doing real work.
RECON="$HOME/recon.log"; : > "$RECON"
reconcile_slot_membership() { echo "$1|$3|$4" >> "$RECON"; }   # slot|queue_url|shuffle

# Stub the mpv-liveness gate: slots 0 and 5 are "live", slot 1 is not.
# membership_tick checks: [[ -f mpv.pid ]] && kill -0 $(cat mpv.pid). We create
# mpv.pid files pointing at our own PID (always alive) for the live slots.
for s in 0 5; do
    d="$HOME/playback-hub/slots/$s"; mkdir -p "$d"; echo $$ > "$d/mpv.pid"
done
# slot 1 dir exists but no mpv.pid -> not live.
mkdir -p "$HOME/playback-hub/slots/1"

membership_tick

# slot 0: live + has queue -> reconciled with resolved schedule queue url.
assert_eq "1" "$(grep -c '^0|' "$RECON"; true)" "live slot 0 reconciled once"
slot0_url=$(grep '^0|' "$RECON" | head -1 | cut -d'|' -f2)
assert_eq "http://api/q/111" "$slot0_url" "slot 0 resolved schedule-correct queue url"

# slot 1: mpv not live -> NOT reconciled.
assert_eq "0" "$(grep -c '^1|' "$RECON"; true)" "idle slot 1 NOT reconciled"

# slot 5: live but public with no queue -> skipped cleanly (no reconcile).
assert_eq "0" "$(grep -c '^5|' "$RECON"; true)" "public no-queue slot 5 skipped"

teardown_tmp; finish
