#!/usr/bin/env bash
# Audio cross-routing reaper: mpv_check_orphan_sink watches whether this slot's
# mpv is still outputting to ITS OWN sink. The watchdog only enters this path
# when org.bluez Device1.Connected is true (the ACL link) — but audio needs the
# A2DP bluez_output sink, and under BT-adapter contention the two diverge: the
# ACL stays up while the sink vanishes, so mpv's stream migrates onto whatever
# sink survives (another headset). When the configured sink is absent for
# ORPHAN_SINK_TICKS consecutive ticks (hysteresis), reap mpv via stop_playback
# fast. A transient one-tick absence must NOT reap. Socket reads + the teardown
# are stubbed — no mpv, no PipeWire.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e

SLOT=0; TAG=tag; dir="$(slot_dir "$SLOT")"; mkdir -p "$dir"
SOCK="$dir/mpv-socket"
python3 -c "import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])" "$SOCK" 2>/dev/null \
    || { echo "  SKIP: cannot create unix socket"; teardown_tmp; finish; exit $?; }

# --- stubbed mpv sink probe (driven by globals) ---
SINK="pipewire/bluez_output.AA.1"; PRESENT=1
mpv_output_sink() { printf '%s\t%s' "$SINK" "$PRESENT"; }

# --- stubbed teardown + log (record invocations) ---
CALLS="$HOME/calls.log"; : > "$CALLS"
stop_playback() { echo "stop_playback $1 $3" >> "$CALLS"; }
LOGF="$HOME/log.txt"; logev() { echo "evt=$2 ${*:3}" >> "$LOGF"; }
reaped() { grep -c "stop_playback $SLOT fast" "$CALLS" 2>/dev/null; true; }
logged() { grep -c "$1" "$LOGF" 2>/dev/null; true; }
reset() { : > "$CALLS"; : > "$LOGF"; printf '0' > "$dir/.sink_gone_ticks"; }

ORPHAN_SINK_TICKS=2

# === Healthy: sink present -> never reap, counter stays 0 ===
reset; SINK="pipewire/bluez_output.AA.1"; PRESENT=1
mpv_check_orphan_sink "$SLOT" "$TAG" "$SOCK"
assert_eq "0" "$(reaped)" "present: no reap"
assert_eq "0" "$(cat "$dir/.sink_gone_ticks")" "present: counter at 0"

# === Sink gone for 1 tick -> hysteresis holds, no reap yet ===
reset; PRESENT=0
mpv_check_orphan_sink "$SLOT" "$TAG" "$SOCK"
assert_eq "0" "$(reaped)" "1 absent tick: no reap (hysteresis)"
assert_eq "1" "$(cat "$dir/.sink_gone_ticks")" "1 absent tick: counter=1"

# === Sink gone for a 2nd consecutive tick -> reap + log ===
PRESENT=0
mpv_check_orphan_sink "$SLOT" "$TAG" "$SOCK"
assert_eq "1" "$(reaped)" "2 absent ticks: stop_playback fast called"
assert_eq "1" "$(logged 'evt=audio.sink_reap')" "2 absent ticks: audio.sink_reap logged"
assert_eq "0" "$(cat "$dir/.sink_gone_ticks")" "after reap: counter reset"

# === Transient flap: absent, then present, then absent -> never 2 in a row ===
reset
PRESENT=0; mpv_check_orphan_sink "$SLOT" "$TAG" "$SOCK"   # counter 1
PRESENT=1; mpv_check_orphan_sink "$SLOT" "$TAG" "$SOCK"   # resets to 0
PRESENT=0; mpv_check_orphan_sink "$SLOT" "$TAG" "$SOCK"   # counter 1 again
assert_eq "0" "$(reaped)" "transient flap: no reap"
assert_eq "1" "$(cat "$dir/.sink_gone_ticks")" "transient flap: counter back to 1, not 2"

# === Empty sink (IPC hiccup) is conservative: no reap ===
reset; SINK=""; PRESENT=0
mpv_check_orphan_sink "$SLOT" "$TAG" "$SOCK"
assert_eq "0" "$(reaped)" "empty sink: no reap (conservative)"

# === Reap stamps .last_orphan_reap (watchdog uses it to suppress respawn) ===
reset; rm -f "$dir/.last_orphan_reap"; SINK="pipewire/bluez_output.AA.1"; PRESENT=0
mpv_check_orphan_sink "$SLOT" "$TAG" "$SOCK"   # tick1 -> 1
PRESENT=0
mpv_check_orphan_sink "$SLOT" "$TAG" "$SOCK"   # tick2 -> reap
assert_true "test -s '$dir/.last_orphan_reap'" "reap writes .last_orphan_reap timestamp"
# Healthy tick clears the suppression stamp (audio flowing again).
PRESENT=1
mpv_check_orphan_sink "$SLOT" "$TAG" "$SOCK"
assert_false "test -e '$dir/.last_orphan_reap'" "healthy sink clears .last_orphan_reap"

# === Return code contract: 0 (reaped) lets the watchdog `&& continue` ===
reset; PRESENT=0
mpv_check_orphan_sink "$SLOT" "$TAG" "$SOCK"   # tick1 -> 1
PRESENT=0
mpv_check_orphan_sink "$SLOT" "$TAG" "$SOCK" && echo "RC0" >> "$CALLS"   # tick2 -> reap, rc 0
assert_eq "1" "$(grep -c RC0 "$CALLS")" "reap returns 0"

teardown_tmp; finish
