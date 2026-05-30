#!/usr/bin/env bash
# Unit H — position-preserving reconcile WHILE PLAYING, realistic membership churn.
#
# Gap vs test_mpv_helpers.sh: that test proves the survivor mechanic by APPENDING
# tracks before the current id (index only ever grows) and proves the no-survivor
# reset-to-0 case. This test adds the realistic reconcile that production actually
# hits: the currently-playing track K sits MID-list, a track BEFORE it is REMOVED
# and a brand-new track is ADDED, so K's index SHIFTS to a value driven by real
# membership churn (here it lands at a DIFFERENT, smaller index). It asserts mpv
# re-seeks to K's NEW index by CONTENT — not the stale old index, not 0. The
# no-survivor (K removed -> pos 0) path is already covered in test_mpv_helpers.sh
# and is intentionally NOT duplicated here.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e

SLOT=0
dir="$HOME/playback-hub/slots/$SLOT"
mkdir -p "$dir"
sock="$dir/mpv-socket"
FMPID=""

start_fake() { # --playlist ... --pos ...
    python3 "$(dirname "$0")/fake_mpv.py" "$sock" "$@" &
    FMPID=$!
    for _ in $(seq 1 50); do [[ -S "$sock" ]] && break; sleep 0.1; done
}
stop_fake() { [[ -n "$FMPID" ]] && { kill "$FMPID" 2>/dev/null; wait "$FMPID" 2>/dev/null; }; FMPID=""; }
trap 'stop_fake' EXIT

q_count() { echo '{"command":["get_property","playlist-count"]}' | socat - "$sock" 2>/dev/null | jq -r '.data'; }
q_pos()   { echo '{"command":["get_property","playlist-pos"]}'   | socat - "$sock" 2>/dev/null | jq -r '.data'; }

# --- Seed: mpv playing a 5-track list, currently on track K=303 at index 3. ---
# Old in-memory order (indices): 0:101 1:202 2:300 3:303(K) 4:404
start_fake \
  --playlist /cache/red/101.mp3,/cache/red/202.mp3,/cache/red/300.mp3,/cache/red/303.mp3,/cache/red/404.mp3 \
  --pos 3
assert_true "[[ -S '$sock' ]]" "fake mpv socket came up"
assert_eq "5"   "$(q_count)" "seeded 5-track playlist"
assert_eq "3"   "$(q_pos)"   "currently playing index 3 (the K track)"
assert_eq "303" "$(mpv_current_plexid "$sock")" "current track is K=303"

# --- New membership: two tracks BEFORE K removed (101, 202), one ADDED (999).
# K (303) still present but now lands at a SMALLER index than before (was 3).
# New order: 0:300  1:303(K)  2:999  3:404   -> K's NEW index is 1.
cat > "$dir/playlist.m3u" <<'EOF'
#EXTM3U
#EXTINF:-1,C
/cache/red/300.mp3
#EXTINF:-1,K
/cache/red/303.mp3
#EXTINF:-1,New
/cache/red/999.mp3
#EXTINF:-1,D
/cache/red/404.mp3
EOF

# Sanity on the fixture: K's expected NEW index per the PURE locator is 1,
# and it genuinely differs from the old playing index (3).
expected_idx="$(playlist_index_of "$dir/playlist.m3u" 303)"
assert_eq "1" "$expected_idx" "fixture: K's new index is 1 (membership churn moved it)"
assert_true "[[ '$expected_idx' != '3' ]]" "fixture: K's index actually SHIFTED (1 != old 3)"

# --- The reconcile under test ---
loadlist_replace_preserving_pos "$SLOT" "$SLOT"; rc=$?
assert_eq "0" "$rc" "loadlist_replace_preserving_pos rc 0 (survivor, churned membership)"

# --- Assertions: mpv now reflects the NEW membership, positioned on K by content ---
assert_eq "4"   "$(q_count)" "playlist replaced -> new membership count 4"
assert_eq "1"   "$(q_pos)"   "playlist-pos re-seeked to K's NEW index (1), not stale 3 and not 0"
assert_eq "303" "$(mpv_current_plexid "$sock")" "still playing the SAME track K=303 after churn"

# --- Event records the survivor outcome (JSON form: "key":"value") ---
ev="$dir/events.jsonl"
assert_true "grep -q 'reconcile.loadlist' '$ev'" "reconcile.loadlist event written"
assert_true "grep -q '\"cur_track_survived\":\"true\"' '$ev'" "event logs cur_track_survived=true"
# count transition recorded the membership shrink 5 -> 4
assert_true "grep -q '\"mpv_count\":\"5-4\"' '$ev'" "event logs mpv_count transition 5-4"

stop_fake
teardown_tmp; finish
