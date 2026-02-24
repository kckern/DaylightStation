import { useState, useEffect, useRef, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import speexWasmSource from '../../../lib/audio/speex_aec.js?raw';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useNativeAudioBridge' });
  return _logger;
}

const RETRY_DELAYS = [1000, 2000, 4000, 10000]; // exponential backoff, max 10s

/**
 * Connects to a native audio bridge app via local WebSocket,
 * receives raw PCM audio, and produces a MediaStream + volume meter.
 *
 * AEC (echo cancellation) runs on the main thread using Speex WASM.
 * Chrome WebView 120's AudioWorklet scope cannot compile WASM, so
 * the worklet is a simple PCM output device and all DSP happens here.
 *
 * Config-driven: only activates when a bridge config is provided and
 * the enabled flag is true.
 *
 * @param {Object} config
 * @param {boolean} config.enabled - Whether to activate the bridge
 * @param {string}  config.url     - WebSocket URL (e.g. 'ws://localhost:8765')
 * @returns {{ stream: MediaStream|null, volume: number, status: string, feedReference: function }}
 */
export const useNativeAudioBridge = (config = {}) => {
  const { enabled = false, url, gain = 2, aec = {} } = config;

  const [stream, setStream] = useState(null);
  const [volume, setVolume] = useState(0);
  const [status, setStatus] = useState('idle');

  const wsRef = useRef(null);
  const ctxRef = useRef(null);
  const cleanupRef = useRef(null);
  const retryRef = useRef(0);
  const retryTimerRef = useRef(null);
  const gainNodeRef = useRef(null);
  const configRef = useRef(config);
  configRef.current = config;

  // Main-thread AEC state
  const aecRef = useRef(null);

  const cleanup = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (aecRef.current) {
      aecRef.current.destroy();
      aecRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    setStream(null);
    setVolume(0);
  }, []);

  const connect = useCallback(() => {
    const { enabled: en, url: wsUrl } = configRef.current;
    if (!en || !wsUrl) return;

    setStatus('connecting');
    logger().info('bridge-connecting', { url: wsUrl, retry: retryRef.current });

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    let headerReceived = false;

    ws.onopen = () => {
      logger().info('bridge-ws-open');
      retryRef.current = 0;
    };

    ws.onmessage = async (event) => {
      // First text message is the format header
      if (!headerReceived && typeof event.data === 'string') {
        headerReceived = true;
        try {
          const format = JSON.parse(event.data);

          if (format.error) {
            logger().warn('bridge-server-error', { error: format.error });
            setStatus('unavailable');
            return;
          }

          logger().info('bridge-format', format);
          await setupAudioPipeline(format);
        } catch (err) {
          logger().error('bridge-format-parse-error', { error: err.message });
          setStatus('disconnected');
        }
        return;
      }

      // Binary messages are PCM data — process with AEC or forward raw
      if (event.data instanceof ArrayBuffer && cleanupRef.current) {
        const workletNode = cleanupRef.current._workletNode;
        if (!workletNode) return;

        const aecState = aecRef.current;
        if (aecState && aecState.hasRef) {
          // AEC mode: feed mic into ring buffer, process aligned frames.
          // Once ref has been received, ALL mic data goes through AEC —
          // never fall back to passthrough (would cause double audio).
          if (!aecState._loggedFirstRef) {
            aecState._loggedFirstRef = true;
            logger().info('bridge-aec-active', { mode: 'aec' });
          }
          aecState.feedMic(new Int16Array(event.data));
          const cleanFrames = aecState.process();
          if (cleanFrames.length > 0) {
            const totalLen = cleanFrames.reduce((s, f) => s + f.length, 0);
            const clean = new Float32Array(totalLen);
            let offset = 0;
            for (const f of cleanFrames) {
              clean.set(f, offset);
              offset += f.length;
            }
            workletNode.port.postMessage({ cleanPcm: clean.buffer }, [clean.buffer]);
          }
          // If no clean frames yet (accumulating), worklet plays from its
          // existing buffer or outputs silence — no data loss, AEC will
          // catch up on the next mic chunk.
          return;
        }

        // Passthrough: no AEC or ref signal not received yet — send raw PCM
        workletNode.port.postMessage({ pcm: event.data }, [event.data]);
      }
    };

    ws.onclose = (event) => {
      logger().info('bridge-ws-close', { code: event.code, reason: event.reason });
      cleanup();

      if (!configRef.current.enabled) {
        setStatus('idle');
        return;
      }

      // Don't retry if server explicitly rejected us
      if (event.code === 1008 || event.code === 1011) {
        setStatus('unavailable');
        return;
      }

      setStatus('disconnected');
      scheduleRetry();
    };

    ws.onerror = () => {
      // onclose will fire after this — handle retry there
      logger().debug('bridge-ws-error');
    };
  }, [cleanup]);

  const scheduleRetry = useCallback(() => {
    const delay = RETRY_DELAYS[Math.min(retryRef.current, RETRY_DELAYS.length - 1)];
    retryRef.current++;
    logger().info('bridge-retry-scheduled', { delay, attempt: retryRef.current });
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      if (configRef.current.enabled) {
        connect();
      }
    }, delay);
  }, [connect]);

  /**
   * Sets up AudioContext → AudioWorklet → MediaStreamDestination pipeline.
   * The worklet receives PCM chunks via MessagePort and writes them
   * into the audio graph, producing a real MediaStreamTrack.
   *
   * AEC is initialized on the main thread (WASM doesn't compile in
   * Chrome WebView 120's AudioWorklet scope).
   */
  const setupAudioPipeline = useCallback(async (format) => {
    const sampleRate = format.sampleRate || 48000;
    const ctx = new AudioContext({ sampleRate });
    ctxRef.current = ctx;

    // Ensure context is running (Android WebView may suspend it)
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // ── Simplified worklet: PCM output + RMS metering only ──
    // No WASM, no AEC — just receives audio and plays it.
    const processorSource = `
class BridgeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Pre-allocated ring buffer (1s at 48kHz)
    this._ring = new Float32Array(48000);
    this._writePos = 0;
    this._readPos = 0;
    this._count = 0;
    this._frameCount = 0;

    this.port.onmessage = (e) => {
      if (e.data.pcm) {
        // Raw Int16 from mic (passthrough — no AEC)
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
      if (e.data.cleanPcm) {
        // Float32 from main-thread AEC
        const float32 = new Float32Array(e.data.cleanPcm);
        const len = float32.length;
        const ring = this._ring;
        const cap = ring.length;
        for (let i = 0; i < len; i++) {
          ring[this._writePos] = float32[i];
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
    const needed = channel.length;

    const ring = this._ring;
    const cap = ring.length;
    if (this._count >= needed) {
      for (let i = 0; i < needed; i++) {
        channel[i] = ring[this._readPos];
        this._readPos = (this._readPos + 1) % cap;
      }
      this._count -= needed;
    } else if (this._count > 0) {
      const avail = this._count;
      for (let i = 0; i < avail; i++) {
        channel[i] = ring[this._readPos];
        this._readPos = (this._readPos + 1) % cap;
      }
      this._count = 0;
    }

    // RMS volume metering
    let sum = 0;
    for (let i = 0; i < channel.length; i++) {
      sum += channel[i] * channel[i];
    }
    const rms = Math.sqrt(sum / channel.length);

    this._frameCount++;
    if (this._frameCount % 500 === 0) {
      this.port.postMessage({ rms, debug: { buffered: this._count } });
    } else {
      this.port.postMessage({ rms });
    }

    return true;
  }
}
registerProcessor('bridge-processor', BridgeProcessor);`;

    const blob = new Blob([processorSource], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);

    try {
      await ctx.audioWorklet.addModule(blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }

    const workletNode = new AudioWorkletNode(ctx, 'bridge-processor');

    // ── Initialize Speex AEC on the main thread ──
    const aecConfig = configRef.current.aec || {};
    const aecEnabled = aecConfig.enabled !== false;

    if (aecEnabled) {
      try {
        // Evaluate Speex WASM on the main thread where self.location,
        // WebAssembly.compile, fetch, etc. all work correctly.
        // Chrome WebView 120's AudioWorklet scope can't compile WASM
        // (SpeexModule() hangs forever), so all DSP runs here instead.
        //
        // Try dynamic import from blob URL first (clean, no eval).
        // Fall back to new Function() for environments where blob
        // dynamic import isn't supported.
        let SpeexModuleFactory;
        try {
          const esBlob = new Blob(
            [speexWasmSource + '\nexport default SpeexModule;'],
            { type: 'text/javascript' }
          );
          const esUrl = URL.createObjectURL(esBlob);
          try {
            const mod = await import(/* @vite-ignore */ esUrl);
            SpeexModuleFactory = mod.default;
          } finally {
            URL.revokeObjectURL(esUrl);
          }
        } catch {
          // Fallback: new Function (works everywhere, needs unsafe-eval CSP)
          SpeexModuleFactory = new Function(speexWasmSource + ';\nreturn SpeexModule;')();
        }

        const speexMod = await SpeexModuleFactory();
        const frameSize = aecConfig.frame_size || 480;
        // Filter length must cover the full echo path on Android TV:
        // Chrome audio rendering → Android AudioTrack buffering →
        // DAC → speaker → room → mic → AudioBridge APK → WebSocket.
        // Shield TV measured at 400-500ms. Default 24000 = 500ms at 48kHz.
        const filterLength = aecConfig.filter_length || 24000;

        // Init Speex echo state
        const state = speexMod._speex_echo_state_init(frameSize, filterLength);
        const srPtr = speexMod._malloc(4);
        speexMod.setValue(srPtr, 48000, 'i32');
        speexMod._speex_echo_ctl(state, 24, srPtr); // SPEEX_ECHO_SET_SAMPLING_RATE
        speexMod._free(srPtr);

        // Init Speex preprocessor for residual echo suppression.
        // The adaptive filter alone leaves residual echo; the preprocessor
        // applies spectral subtraction using the echo state to suppress it.
        const ppState = speexMod._speex_preprocess_state_init(frameSize, 48000);
        // SPEEX_PREPROCESS_SET_ECHO_STATE (24): ptr IS the echo state
        // (unlike SET_SAMPLING_RATE which dereferences ptr to read an int).
        speexMod._speex_preprocess_ctl(ppState, 24, state);

        // Pre-allocate WASM heap buffers (int16: 2 bytes per sample)
        const micPtr = speexMod._malloc(frameSize * 2);
        const refPtr = speexMod._malloc(frameSize * 2);
        const outPtr = speexMod._malloc(frameSize * 2);

        // Ring buffers for mic and ref on main thread (2s each)
        const RING_SIZE = 96000;
        const micRing = new Float32Array(RING_SIZE);
        let micWP = 0, micRP = 0, micCount = 0;
        const refRing = new Float32Array(RING_SIZE);
        let refWP = 0, refRP = 0, refCount = 0;
        let hasRef = false;

        const aecState = {
          get hasRef() { return hasRef; },

          feedMic(int16Array) {
            const len = int16Array.length;
            for (let i = 0; i < len; i++) {
              micRing[micWP] = int16Array[i] / 32768;
              micWP = (micWP + 1) % RING_SIZE;
            }
            micCount = Math.min(micCount + len, RING_SIZE);
          },

          feedRef(float32Array) {
            const len = float32Array.length;
            for (let i = 0; i < len; i++) {
              refRing[refWP] = float32Array[i];
              refWP = (refWP + 1) % RING_SIZE;
            }
            refCount = Math.min(refCount + len, RING_SIZE);
            hasRef = true;
          },

          process() {
            const results = [];
            while (micCount >= frameSize && refCount >= frameSize) {
              // Read mic frame → WASM heap (Float32 → Int16)
              for (let i = 0; i < frameSize; i++) {
                speexMod.HEAP16[(micPtr >> 1) + i] =
                  Math.max(-32768, Math.min(32767, micRing[micRP] * 32768));
                micRP = (micRP + 1) % RING_SIZE;
              }
              micCount -= frameSize;

              // Read ref frame → WASM heap (Float32 → Int16)
              for (let i = 0; i < frameSize; i++) {
                speexMod.HEAP16[(refPtr >> 1) + i] =
                  Math.max(-32768, Math.min(32767, refRing[refRP] * 32768));
                refRP = (refRP + 1) % RING_SIZE;
              }
              refCount -= frameSize;

              // Run Speex echo cancellation (adaptive filter)
              speexMod._speex_echo_cancellation(state, micPtr, refPtr, outPtr);

              // Run preprocessor for residual echo suppression
              // (spectral subtraction using echo state estimate)
              speexMod._speex_preprocess_run(ppState, outPtr);

              // Int16 → Float32 output
              const output = new Float32Array(frameSize);
              for (let i = 0; i < frameSize; i++) {
                output[i] = speexMod.HEAP16[(outPtr >> 1) + i] / 32768;
              }
              results.push(output);
            }
            return results;
          },

          destroy() {
            speexMod._speex_preprocess_state_destroy(ppState);
            speexMod._speex_echo_state_destroy(state);
            speexMod._free(micPtr);
            speexMod._free(refPtr);
            speexMod._free(outPtr);
          },
        };

        aecRef.current = aecState;
        logger().info('bridge-aec-status', { status: 'ready', frameSize, filterLength });
      } catch (err) {
        logger().warn('bridge-aec-status', { status: 'failed', error: err.message });
        aecRef.current = null;
      }
    } else {
      logger().info('bridge-aec-status', { status: 'disabled' });
    }

    // Gain boost → compressor (limiter) → destination
    // Compressor prevents clipping from the gain boost.
    const gainNode = ctx.createGain();
    gainNode.gain.value = configRef.current.gain || 2;
    gainNodeRef.current = gainNode;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -6;  // start compressing 6dB below clipping
    compressor.knee.value = 6;        // soft knee for natural sound
    compressor.ratio.value = 20;      // heavy limiting near 0dB
    compressor.attack.value = 0.003;  // fast attack to catch transients
    compressor.release.value = 0.1;   // quick release

    const destination = ctx.createMediaStreamDestination();
    workletNode.connect(gainNode);
    gainNode.connect(compressor);
    compressor.connect(destination);

    // Volume metering from worklet
    let sampleCount = 0;
    let maxLevel = 0;

    workletNode.port.onmessage = (e) => {
      if (e.data.rms !== undefined) {
        setVolume(e.data.rms);
        sampleCount++;
        if (e.data.rms > maxLevel) maxLevel = e.data.rms;
        if (sampleCount % 500 === 0) {
          logger().sampled('bridge-volume', {
            maxLevel: Math.round(maxLevel * 1000) / 1000,
            samples: sampleCount,
          }, { maxPerMinute: 6, aggregate: true });
          maxLevel = 0;
        }
      }
      if (e.data.debug) {
        logger().sampled('bridge-buffer-levels', e.data.debug, { maxPerMinute: 6 });
      }
    };

    setStream(destination.stream);
    setStatus('connected');
    logger().info('bridge-connected', {
      sampleRate,
      channels: format.channels,
      gain: gainNode.gain.value,
      aec: aecRef.current ? 'ready' : 'off',
    });

    // Store cleanup + worklet ref for PCM forwarding
    const cleanupFn = () => {
      workletNode.disconnect();
      gainNode.disconnect();
      compressor.disconnect();
      destination.disconnect();
      gainNodeRef.current = null;
    };
    cleanupFn._workletNode = workletNode;
    cleanupRef.current = cleanupFn;
  }, []);

  // Update gain in real-time when config changes
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = gain;
    }
  }, [gain]);

  // Main effect: connect/disconnect based on enabled + url
  useEffect(() => {
    if (enabled && url) {
      connect();
    } else {
      cleanup();
      setStatus('idle');
    }

    return () => {
      cleanup();
    };
  }, [enabled, url, connect, cleanup]);

  // Feed reference signal from VideoCall's remote audio tap.
  // Called by VideoCall.jsx instead of posting to workletPort.
  const feedReference = useCallback((float32Array) => {
    if (aecRef.current) {
      aecRef.current.feedRef(float32Array);
    }
  }, []);

  return { stream, volume, status, feedReference };
};
