# Audio Bridge AEC (Acoustic Echo Cancellation)

Software echo cancellation for the native audio bridge on Shield TV. During video calls, the TV speakers play the remote caller's voice, the USB microphone picks it up, and the bridge streams it back — creating audible echo for the remote caller. AEC removes this echo through three complementary strategies.

**Depends on:** Native Audio Bridge (`_extensions/audio-bridge/DESIGN.md`), WebRTC calling

---

## How It Fits

```
Remote caller audio ──► WebRTC ──► peer.remoteStream
                                       │
                        ┌───────────────┤
                        │               ▼
                        │         <video> element
                        │         (TV speakers, ducked to 5%)
                        ▼
               ScriptProcessorNode
               (taps remote audio)
                        │
                        ▼ { ref } postMessage
USB Mic ──► AudioBridge APK ──► WebSocket ──► Main Thread AEC
                                                     │
                                              ┌──────┴──────┐
                                              │  Speex AEC   │
                                              │  (WASM)      │
                                              │  + preproc   │
                                              │  + gate      │
                                              │              │
                                              │  mic input ──┤
                                              │  ref input ──┤
                                              │  clean out ──┤
                                              └──────┬──────┘
                                                     │
                                              BridgeProcessor (AudioWorklet)
                                                     │
                                                     ▼
                                              GainNode ──► Compressor ──► MediaStreamDestination
                                                                                │
                                                                                ▼
                                                                          WebRTC (to caller)
```

Three complementary strategies work together:

1. **Volume ducking** — TV volume drops to 5% when a call connects, restored to 50% on disconnect. Eliminates most echo by reducing speaker output.

2. **Speex AEC + preprocessor** — NLMS adaptive filter on the main thread subtracts echo using the remote audio as reference. The Speex preprocessor applies spectral subtraction for residual echo. Requires 30-50 seconds to converge with a 500ms filter — too slow for short calls.

3. **Echo suppression gate** — Energy-tracking gate that attenuates mic output when reference signal is active. Works immediately with no convergence time. The gate tracks reference signal energy with fast attack / slow release and applies -26dB suppression when the caller is speaking through TV speakers. This is the primary echo suppression mechanism for short calls.

---

## Configuration

### devices.yml

AEC and video resolution are configured per-device under `input`:

