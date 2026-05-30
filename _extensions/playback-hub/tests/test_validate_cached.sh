#!/usr/bin/env bash
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e   # production script enables `set -euo pipefail`; restore lenient mode for assertions

# macOS caveat: override GNU-stat primitive with portable size check (see report).
file_size_bytes() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }

mkdir -p "$CACHE_DIR"

# Case 1: full file, size == content_length -> valid
head -c 4096 /dev/zero > "$(cache_path 111)"
cache_meta_write 111 4096 "" "url"
assert_true "validate_cached 111" "full file valid"

# Case 2: truncated, size < content_length -> invalid
head -c 1000 /dev/zero > "$(cache_path 222)"
cache_meta_write 222 4096 "" "url"   # writes size=1000 but content_length=4096
assert_false "validate_cached 222" "truncated invalid"

# Case 3: no content_length, size > MIN_AUDIO_BYTES -> valid
head -c 4096 /dev/zero > "$(cache_path 333)"
cache_meta_write 333 "" "" "url"     # content_length null
assert_true "validate_cached 333" "no content_length but big enough valid"

# Case 3b: no content_length, size < MIN_AUDIO_BYTES -> invalid
head -c 100 /dev/zero > "$(cache_path 334)"
cache_meta_write 334 "" "" "url"
assert_false "validate_cached 334" "no content_length too tiny invalid"

# Case 4: missing file -> invalid
assert_false "validate_cached 444" "missing file invalid"

teardown_tmp; finish
