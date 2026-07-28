#!/usr/bin/env bash
# Audio-stack recovery circuit: sink-related launch failures escalate only
# after a streak, restart the user audio graph once, verify the sink, and clear
# the streak after recovery. All external services are stubbed.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e
shim_flock_if_absent

BASE_DIR="$HOME/playback-hub"
mkdir -p "$BASE_DIR/slots/1"
CONFIG_FILE="$HOME/devices.json"
cat > "$CONFIG_FILE" <<'JSON'
{"devices":[{"slot":1,"color":"red","mac":"AA:BB:CC:DD:EE:FF","name":"red"}]}
JSON

AUDIO_RECOVERY_FAILURES=3
AUDIO_RECOVERY_WINDOW=120
AUDIO_RECOVERY_COOLDOWN=300
AUDIO_RECOVERY_VERIFY=2
HUB_RECOVERY_AFTER_AUDIO=2
HUB_RECOVERY_COOLDOWN=1800

logev() { echo "evt=$2 ${*:3}" >> "$HOME/events.log"; }
dispatch_alert() { echo "alert=$2" >> "$HOME/events.log"; }

SINK=0
audio_sink_available() { [[ "$SINK" == 1 ]]; }
SYSTEMCTL_CALLS=0
systemctl() {
    SYSTEMCTL_CALLS=$((SYSTEMCTL_CALLS + 1))
    SINK=1
    return 0
}
timeout() {
    while [[ "$1" == -* || "$1" =~ ^[0-9]+$ ]]; do shift; done
    "$@"
}

assert_eq 1 "$(note_audio_start_failure 1)" "first failure starts streak"
assert_eq 2 "$(note_audio_start_failure 1)" "second failure increments streak"
recover_audio_stack 1 red AA:BB:CC:DD:EE:FF 2
assert_eq 0 "$SYSTEMCTL_CALLS" "below threshold does not restart audio"

assert_eq 3 "$(note_audio_start_failure 1)" "third failure reaches threshold"
recover_audio_stack 1 red AA:BB:CC:DD:EE:FF 3
assert_eq 1 "$SYSTEMCTL_CALLS" "threshold restarts audio once"
assert_false "test -e '$BASE_DIR/slots/1/.audio_start_failures'" "recovery clears slot failure streak"
assert_true "grep -q 'audio.stack_recovered' '$HOME/events.log'" "successful recovery is observable"

# A healthy sink must not trigger another recovery, even if called directly.
recover_audio_stack 1 red AA:BB:CC:DD:EE:FF 3
assert_eq 1 "$SYSTEMCTL_CALLS" "cooldown prevents repeated restart"

teardown_tmp; finish
