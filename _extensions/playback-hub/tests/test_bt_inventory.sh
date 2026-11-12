#!/usr/bin/env bash
# Shim: run the python bt inventory test under the bash test runner
exec python3 "$(dirname "$0")/test_bt_inventory.py"
