# Audio Bridge AEC (Acoustic Echo Cancellation)

Software echo cancellation for the native audio bridge on Shield TV. During video calls, the TV speakers play the remote caller's voice, the USB microphone picks it up, and the bridge streams it back — creating audible echo for the remote caller. AEC removes this echo by subtracting an estimated echo signal from the mic input.

**Depends on:** Native Audio Bridge (`_extensions/audio-bridge/DESIGN.md`), WebRTC calling

---

## How It Fits

```
Remote caller audio ──► WebRTC ──► peer.remoteStream
                                       │
                        ┌───────────────┤
                        │               ▼
                        │         <video> element
                        │         (TV speakers)
                        ▼
               ScriptProcessorNode
               (taps remote audio)
                        │
                        ▼ { ref } postMessage
USB Mic ──► AudioBridge APK ──► WebSocket ──► BridgeProcessor (AudioWorklet)
                                                     │
                                              ┌──────┴──────┐
                                              │  Speex AEC   │
                                              │  (WASM)      │
                                              │              │
                                              │  mic input ──┤
                                              │  ref input ──┤
                                              │  clean out ──┤
                                              └──────┬──────┘
                                                     │
                                                     ▼
                                              GainNode ──► Compressor ──► MediaStreamDestination
                                                                                │
                                                                                ▼
                                                                          WebRTC (to caller)
```

Two complementary strategies work together:

1. **Volume ducking** — TV volume drops to 12% when a call connects, restored to 50% on disconnect. Eliminates ~90% of echo by reducing speaker output.

2. **Speex AEC** — NLMS adaptive filter in the AudioWorklet subtracts the remaining echo using the remote audio as a reference signal. Handles the residual echo that ducking doesn't cover.

---

## Configuration

### devices.yml

AEC is configured per-device under `input.audio_bridge.aec`:

```yaml
devices:
  livingroom-tv:
    type: shield-tv
    input:
      audio_bridge:
        url: ws://localhost:8765
        mode: fallback
        gain: 1
        aec:
          enabled: true
          filter_length: 24000  # 500ms at 48kHz — covers Shield TV audio pipeline delay
          frame_size: 480      # 10ms frames
```

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Enable/disable AEC. When `false`, mic audio passes through unprocessed. |
| `filter_length` | `24000` | Adaptive filter length in samples. 24000 = 500ms at 48kHz. Must cover the full echo path: Chrome audio rendering → Android AudioTrack buffering → DAC → speaker → room → mic → AudioBridge. Shield TV measured at 400-500ms total. |
| `frame_size` | `480` | Processing frame size in samples. 480 = 10ms at 48kHz. Must match the APK's frame size. |

### Volume ducking levels

Volume ducking is hardcoded in `VideoCall.jsx`:

| Event | Volume level | API call |
|-------|-------------|----------|
| Call connects | 12% | `GET /api/v1/device/{id}/volume/12` |
| Call disconnects | 50% | `GET /api/v1/device/{id}/volume/50` |

The backend volume endpoint delegates to Home Assistant's `script.living_room_tv_volume`.

---

## Files

| File | Purpose |
|------|---------|
| `frontend/src/modules/Input/hooks/useNativeAudioBridge.js` | Hook + inline AudioWorklet. Main-thread AEC via Speex WASM, worklet is a simple PCM output device. |
| `frontend/src/modules/Input/VideoCall.jsx` | TV-side call component. Volume ducking and AEC reference signal tap via `bridge.feedReference()`. |
| `frontend/src/lib/audio/speex_aec.js` | Speex DSP compiled to WASM via Emscripten (~60KB). Base64-embedded binary (`SINGLE_FILE=1`). |
| `frontend/src/lib/audio/SpeexAEC.js` | Standalone JS wrapper for Speex WASM (available for other contexts). |
| `frontend/src/lib/audio/build-speex-aec.sh` | Emscripten build script. Requires `~/emsdk`. |
| `frontend/src/lib/audio/vendor/speexdsp/` | Speex DSP C sources (gitignored). Cloned from upstream for builds. |

---

## How It Works

### Why main-thread AEC (not AudioWorklet)

