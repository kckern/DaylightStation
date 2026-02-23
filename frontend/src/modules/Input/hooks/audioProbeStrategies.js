/**
 * Audio Probe Strategies
 *
 * Multiple strategies for capturing audio level from a MediaStream.
 * The NVIDIA Shield TV (Fully Kiosk Browser / Android WebView) returns
 * zero from RTCPeerConnection loopback stats. This module provides
 * three alternative approaches, tried in order until one detects audio.
 *
 * Each strategy is async, takes a MediaStream, and resolves with:
 *   { rms: number, cleanup: Function, meterCtx?, meterSource?, meterNode? }
 *
 * The meterCtx/meterSource/meterNode fields let the winning strategy's
 * AudioContext resources be reused for ongoing volume metering.
 */

import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'audioProbeStrategies' });
  return _logger;
}

// ── Constants ────────────────────────────────────────────────────────

/** Minimum RMS to consider audio "detected" */
export const RMS_THRESHOLD = 0.001;

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Compute root-mean-square of a Float32Array of audio samples.
 * Returns 0 for empty or zero-length input.
 */
function computeRMS(samples) {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

// ── Strategy 1: AudioWorklet ─────────────────────────────────────────

/**
 * Probe audio level using AudioWorklet.
 *
 * The worklet processor source is embedded as a string and registered
 * via a Blob URL to avoid Vite build / module resolution issues on
 * Android WebView.
 *
 * @param {MediaStream} stream - Stream with at least one audio track
 * @param {number} timeoutMs - Max time to wait for non-zero audio
 * @returns {Promise<{ rms: number, cleanup: Function, meterCtx?, meterSource?, meterNode? }>}
 */
async function probeWithAudioWorklet(stream, timeoutMs = 1500) {
  if (typeof AudioWorkletNode === 'undefined') {
    throw new Error('AudioWorklet not supported in this environment');
  }

  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);

  // Inline processor source — runs inside the AudioWorklet scope
  const processorSource = `
class RMSProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const samples = input[0];
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / samples.length);
    this.port.postMessage({ rms });
    return true;
  }
}
registerProcessor('rms-probe-processor', RMSProcessor);
`;

  const blob = new Blob([processorSource], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);

  let workletNode = null;

  try {
    await ctx.audioWorklet.addModule(blobUrl);
  } catch (err) {
    URL.revokeObjectURL(blobUrl);
    await ctx.close();
    throw new Error(`AudioWorklet addModule failed: ${err.message}`);
  }

  URL.revokeObjectURL(blobUrl);

  return new Promise((resolve) => {
    let resolved = false;
    let maxRMS = 0;

    workletNode = new AudioWorkletNode(ctx, 'rms-probe-processor');
    source.connect(workletNode);
    workletNode.connect(ctx.destination);

    const cleanup = () => {
      try { source.disconnect(); } catch (_) { /* already disconnected */ }
      try { workletNode.disconnect(); } catch (_) { /* already disconnected */ }
    };

    workletNode.port.onmessage = (e) => {
      const { rms } = e.data;
      if (rms > maxRMS) maxRMS = rms;

      if (!resolved && rms >= RMS_THRESHOLD) {
        resolved = true;
        logger().info('probe-worklet-detected', { rms: Math.round(rms * 10000) / 10000 });
        resolve({
          rms,
          cleanup,
          meterCtx: ctx,
          meterSource: source,
          meterNode: workletNode,
        });
      }
    };

    // Timeout — resolve with best RMS seen (may be 0)
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        logger().info('probe-worklet-timeout', { maxRMS: Math.round(maxRMS * 10000) / 10000, timeoutMs });
        // If no audio detected, clean up the context
        if (maxRMS < RMS_THRESHOLD) {
          cleanup();
          ctx.close().catch(() => {});
          resolve({ rms: 0, cleanup: () => {} });
        } else {
          resolve({
            rms: maxRMS,
            cleanup,
            meterCtx: ctx,
            meterSource: source,
            meterNode: workletNode,
          });
        }
      }
    }, timeoutMs);
  });
}

// ── Strategy 2: ScriptProcessorNode (deprecated but universal) ───────

/**
 * Probe audio level using the deprecated ScriptProcessorNode.
 * This is the most broadly supported fallback across older WebViews.
 *
 * @param {MediaStream} stream - Stream with at least one audio track
 * @param {number} timeoutMs - Max time to wait for non-zero audio
 * @returns {Promise<{ rms: number, cleanup: Function, meterCtx?, meterSource?, meterNode? }>}
 */
