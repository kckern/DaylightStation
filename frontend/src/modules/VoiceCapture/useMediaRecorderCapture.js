import { useState, useRef, useCallback, useLayoutEffect } from 'react';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'voice-capture-recorder' });
  return _logger;
}

// One-shot voice recorder for the app-wide feedback panel. Simpler than the
// WeeklyReview recorder (no AudioBridge / chunk streaming): getUserMedia →
// MediaRecorder accumulating into a single Blob, with a live mic level (read via
// a ref so the VU meter never re-renders the tree) and an elapsed timer. stop()
// resolves the finished { blob, durationMs, mimeType }.
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
function pickMime() {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  for (const m of MIME_CANDIDATES) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* ignore */ }
  }
  return 'audio/webm';
}

// On Bluetooth-equipped kiosks (e.g. the piano tablet with a BT audio link), a
// plain getUserMedia({audio:true}) routes to the BT headset's SCO mic — which is
// silent — because requesting echoCancellation puts Android in communication mode
// and it prefers the connected headset. Two things avoid that: (1) explicitly pin
// a built-in / non-Bluetooth input device, and (2) drop EC/NS/AGC so Android uses
// the plain MIC source instead of VOICE_COMMUNICATION (no SCO). Labels are only
// populated after a prior mic grant; on a kiosk where permission persists they're
// already available.
async function preferBuiltInMic() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    const isBT = (l) => /bluetooth|headset|\bsco\b|hands?-?free/i.test(l || '');
    const isBuiltin = (l) => /built|speakerphone|internal|primary/i.test(l || '');
    const pick = inputs.find((d) => isBuiltin(d.label) && !isBT(d.label))
      || inputs.find((d) => d.label && !isBT(d.label));
    return pick ? pick.deviceId : null;
  } catch { return null; }
}

function stopTracks(stream) {
  stream?.getTracks().forEach(track => track.stop());
}

function monitorLevel(capture, levelRef) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    capture.context = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(capture.stream).connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const sample = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const value of buf) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / buf.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -60;
      levelRef.current = Math.max(0, Math.min(1, (db + 60) / 60));
      capture.frame = requestAnimationFrame(sample);
    };
    capture.frame = requestAnimationFrame(sample);
  } catch (err) {
    logger().warn('voice.capture.level-monitor-failed', { error: err.message });
  }
}

export function useMediaRecorderCapture({ active = true } = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState(null);
  const levelRef = useRef(0); // 0..1, read by the VU meter via rAF
  const ownerRef = useRef(null);

  const release = useCallback((owner) => {
    const capture = owner.capture;
    owner.capture = null;
    if (!capture) return;
    if (capture.timer != null) clearInterval(capture.timer);
    if (capture.frame != null) cancelAnimationFrame(capture.frame);
    const recorder = capture.recorder;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* already stopped */ }
      }
    }
    stopTracks(capture.stream);
    capture.context?.close?.().catch(() => {});
    levelRef.current = 0;
    capture.resolve?.(null);
  }, []);

  useLayoutEffect(() => {
    if (!active) {
      setIsRecording(false);
      return;
    }
    const owner = { capture: null };
    ownerRef.current = owner;
    return () => {
      ownerRef.current = null;
      release(owner);
    };
  }, [active, release]);

  const start = useCallback(async () => {
    const owner = ownerRef.current;
    if (!owner || owner.capture) return;
    const capture = { chunks: [] };
    owner.capture = capture;
    const ownsCapture = () => ownerRef.current === owner && owner.capture === capture;
    setError(null);
    try {
      // Pin the built-in mic and disable EC/NS/AGC so Android uses the MIC source
      // (not VOICE_COMMUNICATION → BT SCO, which captures a silent Bluetooth mic).
      const builtInId = await preferBuiltInMic();
      if (!ownsCapture()) return;
      const audio = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };
      const preferredAudio = builtInId ? { ...audio, deviceId: { exact: builtInId } } : audio;
      logger().info('voice.capture.mic-select', { pinnedBuiltIn: !!builtInId });
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: preferredAudio });
      } catch (constraintErr) {
        if (!ownsCapture()) return;
        // Exact-device constraint can fail (device vanished); retry permissively.
        logger().warn('voice.capture.mic-constraint-fallback', { error: constraintErr.name });
        stream = await navigator.mediaDevices.getUserMedia({ audio });
      }
      // Permission may resolve after the capture owner has gone away.
      if (!ownsCapture()) { stopTracks(stream); return; }
      capture.stream = stream;
      const mimeType = pickMime();
      const recorder = new MediaRecorder(stream, { mimeType });
      capture.recorder = recorder;
      recorder.ondataavailable = (e) => {
        if (ownsCapture() && e.data?.size) capture.chunks.push(e.data);
      };
      recorder.onstop = () => {
        if (!ownsCapture()) return;
        const blob = new Blob(capture.chunks, { type: mimeType });
        const durationMs = Date.now() - capture.startedAt;
        const resolve = capture.resolve;
        capture.resolve = null;
        release(owner);
        setIsRecording(false);
        logger().info('voice.capture.recorded', { durationMs, bytes: blob.size, mimeType });
        resolve?.({ blob, durationMs, mimeType });
      };
      recorder.onerror = (e) => {
        if (ownsCapture()) logger().error('voice.capture.recorder-error', { error: e.error?.message || 'unknown' });
      };

      monitorLevel(capture, levelRef);
      capture.startedAt = Date.now();
      setDurationMs(0);
      recorder.start();
      setIsRecording(true);
      capture.timer = setInterval(() => setDurationMs(Date.now() - capture.startedAt), 200);
      logger().info('voice.capture.record-start', { mimeType });
    } catch (err) {
      if (!ownsCapture()) return;
      logger().error('voice.capture.record-start-failed', { error: err.message, name: err.name });
      setError(err.name === 'NotAllowedError' ? 'Microphone permission denied.' : `Mic error: ${err.message}`);
      release(owner);
      setIsRecording(false);
    }
  }, [release]);

  // Resolves with the finished recording once MediaRecorder flushes.
  const stop = useCallback(() => new Promise((resolve) => {
    const owner = ownerRef.current;
    const capture = owner?.capture;
    const recorder = capture?.recorder;
    if (!recorder || recorder.state === 'inactive' || capture.resolve) { resolve(null); return; }
    capture.resolve = resolve;
    try { recorder.requestData(); } catch { /* ignore */ }
    try { recorder.stop(); } catch {
      release(owner);
      setIsRecording(false);
    }
  }), [release]);

  return { isRecording, durationMs, levelRef, error, start, stop };
}

export default useMediaRecorderCapture;
