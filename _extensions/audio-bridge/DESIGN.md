# Native Audio Bridge — Design

**Date:** 2026-02-22
**Status:** Implemented and verified
**Problem:** [Shield TV USB Audio WebView Audit](../../docs/_wip/audits/2026-02-22-shield-tv-usb-audio-webview-audit.md)

---

## Context

USB audio capture from an Angetube Live Camera connected to the NVIDIA Shield TV produces zero audio through WebView. The root cause is an Android audio routing policy issue: WebView requests `AUDIO_SOURCE_CAMCORDER` for combined camera+mic capture, and the Shield's `audio_policy_configuration_nv.xml` routes CAMCORDER to `AUDIO_DEVICE_IN_BUILTIN_MIC` — a device that does not physically exist on the Shield TV. The USB microphone is only reachable via `AUDIO_SOURCE_MIC`, which WebView never selects when the camera is active.

AudioFlinger dumps confirm the USB mic produces signal (~-63 dBFS) when accessed through `AUDIO_SOURCE_MIC`. This is not fixable from JavaScript or WebView configuration. A native Android app is required to bridge the gap.

---

## Architecture Overview

The solution has two parts:

1. **Android side** — A minimal APK (`AudioBridge`) installed on the Shield TV. Runs a foreground service that captures audio via the native `AudioRecord` API with `AUDIO_SOURCE_MIC` and streams raw PCM over a local WebSocket.

2. **Frontend side** — A new React hook that connects to the local WebSocket, receives PCM data, and synthesizes a standard `MediaStreamTrack` via the Web Audio API. This track is merged with the video-only `getUserMedia` stream to produce a complete `MediaStream` for WebRTC.

**Detection logic** — The existing `useAudioProbe` hook already cycles through capture strategies and sets `status: 'no-mic'` when all fail. When the probe fails on the Shield, `VideoCall.jsx` falls back to the native bridge. No separate probing is needed — if the WebSocket connects and PCM data arrives, the bridge is working.

---

## Android App

### Components

**AudioBridgeService** (foreground service) — The core component. Runs a lightweight WebSocket server using the `Java-WebSocket` library (~100KB). When a client connects, it opens an `AudioRecord` instance with `AUDIO_SOURCE_MIC` at 48kHz / 16-bit / mono and reads in a loop, sending binary PCM frames as WebSocket messages. When the client disconnects, it stops recording and releases the `AudioRecord` instance. A persistent notification ("Audio Bridge running") keeps the service alive.

**BootReceiver** (BroadcastReceiver) — Listens for `BOOT_COMPLETED` and starts the service automatically.

**MainActivity** — Bare minimum activity. Starts the service and finishes immediately. No UI beyond the initial launch.

### WebSocket Protocol

The protocol is intentionally minimal:

1. Client connects to `ws://localhost:8765`
2. Server sends a single JSON text message describing the audio format:
   ```json
   {"sampleRate": 48000, "channels": 1, "format": "pcm_s16le"}
   ```
3. Server sends continuous binary messages of raw PCM data (~960 bytes per message = 10ms at 48kHz / 16-bit / mono)
4. Close the connection to stop capture. No control messages, no heartbeat.

TCP keepalive handles dead connection detection. The format header on connect is the only protocol overhead beyond raw PCM.

### Permissions

- `RECORD_AUDIO` — microphone access
- `FOREGROUND_SERVICE` — keep the service alive
- `RECEIVE_BOOT_COMPLETED` — auto-start on boot
- `INTERNET` — required for localhost WebSocket

### Build Configuration

- Standard Android Studio project, single module
- `minSdk 30` (Shield TV 2019 runs SDK 30)
- Single external dependency: `org.java-websocket:Java-WebSocket`
- Target: sideload via `adb install`

---

## Device Configuration

The bridge is configured per-device in `devices.yml` under the `input` section:

