#!/usr/bin/env bash
# PURE unit test for the resume-position guard. A saved resume position that
# lands past the current track's duration — or a saved track index that no
# longer exists after a playlist rebuild — makes mpv launch with --start=+POS
# past EOF, exit immediately, and the watchdog crash-loops the slot so it plays
# NOTHING while "connected" (observed on red/slot 1, 2026-06-01: state.json
# pos=4847 on a 75s track 0). sanitize_resume clamps the (track,pos) pair
# against the live playlist before mpv is launched. track_duration is stubbed
# so the test needs no ffprobe / real media.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e   # production script enables `set -euo pipefail`; restore lenient mode

m3u="$HOME/playlist.m3u"
cat > "$m3u" <<'EOF'
#EXTM3U
#EXTINF:-1,Track A
/cache/100.mp3
#EXTINF:-1,Track B
/cache/200.mp3
#EXTINF:-1,Track C (unknown duration)
/cache/300.mp3
EOF

# Stub the impure duration probe: 100.mp3=75s, 200.mp3=130s, 300.mp3 unknown.
track_duration() {
    case "$(basename "$1" .mp3)" in
        100) echo "75" ;;
        200) echo "130" ;;
        *)   echo "" ;;
    esac
}

# --- playlist_file_at: 0-based media-entry lookup, skipping comments/blanks ---
assert_eq "/cache/100.mp3" "$(playlist_file_at "$m3u" 0)" "file at index 0"
assert_eq "/cache/200.mp3" "$(playlist_file_at "$m3u" 1)" "file at index 1"
assert_eq "/cache/300.mp3" "$(playlist_file_at "$m3u" 2)" "file at index 2"
assert_eq ""               "$(playlist_file_at "$m3u" 5)" "file at out-of-range index is empty"

# --- sanitize_resume: keep legitimate in-range resume ---
assert_eq "0 30" "$(sanitize_resume "$m3u" 0 30)"  "pos within duration is kept"
assert_eq "1 50" "$(sanitize_resume "$m3u" 1 50)"  "pos within duration is kept (track 1)"

# --- sanitize_resume: clamp the red crash-loop case (pos past EOF) ---
assert_eq "0 0" "$(sanitize_resume "$m3u" 0 4847)" "pos past short track resets pos to 0"
assert_eq "1 0" "$(sanitize_resume "$m3u" 1 200)"  "pos past track 1 duration resets pos to 0"
assert_eq "0 0" "$(sanitize_resume "$m3u" 0 75)"   "pos exactly at duration (EOF) resets pos to 0"

# --- sanitize_resume: out-of-range / invalid track index restarts at 0 0 ---
assert_eq "0 0" "$(sanitize_resume "$m3u" 9 100)"   "track index past end restarts at 0 0"
assert_eq "0 0" "$(sanitize_resume "$m3u" abc 10)"  "non-numeric track index restarts at 0 0"
assert_eq "0 0" "$(sanitize_resume "$m3u" -1 10)"   "negative track index restarts at 0 0"

# --- sanitize_resume: unknown duration is conservative (keep pos, don't lose resume) ---
assert_eq "2 1000" "$(sanitize_resume "$m3u" 2 1000)" "unknown duration keeps saved pos"

# --- sanitize_resume: defaults when state is empty ---
assert_eq "0 0" "$(sanitize_resume "$m3u" 0 0)"     "zero pos kept as 0 0"

teardown_tmp; finish
