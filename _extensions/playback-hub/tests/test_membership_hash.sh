#!/usr/bin/env bash
# Unit E: queue_membership_hash is a stable, order-sensitive hash of the
# ordered contentIds. Same items -> same hash; reorder/add/remove -> different;
# empty/invalid JSON -> stable non-crashing value.
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e   # production script enables `set -euo pipefail`; restore lenient mode

q() { # ids... -> queue JSON with those contentIds in order
    local items="" id
    for id in "$@"; do
        items+="{\"contentId\":\"$id\",\"mediaUrl\":\"/m/$id\",\"title\":\"T$id\"},"
    done
    echo "{\"items\":[${items%,}]}"
}

a=$(queue_membership_hash "$(q plex:1 plex:2 plex:3)")
b=$(queue_membership_hash "$(q plex:1 plex:2 plex:3)")
assert_eq "$a" "$b" "same items in same order -> same hash"
assert_eq "12" "${#a}" "hash is 12 chars"

# Reordered -> different
c=$(queue_membership_hash "$(q plex:3 plex:2 plex:1)")
assert_false "[[ '$a' == '$c' ]]" "reordered items -> different hash"

# Added item -> different
d=$(queue_membership_hash "$(q plex:1 plex:2 plex:3 plex:4)")
assert_false "[[ '$a' == '$d' ]]" "added item -> different hash"

# Removed item -> different
e=$(queue_membership_hash "$(q plex:1 plex:2)")
assert_false "[[ '$a' == '$e' ]]" "removed item -> different hash"

# Empty items -> stable, non-crashing value (and equal across calls)
e1=$(queue_membership_hash '{"items":[]}')
e2=$(queue_membership_hash '{"items":[]}')
assert_eq "$e1" "$e2" "empty queue hashes stably"
assert_eq "12" "${#e1}" "empty queue hash is 12 chars"

# Invalid JSON -> stable, non-crashing value (jq error suppressed; empty stream)
i1=$(queue_membership_hash 'not json at all')
i2=$(queue_membership_hash 'not json at all')
assert_eq "$i1" "$i2" "invalid json hashes stably"
# Empty-stream and invalid-json both hash the empty input -> equal to each other.
assert_eq "$e1" "$i1" "empty and invalid both hash the empty contentId stream"

teardown_tmp; finish
