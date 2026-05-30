#!/usr/bin/env bash
# Unit F Part 1 (scheduler): head_sweep_tick HEAD-checks a bounded, round-robin
# batch of live files per tick via a persisted cursor, so a full pass takes
# ~HEAD_FULL_PASS seconds. Pure logic test — head_check is stubbed; no network.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e

file_size_bytes() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }
LOGF="$HOME/log.txt"; logev() { echo "evt=$2 ${*:3}" >> "$LOGF"; }

mkdir -p "$CACHE_DIR"
CHECKED="$HOME/checked.log"

# Stub head_check to record which id it was asked to check (in order).
head_check() { echo "$1" >> "$CHECKED"; }

# Seed a deterministic live set by stubbing cache_live_set, plus per-id meta so
# head_sweep_tick can resolve each id's source_url.
LIVE_IDS=(10 20 30 40 50)
cache_live_set() { printf '%s\n' "${LIVE_IDS[@]}"; }
for id in "${LIVE_IDS[@]}"; do
    head -c 5000 /dev/zero > "$(cache_path "$id")"
    cache_meta_write "$id" 5000 "" "http://server/stream/$id"
done

CURSOR="$BASE_DIR/.head_cursor"

# With HEAD_FULL_PASS=900 and MEMBERSHIP_INTERVAL=60 -> ticks/pass = 15.
# live_count=5 -> batch = ceil(5/15) = 1. Each tick checks exactly 1 id and the
# cursor advances by 1, wrapping after the 5th.
HEAD_FULL_PASS=900; MEMBERSHIP_INTERVAL=60

run_tick() { : > "$CHECKED"; head_sweep_tick; }

# Tick 1: cursor starts at 0 -> checks id at index 0 (=10), cursor -> 1.
run_tick
assert_eq "10" "$(cat "$CHECKED")" "tick1 checks first id (cursor 0)"
assert_eq "1"  "$(cat "$CURSOR")"  "tick1 advances cursor to 1"

run_tick
assert_eq "20" "$(cat "$CHECKED")" "tick2 checks second id"
assert_eq "2"  "$(cat "$CURSOR")"  "tick2 cursor 2"

run_tick; run_tick   # ids 30,40 ; cursor -> 4
assert_eq "40" "$(cat "$CHECKED")" "tick4 checks id 40"
assert_eq "4"  "$(cat "$CURSOR")"  "tick4 cursor 4"

# Tick 5: checks last id (index4=50), cursor wraps back to 0.
run_tick
assert_eq "50" "$(cat "$CHECKED")" "tick5 checks last id 50"
assert_eq "0"  "$(cat "$CURSOR")"  "tick5 cursor wraps to 0"

# === Batch sizing: many live files -> batch = ceil(n/15), and each tick covers
# a contiguous window starting at the cursor. ===
LIVE_IDS=(); for n in $(seq 1 30); do LIVE_IDS+=("$n"); done
cache_live_set() { printf '%s\n' "${LIVE_IDS[@]}"; }
for id in "${LIVE_IDS[@]}"; do head -c 5000 /dev/zero > "$(cache_path "$id")"; cache_meta_write "$id" 5000 "" "http://s/$id"; done
echo 0 > "$CURSOR"
# ceil(30/15) = 2 per tick.
run_tick
assert_eq "2" "$(grep -c . "$CHECKED")" "30 live -> batch 2 checked"
assert_eq "2" "$(cat "$CURSOR")" "cursor advanced by batch (2)"

# === Burst clamp: batch must never exceed the clamp (12). ===
LIVE_IDS=(); for n in $(seq 1 1000); do LIVE_IDS+=("$n"); done
cache_live_set() { printf '%s\n' "${LIVE_IDS[@]}"; }
# Only need meta for the first window; create lazily inside stub-free path.
for id in $(seq 1 50); do head -c 5000 /dev/zero > "$(cache_path "$id")"; cache_meta_write "$id" 5000 "" "http://s/$id"; done
echo 0 > "$CURSOR"
# raw batch = ceil(1000/15)=67, clamped to 12.
run_tick
clamped=$(grep -c . "$CHECKED")
assert_true "[[ $clamped -le 12 ]]" "1000 live -> batch clamped to <=12 (got $clamped)"

teardown_tmp; finish