```yaml
devices:
  livingroom-tv:
    type: shield-tv
    input:
      preferred_camera: "angetube|usb|c920"
      preferred_mic: "angetube|usb audio"
      audio_bridge:
        url: ws://localhost:8765
        mode: fallback   # 'fallback' | 'always'
```

**Modes:**

| Mode | Behavior |
|------|----------|
| `fallback` | Bridge activates only when `useAudioProbe` fails to find a working mic via WebView |
| `always` | Bridge activates immediately, bypassing the probe entirely |
| *(not configured)* | Bridge never activates — device uses standard `getUserMedia` audio |

Devices without `audio_bridge` in their config are completely unaffected. No WebSocket connection is attempted.

---

## Frontend Integration

### New Hook: `useNativeAudioBridge(config)`

**Location:** `frontend/src/modules/Input/hooks/useNativeAudioBridge.js`

**Parameters:**
```javascript
useNativeAudioBridge({
  enabled: boolean,  // Whether to activate the bridge
  url: string,       // WebSocket URL from device config
})
```

**Returns:** `{ stream: MediaStream|null, volume: number, status: string }`

**Internal flow:**

1. When `enabled` is `true` and `url` is provided, opens a WebSocket to the configured URL
2. Parses the format header from the first text message
3. Creates an `AudioContext` at the reported sample rate
4. Registers an `AudioWorkletNode` that receives PCM chunks via `MessagePort`
5. Connects the worklet to `createMediaStreamDestination()` and exposes the resulting `.stream`
6. Computes RMS volume in the same worklet and posts it back to the main thread
7. On close or error: sets `status='disconnected'`, cleans up all resources

**Status values:**

| Status | Meaning |
|--------|---------|
| `idle` | Hook is disabled (`enabled=false` or no URL) |
| `connecting` | WebSocket connection in progress |
| `connected` | Receiving PCM data, stream is active |
| `disconnected` | Connection lost, will retry |
| `unavailable` | WebSocket failed to connect (app not installed), stays dormant |

### Integration in VideoCall.jsx

VideoCall fetches device-specific config on mount, then derives bridge enablement from config + probe status:

```javascript
// Fetch device config
const [inputConfig, setInputConfig] = useState(null);
useEffect(() => {
  DaylightAPI('api/v1/device/config').then(config => {
    const devices = config?.devices || config || {};
    const dev = devices[deviceId];
    if (dev?.input) setInputConfig(dev.input);
  });
}, [deviceId]);

const audioBridgeConfig = inputConfig?.audio_bridge || null;

// Pass device preferences to media device selection
const { audioDevices, selectedVideoDevice, selectedAudioDevice } = useMediaDevices({
  preferredCameraPattern: inputConfig?.preferred_camera,
  preferredMicPattern: inputConfig?.preferred_mic,
});

// Probe first, then decide bridge enablement from config
const probe = useAudioProbe(audioDevices, { preferredDeviceId: selectedAudioDevice });

const bridgeEnabled = audioBridgeConfig
  ? audioBridgeConfig.mode === 'always'
    || (audioBridgeConfig.mode === 'fallback' && probe.status === 'no-mic')
  : false;

const bridge = useNativeAudioBridge({
  enabled: bridgeEnabled,
  url: audioBridgeConfig?.url,
});
```

### Stream Merging for WebRTC

The video-only `getUserMedia` stream is merged with the bridge's synthetic audio track to produce a complete `MediaStream` for `useWebRTCPeer`:

```javascript
const mergedStream = useMemo(() => {
  if (!stream) return null;
  if (!bridgeActive || !bridge.stream) return stream;
  const ms = new MediaStream(stream.getVideoTracks());
  bridge.stream.getAudioTracks().forEach(t => ms.addTrack(t));
  return ms;
}, [stream, bridgeActive, bridge.stream]);

const peer = useWebRTCPeer(mergedStream);
```

### Volume Meter

The volume meter uses `bridge.volume` when the bridge is active, falling back to `probe.volume` otherwise. Both expose the same 0-1 RMS range, so the meter component needs no changes beyond selecting the source.

### Fallback Behavior

