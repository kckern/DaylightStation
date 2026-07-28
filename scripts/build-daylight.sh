#!/bin/bash
# Build the kckern/daylight-station:latest image with build metadata baked
# into /build.txt (served at GET /build.txt): local build time + GitHub
# commit URL for the exact commit being built.
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD_TIME="$(date +"%Y-%m-%d %H:%M:%S %Z")"
COMMIT_HASH="$(git rev-parse HEAD)"

DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  DOCKER="sudo docker"
fi

exec $DOCKER build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$BUILD_TIME" \
  --build-arg COMMIT_HASH="$COMMIT_HASH" \
  .
