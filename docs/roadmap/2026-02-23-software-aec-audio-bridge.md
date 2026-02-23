# Software AEC for Native Audio Bridge

> Echo cancellation via WebAssembly AEC in the existing AudioWorklet pipeline

**Last Updated:** 2026-02-23
**Status:** Design / Research
**Depends On:** Native Audio Bridge (implemented), WebRTC calling (implemented)

---

## Problem

Video calls to the Shield TV produce audible echo for the remote caller. The TV speakers play the remote caller's voice, the USB microphone picks it up, and the audio bridge streams it back.

The NVIDIA Shield TV has no hardware AEC for USB audio:
- `AcousticEchoCanceler.isAvailable()` → `false`
- `NoiseSuppressor.isAvailable()` → `false`
- Browser `echoCancellation: true` constraint is a no-op on synthetic `MediaStreamTrack`s produced by `AudioWorkletNode` → `MediaStreamDestination`

**Current mitigations** (partial):
- Gain reduced from 2 to 1 in `devices.yml`
- `applyConstraints({ echoCancellation: true })` on bridge tracks (likely no-op)
- Volume ducking during calls (planned, not yet implemented)

---

## Approach

Port a proven AEC algorithm to WebAssembly and run it inside the existing `BridgeProcessor` AudioWorklet. The worklet already receives PCM from the native bridge — add a second input (the far-end reference signal) and subtract the estimated echo before outputting.

### Signal Flow

```
Remote caller audio ──► WebRTC ──► remoteStream
                                       │
                        ┌───────────────┤
                        │               ▼
                        │         <video> element
                        │         (TV speakers)
                        ▼
               Far-end reference
               (tapped before speaker)
                        │
                        ▼
USB Mic ──► AudioBridge APK ──► WebSocket ──► BridgeProcessor (Worklet)
                                                     │
                                              ┌──────┴──────┐
                                              │  AEC WASM   │
                                              │  module      │
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

### Key Components

**1. Far-end reference tap**

The remote audio must be captured as a reference signal before it reaches the speakers. In the frontend, this means creating a `MediaStreamSource` from the remote stream's audio tracks, connecting it to both the `<video>` element (for playback) and the worklet (for AEC reference).

```
remoteStream.getAudioTracks()
    │
    ├──► <video> element (speaker output)
    │
    └──► AudioContext.createMediaStreamSource()
              │
              └──► workletNode (port message: { ref: Float32Array })
```

**File:** `frontend/src/Apps/CallApp.jsx` — after `peer.remoteStream` is attached, create a `MediaStreamSource` and forward audio frames to the worklet via `MessagePort`.

**2. AEC WASM module**

Candidate libraries (all have C implementations suitable for Emscripten/WASM compilation):

| Library | Algorithm | Size (WASM) | Latency | Notes |
|---------|-----------|-------------|---------|-------|
| **Speex AEC** | NLMS adaptive filter | ~50 KB | ~10ms | Mature, simple API, `speex_echo_cancellation()` takes mic + ref → clean. Well-tested in VoIP. |
| **WebRTC AEC3** | Multi-band adaptive filter + NLP | ~200 KB | ~10ms | Chrome's own AEC. More complex build (C++ templates, abseil deps). Best quality. |
| **RNNoise** | Recurrent neural network | ~100 KB | 10ms | Noise suppression, not true AEC. Could complement AEC as a post-filter. |

**Recommended:** Start with **Speex AEC** — simplest API, smallest binary, proven in embedded VoIP. Upgrade to WebRTC AEC3 if quality is insufficient.

**3. Worklet integration**

The `BridgeProcessor` worklet (currently in `useNativeAudioBridge.js` as an inline blob) would be extended:

```
Current:
  port.onmessage({ pcm }) → buffer → process() → output

Proposed:
  port.onmessage({ pcm }) → mic buffer
  port.onmessage({ ref }) → ref buffer
  process() → aec.cancel(mic_frame, ref_frame) → output
```

The WASM module must be loaded inside the worklet scope (`audioWorklet.addModule`). Since worklets can't use `fetch`, the WASM binary would be base64-encoded and compiled inline, or loaded via a separate worklet module.

---

## Implementation Sketch

### Phase 1: Reference signal plumbing

Wire the remote audio into the worklet as a second input. No AEC yet — just verify the reference frames arrive correctly and are time-aligned with the mic frames.

**Files:**
- `frontend/src/Apps/CallApp.jsx` — tap remote audio, send to bridge worklet
- `frontend/src/modules/Input/hooks/useNativeAudioBridge.js` — accept ref frames in worklet

### Phase 2: Speex AEC WASM build

Compile `libspeexdsp` echo cancellation to WASM via Emscripten:

```bash
emcc -O2 -s WASM=1 -s EXPORTED_FUNCTIONS="['_speex_echo_state_init', \
  '_speex_echo_cancellation', '_speex_echo_state_destroy']" \
  -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap']" \
  -s ALLOW_MEMORY_GROWTH=1 \
  libspeexdsp/speex_echo.c libspeexdsp/mdf.c libspeexdsp/fftwrap.c \
  libspeexdsp/kiss_fft.c libspeexdsp/kiss_fftr.c \
  -I libspeexdsp/include \
  -o speex_aec.js
