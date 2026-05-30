#!/usr/bin/env bash
# Unit D2: rebuild_playlist_from_queue primes LAZY_PRIME_COUNT, records the rest
# to .bg_remaining, and preserves queue order (shuffle=false path).
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e   # production script enables `set -euo pipefail`; restore lenient mode

# Portable size check for macOS dev (stat -c is GNU-only).
file_size_bytes() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }

# Stub get_cached_path: echo a deterministic fake central path per id, no I/O.
# (The real one would hit the network; we test rebuild's ordering/partitioning.)
get_cached_path() { echo "/fake/cache/$1.mp3"; return 0; }

SLOT=0
dir="$HOME/playback-hub/slots/$SLOT"
mkdir -p "$dir"

# LAZY_PRIME_COUNT is 5 in the script. Build an 8-item queue.
make_queue() { # n -> prints items JSON
    local n="$1" i items=""
    for ((i=1; i<=n; i++)); do
        items+="{\"contentId\":\"plex:$((100*i))\",\"mediaUrl\":\"/m/$((100*i))\",\"title\":\"Track $i\"},"
    done
    echo "{\"items\":[${items%,}]}"
}

# === Case 1: N (8) > LAZY_PRIME_COUNT (5), shuffle=false ===
qjson=$(make_queue 8)
rebuild_playlist_from_queue "$SLOT" "$SLOT" "$qjson" false; rc=$?
assert_eq "0" "$rc" "rebuild returns 0 when primed>0"

# playlist.m3u should have exactly LAZY_PRIME_COUNT path lines.
primed_lines=$(grep -c '^/fake/cache/' "$dir/playlist.m3u")
assert_eq "5" "$primed_lines" "playlist has exactly LAZY_PRIME_COUNT primed entries"

# Ordering: first primed path must be id 100 (queue order, no shuffle).
first_path=$(grep '^/fake/cache/' "$dir/playlist.m3u" | head -1)
assert_eq "/fake/cache/100.mp3" "$first_path" "first primed entry is queue-order track 1"
fifth_path=$(grep '^/fake/cache/' "$dir/playlist.m3u" | sed -n '5p')
assert_eq "/fake/cache/500.mp3" "$fifth_path" "fifth primed entry is queue-order track 5"

# .bg_remaining should have exactly N - prime = 3 lines, each 3 tab fields,
# in queue order starting at track 6 (id 600).
assert_true "[[ -f '$dir/.bg_remaining' ]]" ".bg_remaining exists"
rem_lines=$(wc -l < "$dir/.bg_remaining" | tr -d ' ')
assert_eq "3" "$rem_lines" ".bg_remaining has N - prime lines"

# Column count: split first line on tab, expect 3 fields (plex_id, url, title).
first_rem=$(head -1 "$dir/.bg_remaining")
nfields=$(awk -F'\t' '{print NF}' <<< "$first_rem")
assert_eq "3" "$nfields" ".bg_remaining rows have 3 tab-separated fields"

# First remaining row is track 6 (id 600), url ${API_BASE}/m/600, title "Track 6".
rem_id=$(cut -f1 <<< "$first_rem")
rem_url=$(cut -f2 <<< "$first_rem")
rem_title=$(cut -f3 <<< "$first_rem")
assert_eq "600" "$rem_id" "first remaining plex_id is track 6"
assert_eq "${API_BASE}/m/600" "$rem_url" "first remaining url has API_BASE prefix"
assert_eq "Track 6" "$rem_title" "first remaining title preserved"

# === Case 2: N (3) < LAZY_PRIME_COUNT (5) -> all primed, no .bg_remaining ===
rm -f "$dir/playlist.m3u" "$dir/.bg_remaining"
qjson=$(make_queue 3)
rebuild_playlist_from_queue "$SLOT" "$SLOT" "$qjson" false; rc=$?
assert_eq "0" "$rc" "rebuild returns 0 for small queue"
primed_lines=$(grep -c '^/fake/cache/' "$dir/playlist.m3u")
assert_eq "3" "$primed_lines" "all 3 tracks primed when N < LAZY_PRIME_COUNT"
assert_false "[[ -f '$dir/.bg_remaining' ]]" "no .bg_remaining when nothing remains"

# === Case 3: all tracks fail to cache -> returns 1, no playlist swap ===
rm -f "$dir/playlist.m3u" "$dir/.bg_remaining"
get_cached_path() { return 1; }
qjson=$(make_queue 4)
rebuild_playlist_from_queue "$SLOT" "$SLOT" "$qjson" false; rc=$?
assert_eq "1" "$rc" "rebuild returns 1 when nothing can be primed"
assert_false "[[ -f '$dir/playlist.m3u' ]]" "no playlist.m3u written when all prime fails"

teardown_tmp; finish
