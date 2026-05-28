#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$HOME/headset-hub"
CONFIG_YML="$BASE_DIR/devices.yml"
CONFIG_JSON_LEGACY="$BASE_DIR/devices.json"
CONFIG_FILE="$BASE_DIR/.devices.runtime.json"
API_BASE="https://daylightlocal.kckern.net"
API_FALLBACK_BASE="http://10.0.0.10:3111"
REFRESH_INTERVAL=300       # seconds between queue refreshes (full playlist re-fetch)
WATCHDOG_INTERVAL=5        # seconds between mpv liveness checks (tight respawn)
SCHEDULE_TICK_INTERVAL=30  # seconds between scheduled-fire checks
SELFCHECK_INTERVAL=300     # seconds between self-check (missed fires, orphans)
BT_WAKE_TIMEOUT=60         # max seconds to wait for BT after HA turn_on
DUPE_FIRE_WINDOW=60        # window in which a scheduled time matches "now"
LAZY_PRIME_COUNT=5         # tracks to download synchronously before starting mpv
MIN_AUDIO_BYTES=2048
SCHEDULED_STATE_FILE="$BASE_DIR/.scheduled-state.json"

# Regenerate the runtime JSON cache from devices.yml so the rest of
# headset-hub.sh can keep using jq. Called at startup and from the
# refresh loop so edits to devices.yml are picked up within
# REFRESH_INTERVAL seconds. Falls back to legacy devices.json if
# YAML is absent.
refresh_config_cache() {
    if [[ -f "$CONFIG_YML" ]]; then
        # Validate + convert via dedicated python script. On any validation
        # failure, the previous good runtime cache is preserved and the
        # error is logged. Caller (alarm loop, etc.) continues with stale
        # but known-valid config.
        local validator="$BASE_DIR/validate_config.py"
        if [[ ! -f "$validator" ]]; then
            echo "[$(date '+%H:%M:%S')] [config] validator missing at $validator; falling back to permissive parse" >&2
            if python3 -c "import yaml, json, sys; json.dump(yaml.safe_load(open('$CONFIG_YML')), sys.stdout)" \
                > "${CONFIG_FILE}.tmp" 2>/dev/null; then
                mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
                return 0
            fi
            rm -f "${CONFIG_FILE}.tmp"
            return 1
        fi

        if python3 "$validator" "$CONFIG_YML" \
            > "${CONFIG_FILE}.tmp" 2>"${CONFIG_FILE}.err"; then
            mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
            rm -f "${CONFIG_FILE}.err"
            return 0
        fi
        local err
        err=$(cat "${CONFIG_FILE}.err" 2>/dev/null | tr '\n' ' ' | head -c 500)
        rm -f "${CONFIG_FILE}.tmp" "${CONFIG_FILE}.err"
        echo "[$(date '+%H:%M:%S')] [config] $err — keeping previous cache" >&2
        return 1
    fi
    if [[ -f "$CONFIG_JSON_LEGACY" ]]; then
        cp "$CONFIG_JSON_LEGACY" "$CONFIG_FILE"
        return 0
    fi
    return 1
}

log() { echo "[$(date '+%H:%M:%S')] [$1] $2"; }

slot_dir() { echo "$BASE_DIR/slots/$1"; }

# =====================================================================
# Alerts — log + optional HA notify dispatch
# =====================================================================

# dispatch_alert <severity> <event> <message>
# Always logs via `logger -t headset-hub-alert`. If alerts.on_<event> in
# the config is "notify", also calls the configured HA notify service
# (via DaylightStation's /ha/call) so the user gets a phone push.
dispatch_alert() {
    local severity="$1" event="$2" message="$3"
    logger -t headset-hub-alert "[$severity] $event: $message" 2>/dev/null || true
    log "alert" "[$severity] $event: $message"

    local route
    route=$(jq -r --arg e "$event" '.alerts["on_" + $e] // "log"' "$CONFIG_FILE" 2>/dev/null)
    [[ "$route" != "notify" ]] && return 0

    local service
    service=$(jq -r '.alerts.channels.ha_notify.service // empty' "$CONFIG_FILE" 2>/dev/null)
    if [[ -z "$service" ]]; then
        log "alert" "notify route requested but alerts.channels.ha_notify.service unset"
        return 0
    fi

    # Strip "notify." prefix if present — haGateway.callService expects
    # the bare service name as the second arg, not "notify.kc_phone".
    local svc_name="${service#notify.}"
    local base_url ha_path
    base_url=$(jq -r '.daylight_station.base_url // empty' "$CONFIG_FILE" 2>/dev/null)
    ha_path=$(jq -r '.daylight_station.ha_call_path // "/api/v1/home-automation/ha/call"' "$CONFIG_FILE" 2>/dev/null)
    [[ -z "$base_url" ]] && return 0

    local payload
    payload=$(jq -n --arg msg "[$severity] $event: $message" \
        '{domain:"notify", service:"'"$svc_name"'", data:{message:$msg}}')
    curl -sf --connect-timeout 5 --max-time 10 \
        -X POST -H "Content-Type: application/json" \
        -d "$payload" "${base_url}${ha_path}" >/dev/null 2>&1 || \
        log "alert" "HA notify failed (would have sent: $message)"
}

# =====================================================================
# HA gateway + scheduled-fire support
# =====================================================================

# Call DaylightStation's /ha/call endpoint to invoke a Home Assistant
# service. Retries with 2/4/8s exponential backoff on failure. Returns 0
# on success, non-zero on total failure.
#
# Usage: ha_call_service <domain> <service> <entity_id>
ha_call_service() {
    local domain="$1" service="$2" entity_id="$3"
    local base_url ha_path timeout
    base_url=$(jq -r '.daylight_station.base_url // empty' "$CONFIG_FILE" 2>/dev/null)
    ha_path=$(jq -r '.daylight_station.ha_call_path // "/api/v1/home-automation/ha/call"' "$CONFIG_FILE" 2>/dev/null)
    timeout=$(jq -r '.daylight_station.request_timeout_sec // 10' "$CONFIG_FILE" 2>/dev/null)
    [[ -z "$base_url" ]] && { log "ha_call" "no daylight_station.base_url configured"; return 1; }

    local payload="{\"domain\":\"$domain\",\"service\":\"$service\",\"data\":{\"entity_id\":\"$entity_id\"}}"
    local attempt sleeps=(2 4 8)
    for attempt in 0 1 2; do
        if curl -sf --connect-timeout 5 --max-time "$timeout" \
            -X POST -H "Content-Type: application/json" \
            -d "$payload" "${base_url}${ha_path}" >/dev/null 2>&1; then
            return 0
        fi
        if (( attempt < 2 )); then
            log "ha_call" "$domain.$service $entity_id failed (attempt $((attempt+1))), retrying in ${sleeps[$attempt]}s"
            sleep "${sleeps[$attempt]}"
        fi
    done
    log "ha_call" "$domain.$service $entity_id FAILED after 3 attempts"
    return 1
}

# Today's day name (mon|tue|wed|thu|fri|sat|sun, lowercase).
today_day_name() {
    date +%a | tr '[:upper:]' '[:lower:]' | cut -c1-3
}

# Check if today matches a scheduled entry's `days` value. Accepts:
#   - "all" / "weekdays" / "weekends"
#   - JSON array like ["mon","wed","fri"]
day_matches() {
    local days_json="$1"
    local today
    today=$(today_day_name)
    # String form
    local s
    s=$(jq -r 'if type == "string" then . else empty end' <<< "$days_json" 2>/dev/null)
    case "$s" in
        all) return 0 ;;
        weekdays)
            [[ "$today" == "mon" || "$today" == "tue" || "$today" == "wed" \
            || "$today" == "thu" || "$today" == "fri" ]] && return 0 || return 1
            ;;
        weekends)
            [[ "$today" == "sat" || "$today" == "sun" ]] && return 0 || return 1
            ;;
    esac
    # Array form
    jq -e --arg t "$today" 'if type == "array" then any(. == $t) else false end' \
        <<< "$days_json" >/dev/null 2>&1
}

