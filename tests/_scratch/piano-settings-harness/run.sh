#!/usr/bin/env bash
# Restart the harness Vite server (frontend only, no backend) and shoot every scene.
# Run from the repo root: bash tests/_scratch/piano-settings-harness/run.sh
# Instrument art comes from $DAYLIGHT_BASE_PATH/media/img when set.
set -u
PORT="${HARNESS_PORT:-5198}"
pkill -f "piano-settings-harness/vite.harness.config.mjs" 2>/dev/null
sleep 1
nohup node_modules/.bin/vite --config tests/_scratch/piano-settings-harness/vite.harness.config.mjs > tests/_scratch/out/piano-settings-vite.log 2>&1 &
for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:${PORT}/" && break; sleep 0.5; done
BASE_URL="http://127.0.0.1:${PORT}" node tests/_scratch/shoot-piano-settings.mjs
status=$?
[ "${KEEP_SERVER:-0}" = 1 ] || pkill -f "piano-settings-harness/vite.harness.config.mjs"
exit $status
