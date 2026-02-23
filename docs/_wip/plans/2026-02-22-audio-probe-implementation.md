# Audio Probe Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the broken RTCPeerConnection volume meter with a multi-strategy audio probe that finds a working mic + capture method on startup, providing both verified device selection and continuous volume metering.

**Architecture:** New `useAudioProbe` hook probes each audio device with three capture strategies (AudioWorklet → ScriptProcessorNode → MediaRecorder). The first device+method producing non-zero audio data wins. The hook replaces `useVolumeMeter` in `Webcam.jsx` and `VideoCall.jsx`, fixing both the volume meter and video call audio transmission.

**Tech Stack:** React hooks, Web Audio API (AudioWorklet + ScriptProcessorNode), MediaRecorder API, structured logging via `getLogger().child()`

**Design doc:** `docs/_wip/plans/2026-02-22-audio-probe-design.md`

---

### Task 1: Create Audio Probe Strategies

**Files:**
- Create: `frontend/src/modules/Input/hooks/audioProbeStrategies.js`

These are the three capture strategies, each implemented as an async function that takes a `MediaStream` and returns `{ rms: number }` or throws on timeout/unsupported. The AudioWorkletProcessor source is embedded as a Blob URL to avoid Vite build configuration.

**Step 1: Write the strategies file**

