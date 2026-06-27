#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$HOME/playback-hub"
CONFIG_YML="$BASE_DIR/devices.yml"
CONFIG_JSON_LEGACY="$BASE_DIR/devices.json"
CONFIG_FILE="$BASE_DIR/.devices.runtime.json"
API_BASE="https://daylightlocal.kckern.net"
API_FALLBACK_BASE="http://10.0.0.10:3111"
# Default prefix for bare queue ratingKeys when the config omits queue_base.
# MUST stay in parity with web.py's DEFAULT_QUEUE_BASE — both resolve a bare
# id like "674397" to <base>674397. Without this, queue_base() returned ""
# and curl got a bare id (curl exit 28, "API unavailable" on every fetch).
DEFAULT_QUEUE_BASE="https://daylightlocal.kckern.net/api/v1/queue/plex/"
REFRESH_INTERVAL=300       # seconds between queue refreshes (full playlist re-fetch)
WARM_REUSE_WINDOW=120      # seconds after a teardown during which a reconnect for the SAME queue reuses the cached playlist.m3u (skip API refetch + rebuild + bg re-download) — makes a BT-flap reconnect cheap instead of a full cold start
WATCHDOG_INTERVAL=5        # seconds between mpv liveness checks (tight respawn)
SCHEDULE_TICK_INTERVAL=30  # seconds between scheduled-fire checks
SELFCHECK_INTERVAL=300     # seconds between self-check (missed fires, orphans)
CONNECT_CHECK_INTERVAL=60  # seconds between BT connectivity checks for schedule-active private headsets
CONNECT_MISS_ALERT=5       # consecutive failed reconnects (~CONNECT_MISS_ALERT*CONNECT_CHECK_INTERVAL s) before alerting
CONNECT_ESCALATE_MISSES=3  # consecutive failed reconnects before escalating to a full adapter power-cycle (then repeats every multiple) — clears a wedged controller that won't hold a link even WITH PSCAN present
CONNECT_ESCALATE_MAX=12    # stop power-cycling the adapter past this many misses — a wedged controller clears within the first few resets; beyond that it's the headset (off / out of range), so keep retrying Connect + alert but stop churning the adapter
BT_WAKE_TIMEOUT=60         # max seconds to wait for BT after HA turn_on
BT_SETTLE_SEC=4            # seconds a freshly-connected link must stay up before we commit to the (expensive) start_playback — absorbs A2DP flapping at connect so we don't spawn/teardown mpv per blip
DUPE_FIRE_WINDOW=60        # window in which a scheduled time matches "now"
LAZY_PRIME_COUNT=5         # tracks to download synchronously before starting mpv
MIN_AUDIO_BYTES=2048
SCHEDULED_STATE_FILE="$BASE_DIR/.scheduled-state.json"
CACHE_DIR="$BASE_DIR/cache"
CACHE_MAX_BYTES=$((2*1024*1024*1024))  # 2 GB orphan-sweep backstop
ORPHAN_TTL_DAYS=7
MEMBERSHIP_INTERVAL=60
HEAD_FULL_PASS=900
SWEEP_INTERVAL=3600
STALL_REVALIDATE_COOLDOWN=120  # min seconds between stall revalidations of the SAME plex_id (anti-thrash)
ORPHAN_SINK_TICKS=2            # consecutive watchdog ticks a slot's sink must be ABSENT before reaping its mpv (audio cross-routing guard; ~ORPHAN_SINK_TICKS*WATCHDOG_INTERVAL s of hysteresis)
ORPHAN_REAP_COOLDOWN=20        # after an orphan-sink reap, suppress the watchdog's (blocking) respawn for this many seconds while the sink is still gone — avoids a 12s resolve_audio_device stall + log spam every tick during a sustained A2DP outage
HEARTBEAT_INTERVAL=180         # seconds between playback.heartbeat liveness samples per live slot. track.start only fires on track CHANGE (and is suppressed on resume-to-same-track), so it can't answer "is audio actually flowing right now". The heartbeat is the positive liveness signal: {plex_id,pos,paused,sink_live} sampled while mpv is alive + BT-connected.
RECONNECT_LOG_EVERY=30         # during a reconnect outage, after the FIRST miss only emit bt.reconnect_fail on escalation ticks + every Nth miss. The old per-tick emit was ~95% of events.jsonl (3.4k–7.3k lines/week/slot) and rotated genuinely-useful events out of the 5MB ledger. Onset + escalation + a coarse heartbeat preserve the signal.

# Central cache manager — sourced for both direct-exec and source (tests).
# Defined here, before refresh_config_cache, and NOT inside the dispatch guard.
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_SCRIPT_DIR/cache_manager.sh"

# Regenerate the runtime JSON cache from devices.yml so the rest of
# playback-hub.sh can keep using jq. Called at startup and from the
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

# Structured event: logev <tag/color/slot> <evt> [k=v ...]
# Human line to STDERR + JSON to slots/<N>/events.jsonl when tag maps to a slot.
# Human line goes to stderr (not stdout) so logev can be called from inside
# functions whose stdout is captured for a value (e.g. get_cached_path returns
# a path on stdout). In production the daemon runs `> hub.log 2>&1`, so the
# human line still lands in hub.log either way.
# NOTE: values are single tokens only (k=v). Multi-word quoted values are not
# supported because $* word-splitting would break them; the emitter is
# intentionally not over-engineered for that case.
logev() {
    local tag="$1" evt="$2"; shift 2
    echo "[$(date '+%H:%M:%S')] [$tag] evt=$evt $*" >&2
    local slot; slot=$(slot_for_tag "$tag" 2>/dev/null || echo "")
    [[ -z "$slot" ]] && return 0
    local dir; dir="$(slot_dir "$slot")"; mkdir -p "$dir"
    local jl="$dir/events.jsonl"
    [[ -f "$jl" && $(file_size_bytes "$jl") -gt $((5*1024*1024)) ]] && mv "$jl" "$jl.1"
    local json; json=$(kv_to_json "$@")
    echo "{\"ts\":\"$(date -Is 2>/dev/null || date)\",\"evt\":\"$evt\",\"slot\":$slot${json:+,$json}}" >> "$jl"
}

# Each ARG is one complete key=val pair (not a space-joined string), so values
# may contain spaces — track titles/albums do. Backslash + double-quote are
# JSON-escaped. Callers MUST quote a spaced value as a single arg:
#   logev tag evt "title=La maja y el ruiseñor"   (NOT title=La maja ...)
kv_to_json() { # key=val [key=val ...] -> "\"k\":\"v\",..." (values quoted as strings)
    local out="" tok k v
    for tok in "$@"; do
        [[ "$tok" != *=* ]] && continue
        k="${tok%%=*}"; v="${tok#*=}"
        v="${v//\\/\\\\}"   # escape backslashes first
        v="${v//\"/\\\"}"   # then double-quotes
        out+="\"$k\":\"$v\","
    done
    echo "${out%,}"
}

slot_for_tag() { # color | numeric slot | device-tag ("slot=N mac=...") -> slot number (empty if no match)
    local t="$1"
    [[ "$t" =~ ^[0-9]+$ ]] && { echo "$t"; return 0; }
    # The daemon passes its device-tag string ("slot=N mac=... name=...") as the
    # logev tag (same value log() uses). Extract the slot so every instrumented
    # logev call lands in slots/<N>/events.jsonl, not just color/numeric tags.
    [[ "$t" =~ slot=([0-9]+) ]] && { echo "${BASH_REMATCH[1]}"; return 0; }
    [[ -f "$CONFIG_FILE" ]] || return 0
    jq -r --arg c "$t" '.devices[] | select(.color==$c) | .slot' "$CONFIG_FILE" 2>/dev/null | head -1
}

# =====================================================================
# Alerts — log + optional HA notify dispatch
# =====================================================================