# Current time in seconds since midnight (hh:mm:ss → seconds).
seconds_since_midnight() {
    local h m s
    IFS=: read -r h m s <<< "$(date +%H:%M:%S)"
    echo $((10#$h * 3600 + 10#$m * 60 + 10#$s))
}

# Parse an "HH:MM" string into seconds since midnight. Echoes -1 on bad input.
hhmm_to_seconds() {
    local hhmm="$1"
    if [[ ! "$hhmm" =~ ^([0-9]{1,2}):([0-9]{2})$ ]]; then
        echo -1
        return
    fi
    echo $((10#${BASH_REMATCH[1]} * 3600 + 10#${BASH_REMATCH[2]} * 60))
}

# Check if "now" is within [target_hhmm, target_hhmm + DUPE_FIRE_WINDOW].
time_in_fire_window() {
    local target_hhmm="$1"
    local target_sec now_sec
    target_sec=$(hhmm_to_seconds "$target_hhmm")
    (( target_sec < 0 )) && return 1
    now_sec=$(seconds_since_midnight)
    (( now_sec >= target_sec && now_sec < target_sec + DUPE_FIRE_WINDOW ))
}

# Atomic write helper for state files. Writes content to .tmp then renames.
atomic_write_json() {
    local path="$1" content="$2"
    local tmp="${path}.tmp.$$"
    echo "$content" > "$tmp" && mv "$tmp" "$path"
}

# Read the persisted scheduled-state JSON. Echoes "{}" on missing/corrupt.
read_scheduled_state() {
    if [[ -f "$SCHEDULED_STATE_FILE" ]]; then
        cat "$SCHEDULED_STATE_FILE" 2>/dev/null || echo "{}"
    else
        echo "{}"
    fi
}

# Set state[id].last_fired_date = today (and optionally state[id].auto_stop_at).
mark_scheduled_fired() {
    local id="$1" auto_stop_epoch="$2"
    local state today
    state=$(read_scheduled_state)
    today=$(date +%Y-%m-%d)
    if [[ -n "$auto_stop_epoch" ]]; then
        state=$(jq --arg id "$id" --arg today "$today" --argjson stop "$auto_stop_epoch" \
            '.[$id] = { last_fired_date: $today, auto_stop_at: $stop }' <<< "$state")
    else
        state=$(jq --arg id "$id" --arg today "$today" \
            '.[$id] = { last_fired_date: $today }' <<< "$state")
    fi
    atomic_write_json "$SCHEDULED_STATE_FILE" "$state"
}

# Has this entry id already fired today?
scheduled_fired_today() {
    local id="$1"
    local today expected
    today=$(date +%Y-%m-%d)
    expected=$(jq -r --arg id "$id" '.[$id].last_fired_date // ""' \
        <<< "$(read_scheduled_state)" 2>/dev/null)
    [[ "$expected" == "$today" ]]
}

# Write the armed.json sentinel for a slot. start_playback reads this
# instead of the device's static `queue` when armed.
arm_slot() {
    local slot="$1" queue="$2" volume="$3" duration_min="$4" source="$5"
    local dir armed_path payload
    dir=$(slot_dir "$slot")
    mkdir -p "$dir"
    armed_path="$dir/.armed.json"
    payload=$(jq -n \
        --arg queue "$queue" \
        --arg vol "$volume" \
        --arg dur "$duration_min" \
        --arg src "$source" \
        --arg t "$(date +%s)" \
        '{queue:$queue, volume:($vol|tonumber? // null),
          duration_min:($dur|tonumber? // null), source:$src,
          armed_at: ($t|tonumber)}')
    atomic_write_json "$armed_path" "$payload"
}

disarm_slot() {
    rm -f "$(slot_dir "$1")/.armed.json"
}

# Read a single field from the armed.json (or empty if not armed).
armed_field() {
    local slot="$1" field="$2"
    local path
    path=$(slot_dir "$slot")/.armed.json
    [[ -f "$path" ]] || { echo ""; return; }
    jq -r --arg f "$field" '.[$f] // empty' "$path" 2>/dev/null
}

# Poll BlueZ until the device is Connected, or timeout. Returns 0 on
# connect, non-zero on timeout.
wait_for_bt_connect() {
    local mac="$1" timeout_sec="${2:-$BT_WAKE_TIMEOUT}"
    local deadline=$(( $(date +%s) + timeout_sec ))
    local path conn
    while (( $(date +%s) < deadline )); do
        if path=$(device_path_for_mac "$mac" 2>/dev/null); then
            conn=$(busctl --system get-property org.bluez "$path" \
                org.bluez.Device1 Connected 2>/dev/null)
            [[ "$conn" == "b true" ]] && return 0
        fi
        sleep 0.5
    done
    return 1
}

# fire_scheduled — orchestrate a one-shot wake fire for a `scheduled:` entry.
# Steps:
#   1) Resolve target device → look up class + ha_entity_id + mac
#   2) Arm the slot (write .armed.json with queue/volume/duration)
#   3) For public devices: HA turn_on, wait up to BT_WAKE_TIMEOUT for BT
#   4) For private devices: existing watchdog/connect path picks up the
#      armed config and plays
#   5) Record mark_scheduled_fired with auto-stop epoch (if duration_min set)
fire_scheduled() {
    local entry_json="$1"
    local id target queue volume duration_min
    id=$(jq -r '.id // "anon"' <<< "$entry_json")
    target=$(jq -r '.target // empty' <<< "$entry_json")
    queue=$(jq -r '.queue // empty' <<< "$entry_json")
    volume=$(jq -r '.volume // empty' <<< "$entry_json")
    duration_min=$(jq -r '.duration_min // empty' <<< "$entry_json")

    if [[ -z "$target" || -z "$queue" ]]; then
        log "scheduled" "entry $id missing target or queue, skipping"
        return 1
    fi

    # Look up the target device
    local device_json mac slot cls ha_entity_id name
    device_json=$(jq -c --arg c "$target" \
        '.devices[] | select(.color == $c)' "$CONFIG_FILE" 2>/dev/null)
    if [[ -z "$device_json" ]]; then
        log "scheduled" "entry $id: unknown target color $target"
        return 1
    fi
    slot=$(jq -r '.slot' <<< "$device_json")
    mac=$(jq -r '.mac' <<< "$device_json")
    name=$(jq -r '.name // "device"' <<< "$device_json")
    cls=$(jq -r '.class // "private"' <<< "$device_json")
    ha_entity_id=$(jq -r '.ha_entity_id // empty' <<< "$device_json")

    local tag
    tag=$(device_tag "$slot" "$mac" "$name")
    log "scheduled" "firing entry=$id target=$target slot=$slot class=$cls"

    # Arm the slot — the connect/watchdog handlers will read this
    arm_slot "$slot" "$queue" "$volume" "$duration_min" "scheduled:$id"

    local auto_stop_epoch=""
    if [[ -n "$duration_min" && "$duration_min" != "null" ]]; then
        auto_stop_epoch=$(( $(date +%s) + duration_min * 60 ))
    fi

    if [[ "$cls" == "public" ]]; then
        if [[ -z "$ha_entity_id" ]]; then
            log "scheduled" "entry $id: public target missing ha_entity_id"
            disarm_slot "$slot"
            return 1
        fi
        if ! ha_call_service switch turn_on "$ha_entity_id"; then
            log "scheduled" "entry $id: HA turn_on $ha_entity_id failed"
            disarm_slot "$slot"
            mark_scheduled_fired "$id" "$auto_stop_epoch"
            dispatch_alert critical ha_call_fail \
                "scheduled $id: HA turn_on $ha_entity_id failed"
            return 1
        fi
        if ! wait_for_bt_connect "$mac" "$BT_WAKE_TIMEOUT"; then
            log "scheduled" "entry $id: BT did not connect within ${BT_WAKE_TIMEOUT}s"
            disarm_slot "$slot"
            mark_scheduled_fired "$id" "$auto_stop_epoch"
            dispatch_alert critical scheduled_fail \
                "scheduled $id ($target): BT did not connect within ${BT_WAKE_TIMEOUT}s after HA turn_on"
            return 1
        fi
        log "scheduled" "entry $id: BT connected, gdbus handler will start playback"
    else
        # Private — if not connected, just stay armed; whenever the
        # headset comes online it'll play.
        log "scheduled" "entry $id: private target, armed for next BT connect"
    fi

    mark_scheduled_fired "$id" "$auto_stop_epoch"
    return 0
}

# selfcheck_loop — runs every SELFCHECK_INTERVAL. Looks for:
#   - Scheduled entries that should have fired today but didn't (missed
#     fire due to a script crash or scheduling gap)
#   - .override.json files older than 1 hour (override stuck — kid's
#     music presumably never resumed)
#   - .armed.json files older than 5 min where mpv is not running and
#     BT is not connected (stuck armed state from a failed wake)
selfcheck_loop() {
    while true; do
        sleep "$SELFCHECK_INTERVAL"

        # 1) Missed scheduled fires
        local sched_count idx
        sched_count=$(jq '.scheduled | length // 0' "$CONFIG_FILE" 2>/dev/null) || sched_count=0
        local now_sec
        now_sec=$(seconds_since_midnight)
        for ((idx=0; idx<sched_count; idx++)); do
            local entry id time_str days_json target_sec
            entry=$(jq -c ".scheduled[$idx]" "$CONFIG_FILE") || continue
            id=$(jq -r '.id // empty' <<< "$entry")
            time_str=$(jq -r '.time // empty' <<< "$entry")
            days_json=$(jq -c '.days // "all"' <<< "$entry")
            [[ -z "$id" || -z "$time_str" ]] && continue
            day_matches "$days_json" || continue
            target_sec=$(hhmm_to_seconds "$time_str")
            # Was the fire window 5+ min ago AND we haven't fired today?
            if (( target_sec > 0 && now_sec > target_sec + DUPE_FIRE_WINDOW + 300 )) \
                && ! scheduled_fired_today "$id"; then
                dispatch_alert critical scheduled_fail \
                    "missed scheduled $id ($time_str) — never fired today"
                # Mark as fired to suppress repeat alerts
                mark_scheduled_fired "$id" ""
            fi
        done

        # 2) Override orphans (>1 hour old)
        local now_epoch slot age path
        now_epoch=$(date +%s)
        for slot in 1 2 3 4 5; do
            path=$(slot_dir "$slot")/.override.json
            [[ -f "$path" ]] || continue
            age=$((now_epoch - $(stat -c %Y "$path" 2>/dev/null || echo "$now_epoch")))
            if (( age > 3600 )); then
                dispatch_alert warning override_orphan \
                    "slot $slot .override.json is $((age/60)) min old — restore may have failed"
            fi
        done

        # 3) Stuck armed flags
        for slot in 1 2 3 4 5; do
            path=$(slot_dir "$slot")/.armed.json
            [[ -f "$path" ]] || continue
            age=$((now_epoch - $(stat -c %Y "$path" 2>/dev/null || echo "$now_epoch")))
            (( age <= 300 )) && continue  # younger than 5 min, give it time
            # Is mpv playing for this slot?
            local mpv_alive=false
            if [[ -f "$(slot_dir "$slot")/mpv.pid" ]]; then
                local p
                p=$(cat "$(slot_dir "$slot")/mpv.pid" 2>/dev/null)
                [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null && mpv_alive=true
            fi
            if ! $mpv_alive; then
                dispatch_alert warning scheduled_fail \
                    "slot $slot armed for $((age/60)) min but no mpv — clearing stuck flag"
                disarm_slot "$slot"
            fi
        done
    done
}

# scheduled_loop — background tick (every SCHEDULE_TICK_INTERVAL) that
# fires matching `scheduled:` entries and handles auto-stop. Restart-safe:
# re-reads .scheduled-state.json each tick so we never double-fire today.
scheduled_loop() {
    while true; do
        sleep "$SCHEDULE_TICK_INTERVAL"
        local count idx
        count=$(jq '.scheduled | length // 0' "$CONFIG_FILE" 2>/dev/null) || count=0
        for ((idx=0; idx<count; idx++)); do
            local entry id time_str days_json
            entry=$(jq -c ".scheduled[$idx]" "$CONFIG_FILE" 2>/dev/null) || continue
            id=$(jq -r '.id // empty' <<< "$entry")
            time_str=$(jq -r '.time // empty' <<< "$entry")
            days_json=$(jq -c '.days // "all"' <<< "$entry")
            [[ -z "$id" || -z "$time_str" ]] && continue

            if scheduled_fired_today "$id"; then
                continue
            fi
            if ! day_matches "$days_json"; then
                continue
            fi
            if time_in_fire_window "$time_str"; then
                fire_scheduled "$entry" || true
            fi
        done

        # Auto-stop handling: any entry whose auto_stop_at has passed and
        # whose target is still playing → stop_playback + disarm.
        local now_epoch
        now_epoch=$(date +%s)
        local state
        state=$(read_scheduled_state)
        local stop_ids
        stop_ids=$(jq -r --argjson now "$now_epoch" \
            'to_entries[] | select(.value.auto_stop_at and .value.auto_stop_at <= $now) | .key' \
            <<< "$state" 2>/dev/null)
        local sid
        while IFS= read -r sid; do
            [[ -z "$sid" ]] && continue
            local entry_json target_color slot mac name
            entry_json=$(jq -c --arg id "$sid" '.scheduled[]? | select(.id == $id)' "$CONFIG_FILE")
            [[ -z "$entry_json" ]] && continue
            target_color=$(jq -r '.target' <<< "$entry_json")
            local device_json
            device_json=$(jq -c --arg c "$target_color" '.devices[] | select(.color == $c)' "$CONFIG_FILE")
            slot=$(jq -r '.slot' <<< "$device_json")
            mac=$(jq -r '.mac' <<< "$device_json")
            name=$(jq -r '.name // "device"' <<< "$device_json")
            log "scheduled" "auto-stop firing for entry $sid (target=$target_color)"
            end_session "$slot" "$(device_tag "$slot" "$mac" "$name")" || true
            # Clear auto_stop_at so we don't repeat
            state=$(read_scheduled_state)
            state=$(jq --arg id "$sid" 'del(.[$id].auto_stop_at)' <<< "$state")
            atomic_write_json "$SCHEDULED_STATE_FILE" "$state"
        done <<< "$stop_ids"
    done
}

mac_to_dbus_path() { echo "$1" | tr ':' '_'; }

# Read the queue_base prefix from the top-level config object. Empty string
# if absent. Queues already containing a scheme (http/https) are passed
# through unchanged by resolve_queue_url().
queue_base() {
    jq -r '.queue_base // ""' "$CONFIG_FILE" 2>/dev/null
}

# Read the device class from a device JSON blob. Defaults to "private" so
# existing devices without an explicit class behave exactly as before.
device_class() {
    local device_json="$1"
    jq -r '.class // "private"' <<< "$device_json" 2>/dev/null
}

# Check if a slot has been armed by an external trigger (scheduled fire
# or POST /play). The armed file is created by P5/P6 code and consumed
# by start_playback. The mere presence of slots/N/.armed.json allows
# public devices to bypass the no-auto-play gate.
is_armed_for_play() {
    local slot="$1"
    [[ -f "$(slot_dir "$slot")/.armed.json" ]]
}

# Read volume settings for a slot from CONFIG_FILE. Echoes three values
# space-separated: "default min max". Missing fields fall back to safe
# defaults (default=60, min=0, max=100). Used by start_playback to set
# mpv --volume / --volume-max, and to tell avrcp_dispatch the clamps.
slot_volume() {
    local slot="$1"
    jq -r --argjson slot "$slot" \
        '.devices[] | select(.slot == $slot) | .volume // {} | "\(.default // 60) \(.min // 0) \(.max // 100)"' \
        "$CONFIG_FILE" 2>/dev/null
}

# Expand a queue value into a fully-qualified URL. Values starting with
# http/https are returned as-is (legacy / overrides). Bare IDs (or any
# value that's relative) are concatenated onto queue_base.
resolve_queue_url() {
    local value="$1"
    [[ -z "$value" ]] && return 0
    if [[ "$value" =~ ^https?:// ]]; then
        echo "$value"
    else
        local base
        base=$(queue_base)
        echo "${base}${value}"
    fi
}

device_tag() {
    local slot="$1" mac="$2" name="${3:-musiCozy}"
    echo "slot=$slot mac=$mac name=$name"
}

with_api_fallback() {
    local url="$1"
    echo "${url/https:\/\/daylightlocal.kckern.net/$API_FALLBACK_BASE}"
}

curl_api() {
    local url="$1"
    curl -sfL --connect-timeout 5 "$url" && return 0

    local fallback_url
    fallback_url=$(with_api_fallback "$url")
    if [[ "$fallback_url" != "$url" ]]; then
        curl -sfL --connect-timeout 5 "$fallback_url"
    else
        return 1
    fi
}

is_valid_queue_json() {
    local payload="$1"
    jq -e '.items and (.items | type == "array")' >/dev/null 2>&1 <<< "$payload"
}

file_size_bytes() {
    stat -c%s "$1" 2>/dev/null || echo 0
}

is_valid_audio_file() {
    local path="$1"
    local size
    size=$(file_size_bytes "$path")
    if (( size < MIN_AUDIO_BYTES )); then
        return 1
    fi

    if command -v file >/dev/null 2>&1; then
        local mime
        mime=$(file --brief --mime-type "$path" 2>/dev/null || true)
        case "$mime" in
            audio/*|application/octet-stream) return 0 ;;
            *) return 1 ;;
        esac
    fi

    return 0
}

download_media_file() {
    local url="$1" dest="$2" name="$3" plex_id="$4"
    local tmp="${dest}.tmp"

    if ! curl_api "$url" > "$tmp"; then
        rm -f "$tmp"
        log "$name" "Failed to download $plex_id"
        return 1
    fi

    if ! is_valid_audio_file "$tmp"; then
        local size
        size=$(file_size_bytes "$tmp")
        log "$name" "Rejected non-audio payload for $plex_id (${size} bytes)"
        rm -f "$tmp"
        return 1
    fi

    mv "$tmp" "$dest"
}

bool_enabled() {
    case "${1:-true}" in
        false|False|FALSE|0|no|No|NO|off|Off|OFF) return 1 ;;
        *) return 0 ;;
    esac
}

resolve_audio_device() {
    local mac="$1"
    local normalized="${mac//:/_}"
    local -a candidates=(
        "pipewire/bluez_output.${normalized}.1"
        "pulse/bluez_output.${normalized}.1"
    )
    local devices

    for _ in {1..12}; do
        devices=$(mpv --audio-device=help 2>/dev/null || true)
        for candidate in "${candidates[@]}"; do
            if grep -Fq "'$candidate'" <<< "$devices"; then
                echo "$candidate"
                return 0
            fi
        done
        sleep 1
    done

    return 1
}

device_path_for_mac() {
    local mac="$1"
    local dbus_id
    dbus_id=$(mac_to_dbus_path "$mac")

    local hci
    for hci in /sys/class/bluetooth/hci*; do
        [[ -e "$hci" ]] || continue
        local adapter="${hci##*/}"
        # Skip subordinate entries like hci1:2
        [[ "$adapter" == *:* ]] && continue
        local candidate="/org/bluez/${adapter}/dev_${dbus_id}"
        # Probe for an actual Device1 interface (not just an empty placeholder path)
        if busctl --system get-property org.bluez "$candidate" org.bluez.Device1 Address >/dev/null 2>&1; then
            echo "$candidate"
            return 0
        fi
    done

    return 1
}

media_control_connected() {
    local mac="$1"
    local path
    path=$(device_path_for_mac "$mac") || return 1

    local output
    output=$(busctl --system get-property org.bluez "$path" org.bluez.MediaControl1 Connected 2>/dev/null || true)
    [[ "$output" == "b true" ]]
}

# Resolve the adapter BD address for a paired headset MAC. The evdev
# device for the headset's AVRCP buttons exposes the adapter's BD in
# `/sys/class/input/eventN/device/phys`, so this gives us the match key.
adapter_bd_for_mac() {
    local mac="$1"
    local device_path
    device_path=$(device_path_for_mac "$mac") || return 1
    local adapter_path="${device_path%/dev_*}"
    busctl --system get-property org.bluez "$adapter_path" org.bluez.Adapter1 Address 2>/dev/null \
        | awk -F\" '{print tolower($2)}'
}

# Find the /dev/input/eventN node BlueZ created for this headset's AVRCP
# buttons. Each connected headset gets its own evdev node named
# "musiCozy (AVRCP)" with phys = the adapter's BD address.
# Returns the path on stdout, exits 1 if not found.
avrcp_event_for_mac() {
    local mac="$1"
    local adapter_bd
    adapter_bd=$(adapter_bd_for_mac "$mac") || return 1
    [[ -n "$adapter_bd" ]] || return 1

    local entry name phys ev_name
    for entry in /sys/class/input/event*/device; do
        [[ -e "$entry" ]] || continue
        name=$(cat "$entry/name" 2>/dev/null || true)
        phys=$(cat "$entry/phys" 2>/dev/null || true)
        if [[ "$name" == *"AVRCP"* ]] && [[ "${phys,,}" == "$adapter_bd" ]]; then
            ev_name=$(basename "${entry%/device}")
            echo "/dev/input/$ev_name"
            return 0
        fi
    done
    return 1
}

# Start the AVRCP key dispatcher for a slot. Reads buttons from the
# headset's evdev node and translates to mpv IPC commands. PID is
# tracked in slots/<N>/avrcp.pid so stop_playback can tear it down.
start_avrcp_dispatcher() {
    local slot="$1" name="$2" mac="$3"
    local dir
    dir=$(slot_dir "$slot")
    local socket="$dir/mpv-socket"

    # Retry briefly: the AVRCP evdev node can appear ~100-500ms after
    # the audio sink, depending on the headset's AVRCP profile timing.
    local event_path=""
    local attempt
    for attempt in {1..10}; do
        if event_path=$(avrcp_event_for_mac "$mac"); then
            break
        fi
        sleep 0.5
    done

    if [[ -z "$event_path" ]]; then
        log "$name" "No AVRCP evdev node found for $mac; headset buttons will not control playback"
        return 1
    fi

    if [[ ! -x "$BASE_DIR/avrcp_dispatch.py" ]]; then
        log "$name" "avrcp_dispatch.py missing or not executable; skipping button dispatcher"
        return 1
    fi

    # Pass per-slot volume clamps so the dispatcher knows how far VOL+/-
    # can move mpv's volume property.
    local vol_default vol_min vol_max
    read -r vol_default vol_min vol_max <<< "$(slot_volume "$slot")"
    : "${vol_default:=60}" "${vol_min:=0}" "${vol_max:=100}"

    python3 "$BASE_DIR/avrcp_dispatch.py" "$event_path" "$socket" "$name" \
        --min-volume "$vol_min" --max-volume "$vol_max" \
        >>"$dir/avrcp.log" 2>&1 &
    local pid=$!
    echo "$pid" > "$dir/avrcp.pid"
    log "$name" "AVRCP dispatcher started (pid $pid, evdev $event_path)"
}

stop_avrcp_dispatcher() {
    local slot="$1" name="$2"
    local dir
    dir=$(slot_dir "$slot")
    if [[ -f "$dir/avrcp.pid" ]]; then
        local pid
        pid=$(cat "$dir/avrcp.pid")
        kill "$pid" 2>/dev/null && log "$name" "Stopped AVRCP dispatcher (pid $pid)" || true
        rm -f "$dir/avrcp.pid"
    fi
}

time_to_minutes() {
    local value="$1"
    if [[ ! "$value" =~ ^([01]?[0-9]|2[0-3]):[0-5][0-9]$ ]]; then
        return 1
    fi

    local hour="${value%:*}"
    local minute="${value#*:}"
    echo $((10#$hour * 60 + 10#$minute))
}

time_in_window() {
    local start="$1" end="$2" now_minutes start_minutes end_minutes

    start_minutes=$(time_to_minutes "$start") || return 1
    end_minutes=$(time_to_minutes "$end") || return 1
    now_minutes=$(time_to_minutes "$(date '+%H:%M')") || return 1

    if (( start_minutes == end_minutes )); then
        return 0
    fi

    if (( start_minutes < end_minutes )); then
        (( now_minutes >= start_minutes && now_minutes < end_minutes ))
        return
    fi

    (( now_minutes >= start_minutes || now_minutes < end_minutes ))
}

active_schedule_json() {
    local device_json="$1"
    local count schedule_json start end idx

    count=$(jq '(.schedules // []) | length' <<< "$device_json")
    if (( count > 0 )); then
        for ((idx=0; idx<count; idx++)); do
            schedule_json=$(jq -c ".schedules[$idx]" <<< "$device_json")
            start=$(jq -r '.start // ""' <<< "$schedule_json")
            end=$(jq -r '.end // ""' <<< "$schedule_json")

            if [[ -z "$start" && -z "$end" ]]; then
                echo "$schedule_json"
                return 0
            fi

            if [[ -n "$start" && -n "$end" ]] && time_in_window "$start" "$end"; then
                echo "$schedule_json"
                return 0
            fi
        done

        return 1
    fi

    return 1
}

selected_queue() {
    local device_json="$1"
    local schedule_json raw

    if schedule_json=$(active_schedule_json "$device_json"); then
        raw=$(jq -r '.queue // ""' <<< "$schedule_json")
        resolve_queue_url "$raw"
        return 0
    fi

    local primary_queue alternate_queue alternate_start alternate_end
    primary_queue=$(jq -r '.queue // ""' <<< "$device_json")
    alternate_queue=$(jq -r '.alternate_queue // ""' <<< "$device_json")
    alternate_start=$(jq -r '.alternate_start // ""' <<< "$device_json")
    alternate_end=$(jq -r '.alternate_end // ""' <<< "$device_json")

    if [[ -n "$alternate_queue" && -n "$alternate_start" && -n "$alternate_end" ]] \
        && time_in_window "$alternate_start" "$alternate_end"; then
        resolve_queue_url "$alternate_queue"
    else
        resolve_queue_url "$primary_queue"
    fi
}

selected_shuffle() {
    local device_json="$1"
    local schedule_json

    if schedule_json=$(active_schedule_json "$device_json"); then
        jq -r '.shuffle // false' <<< "$schedule_json"
        return 0
    fi

    local primary_shuffle alternate_shuffle alternate_queue alternate_start alternate_end
    primary_shuffle=$(jq -r '.shuffle // false' <<< "$device_json")
    alternate_shuffle=$(jq -r '.alternate_shuffle // false' <<< "$device_json")
    alternate_queue=$(jq -r '.alternate_queue // ""' <<< "$device_json")
    alternate_start=$(jq -r '.alternate_start // ""' <<< "$device_json")
    alternate_end=$(jq -r '.alternate_end // ""' <<< "$device_json")

    if [[ -n "$alternate_queue" && -n "$alternate_start" && -n "$alternate_end" ]] \
        && time_in_window "$alternate_start" "$alternate_end"; then
        echo "$alternate_shuffle"
    else
        echo "$primary_shuffle"
    fi
}

save_position() {
    local slot="$1" name="$2"
    local dir=$(slot_dir "$slot")
    local socket="$dir/mpv-socket"

    if [[ -S "$socket" ]]; then
        local pos track
        pos=$(echo '{"command":["get_property","playback-time"]}' | socat - "$socket" 2>/dev/null | jq -r '.data // 0') || pos=0
        track=$(echo '{"command":["get_property","playlist-pos"]}' | socat - "$socket" 2>/dev/null | jq -r '.data // 0') || track=0
        echo "{\"track\": $track, \"position\": $pos}" > "$dir/state.json"
        log "$name" "Saved position: track=$track pos=$pos"
    fi
}

stop_playback() {
    local slot="$1" name="$2"
    local dir=$(slot_dir "$slot")

    # NOTE: this function intentionally does NOT disarm the slot or
    # call ha_turn_off. Those are explicit session-end actions handled
    # by `end_session` below. stop_playback is also invoked from
    # stop_all (service shutdown), where we want armed state to persist
    # so a mid-fire restart can resume on the next BT connect.

    # Kill any background downloader first — it would otherwise keep
    # writing tracks to playlist.m3u after mpv is gone, and on the next
    # start_playback those stale appends would diverge from the fresh
    # shuffle we're about to write.
    if [[ -f "$dir/downloader.pid" ]]; then
        local bg_pid
        bg_pid=$(cat "$dir/downloader.pid" 2>/dev/null)
        if [[ -n "$bg_pid" ]] && kill -0 "$bg_pid" 2>/dev/null; then
            kill "$bg_pid" 2>/dev/null || true
            log "$name" "stopped bg downloader pid=$bg_pid"
        fi
        rm -f "$dir/downloader.pid" "$dir/.bg_remaining"
    fi

    stop_avrcp_dispatcher "$slot" "$name"
    save_position "$slot" "$name"
    if [[ -f "$dir/mpv.pid" ]]; then
        local pid
        pid=$(cat "$dir/mpv.pid")
        kill "$pid" 2>/dev/null && log "$name" "Stopped mpv (pid $pid)" || true
        rm -f "$dir/mpv.pid"
    fi
    rm -f "$dir/mpv-socket"
}

# Explicit session end. Called on BT disconnect, scheduled auto-stop, and
# the POST /play `stop` action. Unlike stop_playback (which only kills
# mpv + cleans up files), this ALSO disarms the slot and fires the
# optional HA turn_off, ending the logical "play session" entirely.
end_session() {
    local slot="$1" name="$2"
    stop_playback "$slot" "$name"
    disarm_slot "$slot"

    # Optional ha_turn_off_on_stop — used by public devices to power off
    # the bedroom light when the alarm finishes its duration.
    local device_json ha_off ha_eid
    device_json=$(jq -c --arg s "$slot" \
        '.devices[] | select((.slot|tostring) == $s)' "$CONFIG_FILE" 2>/dev/null)
    if [[ -n "$device_json" ]]; then
        ha_off=$(jq -r '.ha_turn_off_on_stop // false' <<< "$device_json")
        ha_eid=$(jq -r '.ha_entity_id // empty' <<< "$device_json")
        if [[ "$ha_off" == "true" && -n "$ha_eid" ]]; then
            log "$name" "ha_turn_off_on_stop set, firing switch.turn_off $ha_eid"
            ha_call_service switch turn_off "$ha_eid" || true
        fi
    fi
}

fetch_and_cache() {
    # Lazy/streaming mode: prime the first LAZY_PRIME_COUNT tracks
    # synchronously, write the partial playlist, then fork a background
    # downloader that fetches the remaining tracks and APPENDs them to
    # both playlist.m3u and mpv's in-memory list. This lets a cold queue
    # of 200+ tracks start playing within seconds instead of minutes.
    local slot="$1" name="$2" queue_url="$3" shuffle="${4:-false}"
    local dir=$(slot_dir "$slot")
    local playlist_tmp="$dir/playlist.m3u.tmp"

    mkdir -p "$dir/cache"

    # Kill any prior background downloader for this slot before
    # rewriting the playlist — otherwise it'd race with the new shuffle.
    if [[ -f "$dir/downloader.pid" ]]; then
        local old_pid
        old_pid=$(cat "$dir/downloader.pid" 2>/dev/null)
        if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
            kill "$old_pid" 2>/dev/null || true
            log "$name" "killed prior bg downloader pid=$old_pid"
        fi
        rm -f "$dir/downloader.pid"
    fi

    local queue_json
    if ! queue_json=$(curl_api "$queue_url"); then
        if [[ -f "$dir/playlist.m3u" ]]; then
            log "$name" "API unavailable, using cached playlist"
            return 0
        fi
        log "$name" "No API and no cached playlist, nothing to play"
        return 1
    fi

    if ! is_valid_queue_json "$queue_json"; then
        log "$name" "Queue response was not valid JSON items payload"
        return 1
    fi
    log "$name" "Fetched queue from API"

    local count
    count=$(echo "$queue_json" | jq '.items | length')

    # Build the canonical track order (shuffled if requested). We
    # shuffle INDEX positions so both the synchronous prime and the
    # background downloader walk tracks in the same order — the
    # playlist appears in shuffled order from track 1.
    local -a ordered_indices=()
    if bool_enabled "$shuffle"; then
        mapfile -t ordered_indices < <(seq 0 $((count - 1)) | shuf)
        log "$name" "Shuffled playlist order (shuf/urandom)"
    else
        mapfile -t ordered_indices < <(seq 0 $((count - 1)))
    fi

    # Extract per-track metadata once into parallel arrays (avoids
    # re-parsing the queue JSON repeatedly).
    local -a track_ids=() track_urls=() track_titles=() track_files=()
    local i orig_idx
    for orig_idx in "${ordered_indices[@]}"; do
        local plex_id media_path title cached_file safe_title
        plex_id=$(echo "$queue_json" | jq -r ".items[$orig_idx].contentId" | sed 's/plex://')
        media_path=$(echo "$queue_json" | jq -r ".items[$orig_idx].mediaUrl")
        title=$(echo "$queue_json" | jq -r ".items[$orig_idx].title")
        cached_file="$dir/cache/${plex_id}.mp3"
        safe_title=$(printf '%s' "$title" | tr '\t\n\r' '   ' | sed 's/  */ /g')
        [[ -z "$safe_title" || "$safe_title" == "null" ]] && safe_title="$plex_id"
        track_ids+=("$plex_id")
        track_urls+=("${API_BASE}${media_path}")
        track_titles+=("$safe_title")
        track_files+=("$cached_file")
    done
    local total=${#track_ids[@]}

    # Phase 1: synchronously prime the first LAZY_PRIME_COUNT tracks.
    echo "#EXTM3U" > "$playlist_tmp"
    local primed=0
    local first_pending_idx=0
    local target_prime=$((LAZY_PRIME_COUNT < total ? LAZY_PRIME_COUNT : total))

    for ((i=0; i<total && primed<target_prime; i++)); do
        local plex_id="${track_ids[$i]}"
        local url="${track_urls[$i]}"
        local title="${track_titles[$i]}"
        local cached_file="${track_files[$i]}"

        if [[ -f "$cached_file" ]] && is_valid_audio_file "$cached_file"; then
            log "$name" "Cached: $title ($plex_id)"
        else
            log "$name" "Priming: $title ($plex_id)"
            rm -f "$cached_file"
            if ! download_media_file "$url" "$cached_file" "$name" "$plex_id"; then
                log "$name" "Failed to prime $plex_id, skipping"
                continue
            fi
        fi
        printf '#EXTINF:-1,%s\n%s\n' "$title" "$cached_file" >> "$playlist_tmp"
        primed=$((primed + 1))
    done
    first_pending_idx=$i

    if (( primed == 0 )); then
        log "$name" "No primed tracks; queue produced no playable files"
        rm -f "$playlist_tmp"
        return 1
    fi

    mv "$playlist_tmp" "$dir/playlist.m3u"
    log "$name" "Playlist primed: $primed of $total tracks (rest will stream in background)"

    # Phase 2: fork a background downloader for the remaining tracks.
    # The BG appends each new track to both playlist.m3u (so a future
    # mpv restart sees the full list) and to mpv's running playlist
    # via loadfile … append.
    if (( first_pending_idx < total )); then
        local socket="$dir/mpv-socket"
        local bg_state="$dir/.bg_remaining"
        : > "$bg_state"
        local j
        for ((j=first_pending_idx; j<total; j++)); do
            printf '%s\t%s\t%s\t%s\n' \
                "${track_ids[$j]}" "${track_urls[$j]}" \
                "${track_files[$j]}" "${track_titles[$j]}" >> "$bg_state"
        done

        # Spawn the downloader. exec 9>&- closes the inherited flock fd
        # so the lock isn't held for the lifetime of the background job.
        # set +e so a single failed download doesn't abort the whole loop.
        (
            exec 9>&-
            set +e
            local line plex_id url cached_file title
            while IFS=$'\t' read -r plex_id url cached_file title; do
                if [[ -f "$cached_file" ]] && is_valid_audio_file "$cached_file"; then
                    :
                else
                    rm -f "$cached_file"
                    if ! download_media_file "$url" "$cached_file" "$name" "$plex_id"; then
                        log "$name" "[bg] failed download $plex_id"
                        continue
                    fi
                fi
                printf '#EXTINF:-1,%s\n%s\n' "$title" "$cached_file" >> "$dir/playlist.m3u"
                if [[ -S "$socket" ]]; then
                    echo "{\"command\":[\"loadfile\",\"$cached_file\",\"append\"]}" \
                        | socat - "$socket" >/dev/null 2>&1
                fi
            done < "$bg_state"
            rm -f "$bg_state" "$dir/downloader.pid"
            log "$name" "[bg] all tracks cached and appended"
        ) &
        echo $! > "$dir/downloader.pid"
        log "$name" "bg downloader spawned pid=$!"
    fi
}

reload_mpv_playlist() {
    local slot="$1" name="$2"
    local dir=$(slot_dir "$slot")
    local socket="$dir/mpv-socket"

    if [[ ! -S "$socket" ]]; then
        log "$name" "reload_mpv_playlist: no socket at $socket, mpv not running"
        return 1
    fi

    # Explicit "replace" flag — mpv's loadlist default has varied across
    # versions (older mpv defaults to append-play). With "replace" we
    # guarantee mpv discards its current in-memory list and loads the
    # file fresh, so file and mpv stay in sync.
    local response
    response=$(echo "{\"command\":[\"loadlist\",\"$dir/playlist.m3u\",\"replace\"]}" \
        | socat - "$socket" 2>&1) || {
        log "$name" "reload_mpv_playlist: socat failed: $response"
        return 1
    }

    if echo "$response" | grep -q '"error":"success"'; then
        log "$name" "Reloaded playlist in mpv (replace)"
    else
        log "$name" "reload_mpv_playlist: mpv response not success: $response"
        return 1
    fi
}

start_playback() {
    local slot="$1" name="$2" mac="$3" queue="$4" shuffle="$5" resume_queue="${6:-true}" resume_track="${7:-true}"
    local dir=$(slot_dir "$slot")
    local start_track=0 start_pos=0
    local audio_device
    local load_scripts="no"

    # Guardrail 1: per-slot lock prevents concurrent start_playback calls
    # (gdbus connect handler + watchdog can both fire at once). Without
    # this, two callers each pass the "is mpv alive?" check and each
    # spawn an mpv, resulting in overlapping audio streams to the same
    # BT sink.
    mkdir -p "$dir"
    exec 9>"$dir/playback.lock"
    if ! flock -n 9; then
        log "$name" "start_playback skipped: another call already in progress"
        exec 9>&-
        return 0
    fi

    # Guardrail 2: kill any orphan mpv processes targeting this slot's
    # socket. Catches survivors of crashes or earlier race wins whose
    # pid was overwritten in mpv.pid. The socket path is unique per slot
    # so pkill -f is precise.
    local orphans
    orphans=$(pgrep -f "input-ipc-server=$dir/mpv-socket" 2>/dev/null || true)
    if [[ -n "$orphans" ]]; then
        log "$name" "killing orphan mpv pid(s): $(echo $orphans | tr '\n' ' ')"
        echo "$orphans" | xargs -r kill 2>/dev/null || true
        sleep 0.3
        # Force-kill anything that survived SIGTERM
        echo "$orphans" | xargs -r kill -9 2>/dev/null || true
    fi
    rm -f "$dir/mpv-socket"

    # Guardrail 3: fetch_and_cache must run INSIDE the lock. Previously
    # callers ran `fetch_and_cache && start_playback`, but that lets a
    # losing-the-flock caller still rewrite playlist.m3u with their own
    # shuffle while the winning caller's mpv has already loaded the
    # earlier content — producing playlist drift (mpv plays one order,
    # file shows another).
    if ! fetch_and_cache "$slot" "$name" "$queue" "$shuffle"; then
        log "$name" "fetch_and_cache failed; not starting mpv"
        exec 9>&-
        return 1
    fi

    if ! audio_device=$(resolve_audio_device "$mac"); then
        log "$name" "No audio sink became ready for $mac; refusing to start with auto routing"
        exec 9>&-
        return 1
    fi

    if media_control_connected "$mac"; then
        load_scripts="yes"
        log "$name" "MediaControl active for $mac; enabling MPRIS export"
    else
        log "$name" "MediaControl inactive for $mac; disabling MPRIS export for this slot"
    fi

    if [[ -f "$dir/state.json" ]]; then
        if bool_enabled "$resume_queue"; then
            start_track=$(jq -r '.track // 0' "$dir/state.json")
        fi
        if bool_enabled "$resume_track"; then
            start_pos=$(jq -r '.position // 0' "$dir/state.json")
        fi
        log "$name" "Resuming: track=$start_track pos=$start_pos"
    fi

    log "$name" "Using audio device: $audio_device"

    # Volume cap per device. See P4 design — sink stays pinned at 100%
    # (BlueZ absolute-volume forwarding is disabled at the system level),
    # mpv's internal volume is the only thing affecting output level.
    # --volume-max enforces a HARD ceiling even if avrcp_dispatch or the
    # /play API tries to push past it.
    local vol_default vol_min vol_max
    read -r vol_default vol_min vol_max <<< "$(slot_volume "$slot")"
    : "${vol_default:=60}" "${vol_min:=0}" "${vol_max:=100}"

    # Spawn mpv in a subshell that closes FD 9 — without this, mpv
    # inherits the lock fd and keeps the flock held until it dies,
    # blocking all future start_playback calls.
    # Note: mpv's --volume-max is for AMPLIFICATION above 100% (min 100,
    # default 130), NOT a clamp below — passing < 100 makes mpv exit
    # immediately. Volume capping is enforced by avrcp_dispatch.py and
    # the /play API instead, with mpv launched at the configured default.
    ( exec 9>&-; exec mpv --no-video --no-terminal \
        --input-ipc-server="$dir/mpv-socket" \
        --playlist="$dir/playlist.m3u" \
        --playlist-start="$start_track" \
        --start="+${start_pos}" \
        --loop-playlist=inf \
        --pause=no \
        --volume="$vol_default" \
        --load-scripts="$load_scripts" \
        --audio-device="$audio_device" 2>"$dir/mpv.log" ) &

    echo $! > "$dir/mpv.pid"
    log "$name" "mpv started (pid $!)"

    sleep 2
    if ! kill -0 "$!" 2>/dev/null; then
        log "$name" "mpv exited immediately after launch"
        rm -f "$dir/mpv.pid" "$dir/mpv-socket"
        exec 9>&-
        return 1
    fi

    # Force-unpause: some headsets (or mpv-mpris reacting to BlueZ
    # MediaPlayer1 state) send a pause shortly after connect. Override
    # that here so the slot ALWAYS starts in playing state on connect.
    if [[ -S "$dir/mpv-socket" ]]; then
        echo '{"command":["set_property","pause",false]}' \
            | socat - "$dir/mpv-socket" >/dev/null 2>&1 || true
    fi

    # Headset AVRCP buttons → mpv IPC bridge (per-slot)
    start_avrcp_dispatcher "$slot" "$name" "$mac" || true

    # Release the per-slot playback lock (FD 9). Closing the FD lets a
    # future start_playback acquire flock; the lock file itself stays.
    exec 9>&-
}

stop_all() {
    # Kill background loops if running
    [[ -n "${REFRESH_PID:-}" ]]   && kill "$REFRESH_PID"   2>/dev/null || true
    [[ -n "${WATCHDOG_PID:-}" ]]  && kill "$WATCHDOG_PID"  2>/dev/null || true
    [[ -n "${SCHEDULED_PID:-}" ]] && kill "$SCHEDULED_PID" 2>/dev/null || true
    [[ -n "${SELFCHECK_PID:-}" ]] && kill "$SELFCHECK_PID" 2>/dev/null || true

    local count idx
    count=$(jq '.devices | length' "$CONFIG_FILE")
    for ((idx=0; idx<count; idx++)); do
        local slot name mac tag
        slot=$(jq -r ".devices[$idx].slot" "$CONFIG_FILE")
        name=$(jq -r ".devices[$idx].name" "$CONFIG_FILE")
        mac=$(jq -r ".devices[$idx].mac" "$CONFIG_FILE")
        tag=$(device_tag "$slot" "$mac" "$name")
        stop_playback "$slot" "$tag"
    done
}

# Background loop: refresh queues for connected devices every REFRESH_INTERVAL.
# Also re-converts devices.yml → JSON cache so config edits are picked up.
refresh_loop() {
    while true; do
        sleep "$REFRESH_INTERVAL"
        refresh_config_cache || true
        local count idx
        count=$(jq '.devices | length' "$CONFIG_FILE" 2>/dev/null) || continue
        for ((idx=0; idx<count; idx++)); do
            local device_json slot name mac tag queue shuffle
            device_json=$(jq -c ".devices[$idx]" "$CONFIG_FILE")
            slot=$(jq -r '.slot' <<< "$device_json")
            name=$(jq -r '.name' <<< "$device_json")
            mac=$(jq -r '.mac' <<< "$device_json")
            tag=$(device_tag "$slot" "$mac" "$name")
            queue=$(selected_queue "$device_json")
            shuffle=$(selected_shuffle "$device_json")
            local dir=$(slot_dir "$slot")

            # Only refresh if mpv is running for this slot. Acquire the
            # per-slot lock around fetch+reload so a concurrent connect
            # or watchdog event can't rewrite playlist.m3u out from
            # under us (which would otherwise cause mpv ↔ file drift:
            # mpv loads X, file gets overwritten to Y, no one reloads).
            if [[ -n "$queue" && -f "$dir/mpv.pid" ]] && kill -0 "$(cat "$dir/mpv.pid")" 2>/dev/null; then
                (
                    mkdir -p "$dir"
                    exec 9>"$dir/playback.lock"
                    if ! flock -n 9; then
                        log "$tag" "refresh: another playback op in progress, skipping this tick"
                        exit 0
                    fi
                    log "$tag" "Periodic queue refresh"
                    fetch_and_cache "$slot" "$tag" "$queue" "$shuffle" \
                        && reload_mpv_playlist "$slot" "$tag"
                )
            fi
        done
    done
}

# Tight liveness watchdog. Every WATCHDOG_INTERVAL seconds, for each
# device that is BT-connected, verify mpv is alive. If mpv died (crash,
# OOM, audio sink error) the gdbus monitor loop won't notice — it only
# acts on BT connect/disconnect events. This loop closes that gap so a
# dead mpv on a connected headset is restarted within seconds, not
# minutes.
mpv_watchdog() {
    while true; do
        sleep "$WATCHDOG_INTERVAL"
        local count idx
        count=$(jq '.devices | length' "$CONFIG_FILE" 2>/dev/null) || continue
        for ((idx=0; idx<count; idx++)); do
            local device_json slot name mac tag queue shuffle resume_queue resume_track dir mpv_pid
            device_json=$(jq -c ".devices[$idx]" "$CONFIG_FILE") || continue
            slot=$(jq -r '.slot' <<< "$device_json")
            name=$(jq -r '.name' <<< "$device_json")
            mac=$(jq -r '.mac' <<< "$device_json")
            tag=$(device_tag "$slot" "$mac" "$name")
            queue=$(selected_queue "$device_json")
            shuffle=$(selected_shuffle "$device_json")
            # jq // operator triggers on null OR false — so `.x // true`
            # returns true when .x is the literal value false. Use the
            # explicit has() check so `resume_queue: false` is honored.
            resume_queue=$(jq -r 'if has("resume_queue") then .resume_queue else true end' <<< "$device_json")
            resume_track=$(jq -r 'if has("resume_track") then .resume_track else true end' <<< "$device_json")
            dir=$(slot_dir "$slot")

            # Determine effective queue early. Armed slots (scheduled
            # fires, /play calls) override the device's static queue —
            # important for public devices that have no static queue.
            local eff_queue="$queue"
            if is_armed_for_play "$slot"; then
                local armed_queue
                armed_queue=$(armed_field "$slot" "queue")
                [[ -n "$armed_queue" ]] && eff_queue="$armed_queue"
            fi
            [[ -z "$eff_queue" ]] && continue

            # Class gate — watchdog should not auto-respawn mpv for a public
            # device that isn't armed (e.g., if its mpv died, don't bring it
            # back without an explicit trigger).
            local cls
            cls=$(device_class "$device_json")
            if [[ "$cls" == "public" ]] && ! is_armed_for_play "$slot"; then
                continue
            fi

            local device_path conn
            device_path=$(device_path_for_mac "$mac" 2>/dev/null) || continue
            conn=$(busctl --system get-property org.bluez "$device_path" org.bluez.Device1 Connected 2>/dev/null)
            [[ "$conn" != "b true" ]] && continue

            if [[ -f "$dir/mpv.pid" ]]; then
                mpv_pid=$(cat "$dir/mpv.pid" 2>/dev/null)
                if [[ -n "$mpv_pid" ]] && kill -0 "$mpv_pid" 2>/dev/null; then
                    continue
                fi
                rm -f "$dir/mpv.pid" "$dir/mpv-socket"
            fi

            log "$tag" "watchdog: BT connected but mpv missing/dead — respawning (queue=$eff_queue)"
            start_playback "$slot" "$tag" "$mac" "$eff_queue" "$shuffle" "$resume_queue" "$resume_track" || true
        done
    done
}

monitor() {
    declare -A dbus_to_slot
    declare -A dbus_to_name
    declare -A dbus_to_device
    declare -A connected_state

    local count idx
    count=$(jq '.devices | length' "$CONFIG_FILE")

    for ((idx=0; idx<count; idx++)); do
        local device_json mac slot name tag dbus_id queue shuffle resume_queue resume_track
        device_json=$(jq -c ".devices[$idx]" "$CONFIG_FILE")
        mac=$(jq -r '.mac' <<< "$device_json")
        slot=$(jq -r '.slot' <<< "$device_json")
        name=$(jq -r '.name' <<< "$device_json")
        tag=$(device_tag "$slot" "$mac" "$name")
        dbus_id=$(mac_to_dbus_path "$mac")
        queue=$(selected_queue "$device_json")
        shuffle=$(selected_shuffle "$device_json")
        resume_queue=$(jq -r 'if has("resume_queue") then .resume_queue else true end' <<< "$device_json")
        resume_track=$(jq -r 'if has("resume_track") then .resume_track else true end' <<< "$device_json")

        dbus_to_slot[$dbus_id]="$slot"
        dbus_to_name[$dbus_id]="$tag"
        dbus_to_device[$dbus_id]="$device_json"
        connected_state[$dbus_id]=false

        mkdir -p "$(slot_dir "$slot")/cache"

        local device_path
        if device_path=$(device_path_for_mac "$mac") \
            && [[ "$(busctl --system get-property org.bluez "$device_path" org.bluez.Device1 Connected 2>/dev/null)" == "b true" ]]; then
            connected_state[$dbus_id]=true
            local cls
            cls=$(device_class "$device_json")
            if [[ "$cls" == "public" ]] && ! is_armed_for_play "$slot"; then
                log "$tag" "Already connected, class=public not armed — staying idle (use scheduled or /play)"
            else
                # When armed, .armed.json's queue overrides the device's static queue.
                local eff_queue="$queue"
                if is_armed_for_play "$slot"; then
                    local armed_queue
                    armed_queue=$(armed_field "$slot" "queue")
                    [[ -n "$armed_queue" ]] && eff_queue="$armed_queue"
                fi
                if [[ -n "$eff_queue" ]]; then
                    log "$tag" "Already connected, starting playback (queue=$eff_queue armed=$(is_armed_for_play "$slot" && echo yes || echo no))"
                    start_playback "$slot" "$tag" "$mac" "$eff_queue" "$shuffle" "$resume_queue" "$resume_track" || true
                else
                    log "$tag" "No queue configured"
                fi
            fi
        fi
    done

    log "monitor" "Watching for ${#dbus_to_slot[@]} device(s)"

    # Start background refresh loop (queue/playlist refresh every REFRESH_INTERVAL)
    refresh_loop &
    REFRESH_PID=$!

    # Start tight mpv watchdog (respawn dead mpv on connected headsets within seconds)
    mpv_watchdog &
    WATCHDOG_PID=$!

    # Start scheduled-fire loop (one-shot wake events from devices.yml `scheduled:`)
    scheduled_loop &
    SCHEDULED_PID=$!

    # Start self-check loop (missed fires, override orphans, stuck armed flags)
    selfcheck_loop &
    SELFCHECK_PID=$!

    while read -r line; do
        for dbus_id in "${!dbus_to_slot[@]}"; do
            if echo "$line" | grep -q "dev_${dbus_id}"; then
                local slot="${dbus_to_slot[$dbus_id]}"
                local name="${dbus_to_name[$dbus_id]}"
                local device_json="${dbus_to_device[$dbus_id]}"
                local queue
                local shuffle
                local resume_queue
                local resume_track
                queue=$(selected_queue "$device_json")
                shuffle=$(selected_shuffle "$device_json")
                resume_queue=$(jq -r 'if has("resume_queue") then .resume_queue else true end' <<< "$device_json")
                resume_track=$(jq -r 'if has("resume_track") then .resume_track else true end' <<< "$device_json")

                if echo "$line" | grep -q "'Connected': <true>"; then
                    if [[ "${connected_state[$dbus_id]}" == false ]]; then
                        log "$name" "Connected"
                        connected_state[$dbus_id]=true
                        sleep 2
                        local cls
                        cls=$(device_class "$device_json")
                        if [[ "$cls" == "public" ]] && ! is_armed_for_play "$slot"; then
                            log "$name" "class=public not armed — staying idle (use scheduled or /play)"
                        else
                            local eff_queue="$queue"
                            if is_armed_for_play "$slot"; then
                                local armed_queue
                                armed_queue=$(armed_field "$slot" "queue")
                                [[ -n "$armed_queue" ]] && eff_queue="$armed_queue"
                            fi
                            if [[ -n "$eff_queue" ]]; then
                                start_playback "$slot" "$name" "$(jq -r '.mac' <<< "$device_json")" "$eff_queue" "$shuffle" "$resume_queue" "$resume_track" || true
                            else
                                log "$name" "No queue configured"
                            fi
                        fi
                    fi
                elif echo "$line" | grep -q "'Connected': <false>"; then
                    if [[ "${connected_state[$dbus_id]}" == true ]]; then
                        log "$name" "Disconnected"
                        connected_state[$dbus_id]=false
                        end_session "$slot" "$name"
                    fi
                fi
            fi
        done
    done < <(gdbus monitor --system --dest org.bluez)
}

# =====================================================================
# `cmd` subcommand — invoked by web.py / NFC handlers / scripts.
# Performs remote-controlled play/stop/pause/next/prev/volume actions
# against any target device by color. Shares all state (.armed.json,
# mpv-socket) with the running daemon. Exits 0 on success, non-zero
# on failure (caller can show 5xx).
# =====================================================================

# Expand a target spec into a list of device-json blobs. Supports:
#   - single color: "red"
#   - comma list:   "red,yellow"
#   - groups:       "all", "all-private", "all-public"
expand_targets() {
    local spec="$1"
    case "$spec" in
        all)         jq -c '.devices[]' "$CONFIG_FILE" ;;
        all-private) jq -c '.devices[] | select((.class // "private") == "private")' "$CONFIG_FILE" ;;
        all-public)  jq -c '.devices[] | select(.class == "public")' "$CONFIG_FILE" ;;
        *)
            local c
            for c in ${spec//,/ }; do
                jq -c --arg c "$c" '.devices[] | select(.color == $c)' "$CONFIG_FILE"
            done
            ;;
    esac
}

# Send a single mpv IPC command to a slot's mpv-socket. Returns 0 on
# socket reachable + mpv response received, non-zero otherwise.
mpv_ipc() {
    local slot="$1" cmd_json="$2"
    local sock
    sock="$(slot_dir "$slot")/mpv-socket"
    [[ -S "$sock" ]] || return 1
    echo "$cmd_json" | socat - "$sock" 2>/dev/null | head -1
}

handle_cmd() {
    local action="$1" target="$2"
    shift 2 || true
    local content_id="" volume="" duration_min="" resume_previous=""
    while (( $# )); do
        case "$1" in
            --volume) volume="$2"; shift 2 ;;
            --duration) duration_min="$2"; shift 2 ;;
            --resume) resume_previous="$2"; shift 2 ;;
            *)
                # First positional after target = content_id (for play)
                if [[ -z "$content_id" ]]; then
                    content_id="$1"; shift
                else
                    shift
                fi
                ;;
        esac
    done

    if [[ -z "$action" || -z "$target" ]]; then
        echo "usage: $0 cmd <action> <target> [content_id] [--volume N] [--duration N] [--resume yes|no]" >&2
        return 2
    fi

    local targets
    targets=$(expand_targets "$target")
    if [[ -z "$targets" ]]; then
        echo "no devices matched target spec: $target" >&2
        return 1
    fi

    local applied=0 skipped=0
    local device_json color slot mac name cls ha_entity_id tag
    while IFS= read -r device_json; do
        [[ -z "$device_json" ]] && continue
        color=$(jq -r '.color' <<< "$device_json")
        slot=$(jq -r '.slot' <<< "$device_json")
        mac=$(jq -r '.mac' <<< "$device_json")
        name=$(jq -r '.name // "device"' <<< "$device_json")
        cls=$(jq -r '.class // "private"' <<< "$device_json")
        ha_entity_id=$(jq -r '.ha_entity_id // empty' <<< "$device_json")
        tag=$(device_tag "$slot" "$mac" "$name")

        case "$action" in
            play)
                if [[ -z "$content_id" ]]; then
                    echo "play requires content_id" >&2
                    skipped=$((skipped+1)); continue
                fi
                log "cmd" "play target=$color slot=$slot queue=$content_id volume=$volume duration=$duration_min"
                arm_slot "$slot" "$content_id" "$volume" "$duration_min" "api"
                # If public + disconnected, wake via HA. Don't block on BT
                # connect — the watchdog will spawn mpv when BT comes up.
                if [[ "$cls" == "public" ]]; then
                    local conn_state
                    if device_path=$(device_path_for_mac "$mac" 2>/dev/null); then
                        conn_state=$(busctl --system get-property org.bluez "$device_path" \
                            org.bluez.Device1 Connected 2>/dev/null | awk '{print $NF}')
                    fi
                    if [[ "$conn_state" != "true" && -n "$ha_entity_id" ]]; then
                        log "cmd" "$color disconnected; calling HA turn_on $ha_entity_id"
                        ha_call_service switch turn_on "$ha_entity_id" || \
                            log "cmd" "HA turn_on failed for $color"
                    fi
                fi
                # If currently playing, send loadlist override via mpv IPC.
                # No saved-state-restore in v1 — the new content replaces
                # the old in place. Watchdog handles fresh start otherwise.
                local sock
                sock="$(slot_dir "$slot")/mpv-socket"
                if [[ -S "$sock" ]]; then
                    log "cmd" "$color: mpv alive, building override playlist and loadlist'ing"
                    local queue_url
                    queue_url=$(resolve_queue_url "$content_id")
                    if [[ -n "$queue_url" ]]; then
                        fetch_and_cache "$slot" "$tag" "$queue_url" "false" || true
                        echo "{\"command\":[\"loadlist\",\"$(slot_dir "$slot")/playlist.m3u\",\"replace\"]}" \
                            | socat - "$sock" >/dev/null 2>&1
                        if [[ -n "$volume" ]]; then
                            echo "{\"command\":[\"set_property\",\"volume\",$volume]}" \
                                | socat - "$sock" >/dev/null 2>&1
                        fi
                    fi
                fi
                applied=$((applied+1))
                ;;
            stop)
                log "cmd" "stop target=$color slot=$slot"
                end_session "$slot" "$tag"
                applied=$((applied+1))
                ;;
            pause)
                mpv_ipc "$slot" '{"command":["cycle","pause"]}' >/dev/null && \
                    applied=$((applied+1)) || skipped=$((skipped+1))
                ;;
            next)
                mpv_ipc "$slot" '{"command":["playlist-next"]}' >/dev/null && \
                    applied=$((applied+1)) || skipped=$((skipped+1))
                ;;
            prev)
                mpv_ipc "$slot" '{"command":["playlist-prev"]}' >/dev/null && \
                    applied=$((applied+1)) || skipped=$((skipped+1))
                ;;
            volume)
                local v="${content_id:-${volume:-}}"
                if [[ -z "$v" ]]; then
                    echo "volume requires a value" >&2
                    skipped=$((skipped+1)); continue
                fi
                # Clamp to device's max
                local vmax
                vmax=$(jq -r --argjson s "$slot" \
                    '.devices[] | select(.slot == $s) | .volume.max // 100' \
                    "$CONFIG_FILE")
                (( v > vmax )) && v=$vmax
                (( v < 0 )) && v=0
                mpv_ipc "$slot" "{\"command\":[\"set_property\",\"volume\",$v]}" >/dev/null && \
                    applied=$((applied+1)) || skipped=$((skipped+1))
                ;;
            *)
                echo "unknown action: $action" >&2
                skipped=$((skipped+1))
                ;;
        esac
    done <<< "$targets"

    echo "{\"ok\":true,\"action\":\"$action\",\"applied\":$applied,\"skipped\":$skipped}"
    (( applied > 0 )) && return 0 || return 1
}

# Always materialize the runtime JSON cache from devices.yml before any
# subcommand runs — jq paths throughout the script depend on it.
refresh_config_cache || {
    echo "[startup] No usable config (looked for $CONFIG_YML / $CONFIG_JSON_LEGACY)" >&2
    exit 1
}

case "${1:-monitor}" in
    monitor)
        # The monitor daemon owns the running mpv/avrcp/dispatcher child
        # processes; on EXIT it should clean them up. One-shot subcommands
        # (cmd, stop) must NOT have this trap — otherwise their EXIT would
        # tear down the daemon's mpv processes.
        trap stop_all EXIT
        monitor
        ;;
    stop)    stop_all ;;
    cmd)     shift; handle_cmd "$@" ;;
    *)       echo "Usage: $0 {monitor|stop|cmd <action> <target> [args]}" ;;
esac