Chrome WebView 120 (Android 11, Shield TV) cannot compile WASM inside AudioWorklet scope. The Emscripten-generated `SpeexModule()` call hangs forever — `WebAssembly.instantiate()` never resolves or rejects. The worklet runs, mic audio passes through, but AEC never initializes (`aecReady: false`).

**Fix:** All Speex DSP runs on the main thread where WASM compilation works normally. The worklet is a simple PCM output device — it receives either raw mic Int16 (passthrough) or clean Float32 (AEC-processed) and plays it into the audio graph.

### Reference signal tap (VideoCall.jsx)

When a call connects and the bridge is active, `VideoCall` creates a separate `AudioContext` with a `ScriptProcessorNode` to extract PCM frames from `peer.remoteStream`. These frames are fed to the main-thread AEC via `bridge.feedReference(Float32Array)`.

The tap is muted (gain 0) and connected to `ctx.destination` only because `ScriptProcessorNode` requires a destination connection to fire its `onaudioprocess` callback.

### Main-thread AEC processing (useNativeAudioBridge)

The hook maintains two ring buffers on the main thread (96,000 samples each ≈ 2 seconds at 48kHz):

| Buffer | Source | Purpose |
|--------|--------|---------|
| `micRing` | WebSocket PCM (Int16 → Float32) | Raw microphone input from the AudioBridge APK |
| `refRing` | `feedReference()` (Float32) | Far-end reference signal (what the remote caller sent) |

When binary mic data arrives from the WebSocket:

1. If AEC is ready AND ref has been received: feed mic to ring buffer → process aligned 480-sample frames through `speex_echo_cancellation()` → run `speex_preprocess_run()` for residual echo suppression → send clean Float32 PCM to worklet via `postMessage({ cleanPcm })`
2. If no AEC or no ref yet: send raw Int16 PCM to worklet via `postMessage({ pcm })` (passthrough)

### Residual echo suppression (preprocessor)

The Speex adaptive filter alone leaves residual echo — the filter can't perfectly model the echo path, especially during convergence. The Speex preprocessor (`speex_preprocess_run`) applies spectral subtraction using the echo state to suppress residual echo that the adaptive filter misses. This is standard practice in Speex-based VoIP systems. The preprocessor is linked to the echo state via `SPEEX_PREPROCESS_SET_ECHO_STATE` and runs on every output frame after echo cancellation.

### Worklet (BridgeProcessor)

The worklet is a thin PCM output device with a single ring buffer:

- Accepts `{ pcm }` (Int16, passthrough) or `{ cleanPcm }` (Float32, AEC-processed)
- Writes to ring buffer, reads 128-sample chunks in `process()` for the audio graph
- Reports RMS volume and buffer levels via `postMessage`
- No WASM, no AEC logic — just buffering and output

### WASM initialization

On the main thread during `setupAudioPipeline()`, the Speex WASM is loaded via dynamic `import()` from a Blob URL (with `new Function()` fallback). The module compiles WASM normally in the main thread context where `self.location`, `WebAssembly.compile`, and `fetch` all work. The Speex echo state, sample rate, and WASM heap buffers are initialized once and reused for the duration of the bridge connection.

### Data type conversion

Web Audio API uses Float32 [-1.0, 1.0]. Speex uses Int16 [-32768, 32767]. Conversion happens in the main-thread AEC processing:

```
Float32 → Int16:  Math.max(-32768, Math.min(32767, sample * 32768))
Int16 → Float32:  sample / 32768
```

---

## Performance

AEC + preprocessor runs on the main thread (not the AudioWorklet). Speex echo cancellation is fast (~1-3ms per 480-sample frame on Cortex-A57 with 500ms filter), and the preprocessor adds ~0.5ms. Well under the 10ms frame interval. The main thread on Shield TV is lightly loaded during video calls (just displaying video), so AEC processing doesn't cause jank.

### Memory