async function probeWithScriptProcessor(stream, timeoutMs = 1500) {
  if (typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') {
    throw new Error('Web Audio API not supported in this environment');
  }

  const AudioCtx = typeof AudioContext !== 'undefined' ? AudioContext : webkitAudioContext;
  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);

  // Buffer size 2048 gives ~46ms windows at 44100 Hz
  const processor = ctx.createScriptProcessor(2048, 1, 1);

  return new Promise((resolve) => {
    let resolved = false;
    let maxRMS = 0;

    source.connect(processor);
    processor.connect(ctx.destination);

    const cleanup = () => {
      try { processor.disconnect(); } catch (_) { /* already disconnected */ }
      try { source.disconnect(); } catch (_) { /* already disconnected */ }
    };

    processor.onaudioprocess = (e) => {
      const samples = e.inputBuffer.getChannelData(0);
      const rms = computeRMS(samples);
      if (rms > maxRMS) maxRMS = rms;

      if (!resolved && rms >= RMS_THRESHOLD) {
        resolved = true;
        logger().info('probe-scriptprocessor-detected', { rms: Math.round(rms * 10000) / 10000 });
        resolve({
          rms,
          cleanup,
          meterCtx: ctx,
          meterSource: source,
          meterNode: processor,
        });
      }
    };

    // Timeout — resolve with best RMS seen (may be 0)
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        logger().info('probe-scriptprocessor-timeout', { maxRMS: Math.round(maxRMS * 10000) / 10000, timeoutMs });
        if (maxRMS < RMS_THRESHOLD) {
          cleanup();
          ctx.close().catch(() => {});
          resolve({ rms: 0, cleanup: () => {} });
        } else {
          resolve({
            rms: maxRMS,
            cleanup,
            meterCtx: ctx,
            meterSource: source,
            meterNode: processor,
          });
        }
      }
    }, timeoutMs);
  });
}

// ── Strategy 3: MediaRecorder (record-then-decode) ───────────────────

/**
 * Probe audio by recording a short chunk via MediaRecorder, then
 * decoding the result and checking sample levels.
 *
 * This works even when Web Audio's createMediaStreamSource returns
 * silence, because MediaRecorder uses the platform's native encoder.
 *
 * @param {MediaStream} stream - Stream with at least one audio track
 * @param {number} recordMs - Duration of the recording probe
 * @returns {Promise<{ rms: number, cleanup: Function }>}
 */
async function probeWithMediaRecorder(stream, recordMs = 300) {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder not supported in this environment');
  }

  // Find a supported MIME type
  const mimeTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];

  let mimeType = null;
  for (const candidate of mimeTypes) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      mimeType = candidate;
      break;
    }
  }

  if (!mimeType) {
    throw new Error('No supported MediaRecorder MIME type found');
  }

  return new Promise((resolve) => {
    const chunks = [];
    let recorder;

    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch (err) {
      logger().warn('probe-mediarecorder-create-failed', { error: err.message, mimeType });
      resolve({ rms: 0, cleanup: () => {} });
      return;
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    recorder.onstop = async () => {
      if (chunks.length === 0) {
        logger().info('probe-mediarecorder-no-chunks');
        resolve({ rms: 0, cleanup: () => {} });
        return;
      }

      try {
        const blob = new Blob(chunks, { type: mimeType });
        const arrayBuffer = await blob.arrayBuffer();

        const AudioCtx = typeof AudioContext !== 'undefined' ? AudioContext : webkitAudioContext;
        const ctx = new AudioCtx();

        let audioBuffer;
        try {
          audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        } catch (decodeErr) {
          logger().warn('probe-mediarecorder-decode-failed', { error: decodeErr.message });
          await ctx.close();
          resolve({ rms: 0, cleanup: () => {} });
          return;
        }

        const samples = audioBuffer.getChannelData(0);
        const rms = computeRMS(samples);

        await ctx.close();

        logger().info('probe-mediarecorder-result', {
          rms: Math.round(rms * 10000) / 10000,
          duration: audioBuffer.duration,
          mimeType,
        });

        resolve({ rms, cleanup: () => {} });
      } catch (err) {
        logger().warn('probe-mediarecorder-process-failed', { error: err.message });
        resolve({ rms: 0, cleanup: () => {} });
      }
    };

    recorder.onerror = (e) => {
      logger().warn('probe-mediarecorder-error', { error: e.error?.message || 'unknown' });
      resolve({ rms: 0, cleanup: () => {} });
    };

    recorder.start();

    setTimeout(() => {
      if (recorder.state === 'recording') {
        recorder.stop();
      }
    }, recordMs);
  });
}

// ── Strategy Registry ────────────────────────────────────────────────

/**
 * Ordered list of probe strategies. The caller should try each in
 * sequence until one returns rms >= RMS_THRESHOLD.
 */
export const STRATEGIES = [
  { name: 'audioWorklet', fn: probeWithAudioWorklet },
  { name: 'scriptProcessor', fn: probeWithScriptProcessor },
  { name: 'mediaRecorder', fn: probeWithMediaRecorder },
];
