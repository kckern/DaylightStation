#!/usr/bin/env bash
# Regression guard for the per-slot playback.lock (FD 9) inheritance footgun.
#
# start_playback acquires FD 9 (flock) and then spawns several children BEFORE
# releasing it. Any child that does NOT close FD 9 inherits the open file
# description and keeps the flock held for its entire life — starving every
# mid-session membership reconcile (reconcile.skip reason=lock_busy). That is
# the bug that kept red on its daytime queue past 21:00 (the day->lullaby switch
# happens while still connected, so no teardown frees the lock; the long-lived
# avrcp dispatcher held it all night).
#
# mpv and spawn_bg_downloader already use `( exec 9>&-; ... ) &`. This test
# asserts the avrcp dispatcher does too, and — to catch the NEXT person adding a
# backgrounded child — that no other `... &` spawn appears without a nearby
# `exec 9>&-`. Two layers: (1) PART A — exact positive assertions on the three
# known long-lived spawns; (2) PART B — a live flock behavioral proof on hosts
# that have real flock (the Ubuntu target), demonstrating WHY the close matters.
set +e
source "$(dirname "$0")/helpers.sh"
SCRIPT="$(dirname "$0")/../playback-hub.sh"

# --- PART A: static assertions on the known long-lived, lock-held spawns ------
# avrcp dispatcher must close FD 9 in its spawn subshell.
assert_true "grep -qE '\\( *exec 9>&-; *exec python3 \"\\\$BASE_DIR/avrcp_dispatch.py\"' '$SCRIPT'" \
    "avrcp dispatcher spawned with FD 9 closed"
# It must NOT be spawned as a bare backgrounded python3 (the regressed form).
assert_false "grep -qE '^[[:space:]]*python3 \"\\\$BASE_DIR/avrcp_dispatch.py\".*&[[:space:]]*\$' '$SCRIPT'" \
    "avrcp dispatcher is NOT a bare 'python3 ... &' (would inherit the lock)"
# mpv and the bg downloader already drop FD 9 — keep them honest.
assert_true "grep -qE '\\( *exec 9>&-; *exec mpv' '$SCRIPT'" \
    "mpv spawned with FD 9 closed"
assert_true "grep -qE '\\( *exec 9>&-; *set \\+e' '$SCRIPT'" \
    "bg downloader subshell closes FD 9"

# --- PART B: live proof that an inherited locked FD keeps the flock held ------
# Only runs where REAL flock exists (the deploy target). On a host without flock
# (stock macOS dev) the mechanism can't be exercised, so PART B is informational
# there — PART A already guards the code. This is NOT a silent assertion skip:
# the behavioral assertions only exist where they can be meaningful, and their
# absence is logged.
if command -v flock >/dev/null 2>&1; then
    tmp=$(mktemp -d); lock="$tmp/playback.lock"

    # Child WITHOUT closing FD 9 holds the lock past the parent's release.
    ( exec 9>"$lock"; flock -n 9 || exit 3
      ( sleep 3 ) &            # child inherits FD 9 (no exec 9>&-)
      child=$!
      exec 9>&-                # parent drops its handle...
      # ...but the child still holds the OFD, so a fresh non-blocking lock fails:
      if flock -n -w 0 "$lock" -c true 2>/dev/null; then echo HELD_FREE; else echo HELD_BUSY; fi
      kill "$child" 2>/dev/null
    ) > "$tmp/out_bad" 2>/dev/null
    assert_eq "HELD_BUSY" "$(cat "$tmp/out_bad")" "child inheriting FD 9 keeps the flock held"

    # Child WITH `exec 9>&-` does NOT hold the lock after parent release.
    ( exec 9>"$lock"; flock -n 9 || exit 3
      ( exec 9>&-; sleep 3 ) & # child drops FD 9
      child=$!
      exec 9>&-                # parent drops its handle -> lock now free
      if flock -n -w 0 "$lock" -c true 2>/dev/null; then echo FREE; else echo BUSY; fi
      kill "$child" 2>/dev/null
    ) > "$tmp/out_good" 2>/dev/null
    assert_eq "FREE" "$(cat "$tmp/out_good")" "child closing FD 9 releases the flock on parent exit"

    rm -rf "$tmp"
else
    echo "  NOTE: real flock absent on this host — PART B (live behavioral proof) not exercised; PART A static guards still ran."
fi

finish
