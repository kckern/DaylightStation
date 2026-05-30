#!/usr/bin/env bash
# Unit E: reconcile_slot_membership establishes a baseline, no-ops on unchanged
# membership, and reconciles (rebuild + bg + loadlist) on drift. API-down skips.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e   # production script enables `set -euo pipefail`; restore lenient mode

# reconcile's drift branch now takes the per-slot FD-9 playback.lock via raw
# `flock -n 9`. On dev hosts without flock, shim it (success = lock acquired) so
# the reconcile path runs. FLOCK_FORCE_BUSY stays 0 here (no contention).
shim_flock_if_absent

# Portable size check for macOS dev (stat -c is GNU-only).
file_size_bytes() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }
# Deterministic fake central path per id, no network.
get_cached_path() { echo "/fake/cache/$1.mp3"; return 0; }

SLOT=0
dir="$HOME/playback-hub/slots/$SLOT"
mkdir -p "$dir"
CALLS="$HOME/calls.log"

# Stubs that record invocation (and let us assert call counts).
spawn_bg_downloader() { echo "spawn_bg $*" >> "$CALLS"; }
loadlist_replace_preserving_pos() { echo "loadlist $*" >> "$CALLS"; return 0; }

# curl_api stub: echoes contents of $QFILE (the "server" queue), or fails when
# $API_DOWN=1.
QFILE="$HOME/server_queue.json"
curl_api() { [[ "${API_DOWN:-0}" == 1 ]] && return 1; cat "$QFILE"; }

q() { # ids... -> queue JSON
    local items="" id
    for id in "$@"; do
        items+="{\"contentId\":\"plex:$id\",\"mediaUrl\":\"/m/$id\",\"title\":\"T$id\"},"
    done
    echo "{\"items\":[${items%,}]}"
}

reset_calls() { : > "$CALLS"; }
calls_count() { grep -c "$1" "$CALLS" 2>/dev/null; true; }

# === Case (a): no .membership -> establishes baseline, NO reconcile ===
rm -f "$dir/.membership" "$dir/playlist.m3u"
q 1 2 3 > "$QFILE"
reset_calls
reconcile_slot_membership "$SLOT" "tag" "http://q" false; rc=$?
assert_eq "0" "$rc" "(a) returns 0"
assert_true "[[ -f '$dir/.membership' ]]" "(a) baseline .membership written"
expected_hash=$(queue_membership_hash "$(q 1 2 3)")
assert_eq "$expected_hash" "$(cat "$dir/.membership")" "(a) baseline hash matches server queue"
assert_eq "0" "$(calls_count loadlist)" "(a) loadlist NOT called (no reconcile)"
assert_eq "0" "$(calls_count spawn_bg)" "(a) spawn_bg NOT called (no reconcile)"
assert_false "[[ -f '$dir/playlist.m3u' ]]" "(a) no playlist rebuilt on baseline establish"

# === Case (b): same hash -> no-op ===
reset_calls
reconcile_slot_membership "$SLOT" "tag" "http://q" false; rc=$?
assert_eq "0" "$rc" "(b) returns 0"
assert_eq "0" "$(calls_count loadlist)" "(b) loadlist NOT called on unchanged membership"
assert_eq "0" "$(calls_count spawn_bg)" "(b) spawn_bg NOT called on unchanged membership"
assert_eq "$expected_hash" "$(cat "$dir/.membership")" "(b) baseline unchanged"

# === Case (c): changed hash -> rebuild + .membership update + bg + loadlist ===
q 9 8 7 6 > "$QFILE"          # different membership AND order
new_hash=$(queue_membership_hash "$(q 9 8 7 6)")
reset_calls
reconcile_slot_membership "$SLOT" "tag" "http://q" false; rc=$?
assert_eq "0" "$rc" "(c) returns 0"
assert_true "[[ -f '$dir/playlist.m3u' ]]" "(c) playlist.m3u rebuilt"
# First primed entry should be id 9 (new queue order, shuffle=false).
first_path=$(grep '^/fake/cache/' "$dir/playlist.m3u" | head -1)
assert_eq "/fake/cache/9.mp3" "$first_path" "(c) playlist reflects new queue order"
assert_eq "$new_hash" "$(cat "$dir/.membership")" "(c) .membership updated to new hash"
assert_eq "1" "$(calls_count spawn_bg)" "(c) spawn_bg_downloader called once"
assert_eq "1" "$(calls_count loadlist)" "(c) loadlist_replace_preserving_pos called once"

# Steady state: re-running with the SAME server queue is now a no-op.
reset_calls
reconcile_slot_membership "$SLOT" "tag" "http://q" false
assert_eq "0" "$(calls_count loadlist)" "(c2) next tick is a no-op (baseline updated)"

# === Case (d): API down -> reconcile.skip, no crash, no reconcile ===
reset_calls
API_DOWN=1
reconcile_slot_membership "$SLOT" "tag" "http://q" false; rc=$?
API_DOWN=0
assert_eq "0" "$rc" "(d) api_down returns 0 (skip, no crash)"
assert_eq "0" "$(calls_count loadlist)" "(d) loadlist NOT called when api down"
assert_eq "0" "$(calls_count spawn_bg)" "(d) spawn_bg NOT called when api down"

# === Case (e): bad JSON -> reconcile.skip, no reconcile ===
echo 'totally not json' > "$QFILE"
reset_calls
reconcile_slot_membership "$SLOT" "tag" "http://q" false; rc=$?
assert_eq "0" "$rc" "(e) bad_json returns 0 (skip)"
assert_eq "0" "$(calls_count loadlist)" "(e) loadlist NOT called on bad json"

teardown_tmp; finish
