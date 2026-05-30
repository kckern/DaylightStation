#!/usr/bin/env bash
# Integration test for the mpv-IPC helpers against a fake mpv socket.
# Exercises the REAL socat round-trip (the socket layer is the thing under test).
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e

# Use a numeric slot so logev's slot_for_tag resolves it (no runtime config
# needed) and reconcile events land in slots/0/events.jsonl.
SLOT=0
dir="$HOME/playback-hub/slots/$SLOT"
mkdir -p "$dir"
sock="$dir/mpv-socket"
FMPID=""

start_fake() { # --playlist ... --pos ...
    python3 "$(dirname "$0")/fake_mpv.py" "$sock" "$@" &
    FMPID=$!
    for i in $(seq 1 50); do [[ -S "$sock" ]] && break; sleep 0.1; done
}
stop_fake() { [[ -n "$FMPID" ]] && { kill "$FMPID" 2>/dev/null; wait "$FMPID" 2>/dev/null; }; FMPID=""; }
# Always clean up the background fake on exit so the runner never hangs.
trap 'stop_fake' EXIT

q_count() { echo '{"command":["get_property","playlist-count"]}' | socat - "$sock" 2>/dev/null | jq -r '.data'; }
q_pos()   { echo '{"command":["get_property","playlist-pos"]}'   | socat - "$sock" 2>/dev/null | jq -r '.data'; }

# --- Seed a known state ---
start_fake --playlist /cache/red/100.mp3,/cache/red/200.mp3,/cache/red/300.mp3 --pos 1
assert_true "[[ -S '$sock' ]]" "fake mpv socket came up"

# --- mpv_playlist_count ---
assert_eq "3" "$(mpv_playlist_count "$sock")" "playlist count == seeded length"

# --- mpv_current_plexid (pos 1 -> 200.mp3 -> 200) ---
assert_eq "200" "$(mpv_current_plexid "$sock")" "current plexid == basename of seeded current path"

# --- mpv_ipc returns 0 on a success command, prints raw response ---
out=$(mpv_ipc "$sock" '{"command":["get_property","playlist-count"]}'); rc=$?
assert_eq "0" "$rc" "mpv_ipc rc 0 on success"
# Probe the captured output directly (avoid re-eval quoting issues with the JSON).
if echo "$out" | grep -q '"error":"success"'; then ipc_ok=1; else ipc_ok=0; fi
assert_eq "1" "$ipc_ok" "mpv_ipc prints raw success response"

# --- mpv_ipc returns 1 when socket missing ---
out=$(mpv_ipc "$HOME/no-such-socket" '{"command":["get_property","playlist-count"]}'); rc=$?
assert_eq "1" "$rc" "mpv_ipc rc 1 when socket missing"

# === loadlist_replace_preserving_pos: current track SURVIVES at a new index ===
# New playlist puts current id (200) at index 2.
cat > "$dir/playlist.m3u" <<'EOF'
#EXTM3U
#EXTINF:-1,A
/cache/red/777.mp3
#EXTINF:-1,B
/cache/red/888.mp3
#EXTINF:-1,C
/cache/red/200.mp3
EOF
loadlist_replace_preserving_pos "$SLOT" "$SLOT"; rc=$?
assert_eq "0" "$rc" "loadlist_replace_preserving_pos rc 0 (survivor)"
assert_eq "3"   "$(q_count)" "playlist replaced -> count 3"
assert_eq "2"   "$(q_pos)"   "playlist-pos set to surviving track new index (2)"
assert_eq "200" "$(mpv_current_plexid "$sock")" "current track preserved (200)"

# Verify the reconcile event recorded cur_track_survived=true
ev="$HOME/playback-hub/slots/$SLOT/events.jsonl"
assert_true "grep -q 'cur_track_survived' '$ev'" "reconcile event written"
last_survived=$(grep 'reconcile.loadlist' "$ev" | tail -1)
assert_true "echo '$last_survived' | grep -q 'true'" "survivor case logs cur_track_survived=true"

# === current track does NOT survive -> pos stays at loadlist reset (0), survived=false ===
cat > "$dir/playlist.m3u" <<'EOF'
#EXTM3U
#EXTINF:-1,X
/cache/red/501.mp3
#EXTINF:-1,Y
/cache/red/502.mp3
EOF
# current id is now 200 (from previous pos 2) — not in the new list.
loadlist_replace_preserving_pos "$SLOT" "$SLOT"; rc=$?
assert_eq "0" "$rc" "loadlist_replace_preserving_pos rc 0 (no survivor)"
assert_eq "2" "$(q_count)" "playlist replaced -> count 2 (no survivor)"
assert_eq "0" "$(q_pos)"   "pos stays 0 after loadlist reset (no survivor)"
last_nosurv=$(grep 'reconcile.loadlist' "$ev" | tail -1)
assert_true "echo '$last_nosurv' | grep -q 'false'" "no-survivor case logs cur_track_survived=false"

# === no socket -> skip path returns 1 ===
stop_fake
rm -f "$sock"
loadlist_replace_preserving_pos "$SLOT" "$SLOT"; rc=$?
assert_eq "1" "$rc" "no socket -> rc 1 (reconcile.skip)"

teardown_tmp; finish
