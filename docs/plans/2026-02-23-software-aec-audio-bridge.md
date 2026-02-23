# Software AEC for Native Audio Bridge — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate echo on video calls by (1) ducking TV volume during calls as an immediate fix, and (2) implementing Speex-based acoustic echo cancellation in the AudioWorklet pipeline.

**Architecture:** The TV's USB mic picks up speaker audio and echoes it back to the caller. Volume ducking solves ~90% by reducing speaker level during calls. Software AEC processes the mic signal through a Speex NLMS adaptive filter running in WebAssembly inside the existing BridgeProcessor AudioWorklet, using a tapped copy of the remote caller's audio as the echo reference signal.

**Tech Stack:** WebAssembly (Emscripten), Speex DSP (C → WASM), AudioWorklet API, Web Audio API, Home Assistant REST API (volume control)

---

## Task 1: Volume Ducking During Calls (Interim Solution)

The quickest win. When a video call connects on the TV side, lower the TV speaker volume to 10-15%. When the call ends, restore the previous volume. This alone eliminates most echo because the mic barely picks up audio at low volume.

**Files:**
- Create: `backend/src/1_adapters/device/HomeAssistantVolumeAdapter.mjs`
- Modify: `backend/src/4_api/v1/routers/device.mjs` (add volume endpoint)
- Modify: `frontend/src/modules/Input/VideoCall.jsx:100-110` (call volume API on connect/disconnect)
- Modify: `frontend/src/modules/Input/hooks/useNativeAudioBridge.js` (no changes needed — volume is separate concern)

### Step 1: Check existing device router for volume patterns

Read: `backend/src/4_api/v1/routers/device.mjs`

Understand how device commands are dispatched. The device config already has `volume_script: script.living_room_tv_volume` under `device_control.displays.tv`. The router likely already has `/device/:id/on` and `/device/:id/off` patterns we can follow.

### Step 2: Write the volume adapter

Create `backend/src/1_adapters/device/HomeAssistantVolumeAdapter.mjs`:

```javascript
import { HomeAssistantClient } from '../homeassistant/HomeAssistantClient.mjs';

/**
 * Controls TV volume via Home Assistant scripts.
 * Scripts are defined in devices.yml under device_control.displays.tv.volume_script
 */
export class HomeAssistantVolumeAdapter {
  #haClient;

  constructor(haClient) {
    this.#haClient = haClient;
  }

  /**
   * Set TV volume by calling the HA script with a volume_level variable.
   * @param {string} scriptEntityId - e.g. 'script.living_room_tv_volume'
   * @param {number} volumeLevel - 0.0 to 1.0
   */
  async setVolume(scriptEntityId, volumeLevel) {
    await this.#haClient.callService('script', 'turn_on', {
      entity_id: scriptEntityId,
      variables: { volume_level: volumeLevel },
    });
  }
}
```

### Step 3: Add volume endpoint to device router

Add `POST /api/v1/device/:id/volume` to the device router. It should:
1. Look up the device config by ID
2. Find the `volume_script` in `device_control.displays.tv`
3. Call the HA script with the requested volume level
4. Return 200 OK

```javascript
router.post('/:id/volume', async (req, res) => {
  const { id } = req.params;
  const { level } = req.body; // 0.0 - 1.0
  const deviceConfig = configService.getHouseholdDevices()?.[id];
  const volumeScript = deviceConfig?.device_control?.displays?.tv?.volume_script;
  if (!volumeScript) return res.status(404).json({ error: 'No volume script configured' });
  await volumeAdapter.setVolume(volumeScript, level);
  res.json({ ok: true });
});
```

### Step 4: Wire volume ducking into VideoCall.jsx (TV side)

In `frontend/src/modules/Input/VideoCall.jsx`, add volume ducking when `peerConnected` changes:

```javascript
// Volume ducking during calls — reduce echo by lowering TV speakers
const DUCK_VOLUME = 0.12; // 12% — just audible for ambient awareness
const NORMAL_VOLUME = 0.5; // 50% — restored after call

useEffect(() => {
  if (!peerConnected || !deviceId) return;

  // Duck volume when call connects
  logger.info('volume-duck', { deviceId, level: DUCK_VOLUME });
  DaylightAPI(`/api/v1/device/${deviceId}/volume`, {
    method: 'POST',
    body: JSON.stringify({ level: DUCK_VOLUME }),
  }).catch(err => logger.warn('volume-duck-failed', { error: err.message }));

  // Restore on disconnect
  return () => {
    logger.info('volume-restore', { deviceId, level: NORMAL_VOLUME });
    DaylightAPI(`/api/v1/device/${deviceId}/volume`, {
      method: 'POST',
      body: JSON.stringify({ level: NORMAL_VOLUME }),
    }).catch(() => {});
  };
}, [peerConnected, deviceId, logger]);
```

