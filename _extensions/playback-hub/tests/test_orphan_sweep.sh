#!/usr/bin/env bash
# Unit F Part 3: ref-counted orphan sweep.
#   - cache_live_set: plex_ids referenced by any slot's playlist.m3u
#   - cache_orphan_sweep: deletes orphans older than ORPHAN_TTL_DAYS, keeps live
#     and recent orphans; then enforces CACHE_MAX_BYTES via oldest-atime LRU
#     eviction of non-live files only.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e

# Portable size check for macOS dev (stat -c is GNU-only).
file_size_bytes() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }

# Capture logev (avoid slot_for_tag side effects / noise).
LOGF="$HOME/log.txt"
logev() { echo "evt=$2 ${*:3}" >> "$LOGF"; }
logged() { grep -c "$1" "$LOGF" 2>/dev/null; true; }

mkdir -p "$CACHE_DIR"

# --- helpers ---
mk_cache() { # id bytes -> create cache file of given size + meta
    local id="$1" n="$2"
    head -c "$n" /dev/zero > "$(cache_path "$id")"
    cache_meta_write "$id" "$n" "" "http://server/$id"
}
mk_playlist() { # slot id... -> a slot playlist.m3u referencing those ids
    local slot="$1"; shift
    local d="$BASE_DIR/slots/$slot"; mkdir -p "$d"
    : > "$d/playlist.m3u"
    local id
    for id in "$@"; do echo "$CACHE_DIR/$id.mp3" >> "$d/playlist.m3u"; done
}
old_atime() { # file -> set atime ~10 days ago (portable: BSD/macOS touch -a -t)
    local ts; ts=$(date -v-10d '+%Y%m%d%H%M' 2>/dev/null || date -d '10 days ago' '+%Y%m%d%H%M')
    touch -a -t "$ts" "$1"
}

# ============================================================
# Part A: cache_live_set
# ============================================================
mk_cache 100 5000
mk_cache 200 5000
mk_cache 300 5000
mk_playlist 0 100 200
mk_playlist 1 200
live="$(cache_live_set)"
assert_true "grep -qx 100 <<<\"\$live\"" "live set includes id 100 (slot0)"
assert_true "grep -qx 200 <<<\"\$live\"" "live set includes id 200 (slots 0+1, deduped)"
assert_false "grep -qx 300 <<<\"\$live\"" "live set excludes orphan 300"
assert_eq "2" "$(grep -c . <<<"$live")" "live set deduped to 2 ids"

# ============================================================
# Part B: cache_orphan_sweep TTL behavior
# ============================================================
rm -f "$CACHE_DIR"/*.mp3 "$CACHE_DIR"/*.meta.json
rm -rf "$BASE_DIR/slots"
mk_cache 100 5000     # live
mk_cache 200 5000     # orphan, OLD
mk_cache 300 5000     # orphan, RECENT
mk_playlist 0 100
old_atime "$(cache_path 200)"

CACHE_MAX_BYTES=$((2*1024*1024*1024))   # well above total, so no size eviction
cache_orphan_sweep

assert_true  "[[ -f '$(cache_path 100)' ]]" "(ttl) live file kept"
assert_false "[[ -f '$(cache_path 200)' ]]" "(ttl) old orphan deleted"
assert_false "[[ -f '$(meta_path 200)' ]]"  "(ttl) old orphan meta deleted"
assert_true  "[[ -f '$(cache_path 300)' ]]" "(ttl) recent orphan kept"
assert_true  "[[ $(logged 'evt=cache.sweep') -ge 1 ]]" "(ttl) cache.sweep emitted"

# ============================================================
# Part C: cache_enforce_size_cap LRU eviction (non-live only)
# ============================================================
rm -f "$CACHE_DIR"/*.mp3 "$CACHE_DIR"/*.meta.json
rm -rf "$BASE_DIR/slots"
: > "$LOGF"
# Use files large enough that du -sk block-rounding (4KB) is negligible vs the
# cap, so eviction arithmetic is deterministic. Each ~1 MB.
MB=$((1024*1024))
mk_cache 100 "$MB"    # LIVE — must never be evicted
mk_cache 200 "$MB"    # orphan, OLDEST atime  -> evicted first
mk_cache 300 "$MB"    # orphan, newer atime
mk_playlist 0 100
# Make 200 the OLDEST atime but keep it RECENT (within TTL) so the TTL pass does
# NOT delete it — we want to prove the SIZE-CAP path evicts it, oldest-first.
recent_old_atime() { # file -> atime ~2 days ago (older than 300's "now", < TTL)
    local ts; ts=$(date -v-2d '+%Y%m%d%H%M' 2>/dev/null || date -d '2 days ago' '+%Y%m%d%H%M')
    touch -a -t "$ts" "$1"
}
recent_old_atime "$(cache_path 200)"

# Total ~3 MB. Cap to 2.5 MB forces eviction of the single oldest non-live file
# (200) -> ~2 MB < cap. Live 100 and newer orphan 300 both survive.
CACHE_MAX_BYTES=$(( 5 * MB / 2 ))   # 2.5 MB
cache_orphan_sweep

assert_true  "[[ -f '$(cache_path 100)' ]]" "(cap) live file never evicted"
assert_false "[[ -f '$(cache_path 200)' ]]" "(cap) oldest-atime orphan evicted"
assert_false "[[ -f '$(meta_path 200)' ]]"  "(cap) evicted orphan meta removed"
assert_true  "[[ -f '$(cache_path 300)' ]]" "(cap) newer orphan kept (cap satisfied)"
assert_true  "[[ $(logged 'evt=cache.evict') -ge 1 ]]" "(cap) cache.evict emitted"
# Final usage under cap.
total=$(cache_size_total)
assert_true "[[ $total -le $CACHE_MAX_BYTES ]]" "(cap) total under cap after sweep"

teardown_tmp; finish
