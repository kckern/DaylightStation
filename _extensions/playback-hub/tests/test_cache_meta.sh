#!/usr/bin/env bash
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e   # production script enables `set -euo pipefail`; restore lenient mode for assertions

# macOS caveat: production file_size_bytes() uses GNU `stat -c%s`, which fails on
# macOS and returns 0. Override the platform primitive here with a portable
# size check so the test exercises real cache_manager logic on this dev box.
# Production (Ubuntu) keeps the real GNU stat path untouched.
file_size_bytes() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }

mkdir -p "$CACHE_DIR"
# cache_meta_write reads the mp3 size; create a dummy file so size is sane.
head -c 8423901 /dev/zero > "$(cache_path 565437)"

cache_meta_write 565437 8423901 "Wed, 28 May 2026 10:00:00 GMT" "https://example/565437"

assert_true  "test -f \"$(meta_path 565437)\"" "meta file created"
assert_eq "8423901" "$(cache_meta_get 565437 content_length)" "content_length"
assert_eq "Wed, 28 May 2026 10:00:00 GMT" "$(cache_meta_get 565437 last_modified)" "last_modified"
assert_eq "https://example/565437" "$(cache_meta_get 565437 source_url)" "source_url"
assert_eq "8423901" "$(cache_meta_get 565437 size)" "size from file"

# missing meta returns empty, exit 0
out=$(cache_meta_get 999 content_length); rc=$?
assert_eq "0" "$rc" "missing meta returns 0"
assert_eq "" "$out" "missing meta empty"

teardown_tmp; finish
