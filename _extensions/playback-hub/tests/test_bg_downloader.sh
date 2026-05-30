#!/usr/bin/env bash
# Unit D2: spawn_bg_downloader caches each .bg_remaining entry (via
# get_cached_path), appends its central path to playlist.m3u (FILE), and —
# best-effort, guarded by socket presence — appends it into mpv's live
# in-memory list via `loadfile append`, then touches .bg_done, removes
# .bg_remaining, and emits bg.complete.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e

file_size_bytes() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }

# Stub get_cached_path: deterministic fake central path, no network.
get_cached_path() { echo "/fake/cache/$1.mp3"; return 0; }

SLOT=0
dir="$HOME/playback-hub/slots/$SLOT"
mkdir -p "$dir"
sock="$dir/mpv-socket"
FMPID=""

start_fake() { # --playlist ... --pos ...
    python3 "$(dirname "$0")/fake_mpv.py" "$sock" "$@" &
    FMPID=$!
    for i in $(seq 1 50); do [[ -S "$sock" ]] && break; sleep 0.1; done
}
stop_fake() { [[ -n "$FMPID" ]] && { kill "$FMPID" 2>/dev/null; wait "$FMPID" 2>/dev/null; }; FMPID=""; }
# Always clean up the background fake on exit so the runner never hangs.
trap 'stop_fake' EXIT

q_count() { echo '{"command":["get_property","playlist-count"]}' | socat - "$sock" 2>/dev/null | jq -r '.data'; }

# Seed a primed playlist (1 entry) so we can verify the bg APPENDS, not replaces.
cat > "$dir/playlist.m3u" <<'EOF'
#EXTM3U
#EXTINF:-1,Primed
/fake/cache/100.mp3
EOF

# === CASE 1: socket present -> incremental loadfile append reaches mpv ===
# Start fake mpv seeded with the primed entry (mirrors mpv launched
# --playlist=playlist.m3u with the primed subset already loaded).
start_fake --playlist /fake/cache/100.mp3 --pos 0
assert_true "[[ -S '$sock' ]]" "fake mpv socket came up"
assert_eq "1" "$(q_count)" "mpv seeded with the single primed entry"

# Seed .bg_remaining with 2 entries (plex_id, url, title — tab separated).
printf '%s\t%s\t%s\n' 200 "http://x/200" "Track Two"  > "$dir/.bg_remaining"
printf '%s\t%s\t%s\n' 300 "http://x/300" "Track Three" >> "$dir/.bg_remaining"

rm -f "$dir/.bg_done"
spawn_bg_downloader "$SLOT" "$SLOT"

# Poll for completion (bg runs detached). Give it a generous timeout.
for _ in $(seq 1 50); do [[ -f "$dir/.bg_done" ]] && break; sleep 0.1; done
assert_true "[[ -f '$dir/.bg_done' ]]" ".bg_done created on completion"

# playlist.m3u now has the original primed entry + 2 appended = 3 path lines.
path_lines=$(grep -c '^/fake/cache/' "$dir/playlist.m3u")
assert_eq "3" "$path_lines" "bg appended both remaining tracks to file (total 3)"

# The two appended paths are present, in order, AFTER the primed one.
all_paths=$(grep '^/fake/cache/' "$dir/playlist.m3u")
assert_eq "/fake/cache/100.mp3" "$(sed -n '1p' <<< "$all_paths")" "primed entry preserved first"
assert_eq "/fake/cache/200.mp3" "$(sed -n '2p' <<< "$all_paths")" "first remaining appended second"
assert_eq "/fake/cache/300.mp3" "$(sed -n '3p' <<< "$all_paths")" "second remaining appended third"

# Incremental append reached mpv: in-memory list GREW by the 2 bg tracks
# (1 primed -> 3 total). This is the regression fix being proven — a cold
# queue gains variety live during download rather than looping the subset.
assert_eq "3" "$(q_count)" "mpv in-memory list grew by bg tracks (loadfile append reached mpv)"

# .bg_remaining and downloader.pid removed on completion.
assert_false "[[ -f '$dir/.bg_remaining' ]]" ".bg_remaining removed after bg run"
assert_false "[[ -f '$dir/downloader.pid' ]]" "downloader.pid removed after bg run"

# bg.complete event emitted (events.jsonl uses numeric slot 0).
ev="$dir/events.jsonl"
assert_true "grep -q 'bg.complete' '$ev'" "bg.complete event emitted"
assert_true "grep -q 'bg.spawned' '$ev'" "bg.spawned event emitted"

stop_fake

# === CASE 2: NO socket present -> file append still happens, append skipped ===
# Proves the [[ -S socket ]] guard: best-effort mpv append is simply skipped
# and the bg still appends to the FILE and completes cleanly.
rm -f "$sock"
rm -f "$dir/.bg_done"
cat > "$dir/playlist.m3u" <<'EOF'
#EXTM3U
#EXTINF:-1,Only
/fake/cache/100.mp3
EOF
printf '%s\t%s\t%s\n' 400 "http://x/400" "Track Four" > "$dir/.bg_remaining"
printf '%s\t%s\t%s\n' 500 "http://x/500" "Track Five" >> "$dir/.bg_remaining"

spawn_bg_downloader "$SLOT" "$SLOT"
for _ in $(seq 1 50); do [[ -f "$dir/.bg_done" ]] && break; sleep 0.1; done
assert_true "[[ -f '$dir/.bg_done' ]]" "no-socket: .bg_done created on completion"
path_lines=$(grep -c '^/fake/cache/' "$dir/playlist.m3u")
assert_eq "3" "$path_lines" "no-socket: bg still appends both tracks to file (total 3)"
assert_false "[[ -f '$dir/.bg_remaining' ]]" "no-socket: .bg_remaining removed"
assert_false "[[ -f '$dir/downloader.pid' ]]" "no-socket: downloader.pid removed"

# === CASE 3: Empty/absent .bg_remaining -> immediate .bg_done, no append ===
rm -f "$dir/.bg_done" "$dir/.bg_remaining"
cat > "$dir/playlist.m3u" <<'EOF'
#EXTM3U
#EXTINF:-1,Only
/fake/cache/100.mp3
EOF
spawn_bg_downloader "$SLOT" "$SLOT"
for _ in $(seq 1 30); do [[ -f "$dir/.bg_done" ]] && break; sleep 0.1; done
assert_true "[[ -f '$dir/.bg_done' ]]" "empty .bg_remaining still touches .bg_done"
path_lines=$(grep -c '^/fake/cache/' "$dir/playlist.m3u")
assert_eq "1" "$path_lines" "no append when nothing remaining"

teardown_tmp; finish
