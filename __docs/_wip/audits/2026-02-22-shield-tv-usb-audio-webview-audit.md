# Shield TV USB Audio — WebView getUserMedia Audit

**Date:** 2026-02-22
**Status:** Resolved — Native AudioBridge app bypasses routing issue; end-to-end audio confirmed
**Device:** NVIDIA Shield TV 2019, Android TV 11 (SDK 30), Fully Kiosk Browser 1.60.1-play

---

## Problem

USB audio capture from an Angetube Live Camera (`093a:2510`) connected to the NVIDIA Shield TV produces **zero audio data** through every Web Audio / WebRTC / MediaRecorder API available in Android System WebView. Video capture from the same USB device works correctly.

The camera's microphone works in native Android apps (user reports Zoom). AudioFlinger signal power confirms the USB mic produces ~-63 dBFS at the HAL level when accessed via `AUDIO_SOURCE_MIC`, but WebView uses `AUDIO_SOURCE_CAMCORDER` which routes to a non-existent built-in mic.

---

## Environment

| Component | Value |
|-----------|-------|
| Device | NVIDIA SHIELD Android TV (2019) |
| Android | 11 (TV), SDK 30, Build RQ1A.210105.003 |
| WebView (tested) | v144.0.7559.132 (updated 2026-02-06), v120.0.6099.230 (factory) |
| Kiosk browser | Fully Kiosk Browser 1.60.1-play (licensed) |
| USB device | Angetube Live Camera, USB-Audio (`093a:2510`) |
| ALSA card | card=2, device=0 (`pcmC2D0c`) |
| Network | HTTPS via `daylightlocal.kckern.net` |

---

## Diagnostic Methodology

A full diagnostic component (`Webcam.jsx`) was built to run **7 capture strategies simultaneously** on each audio device, with structured logging to the backend via WebSocket.

### Strategies Tested

| # | Strategy | Method | What it tests |
|---|----------|--------|---------------|
| 1 | AnalyserNode | `createMediaStreamSource` → `AnalyserNode` → `getByteTimeDomainData` → RMS | Standard Web Audio frequency-domain readback |
| 2 | ScriptProcessorNode | `createMediaStreamSource` → `ScriptProcessorNode` → `onaudioprocess` → raw PCM | Deprecated but universal time-domain callback |
| 3 | AudioWorklet | `createMediaStreamSource` → `AudioWorkletNode` (Blob URL processor) → `MessagePort` | Modern off-main-thread audio processing |
| 4 | RTCPeerConnection | `addTrack` → SDP loopback → poll `media-source` stats → `audioLevel` | WebRTC native pipeline, bypasses Web Audio entirely |
| 5 | MediaRecorder | `MediaRecorder` → record 500ms → `decodeAudioData` → check samples | Platform native encoder pipeline |
| 6 | Raw audio | Separate `getUserMedia` with `echoCancellation: false, noiseSuppression: false, autoGainControl: false` | Bypasses all audio processing |
| 7 | CAMCORDER source | Combined `{ video: true, audio: { deviceId } }` getUserMedia | Tests Android's CAMCORDER audio source path (vs MIC) |

### Devices Tested

| # | Label | DeviceId | Description |
|---|-------|----------|-------------|
| 1 | USB audio | Distinct ID | Angetube USB camera microphone (raw USB audio interface) |
| 2 | Speakerphone | Same ID as video camera | Android's grouped camera+mic alias |
| 3 | *(empty)* | `default` | Android system default audio input |

---

## Results

### WebView v144.0.7559.132

**7 strategies × 3 devices = 21 tests. ALL returned zero audio.**

| Strategy | USB audio | Speakerphone | default | Total samples |
|----------|-----------|-------------|---------|---------------|
| analyserNode | maxRms=0, nonSilent=0 | 0 | 0 | 3,600+ |
| scriptProcessor | maxRms=0, nonSilent=0 | 0 | 0 | 1,250+ |
| audioWorklet | maxRms=0, nonSilent=0 | 0 | 0 | 23,250+ |
| rtcLoopback | maxRms=0, nonSilent=0 | 0 | 0 | 11,950+ |
| mediaRecorder | maxRms=0, nonSilent=0 | 0 | 0 | 22+ (blobSize=408 each) |
| rawAudio | maxRms=0, nonSilent=0 | 0 | 0 | Started, no nonSilent |
| camcorderAudio | maxRms=0, nonSilent=0 | 0 | 0 | Started, no nonSilent |