```javascript
// frontend/src/modules/Input/hooks/audioProbeStrategies.js
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'audioProbeStrategies' });
  return _logger;
}

const RMS_THRESHOLD = 0.001;

/**
 * Compute RMS from a Float32Array of PCM samples.
 */
function computeRMS(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

// ---------------------------------------------------------------------------
// Strategy 1: AudioWorklet
// ---------------------------------------------------------------------------

const WORKLET_SOURCE = `
class VolumeMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._active = true;
  }
  process(inputs) {
    if (!this._active) return false;
    const input = inputs[0];
    if (input && input.length > 0) {
      const samples = input[0];
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        sum += samples[i] * samples[i];
      }
      const rms = Math.sqrt(sum / samples.length);
      this.port.postMessage({ rms });
    }
    return true;
  }
}
registerProcessor('volume-meter-processor', VolumeMeterProcessor);
`;

let workletBlobURL = null;
function getWorkletURL() {
  if (!workletBlobURL) {
    const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
    workletBlobURL = URL.createObjectURL(blob);
  }
  return workletBlobURL;
}

/**
 * Test audio via AudioWorklet. Resolves with { rms } if audio detected,
 * or { rms: 0 } on timeout. Rejects if AudioWorklet is unsupported.
 *
 * @param {MediaStream} stream - Stream with at least one audio track
 * @param {number} timeoutMs - Max time to wait for non-zero audio
 * @returns {Promise<{ rms: number, cleanup: Function }>}
 */
export async function probeWithAudioWorklet(stream, timeoutMs = 1500) {
  const ctx = new AudioContext();
  if (!ctx.audioWorklet) {
    ctx.close();
    throw new Error('AudioWorklet not supported');
  }

  await ctx.audioWorklet.addModule(getWorkletURL());
  const source = ctx.createMediaStreamSource(stream);
  const workletNode = new AudioWorkletNode(ctx, 'volume-meter-processor');
  source.connect(workletNode);
  workletNode.connect(ctx.destination);

  return new Promise((resolve) => {
    let maxRMS = 0;
    let settled = false;

    const onMessage = (event) => {
      if (settled) return;
      const { rms } = event.data;
      if (rms > maxRMS) maxRMS = rms;
      if (rms >= RMS_THRESHOLD) {
        settled = true;
        resolve({
          rms: maxRMS,
          cleanup: () => { workletNode.disconnect(); source.disconnect(); ctx.close(); },
          // Return live metering handles so the winner can keep metering
          meterCtx: ctx,
          meterSource: source,
          meterNode: workletNode,
        });
      }
    };
    workletNode.port.onmessage = onMessage;

    setTimeout(() => {
      if (!settled) {
        settled = true;
        workletNode.disconnect();
        source.disconnect();
        ctx.close();
        resolve({ rms: maxRMS, cleanup: () => {} });
      }
    }, timeoutMs);
  });
}

// ---------------------------------------------------------------------------
// Strategy 2: ScriptProcessorNode (deprecated but universal)
// ---------------------------------------------------------------------------

/**
 * Test audio via ScriptProcessorNode.
 *
 * @param {MediaStream} stream
 * @param {number} timeoutMs
 * @returns {Promise<{ rms: number, cleanup: Function }>}
 */
export async function probeWithScriptProcessor(stream, timeoutMs = 1500) {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(2048, 1, 1);
  source.connect(processor);
  processor.connect(ctx.destination);

  return new Promise((resolve) => {
    let maxRMS = 0;
    let settled = false;

    processor.onaudioprocess = (event) => {
      if (settled) return;
      const samples = event.inputBuffer.getChannelData(0);
      const rms = computeRMS(samples);
      if (rms > maxRMS) maxRMS = rms;
      if (rms >= RMS_THRESHOLD) {
        settled = true;
        resolve({
          rms: maxRMS,
          cleanup: () => { processor.disconnect(); source.disconnect(); ctx.close(); },
          meterCtx: ctx,
          meterSource: source,
          meterNode: processor,
        });
      }
    };

    setTimeout(() => {
      if (!settled) {
        settled = true;
        processor.disconnect();
        source.disconnect();
        ctx.close();
        resolve({ rms: maxRMS, cleanup: () => {} });
      }
    }, timeoutMs);
  });
}

// ---------------------------------------------------------------------------
// Strategy 3: MediaRecorder (completely different pipeline)
// ---------------------------------------------------------------------------

/**
 * Test audio by recording a short chunk and decoding it.
 *
 * @param {MediaStream} stream
 * @param {number} recordMs - How long to record
 * @returns {Promise<{ rms: number, cleanup: Function }>}
 */
export async function probeWithMediaRecorder(stream, recordMs = 300) {
  // Only keep audio tracks for recording
  const audioStream = new MediaStream(stream.getAudioTracks());

  // Find a supported mime type
  const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  const mimeType = mimeTypes.find(m => MediaRecorder.isTypeSupported(m));
  if (!mimeType) {
    throw new Error('No supported audio MediaRecorder mime type');
  }

  const recorder = new MediaRecorder(audioStream, { mimeType });
  const chunks = [];

  return new Promise((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = async () => {
      try {
        if (chunks.length === 0) {
          resolve({ rms: 0, cleanup: () => {} });
          return;
        }
        const blob = new Blob(chunks, { type: mimeType });
        const arrayBuffer = await blob.arrayBuffer();
        const ctx = new AudioContext();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const samples = audioBuffer.getChannelData(0);
        const rms = computeRMS(samples);
        ctx.close();
        resolve({ rms, cleanup: () => {} });
      } catch (err) {
        logger().warn('media-recorder-decode-error', { error: err.message });
        resolve({ rms: 0, cleanup: () => {} });
      }
    };

    recorder.onerror = (e) => {
      reject(new Error(e.error?.message || 'MediaRecorder error'));
    };

    recorder.start();
    setTimeout(() => {
      if (recorder.state === 'recording') {
        recorder.stop();
      }
    }, recordMs);
  });
}

/**
 * Ordered list of strategies to try.
 */
export const STRATEGIES = [
  { name: 'audioWorklet', fn: probeWithAudioWorklet },
  { name: 'scriptProcessor', fn: probeWithScriptProcessor },
  { name: 'mediaRecorder', fn: probeWithMediaRecorder },
];
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Input/hooks/audioProbeStrategies.js
git commit -m "feat: add audio probe capture strategies (AudioWorklet, ScriptProcessor, MediaRecorder)"
```

---

### Task 2: Create useAudioProbe Hook

