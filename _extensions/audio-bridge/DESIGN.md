# Native Audio Bridge — Design

**Date:** 2026-02-22
**Status:** Approved
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

## Why This Will Work

The AudioFlinger dump from the audit proves that `AUDIO_SOURCE_MIC` routes to `AUDIO_DEVICE_IN_USB_DEVICE` on the Shield with non-zero signal power (~-63 dBFS). The native `AudioRecord` API with the MIC source bypasses the CAMCORDER-to-BUILTIN_MIC routing that breaks WebView. The WebSocket transport adds negligible latency on localhost — PCM frames travel over the loopback interface with no network serialization overhead.

---

## File Summary

| File | Change | Purpose |
|------|--------|---------|
| `_extensions/audio-bridge/app/` | New | Android Studio project for the bridge APK |
| `data/household/config/devices.yml` | Modified | Added `audio_bridge` config under `livingroom-tv.input` |
| `frontend/src/modules/Input/hooks/useNativeAudioBridge.js` | New | Hook: config-driven WebSocket client, PCM-to-MediaStream conversion |
| `frontend/src/modules/Input/VideoCall.jsx` | Modified | Fetches device config, derives bridge enablement, merges streams |
| `frontend/src/modules/Input/hooks/useAudioProbe.js` | Unchanged | Provides `status: 'no-mic'` trigger for fallback mode |
| `frontend/src/modules/Input/hooks/useWebRTCPeer.js` | Unchanged | Consumes merged stream (source-agnostic) |
| `frontend/src/modules/Input/hooks/useMediaDevices.js` | Unchanged | Now receives device-specific camera/mic preferences from VideoCall |
