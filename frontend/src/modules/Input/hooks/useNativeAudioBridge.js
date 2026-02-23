import { useState, useEffect, useRef, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

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
 * Config-driven: only activates when a bridge config is provided and
 * the enabled flag is true.
 *
 * @param {Object} config
 * @param {boolean} config.enabled - Whether to activate the bridge
 * @param {string}  config.url     - WebSocket URL (e.g. 'ws://localhost:8765')
 * @returns {{ stream: MediaStream|null, volume: number, status: string }}
 */
export const useNativeAudioBridge = (config = {}) => {
  const { enabled = false, url } = config;

  const [stream, setStream] = useState(null);
  const [volume, setVolume] = useState(0);
  const [status, setStatus] = useState('idle');

  const wsRef = useRef(null);
  const ctxRef = useRef(null);
  const cleanupRef = useRef(null);
  const retryRef = useRef(0);
  const retryTimerRef = useRef(null);
  const configRef = useRef(config);
  configRef.current = config;

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

      // Binary messages are PCM data — forward to worklet
      if (event.data instanceof ArrayBuffer && cleanupRef.current) {
        const workletNode = cleanupRef.current._workletNode;
        if (workletNode) {
          workletNode.port.postMessage({ pcm: event.data }, [event.data]);
        }
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
   */
  const setupAudioPipeline = useCallback(async (format) => {
    const sampleRate = format.sampleRate || 48000;
    const ctx = new AudioContext({ sampleRate });
    ctxRef.current = ctx;

    // Ensure context is running (Android WebView may suspend it)
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const processorSource = `
class BridgeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(0);
    this.port.onmessage = (e) => {
      if (e.data.pcm) {
        // Convert Int16 PCM to Float32
        const int16 = new Int16Array(e.data.pcm);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
          float32[i] = int16[i] / 32768;
        }
        // Append to buffer
        const newBuf = new Float32Array(this._buffer.length + float32.length);
        newBuf.set(this._buffer);
        newBuf.set(float32, this._buffer.length);
        this._buffer = newBuf;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (output.length === 0) return true;

    const channel = output[0];
    const needed = channel.length;

    if (this._buffer.length >= needed) {
      channel.set(this._buffer.subarray(0, needed));
      this._buffer = this._buffer.subarray(needed);
    } else if (this._buffer.length > 0) {
      channel.set(this._buffer);
      // Rest stays zero (silence)
      this._buffer = new Float32Array(0);
    }
    // else: output stays zero-filled (silence)

    // Compute RMS and report volume
    let sum = 0;
    for (let i = 0; i < channel.length; i++) {
      sum += channel[i] * channel[i];
    }
    const rms = Math.sqrt(sum / channel.length);
    this.port.postMessage({ rms });

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
    const destination = ctx.createMediaStreamDestination();
    workletNode.connect(destination);

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
    };

    setStream(destination.stream);
    setStatus('connected');
    logger().info('bridge-connected', { sampleRate, channels: format.channels });

    // Store cleanup + worklet ref for PCM forwarding
    const cleanupFn = () => {
      workletNode.disconnect();
      destination.disconnect();
    };
    cleanupFn._workletNode = workletNode;
    cleanupRef.current = cleanupFn;
  }, []);

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

  return { stream, volume, status };
};
