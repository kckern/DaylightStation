#!/usr/bin/env bash
# Unit G: track-progression instrumentation. mpv_check_stall emits a
# track.start event (cheaply, reusing the already-sampled current plex_id)
# whenever the current track changes from the last-seen one, and NOT on a
# repeat tick of the same track. State lives in $dir/.last_track_id alongside
# the stall machinery. Socket reads and side effects are stubbed — no mpv.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e

file_size_bytes() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }
LOGF="$HOME/log.txt"; logev() { echo "evt=$2 ${*:3}" >> "$LOGF"; }
logged() { grep -c "$1" "$LOGF" 2>/dev/null; true; }

mkdir -p "$CACHE_DIR"
SLOT=0; TAG=tag; dir="$(slot_dir "$SLOT")"; mkdir -p "$dir"
SOCK="$dir/mpv-socket"
python3 -c "import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])" "$SOCK" 2>/dev/null \
    || { echo "  SKIP: cannot create unix socket"; teardown_tmp; finish; exit $?; }

# --- stubbed mpv reads (driven by globals). POS advances each tick so the
# stall path never fires and we isolate track-change behavior. ---
POS=1.0; PAUSE=false; CURID=900; IDX=0
mpv_get_prop() { case "$2" in time-pos) echo "$POS";; pause) echo "$PAUSE";; playlist-pos) echo "$IDX";; esac; }
mpv_current_plexid() { echo "$CURID"; }
# Keep the stall-side effects inert (a track change shouldn't trigger them anyway).
get_cached_path() { echo "$(cache_path "$1")"; return 0; }
loadlist_replace_preserving_pos() { return 0; }
reset() { : > "$LOGF"; }

# === Tick 1: first sighting of track 900 -> track.start emitted ===
reset; POS=1.0; CURID=900; IDX=0
mpv_check_stall "$SLOT" "$TAG" "$SOCK"
assert_eq "1" "$(logged 'evt=track.start')" "tick1: first track -> track.start"
assert_true "grep -q 'plex_id=900' '$LOGF'" "tick1: track.start carries plex_id"
assert_true "grep -q 'idx=0' '$LOGF'" "tick1: track.start carries idx"
assert_eq "900" "$(cat "$dir/.last_track_id")" "tick1: last_track_id persisted"

# === Tick 2: SAME track 900, advancing pos -> NO new track.start ===
reset; POS=2.0; CURID=900; IDX=0
mpv_check_stall "$SLOT" "$TAG" "$SOCK"
assert_eq "0" "$(logged 'evt=track.start')" "tick2: same track -> no track.start"

# === Tick 3: track CHANGES to 901 -> track.start emitted again ===
reset; POS=0.5; CURID=901; IDX=1
mpv_check_stall "$SLOT" "$TAG" "$SOCK"
assert_eq "1" "$(logged 'evt=track.start')" "tick3: changed track -> track.start"
assert_true "grep -q 'plex_id=901' '$LOGF'" "tick3: new plex_id logged"
assert_true "grep -q 'idx=1' '$LOGF'" "tick3: new idx logged"
assert_eq "901" "$(cat "$dir/.last_track_id")" "tick3: last_track_id updated"

# === Empty current id (mpv between files) -> no track.start, state unchanged ===
reset; POS=3.0; CURID=""; IDX=1
mpv_check_stall "$SLOT" "$TAG" "$SOCK"
assert_eq "0" "$(logged 'evt=track.start')" "empty id -> no track.start"
assert_eq "901" "$(cat "$dir/.last_track_id")" "empty id -> last_track_id preserved"

teardown_tmp; finish