### WebView v120.0.6099.230 (factory, downgraded via `pm uninstall-system-updates`)

**Same result: all zero across all strategies and devices.**

Notable difference: v120 defaulted to `sampleRate: 16000` for USB audio (v144 used 48000). Camera labeled as "camera2 0, facing back" instead of "camera 0, facing external". Neither difference affected the outcome.

---

## Track Metadata (looks valid)

Every `getUserMedia` call returns a track that **appears healthy**:

```
enabled: true
muted: false
readyState: "live"
sampleRate: 48000 (v144) / 16000 (v120)
channelCount: 1
sampleSize: 16
```

Capabilities report correctly:
```
autoGainControl: [true, false]
echoCancellation: [true, false]
noiseSuppression: [true, false]
sampleRate: { min: 16000, max: 48000 } (v120) / { min: 48000, max: 48000 } (v144)
```

AudioContext states are all `"running"` (not suspended). Explicit `ctx.resume()` calls were added — no effect.

---

## Native Android Audio Analysis

### ADB Diagnostics

Connected via `adb connect 10.0.0.11:5555`.

**USB device recognized at OS level:**
```
[DeviceInfo: type:0x80001000 (usb_device)
  name:USB-Audio - Angetube Live Camera
  addr:card=2;device=0; codec: 0]
```

**Mic not muted:**
```
mic mute FromSwitch=false FromRestrictions=false FromApi=false from system=false
```

**FKB permissions (all granted):**
```
RECORD_AUDIO: granted=true
CAMERA: granted=true
appops RECORD_AUDIO: allow
appops CAMERA: allow
```

### `dumpsys audio` — Recording Sessions

```
RecordActivityMonitor dump time: 8:40:05 PM
  session:969  -- source client=CAMCORDER -- uid:10114 -- pack:de.ozerov.fully -- silenced:false
  session:993  -- source client=CAMCORDER -- uid:10114 -- pack:de.ozerov.fully -- silenced:false
  session:1025 -- source client=MIC      -- uid:10114 -- pack:de.ozerov.fully -- silenced:false
```

Three active recording sessions from FKB (uid:10114):
- Sessions 969 & 993: `CAMCORDER` source (WebView getUserMedia — camera+mic both active)
- Session 1025: `MIC` source (FKB native acoustic motion detection)

**Important caveat:** `silenced:false` is a **policy flag** — it means the system is not actively silencing the stream (no privacy mute, no concurrent higher-priority capture). It does **not** prove non-zero PCM data is flowing through the pipeline.

### ALSA Device Map

```
/dev/snd/:
  pcmC0D3p   (playback only — HDMI output)
  pcmC1D0-D9 (capture + playback — internal audio)
  pcmC2D0c   (capture — USB audio = Angetube mic)
  controlC0, controlC1, controlC2
```

**Direct ALSA capture (`tinycap`) failed with "Permission denied"** — no root access on Shield.

### AudioFlinger Input Threads — THE SMOKING GUN

`dumpsys media.audio_flinger` reveals two active input threads with **different device routing**:

**Thread 1: AudioIn_B6 (WebView CAMCORDER sessions)**
```
Input thread AudioIn_B6, type RECORD:
  Input device: 0x80000004 (AUDIO_DEVICE_IN_BUILTIN_MIC)  ← WRONG!
  Audio source: 5 (AUDIO_SOURCE_CAMCORDER)
  Sample rate: 48000 Hz, HAL format: PCM_16_BIT
  AudioStreamIn flags: 0x1 (AUDIO_INPUT_FLAG_FAST)
  Frames read: 39,518,463
  Signal power history: (none)                             ← NO DATA
  FastCapture: silenced: false
  2 Tracks active (sessions 969 & 993)
```