**Files:**
- Create: `frontend/src/modules/Input/hooks/useAudioProbe.js`

This hook orchestrates the probe sequence: for each audio device, try each strategy. Once a winner is found, continue using that strategy for ongoing volume metering.

**Step 1: Write the hook**

```javascript
// frontend/src/modules/Input/hooks/useAudioProbe.js
import { useState, useEffect, useRef, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { STRATEGIES, RMS_THRESHOLD } from './audioProbeStrategies.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useAudioProbe' });
  return _logger;
}

/**
 * Probes audio devices to find a working mic + capture method.
 * Provides continuous volume metering from the winning strategy.
 *
 * @param {MediaDeviceInfo[]} audioDevices - List from useMediaDevices
 * @param {Object} [options]
 * @param {string} [options.preferredDeviceId] - Try this device first
 * @returns {{ workingDeviceId, volume, method, status, probingDeviceLabel, diagnostics }}
 */
export const useAudioProbe = (audioDevices, options = {}) => {
  const { preferredDeviceId } = options;

  const [workingDeviceId, setWorkingDeviceId] = useState(null);
  const [volume, setVolume] = useState(0);
  const [method, setMethod] = useState(null);
  const [status, setStatus] = useState('probing');
  const [probingDeviceLabel, setProbingDeviceLabel] = useState('');
  const [diagnostics, setDiagnostics] = useState([]);

  // Refs for cleanup and ongoing metering
  const meterCleanupRef = useRef(null);
  const meterIntervalRef = useRef(null);
  const cancelledRef = useRef(false);

  // Stable reference to the probe runner
  const runProbe = useCallback(async (devices, preferred) => {
    cancelledRef.current = false;
    setStatus('probing');
    setWorkingDeviceId(null);
    setVolume(0);
    setMethod(null);
    setDiagnostics([]);

    if (devices.length === 0) {
      setStatus('no-mic');
      logger().warn('audio-probe-failed', { reason: 'no-devices' });
      return;
    }

    // Order devices: preferred first, then the rest
    const ordered = [...devices];
    if (preferred) {
      const prefIdx = ordered.findIndex(d => d.deviceId === preferred);
      if (prefIdx > 0) {
        const [pref] = ordered.splice(prefIdx, 1);
        ordered.unshift(pref);
      }
    }

    logger().info('audio-probe-start', {
      deviceCount: ordered.length,
      preferredDeviceId: preferred?.slice(0, 8),
      devices: ordered.map(d => ({ id: d.deviceId.slice(0, 8), label: d.label })),
    });

    const allDiagnostics = [];

    for (const device of ordered) {
      if (cancelledRef.current) return;

      setProbingDeviceLabel(device.label || device.deviceId.slice(0, 8));
      const deviceDiag = { deviceId: device.deviceId, label: device.label, methods: {} };

      // Acquire audio stream for this device
      let testStream;
      try {
        testStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: device.deviceId } },
        });
      } catch (err) {
        logger().info('audio-probe-result', {
          deviceId: device.deviceId.slice(0, 8),
          label: device.label,
          method: 'getUserMedia',
          rms: 0,
          verdict: 'error',
          error: err.message,
        });
        deviceDiag.methods.getUserMedia = 'error';
        allDiagnostics.push(deviceDiag);
        continue;
      }

      // Try each strategy
      for (const strategy of STRATEGIES) {
        if (cancelledRef.current) {
          testStream.getTracks().forEach(t => t.stop());
          return;
        }

        logger().info('audio-probe-testing', {
          deviceId: device.deviceId.slice(0, 8),
          label: device.label,
          method: strategy.name,
        });

        try {
          const result = await strategy.fn(testStream);
          const verdict = result.rms >= 0.001 ? 'active' : 'silent';

          logger().info('audio-probe-result', {
            deviceId: device.deviceId.slice(0, 8),
            label: device.label,
            method: strategy.name,
            rms: Math.round(result.rms * 10000) / 10000,
            verdict,
          });

          deviceDiag.methods[strategy.name] = verdict;

          if (verdict === 'active') {
            // Winner found!
            logger().info('audio-probe-winner', {
              deviceId: device.deviceId.slice(0, 8),
              label: device.label,
              method: strategy.name,
              rms: Math.round(result.rms * 10000) / 10000,
            });

            setWorkingDeviceId(device.deviceId);
            setMethod(strategy.name);
            setStatus('ready');
            setProbingDeviceLabel('');

            // Start ongoing metering with the winning strategy
            startOngoingMeter(strategy, testStream, device);

            allDiagnostics.push(deviceDiag);
            setDiagnostics(allDiagnostics);
            return; // Done!
          }

          // Strategy didn't work, clean up its resources
          result.cleanup();
        } catch (err) {
          logger().info('audio-probe-result', {
            deviceId: device.deviceId.slice(0, 8),
            label: device.label,
            method: strategy.name,
            rms: 0,
            verdict: 'error',
            error: err.message,
          });
          deviceDiag.methods[strategy.name] = 'error';
        }
      }

      // No strategy worked for this device — stop stream and move on
      testStream.getTracks().forEach(t => t.stop());
      allDiagnostics.push(deviceDiag);
    }

    // All devices exhausted
    setStatus('no-mic');
    setProbingDeviceLabel('');
    setDiagnostics(allDiagnostics);
    logger().warn('audio-probe-failed', { diagnostics: allDiagnostics });
  }, []);

  /**
   * Start ongoing volume metering using the winning strategy.
   * For AudioWorklet / ScriptProcessor, we re-use the existing AudioContext.
   * For MediaRecorder, we fall back to ScriptProcessor for ongoing metering
   * (MediaRecorder is too expensive for continuous use).
   */
  const startOngoingMeter = useCallback((strategy, stream, device) => {
    // Clean up any previous meter
    if (meterCleanupRef.current) meterCleanupRef.current();
    if (meterIntervalRef.current) clearInterval(meterIntervalRef.current);

    if (strategy.name === 'audioWorklet') {
      // Re-run AudioWorklet but this time keep it running for ongoing metering
      const ctx = new AudioContext();
      let setupDone = false;

      const setup = async () => {
        try {
          // Worklet module is already cached from the probe
          const blobURL = new Blob([
            `class VolumeMeterProcessor extends AudioWorkletProcessor {
              process(inputs) {
                const input = inputs[0];
                if (input && input.length > 0) {
                  const samples = input[0];
                  let sum = 0;
                  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
                  this.port.postMessage({ rms: Math.sqrt(sum / samples.length) });
                }
                return true;
              }
            }
            registerProcessor('volume-meter-ongoing', VolumeMeterProcessor);`
          ], { type: 'application/javascript' });
          const url = URL.createObjectURL(blobURL);
          await ctx.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);

          const source = ctx.createMediaStreamSource(stream);
          const node = new AudioWorkletNode(ctx, 'volume-meter-ongoing');
          source.connect(node);
          node.connect(ctx.destination);
          setupDone = true;

          let sampleCount = 0;
          let maxLevel = 0;

          node.port.onmessage = (e) => {
            if (cancelledRef.current) return;
            const { rms } = e.data;
            setVolume(rms);
            sampleCount++;
            if (rms > maxLevel) maxLevel = rms;
            if (sampleCount % 250 === 0) {
              logger().info('audio-probe-volume', {
                method: 'audioWorklet',
                maxLevel: Math.round(maxLevel * 1000) / 1000,
                samples: sampleCount,
                device: device.label,
              });
              maxLevel = 0;
            }
          };

          meterCleanupRef.current = () => {
            node.disconnect();
            source.disconnect();
            ctx.close();
          };
        } catch (err) {
          logger().warn('ongoing-meter-setup-failed', { method: 'audioWorklet', error: err.message });
          if (!setupDone) ctx.close();
        }
      };
      setup();

    } else {
      // ScriptProcessor for ongoing metering (also used as fallback for MediaRecorder winner)
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      source.connect(processor);
      processor.connect(ctx.destination);

      let sampleCount = 0;
      let maxLevel = 0;

      processor.onaudioprocess = (event) => {
        if (cancelledRef.current) return;
        const samples = event.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        const rms = Math.sqrt(sum / samples.length);
        setVolume(rms);
        sampleCount++;
        if (rms > maxLevel) maxLevel = rms;
        if (sampleCount % 250 === 0) {
          logger().info('audio-probe-volume', {
            method: 'scriptProcessor',
            maxLevel: Math.round(maxLevel * 1000) / 1000,
            samples: sampleCount,
            device: device.label,
          });
          maxLevel = 0;
        }
      };

      meterCleanupRef.current = () => {
        processor.disconnect();
        source.disconnect();
        ctx.close();
      };
    }
  }, []);

  // Run probe when audioDevices change
  useEffect(() => {
    if (audioDevices.length === 0) return;

    runProbe(audioDevices, preferredDeviceId);

    return () => {
      cancelledRef.current = true;
      if (meterCleanupRef.current) meterCleanupRef.current();
      if (meterIntervalRef.current) clearInterval(meterIntervalRef.current);
    };
  }, [audioDevices, preferredDeviceId, runProbe]);

  return { workingDeviceId, volume, method, status, probingDeviceLabel, diagnostics };
};
```