### Step 5: Test manually

1. Start a video call to the Shield TV
2. Verify TV volume drops when call connects (speakers get quiet)
3. Verify remote caller no longer hears echo (or drastically reduced)
4. End the call — verify TV volume restores to normal
5. Test edge case: network disconnect (volume should restore via cleanup)

### Step 6: Commit

```bash
git add backend/src/1_adapters/device/HomeAssistantVolumeAdapter.mjs \
       backend/src/4_api/v1/routers/device.mjs \
       frontend/src/modules/Input/VideoCall.jsx
git commit -m "feat: volume ducking during video calls to reduce echo"
```

---

## Task 2: Refactor BridgeProcessor to Use Pre-Allocated Ring Buffer

Before adding AEC, the worklet needs a real-time-safe buffer. The current `BridgeProcessor` allocates `new Float32Array()` on every `onmessage` — this violates AudioWorklet real-time constraints and will cause glitches under load. Fix this first.

**Files:**
- Modify: `frontend/src/modules/Input/hooks/useNativeAudioBridge.js:162-212` (the inline worklet source)

### Step 1: Read the current worklet code

Read: `frontend/src/modules/Input/hooks/useNativeAudioBridge.js:162-212`

Understand the current buffer append pattern:
```javascript
// CURRENT (bad): allocates on every message
const newBuf = new Float32Array(this._buffer.length + float32.length);
newBuf.set(this._buffer);
newBuf.set(float32, this._buffer.length);
this._buffer = newBuf;
```

### Step 2: Replace with a fixed-size ring buffer

Replace the worklet source with a pre-allocated ring buffer. Size: 48000 samples (1 second at 48kHz) — more than enough for the ~10ms frame jitter.

```javascript
class BridgeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Pre-allocate ring buffer: 1 second at 48kHz
    this._ring = new Float32Array(48000);
    this._writePos = 0;
    this._readPos = 0;
    this._count = 0; // samples available

    this.port.onmessage = (e) => {
      if (e.data.pcm) {
        const int16 = new Int16Array(e.data.pcm);
        const len = int16.length;
        const ring = this._ring;
        const cap = ring.length;
        for (let i = 0; i < len; i++) {
          ring[this._writePos] = int16[i] / 32768;
          this._writePos = (this._writePos + 1) % cap;
        }
        this._count = Math.min(this._count + len, cap);
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (output.length === 0) return true;
    const channel = output[0];
    const needed = channel.length; // typically 128 samples

    const ring = this._ring;
    const cap = ring.length;
    const available = this._count;

    if (available >= needed) {
      for (let i = 0; i < needed; i++) {
        channel[i] = ring[this._readPos];
        this._readPos = (this._readPos + 1) % cap;
      }
      this._count -= needed;
    } else if (available > 0) {
      for (let i = 0; i < available; i++) {
        channel[i] = ring[this._readPos];
        this._readPos = (this._readPos + 1) % cap;
      }
      // Rest stays zero (silence)
      this._count = 0;
    }
    // else: output stays zero-filled (silence)

    // Compute RMS for volume metering
    let sum = 0;
    for (let i = 0; i < channel.length; i++) {
      sum += channel[i] * channel[i];
    }
    const rms = Math.sqrt(sum / channel.length);
    this.port.postMessage({ rms });

    return true;
  }
}
registerProcessor('bridge-processor', BridgeProcessor);
```

### Step 3: Test manually

1. Start a video call — verify audio still flows through the bridge
2. Verify volume meter still updates
3. No audio glitches or clicks during sustained call

### Step 4: Commit

```bash
git add frontend/src/modules/Input/hooks/useNativeAudioBridge.js
git commit -m "refactor: pre-allocated ring buffer in BridgeProcessor worklet"
```

---

## Task 3: Reference Signal Plumbing

Wire the remote caller's audio into the BridgeProcessor worklet as a second input. This is the "far-end reference" that the AEC algorithm will use to identify and subtract echo. No AEC processing yet — just verify the reference frames arrive and are time-aligned.

**Files:**
- Modify: `frontend/src/modules/Input/VideoCall.jsx` (tap remote audio, send to worklet)
- Modify: `frontend/src/modules/Input/hooks/useNativeAudioBridge.js` (accept ref frames in worklet, expose worklet port)

### Step 1: Expose the worklet's MessagePort from the hook

The `useNativeAudioBridge` hook currently hides the worklet node. The VideoCall component needs access to send reference audio frames. Add a `workletPort` to the hook's return value:

In `useNativeAudioBridge.js`, add a ref for the worklet port and return it:

