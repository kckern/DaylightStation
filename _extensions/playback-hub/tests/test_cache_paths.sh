#!/usr/bin/env bash
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e   # production script enables `set -euo pipefail`; restore lenient mode for assertions

assert_eq "$CACHE_DIR/565437.mp3"        "$(cache_path 565437)" "cache_path mp3"
assert_eq "$CACHE_DIR/565437.meta.json"  "$(meta_path 565437)"  "meta_path json"
assert_eq "$CACHE_DIR/565437.lock"       "$(cache_lock 565437)" "cache_lock"

teardown_tmp; finish