**Important:** The `RMS_THRESHOLD` constant needs to be exported from `audioProbeStrategies.js`. Add this export to the strategies file:

In `audioProbeStrategies.js`, change:
```javascript
const RMS_THRESHOLD = 0.001;
```
to:
```javascript
export const RMS_THRESHOLD = 0.001;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Input/hooks/useAudioProbe.js
git add frontend/src/modules/Input/hooks/audioProbeStrategies.js
git commit -m "feat: add useAudioProbe hook — multi-strategy mic detection with ongoing metering"
```

---

### Task 3: Integrate useAudioProbe into Webcam.jsx

**Files:**
- Modify: `frontend/src/modules/Input/Webcam.jsx`

Replace `useVolumeMeter` and the auto-cycle logic with `useAudioProbe`. Update the mic label overlay to show probe status.

**Step 1: Rewrite Webcam.jsx**

The full updated file (changes marked with comments):

```jsx
// frontend/src/modules/Input/Webcam.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useMediaDevices } from "./hooks/useMediaDevices";
import { useWebcamStream } from "./hooks/useWebcamStream";
import { useAudioProbe } from "./hooks/useAudioProbe";       // CHANGED: was useVolumeMeter
import { DaylightAPI } from "../../lib/api.mjs";
import getLogger from "../../lib/logging/Logger.js";

export default function WebcamApp() {
  // Fetch input preferences from device config
  const [inputPrefs, setInputPrefs] = useState({});
  useEffect(() => {
    DaylightAPI('api/v1/device/config')
      .then(config => {
        const devices = config?.devices || config || {};
        for (const dev of Object.values(devices)) {
          if (dev.input) {
            setInputPrefs(dev.input);
            break;
          }
        }
      })
      .catch(() => {});
  }, []);

  const {
    videoDevices,
    audioDevices,
    selectedVideoDevice,
    selectedAudioDevice,
    cycleVideoDevice,
    cycleAudioDevice
  } = useMediaDevices({
    preferredCameraPattern: inputPrefs.preferred_camera,
    preferredMicPattern: inputPrefs.preferred_mic,
  });

  // CHANGED: useAudioProbe replaces useVolumeMeter + auto-cycle logic
  const probe = useAudioProbe(audioDevices, {
    preferredDeviceId: selectedAudioDevice,
  });

  // Use probe's verified device if available, fall back to useMediaDevices selection
  const effectiveAudioDevice = probe.workingDeviceId || selectedAudioDevice;

  const { videoRef, stream, error: videoError } = useWebcamStream(selectedVideoDevice, effectiveAudioDevice);

  const logger = useMemo(() => getLogger().child({ component: 'WebcamApp' }), []);

  // REMOVED: auto-cycle useEffect blocks (probe handles device discovery)

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        cycleVideoDevice('next');
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        cycleVideoDevice('prev');
      } else if (
        event.key === " " ||
        event.key === "Spacebar" ||
        event.key === "Enter" ||
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        cycleAudioDevice('next');
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        cycleAudioDevice('prev');
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [cycleVideoDevice, cycleAudioDevice]);

  // CHANGED: volume from probe instead of useVolumeMeter
  const volumePercentage = Math.min(probe.volume * 100, 100);

  // ADDED: mic status display logic
  const micLabel = (() => {
    if (probe.status === 'probing') {
      return `Checking "${probe.probingDeviceLabel}"...`;
    }
    if (probe.status === 'no-mic') {
      return 'No working microphone found';
    }
    // status === 'ready'
    const device = audioDevices.find(d => d.deviceId === effectiveAudioDevice);
    return device?.label || 'Unknown';
  })();

  const micStyle = probe.status === 'no-mic'
    ? { color: '#ff6b6b' }
    : probe.status === 'probing'
      ? { color: '#ffd43b' }
      : {};

  return (
    <div
      style={{
        width: "calc(100% - 2rem)",
        height: "calc(100% - 2rem)",
        position: "relative",
        padding: "3rem",
        margin: "1rem",
        boxSizing: "border-box"
      }}
    >
      {/* Floating labels for the currently selected camera & mic */}
      <div
        style={{
          position: "absolute",
          bottom: 10,
          left: '50%',
          width: "20rem",
          textAlign: "center",
          marginLeft: "-10rem",
          color: "white",
          backgroundColor: "rgba(0,0,0,0.5)",
          padding: "6px 8px",
          borderRadius: 4,
          zIndex: 10
        }}
      >
        <div>
          Camera:{" "}
          {
            videoDevices.find(d => d.deviceId === selectedVideoDevice)
              ?.label || "No camera"
          }
        </div>
        <div style={micStyle}>
          Mic: {micLabel}
        </div>
      </div>

      {/* Volume Meter */}
      <div
        style={{
          textAlign: "center",
          marginTop: "20px",
          position: "absolute",
          left: 0,
          width: "100%",
          height: "100%",
          bottom: 0
        }}
      >
        <div
          style={{
            opacity: 0.8,
            display: "inline-block",
            borderRadius: "5px",
            width: "300px",
            height: "20px",
            backgroundColor: "#ddd",
            position: "relative",
            zIndex: 1
          }}
        >
          <div
            style={{
              width: `${volumePercentage}%`,
              height: "100%",
              borderRadius: "5px",
              backgroundColor: probe.status === 'ready' ? "green" : "#999",
              transition: "width 0.1s"
            }}
          />
        </div>
      </div>

      {/* Video Preview */}
      <video
        ref={videoRef}
        autoPlay
        muted
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          objectFit: "cover",
          height: "100%",
          transform: "scaleX(-1)"
        }}
      />
      {videoError && (
        <div style={{ position: 'absolute', top: 10, left: 10, color: 'red', background: 'rgba(0,0,0,0.7)', padding: 5 }}>
          Error: {videoError.message}
        </div>
      )}
    </div>
  );
}
```