On devices without `audio_bridge` config (desktop, phone, other TVs), the hook stays `idle` and never opens a WebSocket. Standard `getUserMedia` audio is used unchanged.

---

## Error Handling

### Android

| Scenario | Behavior |
|----------|----------|
| `AudioRecord` fails to initialize | Log error, send error JSON to client, close connection |
| Client disconnects | Stop recording, release `AudioRecord`, wait for next connection |
| Service killed by OS | `START_STICKY` ensures restart; foreground notification prevents kill |

### Frontend

| Scenario | Behavior |
|----------|----------|
| WebSocket fails to connect (app not installed) | `status='unavailable'`, stays dormant, no retry flood |
| Connection drops mid-stream | `status='disconnected'`, retry with exponential backoff (1s, 2s, 4s, max 10s) |
| PCM stops but connection stays open | No special handling; worklet outputs silence (zeros) |

### Logging

- **Android:** `Log.i("AudioBridge", ...)` for lifecycle events and errors
- **Frontend:** `getLogger().child({ component: 'useNativeAudioBridge' })` following the project's structured logging framework

---

## Build & Deployment

### Build Requirements

| Component | Version | Install | Verify |
|-----------|---------|---------|--------|
| Java | OpenJDK 17+ | `brew install openjdk@17` | `/opt/homebrew/opt/openjdk@17/bin/java --version` |
| Android SDK | Platform 33 | Via Android Studio or `sdkmanager` | `ls ~/Library/Android/sdk/platforms/android-33` |
| Gradle | 7.5.1 (via wrapper) | Included in project (`gradlew`) | Automatic on first build |
| AGP | 7.4.2 | Declared in `build.gradle` | Automatic |

**Note:** Java may be installed but not on `PATH`. The Gradle wrapper finds it via `JAVA_HOME`. Homebrew installs to `/opt/homebrew/opt/openjdk@17` but does not symlink it to the system Java path. Android SDK path is configured in `local.properties` (`sdk.dir`).

### Quick Build & Deploy

```bash
# From repo root — build, install, and restart in one shot:
cd _extensions/audio-bridge/app \
  && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew assembleDebug \
  && adb -s 10.0.0.11:5555 install -r app/build/outputs/apk/debug/app-debug.apk \
  && adb -s 10.0.0.11:5555 shell am force-stop net.kckern.audiobridge \
  && adb -s 10.0.0.11:5555 shell am start -n net.kckern.audiobridge/.MainActivity
```

### Build Step-by-Step

```bash
cd _extensions/audio-bridge/app

# Set JAVA_HOME (macOS Homebrew — java not on PATH is fine)
export JAVA_HOME=/opt/homebrew/opt/openjdk@17

# Build debug APK
./gradlew assembleDebug
```

Output: `app/build/outputs/apk/debug/app-debug.apk` (~214KB)

### Deploy to Shield TV

```bash
# Install APK (use -r to replace existing)
adb -s 10.0.0.11:5555 install -r app/build/outputs/apk/debug/app-debug.apk

# Grant mic permission (required once after first install)
adb -s 10.0.0.11:5555 shell pm grant net.kckern.audiobridge android.permission.RECORD_AUDIO

# Launch — MainActivity starts the foreground service and finishes
adb -s 10.0.0.11:5555 shell am start -n net.kckern.audiobridge/.MainActivity

# Verify service is running
adb -s 10.0.0.11:5555 shell dumpsys activity services net.kckern.audiobridge
```

**Note:** You cannot start the service directly via `am startservice` — Android requires foreground services to be started from a component with foreground privileges. Use `MainActivity` which starts the service and immediately finishes.

### ADB from Docker Container

The Docker container also has `adb` installed. Keys must be provisioned from the local machine (which has pre-authorized access to the Shield TV). The entrypoint copies keys from `data/system/adb-keys/` into the container on startup. To provision:

