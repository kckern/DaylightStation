#!/usr/bin/env bash
# reap_migrated_orphans: active cross-bleed remediation. When a doubling is
# measured, it reaps the migrated orphan(s) — any slot whose OWN bluez sink is
# ABSENT from the live pw-link graph while its mpv is alive. SAFETY-CRITICAL
# invariant under test: a slot whose own sink IS present (playing legitimately)
# must NEVER be reaped; a slot whose sink is absent + mpv alive MUST be reaped
# (and stamped .last_orphan_reap); a slot with a dead/missing mpv is left alone.
# pw-link is stubbed (function; command -v finds it); stop_playback records.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e

CONFIG_FILE="$HOME/devices.json"
cat > "$CONFIG_FILE" <<'JSON'
{"devices":[
  {"slot":1,"color":"red","mac":"AA:BB:CC:00:30:07","name":"musiCozy"},
  {"slot":2,"color":"yellow","mac":"AA:BB:CC:00:31:02","name":"musiCozy"},
  {"slot":4,"color":"blue","mac":"AA:BB:CC:00:31:04","name":"musiCozy"}
]}
JSON

# --- pw-link stub: emit a sink header per present mac (underscore form in $PRESENT) ---
PRESENT=""
pw-link() { local mu; for mu in $PRESENT; do echo "bluez_output.${mu}.1:playback_FL"; echo "  |<- mpv:output_FL"; done; }

# --- record reaps; silence logev ---
REAPED="$HOME/reaped.txt"; : > "$REAPED"
stop_playback() { echo "reap slot=$1 mode=$3" >> "$REAPED"; }
logev() { :; }
reaped_slot() { grep -c "reap slot=$1 mode=fast" "$REAPED" 2>/dev/null; true; }

# helper: give slot N a live mpv (real bg pid so kill -0 succeeds)
LIVE_PIDS=()
give_live_mpv() { local d; d="$(slot_dir "$1")"; mkdir -p "$d"; sleep 60 & echo $! > "$d/mpv.pid"; LIVE_PIDS+=($!); }
give_dead_mpv() { local d; d="$(slot_dir "$1")"; mkdir -p "$d"; echo 999999 > "$d/mpv.pid"; }   # pid that isn't alive
reset_reap() { : > "$REAPED"; rm -f "$(slot_dir 1)/.last_orphan_reap" "$(slot_dir 2)/.last_orphan_reap" "$(slot_dir 4)/.last_orphan_reap"; }

# === Only yellow(2) sink present; all 3 have live mpv -> reap red(1)+blue(4), NOT yellow(2) ===
reset_reap
give_live_mpv 1; give_live_mpv 2; give_live_mpv 4
PRESENT="AA_BB_CC_00_31_02"
reap_migrated_orphans
assert_eq "1" "$(reaped_slot 1)" "red absent-sink -> reaped"
assert_eq "1" "$(reaped_slot 4)" "blue absent-sink -> reaped"
assert_eq "0" "$(reaped_slot 2)" "yellow present-sink -> NOT reaped (safety)"
assert_true "test -s '$(slot_dir 1)/.last_orphan_reap'" "reaped slot stamps .last_orphan_reap"
assert_false "test -e '$(slot_dir 2)/.last_orphan_reap'" "legit slot leaves no reap stamp"

# === All sinks present -> nothing reaped ===
reset_reap
PRESENT="AA_BB_CC_00_30_07 AA_BB_CC_00_31_02 AA_BB_CC_00_31_04"
reap_migrated_orphans
assert_eq "0" "$(wc -l < "$REAPED" | tr -d ' ')" "all sinks present -> zero reaps"

# === Absent sink but DEAD mpv -> not reaped (nothing to kill) ===
reset_reap
rm -f "$(slot_dir 4)/mpv.pid"; give_dead_mpv 4
PRESENT="AA_BB_CC_00_30_07 AA_BB_CC_00_31_02"   # blue(4) absent
reap_migrated_orphans
assert_eq "0" "$(reaped_slot 4)" "absent sink + dead mpv -> not reaped"

# cleanup live pids
for p in "${LIVE_PIDS[@]}"; do kill "$p" 2>/dev/null; done
teardown_tmp; finish
