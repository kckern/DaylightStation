#!/usr/bin/env bash
# Shim: run the python web.py status-field test under the bash test runner
# (run_tests.sh globs test_*.sh). Propagates pass/fail.
exec python3 "$(dirname "$0")/test_web_status.py"
