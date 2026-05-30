#!/usr/bin/env bash
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e   # production script enables `set -euo pipefail`; restore lenient mode for assertions

# macOS caveat: override GNU-stat primitive with portable size check (see report).
file_size_bytes() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }

# --- Case 1: good download, content_length matches -> succeeds, file valid, meta written ---
curl_fetch_to() { # url dest
    head -c 4096 /dev/zero > "$2"; _DL_CLEN=4096; _DL_LASTMOD="Wed, 28 May 2026 10:00:00 GMT"; return 0
}
assert_true  "cache_download 777 http://x/777 red" "good download succeeds"
assert_true  "validate_cached 777" "downloaded file validates"
assert_eq "4096" "$(cache_meta_get 777 content_length)" "meta content_length"
assert_true  "test ! -f \"$(cache_path 777).partial\"" "no leftover partial"

# --- Case 2: short body vs content_length -> fails, no cache file remains ---
curl_fetch_to() { # url dest
    head -c 100 /dev/zero > "$2"; _DL_CLEN=9999; _DL_LASTMOD=""; return 0
}
assert_false "cache_download 888 http://x/888 red" "short body rejected"
assert_true  "test ! -f \"$(cache_path 888)\"" "no cache file for rejected download"
assert_true  "test ! -f \"$(cache_path 888).partial\"" "no leftover partial for rejected"

# --- Case 3: transport failure -> fails, no cache file ---
curl_fetch_to() { _DL_CLEN=""; _DL_LASTMOD=""; return 1; }
assert_false "cache_download 999 http://x/999 red" "transport fail rejected"
assert_true  "test ! -f \"$(cache_path 999)\"" "no cache file on transport fail"

# --- Case 4: no content_length, body big enough -> succeeds via size floor ---
curl_fetch_to() { head -c 4096 /dev/zero > "$2"; _DL_CLEN=""; _DL_LASTMOD=""; return 0; }
assert_true  "cache_download 555 http://x/555 red" "no clen but big enough succeeds"
assert_true  "validate_cached 555" "size-floor file validates"

# --- Case 5: already-valid file -> short-circuits, no download attempt ---
mkdir -p "$CACHE_DIR"; head -c 4096 /dev/zero > "$(cache_path 666)"; cache_meta_write 666 4096 "" "url"
_called=0
curl_fetch_to() { _called=1; head -c 4096 /dev/zero > "$2"; _DL_CLEN=4096; return 0; }
assert_true  "cache_download 666 http://x/666 red" "valid file short-circuits success"
assert_eq "0" "$_called" "download not attempted when already valid"

teardown_tmp; finish