**Thread 2: AudioIn_BE (FKB acoustic detection, MIC source)**
```
Input thread AudioIn_BE, type RECORD:
  Input device: 0x80001000 (AUDIO_DEVICE_IN_USB_DEVICE)    ← CORRECT!
  Audio source: 1 (AUDIO_SOURCE_MIC)
  Sample rate: 48000 Hz, HAL format: PCM_16_BIT
  AudioStreamIn flags: 0 (AUDIO_INPUT_FLAG_NONE)
  Frames read: 20,712,687
  Signal power history:                                     ← HAS DATA
    20:41:05.398: -63.0  -63.2  -61.4  -63.3  -62.0  -63.9  -63.9  -63.3  -62.3  -63.7
    20:41:05.898: -63.6  -64.2  -62.9  -63.5  -64.7  -62.5  -63.5  -63.5  -63.8  -63.2
    20:41:06.398: -63.3  -62.0  -63.1  -62.7  -62.9  -63.2  -62.8  -60.6  -63.0  -63.2
    20:41:06.898: -63.2  -63.3  -63.3  -63.5  -64.1  -63.4  -63.8  -63.8  -64.9  -63.1
    20:41:07.398: -63.8  -63.8  -63.2  -62.1  -61.3  -62.1  -62.4  -61.2  -63.1  -63.4
  1 Track active (session 1025)
  HAL stream: card:2, device:0 - IN, rate: 48000, channels: 1
```

**Key findings:**
1. WebView's CAMCORDER sessions → routed to **BUILTIN_MIC** (phantom — Shield has no built-in mic) → **Signal power: (none)** = zero audio
2. FKB's native MIC session → routed to **USB_DEVICE** (correct!) → **Signal power: ~-63 dBFS** = non-zero (mic noise floor, proving hardware works)
3. The USB mic produces data at the HAL level — the hardware connection is functional

### Audio Policy Routing Rules

From `dumpsys media.audio_policy` (config: `/vendor/etc/audio_policy_configuration_nv.xml`):

```
Route 4:
  Sink: primary_input
  Sources: Built-In Mic, Digital Dock HS Mic    ← NO USB!

primary_input:
  Supported devices: BUILTIN_MIC, DGTL_DOCK_HEADSET
  flags: AUDIO_INPUT_FLAG_NONE
  maxOpenCount: 1, curOpenCount: 1

fast_input:
  flags: AUDIO_INPUT_FLAG_FAST
  maxOpenCount: 1, curOpenCount: 0
```

The `primary_input` route **does not include USB audio** in its source list. NVIDIA's audio policy configuration (`audio_policy_configuration_nv.xml`) only maps `Built-In Mic` and `Digital Dock HS Mic` to the primary input.

The USB audio device is handled by a separate USB HAL module and IS available as an input device — but **only when explicitly requested via `AUDIO_SOURCE_MIC`**, not via `AUDIO_SOURCE_CAMCORDER`.

### FKB Acoustic Motion Detection Test

FKB's native acoustic motion detection feature uses Android `AudioRecord` API (not WebView). Enabled with sensitivity=5 (very sensitive) and confirmed active via `dumpsys audio` (session 1025, MIC source).

Despite this session being correctly routed to the USB device with non-zero signal power (~-63 dBFS), no acoustic events triggered when TTS ("HELLO HELLO HELLO CAN YOU HEAR ME") was played through the Shield's HDMI speakers. The -63 dBFS reading with <4 dB variation is consistent with microphone self-noise (not speech). This suggests either:
- The USB mic gain is too low or the mic element is obstructed/damaged
- The Shield's HDMI audio output speakers were too far from the USB camera mic
- The -63 dBFS noise floor is the limit of what this device produces through the Shield's USB audio path

---

## FKB Configuration (via REST API port 2323)

All media-related settings are correctly configured:

| Setting | Value |
|---------|-------|
| webcamAccess | true |
| microphoneAccess | true |
| videoCapturePermission | true |
| disableCamera | false |
| autoplayAudio | true |
| knoxDisableAudioRecord | false |
| knoxDisableCamera | false |
| knoxDisableMicrophoneState | false |
| webviewDebugging | true (enabled during this audit) |
| deniedPermissions | WRITE_SETTINGS, ADMIN (unrelated) |

---

## Bug Found During Audit: Dual Audio Capture

`useWebcamStream.js` had a bug where passing `null` for the audio parameter resulted in `audio: true` (requesting default audio) due to the ternary:

```javascript
// BEFORE (buggy): null is falsy → falls through to true
audio: selectedAudioDevice
  ? { deviceId: { exact: selectedAudioDevice } }
  : true,

// AFTER (fixed): null = no audio, undefined = default audio
audio: selectedAudioDevice != null
  ? { deviceId: { exact: selectedAudioDevice } }
  : selectedAudioDevice === null ? false : true,
```

This caused the diagnostic's video-only stream to secretly request audio, creating **two simultaneous audio captures** — visible as the two `CAMCORDER` sessions in `dumpsys audio`. On Android, dual-capture of the same device can cause the second stream to receive silence. However, fixing this did not resolve the zero-audio issue (all strategies still returned zero with the fix deployed).

---

## Root Cause

**Android's audio routing policy on the NVIDIA Shield TV routes WebView's `AUDIO_SOURCE_CAMCORDER` requests to `AUDIO_DEVICE_IN_BUILTIN_MIC` — a device that does not physically exist on the Shield TV. The USB microphone is only reachable via `AUDIO_SOURCE_MIC`, which WebView does not use when camera+mic permissions are both active.**

### The Routing Mismatch

```
WebView getUserMedia({ audio: true, video: true })
  → Android: AUDIO_SOURCE_CAMCORDER (because camera is active)
    → AudioPolicyManager: route CAMCORDER → primary_input
      → primary_input sources: Built-In Mic, Digital Dock HS Mic
        → AUDIO_DEVICE_IN_BUILTIN_MIC (0x80000004)
          → Shield TV has NO built-in mic
            → Signal power: (none) = ZERO AUDIO

FKB native AudioRecord (MIC source)
  → Android: AUDIO_SOURCE_MIC
    → AudioPolicyManager: route MIC → USB HAL module
      → AUDIO_DEVICE_IN_USB_DEVICE (0x80001000)
        → USB-Audio - Angetube Live Camera, card=2, device=0
          → Signal power: ~-63 dBFS = NON-ZERO (hardware works)
```

### Evidence Summary

| Evidence | Finding |
|----------|---------|
| AudioFlinger Thread 1 (CAMCORDER) | Routed to BUILTIN_MIC; signal power: (none) |
| AudioFlinger Thread 2 (MIC) | Routed to USB_DEVICE; signal power: -63 dBFS |
| Audio policy config | `primary_input` only supports Built-In Mic + Digital Dock HS Mic |
| USB device at HAL level | card=2, device=0, rate 48000, channels 1, producing data |
| 7 WebView strategies × 3 devices | All zero (all use CAMCORDER → BUILTIN_MIC) |
| Both WebView versions (v120, v144) | Same behavior — not a version regression |

### What This IS