**Key changes from current Webcam.jsx:**
1. Import `useAudioProbe` instead of `useVolumeMeter` (line 4)
2. Remove `useRef` from React import (no longer needed for auto-cycle refs)
3. Replace `useVolumeMeter(stream)` with `useAudioProbe(audioDevices, ...)` (after useMediaDevices)
4. Add `effectiveAudioDevice` that prefers probe result
5. Remove all auto-cycle refs and useEffects (lines 43-97 of current file)
6. Volume comes from `probe.volume` instead of `volume`
7. Mic label overlay shows probe status with color coding
8. Volume bar color is grey during probing, green when ready

**Step 2: Commit**

```bash
git add frontend/src/modules/Input/Webcam.jsx
git commit -m "feat: integrate useAudioProbe into Webcam — replaces useVolumeMeter + auto-cycle"
```

---

### Task 4: Integrate useAudioProbe into VideoCall.jsx

**Files:**
- Modify: `frontend/src/modules/Input/VideoCall.jsx`

Same swap as Webcam — replace `useVolumeMeter` with `useAudioProbe`. This fixes both metering AND call audio (the stream acquired with the working device carries real audio data for WebRTC).

**Step 1: Update VideoCall.jsx**

Changes are surgical — only the hook usage and volume source change:

In the imports section, replace:
```javascript
import { useVolumeMeter } from './hooks/useVolumeMeter';
```
with:
```javascript
import { useAudioProbe } from './hooks/useAudioProbe';
```