```javascript
const workletPortRef = useRef(null);

// Inside setupAudioPipeline, after creating workletNode:
workletPortRef.current = workletNode.port;

// In cleanup:
workletPortRef.current = null;

// Return:
return { stream, volume, status, workletPort: workletPortRef.current };
```

### Step 2: Accept reference frames in BridgeProcessor worklet

Extend the worklet to receive `{ ref: ArrayBuffer }` messages and store them in a second ring buffer:

```javascript
// Add to constructor:
this._refRing = new Float32Array(48000);
this._refWritePos = 0;
this._refReadPos = 0;
this._refCount = 0;

// Add to port.onmessage:
if (e.data.ref) {
  const float32 = new Float32Array(e.data.ref);
  const len = float32.length;
  const ring = this._refRing;
  const cap = ring.length;
  for (let i = 0; i < len; i++) {
    ring[this._refWritePos] = float32[i];
    this._refWritePos = (this._refWritePos + 1) % cap;
  }
  this._refCount = Math.min(this._refCount + len, cap);
}
```

For now, `process()` doesn't use the ref buffer — it just accumulates for alignment verification. In Task 5 we'll feed it to the AEC.

### Step 3: Tap remote audio in VideoCall.jsx and forward to worklet

In `VideoCall.jsx`, after `peer.remoteStream` is available and the bridge is connected, create a `ScriptProcessorNode` (or a second AudioWorklet) to extract PCM samples from the remote audio and send them to the bridge worklet via its port:

```javascript
// Reference signal tap — send remote audio to bridge worklet for AEC
const refTapRef = useRef(null);

useEffect(() => {
  const remoteStream = peer.remoteStream;
  const workletPort = bridge.workletPort;
  if (!remoteStream || !workletPort || !bridgeActive) return;

  const audioTracks = remoteStream.getAudioTracks();
  if (audioTracks.length === 0) return;

  const ctx = new AudioContext({ sampleRate: 48000 });
  const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));

  // Use a small ScriptProcessor to extract PCM frames and forward to worklet.
  // ScriptProcessorNode is deprecated but works everywhere; an AudioWorklet
  // alternative would require a second worklet module.
  const processor = ctx.createScriptProcessor(512, 1, 1);
  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    // Transfer a copy to the bridge worklet
    const copy = new Float32Array(input.length);
    copy.set(input);
    workletPort.postMessage({ ref: copy.buffer }, [copy.buffer]);
  };

  source.connect(processor);
  processor.connect(ctx.destination); // Required for ScriptProcessor to fire

  // Mute the ScriptProcessor output to avoid double-playing remote audio
  const muteGain = ctx.createGain();
  muteGain.gain.value = 0;
  processor.disconnect();
  source.connect(processor);
  processor.connect(muteGain);
  muteGain.connect(ctx.destination);

  logger.info('aec-ref-tap-started', { audioTracks: audioTracks.length });

  refTapRef.current = { ctx, source, processor, muteGain };

  return () => {
    processor.onaudioprocess = null;
    source.disconnect();
    processor.disconnect();
    muteGain.disconnect();
    ctx.close().catch(() => {});
    refTapRef.current = null;
    logger.info('aec-ref-tap-stopped');
  };
}, [peer.remoteStream, bridge.workletPort, bridgeActive, logger]);
```

### Step 4: Add debug logging to verify alignment

Add a sampled log inside the worklet's `process()` to report both buffer levels:

```javascript
// Inside process(), after RMS calculation:
if (this._frameCount % 500 === 0) {
  this.port.postMessage({
    rms,
    debug: {
      micBuffered: this._count,
      refBuffered: this._refCount,
    }
  });
}
this._frameCount = (this._frameCount || 0) + 1;
```

In the hook's `port.onmessage`, log the debug data:

```javascript
if (e.data.debug) {
  logger().sampled('bridge-buffer-levels', e.data.debug, { maxPerMinute: 6 });
}
```

### Step 5: Test manually

1. Start a video call
2. Check browser console for `bridge-buffer-levels` logs
3. Verify `refBuffered` > 0 when the remote caller speaks
4. Verify `micBuffered` stays positive (mic frames still flowing)
5. Call quality should be unchanged (ref signal is just buffered, not processed)

### Step 6: Commit

```bash
git add frontend/src/modules/Input/hooks/useNativeAudioBridge.js \
       frontend/src/modules/Input/VideoCall.jsx
git commit -m "feat: reference signal plumbing for AEC — tap remote audio into worklet"
```

---

## Task 4: Build Speex AEC as WebAssembly Module

Compile `libspeexdsp`'s echo cancellation to a self-contained WASM module using Emscripten. The output must work inside an AudioWorklet (no external imports, self-contained binary).

