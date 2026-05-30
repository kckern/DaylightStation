#!/usr/bin/env bash
# Unit H — THE standing warm-cache subset-loop guard.
#
# This is the canonical regression test for the ORIGINAL bug: a WARM central
# cache (every track already downloaded) would start mpv on only the primed
# LAZY_PRIME_COUNT subset and then loop that subset forever, because the
# authoritative full-list reconcile never ran / raced the not-yet-up socket.
#
# It drives the REAL post-launch start sequence end-to-end against a fake mpv,
# using the genuine production functions (rebuild_playlist_from_queue,
# spawn_bg_downloader, loadlist_replace_preserving_pos, and the real central
# cache validate/get_cached_path path). The ONLY thing stubbed is the network
# boundary (curl_fetch_to / cache_download) — and those are stubbed to FAIL
# LOUDLY: if the warm path is genuinely warm, they must NEVER be called.
#
# ASSERTION WITH TEETH: after the sequence, mpv's in-memory playlist MUST hold
# the FULL set (12), not LAZY_PRIME_COUNT (5). If anyone reintroduces the
# subset-loop, the final count regresses to 5 and this test fails.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e   # production script enables `set -euo pipefail`; restore lenient mode

# macOS dev portability: stat -c is GNU-only -> wc -c. flock may be absent.
file_size_bytes() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }
shim_flock_if_absent

# --- Network boundary tripwires --------------------------------------------
# The warm cache must satisfy EVERY track from disk. If any of these fires the
# cache wasn't warm and the test premise is broken. They write a marker and
# return failure so the assertions below catch it loudly.
NETHIT="$HOME/network_was_called"
cache_download() { echo "cache_download $*" >> "$NETHIT"; return 1; }
curl_fetch_to()  { echo "curl_fetch_to $*"  >> "$NETHIT"; return 1; }
curl_api()       { echo "curl_api $*"        >> "$NETHIT"; return 1; }

SLOT=0
NAME=red
dir="$(slot_dir "$SLOT")"
mkdir -p "$dir" "$CACHE_DIR"
sock="$dir/mpv-socket"
FMPID=""

start_fake() { # --playlist ... --pos ...
    python3 "$(dirname "$0")/fake_mpv.py" "$sock" "$@" &
    FMPID=$!
    for _ in $(seq 1 50); do [[ -S "$sock" ]] && break; sleep 0.1; done
}
stop_fake() { [[ -n "$FMPID" ]] && { kill "$FMPID" 2>/dev/null; wait "$FMPID" 2>/dev/null; }; FMPID=""; }
trap 'stop_fake' EXIT

q_count() { echo '{"command":["get_property","playlist-count"]}' | socat - "$sock" 2>/dev/null | jq -r '.data'; }

# ---------------------------------------------------------------------------
# Step 1: PRE-POPULATE the CENTRAL cache so it is WARM for all N=12 ids.
# For each id: write a real (>MIN_AUDIO_BYTES) audio file AND a valid meta via
# the REAL cache_meta_write, so the REAL validate_cached passes with no I/O.
# ---------------------------------------------------------------------------
N=12
ids=()
filler="$(head -c $((MIN_AUDIO_BYTES + 512)) /dev/zero | tr '\0' 'A')"
for ((i=1; i<=N; i++)); do
    id=$((100*i))
    ids+=("$id")
    printf '%s' "$filler" > "$(cache_path "$id")"
    sz=$(file_size_bytes "$(cache_path "$id")")
    cache_meta_write "$id" "$sz" "" "http://example/$id"   # REAL meta writer
done

# Sanity: the REAL validate_cached must already pass for every id (warm cache).
warm_ok=1
for id in "${ids[@]}"; do validate_cached "$id" || warm_ok=0; done
assert_eq "1" "$warm_ok" "central cache is WARM: validate_cached passes for all 12 ids (no download needed)"

# Build the N=12 queue JSON (queue order, shuffle=false).
make_queue() {
    local items="" i id
    for ((i=1; i<=N; i++)); do
        id=$((100*i))
        items+="{\"contentId\":\"plex:$id\",\"mediaUrl\":\"/m/$id\",\"title\":\"Track $i\"},"
    done
    echo "{\"items\":[${items%,}]}"
}
qjson="$(make_queue)"

