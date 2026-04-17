# useAudioRecorder — AudioBridge Migration

**Date:** April 4, 2026  
**File to change:** `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js`  
**Why:** On the Shield TV (Fully Kiosk Browser), `getUserMedia({ audio: true })` routes to
`AUDIO_SOURCE_CAMCORDER` → phantom built-in mic → **silence**. The USB microphone is only
reachable via a native Android sideload (`AudioBridgeService`, always running on the Shield)
that streams raw PCM over a local WebSocket at `ws://localhost:8765`.

**Strategy:** Try AudioBridge first. If it connects within ~1.5s, use its `MediaStream` with
the existing `MediaRecorder` machinery. If it fails (not on Shield, or app not running), fall
through to `getUserMedia` as normal. No config flags, no platform detection — the WebSocket
connection attempt is the probe.

---

## What Already Exists

`useNativeAudioBridge` (`frontend/src/modules/Input/hooks/useNativeAudioBridge.js`) already
does all the hard work:

- Connects to `ws://localhost:8765`
- Parses the format header: `{"sampleRate":48000,"channels":1,"format":"pcm_s16le"}`
- Builds an AudioContext → AudioWorklet → `createMediaStreamDestination()` pipeline
- Returns `{ stream: MediaStream|null, volume: number, status: string }`

`status` values relevant here:
| Status | Meaning |
|--------|---------|
| `connecting` | WebSocket open in progress |
| `connected` | PCM flowing, `stream` is ready |
| `unavailable` | Connection refused (not on Shield) — fall back |
| `disconnected` | Connected then dropped — retry (handled internally) |

The returned `stream` is a real `MediaStream` with an audio track. You can pass it directly
to `new MediaRecorder(stream, { mimeType: 'audio/webm' })` — no changes to the recording
or blob-to-base64 path needed.

---

## Implementation Plan

### 1. Add a bridge probe helper inside `useAudioRecorder.js`

Add this function at the top of the file (outside the hook):

```js
const BRIDGE_URL = 'ws://localhost:8765';
const BRIDGE_TIMEOUT_MS = 1500;

/**
 * Attempt to get a MediaStream from the native AudioBridge.
 * Resolves with a MediaStream if the bridge connects and starts sending PCM.
 * Rejects if connection fails or times out — caller should fall back to getUserMedia.
 */
function getBridgeStream() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('AudioBridge timeout'));
    }, BRIDGE_TIMEOUT_MS);

    const ws = new WebSocket(BRIDGE_URL);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      // Connected — wait for format header, then build the audio pipeline
    };

    ws.onmessage = async (event) => {
      if (typeof event.data !== 'string') return;
      clearTimeout(timeout);

      let format;
      try {
        format = JSON.parse(event.data);
      } catch {
        ws.close();
        return reject(new Error('AudioBridge bad header'));
      }

      if (format.error) {
        ws.close();
        return reject(new Error(`AudioBridge error: ${format.error}`));
      }

      // Build AudioContext → Worklet → MediaStreamDestination
      try {
        const stream = await buildBridgeStream(ws, format);
        resolve(stream);
      } catch (err) {
        ws.close();
        reject(err);
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('AudioBridge unavailable'));
    };

    ws.onclose = (e) => {
      if (e.code !== 1000) {
        clearTimeout(timeout);
        reject(new Error('AudioBridge closed'));
      }
    };
  });
}
```

### 2. Add `buildBridgeStream` — the PCM-to-MediaStream pipeline

This is a condensed version of what `useNativeAudioBridge` does internally, but as a one-shot
async function that returns a `MediaStream` (and keeps the WebSocket open for the duration of
the recording). The caller is responsible for closing the WebSocket and AudioContext when
recording stops.

```js
async function buildBridgeStream(ws, format) {
  const sampleRate = format.sampleRate || 48000;
  const ctx = new AudioContext({ sampleRate });

  if (ctx.state === 'suspended') await ctx.resume();

  // Inline worklet — same BridgeProcessor used in useNativeAudioBridge.js
  // Ring buffer: receives Int16 PCM chunks via MessagePort, outputs Float32.
  const processorSource = `
class BridgeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ring = new Float32Array(${sampleRate}); // 1s buffer
    this._writePos = 0;
    this._readPos = 0;
    this._count = 0;
    this.port.onmessage = (e) => {
      if (!e.data) return;
      const int16 = new Int16Array(e.data);
      const cap = this._ring.length;
      for (let i = 0; i < int16.length; i++) {
        this._ring[this._writePos] = int16[i] / 32768;
        this._writePos = (this._writePos + 1) % cap;
      }
      this._count = Math.min(this._count + int16.length, cap);
    };
  }
  process(inputs, outputs) {
    const ch = outputs[0][0];
    if (!ch) return true;
    const needed = ch.length;
    const cap = this._ring.length;
    const avail = Math.min(this._count, needed);
    for (let i = 0; i < avail; i++) {
      ch[i] = this._ring[this._readPos];
      this._readPos = (this._readPos + 1) % cap;
    }
    this._count -= avail;
    return true;
  }
}
registerProcessor('bridge-recorder-processor', BridgeProcessor);`;

  const blob = new Blob([processorSource], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }

  const workletNode = new AudioWorkletNode(ctx, 'bridge-recorder-processor');
  const destination = ctx.createMediaStreamDestination();
  workletNode.connect(destination);

  // Forward incoming PCM frames from WebSocket into the worklet
  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      workletNode.port.postMessage(event.data, [event.data]);
    }
  };

  // Attach ctx and workletNode to the stream so the caller can clean them up
  const stream = destination.stream;
  stream._bridgeCtx = ctx;
  stream._bridgeWorklet = workletNode;
  stream._bridgeWs = ws;

  return stream;
}
```

