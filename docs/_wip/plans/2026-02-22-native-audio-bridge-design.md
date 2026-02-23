# Native Audio Bridge — Design

**Date:** 2026-02-22
**Status:** Approved
**Problem:** [Shield TV USB Audio WebView Audit](../audits/2026-02-22-shield-tv-usb-audio-webview-audit.md)

---

## Context

USB audio capture from an Angetube Live Camera connected to the NVIDIA Shield TV produces zero audio through WebView. The root cause is an Android audio routing policy issue: WebView requests `AUDIO_SOURCE_CAMCORDER` for combined camera+mic capture, and the Shield's `audio_policy_configuration_nv.xml` routes CAMCORDER to `AUDIO_DEVICE_IN_BUILTIN_MIC` — a device that does not physically exist on the Shield TV. The USB microphone is only reachable via `AUDIO_SOURCE_MIC`, which WebView never selects when the camera is active.

AudioFlinger dumps confirm the USB mic produces signal (~-63 dBFS) when accessed through `AUDIO_SOURCE_MIC`. This is not fixable from JavaScript or WebView configuration. A native Android app is required to bridge the gap.

---

## Architecture Overview

The solution has two parts:

1. **Android side** — A minimal APK (`AudioBridge`) installed on the Shield TV. Runs a foreground service that captures audio via the native `AudioRecord` API with `AUDIO_SOURCE_MIC` and streams raw PCM over a local WebSocket.

2. **Frontend side** — A new React hook that connects to the local WebSocket, receives PCM data, and synthesizes a standard `MediaStreamTrack` via the Web Audio API. This track is merged with the video-only `getUserMedia` stream to produce a complete `MediaStream` for WebRTC.

**Detection logic** — The existing `useAudioProbe` hook (`frontend/src/modules/Input/hooks/useAudioProbe.js`) already cycles through capture strategies and sets `status: 'no-mic'` when all fail. When the probe fails on the Shield, `VideoCall.jsx` falls back to the native bridge. No separate probing is needed for the bridge itself — if the WebSocket connects and PCM data arrives, the bridge is working.

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

## Frontend Integration

### New Hook: `useNativeAudioBridge(enabled)`

**Location:** `frontend/src/modules/Input/hooks/useNativeAudioBridge.js`

**Returns:** `{ stream, volume, status }`

**Internal flow:**

1. When `enabled` is `true`, opens a WebSocket to `ws://localhost:8765`
2. Parses the format header from the first text message
3. Creates an `AudioContext` at the reported sample rate
4. Registers an `AudioWorkletNode` that receives PCM chunks via `MessagePort`
5. Connects the worklet to `createMediaStreamDestination()` and exposes the resulting `.stream`
6. Computes RMS volume in the same worklet and posts it back to the main thread
7. On close or error: sets `status='disconnected'`, cleans up all resources

**Status values:**

| Status | Meaning |
|--------|---------|
| `idle` | Hook is disabled (`enabled=false`) |
| `connecting` | WebSocket connection in progress |
| `connected` | Receiving PCM data, stream is active |
| `disconnected` | Connection lost, will retry |
| `unavailable` | WebSocket failed to connect (app not installed), stays dormant |

### Integration in VideoCall.jsx

The bridge activates only when `useAudioProbe` exhausts all WebView-based strategies:

```javascript
const probe = useAudioProbe(audioDevices, {
  preferredDeviceId: selectedAudioDevice,
});
const bridge = useNativeAudioBridge(probe.status === 'no-mic');

const effectiveAudioDevice = probe.workingDeviceId || null;
const audioStream = bridge.status === 'connected' ? bridge.stream : null;
```

### Stream Merging for WebRTC

The video-only `getUserMedia` stream is merged with the bridge's synthetic audio track to produce a complete `MediaStream` for `useWebRTCPeer`:

```javascript
const mergedStream = useMemo(() => {
  if (!stream) return null;
  const ms = new MediaStream(stream.getVideoTracks());
  if (audioStream) {
    audioStream.getAudioTracks().forEach((t) => ms.addTrack(t));
  }
  return ms;
}, [stream, audioStream]);

const peer = useWebRTCPeer(mergedStream);
```

### Volume Meter

The volume meter uses `bridge.volume` when the bridge is active, falling back to `probe.volume` otherwise. Both expose the same 0-1 RMS range, so the meter component needs no changes beyond selecting the source.

### Fallback Behavior

On desktop or phone browsers where `getUserMedia` works normally, `useAudioProbe` finds a working device and `bridge` never activates. The bridge is a Shield-specific fallback only.

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

## Why This Will Work

The AudioFlinger dump from the audit proves that `AUDIO_SOURCE_MIC` routes to `AUDIO_DEVICE_IN_USB_DEVICE` on the Shield with non-zero signal power (~-63 dBFS). The native `AudioRecord` API with the MIC source bypasses the CAMCORDER-to-BUILTIN_MIC routing that breaks WebView. The WebSocket transport adds negligible latency on localhost — PCM frames travel over the loopback interface with no network serialization overhead.

---

## File Summary

| File | Purpose |
|------|---------|
| `android/AudioBridge/` (new project) | Android Studio project for the bridge APK |
| `frontend/src/modules/Input/hooks/useNativeAudioBridge.js` | Hook: WebSocket client, PCM-to-MediaStream conversion |
| `frontend/src/modules/Input/VideoCall.jsx` | Integration: probe fallback to bridge, stream merging |
| `frontend/src/modules/Input/hooks/useAudioProbe.js` | Existing: no changes, provides `status: 'no-mic'` trigger |
| `frontend/src/modules/Input/hooks/useWebRTCPeer.js` | Existing: no changes, consumes merged stream |