# ---------------------------------------------------------------------------
# Step 2: rebuild_playlist_from_queue -> primes first LAZY_PRIME_COUNT (5),
# records the other 7 to .bg_remaining. Hits the WARM cache (no download).
# ---------------------------------------------------------------------------
rebuild_playlist_from_queue "$SLOT" "$NAME" "$qjson" false; rc=$?
assert_eq "0" "$rc" "rebuild_playlist_from_queue returns 0 (primed > 0)"

primed_lines=$(grep -c '^/' "$dir/playlist.m3u")
assert_eq "$LAZY_PRIME_COUNT" "$primed_lines" "playlist.m3u primed exactly LAZY_PRIME_COUNT entries"
rem_lines=$(wc -l < "$dir/.bg_remaining" | tr -d ' ')
assert_eq "$((N - LAZY_PRIME_COUNT))" "$rem_lines" ".bg_remaining holds the other 7 tracks"

# The primed central paths point into the warm cache (no per-slot fallback).
first_primed=$(grep '^/' "$dir/playlist.m3u" | head -1)
assert_eq "$(cache_path 100)" "$first_primed" "first primed entry is the warm central-cache path"

# ---------------------------------------------------------------------------
# Step 3: start fake mpv seeded with ONLY the 5 primed entries — mimicking mpv
# having just launched with the primed subset (the racy moment in production).
# ---------------------------------------------------------------------------
primed_paths=$(grep '^/' "$dir/playlist.m3u" | paste -sd, -)
start_fake --playlist "$primed_paths" --pos 0
assert_true "[[ -S '$sock' ]]" "fake mpv socket came up"
assert_eq "$LAZY_PRIME_COUNT" "$(q_count)" "mpv launched on the primed subset only (count == 5)"

# ---------------------------------------------------------------------------
# Step 4: spawn the REAL background downloader; wait for .bg_done. It caches
# each remaining id from the WARM cache and loadfile-appends into live mpv.
# ---------------------------------------------------------------------------
rm -f "$dir/.bg_done"
# TEETH_SKIP=1 disables the bg+reconcile to prove the guard assertions below
# genuinely fail (mpv stuck at the primed subset) — see the self-review run.
# Default (unset) exercises the real fix.
if [[ "${TEETH_SKIP:-0}" != 1 ]]; then
    spawn_bg_downloader "$SLOT" "$NAME"
    for _ in $(seq 1 100); do [[ -f "$dir/.bg_done" ]] && break; sleep 0.1; done
    assert_true "[[ -f '$dir/.bg_done' ]]" ".bg_done created — background downloader finished"
fi

# ---------------------------------------------------------------------------
# Step 5: the AUTHORITATIVE reconcile (this is the fix). Position-preserving
# loadlist replace pulls mpv up to the full membership.
# ---------------------------------------------------------------------------
if [[ "${TEETH_SKIP:-0}" != 1 ]]; then
    loadlist_replace_preserving_pos "$SLOT" "$NAME"; rc=$?
    assert_eq "0" "$rc" "loadlist_replace_preserving_pos reconciled (rc 0)"
fi

# ===========================================================================
# THE GUARD ASSERTIONS — these fail if the subset-loop regresses.
# ===========================================================================
final_mpv_count="$(mpv_playlist_count "$sock")"
assert_eq "$N" "$final_mpv_count" \
  "SUBSET-LOOP GUARD: mpv in-memory playlist == FULL set ($N). If this is $LAZY_PRIME_COUNT the warm-cache subset-loop has regressed."

file_media_count=$(grep -c '^/' "$dir/playlist.m3u")
assert_eq "$N" "$file_media_count" \
  "playlist.m3u file holds the FULL set ($N media lines), not just the primed subset"

# ---------------------------------------------------------------------------
# Step 6: prove the WARM path was exercised — NO download / network occurred.
# If the cache hadn't been warm, get_cached_path would have hit cache_download
# /curl_fetch_to/curl_api (all rigged to fail+record), corrupting the run.
# ---------------------------------------------------------------------------
assert_false "[[ -f '$NETHIT' ]]" \
  "warm path proven: no cache_download/curl_fetch_to/curl_api invoked (the previously-racy warm path was exercised)"

stop_fake
teardown_tmp; finish
