#!/usr/bin/env bash
# Minimal bash test helpers. No external deps.
TESTS_RUN=0; TESTS_FAILED=0
_t_tmproot=""
setup_tmp() { _t_tmproot=$(mktemp -d); echo "$_t_tmproot"; }
teardown_tmp() { [[ -n "$_t_tmproot" && -d "$_t_tmproot" ]] && rm -rf "$_t_tmproot"; }
assert_eq() { # expected actual [msg]
  TESTS_RUN=$((TESTS_RUN+1))
  if [[ "$1" != "$2" ]]; then
    TESTS_FAILED=$((TESTS_FAILED+1))
    echo "  FAIL: ${3:-assert_eq}: expected [$1] got [$2]"; return 1
  fi
}
assert_true() { TESTS_RUN=$((TESTS_RUN+1)); if ! eval "$1"; then TESTS_FAILED=$((TESTS_FAILED+1)); echo "  FAIL: ${2:-assert_true}: [$1]"; return 1; fi; }
assert_false(){ TESTS_RUN=$((TESTS_RUN+1)); if eval "$1"; then TESTS_FAILED=$((TESTS_FAILED+1)); echo "  FAIL: ${2:-assert_false}: [$1]"; return 1; fi; }
finish() { echo "Ran $TESTS_RUN, failed $TESTS_FAILED"; [[ $TESTS_FAILED -eq 0 ]]; }

# flock shim for hosts where real flock is absent (stock macOS dev). The
# PRODUCTION reconcile/start_playback/refresh_loop paths use RAW `flock -n 9`
# (no `command -v` guard — real locking is wanted on the Ubuntu target). On a
# host without flock that raw call errors with "command not found", which the
# `if ! flock` test reads as contention. To exercise these paths deterministically
# in dev, shim `flock` only when the real binary is missing:
#   - normal:                 `flock -n N` -> success (lock acquired)
#   - FLOCK_FORCE_BUSY=1:     `flock -n N` -> failure (simulates lock held)
# Tests set FLOCK_FORCE_BUSY=1 to assert the contention/skip branch. When real
# flock IS present (the target), this is a no-op and the genuine lock is used.
shim_flock_if_absent() {
    if command -v flock >/dev/null 2>&1; then
        FLOCK_SHIMMED=0
        return 0
    fi
    FLOCK_SHIMMED=1
    flock() {
        # Non-blocking emulation: honor FLOCK_FORCE_BUSY to simulate contention.
        # We ignore the fd argument — the function under test always opens fd 9
        # on its own per-slot lockfile immediately before calling us, so a single
        # busy flag faithfully models "another writer holds this slot's lock".
        [[ "${FLOCK_FORCE_BUSY:-0}" == 1 ]] && return 1
        return 0
    }
    export -f flock
}