| Component | Size |
|-----------|------|
| Speex AEC state (filter_length=24000) | ~500 KB |
| Speex preprocessor state | ~50 KB |
| WASM module | ~90 KB |
| Ring buffers (2 x 96000 x 4 bytes, main thread) | ~768 KB |
| Worklet ring buffer (48000 x 4 bytes) | ~192 KB |
| **Total** | **~1.6 MB** |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Echo persists during calls | AEC disabled in config | Check `devices.yml` → `aec.enabled: true` |
| Echo persists, AEC reports `ready` | Reference signal not reaching AEC | Check browser console for `aec-ref-tap-started` log. Verify `peer.remoteStream` has audio tracks. |
| `bridge-aec-status` (failed) in logs | WASM module failed to load on main thread | Check browser console for Speex initialization errors. Rebuild with `build-speex-aec.sh`. |
| Echo in first 1-3 seconds of call | Normal — adaptive filter convergence | Speex NLMS needs 1-3 seconds to learn the echo path. Not a bug. |
| Volume doesn't duck during calls | Volume API unreachable | Check `volume-duck-failed` logs. Verify Home Assistant script `script.living_room_tv_volume` exists. |
| Volume stays low after hangup | React cleanup didn't fire | Manually call `GET /api/v1/device/{deviceId}/volume/50`. Check for component unmount issues. |
| `aecReady: false` with `refBuffered > 0` | WASM hung in AudioWorklet (old bug) | Ensure code uses main-thread AEC (not worklet WASM). See "Why main-thread AEC" section. |

### Verifying AEC is active

In browser console, set `window.DAYLIGHT_LOG_LEVEL = 'debug'` and look for:

1. `bridge-aec-status` with `status: 'ready'` — WASM loaded on main thread, Speex initialized
2. `bridge-connected` with `aec: 'ready'` — Bridge pipeline ready with AEC
3. `aec-ref-tap-started` — Reference signal tap attached to remote audio

During an active call, mic data in logs should show `cleanPcm` being sent to the worklet (not raw `pcm`).

---

## Logging

### AEC lifecycle events

| Event | Level | Meaning |
|-------|-------|---------|
| `bridge-aec-status` (ready) | info | WASM loaded on main thread, Speex echo state created |
| `bridge-aec-status` (disabled) | info | AEC disabled via config |
| `bridge-aec-status` (failed) | warn | WASM initialization failed on main thread |
| `aec-ref-tap-started` | info | ScriptProcessorNode tapping remote audio |
| `aec-ref-tap-stopped` | info | Reference tap torn down (call ended) |

### Volume ducking events

| Event | Level | Meaning |
|-------|-------|---------|
| `volume-duck` | info | Lowering TV volume for call |
| `volume-restore` | info | Restoring TV volume after call |
| `volume-duck-failed` | warn | Volume API call failed |
| `volume-restore-failed` | warn | Volume restore API call failed |

### Debug telemetry (every 500 worklet frames)

| Field | Meaning |
|-------|---------|
| `buffered` | Samples in worklet output ring buffer |

---

## Building the WASM Module

The Speex DSP WASM binary is pre-built and checked into `frontend/src/lib/audio/speex_aec.js`. To rebuild after modifying build flags or upgrading Speex:

```bash
# Prerequisites: Emscripten SDK at ~/emsdk
cd frontend/src/lib/audio
bash build-speex-aec.sh
```

The build script:
1. Sources `~/emsdk/emsdk_env.sh` if `emcc` is not on PATH
2. Clones `speexdsp` sources to `vendor/speexdsp/` if not present
3. Compiles with: `-O2`, `SINGLE_FILE=1`, `MODULARIZE=1`, `ENVIRONMENT='worker'`, `INITIAL_MEMORY=1MB`, `ALLOW_MEMORY_GROWTH=0`
4. Outputs `speex_aec.js` (~60KB with embedded WASM)

Key build choices:
- **`SINGLE_FILE=1`**: Embeds WASM as base64 in JS — required because AudioWorklets can't `fetch()` external files
- **`ENVIRONMENT='worker'`**: AudioWorklets run in a worker-like scope
- **`ALLOW_MEMORY_GROWTH=0`**: Prevents runtime memory growth pauses (real-time safety)
- **`FLOATING_POINT`** + **`USE_KISS_FFT`**: Speex DSP config flags for float processing with built-in FFT
