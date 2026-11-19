#!/bin/sh
# All transports use fixtures. Run with the Android build environment from README.md.
set -eu
cd "$(dirname "$0")/.."
./gradlew --offline \
  :capabilities:lockdown:payload:testDebugUnitTest --tests '*orderedLockdownWireFixturesMatchTheNativeRoute' \
  :capabilities:quick-input:payload:testDebugUnitTest --tests '*onlyStrictUnambiguousJsonReceiptsRemoveCaptures' \
  :capabilities:mic-bridge:payload:testDebugUnitTest --tests '*legacyClientGetsFormatThenPcmAndStopReleasesTheMicrophone'
cd ../..
node --test _extensions/daylight-android/tools/roadmap-capabilities.test.mjs
node_modules/.bin/vitest run --config tests/_infrastructure/config/vitest.config.mjs \
  __backend/src/1_adapters/devices/OrderedLockdownWire.test.mjs \
  __app_modules/learning/piano/browser/PianoKiosk/usePianoBridgeNotes.test.js \
  __app_modules/personal/weekly-review/browser/hooks/useAudioRecorder.test.js