**Files:**
- Create: `frontend/src/lib/audio/build-speex-aec.sh` (Emscripten build script)
- Create: `frontend/src/lib/audio/speex_aec.js` (compiled output — WASM embedded as base64)
- Create: `frontend/src/lib/audio/SpeexAEC.js` (JS wrapper class)

### Step 1: Install Emscripten (if not present)

```bash
# Check if emcc is available
which emcc || echo "Install Emscripten: https://emscripten.org/docs/getting_started/downloads.html"

# On macOS:
# brew install emscripten
# Or: git clone https://github.com/emscripten-core/emsdk.git && cd emsdk && ./emsdk install latest && ./emsdk activate latest
```

### Step 2: Get libspeexdsp source

```bash
mkdir -p frontend/src/lib/audio/vendor
cd frontend/src/lib/audio/vendor
git clone https://gitlab.xiph.org/xiph/speexdsp.git --depth 1
```

### Step 3: Write the Emscripten build script

Create `frontend/src/lib/audio/build-speex-aec.sh`:

```bash
#!/bin/bash
set -e

VENDOR_DIR="$(dirname "$0")/vendor/speexdsp"
OUT_DIR="$(dirname "$0")"

# Source files needed for echo cancellation only
SOURCES=(
  "$VENDOR_DIR/libspeexdsp/mdf.c"        # Main AEC (MDF = multi-delay filter)
  "$VENDOR_DIR/libspeexdsp/preprocess.c"  # Preprocessor (needed by mdf.c)
  "$VENDOR_DIR/libspeexdsp/kiss_fft.c"    # FFT
  "$VENDOR_DIR/libspeexdsp/kiss_fftr.c"   # Real FFT wrapper
  "$VENDOR_DIR/libspeexdsp/fftwrap.c"     # FFT wrapper layer
  "$VENDOR_DIR/libspeexdsp/filterbank.c"  # Filter bank (needed by preprocess)
  "$VENDOR_DIR/libspeexdsp/buffer.c"      # Ring buffer utilities
)

INCLUDES="-I$VENDOR_DIR/include -I$VENDOR_DIR/libspeexdsp"

# Compile to single-file WASM (base64-embedded in JS)
emcc -O2 \
  -s WASM=1 \
  -s SINGLE_FILE=1 \
  -s EXPORTED_FUNCTIONS="[ \
    '_speex_echo_state_init', \
    '_speex_echo_cancellation', \
    '_speex_echo_state_destroy', \
    '_speex_echo_ctl', \
    '_malloc', \
    '_free' \
  ]" \
  -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','getValue','setValue','HEAPF32','HEAP16']" \
  -s INITIAL_MEMORY=1048576 \
  -s ALLOW_MEMORY_GROWTH=0 \
  -s ENVIRONMENT='worker' \
  -s MODULARIZE=1 \
  -s EXPORT_NAME='SpeexModule' \
  -DFLOATING_POINT \
  -DUSE_KISS_FFT \
  -DEXPORT="" \
  $INCLUDES \
  ${SOURCES[@]} \
  -o "$OUT_DIR/speex_aec.js"

echo "Built: $OUT_DIR/speex_aec.js ($(wc -c < "$OUT_DIR/speex_aec.js") bytes)"
```

