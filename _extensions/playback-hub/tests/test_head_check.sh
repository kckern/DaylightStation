#!/usr/bin/env bash
# Unit F Part 1: head_check compares server Content-Length against stored meta
# content_length and force-redownloads when it changed. No change / missing
# signal / no stored meta -> no download.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e   # production script enables `set -euo pipefail`; restore lenient mode

# Portable size check for macOS dev (stat -c is GNU-only).
file_size_bytes() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }

mkdir -p "$CACHE_DIR"
CALLS="$HOME/calls.log"

# Stub cache_download to record invocation instead of hitting the network.
cache_download() { echo "download $1 $2 $3" >> "$CALLS"; return 0; }
dl_count() { grep -c '^download' "$CALLS" 2>/dev/null; true; }

# Capture logev to a file so we can assert content_changed emission.
LOGF="$HOME/log.txt"
logev() { echo "evt=$2 ${*:3}" >> "$LOGF"; }
logged() { grep -c "$1" "$LOGF" 2>/dev/null; true; }

# head_fetch is redefined per-case below to control the simulated server reply.

ID=12345
URL="http://server/stream/$ID"

seed_meta() { # content_length -> writes meta with that stored clen
    cache_meta_write "$ID" "$1" "" "$URL"
}
# cache_meta_write reads the file size; create a dummy cache file so size>0.
echo "dummybytes" > "$(cache_path "$ID")"

reset() { : > "$CALLS"; : > "$LOGF"; }

# === Case (a): changed clen -> redownload + content_changed log ===
seed_meta 1000
head_fetch() { echo "2000 "; }   # server now reports 2000
reset
head_check "$ID" "$URL" "tag"
assert_eq "1" "$(dl_count)" "(a) cache_download invoked on changed clen"
assert_eq "1" "$(logged 'evt=cache.content_changed')" "(a) content_changed logged"
assert_false "[[ -f '$(cache_path "$ID")' ]]" "(a) stale cache file removed before redownload"

# === Case (b): unchanged clen -> no download, no log ===
echo "dummybytes" > "$(cache_path "$ID")"
seed_meta 1000
head_fetch() { echo "1000 "; }   # server matches stored
reset
head_check "$ID" "$URL" "tag"
assert_eq "0" "$(dl_count)" "(b) no download when clen unchanged"
assert_eq "0" "$(logged 'evt=cache.content_changed')" "(b) no content_changed log"
assert_true "[[ -f '$(cache_path "$ID")' ]]" "(b) cache file untouched"

# === Case (c): empty clen (no signal) -> skip, no download ===
seed_meta 1000
head_fetch() { echo " "; }       # no content-length header
reset
head_check "$ID" "$URL" "tag"
assert_eq "0" "$(dl_count)" "(c) no download when server gives no clen"
assert_eq "0" "$(logged 'evt=cache.content_changed')" "(c) no log on missing signal"

# === Case (d): no stored meta (oclen empty) -> cannot compare, no download ===
rm -f "$(meta_path "$ID")"
head_fetch() { echo "5000 "; }
reset
head_check "$ID" "$URL" "tag"
assert_eq "0" "$(dl_count)" "(d) no download when no stored meta to compare"

# === Case (e): stored meta is null content_length -> no download ===
cache_meta_write "$ID" "" "" "$URL"   # null content_length
head_fetch() { echo "5000 "; }
reset
head_check "$ID" "$URL" "tag"
assert_eq "0" "$(dl_count)" "(e) no download when stored clen is null"

teardown_tmp; finish