```yaml
devices:
  livingroom-tv:
    type: shield-tv
    input:
      video_resolution:
        width: 1920
        height: 1080
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
| `video_resolution.width` | 1280 | Target video width. Must match a supported camera resolution. |
| `video_resolution.height` | 720 | Target video height. |
| `aec.enabled` | `true` | Enable/disable AEC. When `false`, mic audio passes through unprocessed. |
| `aec.filter_length` | `24000` | Adaptive filter length in samples. 24000 = 500ms at 48kHz. Must cover the full echo path: Chrome audio rendering → Android AudioTrack buffering → DAC → speaker → room → mic → AudioBridge. Shield TV measured at 400-500ms total. |
| `aec.frame_size` | `480` | Processing frame size in samples. 480 = 10ms at 48kHz. Must match the APK's frame size. |

**Video resolution notes:** The Angetube camera supports 3840x2160, 1920x1080, 1280x720, and 640x480. However, Chrome WebView's Tegra X1 hardware encoder cannot encode 4K in real-time (fps=0 in production). Use 1920x1080 maximum. Config changes require Docker container restart.

### Volume ducking levels

Volume ducking is hardcoded in `VideoCall.jsx`:

| Event | Volume level | API call |
|-------|-------------|----------|
| Call connects | 5% | `GET /api/v1/device/{id}/volume/5` |
| Call disconnects | 50% | `GET /api/v1/device/{id}/volume/50` |

The backend volume endpoint delegates to Home Assistant's `script.living_room_tv_volume`.

### Echo suppression gate parameters

Hardcoded in `useNativeAudioBridge.js`:

| Parameter | Value | Description |
|-----------|-------|-------------|
| `GATE_ATTACK` | 0.15 | Fast attack — suppress quickly when ref signal detected |
| `GATE_RELEASE` | 0.005 | Slow release — wait for echo to die before unmuting |
| `GATE_THRESHOLD` | 0.001 | Reference energy threshold to trigger suppression |
| `GATE_FLOOR` | 0.05 | -26dB suppression when gate is active |

---

## Files

| File | Purpose |
|------|---------|
| `frontend/src/modules/Input/hooks/useNativeAudioBridge.js` | Hook + inline AudioWorklet. Main-thread AEC via Speex WASM, echo suppression gate, worklet is a simple PCM output device. |
| `frontend/src/modules/Input/hooks/useWebcamStream.js` | Camera acquisition with resolution tier cascade, FPS monitoring, and resolution mismatch detection. |
| `frontend/src/modules/Input/VideoCall.jsx` | TV-side call component. Volume ducking, AEC reference signal tap, config gating. |
| `frontend/src/lib/audio/speex_aec.js` | Speex DSP compiled to WASM via Emscripten (~90KB). Base64-embedded binary (`SINGLE_FILE=1`). |
| `frontend/src/lib/audio/SpeexAEC.js` | Standalone JS wrapper for Speex WASM (available for other contexts). |
| `frontend/src/lib/audio/build-speex-aec.sh` | Emscripten build script. Requires `~/emsdk`. |
| `frontend/src/lib/audio/vendor/speexdsp/` | Speex DSP C sources (gitignored). Cloned from upstream for builds. |

---

## How It Works

### Why main-thread AEC (not AudioWorklet)

Chrome WebView 120+ (Android 11, Shield TV) cannot compile WASM inside AudioWorklet scope. The Emscripten-generated `SpeexModule()` call hangs forever — `WebAssembly.instantiate()` never resolves or rejects. The worklet runs, mic audio passes through, but AEC never initializes (`aecReady: false`).

**Fix:** All Speex DSP runs on the main thread where WASM compilation works normally. The worklet is a simple PCM output device — it receives either raw mic Int16 (passthrough) or clean Float32 (AEC-processed) and plays it into the audio graph.

### Reference signal tap (VideoCall.jsx)

When a call connects and the bridge is active, `VideoCall` creates a separate `AudioContext` with a `ScriptProcessorNode` to extract PCM frames from `peer.remoteStream`. These frames are fed to the main-thread AEC via `bridge.feedReference(Float32Array)`.

The tap is muted (gain 0) and connected to `ctx.destination` only because `ScriptProcessorNode` requires a destination connection to fire its `onaudioprocess` callback. The AudioContext must be explicitly resumed (`ctx.resume()`) — Android WebView starts AudioContext suspended, and without resume `onaudioprocess` never fires.

### Main-thread AEC processing (useNativeAudioBridge)

The hook maintains two ring buffers on the main thread (96,000 samples each ≈ 2 seconds at 48kHz):

| Buffer | Source | Purpose |
|--------|--------|---------|
| `micRing` | WebSocket PCM (Int16 → Float32) | Raw microphone input from the AudioBridge APK |
| `refRing` | `feedReference()` (Float32) | Far-end reference signal (what the remote caller sent) |

When binary mic data arrives from the WebSocket:

1. If AEC is ready AND ref has been received: feed mic to ring buffer → process aligned 480-sample frames through `speex_echo_cancellation()` → run `speex_preprocess_run()` for residual echo suppression → apply echo suppression gate → send clean Float32 PCM to worklet via `postMessage({ cleanPcm })`
2. If no AEC or no ref yet: send raw Int16 PCM to worklet via `postMessage({ pcm })` (passthrough)

### Echo suppression gate

The Speex adaptive filter needs 30-50 seconds to converge with 50 blocks (500ms filter) and a weak echo signal (5% volume). Most calls are shorter than this. The echo suppression gate provides immediate echo reduction:

- Tracks reference signal energy per frame with fast attack (0.15) and slow release (0.005)
- When ref energy exceeds threshold (0.001), applies -26dB attenuation to mic output
- Works frame-by-frame with no convergence time — effective from the first frame
- Runs after Speex AEC + preprocessor, providing an additional layer of suppression

### Residual echo suppression (preprocessor)

The Speex adaptive filter alone leaves residual echo — the filter can't perfectly model the echo path, especially during convergence. The Speex preprocessor (`speex_preprocess_run`) applies spectral subtraction using the echo state to suppress residual echo that the adaptive filter misses. The preprocessor is linked to the echo state via `SPEEX_PREPROCESS_SET_ECHO_STATE` and runs on every output frame after echo cancellation.

**Critical API note:** The Speex C API is inconsistent with pointer semantics:
- `speex_echo_ctl(state, SPEEX_ECHO_SET_SAMPLING_RATE, ptr)` — **dereferences** ptr: `*(spx_int32_t*)ptr`
- `speex_preprocess_ctl(pp, SPEEX_PREPROCESS_SET_ECHO_STATE, ptr)` — **uses** ptr directly: `(SpeexEchoState*)ptr`

Pass the echo state pointer directly to `SET_ECHO_STATE`, NOT a pointer-to-pointer. Getting this wrong causes "memory access out of bounds" or "In-place FFT not supported" crashes.

### Worklet (BridgeProcessor)

The worklet is a thin PCM output device with a single ring buffer:

- Accepts `{ pcm }` (Int16, passthrough) or `{ cleanPcm }` (Float32, AEC-processed)
- Writes to ring buffer, reads 128-sample chunks in `process()` for the audio graph
- Reports RMS volume and buffer levels via `postMessage`
- No WASM, no AEC logic — just buffering and output

### WASM initialization

On the main thread during `setupAudioPipeline()`, the Speex WASM is loaded via dynamic `import()` from a Blob URL (with `new Function()` fallback). The module compiles WASM normally in the main thread context where `self.location`, `WebAssembly.compile`, and `fetch` all work. The Speex echo state, preprocessor, sample rate, and WASM heap buffers are initialized once and reused for the duration of the bridge connection.

### Camera acquisition (useWebcamStream)

Camera resolution is managed by a tier cascade system:

1. Config specifies target resolution (`video_resolution` in devices.yml)
2. `useWebcamStream` finds the matching tier (4K, 1080p, 720p) and starts there
3. Uses `ideal` constraints (not `min`/`exact`) — Chrome WebView rejects strict constraints
4. After acquisition, checks if actual resolution matches requested (within 50%)
5. If mismatch detected (e.g., got 640x480 when asking for 1920x1080), skips to next tier
6. FPS monitor runs every 5s (after 8s initial delay) as a secondary fallback

**Config gating:** The `ready` option prevents camera acquisition before device config loads. Without this, the useEffect fires twice in rapid succession (once with default 720p, once with config resolution), causing the USB camera driver to return 640x480 for both.

### Data type conversion

Web Audio API uses Float32 [-1.0, 1.0]. Speex uses Int16 [-32768, 32767]. Conversion happens in the main-thread AEC processing:

```
Float32 → Int16:  Math.max(-32768, Math.min(32767, sample * 32768))
Int16 → Float32:  sample / 32768
```

---

## Performance

AEC + preprocessor + gate runs on the main thread (not the AudioWorklet). Speex echo cancellation is fast (~1-3ms per 480-sample frame on Cortex-A57 with 500ms filter), the preprocessor adds ~0.5ms, and the gate is negligible. Well under the 10ms frame interval. The main thread on Shield TV is lightly loaded during video calls (just displaying video), so AEC processing doesn't cause jank.

### Memory

| Component | Size |
|-----------|------|
| Speex AEC state (filter_length=24000) | ~500 KB |
| Speex preprocessor state | ~50 KB |
| WASM module (4MB heap) | ~4 MB |
| Ring buffers (2 x 96000 x 4 bytes, main thread) | ~768 KB |
| Worklet ring buffer (48000 x 4 bytes) | ~192 KB |
| **Total** | **~5.5 MB** |

---

## Troubleshooting

### Quick triage checklist

When debugging call quality issues, check these log events in order:

```bash
# Get recent call logs from Shield TV
ssh {env.prod_host} 'docker logs --tail 3000 {env.docker_container} 2>&1' \
  | grep "SHIELD" \
  | grep -E "stream-|volume-|bridge-aec|bridge-connected|aec-ref|peer-|mounted|unmounted" \
  | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        d = json.loads(line.strip())
        print(f'{d[\"ts\"]} {d[\"event\"]}: {json.dumps(d[\"data\"], default=str)}')
    except: pass
