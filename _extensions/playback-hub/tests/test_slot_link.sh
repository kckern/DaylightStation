#!/usr/bin/env bash
# Shim: run the python slot_link test under the bash test runner
exec python3 "$(dirname "$0")/test_slot_link.py"
