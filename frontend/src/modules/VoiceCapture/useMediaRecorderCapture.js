import { useState, useRef, useCallback, useEffect } from 'react';
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

export function useMediaRecorderCapture() {
  const [isRecording, setIsRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState(null);
  const levelRef = useRef(0); // 0..1, read by the VU meter via rAF

  const mrRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startRef = useRef(0);
  const timerRef = useRef(null);
  const ctxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const mimeRef = useRef('audio/webm');
  const resolveRef = useRef(null);

  const teardown = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    analyserRef.current = null;
    if (ctxRef.current) { ctxRef.current.close?.().catch(() => {}); ctxRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    levelRef.current = 0;
  }, []);

  useEffect(() => teardown, [teardown]);

  const monitorLevel = useCallback((stream) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const sample = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const c = (buf[i] - 128) / 128; sum += c * c; }
        const rms = Math.sqrt(sum / buf.length);
        const db = rms > 0 ? 20 * Math.log10(rms) : -60;
        levelRef.current = Math.max(0, Math.min(1, (db + 60) / 60));
        rafRef.current = requestAnimationFrame(sample);
      };
      rafRef.current = requestAnimationFrame(sample);
    } catch (err) {
      logger().warn('voice.capture.level-monitor-failed', { error: err.message });
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    chunksRef.current = [];
    try {
      // Pin the built-in mic and disable EC/NS/AGC so Android uses the MIC source
      // (not VOICE_COMMUNICATION → BT SCO, which captures a silent Bluetooth mic).
      const builtInId = await preferBuiltInMic();
      const audioConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(builtInId ? { deviceId: { exact: builtInId } } : {}),
      };
      logger().info('voice.capture.mic-select', { pinnedBuiltIn: !!builtInId });
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (constraintErr) {
        // Exact-device constraint can fail (device vanished); retry permissively.
        logger().warn('voice.capture.mic-constraint-fallback', { error: constraintErr.name });
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      }
      streamRef.current = stream;
      const mimeType = pickMime();
      mimeRef.current = mimeType;
      const mr = new MediaRecorder(stream, { mimeType });
      mrRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        const dur = Date.now() - startRef.current;
        teardown();
        setIsRecording(false);
        logger().info('voice.capture.recorded', { durationMs: dur, bytes: blob.size, mimeType: mimeRef.current });
        const resolve = resolveRef.current;
        resolveRef.current = null;
        if (resolve) resolve({ blob, durationMs: dur, mimeType: mimeRef.current });
      };
      mr.onerror = (e) => { logger().error('voice.capture.recorder-error', { error: e.error?.message || 'unknown' }); };

      monitorLevel(stream);
      startRef.current = Date.now();
      setDurationMs(0);
      mr.start();
      setIsRecording(true);
      timerRef.current = setInterval(() => setDurationMs(Date.now() - startRef.current), 200);
      logger().info('voice.capture.record-start', { mimeType });
    } catch (err) {
      logger().error('voice.capture.record-start-failed', { error: err.message, name: err.name });
      setError(err.name === 'NotAllowedError' ? 'Microphone permission denied.' : `Mic error: ${err.message}`);
      teardown();
      setIsRecording(false);
    }
  }, [monitorLevel, teardown]);

  // Resolves with the finished recording once MediaRecorder flushes.
  const stop = useCallback(() => new Promise((resolve) => {
    const mr = mrRef.current;
    if (!mr || mr.state === 'inactive') { resolve(null); return; }
    resolveRef.current = resolve;
    try { mr.requestData(); } catch { /* ignore */ }
    try { mr.stop(); } catch { resolve(null); }
  }), []);

  return { isRecording, durationMs, levelRef, error, start, stop };
}

export default useMediaRecorderCapture;
