#!/usr/bin/env bash
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"
set +e   # production script enables `set -euo pipefail`; restore lenient mode for assertions
# Build a minimal runtime config so slot_for_tag can map color->slot
mkdir -p "$(dirname "$CONFIG_FILE")"
echo '{"devices":[{"slot":1,"color":"red"}]}' > "$CONFIG_FILE"
out=$(logev red foo.bar a=1 b=two 2>&1)   # human line now on stderr
assert_true  "grep -q 'evt=foo.bar' <<<\"$out\"" "human line has evt"
assert_true  "grep -q 'a=1' <<<\"$out\"" "human line has kv"
jl="$(slot_dir 1)/events.jsonl"
assert_true  "test -f \"$jl\"" "events.jsonl created for slot"
assert_eq "foo.bar" "$(jq -r '.evt' "$jl" | tail -1)" "jsonl evt field"
assert_eq "1" "$(jq -r '.slot' "$jl" | tail -1)" "jsonl slot field"
assert_eq "1" "$(jq -r '.a' "$jl" | tail -1)" "jsonl a field"
# Non-slot tag emits human line only, no crash
out2=$(logev sweep cache.sweep deleted=3 2>&1)   # human line now on stderr
assert_true "grep -q 'evt=cache.sweep' <<<\"$out2\"" "non-slot human line"
# Device-tag format: the daemon passes "slot=N mac=... name=..." as the logev tag.
# slot_for_tag must extract the slot so the event lands in slots/N/events.jsonl.
logev "slot=1 mac=AA:BB name=musiCozy" dev.evt x=9 >/dev/null 2>&1
assert_eq "dev.evt" "$(jq -r '.evt' "$(slot_dir 1)/events.jsonl" | tail -1)" "device-tag routes to slot ledger"
assert_eq "9" "$(jq -r '.x' "$(slot_dir 1)/events.jsonl" | tail -1)" "device-tag event fields written"
teardown_tmp; finish
