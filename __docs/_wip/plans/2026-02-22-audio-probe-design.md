# Audio Probe Design — Bulletproof Mic Detection

**Date:** 2026-02-22
**Status:** Design
**Problem:** USB audio capture on NVIDIA Shield TV (Fully Kiosk Browser / Android System WebView / Chrome 144) returns a valid-looking `MediaStreamTrack` (`enabled: true`, `muted: false`, `label: "USB audio"`) but the track carries **zero audio data**. This breaks both the volume meter (always reads 0) and video call audio (phone cannot hear TV).

**Root cause:** Android System WebView's `getUserMedia` can enumerate and "acquire" USB audio devices, but the actual audio pipeline doesn't route data into the track. Regular Chrome on the same hardware works fine.

---

## Solution: `useAudioProbe` Hook

A new hook that **probes each audio device with multiple capture strategies** on startup to find a device+method combination that produces real audio data.

### Architecture

```
useMediaDevices({ preferredMicPattern, preferredCameraPattern })
├── audioDevices[]
├── videoDevices[]
└── selectedAudioDevice (initial pick by config pattern)
        │
        ▼
useAudioProbe(audioDevices, { preferredDeviceId })
├── workingDeviceId   ← verified working mic (or null)
├── volume            ← continuous 0-1 level from working method
├── method            ← 'audioWorklet' | 'scriptProcessor' | 'mediaRecorder' | null
├── status            ← 'probing' | 'ready' | 'no-mic'
├── probingDeviceLabel← label of device currently being tested
└── diagnostics[]     ← per-device per-method results
        │
        ▼
useWebcamStream(videoDevice, workingDeviceId ?? selectedAudioDevice)
        │
        ▼
Webcam.jsx / VideoCall.jsx
```

### Hook API

```javascript
const {
  workingDeviceId,    // string | null
  volume,             // number 0–1
  method,             // string | null
  status,             // 'probing' | 'ready' | 'no-mic'
  probingDeviceLabel, // string — "Checking: USB audio..." while probing
  diagnostics,        // [{ deviceId, label, methods: { audioWorklet, scriptProcessor, mediaRecorder } }]
} = useAudioProbe(audioDevices, {
  preferredDeviceId: selectedAudioDevice, // try this device first
});
```

---

## Probe Sequence

For each audio device (preferred device first, then others in order):

1. **Acquire** — `getUserMedia({ audio: { deviceId: { exact: id } } })`
2. **Test strategies in order:**
   - **AudioWorklet** — register processor, read raw PCM, compute RMS
   - **ScriptProcessorNode** — deprecated fallback, same raw PCM → RMS
   - **MediaRecorder** — record 200ms chunk, `decodeAudioData`, check samples
3. **Verdict** — RMS > 0.001 within 1.5s → confirmed. Zero → try next method, then next device.
4. **Winner** — First working combo becomes session audio source + metering strategy.

### Timing

| Scenario | Duration |
|----------|----------|
| Best case (first device, first method) | ~200ms |
| Typical (2nd device, 1st method) | ~2s |
| Worst case (3 devices × 3 methods) | ~4.5s |
| All fail | ~4.5s → status: 'no-mic' |

### RMS Threshold: 0.001

- A dead track returns exactly `0.000000` — no data in the pipeline
- A working mic in a "quiet" room still picks up ambient noise (HVAC, electronics) → RMS > 0.001
- This threshold distinguishes "broken pipeline" from "quiet room"

---

## Capture Strategies

### Strategy 1: AudioWorklet (preferred)

```
AudioContext → createMediaStreamSource(stream) → AudioWorkletNode
WorkletProcessor: compute RMS from raw PCM input, post via MessagePort
```

- Runs off main thread (best performance for ongoing metering)
- Skip if `audioContext.audioWorklet` is unavailable

### Strategy 2: ScriptProcessorNode (deprecated fallback)

```
AudioContext → createMediaStreamSource(stream) → ScriptProcessorNode → destination
onaudioprocess callback: compute RMS from inputBuffer.getChannelData(0)
```

