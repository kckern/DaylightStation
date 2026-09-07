#!/usr/bin/env bash
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e
MEMBERSHIP_STALE_SEC=120; MEMBERSHIP_RESTART_COOLDOWN=300
LOG="$HOME/log"; logev(){ echo "$2 ${*:3}" >> "$LOG"; }; dispatch_alert(){ echo "alert $2" >> "$LOG"; }
CALLS="$HOME/calls"; : > "$CALLS"; systemctl(){ echo restart >> "$CALLS"; }; NOW=1000; date(){ [[ "$1" == '+%s' ]] && echo "$NOW" || command date "$@"; }
membership_heartbeat
assert_eq "1000" "$(cat "$MEMBERSHIP_HEARTBEAT_FILE")" "heartbeat stamps current epoch"
membership_health_tick
assert_eq "0" "$(wc -l < "$CALLS")" "fresh heartbeat does not restart hub"
echo 800 > "$MEMBERSHIP_HEARTBEAT_FILE"; membership_health_tick
sleep 0.1; assert_eq "1" "$(wc -l < "$CALLS")" "stale heartbeat restarts hub"
assert_true "grep -q membership_stale '$LOG'" "stale worker is logged"
membership_health_tick
assert_eq "1" "$(wc -l < "$CALLS")" "restart cooldown prevents a loop"
unset -f date; teardown_tmp; finish