### 3. Modify `startRecording` in `useAudioRecorder.js`

Replace the single `getUserMedia` call with a try-bridge-first pattern. The rest of the
function (MediaRecorder setup, level monitor, timers) stays **exactly the same**.

```js
// BEFORE:
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

// AFTER:
let stream;
let usingBridge = false;

try {
  logger.debug('recorder.trying-bridge');
  stream = await getBridgeStream();
  usingBridge = true;
  logger.info('recorder.bridge-acquired');
} catch (bridgeErr) {
  logger.info('recorder.bridge-unavailable', { reason: bridgeErr.message });
  logger.debug('recorder.requesting-mic');
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
}
streamRef.current = stream;
```

No other changes to `startRecording` are needed. `MediaRecorder`, `startLevelMonitor`,
and the blob/base64 path all work identically with either stream source.

### 4. Clean up the bridge resources on stop

In the `cleanup` callback, add teardown for the bridge resources attached to the stream:

```js
const cleanup = useCallback(() => {
  logger.debug('recorder.cleanup');
  if (timerRef.current) clearInterval(timerRef.current);
  if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current);
  if (audioContextRef.current) {
    audioContextRef.current.close().catch(() => {});
    audioContextRef.current = null;
  }
  if (streamRef.current) {
    // Close AudioBridge WebSocket + AudioContext if this was a bridge stream
    if (streamRef.current._bridgeWs) {
      streamRef.current._bridgeWs.close();
    }
    if (streamRef.current._bridgeCtx) {
      streamRef.current._bridgeCtx.close().catch(() => {});
    }
    streamRef.current.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }
  analyserRef.current = null;
  mediaRecorderRef.current = null;
  peakLevelRef.current = 0;
  chunkCountRef.current = 0;
}, []);
```

---

## Notes for the Implementer

**Do not use `useNativeAudioBridge` hook directly** in `useAudioRecorder`. That hook is
designed for VideoCall's continuous streaming with AEC, retry logic, and `enabled` flags.
WeeklyReview just needs a one-shot stream for the duration of a recording. Use the standalone
`getBridgeStream()` / `buildBridgeStream()` helpers above — they're simpler and don't carry
AEC/retry overhead.

**The worklet processor name must be unique.** `useNativeAudioBridge` registers
`'bridge-processor'`. Use `'bridge-recorder-processor'` here to avoid registration conflicts
if both are loaded in the same page.

**`audio/webm` MediaRecorder output is correct** for both stream sources. The PCM→AudioContext
path produces a real `MediaStreamTrack` that MediaRecorder treats identically to a getUserMedia
track.

**FKB `microphoneAccess` is currently `false`.** This doesn't matter on Shield (bridge path
is used), but if you want the getUserMedia fallback to work on Shield too, enable it:
```bash
curl "http://10.0.0.11:2323/?cmd=setBooleanSetting&key=microphoneAccess&value=true&password=<rotated-fkb-password-urlencoded>"
```
On all non-Shield devices the fallback goes through `getUserMedia` normally — FKB is
irrelevant there.

**The three FKB conflict flags are already disabled** on the Shield (`motionDetection`,
`motionDetectionAcoustic`, `acousticScreenOn` all `false`) — AudioBridge will not be
silenced by FKB competing for the mic.

**AudioBridge is already running** on the Shield (verified April 4, 2026 — foreground
service, `isForeground=true`). The WebSocket at `ws://localhost:8765` is live.

---

## Testing

From Mac, forward the port and verify real signal before deploying:

```bash
adb forward tcp:8765 tcp:8765
python3 -c "
import asyncio, websockets, json, struct, math
async def test():
    async with websockets.connect('ws://localhost:8765') as ws:
        header = json.loads(await ws.recv())
        print('Header:', header)
        frames, total, sum_sq = 0, 0, 0.0
        while frames < 100:
            data = await ws.recv()
            samples = struct.unpack(f'<{len(data)//2}h', data)
            for s in samples: sum_sq += (s/32768)**2; total += 1
            frames += 1
        rms = math.sqrt(sum_sq/total)
        print(f'RMS: {20*math.log10(rms):.1f} dBFS  (expect ~-65 dBFS ambient)')
asyncio.run(test())
"
```

Expected: `-65 dBFS` ambient noise. If you get `-∞` (all zeros), the FKB conflict flags
have been re-enabled — check with the FKB API.

On-device: open WeeklyReview, press record, speak. The logger should show
`recorder.bridge-acquired` (not `recorder.bridge-unavailable`). If silence warning fires
within 5s, check AudioBridge logs:
```bash
adb -s 10.0.0.11:5555 logcat -s AudioBridge
```
