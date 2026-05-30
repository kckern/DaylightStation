#!/usr/bin/env bash
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e   # production script enables `set -euo pipefail`; restore lenient mode for assertions

# macOS caveat: override GNU-stat primitive with portable size check (see report).
file_size_bytes() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }

# Portable inode reader: BSD `stat -f %i` (macOS) with GNU `stat -c %i` fallback.
inode_of() { stat -f %i "$1" 2>/dev/null || stat -c %i "$1" 2>/dev/null; }

# Ensure head_fetch is genuinely absent for this test (it arrives in a later
# unit). The migrate path must gate on `command -v head_fetch` and fall back
# to a size-only meta — proving that here.
unset -f head_fetch 2>/dev/null || true

# --- Arrange: two slots share plex_id 565437; slot 1 has a unique 111 ---
mkdir -p "$BASE_DIR/slots/1/cache" "$BASE_DIR/slots/2/cache"
head -c 5000 /dev/urandom > "$BASE_DIR/slots/1/cache/565437.mp3"
head -c 5000 /dev/urandom > "$BASE_DIR/slots/2/cache/565437.mp3"   # duplicate id, different bytes
head -c 5000 /dev/urandom > "$BASE_DIR/slots/1/cache/111.mp3"

src1_565437="$BASE_DIR/slots/1/cache/565437.mp3"
src1_111="$BASE_DIR/slots/1/cache/111.mp3"

# --- Act: first migration ---
mig_out_1=$(migrate_per_slot_caches 2>&1); mig_rc=$?
assert_eq "0" "$mig_rc" "first migrate returns 0"

# --- Case 1: both central files exist + dedup + meta present ---
assert_true "test -f \"$(cache_path 565437)\"" "central 565437 exists"
assert_true "test -f \"$(cache_path 111)\"" "central 111 exists"
assert_true "test -f \"$(meta_path 565437)\"" "565437 meta exists"
assert_true "test -f \"$(meta_path 111)\"" "111 meta exists"

# Dedup: central 565437 came from exactly ONE source (slot 1, the first glob hit).
# The glob iterates slots/*/cache, so slot 1 wins; assert content matches slot 1
# (not slot 2). Compare by byte content.
assert_true "cmp -s \"$(cache_path 565437)\" \"$src1_565437\"" "565437 from slot 1 (dedup, first wins)"
assert_false "cmp -s \"$(cache_path 565437)\" \"$BASE_DIR/slots/2/cache/565437.mp3\"" "565437 NOT from slot 2"
assert_eq "1" "$(echo "$mig_out_1" | grep -c 'cache.migrated')" "first run emits cache.migrated"

# --- Case 2: hard-link check — central 111 shares inode with its source ---
central_111_ino="$(inode_of "$(cache_path 111)")"
src_111_ino="$(inode_of "$src1_111")"
if [[ -n "$central_111_ino" && -n "$src_111_ino" ]]; then
    assert_eq "$src_111_ino" "$central_111_ino" "111 hard-links to slot-1 source (shared inode)"
else
    # Fallback when inode unreadable: at minimum content must match.
    assert_true "cmp -s \"$(cache_path 111)\" \"$src1_111\"" "111 content matches source (inode unavailable)"
fi

# Capture central 565437 inode for idempotency check below.
central_565437_ino_before="$(inode_of "$(cache_path 565437)")"

# --- Case 4: meta backfill with head_fetch ABSENT -> size-only (null content_length) ---
assert_eq "" "$(cache_meta_get 111 content_length)" "111 content_length null/empty (head_fetch absent)"
assert_eq "" "$(cache_meta_get 565437 content_length)" "565437 content_length null/empty (head_fetch absent)"
# Source URL should still be recorded.
assert_eq "${API_BASE}/api/v1/proxy/plex/stream/111" "$(cache_meta_get 111 source_url)" "111 source_url recorded"

# --- Case 3: idempotency — second run is a no-op, no error, no cache.migrated ---
mig_out_2=$(migrate_per_slot_caches 2>&1); mig_rc2=$?
assert_eq "0" "$mig_rc2" "second migrate returns 0 (no error)"
assert_true "test -f \"$(cache_path 565437)\"" "central 565437 still present after rerun"
assert_true "test -f \"$(cache_path 111)\"" "central 111 still present after rerun"
assert_eq "0" "$(echo "$mig_out_2" | grep -c 'cache.migrated')" "second run does NOT emit cache.migrated (moved=0)"
central_565437_ino_after="$(inode_of "$(cache_path 565437)")"
assert_eq "$central_565437_ino_before" "$central_565437_ino_after" "565437 inode unchanged across reruns (no re-link)"

# --- Empty case: migrate with zero per-slot caches must not error (nullglob) ---
EMPTY_HOME=$(mktemp -d)
( export BASE_DIR="$EMPTY_HOME/playback-hub"; export CACHE_DIR="$BASE_DIR/cache"
  migrate_per_slot_caches ); empty_rc=$?
assert_eq "0" "$empty_rc" "migrate with no per-slot caches returns 0 (nullglob)"
rm -rf "$EMPTY_HOME"

teardown_tmp; finish