Key flags:
- `-s SINGLE_FILE=1` — Embeds WASM binary as base64 in the JS file. Required for AudioWorklet scope (can't fetch external files).
- `-s INITIAL_MEMORY=1048576` — 1MB fixed allocation. No growth = no GC pauses.
- `-s ENVIRONMENT='worker'` — AudioWorklet runs in a worker-like context.
- `-s MODULARIZE=1` — Exports a factory function, not a global.
- `-DFLOATING_POINT` — Use float32 processing (matches our PCM pipeline).

### Step 4: Run the build

```bash
chmod +x frontend/src/lib/audio/build-speex-aec.sh
./frontend/src/lib/audio/build-speex-aec.sh
```

Verify the output exists and is reasonable size (~50-80KB):
```bash
ls -la frontend/src/lib/audio/speex_aec.js
```

### Step 5: Write the JS wrapper class

Create `frontend/src/lib/audio/SpeexAEC.js`:

```javascript
/**
 * JS wrapper around the Speex AEC WASM module.
 * Designed to run inside an AudioWorklet.
 *
 * Usage:
 *   const aec = await SpeexAEC.create({ sampleRate: 48000, frameSize: 480, filterLength: 4800 });
 *   const cleanFrame = aec.cancel(micFrame, refFrame); // Float32Array
 *   aec.destroy();
 */
export class SpeexAEC {
  #module;
  #state;
  #frameSize;
  #micPtr;
  #refPtr;
  #outPtr;

  static async create({ sampleRate = 48000, frameSize = 480, filterLength = 4800 } = {}) {
    // SpeexModule is the Emscripten factory from speex_aec.js
    // It must be imported/evaluated in the calling scope before calling create()
    const mod = await SpeexModule();

    const aec = new SpeexAEC();
    aec.#module = mod;
    aec.#frameSize = frameSize;

    // Speex echo state: speex_echo_state_init(frame_size, filter_length)
    aec.#state = mod._speex_echo_state_init(frameSize, filterLength);

    // Set sample rate via speex_echo_ctl
    // SPEEX_ECHO_SET_SAMPLING_RATE = 24
    const srPtr = mod._malloc(4);
    mod.setValue(srPtr, sampleRate, 'i32');
    mod._speex_echo_ctl(aec.#state, 24, srPtr);
    mod._free(srPtr);

    // Pre-allocate buffers for mic input, ref input, and clean output
    // Speex expects spx_int16_t* (16-bit signed), so 2 bytes per sample
    aec.#micPtr = mod._malloc(frameSize * 2);
    aec.#refPtr = mod._malloc(frameSize * 2);
    aec.#outPtr = mod._malloc(frameSize * 2);

    return aec;
  }

  /**
   * Process one frame: cancel echo from mic using ref.
   * @param {Float32Array} micFrame - microphone input (float32, -1 to 1)
   * @param {Float32Array} refFrame - far-end reference (float32, -1 to 1)
   * @returns {Float32Array} clean output (float32, -1 to 1)
   */
  cancel(micFrame, refFrame) {
    const mod = this.#module;
    const fs = this.#frameSize;

    // Convert float32 → int16 and copy to WASM heap
    for (let i = 0; i < fs; i++) {
      mod.HEAP16[(this.#micPtr >> 1) + i] = Math.max(-32768, Math.min(32767, micFrame[i] * 32768));
      mod.HEAP16[(this.#refPtr >> 1) + i] = Math.max(-32768, Math.min(32767, refFrame[i] * 32768));
    }

    // speex_echo_cancellation(state, mic, ref, out)
    mod._speex_echo_cancellation(this.#state, this.#micPtr, this.#refPtr, this.#outPtr);

    // Convert int16 output → float32
    const out = new Float32Array(fs);
    for (let i = 0; i < fs; i++) {
      out[i] = mod.HEAP16[(this.#outPtr >> 1) + i] / 32768;
    }
    return out;
  }

  destroy() {
    if (this.#state) {
      this.#module._speex_echo_state_destroy(this.#state);
      this.#module._free(this.#micPtr);
      this.#module._free(this.#refPtr);
      this.#module._free(this.#outPtr);
      this.#state = null;
    }
  }
}
```

### Step 6: Test the WASM module standalone (Node.js)

Create a quick smoke test to verify the module loads and processes a frame without crashing:

```bash
# Quick test — run from project root
node -e "
  const { readFileSync } = require('fs');
  // The SINGLE_FILE build embeds WASM as base64 — can be loaded in Node
  eval(readFileSync('frontend/src/lib/audio/speex_aec.js', 'utf-8'));
  SpeexModule().then(mod => {
    const state = mod._speex_echo_state_init(480, 4800);
    console.log('state ptr:', state);
    mod._speex_echo_state_destroy(state);
    console.log('Speex AEC WASM: OK');
  });
"
```

### Step 7: Commit

```bash
git add frontend/src/lib/audio/build-speex-aec.sh \
       frontend/src/lib/audio/speex_aec.js \
       frontend/src/lib/audio/SpeexAEC.js
# Do NOT commit vendor/speexdsp — add to .gitignore
echo "frontend/src/lib/audio/vendor/" >> .gitignore
git add .gitignore
git commit -m "feat: Speex AEC compiled to WASM for AudioWorklet echo cancellation"
```

---

## Task 5: Integrate AEC Into BridgeProcessor Worklet

Connect the Speex AEC WASM module into the worklet's `process()` loop. Mic and reference frames are already buffered (Task 2-3). Now extract aligned frames, run AEC, and output the cleaned audio.

**Files:**
- Modify: `frontend/src/modules/Input/hooks/useNativeAudioBridge.js` (worklet source + WASM loading)

### Step 1: Load the Speex WASM module inside the worklet

The worklet runs in an isolated scope. The WASM module (built with `SINGLE_FILE=1`) must be loaded within this scope. Strategy: include the compiled `speex_aec.js` content as a string alongside the worklet source, so both are in the same blob URL.

Modify `setupAudioPipeline()` in `useNativeAudioBridge.js`:

```javascript
// Load Speex WASM source
const speexSource = await fetch(new URL('../../lib/audio/speex_aec.js', import.meta.url)).then(r => r.text());

const processorSource = `
${speexSource}

class BridgeProcessor extends AudioWorkletProcessor {
  // ... (see Step 2)
}
registerProcessor('bridge-processor', BridgeProcessor);
`;
```

### Step 2: Rewrite BridgeProcessor with AEC processing

The worklet now:
1. Initializes Speex AEC state on first process call (lazy init — WASM needs async instantiation via constructor message)
2. Extracts 480-sample frames from both mic and ref ring buffers
3. Runs `speex_echo_cancellation()` on aligned frame pairs
4. Outputs the clean frame

```javascript
class BridgeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Ring buffers (pre-allocated)
    this._micRing = new Float32Array(48000);
    this._micW = 0; this._micR = 0; this._micN = 0;
    this._refRing = new Float32Array(48000);
    this._refW = 0; this._refR = 0; this._refN = 0;

    // AEC state (initialized asynchronously)
    this._aec = null;
    this._aecReady = false;
    this._aecFrameSize = 480; // 10ms at 48kHz
    this._micFrame = new Float32Array(480);
    this._refFrame = new Float32Array(480);
    this._outFrame = new Float32Array(480);
    this._outRing = new Float32Array(48000);
    this._outW = 0; this._outR = 0; this._outN = 0;

    this._frameCount = 0;

    // Init AEC asynchronously
    this._initAEC();

    this.port.onmessage = (e) => {
      if (e.data.pcm) {
        // Mic PCM (Int16 from native bridge)
        const int16 = new Int16Array(e.data.pcm);
        const len = int16.length;
        const ring = this._micRing;
        const cap = ring.length;
        for (let i = 0; i < len; i++) {
          ring[this._micW] = int16[i] / 32768;
          this._micW = (this._micW + 1) % cap;
        }
        this._micN = Math.min(this._micN + len, cap);
      }
      if (e.data.ref) {
        // Reference audio (Float32 from remote stream tap)
        const float32 = new Float32Array(e.data.ref);
        const len = float32.length;
        const ring = this._refRing;
        const cap = ring.length;
        for (let i = 0; i < len; i++) {
          ring[this._refW] = float32[i];
          this._refW = (this._refW + 1) % cap;
        }
        this._refN = Math.min(this._refN + len, cap);
      }
    };
  }

  async _initAEC() {
    try {
      const mod = await SpeexModule();
      this._mod = mod;
      this._state = mod._speex_echo_state_init(480, 4800);

      // Set sample rate
      const srPtr = mod._malloc(4);
      mod.setValue(srPtr, 48000, 'i32');
      mod._speex_echo_ctl(this._state, 24, srPtr);
      mod._free(srPtr);

      // Pre-allocate WASM heap buffers
      this._micPtr = mod._malloc(480 * 2);
      this._refPtr = mod._malloc(480 * 2);
      this._outPtr = mod._malloc(480 * 2);

      this._aecReady = true;
      this.port.postMessage({ aecStatus: 'ready' });
    } catch (err) {
      this.port.postMessage({ aecStatus: 'failed', error: err.message });
    }
  }

  _readRing(ring, readPos, count, dest, n) {
    const cap = ring.length;
    for (let i = 0; i < n; i++) {
      dest[i] = ring[readPos];
      readPos = (readPos + 1) % cap;
    }
    return readPos;
  }

  _processAEC() {
    const fs = this._aecFrameSize;
    // Need both mic and ref frames to process
    if (this._micN < fs || this._refN < fs) return;

    while (this._micN >= fs && this._refN >= fs) {
      // Read aligned frames
      this._micR = this._readRing(this._micRing, this._micR, this._micN, this._micFrame, fs);
      this._micN -= fs;
      this._refR = this._readRing(this._refRing, this._refR, this._refN, this._refFrame, fs);
      this._refN -= fs;

      // Run Speex AEC
      const mod = this._mod;
      for (let i = 0; i < fs; i++) {
        mod.HEAP16[(this._micPtr >> 1) + i] = Math.max(-32768, Math.min(32767, this._micFrame[i] * 32768));
        mod.HEAP16[(this._refPtr >> 1) + i] = Math.max(-32768, Math.min(32767, this._refFrame[i] * 32768));
      }
      mod._speex_echo_cancellation(this._state, this._micPtr, this._refPtr, this._outPtr);

      // Write clean output to output ring
      const outRing = this._outRing;
      const cap = outRing.length;
      for (let i = 0; i < fs; i++) {
        outRing[this._outW] = mod.HEAP16[(this._outPtr >> 1) + i] / 32768;
        this._outW = (this._outW + 1) % cap;
      }
      this._outN += fs;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (output.length === 0) return true;
    const channel = output[0];
    const needed = channel.length;

    if (this._aecReady && this._refN > 0) {
      // AEC mode: process mic+ref → clean output
      this._processAEC();

      if (this._outN >= needed) {
        const ring = this._outRing;
        const cap = ring.length;
        for (let i = 0; i < needed; i++) {
          channel[i] = ring[this._outR];
          this._outR = (this._outR + 1) % cap;
        }
        this._outN -= needed;
      } else {
        // Not enough processed output yet — output silence
        channel.fill(0);
      }
    } else {
      // Passthrough mode: no AEC (no ref signal or AEC not ready)
      const ring = this._micRing;
      const cap = ring.length;
      if (this._micN >= needed) {
        for (let i = 0; i < needed; i++) {
          channel[i] = ring[this._micR];
          this._micR = (this._micR + 1) % cap;
        }
        this._micN -= needed;
      } else if (this._micN > 0) {
        const avail = this._micN;
        for (let i = 0; i < avail; i++) {
          channel[i] = ring[this._micR];
          this._micR = (this._micR + 1) % cap;
        }
        this._micN = 0;
      }
    }

    // RMS volume metering
    let sum = 0;
    for (let i = 0; i < channel.length; i++) {
      sum += channel[i] * channel[i];
    }
    const rms = Math.sqrt(sum / channel.length);

    // Sampled debug logging
    this._frameCount++;
    if (this._frameCount % 500 === 0) {
      this.port.postMessage({
        rms,
        debug: {
          micBuffered: this._micN,
          refBuffered: this._refN,
          outBuffered: this._outN,
          aecReady: this._aecReady,
        }
      });
    } else {
      this.port.postMessage({ rms });
    }

    return true;
  }
}
```

### Step 3: Handle AEC status messages in the hook

In `useNativeAudioBridge.js`, add handling for the `aecStatus` message from the worklet:

```javascript
workletNode.port.onmessage = (e) => {
  if (e.data.rms !== undefined) {
    setVolume(e.data.rms);
    // ... existing sampled logging
  }
  if (e.data.aecStatus) {
    logger().info('bridge-aec-status', { status: e.data.aecStatus, error: e.data.error });
  }
  if (e.data.debug) {
    logger().sampled('bridge-buffer-levels', e.data.debug, { maxPerMinute: 6 });
  }
};
```

### Step 4: Test manually

1. Start a video call to the Shield TV
2. Check logs for `bridge-aec-status: ready` — WASM loaded in worklet
3. Check logs for `bridge-buffer-levels` — both mic and ref buffers filling
4. Have the remote caller speak — verify the TV's outgoing audio no longer echoes
5. Verify the local speaker still hears the remote caller normally
6. Test convergence: echo should diminish within 1-3 seconds of call start

### Step 5: Commit

```bash
git add frontend/src/modules/Input/hooks/useNativeAudioBridge.js
git commit -m "feat: Speex AEC echo cancellation in BridgeProcessor AudioWorklet"
```

---

## Task 6: AEC Configuration in devices.yml

Add AEC configuration to the device config so it can be enabled/disabled per-device and tuned without code changes.

**Files:**
- Modify: `data/household/config/devices.yml` (add AEC config)
- Modify: `frontend/src/modules/Input/VideoCall.jsx` (pass AEC config to hook)
- Modify: `frontend/src/modules/Input/hooks/useNativeAudioBridge.js` (respect AEC config)

### Step 1: Add AEC config to devices.yml

Under `livingroom-tv.input.audio_bridge`, add:

```yaml
audio_bridge:
  url: ws://localhost:8765
  mode: fallback
  gain: 1
  aec:
    enabled: true
    filter_length: 4800    # 100ms at 48kHz — covers typical room echo
    frame_size: 480        # 10ms frames
```

### Step 2: Pass AEC config through to the hook

In `VideoCall.jsx`, the `audioBridgeConfig` already flows to `useNativeAudioBridge`. The hook needs to forward the `aec` sub-config to the worklet.

In `useNativeAudioBridge.js`, modify the config destructure:

```javascript
const { enabled = false, url, gain = 2, aec = {} } = config;
```

Pass AEC config to the worklet via a message after initialization:

```javascript
workletNode.port.postMessage({
  aecConfig: {
    enabled: aec.enabled !== false,  // default true if aec key exists
    filterLength: aec.filter_length || 4800,
    frameSize: aec.frame_size || 480,
  }
});
```

### Step 3: Respect config in the worklet

Add a config message handler in BridgeProcessor:

```javascript
// In port.onmessage:
if (e.data.aecConfig) {
  this._aecEnabled = e.data.aecConfig.enabled;
  if (this._aecEnabled) {
    this._aecFrameSize = e.data.aecConfig.frameSize;
    // Re-init AEC if filter length changed
    this._initAEC(e.data.aecConfig);
  }
}
```

In `process()`, check `this._aecEnabled` before running AEC.

### Step 4: Test config-driven disable

1. Set `aec.enabled: false` in devices.yml
2. Restart the dev server (config loads at startup)
3. Start a video call — verify AEC is NOT running (passthrough mode)
4. Set `aec.enabled: true`, restart, verify AEC activates

### Step 5: Commit

```bash
git add frontend/src/modules/Input/hooks/useNativeAudioBridge.js \
       frontend/src/modules/Input/VideoCall.jsx
# devices.yml is in Dropbox — commit a reference update to docs
git commit -m "feat: config-driven AEC enable/disable and filter tuning"
```

---

## Task 7: Runtime Degradation Monitoring

Monitor worklet processing time and automatically disable AEC if the device can't keep up with the real-time budget (10ms per frame).

**Files:**
- Modify: `frontend/src/modules/Input/hooks/useNativeAudioBridge.js` (worklet source — add timing)

### Step 1: Add processing time measurement to the worklet

Inside `process()`, measure elapsed time:

```javascript
process(inputs, outputs) {
  const t0 = performance.now !== undefined ? performance.now() : currentTime * 1000;

  // ... existing processing ...

  const elapsed = (performance.now !== undefined ? performance.now() : currentTime * 1000) - t0;

  // Track overruns (>8ms = dangerously close to 10ms budget)
  if (elapsed > 8) {
    this._overrunCount = (this._overrunCount || 0) + 1;
  }

  // If >10 overruns in 100 frames, disable AEC
  if (this._frameCount % 100 === 0) {
    if (this._overrunCount > 10) {
      this._aecEnabled = false;
      this.port.postMessage({
        aecStatus: 'degraded',
        reason: `${this._overrunCount} overruns in last 100 frames`,
      });
    }
    this._overrunCount = 0;
  }

  // ... existing RMS/debug logging with elapsed added ...
  if (this._frameCount % 500 === 0) {
    this.port.postMessage({
      rms,
      debug: {
        micBuffered: this._micN,
        refBuffered: this._refN,
        outBuffered: this._outN,
        aecReady: this._aecReady,
        aecEnabled: this._aecEnabled,
        lastElapsedMs: elapsed.toFixed(2),
      }
    });
  }

  return true;
}
```

### Step 2: Log degradation events in the hook

```javascript
if (e.data.aecStatus === 'degraded') {
  logger().warn('bridge-aec-degraded', { reason: e.data.reason });
}
```

### Step 3: Commit

```bash
git add frontend/src/modules/Input/hooks/useNativeAudioBridge.js
git commit -m "feat: runtime AEC degradation monitoring with auto-disable"
```

---

## Task 8: Update Documentation

Update project docs to reflect the new AEC pipeline and volume ducking.

**Files:**
- Modify: `_extensions/audio-bridge/DESIGN.md` (add AEC section)
- Modify: `docs/roadmap/2026-02-23-software-aec-audio-bridge.md` (update status)

### Step 1: Add AEC section to AudioBridge DESIGN.md

Add a new section documenting:
- The AEC pipeline (reference signal tap → Speex WASM → clean output)
- Configuration options in devices.yml
- Runtime degradation behavior
- Volume ducking as the primary mitigation

### Step 2: Update roadmap status

Change status from "Design / Research" to "Implemented" and note the implementation date.

### Step 3: Commit

```bash
git add _extensions/audio-bridge/DESIGN.md \
       docs/roadmap/2026-02-23-software-aec-audio-bridge.md
git commit -m "docs: update AudioBridge design doc and roadmap for AEC implementation"
```

---

## Dependency Order

```
Task 1 (Volume Ducking) ─── standalone, immediate value
Task 2 (Ring Buffer Refactor) ─── prerequisite for AEC
Task 3 (Reference Signal Plumbing) ─── depends on Task 2
Task 4 (Speex WASM Build) ─── independent of Tasks 2-3
Task 5 (Worklet AEC Integration) ─── depends on Tasks 2, 3, 4
Task 6 (Config) ─── depends on Task 5
Task 7 (Degradation Monitoring) ─── depends on Task 5
Task 8 (Docs) ─── depends on all above
```

Tasks 1, 2, and 4 can proceed in parallel. Task 3 needs Task 2. Task 5 needs Tasks 2+3+4. Tasks 6 and 7 can proceed in parallel after Task 5.
