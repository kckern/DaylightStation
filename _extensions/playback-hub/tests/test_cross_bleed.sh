#!/usr/bin/env bash
# check_cross_bleed: ground-truth PipeWire cross-bleed detector. A bluez headset
# sink fed by MORE THAN ONE mpv stream means one slot's audio has migrated onto
# ANOTHER slot's headset (the "2 streams on yellow, none on red" failure). Always
# a bug — a sink has exactly one legitimate owner. The detector logs
# audio.cross_bleed (attributed to the VICTIM slot, resolved mac->slot from the
# config), dispatches a cross_bleed alert ONCE per streak (stamp
# $BASE_DIR/.cross_bleed_active, cleared when the graph goes clean), and NEVER
# kills — remediation stays with mpv_check_orphan_sink. pw-link is stubbed as a
# bash function (command -v finds functions); dispatch_alert/logev record calls.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e

mkdir -p "$BASE_DIR"
STAMP="$BASE_DIR/.cross_bleed_active"

# Real config so mac->slot resolution runs (underscore mac -> colon -> slot).
CONFIG_FILE="$HOME/devices.json"
cat > "$CONFIG_FILE" <<'JSON'
{"devices":[{"slot":1,"color":"red","mac":"41:42:3A:E5:43:07"},{"slot":2,"color":"yellow","mac":"41:42:9A:E3:65:73"}]}
JSON

# --- stubs: record logev + dispatch_alert invocations ---
LOGF="$HOME/log.txt"; : > "$LOGF"
logev() { echo "slot=$1 evt=$2 ${*:3}" >> "$LOGF"; }
ALERTF="$HOME/alert.txt"; : > "$ALERTF"
dispatch_alert() { echo "sev=$1 evt=$2" >> "$ALERTF"; }
logged() { grep -c "$1" "$LOGF" 2>/dev/null; true; }
alerted() { grep -c "$1" "$ALERTF" 2>/dev/null; true; }
reset_rec() { : > "$LOGF"; : > "$ALERTF"; }

# --- pw-link stub (function; command -v resolves it) driven by $GRAPH ---
GRAPH="clean"
pw-link() {
    case "$GRAPH" in
        clean)  # each sink fed by exactly one mpv stream
            printf '%s\n' \
                "bluez_output.41_42_3A_E5_43_07.1:playback_FL" "  |<- mpv:output_FL" \
                "bluez_output.41_42_9A_E3_65_73.1:playback_FL" "  |<- mpv:output_FL" ;;
        doubled_yellow)  # yellow's sink fed by TWO mpv streams
            printf '%s\n' \
                "bluez_output.41_42_9A_E3_65_73.1:playback_FL" "  |<- mpv:output_FL" "  |<- mpv:output_FL" \
                "bluez_output.41_42_3A_E5_43_07.1:playback_FL" "  |<- mpv:output_FL" ;;
    esac
}

# === Clean graph: no event, no alert, no stamp ===
reset_rec; rm -f "$STAMP"; GRAPH="clean"
check_cross_bleed
assert_eq "0" "$(logged audio.cross_bleed)" "clean: no cross_bleed event"
assert_eq "0" "$(alerted cross_bleed)" "clean: no alert"
assert_false "test -e '$STAMP'" "clean: no stamp"

# === Doubled yellow: event attributed to VICTIM slot 2, alert once, stamp set ===
reset_rec; rm -f "$STAMP"; GRAPH="doubled_yellow"
check_cross_bleed
assert_eq "1" "$(logged 'slot=2 evt=audio.cross_bleed')" "doubled: event on victim slot 2"
assert_eq "1" "$(alerted 'evt=cross_bleed')" "doubled: alert fired once"
assert_true "test -e '$STAMP'" "doubled: streak stamp set"

# === Still doubled next tick: streak suppresses re-alert ===
reset_rec; GRAPH="doubled_yellow"
check_cross_bleed
assert_eq "0" "$(alerted 'evt=cross_bleed')" "persist: no re-alert while streak active"

# === Back to clean: stamp cleared so a future episode re-alerts ===
reset_rec; GRAPH="clean"
check_cross_bleed
assert_false "test -e '$STAMP'" "recovered: stamp cleared"

# === New episode after recovery re-alerts ===
reset_rec; GRAPH="doubled_yellow"
check_cross_bleed
assert_eq "1" "$(alerted 'evt=cross_bleed')" "new episode: re-alerts after recovery"

teardown_tmp; finish