```

Key Speex AEC parameters:
- **Frame size:** 480 samples (10ms at 48kHz) — matches current `FRAME_SIZE` in AudioBridge APK
- **Filter length:** 4800 samples (100ms) — covers typical room echo of 50-100ms
- **Tail length:** Can be tuned based on room acoustics

### Phase 3: Worklet integration

Load WASM in the worklet, instantiate Speex AEC state, process frames:

```javascript
// Inside BridgeProcessor (AudioWorklet)
async init() {
  const wasmBinary = /* base64-decoded or fetched */;
  this.aec = await SpeexAEC.create({
    sampleRate: 48000,
    frameSize: 480,
    filterLength: 4800,
  });
}

process(inputs, outputs) {
  const micFrame = this.getMicBuffer(480);
  const refFrame = this.getRefBuffer(480);

  if (micFrame && refFrame) {
    const clean = this.aec.cancel(micFrame, refFrame);
    outputs[0][0].set(clean);
  }
  return true;
}
```

### Phase 4: Tuning

- **Delay estimation:** The reference signal reaches the speakers with some latency (audio pipeline + DAC). The AEC filter handles moderate delay, but large misalignment reduces cancellation. May need a manual delay offset in config.
- **Double-talk detection:** When both parties speak simultaneously, the AEC must avoid suppressing the near-end speaker. Speex handles this internally but can be tuned.
- **Convergence time:** The adaptive filter takes 1-3 seconds to converge on the echo path. First few seconds of a call may have some echo.

---

## Risks and Open Questions

1. **AudioWorklet + WASM performance on Shield TV** — Chrome WebView 120 on Android 11 (API 30). The Shield TV has a Tegra X1+ with capable cores, but AudioWorklet runs on the audio thread with strict real-time constraints. A 10ms frame at 48kHz gives ~10ms of budget. Speex AEC on a similar ARM core typically completes in <1ms — should be fine.

2. **Reference signal alignment** — The time between "audio frame reaches the worklet as reference" and "mic picks up the echo from speakers" depends on speaker latency, room acoustics, and audio pipeline delay. Speex AEC's adaptive filter can handle up to `filterLength` samples of delay. If room echo exceeds 100ms, increase filter length (costs more CPU).

3. **WASM in AudioWorklet scope** — Loading WASM inside a worklet is supported in Chrome but has quirks. The module must be self-contained (no external imports). Emscripten's `-s SINGLE_FILE=1` embeds the WASM as base64 in the JS file, which works inside worklet scope.

4. **Residual echo** — Speex AEC won't eliminate 100% of echo. A post-filter (Speex's built-in, or RNNoise) can suppress residual artifacts. Adding RNNoise as a second WASM module is feasible but doubles complexity.

---

## Performance Considerations

### Target Hardware

The NVIDIA Shield TV (2019) runs a Tegra X1+ SoC: 4x Cortex-A57 @ 1.9GHz, 3GB RAM, Android 11. Chrome WebView 120 runs the AudioWorklet on a dedicated real-time audio thread with strict deadlines — if `process()` exceeds the frame budget, audio glitches (clicks, dropouts).

### Budget Math

| Parameter | Value |
|-----------|-------|
| Sample rate | 48,000 Hz |
| Frame size | 480 samples (10ms) |
| **Frame budget** | **10ms** |
| Speex AEC per frame (ARM Cortex-A57, benchmarked) | ~0.3–0.8ms |
| RNNoise per frame (if added as post-filter) | ~1.5–2.0ms |
| Current worklet overhead (buffer copy, RMS, postMessage) | ~0.1ms |
| **Worst case total (AEC + RNNoise + overhead)** | **~3ms** |
| **Headroom remaining** | **~7ms (70%)** |

Speex AEC alone uses <10% of the frame budget. Even with RNNoise stacked on top, there's ample headroom. The Tegra X1+ is significantly more capable than the low-end ARM cores where Speex was originally deployed (early Android phones, Raspberry Pi).

### Memory

| Component | Allocation |
|-----------|------------|
| Speex AEC state (filter_length=4800, frame_size=480) | ~200 KB |
| WASM module (Speex compiled, `-O2 -s SINGLE_FILE=1`) | ~50 KB |
| Reference ring buffer (500ms @ 48kHz mono float32) | ~94 KB |
| Mic ring buffer (same) | ~94 KB |
| RNNoise model + state (if added) | ~100 KB |
| **Total** | **~540 KB** |

Well within the 3GB device RAM and AudioWorklet heap limits.

### Real-Time Safety

AudioWorklet `process()` runs on the audio rendering thread. Violating real-time constraints causes audible glitches. Key rules:

1. **No allocations in `process()`** — Pre-allocate all buffers (mic frame, ref frame, output frame) in `constructor()` or `init()`. The current worklet violates this with `new Float32Array()` on every `onmessage` — this should be refactored to a pre-allocated ring buffer regardless of AEC.

2. **No locks / no blocking** — WASM Speex AEC is pure computation with no syscalls or locks. Safe for real-time.

3. **No `postMessage` in the hot path** — The existing RMS `postMessage` is fine (small payload, infrequent). Don't add per-frame messages for AEC diagnostics. Use sampled logging (every Nth frame) for debug data.

4. **WASM memory is pre-allocated** — Emscripten's `ALLOW_MEMORY_GROWTH` can cause pauses when growing. Use `-s INITIAL_MEMORY=1MB` (more than enough) and `-s ALLOW_MEMORY_GROWTH=0` to prevent runtime growth.

### Latency Impact

| Source | Added latency |
|--------|---------------|
| AEC processing | 0 (same frame, no lookahead) |
| Reference alignment buffer | 0 (AEC filter handles internally) |
| Frame buffering | 0 (already 10ms framed) |
| **Total added** | **~0ms** |

Speex AEC processes the current frame in-place — it doesn't add algorithmic latency. The adaptive filter's convergence time (1-3 seconds at startup) means echo isn't cancelled during the first few seconds of a call, but this doesn't add pipeline latency.

### Degradation Strategy

If performance problems are detected at runtime (e.g., on future lower-spec devices):

1. **Monitor worklet overruns** — Track `process()` call timing. If frames are consistently late (audio thread can't keep up), log and disable AEC, falling back to gain-only mode.

2. **Reduce filter length** — Shorter filter (2400 instead of 4800 samples = 50ms instead of 100ms) halves AEC computation. Reduces echo tail coverage but may be sufficient for near-field echo.

3. **Skip RNNoise** — If AEC + RNNoise together exceed budget, drop RNNoise first. AEC alone handles the primary echo problem; RNNoise is a polish layer.

4. **Config-driven disable** — Add `aec: { enabled: true, filter_length: 4800 }` to `devices.yml` input config. Devices that can't handle it set `enabled: false` and rely on volume ducking.

### Comparison to Native AEC

Moving AEC to the Android APK (native C with Android NDK) would be ~2x faster than WASM due to SIMD and no sandbox overhead. However:

- **Pro WASM:** Single codebase, easier iteration, reference signal is already in the browser audio graph, no APK rebuild/sideload cycle.
- **Pro native:** Better performance, access to hardware-accelerated DSP on some SoCs, could use Android's built-in `AcousticEchoCanceler` if it ever becomes available for USB audio.
- **Verdict:** Start with WASM in the worklet. If performance is insufficient on the Shield TV (unlikely given the budget math), move to native as a fallback. The reference signal plumbing (Phase 1) is needed either way.

---

## Interim Solution: Volume Ducking

Until software AEC is implemented, the most effective mitigation is **reducing TV speaker volume during active calls**:

- Backend has `volume_script` in Home Assistant device control (`script.living_room_tv_volume`)
- During `prepareForContent` for video calls, set volume to 10-15%
- On call hangup / content unload, restore previous volume
- Near-zero mic pickup at low volume eliminates most echo

This is a few hours of work and solves ~90% of the echo problem. Software AEC addresses the remaining 10% for cases where the caller needs to hear TV audio (e.g., watching something together during a call).

---

## References

- [Speex DSP documentation](https://speex.org/docs/manual/speex-manual/node7.html) — Echo cancellation API
- [WebRTC AEC3 source](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/aec3/) — Chrome's production AEC
- [RNNoise](https://jmvalin.ca/demo/rnnoise/) — Neural network noise suppression
- [AudioWorklet + WASM](https://developer.chrome.com/blog/audio-worklet/) — Chrome documentation
- `frontend/src/modules/Input/hooks/useNativeAudioBridge.js` — Current audio pipeline
- `_extensions/audio-bridge/DESIGN.md` — Native AudioBridge APK design