In the component body, replace:
```javascript
  const {
    selectedVideoDevice,
    selectedAudioDevice,
  } = useMediaDevices();

  const { videoRef, stream } = useWebcamStream(selectedVideoDevice, selectedAudioDevice);
  const { volume } = useVolumeMeter(stream);
```
with:
```javascript
  const {
    audioDevices,
    selectedVideoDevice,
    selectedAudioDevice,
  } = useMediaDevices();

  const probe = useAudioProbe(audioDevices, {
    preferredDeviceId: selectedAudioDevice,
  });
  const effectiveAudioDevice = probe.workingDeviceId || selectedAudioDevice;

  const { videoRef, stream } = useWebcamStream(selectedVideoDevice, effectiveAudioDevice);
```

Replace the volume line:
```javascript
  const volumePercentage = Math.min(volume * 100, 100);
```
with:
```javascript
  const volumePercentage = Math.min(probe.volume * 100, 100);
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Input/VideoCall.jsx
git commit -m "feat: integrate useAudioProbe into VideoCall — fixes call audio on Shield TV"
```

---

### Task 5: Manual Verification on Dev

**No code changes — verification only.**

**Step 1: Start dev server**

```bash
lsof -i :3111  # Check if already running
npm run dev     # Start if not
```

**Step 2: Open Webcam app in browser**

