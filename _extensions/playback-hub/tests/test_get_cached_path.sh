#!/usr/bin/env bash
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e   # production script enables `set -euo pipefail`; restore lenient mode for assertions

# macOS caveat: override GNU-stat primitive with portable size check (see report).
file_size_bytes() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }

mkdir -p "$CACHE_DIR"

# --- Case 1: valid existing file -> returns path, cache_download NOT called ---
head -c 4096 /dev/zero > "$(cache_path 100)"; cache_meta_write 100 4096 "" "url"
_dl_called=0
cache_download() { _dl_called=1; return 0; }
out=$(get_cached_path 100 http://x/100 red); rc=$?
assert_eq "0" "$rc" "valid file returns 0"
assert_eq "$(cache_path 100)" "$out" "valid file prints path"
assert_eq "0" "$_dl_called" "cache_download not called for valid file"

# --- Case 2: missing file + cache_download creates valid file -> returns path ---
cache_download() {  # mimic real: create valid file+meta
    head -c 4096 /dev/zero > "$(cache_path "$1")"; cache_meta_write "$1" 4096 "" "$2"; return 0
}
out=$(get_cached_path 200 http://x/200 red); rc=$?
assert_eq "0" "$rc" "repaired file returns 0"
assert_eq "$(cache_path 200)" "$out" "repaired file prints path"

# --- Case 3: missing file + cache_download fails -> returns 1, prints nothing ---
cache_download() { return 1; }
out=$(get_cached_path 300 http://x/300 red); rc=$?
assert_eq "1" "$rc" "failed download returns 1"
assert_eq "" "$out" "failed download prints nothing"

teardown_tmp; finish
