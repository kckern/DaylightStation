#!/usr/bin/env bash
# Unit tests for the 2026-06-16 observability fixes:
#   - emit_heartbeat        : self-throttled playback.heartbeat liveness sample
#   - note_reconnect_recovered : outage→recovery close-out with duration
# Both mpv reads (socket props) and logev are stubbed — no mpv, no real ledger.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e

LOGF="$HOME/log.txt"; logev() { echo "evt=$2 ${*:3}" >> "$LOGF"; }
logged() { grep -c "$1" "$LOGF" 2>/dev/null; true; }
reset_log() { : > "$LOGF"; }

# === emit_heartbeat: throttling + field capture ============================
SLOT=0; TAG=tag; dir="$(slot_dir "$SLOT")"; mkdir -p "$dir"
SOCK="$dir/mpv-socket"
python3 -c "import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])" "$SOCK" 2>/dev/null \
    || { echo "  SKIP: cannot create unix socket"; teardown_tmp; finish; exit $?; }

# Stub the mpv reads emit_heartbeat performs.
POS=42.5; PAUSE=false; CURID=675500; SINK="pipewire/bluez_output.AA.1"; PRESENT=1
mpv_get_prop() { case "$2" in time-pos) echo "$POS";; pause) echo "$PAUSE";; esac; }
mpv_current_plexid() { echo "$CURID"; }
mpv_output_sink() { printf '%s\t%d' "$SINK" "$PRESENT"; }

HEARTBEAT_INTERVAL=180

# Tick 1: no prior heartbeat -> emits, stamps .last_heartbeat.
reset_log
emit_heartbeat "$SLOT" "$TAG" "$SOCK"
assert_eq "1" "$(logged 'evt=playback.heartbeat')" "tick1: heartbeat emitted (no prior)"
assert_true "[[ -f '$dir/.last_heartbeat' ]]" "tick1: .last_heartbeat stamped"
assert_eq "1" "$(logged 'plex_id=675500')" "tick1: carries plex_id"
assert_eq "1" "$(logged 'pos=42.5')"       "tick1: carries pos"
assert_eq "1" "$(logged 'paused=false')"   "tick1: carries paused"
assert_eq "1" "$(logged 'sink_live=1')"    "tick1: carries sink_live"

# Tick 2: immediately after -> within interval -> throttled (no emit).
reset_log
emit_heartbeat "$SLOT" "$TAG" "$SOCK"
assert_eq "0" "$(logged 'evt=playback.heartbeat')" "tick2: throttled within interval"

# Tick 3: backdate last_heartbeat past the interval -> emits again, paused case.
reset_log; PAUSE=true; PRESENT=0
printf '%s' "$(( $(date +%s) - HEARTBEAT_INTERVAL - 1 ))" > "$dir/.last_heartbeat"
emit_heartbeat "$SLOT" "$TAG" "$SOCK"
assert_eq "1" "$(logged 'evt=playback.heartbeat')" "tick3: emits after interval elapses"
assert_eq "1" "$(logged 'paused=true')"   "tick3: surfaces paused state"
assert_eq "1" "$(logged 'sink_live=0')"   "tick3: surfaces absent sink"

# Tick 4: pause read comes back EMPTY (jq '.data // empty' swallows boolean
# false) -> heartbeat must normalize to an explicit paused=false, not "".
reset_log; PAUSE=""; PRESENT=1
mpv_get_prop() { case "$2" in time-pos) echo "$POS";; pause) echo "";; esac; }
printf '%s' "$(( $(date +%s) - HEARTBEAT_INTERVAL - 1 ))" > "$dir/.last_heartbeat"
emit_heartbeat "$SLOT" "$TAG" "$SOCK"
assert_eq "1" "$(logged 'evt=playback.heartbeat')" "tick4: emits"
assert_eq "1" "$(logged 'paused=false')" "tick4: empty pause normalized to false"
# restore the normal stub for any later use
mpv_get_prop() { case "$2" in time-pos) echo "$POS";; pause) echo "$PAUSE";; esac; }

# Missing socket node -> no-op, no emit, no crash.
reset_log
emit_heartbeat "$SLOT" "$TAG" "$dir/does-not-exist"
assert_eq "0" "$(logged 'evt=playback.heartbeat')" "no socket -> no heartbeat"

# === note_reconnect_recovered: outage close-out ===========================
# Deterministic clock so outage_sec is exact.
_NOW=10000
date() { [[ "$1" == "+%s" ]] && { echo "$_NOW"; return 0; }; command date "$@"; }

rdir="$(slot_dir 1)"; mkdir -p "$rdir"

# Active outage (misses>0) -> emits recovered with misses + outage_sec, clears files.
reset_log
echo 7 > "$rdir/.connect-misses"
echo $(( _NOW - 250 )) > "$rdir/.connect-outage-start"
: > "$rdir/.connect-alerted"
note_reconnect_recovered tag "$rdir"
assert_eq "1" "$(logged 'evt=bt.reconnect_recovered')" "recovered emitted on real outage"
assert_eq "1" "$(logged 'misses=7')"      "recovered carries miss count"
assert_eq "1" "$(logged 'outage_sec=250')" "recovered carries outage duration"
assert_false "[[ -f '$rdir/.connect-misses' ]]"       "miss file cleared"
assert_false "[[ -f '$rdir/.connect-outage-start' ]]" "outage-start cleared"
assert_false "[[ -f '$rdir/.connect-alerted' ]]"      "alert file cleared"

# No prior outage (no miss file) -> no event, no crash.
reset_log
note_reconnect_recovered tag "$rdir"
assert_eq "0" "$(logged 'evt=bt.reconnect_recovered')" "no outage -> no recovered event"

# Zero misses file -> treated as no outage.
reset_log
echo 0 > "$rdir/.connect-misses"
note_reconnect_recovered tag "$rdir"
assert_eq "0" "$(logged 'evt=bt.reconnect_recovered')" "zero misses -> no recovered event"
assert_false "[[ -f '$rdir/.connect-misses' ]]" "zero-miss file still cleared"

unset -f date
teardown_tmp; finish
