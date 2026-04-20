import { useState, useRef, useCallback, useEffect } from 'react';
import getLogger from '@/lib/logging/Logger.js';

const logger = getLogger().child({ component: 'weekly-review-recorder' });

const LEVEL_SAMPLE_INTERVAL_MS = 50;
const SILENCE_WARNING_MS = 5000;
const CHUNK_INTERVAL_MS = 5000;

const BRIDGE_URL = 'ws://localhost:8765';
const BRIDGE_TIMEOUT_MS = 1500;

function getBridgeStream() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.close(); reject(new Error('AudioBridge timeout')); }, BRIDGE_TIMEOUT_MS);
    const ws = new WebSocket(BRIDGE_URL);
    ws.binaryType = 'arraybuffer';
    ws.onmessage = async (event) => {
      if (typeof event.data !== 'string') return;
      clearTimeout(timeout);
      let format;
      try { format = JSON.parse(event.data); } catch { ws.close(); return reject(new Error('AudioBridge bad header')); }
      if (format.error) { ws.close(); return reject(new Error(`AudioBridge error: ${format.error}`)); }
      try { resolve(await buildBridgeStream(ws, format)); } catch (err) { ws.close(); reject(err); }
    };
    ws.onerror = () => { clearTimeout(timeout); reject(new Error('AudioBridge unavailable')); };
    ws.onclose = (e) => { if (e.code !== 1000) { clearTimeout(timeout); reject(new Error('AudioBridge closed')); } };
  });
}

async function buildBridgeStream(ws, format) {
  const sampleRate = format.sampleRate || 48000;
  const ctx = new AudioContext({ sampleRate });
  if (ctx.state === 'suspended') await ctx.resume();
  const processorSource = `
class BridgeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ring = new Float32Array(${sampleRate});
    this._writePos = 0; this._readPos = 0; this._count = 0;
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
    const ch = outputs[0][0]; if (!ch) return true;
    const needed = ch.length; const cap = this._ring.length;
    const avail = Math.min(this._count, needed);
    for (let i = 0; i < avail; i++) { ch[i] = this._ring[this._readPos]; this._readPos = (this._readPos + 1) % cap; }
    this._count -= avail; return true;
  }
}
registerProcessor('bridge-recorder-processor', BridgeProcessor);`;
  const blob = new Blob([processorSource], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  try { await ctx.audioWorklet.addModule(blobUrl); } finally { URL.revokeObjectURL(blobUrl); }
  const workletNode = new AudioWorkletNode(ctx, 'bridge-recorder-processor');
  const destination = ctx.createMediaStreamDestination();
  workletNode.connect(destination);
  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) workletNode.port.postMessage(event.data, [event.data]);
  };
  ws.onclose = (e) => logger.warn('recorder.bridge-ws-closed', { code: e.code, reason: e.reason });
  const stream = destination.stream;
  stream._bridgeCtx = ctx; stream._bridgeWorklet = workletNode; stream._bridgeWs = ws;
  return stream;
}

export function useAudioRecorder({ onChunk }) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [silenceWarning, setSilenceWarning] = useState(false);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const levelRafRef = useRef(null);
  const lastLevelAtRef = useRef(0);
  const silenceStartRef = useRef(null);
  const peakLevelRef = useRef(0);
  const seqRef = useRef(0);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current);
    if (streamRef.current) {
      if (streamRef.current._bridgeWs) streamRef.current._bridgeWs.close();
      if (streamRef.current._bridgeCtx) {
        streamRef.current._bridgeCtx.close().catch(() => {});
        if (audioContextRef.current === streamRef.current._bridgeCtx) audioContextRef.current = null;
      }
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    peakLevelRef.current = 0;
    seqRef.current = 0;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startLevelMonitor = useCallback((stream) => {
    try {
      const audioContext = stream._bridgeCtx || new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const sample = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(dataArray);
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const centered = (dataArray[i] - 128) / 128;
          sumSquares += centered * centered;
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);
        const db = rms > 0 ? 20 * Math.log10(rms) : -60;
        const normalized = Math.max(0, Math.min(1, (db + 60) / 60));
        if (normalized > peakLevelRef.current) peakLevelRef.current = normalized;

        const now = performance.now();
        if (now - lastLevelAtRef.current >= LEVEL_SAMPLE_INTERVAL_MS) {
          lastLevelAtRef.current = now;
          setMicLevel(normalized);
          if (normalized < 0.02) {
            if (!silenceStartRef.current) silenceStartRef.current = now;
            if (now - silenceStartRef.current > SILENCE_WARNING_MS) {
              setSilenceWarning(prev => {
                if (!prev) logger.warn('recorder.silence-warning', { silenceDurationMs: Math.round(now - silenceStartRef.current) });
                return true;
              });
            }
          } else {
            silenceStartRef.current = null;
            setSilenceWarning(false);
          }
        }
        levelRafRef.current = requestAnimationFrame(sample);
      };
      levelRafRef.current = requestAnimationFrame(sample);
    } catch (err) {
      logger.warn('recorder.level-monitor-failed', { error: err.message });
    }
  }, []);

  const startRecording = useCallback(async () => {
    logger.info('recorder.start-requested');
    try {
      setError(null);
      setSilenceWarning(false);
      seqRef.current = 0;

      let stream;
      try {
        stream = await getBridgeStream();
        logger.info('recorder.bridge-acquired');
      } catch (bridgeErr) {
        logger.info('recorder.bridge-unavailable', { reason: bridgeErr.message });
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return;
        const seq = seqRef.current++;
        logger.info('recorder.chunk-emitted', { seq, bytes: e.data.size });
        if (onChunk) {
          Promise.resolve(onChunk({ seq, blob: e.data })).catch(err => {
            logger.error('recorder.onChunk-failed', { seq, error: err.message });
          });
        }
      };
      recorder.onerror = (e) => logger.error('recorder.media-recorder-error', { error: e.error?.message || 'unknown' });
      recorder.onstop = () => {
        logger.info('recorder.stopped', { duration: Math.round((Date.now() - startTimeRef.current) / 1000) });
        cleanup();
        setIsRecording(false);
        setMicLevel(0);
        setSilenceWarning(false);
      };

      startLevelMonitor(stream);
      startTimeRef.current = Date.now();
      setDuration(0);
      recorder.start(CHUNK_INTERVAL_MS);
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setDuration(Math.round((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      logger.info('recorder.started', { mimeType: 'audio/webm', chunkIntervalMs: CHUNK_INTERVAL_MS });
    } catch (err) {
      logger.error('recorder.start-failed', { error: err.message, name: err.name });
      setError(`Microphone error: ${err.message}`);
      cleanup();
    }
  }, [cleanup, startLevelMonitor, onChunk]);

  const stopRecording = useCallback(() => {
    const state = mediaRecorderRef.current?.state;
    logger.info('recorder.stop-requested', { recorderState: state });
    if (mediaRecorderRef.current && state === 'recording') {
      // Force final dataavailable before stop, so tail audio is captured
      try { mediaRecorderRef.current.requestData(); } catch {}
      mediaRecorderRef.current.stop();
    }
  }, []);

  return { isRecording, duration, micLevel, silenceWarning, error, startRecording, stopRecording };
}
