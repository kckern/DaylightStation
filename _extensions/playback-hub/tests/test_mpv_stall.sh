#!/usr/bin/env bash
# Unit F Part 2 (handler orchestration): mpv_check_stall samples pos across two
# ticks, revalidates a frozen track exactly once, respects the per-id cooldown,
# and never fires on advancing pos or a paused player. Socket/property reads and
# the cache/loadlist side effects are stubbed — no mpv, no network.
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
# mpv_check_stall requires a real socket node to pass the [[ -S ]] guard; fake
# one. (socat is never invoked because we stub the property/helpers below.)
python3 -c "import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])" "$SOCK" 2>/dev/null \
    || { echo "  SKIP: cannot create unix socket"; teardown_tmp; finish; exit $?; }

# --- stubbed mpv reads (driven by globals) ---
POS=""; PAUSE=false; CURID=900
mpv_get_prop() { case "$2" in time-pos) echo "$POS";; pause) echo "$PAUSE";; esac; }
mpv_current_plexid() { echo "$CURID"; }

# --- stubbed side effects (record invocations) ---
CALLS="$HOME/calls.log"; : > "$CALLS"
get_cached_path() { echo "getcached $1" >> "$CALLS"; echo "$(cache_path "$1")"; return 0; }
loadlist_replace_preserving_pos() { echo "loadlist $1" >> "$CALLS"; return 0; }
cnt() { grep -c "$1" "$CALLS" 2>/dev/null; true; }
reset() { : > "$CALLS"; : > "$LOGF"; }

# meta with a source_url so the revalidate path has a URL to redownload from.
head -c 5000 /dev/zero > "$(cache_path "$CURID")"
cache_meta_write "$CURID" 5000 "" "http://server/$CURID"

STALL_REVALIDATE_COOLDOWN=120

# === Tick 1: no prior pos -> establishes baseline, no revalidate ===
reset; POS=10.0; PAUSE=false
mpv_check_stall "$SLOT" "$TAG" "$SOCK"
assert_eq "0" "$(cnt loadlist)" "tick1: no baseline -> no revalidate"
assert_eq "10.0" "$(cat "$dir/.last_pos")" "tick1: baseline pos persisted"

# === Tick 2: SAME pos, not paused -> stall -> revalidate once ===
reset; POS=10.0; PAUSE=false
mpv_check_stall "$SLOT" "$TAG" "$SOCK"
assert_eq "1" "$(cnt getcached)" "tick2: get_cached_path called (redownload)"
assert_eq "1" "$(cnt loadlist)"  "tick2: loadlist reload called"
assert_eq "1" "$(logged 'evt=track.stall')"    "tick2: track.stall logged"
assert_eq "1" "$(logged 'evt=cache.revalidate')" "tick2: cache.revalidate logged"
assert_false "[[ -f '$(cache_path "$CURID")' ]]" "tick2: stale cache removed (get_cached stub didn't rewrite)"

# === Tick 3: STILL same pos -> cooldown blocks re-revalidate of same id ===
reset; POS=10.0; PAUSE=false
mpv_check_stall "$SLOT" "$TAG" "$SOCK"
assert_eq "0" "$(cnt loadlist)" "tick3: cooldown prevents thrash on same id"
assert_eq "0" "$(logged 'evt=cache.revalidate')" "tick3: no second revalidate within cooldown"

# === Cooldown expiry: backdate last_revalidate -> revalidate allowed again ===
reset; POS=10.0; PAUSE=false
printf '%s %s' "$CURID" "$(( $(date +%s) - 999 ))" > "$dir/.last_revalidate"
mpv_check_stall "$SLOT" "$TAG" "$SOCK"
assert_eq "1" "$(cnt loadlist)" "after cooldown: revalidate fires again"

# === Advancing pos -> never a stall ===
reset; printf '%s' "10.0" > "$dir/.last_pos"; POS=12.5; PAUSE=false
mpv_check_stall "$SLOT" "$TAG" "$SOCK"
assert_eq "0" "$(cnt loadlist)" "advancing pos -> no revalidate"

# === Paused with frozen pos -> never a stall (don't fight user pause) ===
reset; printf '%s' "20.0" > "$dir/.last_pos"; POS=20.0; PAUSE=true
mpv_check_stall "$SLOT" "$TAG" "$SOCK"
assert_eq "0" "$(cnt loadlist)" "paused + frozen pos -> no revalidate"

# === Stall but no source_url -> skip (can't redownload) ===
reset; rm -f "$(meta_path "$CURID")"; printf '%s' "30.0" > "$dir/.last_pos"; rm -f "$dir/.last_revalidate"
POS=30.0; PAUSE=false
mpv_check_stall "$SLOT" "$TAG" "$SOCK"
assert_eq "0" "$(cnt loadlist)" "no source_url -> skip revalidate"
assert_eq "1" "$(logged 'evt=track.stall_skip')" "no source_url -> stall_skip logged"

teardown_tmp; finish
