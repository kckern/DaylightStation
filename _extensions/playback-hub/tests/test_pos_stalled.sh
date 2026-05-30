#!/usr/bin/env bash
# Unit F Part 2 (pure predicate): pos_stalled decides whether playback has
# stalled between two watchdog ticks. Stalled iff NOT paused AND prev/cur are
# both numeric AND equal (time-pos did not advance). Any missing/empty value or
# a paused player is NOT a stall (conservative — never fight a user pause).
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e

# pos_stalled prev cur paused -> exit 0 (stalled) / 1 (not stalled)
assert_true  "pos_stalled 12.3 12.3 false" "equal pos, not paused -> stalled"
assert_false "pos_stalled 12.3 15.0 false" "advancing pos -> not stalled"
assert_false "pos_stalled 12.3 12.3 true"  "equal pos but PAUSED -> not stalled"
assert_false "pos_stalled '' 12.3 false"   "empty prev -> not stalled (no baseline)"
assert_false "pos_stalled 12.3 '' false"   "empty cur -> not stalled"
assert_false "pos_stalled '' '' false"     "both empty -> not stalled"
# Float equality: identical string compare is fine since mpv echoes same value.
assert_true  "pos_stalled 0 0 false"       "stuck at 0 (bad cache, never starts) -> stalled"
assert_false "pos_stalled 0 0 true"        "stuck at 0 but paused -> not stalled"

teardown_tmp; finish
