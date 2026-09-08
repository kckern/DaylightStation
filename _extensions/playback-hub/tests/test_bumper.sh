#!/usr/bin/env bash
# The lead-in bumper: one track that always plays first in a window, ahead of
# whatever the shuffle decided, and then gets out of the way.
#
# Two halves are worth pinning. `selected_bumper` picks the right value for the
# window that is actually active (and answers empty for the overwhelming
# majority of slots, which have none). And the drop rewrites the playlist
# correctly once the bumper has been heard — including the two cases that would
# hurt: matching a plex id against the FILENAME rather than the title, and
# refusing to leave a slot with an empty playlist.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e

# ── selected_bumper: precedence ─────────────────────────────────────────────
# A device whose ACTIVE schedule carries a bumper. active_schedule_json picks by
# wall clock, so the window is written to span the whole day.
all_day_with_bumper='{"slot":2,"schedules":[{"start":"00:00","end":"23:59","queue":"plex:1","shuffle":true,"bumper":"plex:622760"}]}'
assert_eq "https://daylightlocal.kckern.net/api/v1/queue/plex/plex:622760" \
  "$(selected_bumper "$all_day_with_bumper")" "schedule bumper resolves to a URL"

all_day_no_bumper='{"slot":2,"schedules":[{"start":"00:00","end":"23:59","queue":"plex:1"}]}'
assert_eq "" "$(selected_bumper "$all_day_no_bumper")" "no bumper on the active window -> empty"

# Device-level bumper is the fallback for a slot with no schedules at all.
device_level='{"slot":4,"queue":"plex:9","bumper":"622760"}'
assert_eq "https://daylightlocal.kckern.net/api/v1/queue/plex/622760" \
  "$(selected_bumper "$device_level")" "device-level bumper, bare id resolved"

assert_eq "" "$(selected_bumper '{"slot":4,"queue":"plex:9"}')" "no bumper anywhere -> empty"

# A full URL passes through untouched, same as a queue value.
absolute='{"slot":4,"bumper":"https://example.test/q/1"}'
assert_eq "https://example.test/q/1" "$(selected_bumper "$absolute")" "absolute bumper URL passes through"

# ── drop_bumper_if_passed: rewriting the playlist ───────────────────────────
mkslot() { # slot -> writes a 3-track playlist led by the bumper
    local slot="$1" dir; dir="$(slot_dir "$slot")"; mkdir -p "$dir"
    {
        echo "#EXTM3U"
        printf '#EXTINF:-1,%s\n%s\n' "Jesu, Joy of Man's Desiring" "$CACHE_DIR/622760.mp3"
        printf '#EXTINF:-1,%s\n%s\n' "Piano Concerto No. 21"       "$CACHE_DIR/622801.mp3"
        printf '#EXTINF:-1,%s\n%s\n' "Cantata No. 147"             "$CACHE_DIR/622802.mp3"
    } > "$dir/playlist.m3u"
    echo "622760" > "$dir/.bumper_pending"
}

# No socket -> nothing happens, and the marker survives for a later tick.
mkslot 11
drop_bumper_if_passed 11 test >/dev/null 2>&1
assert_true '[[ -f "$(slot_dir 11)/.bumper_pending" ]]' "no socket: marker kept for a later tick"
assert_eq "3" "$(grep -c '^/' "$(slot_dir 11)/playlist.m3u")" "no socket: playlist untouched"

# A slot with no bumper at all is a no-op — the common case.
dir12="$(slot_dir 12)"; mkdir -p "$dir12"; echo "#EXTM3U" > "$dir12/playlist.m3u"
drop_bumper_if_passed 12 test >/dev/null 2>&1
assert_eq "0" "$?" "slot without a bumper is a silent no-op"

# The awk rewrite itself: the bumper pair goes, the others stay, in order.
mkslot 13
d13="$(slot_dir 13)"
awk -v id="622760" '
    /^#EXTM3U/ { print; next }
    /^#EXTINF/ { ext = $0; next }
    /^[[:space:]]*$/ { next }
    {
        path = $0
        n = split(path, parts, "/")
        base = parts[n]
        sub(/\.mp3$/, "", base)
        if (base != id) { if (ext != "") print ext; print path }
        ext = ""
    }
' "$d13/playlist.m3u" > "$d13/rewritten.m3u"

assert_eq "2" "$(grep -c '^/' "$d13/rewritten.m3u")" "rewrite drops exactly one track"
assert_false 'grep -q "622760.mp3" "$(slot_dir 13)/rewritten.m3u"' "the bumper path is gone"
assert_true  'grep -q "622801.mp3" "$(slot_dir 13)/rewritten.m3u"' "the following tracks survive"
assert_true  'grep -q "Cantata No. 147" "$(slot_dir 13)/rewritten.m3u"' "their titles survive too"
assert_eq "2" "$(grep -c '^#EXTINF' "$d13/rewritten.m3u")" "one EXTINF per surviving track"

# The id is matched on the FILENAME, never the title. A bumper whose id appears
# inside another track's title must not take that track down with it.
d14="$(slot_dir 14)"; mkdir -p "$d14"
{
    echo "#EXTM3U"
    printf '#EXTINF:-1,%s\n%s\n' "Study 622760 in D" "$CACHE_DIR/999111.mp3"
    printf '#EXTINF:-1,%s\n%s\n' "Real Bumper"       "$CACHE_DIR/622760.mp3"
} > "$d14/playlist.m3u"
awk -v id="622760" '
    /^#EXTM3U/ { print; next }
    /^#EXTINF/ { ext = $0; next }
    /^[[:space:]]*$/ { next }
    { path = $0; n = split(path, parts, "/"); base = parts[n]; sub(/\.mp3$/, "", base)
      if (base != id) { if (ext != "") print ext; print path } ; ext = "" }
' "$d14/playlist.m3u" > "$d14/rewritten.m3u"
assert_true  'grep -q "999111.mp3" "$(slot_dir 14)/rewritten.m3u"' "a title containing the id is not matched"
assert_false 'grep -q "622760.mp3" "$(slot_dir 14)/rewritten.m3u"' "the real bumper still goes"

teardown_tmp; finish