```bash
scp ~/.android/adbkey ~/.android/adbkey.pub homeserver.local:/tmp/
ssh homeserver.local '
  cp /tmp/adbkey /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/system/adb-keys/adbkey
  cp /tmp/adbkey.pub /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/system/adb-keys/adbkey.pub
  docker cp /tmp/adbkey daylight-station:/home/node/.android/adbkey
  docker cp /tmp/adbkey.pub daylight-station:/home/node/.android/adbkey.pub
  docker exec -u root daylight-station chown node:node /home/node/.android/adbkey /home/node/.android/adbkey.pub
  docker exec -u root daylight-station chmod 600 /home/node/.android/adbkey
'
```

---

## Verification Results (2026-02-22)

### Standalone WebSocket Test

Tested via `adb forward tcp:8765 tcp:8765` + Python WebSocket client:

```
Header: {"sampleRate":48000,"channels":1,"format":"pcm_s16le"}
Frames: 100, Samples: 48000
Non-zero samples: 39768/48000 (82.8%)
Max sample value: 84 (-51.8 dBFS)
RMS: 0.000537 (-65.4 dBFS)
```

AudioFlinger confirmed USB device routing:
```
Input device: 0x80001000 (AUDIO_DEVICE_IN_USB_DEVICE)
Audio source: 1 (AUDIO_SOURCE_MIC)
Signal power: -65 dBFS (consistent, non-zero)
```

### End-to-End WebRTC Call Test

Deployed frontend to production. Initiated call from phone → Shield TV. Logs confirm full pipeline:

1. `device-input-config` → `hasAudioBridge: true` (VideoCall.jsx fetched config)
2. `bridge-connecting` → `bridge-ws-open` → `bridge-format` → `bridge-connected` (hook connected)
3. `bridge-volume` → `maxLevel: 0.007–0.009` (real audio flowing through worklet)
4. AudioBridge logs: `AudioRecord started: source=MIC rate=48000` → 5,990 frames captured (60s session)
5. **Phone confirmed audible audio from Shield's USB microphone**

---

## Known Issues

### Android Recording Concurrency (Intermittent Silence)

Android's audio recording concurrency policy (API 29+) allows only one app to actively capture from a given audio source at a time. When multiple apps record from the same source, the system silences lower-priority apps based on:

**Priority order:** Foreground UI app > Foreground service > Background app

**Observed behavior:** When FKB's WebView calls `getUserMedia` (which opens `AUDIO_SOURCE_CAMCORDER`), AudioFlinger may re-evaluate active recording sessions. Our foreground service's `AUDIO_SOURCE_MIC` track gets silenced intermittently — `Sil` column shows `s` in AudioFlinger track dumps, and `bridge-volume` reports `maxLevel: 0`.

**Confirmed triggers:**
- FKB `SoundMeterService` (from `motionDetectionAcoustic`) — holds audio resources, causes `AudioRecord` init failure
- FKB `MotionDetectorService` (from `motionDetection`) — opens Camera 0, causes persistent PiP window
- FKB `acousticScreenOn` — holds `AUDIO_SOURCE_MIC` at 8kHz, causes silence via recording concurrency
- WebView `getUserMedia` for camera (CAMCORDER source) — intermittent conflict during session setup

**Required FKB settings (all three must be disabled):**

```bash
FULLY_PW="y%21NE93Uu32xV%407ozCJHt"
curl -s "http://10.0.0.11:2323/?cmd=setBooleanSetting&key=motionDetection&value=false&password=${FULLY_PW}"
curl -s "http://10.0.0.11:2323/?cmd=setBooleanSetting&key=motionDetectionAcoustic&value=false&password=${FULLY_PW}"
curl -s "http://10.0.0.11:2323/?cmd=setBooleanSetting&key=acousticScreenOn&value=false&password=${FULLY_PW}"
```

**Important:** The FKB REST API requires authentication. Unauthenticated requests return a login page but silently fail to change settings. Always include `&password=` in requests.

**Additional mitigations:**
1. Use `mode: always` instead of `fallback` to start bridge before WebView requests audio
2. Future: request video-only `getUserMedia` (no audio) when bridge is active, preventing WebView from opening any audio source

