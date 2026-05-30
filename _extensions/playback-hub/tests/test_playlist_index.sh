#!/usr/bin/env bash
# PURE unit test for playlist_index_of — no socket, no mpv.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e   # production script enables `set -euo pipefail`; restore lenient mode

m3u="$HOME/playlist.m3u"
cat > "$m3u" <<'EOF'
#EXTM3U
#EXTINF:-1,Track One
/cache/red/565437.mp3
#EXTINF:-1,Track Two
/cache/red/674397.mp3
#EXTINF:-1,Track Three
/cache/red/100200.mp3
EOF

assert_eq "0"  "$(playlist_index_of "$m3u" 565437)" "first entry index 0"
assert_eq "1"  "$(playlist_index_of "$m3u" 674397)" "second entry index 1"
assert_eq "2"  "$(playlist_index_of "$m3u" 100200)" "third entry index 2"
assert_eq "-1" "$(playlist_index_of "$m3u" 999999)" "absent id returns -1"
assert_eq "-1" "$(playlist_index_of "$HOME/nope.m3u" 565437)" "missing file returns -1"

teardown_tmp; finish
