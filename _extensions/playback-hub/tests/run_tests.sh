#!/usr/bin/env bash
cd "$(dirname "$0")"
fail=0
for t in test_*.sh; do
  echo "== $t =="
  bash "$t" || fail=1
done
exit $fail