" | tail -40
```

### Triage decision tree

```
1. Is bridge-aec-status: ready?
   NO → WASM failed to load. Check for Speex init errors. Rebuild WASM.
   YES ↓

2. Is aec-ref-tap-started present?
   NO → Reference signal not tapped. Check peer.remoteStream has audio tracks.
   YES ↓

3. Is bridge-aec-active: { mode: 'aec' } present?
   NO → AEC initialized but not processing. Check if ref data is being received.
   YES ↓

4. Is volume-duck present with correct level?
   NO → Volume API failed. Check volume-duck-failed logs.
   YES ↓

5. Check stream-acquired videoSettings:
   - w/h show 640x480? → Camera gave wrong resolution. See "Camera resolution" below.
   - aspectRatio is 1.333? → Same issue — 4:3 instead of 16:9.
   - w/h show 1920x1080? → Camera is correct.

6. Echo still present with all above OK?
   → Gate parameters may need tuning. Check if gate is suppressing during speech.
   → Try lowering GATE_THRESHOLD or GATE_FLOOR in useNativeAudioBridge.js.
```

### Camera resolution issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| All tiers report 640x480 | Double-open race: config loads after first getUserMedia, causing two rapid acquisitions | Ensure `ready: configLoaded` is passed to useWebcamStream. Check that config API responds before camera opens. |
| 4K tier acquires but fps=0 | Chrome WebView's Tegra X1 encoder can't handle 4K real-time | Set `video_resolution` to 1920x1080 in devices.yml. Restart Docker container. |
| `stream-tier-failed` with empty error | Chrome WebView rejects constraints silently | Ensure constraints use `ideal` not `min`/`exact`. Check `buildVideoConstraint()`. |
| Resolution mismatch log then bare fallback | All tiers gave wrong resolution, cascade exhausted | Camera may be in bad USB state. Replug the USB camera. Check with `adb shell dumpsys media.camera`. |
| FPS downgrade fires but too late | `getVideoPlaybackQuality()` not available on Chrome WebView | Resolution mismatch check (immediate) should catch this before FPS monitor (delayed). |

### Verifying camera state via ADB

```bash
# Check camera is present and not stuck open
adb shell dumpsys media.camera | head -20

