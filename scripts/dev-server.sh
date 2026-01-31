#!/bin/bash
# scripts/dev-server.sh
# Reliable dev server with proper cleanup

set -e

PORT=${1:-3112}
LOCK_FILE="/tmp/daylight-locks/port-${PORT}.lock"

# Cleanup function
cleanup() {
    echo "Cleaning up..."
    rm -f "$LOCK_FILE"
    # Kill any child processes
    jobs -p | xargs -r kill 2>/dev/null || true
    exit 0
}

trap cleanup EXIT INT TERM

# Check if port is in use
if lsof -i :$PORT -t >/dev/null 2>&1; then
    echo "ERROR: Port $PORT already in use"
    echo "Run: node scripts/port-manager.mjs kill $PORT"
    exit 1
fi

# Acquire lock
mkdir -p /tmp/daylight-locks
echo "{\"pid\": $$, \"purpose\": \"dev-server\", \"timestamp\": \"$(date -Iseconds)\", \"port\": $PORT}" > "$LOCK_FILE"

echo "Starting dev server on port $PORT (PID $$)"
echo "Lock file: $LOCK_FILE"

# Start the server
PORT=$PORT npm run dev

# Cleanup happens via trap
