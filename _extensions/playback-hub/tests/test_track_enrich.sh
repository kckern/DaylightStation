#!/usr/bin/env bash
# track.start enrichment: the timeline must carry the human-readable track
# (title/artist/album, pulled network-free from the live mpv) AND the ACTUAL
# output sink + whether that sink is still present. The sink-presence signal is
# what catches cross-routing — one slot's mpv playing on another slot's headset
# after its own BT sink vanished (the Baby-Joy-Joy-on-yellow incident).
#
# Exercises the real helpers against fake_mpv.py over a UNIX socket — no real
# mpv, no network, no PipeWire.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e

require_socat() { command -v socat >/dev/null 2>&1; }
if ! require_socat; then echo "  SKIP: socat not installed"; finish; exit $?; fi

FAKE="$(dirname "$0")/fake_mpv.py"

start_fake() { # sockpath extra-args...  -> starts fake_mpv, waits for socket
    local sock="$1"; shift
    python3 "$FAKE" "$sock" "$@" &
    FAKE_PID=$!
    local i=0; while [[ ! -S "$sock" && $i -lt 50 ]]; do sleep 0.05; i=$((i+1)); done
}
stop_fake() { [[ -n "$FAKE_PID" ]] && kill "$FAKE_PID" 2>/dev/null; wait "$FAKE_PID" 2>/dev/null; FAKE_PID=""; }

# === kv_to_json preserves spaces in values (titles/albums have spaces) ===
out=$(kv_to_json 'title=La maja y el ruiseñor' 'plex_id=622841')
assert_eq '"title":"La maja y el ruiseñor","plex_id":"622841"' "$out" "kv_to_json keeps spaces in value"
# and JSON-escapes embedded double quotes
out=$(kv_to_json 'title=He said "hi"')
assert_eq '"title":"He said \"hi\""' "$out" "kv_to_json escapes quotes"

# === mpv_track_tags: title + artist + album from live mpv (tab-separated) ===
SOCK1="$HOME/s1.sock"
start_fake "$SOCK1" --media-title "La maja y el ruiseñor" --meta "artist=Enrique Granados,album=Most Relaxing Piano"
IFS=$'\t' read -r T A AL < <(mpv_track_tags "$SOCK1")
assert_eq "La maja y el ruiseñor" "$T"  "mpv_track_tags title"
assert_eq "Enrique Granados"      "$A"  "mpv_track_tags artist"
assert_eq "Most Relaxing Piano"   "$AL" "mpv_track_tags album"
stop_fake

# === mpv_track_tags: missing artist/album tags -> empty fields, no crash ===
SOCK2="$HOME/s2.sock"
start_fake "$SOCK2" --media-title "Track 3"
IFS=$'\t' read -r T A AL < <(mpv_track_tags "$SOCK2")
assert_eq "Track 3" "$T"  "mpv_track_tags title (no tags)"
assert_eq ""        "$A"  "mpv_track_tags empty artist"
assert_eq ""        "$AL" "mpv_track_tags empty album"
stop_fake

# === mpv_output_sink: configured sink IS present -> present=1 ===
SOCK3="$HOME/s3.sock"
start_fake "$SOCK3" --audio-device "pipewire/bluez_output.AA.1" \
    --audio-device-list "auto,pipewire,pipewire/bluez_output.AA.1"
IFS=$'\t' read -r SINK PRESENT < <(mpv_output_sink "$SOCK3")
assert_eq "pipewire/bluez_output.AA.1" "$SINK"    "mpv_output_sink device"
assert_eq "1"                          "$PRESENT" "sink present -> 1"
stop_fake

# === mpv_output_sink: configured sink GONE from list -> present=0 (the bug) ===
SOCK4="$HOME/s4.sock"
start_fake "$SOCK4" --audio-device "pipewire/bluez_output.BLUE.1" \
    --audio-device-list "auto,pipewire,pipewire/bluez_output.YELLOW.1"
IFS=$'\t' read -r SINK PRESENT < <(mpv_output_sink "$SOCK4")
assert_eq "pipewire/bluez_output.BLUE.1" "$SINK"    "mpv_output_sink reports dead device string"
assert_eq "0"                            "$PRESENT" "orphaned sink -> 0"
stop_fake

# === END-TO-END: mpv_check_stall emits an enriched track.start, and an
#     audio.sink_orphaned event when the configured sink is gone ===
file_size_bytes() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }
mkdir -p "$(dirname "$CONFIG_FILE")"
echo '{"devices":[{"slot":7,"color":"blue"}]}' > "$CONFIG_FILE"
SLOT=7; TAG=7; dir="$(slot_dir "$SLOT")"; mkdir -p "$dir"
JL="$dir/events.jsonl"; : > "$JL"

# Fake mpv whose CURRENT file is 592905.mp3 (a Baby Joy Joy track), tagged, but
# whose configured sink (BLUE) is NOT in the live device list (only YELLOW is) —
# the exact incident shape.
SOCK5="$dir/mpv-socket"
start_fake "$SOCK5" --playlist "/cache/592905.mp3" --pos 0 \
    --media-title "Baby Joy Joy - Wash Your Hands" --meta "artist=Baby Joy Joy,album=Baby Joy Joy" \
    --audio-device "pipewire/bluez_output.BLUE.1" \
    --audio-device-list "auto,pipewire,pipewire/bluez_output.YELLOW.1"

mpv_check_stall "$SLOT" "$TAG" "$SOCK5"

ts_evt() { jq -r "select(.evt==\"$1\") | .$2" "$JL" | tail -1; }
assert_eq "track.start" "$(jq -r '.evt' "$JL" | grep -m1 track.start)" "track.start emitted"
assert_eq "592905"                       "$(ts_evt track.start plex_id)" "track.start plex_id"
assert_eq "Baby Joy Joy - Wash Your Hands" "$(ts_evt track.start title)"  "track.start carries title"
assert_eq "Baby Joy Joy"                 "$(ts_evt track.start artist)"  "track.start carries artist"
assert_eq "pipewire/bluez_output.BLUE.1" "$(ts_evt track.start sink)"    "track.start carries actual sink"
assert_eq "0"                            "$(ts_evt track.start sink_live)" "sink_live=0 (configured sink absent)"
assert_eq "592905" "$(ts_evt audio.sink_orphaned plex_id)" "audio.sink_orphaned fired for misrouted audio"
stop_fake

teardown_tmp; finish
