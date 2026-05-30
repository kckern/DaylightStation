#!/usr/bin/env bash
set +e
source "$(dirname "$0")/helpers.sh"
HOME=$(setup_tmp); export HOME
source "$(dirname "$0")/../playback-hub.sh"   # must NOT launch daemon
set +e   # production script enables `set -euo pipefail`; restore lenient mode for assertions
assert_eq "$HOME/playback-hub/slots/3" "$(slot_dir 3)" "slot_dir builds path"
teardown_tmp; finish