- Runs on main thread (worse perf but universally supported)
- Works on every browser that supports `getUserMedia`

### Strategy 3: MediaRecorder (different pipeline)

```
MediaRecorder(audioOnlyStream) → record 200ms → blob → decodeAudioData → check samples
```

- Bypasses Web Audio API entirely
- Uses the platform's media recording/encoding stack
- More expensive (encode + decode) but catches cases where Web Audio is broken while recording works

---

## Integration

### Webcam.jsx

```
Before:  useMediaDevices() → useWebcamStream(vid, aud) → useVolumeMeter(stream)
         + auto-cycle useEffect

After:   useMediaDevices({ prefs }) → useAudioProbe(audioDevices) → useWebcamStream(vid, workingId)
         volume from probe, no auto-cycle needed
```

- Remove `useVolumeMeter` import
- Remove auto-cycle `useEffect` block (probe handles device discovery)
- Use `probe.volume` for the green bar
- Use `probe.workingDeviceId ?? selectedAudioDevice` for `useWebcamStream`

### VideoCall.jsx

Same swap — `useAudioProbe` replaces `useVolumeMeter`. Fixes **call audio too** since the stream acquired with the working device will carry real audio data.

### Unchanged

- `CallApp.jsx` (phone side, real Chrome) — no probe needed
- `useVolumeMeter.js` — stays as-is, not deleted
- `useWebcamStream.js` — no changes
- `useWebRTCPeer.js` — no changes

---

## Visual Indicator

The existing mic label overlay in Webcam.jsx and VideoCall.jsx is extended to show probe status:

| `probe.status` | Overlay shows |
|---|---|
| `probing` | `Mic: Checking "USB audio"...` (updates as each device is tested) |
| `ready` | `Mic: USB audio` (normal display, confirmed working) |
| `no-mic` | `Mic: No working microphone found` (red/warning style) |

During probing, the label updates in real-time via `probe.probingDeviceLabel` so the user sees which device is being tested.

---

## Logging

All events at `info` level for production diagnostics:

| Event | Data |
|---|---|
| `audio-probe-start` | `{ deviceCount, preferredDeviceId }` |
| `audio-probe-testing` | `{ deviceId, label, method }` |
| `audio-probe-result` | `{ deviceId, label, method, rms, verdict: 'active'\|'silent'\|'error' }` |
| `audio-probe-winner` | `{ deviceId, label, method, rms }` |
| `audio-probe-failed` | `{ diagnostics[] }` — all devices/methods exhausted |
| `audio-probe-volume` | sampled every 5s: `{ method, maxLevel, samples }` |

---

## Files to Create/Modify

| File | Action |
|---|---|
| `frontend/src/modules/Input/hooks/useAudioProbe.js` | **Create** — new hook |
| `frontend/src/modules/Input/hooks/audioProbeStrategies.js` | **Create** — AudioWorklet, ScriptProcessor, MediaRecorder strategy implementations |
| `frontend/src/modules/Input/hooks/volume-meter-processor.js` | **Create** — AudioWorkletProcessor source (registered via Blob URL) |
| `frontend/src/modules/Input/Webcam.jsx` | **Modify** — swap useVolumeMeter → useAudioProbe, update overlay |
| `frontend/src/modules/Input/VideoCall.jsx` | **Modify** — swap useVolumeMeter → useAudioProbe |

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| Only 1 audio device, and it's broken | Probe tries all 3 methods, then reports `no-mic` |
| Device plugged in after mount | `useMediaDevices` fires `devicechange`, re-enumerates; probe re-runs with new device list |
| Mic works but room is truly silent | RMS stays below 0.001 → probe marks as silent. Acceptable false negative — user would need to make a sound. Could add "Tap to test mic" UI later. |
| AudioWorklet registration fails | Skip to ScriptProcessorNode — no crash |
| MediaRecorder unsupported mime type | Try `audio/webm` then `audio/ogg` then skip |
| Config `preferred_mic` pattern arrives after probe starts | Probe uses `preferredDeviceId` which updates from `useMediaDevices`; re-run probe with new preferred device first |
