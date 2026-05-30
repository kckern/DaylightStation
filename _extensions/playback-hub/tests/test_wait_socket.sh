#!/usr/bin/env bash
# Test wait_for_mpv_socket readiness poll.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e

dir="$HOME/playback-hub/slots/red"
mkdir -p "$dir"
sock="$dir/mpv-socket"

# --- Case 1: no socket + 1s timeout -> returns 1 in ~1s ---
start=$(date +%s)
wait_for_mpv_socket "$dir" 1; rc=$?
end=$(date +%s)
elapsed=$((end - start))
assert_eq "1" "$rc" "missing socket times out -> rc 1"
assert_true "[[ $elapsed -ge 1 && $elapsed -le 3 ]]" "timeout ~1s (was ${elapsed}s)"

# --- Case 2: live socket -> returns 0 quickly ---
python3 "$(dirname "$0")/fake_mpv.py" "$sock" &
FMPID=$!
# Helper itself should observe the socket appear; give it a 5s budget.
start=$(date +%s)
wait_for_mpv_socket "$dir" 5; rc=$?
end=$(date +%s)
elapsed=$((end - start))
assert_eq "0" "$rc" "live socket -> rc 0"
assert_true "[[ $elapsed -le 2 ]]" "returns promptly when socket present (was ${elapsed}s)"

kill $FMPID 2>/dev/null; wait $FMPID 2>/dev/null
teardown_tmp; finish
