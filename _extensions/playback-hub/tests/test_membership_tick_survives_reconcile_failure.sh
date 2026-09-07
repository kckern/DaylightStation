#!/usr/bin/env bash
# A transient queue-rebuild failure must not kill the membership worker: it
# must continue to the next live slot and remain available for the next tick.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT
RESULT="$TMPDIR_TEST/result"

set +e
bash -s "$ROOT" "$TMPDIR_TEST" "$RESULT" <<'SCRIPT'
set -euo pipefail
ROOT="$1"
TMPDIR_TEST="$2"
RESULT="$3"
export HOME="$TMPDIR_TEST"
source "$ROOT/playback-hub.sh"

CONFIG_FILE="$HOME/devices.runtime.json"
cat > "$CONFIG_FILE" <<'JSON'
{
  "queue_base": "http://api/q/",
  "devices": [
    {"slot": 0, "name": "first", "mac": "AA:00", "queue": "111", "class": "private"},
    {"slot": 1, "name": "second", "mac": "AA:01", "queue": "222", "class": "private"}
  ]
}
JSON
for slot in 0 1; do
    mkdir -p "$HOME/playback-hub/slots/$slot"
    echo "$$" > "$HOME/playback-hub/slots/$slot/mpv.pid"
done
reconcile_slot_membership() {
    if [[ "$1" == 0 ]]; then
        return 1
    fi
    echo "second-slot-reconciled" > "$RESULT"
}

membership_tick
SCRIPT
RC=$?
set -e

if [[ "$RC" != 0 ]]; then
    echo "FAIL: membership tick exited after a reconcile failure"
    exit 1
fi
if [[ "$(cat "$RESULT" 2>/dev/null || true)" != "second-slot-reconciled" ]]; then
    echo "FAIL: membership tick did not continue after a reconcile failure"
    exit 1
fi
echo "PASS: membership tick survives a reconcile failure"