# dispatch_alert <severity> <event> <message>
# Always logs via `logger -t playback-hub-alert`. If alerts.on_<event> in
# the config is "notify", also calls the configured HA notify service
# (via DaylightStation's /ha/call) so the user gets a phone push.
dispatch_alert() {
    local severity="$1" event="$2" message="$3"
    logger -t playback-hub-alert "[$severity] $event: $message" 2>/dev/null || true
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

# Clear the per-slot reconnect-outage state and, if an outage was actually in
# progress (misses > 0), emit a single bt.reconnect_recovered carrying how long
# the headset was unreachable. Pairs with the throttled bt.reconnect_fail so the
# ledger tells a clean outage→recovery story instead of thousands of per-tick
# fails. Idempotent: a no-op clear (no prior misses) emits nothing. The
# outage-start epoch is stamped on the 1→ transition in the miss path below.
#   args: tag dir
note_reconnect_recovered() {
    local tag="$1" dir="$2"
    local mf="$dir/.connect-misses" sf="$dir/.connect-outage-start"
    local m=0; [[ -f "$mf" ]] && m=$(cat "$mf" 2>/dev/null || echo 0)
    [[ "$m" =~ ^[0-9]+$ ]] || m=0
    if (( m > 0 )); then
        local st now; st=$(cat "$sf" 2>/dev/null || echo 0); now=$(date +%s)
        [[ "$st" =~ ^[0-9]+$ ]] || st=$now
        logev "$tag" bt.reconnect_recovered misses="$m" outage_sec=$(( now - st ))
    fi
    rm -f "$mf" "$sf" "$dir/.connect-alerted" 2>/dev/null || true
}

# connectivity_loop — proactive Bluetooth self-heal for private headsets.
#
# The gdbus monitor only reacts to a headset connecting *itself*. If a bonded
# headset is powered on but its adapter has silently dropped PSCAN (the Intel
# BT-flapping failure that left "red" dead), the headset's reconnect pages go
# unanswered: no event, no recovery, no alert — the operator becomes the
# monitor. This loop closes that gap. For each PRIVATE device that is inside an
# active schedule window (i.e. the hub *wants* it playing now) but is not
# connected, it:
#   1) heals the adapter's PSCAN if missing (power-cycle over D-Bus),
#   2) issues an OUTBOUND connect — works even with PSCAN dead, because the hub
#      pages the headset instead of waiting to be paged; the gdbus handler then
#      starts playback on the resulting Connected event (we do NOT play here),
#   3) after CONNECT_MISS_ALERT consecutive failures (~5 min) dispatches a
#      single warning alert so a truly unreachable headset surfaces instead of
#      sitting silent.
# Reconnects are gated to schedule windows so we never hammer a headset the hub
# has no reason to be playing (no-schedule slots, or off-hours). The alert
# routes per alerts.on_bt_reconnect_fail in devices.yml ("log" default, or
# "notify" for an HA phone push).
connectivity_loop() {
    while true; do
        sleep "$CONNECT_CHECK_INTERVAL"
        local count idx
        count=$(jq '.devices | length' "$CONFIG_FILE" 2>/dev/null) || continue
        for ((idx=0; idx<count; idx++)); do
            local device_json slot mac name cls tag dir miss_file alert_file
            device_json=$(jq -c ".devices[$idx]" "$CONFIG_FILE" 2>/dev/null) || continue
            cls=$(device_class "$device_json")
            [[ "$cls" == "private" ]] || continue
            slot=$(jq -r '.slot' <<< "$device_json")
            mac=$(jq -r '.mac'  <<< "$device_json")
            name=$(jq -r '.name // "device"' <<< "$device_json")
            [[ -z "$mac" || "$mac" == null ]] && continue
            tag=$(device_tag "$slot" "$mac" "$name")
            dir=$(slot_dir "$slot")
            miss_file="$dir/.connect-misses"
            alert_file="$dir/.connect-alerted"

            # Only the hub's "should be playing now" windows drive proactive
            # reconnects. Outside any window: clear state and leave it alone.
            if ! active_schedule_json "$device_json" >/dev/null 2>&1; then
                # Window closed — clear silently (not a "recovery"; the headset
                # may still be off, we just stop chasing it).
                rm -f "$miss_file" "$alert_file" "$dir/.connect-outage-start" 2>/dev/null || true
                continue
            fi

            # Already linked → healthy; close out any outage (recovery event) and
            # move on. Covers the common case where the gdbus monitor reconnected
            # the headset and we just notice the live link here.
            if bt_connected "$mac"; then
                note_reconnect_recovered "$tag" "$dir"
                continue
            fi

            # Disconnected during an active window → heal adapter + reconnect.
            local path
            if path=$(device_path_for_mac "$mac"); then
                heal_adapter_pscan "$mac" "$tag" || true
                log "$tag" "schedule-active but disconnected — attempting outbound reconnect"
                timeout 25 busctl --system call org.bluez "$path" \
                    org.bluez.Device1 Connect 2>/dev/null || true
                sleep 3
            else
                log "$tag" "schedule-active but no BlueZ device object for $mac (unpaired?)"
            fi

            if bt_connected "$mac"; then
                log "$tag" "reconnect succeeded"
                logev "$tag" bt.reconnect_ok mac="$mac"
                note_reconnect_recovered "$tag" "$dir"
                continue
            fi

            # Still down — bump the miss counter; alert once per outage streak.
            local misses=0
            [[ -f "$miss_file" ]] && misses=$(cat "$miss_file" 2>/dev/null || echo 0)
            [[ "$misses" =~ ^[0-9]+$ ]] || misses=0
            misses=$((misses + 1))
            echo "$misses" > "$miss_file"
            # Stamp the outage-start epoch on the first miss so the matching
            # bt.reconnect_recovered can report total outage duration.
            (( misses == 1 )) && date +%s > "$dir/.connect-outage-start"
            # Throttle: the per-tick emit was ~95% of the ledger. Keep the onset,
            # every escalation tick (3,6,9,12 — same cadence as the adapter
            # reset), and a coarse every-Nth heartbeat past the cap so a long
            # outage still leaves a periodic trail without flooding.
            if (( misses == 1 )) || should_escalate_reset "$misses" || (( misses % RECONNECT_LOG_EVERY == 0 )); then
                logev "$tag" bt.reconnect_fail mac="$mac" misses="$misses"
            fi
            # Escalation: heal_adapter_pscan above is a no-op when PSCAN is
            # present, so a controller that's wedged-but-PSCAN-healthy would
            # otherwise retry the same gentle Connect forever. After enough
            # consecutive misses, force a full adapter power-cycle to re-init it.
            if should_escalate_reset "$misses"; then
                local hci
                if hci=$(hci_for_mac "$mac"); then
                    log "$tag" "still down after $misses misses — escalating: power-cycling adapter $hci"
                    logev "$tag" bt.adapter_reset hci="$hci" misses="$misses"
                    cycle_adapter "$hci" "$tag"
                fi
            fi
            if (( misses >= CONNECT_MISS_ALERT )) && [[ ! -f "$alert_file" ]]; then
                dispatch_alert warning bt_reconnect_fail \
                    "$name (slot $slot) is scheduled to play but unreachable for ~$((misses*CONNECT_CHECK_INTERVAL/60)) min — headset off, out of range, or BT fault"
                : > "$alert_file"
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
    local base
    base=$(jq -r '.queue_base // ""' "$CONFIG_FILE" 2>/dev/null)
    # Parity with web.py:87 — fall back to DEFAULT_QUEUE_BASE when the config
    # has no queue_base key, so bare ratingKeys resolve to real API URLs.
    [[ -n "$base" ]] && echo "$base" || echo "$DEFAULT_QUEUE_BASE"
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

# Like curl_api but streams body to $2 and dumps response headers to $3.
curl_api_dump() { # url body_dest header_dest
    local url="$1" body="$2" hdrs="$3"
    if curl -fsSL --max-time 60 -D "$hdrs" -o "$body" "$url"; then return 0; fi
    local fb="${url/$API_BASE/$API_FALLBACK_BASE}"
    [[ "$fb" != "$url" ]] && curl -fsSL --max-time 60 -D "$hdrs" -o "$body" "$fb"
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

# True (0) iff BlueZ reports the device's Device1.Connected as true. Unlike
# media_control_connected (AVRCP), this is the link-level connection state used
# by the gdbus monitor — the right signal for "is the headset actually linked".
bt_connected() {
    local mac="$1" path
    path=$(device_path_for_mac "$mac") || return 1
    [[ "$(busctl --system get-property org.bluez "$path" org.bluez.Device1 Connected 2>/dev/null)" == "b true" ]]
}

# True (0) iff the link stays Connected for the whole settle window. A flapping
# A2DP link reports Connected, then drops within 1-4s; if we react to the first
# Connected edge with start_playback we spawn mpv + prime 5 tracks + fork a
# 97-track download, only for the disconnect handler to SIGKILL it all — then
# the next connect redoes the whole cold cycle (observed green/slot3 2026-06-08:
# 3 teardown/restart cycles in 95s before the link held). Gating both the gdbus
# connect handler and the watchdog respawn on this check makes us commit to
# playback only once the link has proven it will hold. Returns 1 the instant the
# link drops during the window.
bt_link_stable() {
    local mac="$1" settle_sec="${2:-$BT_SETTLE_SEC}"
    local end=$(( $(date +%s) + settle_sec ))
    while (( $(date +%s) < end )); do
        bt_connected "$mac" || return 1
        sleep 0.5
    done
    bt_connected "$mac"
}

# True (0) iff a reconnect can cheaply reuse the existing playlist instead of a
# cold rebuild. A BT flap tears mpv down and the next connect re-runs the full
# start cycle — queue API fetch + playlist rebuild + a fresh 97-track bg
# download — even though nothing changed in the ~seconds the link was gone.
# Reuse is safe only when ALL hold: a teardown happened within WARM_REUSE_WINDOW;
# the prior session's bg download finished (.bg_done — so playlist.m3u is the
# WHOLE list, not a primed subset that needs the downloader re-forked); the
# requested queue matches the one that built the playlist (.playlist_queue — so
# a /play with a different queue still cold-loads); and playlist.m3u has at least
# one real media entry. The periodic refresh/membership loops reconcile any
# drift once playback resumes, so a ≤2-min-stale reuse is fine.
warm_reconnect_ok() {
    local slot="$1" queue="$2" dir; dir="$(slot_dir "$slot")"
    [[ -f "$dir/playlist.m3u" && -f "$dir/.bg_done" && -f "$dir/.playlist_queue" ]] || return 1
    [[ "$(cat "$dir/.playlist_queue" 2>/dev/null)" == "$queue" ]] || return 1
    grep -qvE '^[[:space:]]*(#|$)' "$dir/playlist.m3u" 2>/dev/null || return 1
    local td
    td="$(cat "$dir/.last_teardown" 2>/dev/null || echo 0)"
    [[ "$td" =~ ^[0-9]+$ ]] || return 1
    (( $(date +%s) - td <= WARM_REUSE_WINDOW ))
}

# Fire a single best-effort outbound Connect for a headset that just dropped, so
# a transient RF blip recovers in ~seconds instead of waiting up to
# CONNECT_CHECK_INTERVAL for connectivity_loop's next tick. Backgrounded so it
# never blocks the gdbus monitor read loop, and per-slot flock-guarded so a
# flapping link can't pile up overlapping Connect attempts. The gated connect
# handler resumes playback once the link proves stable.
kick_reconnect() {
    local mac="$1" dir="$2" path
    path=$(device_path_for_mac "$mac") || return 1
    (
        exec 8>"$dir/.reconnect.lock"
        flock -n 8 || exit 0   # a kick is already in flight for this slot
        timeout 25 busctl --system call org.bluez "$path" \
            org.bluez.Device1 Connect >/dev/null 2>&1 || true
    ) &
}

# Resolve the hciN adapter name hosting a paired headset MAC (from its BlueZ
# device path /org/bluez/hciN/dev_..). Prints the name; exits 1 if unresolvable.
hci_for_mac() {
    local mac="$1" path hci
    path=$(device_path_for_mac "$mac") || return 1
    hci="${path#/org/bluez/}"; hci="${hci%%/*}"   # /org/bluez/hci3/dev_.. -> hci3
    [[ "$hci" == hci* ]] || return 1
    printf '%s' "$hci"
}

# Power-cycle a controller over D-Bus. bluetoothd runs privileged, so the
# Adapter1.Powered toggle works even though the service user can't `hciconfig`.
# Re-inits the adapter: restores a dropped PSCAN flag AND clears a wedged
# controller that won't hold/accept a link. Safe because each adapter hosts
# exactly one headset and callers only invoke this while that headset is
# disconnected, so there's no live link to disrupt.
cycle_adapter() {
    local hci="$1" apath="/org/bluez/$1"
    busctl --system set-property org.bluez "$apath" org.bluez.Adapter1 Powered b false 2>/dev/null || true
    sleep 2
    busctl --system set-property org.bluez "$apath" org.bluez.Adapter1 Powered b true 2>/dev/null || true
    sleep 2
}

# Heal a controller stuck without PSCAN (page scan). Failure mode: a bonded
# headset can no longer reconnect because its Intel adapter silently stopped
# accepting incoming pages (PSCAN flag gone). Power-cycling re-inits it and
# restores PSCAN. Returns 0 if a heal was performed, 1 if the adapter already
# has PSCAN (healthy — nothing to do; see should_escalate_reset for the
# present-but-wedged path).
heal_adapter_pscan() {
    local mac="$1" tag="$2" hci
    hci=$(hci_for_mac "$mac") || return 1
    # PSCAN present → adapter healthy, nothing to do.
    hciconfig "$hci" 2>/dev/null | grep -qw PSCAN && return 1
    log "$tag" "adapter $hci missing PSCAN — power-cycling over D-Bus to restore page scan"
    logev "$tag" bt.adapter_heal hci="$hci"
    cycle_adapter "$hci" "$tag"
    return 0
}

# Decide whether a sustained reconnect outage warrants a full adapter
# power-cycle. heal_adapter_pscan only fires when PSCAN is MISSING, but a
# controller can refuse to hold/accept a link even WITH PSCAN present (no
# escalation path existed — the slot just retried the same gentle Connect every
# tick forever; observed green/slot3 dropping at 17:57 and never recovering).
# Escalate at CONNECT_ESCALATE_MISSES and then every multiple thereafter (giving
# a built-in backoff of ~CONNECT_ESCALATE_MISSES*CONNECT_CHECK_INTERVAL s between
# resets) UP TO CONNECT_ESCALATE_MAX, after which we stop: a wedged controller
# clears within the first few cycles, so continued failure means the headset is
# simply off/out of range and power-cycling its adapter forever is futile churn.
# Returns 0 when the caller should escalate.
should_escalate_reset() {
    local misses="$1"
    [[ "$misses" =~ ^[0-9]+$ ]] || return 1
    (( misses >= CONNECT_ESCALATE_MISSES && misses <= CONNECT_ESCALATE_MAX && misses % CONNECT_ESCALATE_MISSES == 0 ))
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

    # Spawn in a subshell that closes FD 9 — same as mpv/spawn_bg_downloader.
    # This dispatcher is started by start_playback WHILE that slot's playback.lock
    # (FD 9) is held, and it outlives the call (it runs the whole connected
    # session). Without `exec 9>&-` it inherits the locked FD and keeps the flock
    # held until the headset disconnects — starving every mid-session membership
    # reconcile (reconcile.skip reason=lock_busy), so a queue change that happens
    # WITHOUT a reconnect (e.g. red's 21:00 day→lullaby schedule switch while
    # still connected) never applies. `exec python3` makes $! the python pid so
    # avrcp.pid / stop_avrcp_dispatcher stay correct.
    ( exec 9>&-; exec python3 "$BASE_DIR/avrcp_dispatch.py" "$event_path" "$socket" "$name" \
        --min-volume "$vol_min" --max-volume "$vol_max" \
        >>"$dir/avrcp.log" 2>&1 ) &
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
    local slot="$1" name="$2" quiet="${3:-}"
    local dir=$(slot_dir "$slot")
    local socket="$dir/mpv-socket"

    if [[ -S "$socket" ]]; then
        local pos track
        pos=$(echo '{"command":["get_property","playback-time"]}' | socat - "$socket" 2>/dev/null | jq -r '.data // 0') || pos=0
        track=$(echo '{"command":["get_property","playlist-pos"]}' | socat - "$socket" 2>/dev/null | jq -r '.data // 0') || track=0
        # mpv returns null/empty for these right after launch (before the
        # first file loads). Never persist that — it would clobber a good
        # resume point with 0 and yank playback back to the top of the queue.
        [[ -z "$pos" || "$pos" == "null" ]] && pos=0
        [[ -z "$track" || "$track" == "null" ]] && track=0
        echo "{\"track\": $track, \"position\": $pos}" > "$dir/state.json"
        # quiet = periodic watchdog persistence; don't spam the log every tick.
        [[ "$quiet" == "quiet" ]] || log "$name" "Saved position: track=$track pos=$pos"
    fi
}

stop_playback() {
    local slot="$1" name="$2" mode="${3:-graceful}"
    local dir=$(slot_dir "$slot")

    # NOTE: this function intentionally does NOT disarm the slot or
    # call ha_turn_off. Those are explicit session-end actions handled
    # by `end_session` below. stop_playback is also invoked from
    # stop_all (service shutdown), where we want armed state to persist
    # so a mid-fire restart can resume on the next BT connect.

    # FAST (BT-disconnect) PATH — kill mpv FIRST, before anything else.
    # On disconnect BlueZ has already torn down this slot's bluez_output
    # sink. A still-alive mpv stream gets migrated by PipeWire onto
    # whatever sink remains (e.g. another connected headset) — this is the
    # "green/blue audio piles onto yellow" bug. SIGKILL slams that window
    # shut instantly. We deliberately do NOT do a live IPC save_position
    # here: querying mpv over the socket while its sink is gone is exactly
    # the multi-step delay that keeps the orphaned stream alive long enough
    # to migrate. Resume position instead comes from state.json, which the
    # watchdog persists every WATCHDOG_INTERVAL (5s) seconds.
    if [[ "$mode" == "fast" && -f "$dir/mpv.pid" ]]; then
        local kpid
        kpid=$(cat "$dir/mpv.pid" 2>/dev/null)
        if [[ -n "$kpid" ]]; then
            kill -9 "$kpid" 2>/dev/null && log "$name" "Killed mpv (pid $kpid, fast/disconnect)" || true
        fi
        rm -f "$dir/mpv.pid"
    fi

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
    # Graceful path (scheduled stop, /play stop, shutdown): the sink is
    # still alive, so a live IPC save is safe and most accurate. Fast path
    # skips it — mpv is already dead and state.json is fresh from the
    # watchdog (see the fast block above).
    if [[ "$mode" != "fast" ]]; then
        save_position "$slot" "$name"
    fi
    # In fast mode mpv.pid was already removed above, so this SIGTERM
    # fallback is a no-op there; it only runs for the graceful path.
    if [[ -f "$dir/mpv.pid" ]]; then
        local pid
        pid=$(cat "$dir/mpv.pid")
        kill "$pid" 2>/dev/null && log "$name" "Stopped mpv (pid $pid)" || true
        rm -f "$dir/mpv.pid"
    fi
    rm -f "$dir/mpv-socket"
    # Stamp teardown time so a quick reconnect (same queue, within
    # WARM_REUSE_WINDOW) can reuse the cached playlist instead of cold-rebuilding.
    date +%s > "$dir/.last_teardown" 2>/dev/null || true
}

# Explicit session end. Called on BT disconnect, scheduled auto-stop, and
# the POST /play `stop` action. Unlike stop_playback (which only kills
# mpv + cleans up files), this ALSO disarms the slot and fires the
# optional HA turn_off, ending the logical "play session" entirely.
end_session() {
    local slot="$1" name="$2" mode="${3:-graceful}"
    stop_playback "$slot" "$name" "$mode"
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

# Build playlist.m3u (central-cache paths) from a queue JSON, priming the first
# LAZY_PRIME_COUNT tracks synchronously and recording the remainder to
# .bg_remaining for spawn_bg_downloader. PURE w.r.t. mpv — no IPC, no fork.
# Reused by Unit E (membership reconcile). Returns 1 if nothing primed.
#   args: slot name queue_json shuffle
rebuild_playlist_from_queue() {
    local slot="$1" name="$2" queue_json="$3" shuffle="${4:-false}"
    local dir; dir="$(slot_dir "$slot")"
    local playlist_tmp="$dir/playlist.m3u.tmp"
    mkdir -p "$dir"

    local count
    count=$(echo "$queue_json" | jq '.items | length')

    # Build the canonical track order (shuffled if requested). We shuffle
    # INDEX positions so the prime loop and the background downloader walk
    # tracks in the same order — the playlist appears in shuffled order
    # from track 1.
    # NOTE: read loop (not mapfile) for bash 3.2 portability — the macOS dev box
    # used to source this in tests ships bash 3.2 which lacks mapfile.
    local -a ordered_indices=()
    local _oi
    if bool_enabled "$shuffle"; then
        while IFS= read -r _oi; do ordered_indices+=("$_oi"); done < <(seq 0 $((count - 1)) | shuf)
        log "$name" "Shuffled playlist order (shuf/urandom)"
    else
        while IFS= read -r _oi; do ordered_indices+=("$_oi"); done < <(seq 0 $((count - 1)))
    fi

    # Extract per-track metadata once into parallel arrays (avoids
    # re-parsing the queue JSON repeatedly).
    local -a track_ids=() track_urls=() track_titles=()
    local orig_idx
    for orig_idx in "${ordered_indices[@]}"; do
        local plex_id media_path title safe_title
        plex_id=$(echo "$queue_json" | jq -r ".items[$orig_idx].contentId" | sed 's/plex://')
        media_path=$(echo "$queue_json" | jq -r ".items[$orig_idx].mediaUrl")
        title=$(echo "$queue_json" | jq -r ".items[$orig_idx].title")
        safe_title=$(printf '%s' "$title" | tr '\t\n\r' '   ' | sed 's/  */ /g')
        [[ -z "$safe_title" || "$safe_title" == "null" ]] && safe_title="$plex_id"
        track_ids+=("$plex_id")
        track_urls+=("${API_BASE}${media_path}")
        track_titles+=("$safe_title")
    done
    local total=${#track_ids[@]}

    # Phase 1: synchronously prime the first LAZY_PRIME_COUNT tracks into the
    # CENTRAL cache via get_cached_path, writing their central paths to the
    # playlist. Skip (don't abort) any track that can't be cached.
    local primed=0 target_prime=$((LAZY_PRIME_COUNT < total ? LAZY_PRIME_COUNT : total))
    echo "#EXTM3U" > "$playlist_tmp"
    local i cpath
    for ((i=0; i<total && primed<target_prime; i++)); do
        if cpath=$(get_cached_path "${track_ids[$i]}" "${track_urls[$i]}" "$name"); then
            printf '#EXTINF:-1,%s\n%s\n' "${track_titles[$i]}" "$cpath" >> "$playlist_tmp"
            primed=$((primed+1))
        else
            logev "$name" prime.skip plex_id="${track_ids[$i]}" reason=cache_fail
        fi
    done
    local first_pending_idx=$i

    if (( primed == 0 )); then
        log "$name" "No primed tracks; queue produced no playable files"
        rm -f "$playlist_tmp"
        return 1
    fi

    mv "$playlist_tmp" "$dir/playlist.m3u"

    # Record the membership baseline at the same atomic point as the playlist
    # swap. This is what the membership self-heal tier (Unit E) diffs against:
    # priming establishes the baseline so the first membership tick is a no-op
    # when the server-side queue hasn't drifted.
    queue_membership_hash "$queue_json" > "$dir/.membership"

    # Record the remaining tracks (tab-separated: plex_id, url, title) for the
    # background downloader. Written fresh every rebuild so a re-shuffle or
    # content change supersedes the prior remainder.
    : > "$dir/.bg_remaining"
    local j
    for ((j=first_pending_idx; j<total; j++)); do
        printf '%s\t%s\t%s\n' \
            "${track_ids[$j]}" "${track_urls[$j]}" "${track_titles[$j]}" \
            >> "$dir/.bg_remaining"
    done
    [[ -s "$dir/.bg_remaining" ]] || rm -f "$dir/.bg_remaining"

    logev "$name" playlist.primed primed=$primed total=$total
    log "$name" "Playlist primed: $primed of $total tracks (rest will stream in background)"
}

fetch_and_cache() {
    # Prime-only: fetch the queue, validate, then build playlist.m3u with the
    # first LAZY_PRIME_COUNT tracks cached synchronously (rest recorded to
    # .bg_remaining). Does NOT fork the background downloader — that now happens
    # in start_playback AFTER mpv is up, so the bg's playlist appends can be
    # reconciled into a live mpv instead of racing a not-yet-existent socket.
    local slot="$1" name="$2" queue_url="$3" shuffle="${4:-false}"
    local dir; dir="$(slot_dir "$slot")"

    mkdir -p "$dir"

    # Kill any prior background downloader for this slot before rewriting the
    # playlist — otherwise it'd race with the new shuffle/content.
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

    rebuild_playlist_from_queue "$slot" "$name" "$queue_json" "$shuffle" || return 1
    # Record the queue that built this playlist so a warm reconnect (same queue,
    # within WARM_REUSE_WINDOW) can reuse playlist.m3u instead of re-fetching +
    # rebuilding. See warm_reconnect_ok / start_playback.
    printf '%s' "$queue_url" > "$dir/.playlist_queue" 2>/dev/null || true
}

# Fork the background downloader for the remaining tracks recorded in
# .bg_remaining. Each track is cached via get_cached_path (central cache) and
# its central path is APPENDED to playlist.m3u (file), then — best-effort,
# guarded by socket presence — appended into mpv's live in-memory list via
# `loadfile append` so a cold queue gains variety during the download instead
# of looping only the primed subset. The authoritative full-list sync is still
# a single position-preserving loadlist replace once .bg_done is touched (see
# start_playback), which closes the warm-cache subset-loop race. On finish:
# rm .bg_remaining/downloader.pid, touch .bg_done, emit bg.complete.
spawn_bg_downloader() {
    local slot="$1" name="$2" dir; dir="$(slot_dir "$slot")"
    [[ -s "$dir/.bg_remaining" ]] || { touch "$dir/.bg_done"; return 0; }
    ( exec 9>&-; set +e
      local plex_id url title cpath
      while IFS=$'\t' read -r plex_id url title; do
          if cpath=$(get_cached_path "$plex_id" "$url" "$name"); then
              printf '#EXTINF:-1,%s\n%s\n' "$title" "$cpath" >> "$dir/playlist.m3u"
              # Incremental: extend mpv's in-memory list live so a cold queue
              # gains variety during download instead of looping the primed
              # subset. Safe here because bg is forked AFTER the socket is up.
              # Best-effort: the authoritative full-list sync is the final
              # loadlist-replace reconcile in start_playback.
              if [[ -S "$dir/mpv-socket" ]]; then
                  mpv_ipc "$dir/mpv-socket" "{\"command\":[\"loadfile\",\"$cpath\",\"append\"]}" >/dev/null 2>&1 || true
              fi
          else
              logev "$name" bg.skip plex_id="$plex_id" reason=cache_fail
          fi
      done < "$dir/.bg_remaining"
      rm -f "$dir/.bg_remaining" "$dir/downloader.pid"
      touch "$dir/.bg_done"
      logev "$name" bg.complete file_count="$(grep -c '^/' "$dir/playlist.m3u" 2>/dev/null || echo 0)"
    ) &
    echo $! > "$dir/downloader.pid"
    logev "$name" bg.spawned pid=$!
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

# === mpv-IPC + playlist-reconcile helpers (Unit D1) =========================
# These are the verified-IPC building blocks the race fix (Unit D2) wires into
# start_playback. Each uses the same socat/jq style as reload_mpv_playlist
# above. They are deliberately small and side-effect-free except where noted,
# so they can be tested in isolation against a fake mpv socket.

# Poll until the mpv IPC socket is live (0) or the timeout lapses (1).
# 0.2s steps * (timeout*5) iterations == timeout seconds total.
wait_for_mpv_socket() { # dir timeout_sec -> 0 when socket is live
    local socket="$1/mpv-socket" timeout="${2:-5}" waited=0
    while (( waited < timeout*5 )); do
        [[ -S "$socket" ]] && return 0
        sleep 0.2; waited=$((waited+1))
    done
    [[ -S "$socket" ]]
}

# Send a JSON command, print the raw response, return 0 iff mpv reports success.
mpv_ipc() { # socket json -> prints raw response; returns 0 iff "error":"success"
    local socket="$1" json="$2" resp
    [[ -S "$socket" ]] || return 1
    resp=$(echo "$json" | socat - "$socket" 2>/dev/null) || return 1
    echo "$resp"
    echo "$resp" | grep -q '"error":"success"'
}

# Current number of entries mpv has loaded (0 if unavailable).
mpv_playlist_count() { # socket -> integer (0 if unavailable)
    local socket="$1" r
    r=$(echo '{"command":["get_property","playlist-count"]}' | socat - "$socket" 2>/dev/null | jq -r '.data // 0') || r=0
    echo "${r:-0}"
}

# plex_id (basename minus .mp3) of the entry mpv is currently on, or empty.
mpv_current_plexid() { # socket -> plex_id of current entry, or empty
    local socket="$1" path
    path=$(echo '{"command":["get_property","path"]}' | socat - "$socket" 2>/dev/null | jq -r '.data // empty')
    [[ -n "$path" ]] && basename "$path" .mp3 || true
}

# Read a single mpv property's .data (empty on failure). Thin wrapper used by
# the watchdog stall detector to sample time-pos / pause.
mpv_get_prop() { # socket prop -> prints .data or empty
    local socket="$1" prop="$2"
    echo "{\"command\":[\"get_property\",\"$prop\"]}" | socat - "$socket" 2>/dev/null | jq -r '.data // empty'
}

# Best-effort current-track tags from the LIVE mpv via IPC. NO network, NO cache
# dependency: media-title is mpv's resolved display title; artist/album come
# from the file's embedded tags (empty when absent). Tab-separated so values may
# contain spaces. Used to enrich the track.start timeline so events carry the
# human-readable track, not just the plex_id.
mpv_track_tags() { # socket -> "<title>\t<artist>\t<album>"
    local socket="$1" title artist album
    title=$(mpv_get_prop "$socket" media-title)
    artist=$(mpv_get_prop "$socket" metadata/by-key/artist)
    album=$(mpv_get_prop "$socket" metadata/by-key/album)
    printf '%s\t%s\t%s' "$title" "$artist" "$album"
}

# The audio sink this mpv is ACTUALLY configured to output to, plus whether that
# sink is currently present in mpv's live device list. CRITICAL for detecting
# cross-routing: when a BT headset disconnects WITHOUT the daemon tearing down
# its mpv (a missed gdbus disconnect), mpv keeps its --audio-device string but
# that bluez_output sink is gone from PipeWire, so the stream is rerouted to
# whatever sink survives — i.e. one slot's audio plays on ANOTHER slot's
# headset. present=0 means "this slot's intended output is gone; audio (if any)
# is landing elsewhere" — the signal the per-slot track timeline alone cannot
# give. NO network; one extra IPC round-trip, only at track boundaries.
mpv_output_sink() { # socket -> "<audio-device>\t<present 1|0>"
    local socket="$1" dev list present=0
    dev=$(mpv_get_prop "$socket" audio-device)
    if [[ -n "$dev" ]]; then
        list=$(echo '{"command":["get_property","audio-device-list"]}' \
            | socat - "$socket" 2>/dev/null | jq -r '.data[]?.name // empty' 2>/dev/null)
        grep -qxF "$dev" <<< "$list" && present=1
    fi
    printf '%s\t%d' "$dev" "$present"
}

# PURE predicate (Unit F Part 2): has playback stalled between two watchdog
# ticks? Stalled iff NOT paused AND both samples are present AND time-pos did
# not advance (prev == cur). Conservative: a paused player or any missing sample
# is NEVER a stall, so we never fight a user pause or a transient IPC miss.
pos_stalled() { # prev cur paused -> 0 stalled / 1 not
    local prev="$1" cur="$2" paused="$3"
    [[ "$paused" == "true" ]] && return 1
    [[ -z "$prev" || -z "$cur" ]] && return 1
    [[ "$prev" == "$cur" ]] && return 0
    return 1
}

# PURE: 0-based index of the m3u entry whose basename (minus .mp3) == plex_id,
# or -1. No socket. Skips #-comments and blank lines. Extracted for testability.
playlist_index_of() { # playlist_file plex_id -> prints index or -1
    local file="$1" want="$2" i=0 line
    [[ -f "$file" ]] || { echo -1; return; }
    while IFS= read -r line; do
        [[ "$line" == \#* || -z "$line" ]] && continue
        [[ "$(basename "$line" .mp3)" == "$want" ]] && { echo "$i"; return; }
        i=$((i+1))
    done < "$file"
    echo -1
}

# PURE: prints the file path of the Nth (0-based) media entry in an m3u, or
# empty when the index is out of range. Skips #-comments and blank lines.
playlist_file_at() { # playlist_file index -> path or empty
    local file="$1" want="$2" i=0 line
    [[ -f "$file" ]] || return 0
    while IFS= read -r line; do
        [[ "$line" == \#* || -z "$line" ]] && continue
        if (( i == want )); then printf '%s' "$line"; return 0; fi
        i=$((i+1))
    done < "$file"
}

# Duration (seconds, float) of an audio file via ffprobe, or empty when it can't
# be determined. Wrapped in its own function so tests can stub it without real
# media. Failures are non-fatal (the caller treats "unknown" conservatively).
track_duration() { # file -> seconds or empty
    local f="$1"
    [[ -n "$f" && -f "$f" ]] || return 0
    ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" 2>/dev/null || true
}

# Clamp a saved (track,pos) resume pair against the LIVE playlist so mpv is
# never launched with --start=+POS past a track's end. mpv applies --start to
# every file, so a position past EOF makes it burn through the whole list,
# "Errors when loading file", exit immediately — and the watchdog then
# crash-loops the slot, which plays nothing while the headset is "connected"
# (observed on red/slot 1: state.json pos=4847 on a 75s track 0 after a
# playlist rebuild). Rules: an out-of-range / non-numeric track index restarts
# at "0 0"; a position at/after the resolved track's duration resets pos to 0;
# an undeterminable duration keeps the saved pos (don't silently lose resume).
# Prints "track pos". See tests/test_sanitize_resume.sh.
sanitize_resume() { # playlist_file track pos -> "track pos"
    local file="$1" track="${2:-0}" pos="${3:-0}"
    local count=0
    [[ -f "$file" ]] && count="$(grep -c '^/' "$file" 2>/dev/null || echo 0)"
    if ! [[ "$track" =~ ^[0-9]+$ ]] || (( track < 0 || track >= count )); then
        echo "0 0"; return
    fi
    if [[ "$pos" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
        local f dur; f="$(playlist_file_at "$file" "$track")"
        dur="$(track_duration "$f")"
        if [[ "$dur" =~ ^[0-9]+([.][0-9]+)?$ ]] && awk "BEGIN{exit !($pos >= $dur)}"; then
            echo "$track 0"; return
        fi
    fi
    echo "$track $pos"
}

# Reload playlist.m3u into mpv (replace) while keeping the current track if it
# survives the new list. loadlist resets pos to 0, so we re-seek to the
# surviving entry's new index. Logs a reconcile.loadlist event.
loadlist_replace_preserving_pos() { # slot name -> 0 on reconcile, 1 on skip/fail
    local slot="$1" name="$2" dir; dir="$(slot_dir "$slot")"
    local socket="$dir/mpv-socket"
    [[ -S "$socket" ]] || { logev "$name" reconcile.skip slot="$slot" reason=no_socket; return 1; }
    local cur_id before; cur_id="$(mpv_current_plexid "$socket")"; before="$(mpv_playlist_count "$socket")"
    mpv_ipc "$socket" "{\"command\":[\"loadlist\",\"$dir/playlist.m3u\",\"replace\"]}" >/dev/null || {
        logev "$name" reconcile.fail slot="$slot" reason=loadlist; return 1; }
    local idx; idx="$(playlist_index_of "$dir/playlist.m3u" "$cur_id")"
    if (( idx >= 0 )); then
        mpv_ipc "$socket" "{\"command\":[\"set_property\",\"playlist-pos\",$idx]}" >/dev/null || true
    fi
    local after; after="$(mpv_playlist_count "$socket")"
    logev "$name" reconcile.loadlist slot="$slot" mpv_count="${before}-${after}" cur_track_survived="$([[ $idx -ge 0 ]] && echo true || echo false)"
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

    # Warm reconnect: if this is a quick reconnect for the same queue (BT flap),
    # reuse the cached playlist instead of the cold API fetch + rebuild + bg
    # re-download. Still inside the lock, so no drift risk. Falls through to the
    # cold path for anything that isn't a fresh, same-queue, fully-downloaded
    # reuse. The membership/refresh loops reconcile any drift once mpv is up.
    local warm=0
    if warm_reconnect_ok "$slot" "$queue"; then
        warm=1
        log "$name" "warm reconnect — reusing cached playlist (skipping queue refetch/rebuild)"
        logev "$name" playlist.warm_reuse slot="$slot"
    # Guardrail 3: fetch_and_cache must run INSIDE the lock. Previously
    # callers ran `fetch_and_cache && start_playback`, but that lets a
    # losing-the-flock caller still rewrite playlist.m3u with their own
    # shuffle while the winning caller's mpv has already loaded the
    # earlier content — producing playlist drift (mpv plays one order,
    # file shows another).
    elif ! fetch_and_cache "$slot" "$name" "$queue" "$shuffle"; then
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
        # Clamp the saved resume against the live playlist. After a playlist
        # rebuild the saved track index can be gone, or the saved position can
        # exceed the new track's duration — either makes mpv seek past EOF and
        # exit immediately, and the watchdog then crash-loops the slot so it
        # plays nothing while "connected". See sanitize_resume + tests.
        local _safe _st _sp
        _safe="$(sanitize_resume "$dir/playlist.m3u" "$start_track" "$start_pos")"
        read -r _st _sp <<< "$_safe"
        if [[ "$_st" != "$start_track" || "$_sp" != "$start_pos" ]]; then
            logev "$name" resume.clamped from_track="$start_track" from_pos="$start_pos" to_track="$_st" to_pos="$_sp"
            start_track="$_st"; start_pos="$_sp"
        fi
        log "$name" "Resuming: track=$start_track pos=$start_pos"
        logev "$name" resume track="$start_track" pos="$start_pos"
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
    # mpv.log: rotate the previous launch's log to mpv.log.1 (so a crash's
    # log survives the next restart's truncation) and raise the message
    # level so demuxer/stream/ao/ffmpeg warnings — the signal for partial or
    # corrupt cache files — are captured. AUDIO-SAFETY: ONLY these two
    # additions (rotate + --msg-level) were made here; no other flag was
    # added, removed, or reordered. Do NOT add --audio-fallback-to-null,
    # PIPEWIRE_PROPS/node.dont-reconnect, or any ao-mute (see README "Audio
    # flow troubleshooting" — that combination silently silences mpv).
    [[ -f "$dir/mpv.log" ]] && mv "$dir/mpv.log" "$dir/mpv.log.1"
    ( exec 9>&-; exec mpv --no-video --no-terminal \
        --msg-level=all=info,demuxer=warn,stream=warn,ao=warn,ffmpeg=warn \
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
    logev "$name" mpv.start pid=$! resume_track="$start_track" resume_pos="$start_pos"

    sleep 2
    if ! kill -0 "$!" 2>/dev/null; then
        log "$name" "mpv exited immediately after launch"
        logev "$name" mpv.exit_immediate slot="$slot"
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

    # mpv is up; wait for its IPC socket before doing anything that needs it.
    if wait_for_mpv_socket "$dir" 8; then
        logev "$name" mpv.loaded slot="$slot" count="$(mpv_playlist_count "$dir/mpv-socket")"
    else
        logev "$name" mpv.socket_timeout slot="$slot"
    fi
    # Cold path only: playlist.m3u holds just the primed subset, so kick the bg
    # downloader for the rest and reconcile mpv once it finishes. The warm path
    # already loaded the COMPLETE playlist and must NOT run this — removing
    # .bg_done here would break warm-reuse for the next flap, and there's nothing
    # left to download or reconcile.
    if (( warm == 0 )); then
        rm -f "$dir/.bg_done"
        spawn_bg_downloader "$slot" "$name"
        # One-shot reconcile: when the bg finishes appending the full list to the
        # file, reload it into mpv (position-preserving) so mpv's in-memory list
        # matches the full playlist — closing the warm-cache subset-loop race.
        # exec 9>&- so the long-lived reconcile subshell does NOT hold the FD-9
        # playback lock (it is still open in this parent until the line below).
        ( exec 9>&-; set +e
          for _ in $(seq 1 120); do [[ -f "$dir/.bg_done" ]] && break; sleep 1; done
          rm -f "$dir/.bg_done"
          loadlist_replace_preserving_pos "$slot" "$name"
          logev "$name" playback.reconciled slot="$slot" \
                mpv_count="$(mpv_playlist_count "$dir/mpv-socket")" \
                file_count="$(grep -c '^/' "$dir/playlist.m3u" 2>/dev/null || echo 0)" ) &
    fi

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
    [[ -n "${CONNECTIVITY_PID:-}" ]] && kill "$CONNECTIVITY_PID" 2>/dev/null || true

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
            # Armed slots (scheduled fires / POST /api/play) override the
            # device's schedule-correct static queue — identical to the
            # override membership_tick applies. Without this, refresh_loop
            # re-fetched the SCHEDULED queue and clobbered an active override
            # every REFRESH_INTERVAL, while membership_loop yanked it back
            # every MEMBERSHIP_INTERVAL — the two loops fought and an
            # explicit override "reverted" to the scheduled queue on a ~5 min
            # cycle. The .armed.json sentinel keeps the override durable
            # without ever mutating config.
            if is_armed_for_play "$slot"; then
                local armed_queue
                armed_queue=$(armed_field "$slot" "queue")
                [[ -n "$armed_queue" ]] && queue=$(resolve_queue_url "$armed_queue")
            fi
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
                    if fetch_and_cache "$slot" "$tag" "$queue" "$shuffle"; then
                        # Reload the freshly-primed list into the running mpv,
                        # then stream the remainder in the background and do a
                        # one-shot position-preserving reconcile once it lands.
                        reload_mpv_playlist "$slot" "$tag" || true
                        rm -f "$dir/.bg_done"
                        spawn_bg_downloader "$slot" "$tag"
                        ( exec 9>&-
                          for _ in $(seq 1 120); do [[ -f "$dir/.bg_done" ]] && break; sleep 1; done
                          rm -f "$dir/.bg_done"
                          loadlist_replace_preserving_pos "$slot" "$tag" ) &
                    fi
                )
            fi
        done
    done
}

# Membership self-heal tier (Unit E). One pass: for each device whose mpv is
# live (a live mpv implies BT-connected — disconnect hard-kills it, mirroring
# refresh_loop's gate), resolve the SCHEDULE-CORRECT active queue exactly as
# refresh_loop does (selected_queue/selected_shuffle, with armed-queue override
# like the watchdog), then reconcile the running mpv to the server-side queue.
# Cheap when nothing drifted (hash compare in reconcile_slot_membership).
# Extracted as a single pass so it is unit-testable; membership_loop just calls
# it on an interval.
membership_tick() {
    local count idx
    count=$(jq '.devices | length' "$CONFIG_FILE" 2>/dev/null || echo 0)
    for ((idx=0; idx<count; idx++)); do
        local device_json slot name mac tag queue shuffle dir
        device_json=$(jq -c ".devices[$idx]" "$CONFIG_FILE" 2>/dev/null) || continue
        slot=$(jq -r '.slot' <<< "$device_json")
        name=$(jq -r '.name' <<< "$device_json")
        mac=$(jq -r '.mac' <<< "$device_json")
        tag=$(device_tag "$slot" "$mac" "$name")
        shuffle=$(selected_shuffle "$device_json")
        dir=$(slot_dir "$slot")

        # Only touch slots with a live mpv (idle slots have nothing to reconcile
        # and we don't want to fetch their queues). Mirrors refresh_loop's gate.
        [[ -f "$dir/mpv.pid" ]] && kill -0 "$(cat "$dir/mpv.pid" 2>/dev/null)" 2>/dev/null || continue

        # Resolve the effective active queue, schedule-aware. Armed slots
        # (scheduled fires / /play) override the device's static queue — this is
        # how a public slot (no static queue) gets a queue at all.
        queue=$(selected_queue "$device_json")
        if is_armed_for_play "$slot"; then
            local armed_queue
            armed_queue=$(armed_field "$slot" "queue")
            [[ -n "$armed_queue" ]] && queue=$(resolve_queue_url "$armed_queue")
        fi

        # Skip cleanly when there is no per-device queue (e.g. class=public
        # white speaker, slot 5) — reconcile would no-op but better to skip.
        [[ -z "$queue" ]] && continue

        reconcile_slot_membership "$slot" "$tag" "$queue" "$shuffle"
    done
}

# Background loop: membership self-heal every MEMBERSHIP_INTERVAL seconds.
membership_loop() {
    while true; do
        sleep "$MEMBERSHIP_INTERVAL"
        membership_tick
    done
}

# Rolling HTTP HEAD content-change scheduler (Unit F Part 1).
# Each tick HEAD-checks a BOUNDED, round-robin slice of the live cache set so a
# full pass over all live files spans ~HEAD_FULL_PASS seconds rather than
# bursting one HEAD per file at once. With one tick per MEMBERSHIP_INTERVAL (60s)
# and HEAD_FULL_PASS=900, that's ~15 ticks/pass, so batch = ceil(live/15). The
# cursor persists across ticks in $BASE_DIR/.head_cursor and wraps at the end of
# the live list. Batch is hard-clamped (<=12) so a large library can never burst
# 100+ HEADs in a single tick. head_check itself is a cheap no-op unless the
# server's Content-Length actually changed.
HEAD_BATCH_CLAMP=12
head_sweep_tick() {
    local cursor_file="$BASE_DIR/.head_cursor"
    local -a ids=()
    local id
    while IFS= read -r id; do [[ -n "$id" ]] && ids+=("$id"); done < <(cache_live_set)
    local n=${#ids[@]}
    (( n == 0 )) && return 0

    # ticks per full pass (>=1); batch = ceil(n / ticks).
    local ticks=$(( HEAD_FULL_PASS / MEMBERSHIP_INTERVAL ))
    (( ticks < 1 )) && ticks=1
    local batch=$(( (n + ticks - 1) / ticks ))
    (( batch < 1 )) && batch=1
    if (( batch > HEAD_BATCH_CLAMP )); then
        logev sweep cache.head_clamp requested="$batch" clamped="$HEAD_BATCH_CLAMP" live="$n"
        batch=$HEAD_BATCH_CLAMP
    fi

    local cursor; cursor=$(cat "$cursor_file" 2>/dev/null || echo 0)
    [[ "$cursor" =~ ^[0-9]+$ ]] || cursor=0
    (( cursor >= n )) && cursor=0

    local i pos url checked=0
    for (( i=0; i<batch; i++ )); do
        pos=$(( (cursor + i) % n ))
        id="${ids[$pos]}"
        url=$(cache_meta_get "$id" source_url)
        [[ -z "$url" ]] && continue          # no recorded source — can't HEAD
        head_check "$id" "$url" sweep
        checked=$((checked+1))
    done
    # Advance + persist the cursor (wrap). Always advance by batch so we make
    # forward progress even if some ids in this window had no source_url.
    cursor=$(( (cursor + batch) % n ))
    echo "$cursor" > "$cursor_file"
    logev sweep cache.head_pass batch="$batch" checked="$checked" cursor="$cursor" live="$n"
}

# Background loop: rolling HEAD content-change every MEMBERSHIP_INTERVAL seconds.
# Staggered (initial sleep 30) so it does not fire simultaneously with
# membership_loop, which shares the same interval.
head_loop() {
    sleep 30
    while true; do
        sleep "$MEMBERSHIP_INTERVAL"
        head_sweep_tick
    done
}

# Background loop: ref-counted orphan cache sweep every SWEEP_INTERVAL seconds.
# Staggered (initial sleep 45) off the other self-heal loops.
sweep_loop() {
    sleep 45
    while true; do
        sleep "$SWEEP_INTERVAL"
        cache_orphan_sweep
    done
}

# Revalidate-on-stall (Unit F Part 2). Called from the watchdog's ALIVE branch
# on every tick for a live mpv. Samples time-pos + pause and compares to the
# pos this slot reported on the PREVIOUS tick (persisted in $dir/.last_pos). If
# pos_stalled fires across two consecutive ticks (~10s of frozen, unpaused
# playback — the signature of a bad/partial cache file mpv cannot decode), it
# treats the current track as corrupt: drop the cache file, force a
# revalidate/redownload via get_cached_path, then loadlist-replace to reload the
# repaired file in place.
#
# Anti-thrash: it will NOT re-revalidate the SAME plex_id more than once per
# STALL_REVALIDATE_COOLDOWN seconds (state in $dir/.last_revalidate = "id epoch").
# This function NEVER kills mpv or touches mpv.pid/state.json — it only
# revalidates + reloads, so it cannot interfere with the watchdog's respawn,
# position-persist, or fast-kill paths. It is intentionally OFF the disconnect
# path (called only when mpv is alive AND the device is connected).
#   args: slot tag socket
mpv_check_stall() {
    local slot="$1" tag="$2" socket="$3" dir; dir="$(slot_dir "$slot")"
    [[ -S "$socket" ]] || return 0
    local cur paused; cur="$(mpv_get_prop "$socket" time-pos)"; paused="$(mpv_get_prop "$socket" pause)"
    local prev; prev="$(cat "$dir/.last_pos" 2>/dev/null || echo "")"
    # Record current pos for the next tick's comparison (always).
    printf '%s' "$cur" > "$dir/.last_pos"

    local id; id="$(mpv_current_plexid "$socket")"

    # Track-progression timeline (best-effort, cheap): when the current
    # plex_id changes from the last-seen one, emit a track.start. Reuses the
    # already-sampled current id — no extra polling loop. State lives in
    # $dir/.last_track_id alongside the stall machinery.
    if [[ -n "$id" ]]; then
        local last_id; last_id="$(cat "$dir/.last_track_id" 2>/dev/null || echo "")"
        if [[ "$id" != "$last_id" ]]; then
            printf '%s' "$id" > "$dir/.last_track_id"
            # Enrich the timeline with the human-readable track + the ACTUAL
            # output sink. `|| true` on the reads: mpv_track_tags/mpv_output_sink
            # emit no trailing delimiter, so `read` returns non-zero at EOF even
            # though it assigns the vars — guard it so `set -e` can't abort here.
            local _title _artist _album _sink _present
            IFS=$'\t' read -r _title _artist _album < <(mpv_track_tags "$socket") || true
            IFS=$'\t' read -r _sink _present < <(mpv_output_sink "$socket") || true
            logev "$tag" track.start plex_id="$id" idx="$(mpv_get_prop "$socket" playlist-pos)" \
                "title=$_title" "artist=$_artist" "album=$_album" "sink=$_sink" "sink_live=$_present"
            # Audio-routing guard: the configured sink is gone from mpv's live
            # device list, so this slot's audio is being rerouted to whatever
            # sink survives — it can surface on ANOTHER headset (the
            # Baby-Joy-Joy-on-yellow failure). Emit a loud, greppable event so
            # this is detectable instead of silently mis-attributed to this slot.
            [[ "$_present" == "0" ]] && \
                logev "$tag" audio.sink_orphaned plex_id="$id" "sink=$_sink" slot="$slot"
        fi
    fi

    pos_stalled "$prev" "$cur" "$paused" || return 0

    [[ -z "$id" ]] && return 0

    # Cooldown: skip if we already revalidated THIS id within the window.
    local lr lr_id lr_ts now; now=$(date +%s)
    lr="$(cat "$dir/.last_revalidate" 2>/dev/null || echo "")"
    lr_id="${lr%% *}"; lr_ts="${lr##* }"
    if [[ "$lr_id" == "$id" && "$lr_ts" =~ ^[0-9]+$ ]] && (( now - lr_ts < STALL_REVALIDATE_COOLDOWN )); then
        return 0
    fi

    logev "$tag" track.stall plex_id="$id" pos="$cur" slot="$slot"
    local url; url="$(cache_meta_get "$id" source_url)"
    if [[ -z "$url" ]]; then
        logev "$tag" track.stall_skip plex_id="$id" reason=no_source_url
        return 0
    fi
    printf '%s %s' "$id" "$now" > "$dir/.last_revalidate"
    rm -f "$(cache_path "$id")"
    get_cached_path "$id" "$url" "$tag" >/dev/null || true
    loadlist_replace_preserving_pos "$slot" "$tag" || true
    logev "$tag" cache.revalidate plex_id="$id" slot="$slot" reason=playback_stall
    return 0
}

# Audio cross-routing reaper. The watchdog only reaches its ALIVE branch when
# org.bluez Device1.Connected is true — but that is the ACL link, NOT the audio
# path. Audio needs the A2DP bluez_output.<mac> sink, and under BT-adapter
# contention (one adapter can't sustain two A2DP streams) the two diverge: the
# ACL stays up while the sink vanishes. mpv then keeps its --audio-device
# pointed at the gone sink and PipeWire MIGRATES the orphaned stream onto
# whatever sink survives — one slot's audio plays on ANOTHER slot's headset
# (the "Baby-Joy-Joy-on-yellow" bug). The gdbus disconnect handler that runs
# stop_playback fast never fires here (the device never "disconnected").
#
# This poll-based check closes that gap: when mpv's configured sink is absent
# from its own live device list for ORPHAN_SINK_TICKS consecutive watchdog ticks
# (hysteresis rides out a transient A2DP renegotiation), reap mpv with the same
# fast teardown that slams the migration window shut. Respawn is gated by
# resolve_audio_device (it waits for the real sink and refuses otherwise), so
# this cannot thrash into a reap/respawn loop. Tick state lives in
# $dir/.sink_gone_ticks alongside the stall machinery.
#
# Conservative by design: an EMPTY sink string (mpv not reporting a device yet,
# or an IPC hiccup) is treated as healthy — we only reap on a positively-absent
# sink. Returns 0 IF IT REAPED (so the watchdog can `&& continue`), 1 otherwise.
#   args: slot tag socket
mpv_check_orphan_sink() {
    local slot="$1" tag="$2" socket="$3" dir; dir="$(slot_dir "$slot")"
    [[ -S "$socket" ]] || return 1
    local sink present
    IFS=$'\t' read -r sink present < <(mpv_output_sink "$socket") || true
    local f="$dir/.sink_gone_ticks"
    # Healthy (sink present) or indeterminate (empty) -> reset the counter and
    # clear any orphan-reap respawn-suppression stamp (audio is flowing again).
    if [[ "$present" == "1" || -z "$sink" ]]; then
        printf '0' > "$f"
        rm -f "$dir/.last_orphan_reap"
        return 1
    fi
    # Sink positively absent: count consecutive ticks.
    local n; n="$(cat "$f" 2>/dev/null || echo 0)"; [[ "$n" =~ ^[0-9]+$ ]] || n=0
    n=$((n + 1)); printf '%s' "$n" > "$f"
    if (( n >= ORPHAN_SINK_TICKS )); then
        logev "$tag" audio.sink_reap sink="$sink" ticks="$n" slot="$slot"
        stop_playback "$slot" "$tag" fast
        printf '0' > "$f"
        # Stamp the reap so the watchdog can suppress its blocking respawn while
        # the sink is still absent (see ORPHAN_REAP_COOLDOWN).
        printf '%s' "$(date +%s)" > "$dir/.last_orphan_reap"
        return 0
    fi
    return 1
}

# Positive playback-liveness heartbeat. Called from the watchdog's ALIVE branch
# every tick, but self-throttled to one emit per HEARTBEAT_INTERVAL per slot so
# the ledger gets a periodic "audio is (or isn't) flowing" sample without spam.
# This is the ONLY event that captures steady-state playback: track.start fires
# only on a track CHANGE and is suppressed on resume-to-same-track, so without
# this a connected-but-paused / connected-but-silent slot leaves no trace at all
# (the exact gap that made connected-but-paused RED invisible in events.jsonl).
# State: $dir/.last_heartbeat (epoch). Cleared implicitly when mpv dies (the
# next live mpv just re-throttles from its own first tick). Best-effort: any IPC
# miss yields empty fields, never aborts the watchdog (|| true at call site).
#   args: slot tag socket
emit_heartbeat() {
    local slot="$1" tag="$2" socket="$3" dir; dir="$(slot_dir "$slot")"
    [[ -S "$socket" ]] || return 0
    local last now; last="$(cat "$dir/.last_heartbeat" 2>/dev/null || echo 0)"
    [[ "$last" =~ ^[0-9]+$ ]] || last=0
    now=$(date +%s)
    (( now - last < HEARTBEAT_INTERVAL )) && return 0
    printf '%s' "$now" > "$dir/.last_heartbeat"
    local pos paused id sink present
    pos="$(mpv_get_prop "$socket" time-pos)"
    # mpv_get_prop pipes through `jq '.data // empty'`, and jq's // treats the
    # boolean FALSE as empty — so a playing (pause=false) slot would emit an empty
    # paused field. Normalize the empty case to an explicit false so the heartbeat
    # always carries a real true/false.
    paused="$(mpv_get_prop "$socket" pause)"; paused="${paused:-false}"
    id="$(mpv_current_plexid "$socket")"
    IFS=$'\t' read -r sink present < <(mpv_output_sink "$socket") || true
    logev "$tag" playback.heartbeat plex_id="$id" pos="$pos" paused="$paused" sink_live="$present"
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
            if [[ "$conn" != "b true" ]]; then
                # Device disconnected. The gdbus monitor normally fast-kills mpv
                # here, but it can DROP disconnect events during BT flapping —
                # leaving an orphaned mpv whose audio PipeWire migrates onto
                # another headset. Poll-based backstop: reap any survivor.
                if [[ -f "$dir/mpv.pid" ]] && kill -0 "$(cat "$dir/mpv.pid" 2>/dev/null)" 2>/dev/null; then
                    log "$tag" "watchdog: device disconnected but mpv alive — reaping (missed gdbus disconnect?)"
                    # Ledger integrity: the gdbus monitor missed the disconnect
                    # edge, so it never logged bt.disconnect — the prior session
                    # would otherwise hang open forever. Emit the close here (the
                    # only place that observed the drop) so sessions stay paired.
                    logev "$tag" bt.disconnect mac="$mac" reason=watchdog_reap
                    stop_playback "$slot" "$tag" fast
                fi
                continue
            fi

            if [[ -f "$dir/mpv.pid" ]]; then
                mpv_pid=$(cat "$dir/mpv.pid" 2>/dev/null)
                if [[ -n "$mpv_pid" ]] && kill -0 "$mpv_pid" 2>/dev/null; then
                    # Audio cross-routing reaper: the ACL link is up but if this
                    # mpv's A2DP sink has vanished (adapter contention), its
                    # stream is leaking onto another headset — reap it before the
                    # stall/save work (no point IPC-saving into a gone sink).
                    # Returns 0 only when it reaped; `&& continue` then skips the
                    # rest of this tick (set -e ignores the non-last && member).
                    mpv_check_orphan_sink "$slot" "$tag" "$dir/mpv-socket" && continue
                    # Persist position every tick (quiet — no log spam) so the
                    # fast-kill disconnect path has a fresh resume point without
                    # needing a live IPC save while the sink is being torn down.
                    save_position "$slot" "$name" quiet
                    # Revalidate-on-stall: ADD-ONLY self-heal for a frozen track
                    # (bad/partial cache file). Never touches mpv.pid/state/respawn;
                    # cooldown-guarded so it can't thrash. `|| true` keeps the
                    # watchdog loop unbreakable even under set -e.
                    mpv_check_stall "$slot" "$tag" "$dir/mpv-socket" || true
                    # Positive liveness sample (self-throttled to HEARTBEAT_INTERVAL).
                    emit_heartbeat "$slot" "$tag" "$dir/mpv-socket" || true
                    continue
                fi
                rm -f "$dir/mpv.pid" "$dir/mpv-socket"
            fi

            # Respawn suppression after an orphan-sink reap: if we just reaped
            # this slot's mpv because its A2DP sink vanished, don't immediately
            # call start_playback — resolve_audio_device would block ~12s waiting
            # for a sink that is still gone, stalling the whole watchdog loop and
            # spamming the log, every tick. Skip respawn for ORPHAN_REAP_COOLDOWN
            # seconds; a real reconnect still respawns instantly via the gdbus
            # monitor's connect handler, independent of this backstop.
            local _reap_ts
            _reap_ts="$(cat "$dir/.last_orphan_reap" 2>/dev/null || echo 0)"
            [[ "$_reap_ts" =~ ^[0-9]+$ ]] || _reap_ts=0
            if (( _reap_ts > 0 && $(date +%s) - _reap_ts < ORPHAN_REAP_COOLDOWN )); then
                continue
            fi

            # Same stability gate as the gdbus connect handler: don't respawn
            # into a link that's still flapping (it would just be torn down
            # again). Costs BT_SETTLE_SEC only on an actual respawn (rare).
            if ! bt_link_stable "$mac"; then
                log "$tag" "watchdog: BT connected but link unstable — deferring respawn"
                continue
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

    # One-time startup migration: fold any legacy per-slot caches
    # (slots/<N>/cache/<id>.mp3) into the central $CACHE_DIR before the
    # per-slot `mkdir -p .../cache` loop below touches those dirs. Idempotent
    # and runs exactly once at daemon start (NOT in any loop). Config is already
    # materialized by the refresh_config_cache call in the dispatch guard.
    migrate_per_slot_caches || true

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

    # Start membership self-heal loop (reconcile mpv to server-side queue
    # membership/order drift every MEMBERSHIP_INTERVAL)
    membership_loop &
    MEMBERSHIP_PID=$!

    # Start rolling HEAD content-change loop (Unit F): bounded round-robin HEADs
    # over the live cache set, ~HEAD_FULL_PASS per full pass. Staggered (sleep 30)
    # off membership_loop so the two same-interval loops don't fire together.
    head_loop &
    HEAD_PID=$!

    # Start orphan cache sweep loop (Unit F): ref-counted TTL + size-cap eviction
    # every SWEEP_INTERVAL. Staggered (sleep 45) off the other self-heal loops.
    sweep_loop &
    SWEEP_PID=$!

    # Start scheduled-fire loop (one-shot wake events from devices.yml `scheduled:`)
    scheduled_loop &
    SCHEDULED_PID=$!

    # Start self-check loop (missed fires, override orphans, stuck armed flags)
    selfcheck_loop &
    SELFCHECK_PID=$!

    # Start BT connectivity self-heal loop: proactive reconnect + PSCAN heal +
    # alert for schedule-active private headsets the gdbus monitor can't see.
    connectivity_loop &
    CONNECTIVITY_PID=$!

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
                        local _cmac
                        _cmac=$(jq -r '.mac' <<< "$device_json")
                        log "$name" "Connected"
                        logev "$name" bt.connect mac="$_cmac"
                        # Don't commit to playback on the bare Connected edge —
                        # require the link to hold for BT_SETTLE_SEC first. A
                        # flapping link would otherwise spawn+teardown mpv (and a
                        # full prime/download) per blip. If it drops during settle,
                        # leave connected_state false so the next stable connect
                        # re-enters; the watchdog (also gated) is the backstop if
                        # the link settles without another gdbus edge.
                        if ! bt_link_stable "$_cmac"; then
                            log "$name" "link unstable during settle — deferring playback to next stable connect"
                            logev "$name" bt.connect_unstable mac="$_cmac"
                            # Ledger integrity: we logged bt.connect above but the
                            # link did not hold, so connected_state stays false and
                            # a later BlueZ drop emits NO bt.disconnect (guarded on
                            # connected_state==true). Without a closing event a
                            # naive connect→disconnect pairing reads this as a
                            # multi-hour "session" (it fooled the 2026-06-16 log
                            # review). Emit an explicit close so the connect is
                            # self-balancing in events.jsonl.
                            logev "$name" bt.connect_aborted mac="$_cmac"
                            continue
                        fi
                        connected_state[$dbus_id]=true
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
                        # Bleed fix: end_session in FAST mode SIGKILLs this
                        # slot's mpv immediately (before any IPC), so PipeWire
                        # can't migrate the now-sinkless stream onto another
                        # connected headset ("green/blue piling onto yellow").
                        # This replaces the old LANE GUARDRAIL disconnect-time
                        # IPC mute, which raced the new mpv socket on reconnect
                        # and silenced fresh playback. No mute IPC here — just a
                        # hard kill. Resume position comes from state.json, kept
                        # fresh by the watchdog's periodic save.
                        log "$name" "Disconnected"
                        logev "$name" bt.disconnect mac="$(jq -r '.mac' <<< "$device_json")"
                        connected_state[$dbus_id]=false
                        end_session "$slot" "$name" fast
                        # Fast-path reconnect: a transient RF blip during an active
                        # schedule window shouldn't wait up to CONNECT_CHECK_INTERVAL
                        # for connectivity_loop. Immediately (best-effort, backgrounded)
                        # page the headset; the gated connect handler resumes once the
                        # link proves stable. Gated to active windows so an off-hours
                        # power-off (user done) isn't chased.
                        if [[ "$(device_class "$device_json")" == "private" ]] \
                            && active_schedule_json "$device_json" >/dev/null 2>&1; then
                            kick_reconnect "$(jq -r '.mac' <<< "$device_json")" "$(slot_dir "$slot")"
                        fi
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
# mpv_ipc lives with the Unit D1 helpers above (socket-based, verified). The
# control-path call sites below pass the resolved socket path via slot_dir.

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
                        # Stream the remainder of the override queue in the
                        # background, then reconcile the full list into mpv.
                        local odir; odir="$(slot_dir "$slot")"
                        rm -f "$odir/.bg_done"
                        spawn_bg_downloader "$slot" "$tag"
                        ( exec 9>&-
                          for _ in $(seq 1 120); do [[ -f "$odir/.bg_done" ]] && break; sleep 1; done
                          rm -f "$odir/.bg_done"
                          loadlist_replace_preserving_pos "$slot" "$tag" ) &
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
                mpv_ipc "$(slot_dir "$slot")/mpv-socket" '{"command":["cycle","pause"]}' >/dev/null && \
                    applied=$((applied+1)) || skipped=$((skipped+1))
                ;;
            next)
                mpv_ipc "$(slot_dir "$slot")/mpv-socket" '{"command":["playlist-next"]}' >/dev/null && \
                    applied=$((applied+1)) || skipped=$((skipped+1))
                ;;
            prev)
                mpv_ipc "$(slot_dir "$slot")/mpv-socket" '{"command":["playlist-prev"]}' >/dev/null && \
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
                mpv_ipc "$(slot_dir "$slot")/mpv-socket" "{\"command\":[\"set_property\",\"volume\",$v]}" >/dev/null && \
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

# Only run the command dispatch (and its config-cache side effects) when this
# script is executed directly. When sourced (e.g. by the bash test harness),
# all functions are defined but nothing auto-launches or exits.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
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
fi