# Check supported resolutions
adb shell dumpsys media.camera | grep -A 40 "availableStreamConfigurations"

# Expected output for Angetube camera:
#   [33 3840 2160 OUTPUT]   ← 4K (don't use — encoder can't handle it)
#   [33 1920 1080 OUTPUT]   ← 1080p (recommended)
#   [33 1280 720  OUTPUT]   ← 720p
#   [33 640  480  OUTPUT]   ← VGA (fallback)
```

### AEC-specific issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Echo persists during calls | AEC disabled in config | Check `devices.yml` → `aec.enabled: true` |
| Echo persists, AEC reports `ready` | Reference signal not reaching AEC | Check browser console for `aec-ref-tap-started` log. Verify `peer.remoteStream` has audio tracks. |
| `bridge-aec-status` (failed) in logs | WASM module failed to load on main thread | Check browser console for Speex initialization errors. Rebuild with `build-speex-aec.sh`. |
| "memory access out of bounds" crash | Preprocessor pointer bug — SET_ECHO_STATE passed ptr-to-ptr instead of ptr directly | Pass echo state pointer directly: `speexMod._speex_preprocess_ctl(ppState, 24, state)` |
| "In-place FFT not supported" crash | Same root cause as above — preprocessor following garbage pointer | Same fix as above. |
| Echo in first few seconds of call | Normal — adaptive filter convergence + gate ramp-up | Gate should suppress within 1-2 frames. If not, check GATE_THRESHOLD. |
| Volume doesn't duck during calls | Volume API unreachable | Check `volume-duck-failed` logs. Verify Home Assistant script `script.living_room_tv_volume` exists. |
| Volume stays low after hangup | React cleanup didn't fire | Manually call `GET /api/v1/device/{deviceId}/volume/50`. Check for component unmount issues. |

### Verifying AEC is active

In browser console, set `window.DAYLIGHT_LOG_LEVEL = 'debug'` and look for:

1. `bridge-aec-status` with `status: 'ready'` — WASM loaded on main thread, Speex initialized
2. `bridge-connected` with `aec: 'ready'` — Bridge pipeline ready with AEC
3. `aec-ref-tap-started` — Reference signal tap attached to remote audio
4. `bridge-aec-active` with `mode: 'aec'` — AEC processing mic frames

During an active call, mic data in logs should show `cleanPcm` being sent to the worklet (not raw `pcm`).

---

## Logging

### AEC lifecycle events

| Event | Level | Meaning |
|-------|-------|---------|
| `bridge-aec-status` (ready) | info | WASM loaded on main thread, Speex echo state + preprocessor created |
| `bridge-aec-status` (disabled) | info | AEC disabled via config |
| `bridge-aec-status` (failed) | warn | WASM initialization failed on main thread |
| `bridge-aec-active` | info | AEC processing frames (mode: 'aec' or 'passthrough') |
| `aec-ref-tap-started` | info | ScriptProcessorNode tapping remote audio |
| `aec-ref-tap-stopped` | info | Reference tap torn down (call ended) |

### Volume ducking events

| Event | Level | Meaning |
|-------|-------|---------|
| `volume-duck` | info | Lowering TV volume for call (level: 5) |
| `volume-restore` | info | Restoring TV volume after call (level: 50) |
| `volume-duck-failed` | warn | Volume API call failed |
| `volume-restore-failed` | warn | Volume restore API call failed |

### Camera resolution events

| Event | Level | Meaning |
|-------|-------|---------|
| `stream-attempt` | info | Attempting getUserMedia at tier (4K/1080p/720p) |
| `stream-acquired` | info | Stream acquired — check `videoSettings` for actual resolution |
| `stream-tier-failed` | warn | getUserMedia failed for tier — cascading to next |
| `stream-resolution-mismatch` | warn | Actual resolution far below requested — skipping tier |
| `stream-fallback-bare` | warn | All tiers failed — trying bare getUserMedia (no resolution constraint) |
| `stream-fps-downgrade` | warn | FPS below threshold — re-acquiring at lower tier |

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
2. Generates `speexdsp_config_types.h` for the vendor sources
3. Compiles with: `-O2`, `SINGLE_FILE=1`, `MODULARIZE=1`, `ENVIRONMENT='worker'`, `INITIAL_MEMORY=4MB`, `ALLOW_MEMORY_GROWTH=0`
4. Exports: echo cancellation (`speex_echo_*`), preprocessor (`speex_preprocess_*`), and memory (`malloc`, `free`)
5. Outputs `speex_aec.js` (~90KB with embedded WASM)

Key build choices:
- **`SINGLE_FILE=1`**: Embeds WASM as base64 in JS — required because AudioWorklets can't `fetch()` external files
- **`ENVIRONMENT='worker'`**: AudioWorklets run in a worker-like scope
- **`ALLOW_MEMORY_GROWTH=0`**: Prevents runtime memory growth pauses (real-time safety)
- **`INITIAL_MEMORY=4MB`**: Sufficient for echo canceller (500ms filter) + preprocessor state
- **`FLOATING_POINT`** + **`USE_KISS_FFT`**: Speex DSP config flags for float processing with built-in FFT

---

## Known Issues & History

### Camera double-open race (fixed)

When VideoCall mounts, the webcam stream useEffect fires immediately with default 720p tier (config not loaded). ~30-50ms later, config loads and triggers a re-run targeting the configured resolution. The rapid stop→open→stop→open sequence confuses the USB camera driver on Shield TV — all acquisitions return 640x480 regardless of constraints.

**Fix:** `useWebcamStream` accepts a `ready` option. `VideoCall` passes `ready: configLoaded` to delay acquisition until device config is fetched. Single clean acquisition at the configured tier.

### 4K encoding failure on Tegra X1

The Angetube camera supports 3840x2160 at the HAL level (`adb shell dumpsys media.camera` confirms it). Chrome WebView acquires the stream without error, but the hardware encoder produces 0 frames — `stream-fps-downgrade` reports `fps: 0`. This is a Chrome WebView limitation on Tegra X1 (Cortex-A57), not a camera issue.

**Fix:** Configure `video_resolution` to 1920x1080 in devices.yml. Do not use 4K.

### Speex preprocessor pointer semantics

The Speex C API uses inconsistent pointer semantics across `ctl` functions. `SPEEX_PREPROCESS_SET_ECHO_STATE` (opcode 24) expects the echo state pointer directly, not a pointer to it. Passing a pointer-to-pointer causes the preprocessor to follow garbage memory, manifesting as either "In-place FFT not supported" (kiss_fft.c assertion) or "memory access out of bounds" (WASM RuntimeError).

### FPS monitor unreliable on Chrome WebView

`HTMLVideoElement.getVideoPlaybackQuality()` is not available for MediaStream-sourced `<video>` elements on Chrome WebView (Shield TV). The FPS monitor falls back to `videoTrack.getSettings().frameRate`, which reports the nominal rate (30) not actual frames rendered. The resolution mismatch check (comparing actual vs requested width) provides a more reliable immediate fallback.
