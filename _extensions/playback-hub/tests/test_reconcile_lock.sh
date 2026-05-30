#!/usr/bin/env bash
# Unit E concurrency fix: reconcile_slot_membership's drift-mutation branch
# serializes with start_playback / refresh_loop on the SAME per-slot FD-9
# playback.lock. When that lock is already held by another writer, reconcile on
# a DRIFTED queue must SKIP (emit reconcile.skip reason=lock_busy) and must NOT
# rebuild / spawn_bg / loadlist. The lock-free early returns (api_down, bad_json,
# baseline-establish, no-op same-hash) must stay lock-free and unaffected.
#
# Local-flock note: on the Ubuntu target reconcile uses RAW `flock -n 9` (no
# `command -v` guard — real locking is wanted there). On dev hosts without flock
# we shim it (helpers.sh: shim_flock_if_absent) and drive contention via
# FLOCK_FORCE_BUSY=1 to model "another writer holds the lock". If neither real
# flock nor the shim can run, the test SKIPs loudly rather than passing silently.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e

shim_flock_if_absent
if [[ "${FLOCK_SHIMMED:-0}" == 1 ]]; then
    echo "  NOTE: real flock absent — using helpers.sh flock shim (FLOCK_FORCE_BUSY drives contention)"
fi

# Portable size check for macOS dev (stat -c is GNU-only).
file_size_bytes() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }
get_cached_path() { echo "/fake/cache/$1.mp3"; return 0; }

SLOT=0
dir="$HOME/playback-hub/slots/$SLOT"
mkdir -p "$dir"
CALLS="$HOME/calls.log"

# Record-only stubs so we can assert the mutation path is (not) taken. We assert
# via the $CALLS FILE (not a shell var) because reconcile runs inside `out=$(...)`
# command substitution — a subshell — so any variable set in a stub would not
# propagate to the parent. File appends survive the subshell.
# Emulate the real rebuild's relevant side-effect: it rewrites .membership to the
# new queue's hash (its 3rd arg is the queue json). Needed so the steady-state
# "same queue is now a no-op" assertion holds after a successful reconcile.
rebuild_playlist_from_queue() {
    echo "rebuild $*" >> "$CALLS"
    queue_membership_hash "$3" > "$dir/.membership"
    return 0
}
spawn_bg_downloader() { echo "spawn_bg $*" >> "$CALLS"; }
loadlist_replace_preserving_pos() { echo "loadlist $*" >> "$CALLS"; return 0; }

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

# Establish a baseline so the next differing queue is genuine DRIFT (not a
# baseline-establish early return).
q 1 2 3 > "$QFILE"
rm -f "$dir/.membership"
reconcile_slot_membership "$SLOT" red "http://q" false >/dev/null 2>&1
assert_true "[[ -f '$dir/.membership' ]]" "(setup) baseline membership written"
baseline_hash=$(cat "$dir/.membership")

# === Case (a): lock HELD + drifted queue -> SKIP, no mutation ===
# Hold the per-slot lock. With real flock: open the lockfile on a spare fd and
# flock it, so the function's `flock -n 9` on the SAME file fails. With the shim:
# set FLOCK_FORCE_BUSY=1.
q 9 8 7 6 > "$QFILE"            # genuine drift vs baseline
reset_calls
if [[ "${FLOCK_SHIMMED:-0}" == 1 ]]; then
    FLOCK_FORCE_BUSY=1
    out=$(reconcile_slot_membership "$SLOT" red "http://q" false 2>&1); rc=$?
    FLOCK_FORCE_BUSY=0
else
    exec 7>"$dir/playback.lock"; flock -n 7   # test holds the lock on fd 7
    out=$(reconcile_slot_membership "$SLOT" red "http://q" false 2>&1); rc=$?
    exec 7>&-                                 # release before the next case
fi
assert_eq "0" "$rc" "(a) returns 0 on contention (skip, not error)"
assert_true "grep -q 'reason=lock_busy' <<<\"\$out\"" "(a) emits reconcile.skip reason=lock_busy"
assert_eq "0" "$(calls_count rebuild)" "(a) rebuild NOT called under contention"
assert_eq "0" "$(calls_count spawn_bg)" "(a) spawn_bg NOT called under contention"
assert_eq "0" "$(calls_count loadlist)" "(a) loadlist NOT called under contention"
assert_eq "$baseline_hash" "$(cat "$dir/.membership")" "(a) .membership untouched (no rewrite under skip)"

# === Case (b): lock FREE + same drifted queue -> mutation proceeds ===
# Same queue still differs from baseline, so this is drift; now nothing holds the
# lock, so reconcile must rebuild + spawn_bg + loadlist and update .membership.
reset_calls
out=$(reconcile_slot_membership "$SLOT" red "http://q" false 2>&1); rc=$?
assert_eq "0" "$rc" "(b) returns 0 when lock free"
assert_eq "1" "$(calls_count rebuild)" "(b) rebuild called once when lock free"
assert_eq "1" "$(calls_count spawn_bg)" "(b) spawn_bg called once when lock free"
assert_eq "1" "$(calls_count loadlist)" "(b) loadlist called once when lock free"
assert_true "grep -q 'playlist.reconciled' <<<\"\$out\"" "(b) emits playlist.reconciled"

# === Case (c): lock-free EARLY returns take NO lock (stay lock-free) ===
# api_down must skip regardless of any lock state — it returns before fd 9 opens.
reset_calls
API_DOWN=1
out=$(reconcile_slot_membership "$SLOT" red "http://q" false 2>&1); rc=$?
API_DOWN=0
assert_eq "0" "$rc" "(c) api_down returns 0 (lock-free early return)"
assert_true "grep -q 'reason=api_down' <<<\"\$out\"" "(c) emits reconcile.skip reason=api_down"
assert_eq "0" "$(calls_count rebuild)" "(c) rebuild NOT called on api_down"

# No-op same-hash: re-run after (b) updated the baseline -> cheap exit, no lock.
reset_calls
out=$(reconcile_slot_membership "$SLOT" red "http://q" false 2>&1); rc=$?
assert_eq "0" "$rc" "(c2) same-hash no-op returns 0"
assert_eq "0" "$(calls_count rebuild)" "(c2) rebuild NOT called on no-op same hash"

teardown_tmp; finish