Navigate to `http://localhost:3111/tv?open=webcam` in Chrome.

**Step 3: Verify in browser console**

Check for these log events (set `window.DAYLIGHT_LOG_LEVEL = 'debug'` first):

1. `audio-probe-start` — lists all audio devices and preferred
2. `audio-probe-testing` — shows each device × method being tested
3. `audio-probe-result` — verdict for each: `active`, `silent`, or `error`
4. `audio-probe-winner` — which device and method won
5. `audio-probe-volume` — ongoing metering samples every ~5s

**Step 4: Verify visual indicator**

- During probing: overlay shows `Mic: Checking "..."` in yellow
- After probe: overlay shows `Mic: <device name>` in white
- Green bar should be responsive to sound
- If no mic: overlay shows `Mic: No working microphone found` in red

**Step 5: Verify build**

```bash
cd frontend && npx vite build
```

Confirm no build errors (AudioWorklet Blob URL approach avoids Vite module issues).

---

### Task 6: Final Commit — Clean Up

**Step 1: Remove unused auto-cycle imports if any remain**

Check that `Webcam.jsx` no longer imports `useRef` unnecessarily (it may still need it for other things — verify). The `useVolumeMeter` import should be gone from both files.

**Step 2: Verify `useVolumeMeter.js` is untouched**

It stays in the codebase — `CallApp.jsx` on the phone side still uses it indirectly via any other consumer. Don't delete it.

**Step 3: Final commit**

```bash
git add -A
git status  # Verify only expected files changed
git commit -m "chore: clean up unused imports after audio probe migration"
```