---

## File Summary

| File | Change | Purpose |
|------|--------|---------|
---

## Echo Cancellation (AEC)

**Added:** 2026-02-23
**Roadmap:** `docs/roadmap/2026-02-23-software-aec-audio-bridge.md`

### Problem

Video calls to the Shield TV produce echo: TV speakers play the remote caller's voice, the USB mic picks it up, and the bridge streams it back. The Shield has no hardware AEC for USB audio.

### Solution

Two-layer mitigation:

1. **Volume ducking** — TV volume reduced to 12% during calls, restored to 50% on disconnect. Eliminates ~90% of echo. Implemented in `VideoCall.jsx` via the existing `/api/v1/device/:id/volume/:level` endpoint.

2. **Software AEC** — Speex DSP echo cancellation compiled to WebAssembly, running inside the BridgeProcessor AudioWorklet. The remote caller's audio is tapped as a reference signal, and the adaptive filter subtracts the estimated echo from the mic signal.

### Signal Flow

```
Remote caller audio → WebRTC → peer.remoteStream
                                    │
                     ┌──────────────┤
                     │              ▼
                     │        <video> element (TV speakers)
                     ▼
              ScriptProcessor (tap)
                     │
                     ▼ { ref: Float32Array }
USB Mic → AudioBridge APK → WebSocket → BridgeProcessor (Worklet)
                                              │
                                        ┌─────┴─────┐
                                        │ Speex AEC  │
                                        │ (WASM)     │
                                        │            │
                                        │ mic ring ──┤
                                        │ ref ring ──┤
                                        │ out ring ──┤
                                        └─────┬─────┘
                                              ▼
                                        GainNode → Compressor → MediaStreamDest → WebRTC
```

### Configuration

In `devices.yml` under `input.audio_bridge`:

```yaml
audio_bridge:
  url: ws://localhost:8765
  mode: fallback
  gain: 1
  aec:
    enabled: true
    filter_length: 4800  # 100ms at 48kHz
    frame_size: 480      # 10ms frames
```

Set `aec.enabled: false` to disable AEC and rely on volume ducking only.

### Runtime Behavior

- AEC initializes asynchronously when the bridge connects (WASM load takes ~50ms)
- Until AEC is ready, or when no reference signal is available, audio passes through unchanged
- If processing exceeds 8ms per frame consistently (>10 overruns in 100 frames), AEC auto-disables and falls back to passthrough. Logged as `bridge-aec-status: degraded`
- Speex adaptive filter converges in 1-3 seconds — first seconds of a call may have some echo

### Files

| File | Status | Description |
|------|--------|-------------|
| `frontend/src/lib/audio/speex_aec.js` | New | Speex AEC compiled to WASM (base64-embedded, ~60KB) |
| `frontend/src/lib/audio/SpeexAEC.js` | New | JS wrapper class for the WASM module |
| `frontend/src/lib/audio/build-speex-aec.sh` | New | Emscripten build script (requires ~/emsdk) |

| `_extensions/audio-bridge/app/` | New | Android Studio project for the bridge APK |
| `data/household/config/devices.yml` | Modified | Added `audio_bridge` config under `livingroom-tv.input` |
| `frontend/src/modules/Input/hooks/useNativeAudioBridge.js` | New | Hook: config-driven WebSocket client, PCM-to-MediaStream conversion |
| `frontend/src/modules/Input/VideoCall.jsx` | Modified | Fetches device config, derives bridge enablement, merges streams |
| `frontend/src/modules/Input/hooks/useAudioProbe.js` | Unchanged | Provides `status: 'no-mic'` trigger for fallback mode |
| `frontend/src/modules/Input/hooks/useWebRTCPeer.js` | Unchanged | Consumes merged stream (source-agnostic) |
| `frontend/src/modules/Input/hooks/useMediaDevices.js` | Unchanged | Now receives device-specific camera/mic preferences from VideoCall |
