#!/usr/bin/env bash
# Unit tests for the BT link-resilience helpers added 2026-06-09 after green/
# slot3 spent 95s in 3 spawn/teardown cycles before its A2DP link held, then
# dropped mid-session and never recovered (no escalation existed). Covers:
#   - bt_link_stable      : settle-window gate before committing to playback
#   - hci_for_mac         : adapter-name parse from the BlueZ device path
#   - cycle_adapter call  : heal_adapter_pscan no-ops with PSCAN, cycles without
#   - should_escalate_reset : when a sustained outage warrants an adapter reset
# All impure deps (date/sleep/bt_connected/device_path_for_mac/hciconfig) are
# stubbed so the test is deterministic and needs no real BT stack.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e   # production script enables `set -euo pipefail`; restore lenient mode

# --- bt_link_stable: deterministic virtual clock (only sleep advances it) ----
_clk=100
date() { [[ "$1" == "+%s" ]] && { echo "$_clk"; return 0; }; command date "$@"; }
sleep() { _clk=$((_clk + 1)); }

# Link stays up the whole window → stable (0).
bt_connected() { return 0; }
bt_link_stable "aa:bb" 4
assert_eq "0" "$?" "stable link returns 0"

# Link drops on the 3rd probe (well within the window) → not stable (1).
_clk=100
_calls=0
bt_connected() { _calls=$((_calls + 1)); (( _calls >= 3 )) && return 1; return 0; }
bt_link_stable "aa:bb" 4
assert_eq "1" "$?" "link dropping mid-settle returns 1"

# Link down from the first probe → not stable (1).
_clk=100
bt_connected() { return 1; }
bt_link_stable "aa:bb" 4
assert_eq "1" "$?" "link down at start returns 1"

# restore real-ish behavior for remaining tests
unset -f date sleep

# --- hci_for_mac: parse adapter name out of the BlueZ device path -----------
device_path_for_mac() { echo "/org/bluez/hci2/dev_41_42_8C_7C_77_5C"; }
assert_eq "hci2" "$(hci_for_mac 41:42:8C:7C:77:5C)" "hci_for_mac parses hciN"

device_path_for_mac() { echo "/org/bluez/hci0/dev_DE_AD"; }
assert_eq "hci0" "$(hci_for_mac de:ad)" "hci_for_mac parses hci0"

# Unresolvable device path → failure, no output.
device_path_for_mac() { return 1; }
hci_for_mac de:ad >/dev/null 2>&1
assert_eq "1" "$?" "hci_for_mac fails when device path unresolvable"

# --- heal_adapter_pscan: cycles only when PSCAN is MISSING -------------------
device_path_for_mac() { echo "/org/bluez/hci2/dev_X"; }
_cycled=""
cycle_adapter() { _cycled="$1"; }   # capture the hci it would power-cycle

# PSCAN present → healthy → no cycle, returns 1.
hciconfig() { echo "UP RUNNING PSCAN"; }
_cycled=""
heal_adapter_pscan X tag
assert_eq "1" "$?" "heal no-ops (returns 1) when PSCAN present"
assert_eq "" "$_cycled" "heal does NOT cycle adapter when PSCAN present"

# PSCAN missing → heal → cycles the adapter, returns 0.
hciconfig() { echo "UP RUNNING"; }
_cycled=""
heal_adapter_pscan X tag
assert_eq "0" "$?" "heal performs cycle (returns 0) when PSCAN missing"
assert_eq "hci2" "$_cycled" "heal cycles the resolved adapter when PSCAN missing"

# --- should_escalate_reset: escalate at the threshold, every multiple, capped -
CONNECT_ESCALATE_MISSES=3
CONNECT_ESCALATE_MAX=12
assert_false "should_escalate_reset 1" "no escalate at 1 miss"
assert_false "should_escalate_reset 2" "no escalate at 2 misses"
assert_true  "should_escalate_reset 3" "escalate at threshold (3)"
assert_false "should_escalate_reset 4" "no escalate at 4"
assert_false "should_escalate_reset 5" "no escalate at 5"
assert_true  "should_escalate_reset 6" "escalate again at 6 (backoff multiple)"
assert_true  "should_escalate_reset 9" "escalate again at 9"
assert_true  "should_escalate_reset 12" "escalate at the cap (12)"
assert_false "should_escalate_reset 15" "no escalate past the cap (15) — headset is off, stop churning"
assert_false "should_escalate_reset 39" "no escalate far past the cap (39)"
assert_false "should_escalate_reset abc" "non-numeric never escalates"
assert_false "should_escalate_reset 0" "zero never escalates"

teardown_tmp; finish