- **An Android audio routing policy bug on NVIDIA Shield TV** — CAMCORDER source routes to a non-existent built-in mic instead of the available USB mic
- Caused by NVIDIA's `audio_policy_configuration_nv.xml` which does not include USB audio in the `primary_input` route's source list
- A [known issue](https://forums.developer.nvidia.com/t/silent-muted-no-microphone-input-audio-recording-in-webview-webrtc-after-upgrade-to-androidtv-11-nvidia-shield-9-0-0/210640) on NVIDIA forums (unanswered)
- Present on the factory WebView version — this device has likely never had working USB audio through WebView
- NOT fixable from JavaScript or WebView configuration

### What This is NOT

- A WebView version regression (broken on both v120 and v144)
- A permissions issue (all permissions granted and verified)
- An audio processing issue (zero with all processing disabled)
- A Web Audio API issue (zero through WebRTC stats and MediaRecorder too)
- A dual-capture issue (zero with single capture after fix)
- An AudioContext suspended state issue (all contexts report "running")
- A USB hardware failure (HAL signal power confirms the mic produces data)

---

## Historical Note

Commit `18ca0d82` (2026-02-21) introduced an RTCPeerConnection loopback stats approach to `useVolumeMeter.js` and was believed to produce real audio levels on the Shield TV. However, the comprehensive diagnostic shows this returning zero on both WebView versions. A previous probe session showed a false positive (RMS 0.0011, barely above the 0.001 threshold) that was not sustained in ongoing metering (maxLevel: 0 across 34,000+ samples). The earlier perceived success was likely a transient noise artifact.

---

## Resolution: Native Audio Bridge

The **native audio bridge app** option was implemented and deployed. Full design: [`_extensions/audio-bridge/DESIGN.md`](../../_extensions/audio-bridge/DESIGN.md)

### Solution Summary

A sideloaded Android APK (`net.kckern.audiobridge`, ~214KB) runs a foreground service that:
1. Starts a WebSocket server on `ws://localhost:8765`
2. When a client connects, opens `AudioRecord` with `AUDIO_SOURCE_MIC` at 48kHz/16-bit/mono
3. Streams raw PCM binary frames (~960 bytes = 10ms each) over the WebSocket
4. Client disconnect stops recording and releases `AudioRecord`

A new React hook (`useNativeAudioBridge`) in the frontend connects to this WebSocket, converts PCM to a `MediaStreamTrack` via AudioWorklet + `createMediaStreamDestination()`, and merges it with the video-only `getUserMedia` stream for WebRTC.

### Verification (2026-02-22)

**Standalone test** (Python WebSocket client via `adb forward`):
- 48,000 samples received, 82.8% non-zero
- RMS: -65.4 dBFS (matches AudioFlinger HAL signal power)
- Peak: -51.8 dBFS

**End-to-end call test** (phone → Shield TV via WebRTC):
- Frontend logs confirm: `bridge-connected`, `bridge-volume maxLevel: 0.007–0.009`
- AudioBridge logs: 5,990 frames captured in 60-second session
- **User confirmed audible audio from Shield's USB microphone on phone**

### Configuration

Bridge activation is config-driven per-device in `devices.yml`:

```yaml
livingroom-tv:
  input:
    audio_bridge:
      url: ws://localhost:8765
      mode: fallback   # activates when useAudioProbe reports 'no-mic'
```

Devices without `audio_bridge` config are unaffected — standard `getUserMedia` audio path is used.

### Known Issue: Android Recording Concurrency

Android's recording concurrency policy (API 29+) silences lower-priority apps when multiple record from the same source. Two confirmed triggers:

1. **FKB acoustic motion detection** — holds `AUDIO_SOURCE_MIC` as a foreground app, silencing our foreground service. **Must disable** via FKB REST API: `setBooleanSetting&key=acousticScreenOn&value=false`
2. **WebView getUserMedia timing** — when WebView opens CAMCORDER for camera, AudioFlinger may intermittently silence the bridge's MIC track depending on session setup timing

### Remaining Options (Not Pursued)

| Option | Approach | Effort | Likelihood | Notes |
|--------|----------|--------|------------|-------|
| ~~**Native audio bridge app**~~ | ~~Sideload AudioRecord MIC → WebSocket~~ | ~~Medium~~ | ~~**High**~~ | **IMPLEMENTED — this is the solution** |
| **Sideload Chrome** | Install Chrome for Android TV; may use MIC instead of CAMCORDER | Low | Medium | Not needed now; could still test for a simpler solution |
| **Modify audio_policy_configuration_nv.xml** | Root device, add USB to primary_input sources | Low | High | Requires root; would fix the problem at the source |
| **Bluetooth mic** | Pair BT mic; may route differently | Low | Low | Same routing policy likely applies |
| **Different USB audio adapter** | Dedicated USB audio adapter | Low | Low | Same routing policy applies |
| **LiveKit native client** | Native Android WebRTC client on Shield | High | High | Architectural change; not needed now |
