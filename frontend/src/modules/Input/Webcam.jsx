import React, { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useMediaDevices } from "./hooks/useMediaDevices";
import { useWebcamStream } from "./hooks/useWebcamStream";
import { DaylightAPI } from "../../lib/api.mjs";
import getLogger from "../../lib/logging/Logger.js";

// ── Strategy runners ─────────────────────────────────────────────────
// Each returns { cleanup, getName }. They write live results into a
// shared mutable object (liveRef) to avoid per-frame React setState.

function startAnalyserNode(stream, liveRef, log) {
  const name = 'analyserNode';
  const r = liveRef.current[name] = { rms: 0, maxRms: 0, samples: 0, status: 'starting', error: null, nonSilentCount: 0 };
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.fftSize);
    let rafId = null;
    r.status = 'running';
    log.info('diag-strategy-started', { strategy: name, ctxState: ctx.state, sampleRate: ctx.sampleRate });

    const tick = () => {
      analyser.getByteTimeDomainData(dataArray);
      let sumSquares = 0;
      let allSame = true;
      const first = dataArray[0];
      for (let i = 0; i < dataArray.length; i++) {
        const val = (dataArray[i] - 128) / 128;
        sumSquares += val * val;
        if (dataArray[i] !== first) allSame = false;
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);
      r.rms = rms;
      r.samples++;
      if (rms > r.maxRms) r.maxRms = rms;
      if (rms > 0.001) r.nonSilentCount++;
      if (r.samples % 300 === 0) {
        log.info('diag-sample', { strategy: name, rms: +(rms.toFixed(6)), maxRms: +(r.maxRms.toFixed(6)), samples: r.samples, nonSilent: r.nonSilentCount, allSame });
      }
      rafId = requestAnimationFrame(tick);
    };
    tick();
    return { cleanup: () => { if (rafId) cancelAnimationFrame(rafId); source.disconnect(); ctx.close().catch(() => {}); } };
  } catch (err) {
    r.status = 'error'; r.error = err.message;
    log.warn('diag-strategy-error', { strategy: name, error: err.message });
    return { cleanup: () => {} };
  }
}

function startAudioWorklet(stream, liveRef, log) {
  const name = 'audioWorklet';
  const r = liveRef.current[name] = { rms: 0, maxRms: 0, samples: 0, status: 'starting', error: null, nonSilentCount: 0 };
  let ctx, source, node;
  const setup = async () => {
    try {
      ctx = new AudioContext();
      if (!ctx.audioWorklet) throw new Error('audioWorklet not supported');
      const src = `
class DiagProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) {
      let sum = 0;
      for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
      this.port.postMessage({ rms: Math.sqrt(sum / ch.length) });
    }
    return true;
  }
}
registerProcessor('diag-processor', DiagProcessor);`;
      const blob = new Blob([src], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      source = ctx.createMediaStreamSource(stream);
      node = new AudioWorkletNode(ctx, 'diag-processor');
      source.connect(node);
      node.connect(ctx.destination);
      r.status = 'running';
      log.info('diag-strategy-started', { strategy: name, ctxState: ctx.state, sampleRate: ctx.sampleRate });
      node.port.onmessage = (e) => {
        const rms = e.data.rms;
        r.rms = rms;
        r.samples++;
        if (rms > r.maxRms) r.maxRms = rms;
        if (rms > 0.001) r.nonSilentCount++;
        if (r.samples % 250 === 0) {
          log.info('diag-sample', { strategy: name, rms: +(rms.toFixed(6)), maxRms: +(r.maxRms.toFixed(6)), samples: r.samples, nonSilent: r.nonSilentCount });
        }
      };
    } catch (err) {
      r.status = 'error'; r.error = err.message;
      log.warn('diag-strategy-error', { strategy: name, error: err.message });
    }
  };
  setup();
  return { cleanup: () => { try { node?.disconnect(); } catch {} try { source?.disconnect(); } catch {} ctx?.close().catch(() => {}); } };
}

function startScriptProcessor(stream, liveRef, log) {
  const name = 'scriptProcessor';
  const r = liveRef.current[name] = { rms: 0, maxRms: 0, samples: 0, status: 'starting', error: null, nonSilentCount: 0 };
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(2048, 1, 1);
    source.connect(processor);
    processor.connect(ctx.destination);
    r.status = 'running';
    log.info('diag-strategy-started', { strategy: name, ctxState: ctx.state, sampleRate: ctx.sampleRate });
    processor.onaudioprocess = (e) => {
      const samples = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);
      r.rms = rms;
      r.samples++;
      if (rms > r.maxRms) r.maxRms = rms;
      if (rms > 0.001) r.nonSilentCount++;
      if (r.samples % 250 === 0) {
        log.info('diag-sample', { strategy: name, rms: +(rms.toFixed(6)), maxRms: +(r.maxRms.toFixed(6)), samples: r.samples, nonSilent: r.nonSilentCount });
      }
    };
    return { cleanup: () => { processor.disconnect(); source.disconnect(); ctx.close().catch(() => {}); } };
  } catch (err) {
    r.status = 'error'; r.error = err.message;
    log.warn('diag-strategy-error', { strategy: name, error: err.message });
    return { cleanup: () => {} };
  }
}

function startRtcLoopback(stream, liveRef, log) {
  const name = 'rtcLoopback';
  const r = liveRef.current[name] = { rms: 0, maxRms: 0, samples: 0, status: 'starting', error: null, nonSilentCount: 0 };
  let stopped = false;
  let pollTimer = null;
  let pc1 = null, pc2 = null;

  const setup = async () => {
    try {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) throw new Error('No audio track in stream');

      pc1 = new RTCPeerConnection();
      pc2 = new RTCPeerConnection();
      pc1.addTrack(audioTrack, stream);

      pc1.onicecandidate = (e) => { if (e.candidate && !stopped) pc2.addIceCandidate(e.candidate).catch(() => {}); };
      pc2.onicecandidate = (e) => { if (e.candidate && !stopped) pc1.addIceCandidate(e.candidate).catch(() => {}); };

      const offer = await pc1.createOffer();
      await pc1.setLocalDescription(offer);
      await pc2.setRemoteDescription(offer);
      const answer = await pc2.createAnswer();
      await pc2.setLocalDescription(answer);
      await pc1.setRemoteDescription(answer);

      if (stopped) return;
      r.status = 'running';
      log.info('diag-strategy-started', { strategy: name, pc1State: pc1.connectionState, trackLabel: audioTrack.label, trackEnabled: audioTrack.enabled, trackMuted: audioTrack.muted });

      pollTimer = setInterval(async () => {
        if (stopped) return;
        try {
          const sender = pc1.getSenders().find(s => s.track?.kind === 'audio');
          if (!sender) return;
          const stats = await sender.getStats();
          stats.forEach((report) => {
            if (report.type === 'media-source' && report.kind === 'audio') {
              if (report.audioLevel !== undefined) {
                const level = report.audioLevel;
                r.rms = level;
                r.samples++;
                if (level > r.maxRms) r.maxRms = level;
                if (level > 0.001) r.nonSilentCount++;
                if (r.samples % 50 === 0) {
                  log.info('diag-sample', { strategy: name, rms: +(level.toFixed(6)), maxRms: +(r.maxRms.toFixed(6)), samples: r.samples, nonSilent: r.nonSilentCount, trackEnabled: sender.track?.enabled, trackMuted: sender.track?.muted });
                }
              }
            }
          });
        } catch { /* pc closed */ }
      }, 100);
    } catch (err) {
      r.status = 'error'; r.error = err.message;
      log.warn('diag-strategy-error', { strategy: name, error: err.message });
    }
  };
  setup();
  return { cleanup: () => { stopped = true; if (pollTimer) clearInterval(pollTimer); pc2?.close(); pc1?.close(); } };
}

function startMediaRecorder(stream, liveRef, log) {
  const name = 'mediaRecorder';
  const r = liveRef.current[name] = { rms: 0, maxRms: 0, samples: 0, status: 'starting', error: null, nonSilentCount: 0 };
  let stopped = false;
  let loopTimer = null;

  const runOnce = async () => {
    if (stopped) return;
    try {
      const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
      const mimeType = mimeTypes.find(m => MediaRecorder.isTypeSupported(m));
      if (!mimeType) throw new Error('No supported mime type');

      const audioStream = new MediaStream(stream.getAudioTracks());
      const recorder = new MediaRecorder(audioStream, { mimeType });
      const chunks = [];

      await new Promise((resolve) => {
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = resolve;
        recorder.onerror = () => resolve();
        recorder.start();
        setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 500);
      });

      if (chunks.length > 0) {
        const blob = new Blob(chunks, { type: mimeType });
        const arrayBuf = await blob.arrayBuffer();
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuf = await ctx.decodeAudioData(arrayBuf);
        const samples = audioBuf.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        const rms = Math.sqrt(sum / samples.length);
        ctx.close();

        r.rms = rms;
        r.samples++;
        if (rms > r.maxRms) r.maxRms = rms;
        if (rms > 0.001) r.nonSilentCount++;
        r.status = 'running';
        log.info('diag-sample', { strategy: name, rms: +(rms.toFixed(6)), maxRms: +(r.maxRms.toFixed(6)), samples: r.samples, nonSilent: r.nonSilentCount, mimeType, duration: audioBuf.duration, blobSize: blob.size });
      } else {
        r.samples++;
        r.rms = 0;
        r.status = 'running';
        log.info('diag-sample', { strategy: name, rms: 0, samples: r.samples, note: 'no-chunks' });
      }
    } catch (err) {
      r.status = 'error'; r.error = err.message;
      log.warn('diag-strategy-error', { strategy: name, error: err.message });
    }
  };

  // Run first probe, then repeat every 3s
  runOnce().then(() => {
    if (!stopped) loopTimer = setInterval(runOnce, 3000);
  });

  return { cleanup: () => { stopped = true; if (loopTimer) clearInterval(loopTimer); } };
}

/**
 * Strategy 6: Raw audio — separate getUserMedia with ALL processing disabled.
 * On Android, echoCancellation/noiseSuppression/autoGainControl processing
 * can zero out audio from USB devices. This tests the raw pipeline.
 */
function startRawAudio(deviceId, liveRef, log) {
  const name = 'rawAudio';
  const r = liveRef.current[name] = { rms: 0, maxRms: 0, samples: 0, status: 'starting', error: null, nonSilentCount: 0 };
  let ctx, source, processor, stream;

  const setup = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const track = stream.getAudioTracks()[0];
      const settings = track?.getSettings?.() || {};
      log.info('diag-strategy-started', {
        strategy: name,
        trackLabel: track?.label,
        settings,
        note: 'all-processing-disabled',
      });

      ctx = new AudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      source = ctx.createMediaStreamSource(stream);
      processor = ctx.createScriptProcessor(2048, 1, 1);
      source.connect(processor);
      processor.connect(ctx.destination);
      r.status = 'running';

      processor.onaudioprocess = (e) => {
        const samples = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        const rms = Math.sqrt(sum / samples.length);
        r.rms = rms;
        r.samples++;
        if (rms > r.maxRms) r.maxRms = rms;
        if (rms > 0.001) r.nonSilentCount++;
        if (r.samples % 250 === 0) {
          log.info('diag-sample', { strategy: name, rms: +(rms.toFixed(6)), maxRms: +(r.maxRms.toFixed(6)), samples: r.samples, nonSilent: r.nonSilentCount });
        }
      };
    } catch (err) {
      r.status = 'error'; r.error = err.message;
      log.warn('diag-strategy-error', { strategy: name, error: err.message });
    }
  };
  setup();
  return { cleanup: () => { try { processor?.disconnect(); } catch {} try { source?.disconnect(); } catch {} ctx?.close().catch(() => {}); stream?.getTracks().forEach(t => t.stop()); } };
}

/**
 * Strategy 7: Video+Audio combined getUserMedia (CAMCORDER source on Android).
 * When getUserMedia requests both video and audio, Android uses CAMCORDER
 * audio source instead of MIC. This tests that path specifically.
 */
function startCamcorderAudio(deviceId, liveRef, log) {
  const name = 'camcorderAudio';
  const r = liveRef.current[name] = { rms: 0, maxRms: 0, samples: 0, status: 'starting', error: null, nonSilentCount: 0 };
  let ctx, source, processor, stream;

  const setup = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: { deviceId: { exact: deviceId } },
      });
      const audioTrack = stream.getAudioTracks()[0];
      const videoTrack = stream.getVideoTracks()[0];
      log.info('diag-strategy-started', {
        strategy: name,
        audioLabel: audioTrack?.label,
        videoLabel: videoTrack?.label,
        audioSettings: audioTrack?.getSettings?.() || {},
        note: 'combined-video-audio-CAMCORDER-source',
      });

      ctx = new AudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      // Use audio-only MediaStream for AudioContext (avoids muted video element issues)
      source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
      processor = ctx.createScriptProcessor(2048, 1, 1);
      source.connect(processor);
      processor.connect(ctx.destination);
      r.status = 'running';

      processor.onaudioprocess = (e) => {
        const samples = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        const rms = Math.sqrt(sum / samples.length);
        r.rms = rms;
        r.samples++;
        if (rms > r.maxRms) r.maxRms = rms;
        if (rms > 0.001) r.nonSilentCount++;
        if (r.samples % 250 === 0) {
          log.info('diag-sample', { strategy: name, rms: +(rms.toFixed(6)), maxRms: +(r.maxRms.toFixed(6)), samples: r.samples, nonSilent: r.nonSilentCount });
        }
      };
    } catch (err) {
      r.status = 'error'; r.error = err.message;
      log.warn('diag-strategy-error', { strategy: name, error: err.message });
    }
  };
  setup();
  return { cleanup: () => { try { processor?.disconnect(); } catch {} try { source?.disconnect(); } catch {} ctx?.close().catch(() => {}); stream?.getTracks().forEach(t => t.stop()); } };
}

// ── Strategy display order ───────────────────────────────────────────

const STRATEGY_NAMES = ['analyserNode', 'scriptProcessor', 'audioWorklet', 'rtcLoopback', 'mediaRecorder', 'rawAudio', 'camcorderAudio'];
const STRATEGY_LABELS = {
  analyserNode: 'AnalyserNode (getByteTimeDomainData)',
  scriptProcessor: 'ScriptProcessorNode (onaudioprocess)',
  audioWorklet: 'AudioWorklet (MessagePort)',
  rtcLoopback: 'RTCPeerConnection (loopback stats)',
  mediaRecorder: 'MediaRecorder (record+decode)',
  rawAudio: 'Raw audio (no processing)',
  camcorderAudio: 'Video+Audio (CAMCORDER source)',
};

// ── Meter bar component ──────────────────────────────────────────────

function MeterRow({ name, label, data }) {
  if (!data) return null;
  const pct = Math.min((data.rms || 0) * 500, 100); // scale up for visibility
  const isActive = data.nonSilentCount > 0;
  const barColor = data.status === 'error' ? '#666' : isActive ? '#4caf50' : '#ff9800';
  const statusColor = data.status === 'error' ? '#f44336' : data.status === 'running' ? (isActive ? '#4caf50' : '#ff9800') : '#999';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontFamily: 'monospace', fontSize: 13 }}>
      <div style={{ width: 300, flexShrink: 0, color: '#ccc', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
        {label}
      </div>
      <div style={{ width: 120, flexShrink: 0, height: 16, background: '#333', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: barColor, transition: 'width 0.15s' }} />
      </div>
      <div style={{ width: 80, flexShrink: 0, color: '#eee', textAlign: 'right' }}>
        {(data.rms || 0).toFixed(5)}
      </div>
      <div style={{ width: 80, flexShrink: 0, color: '#aaa', textAlign: 'right', fontSize: 11 }}>
        max:{(data.maxRms || 0).toFixed(5)}
      </div>
      <div style={{ width: 60, flexShrink: 0, color: '#aaa', textAlign: 'right', fontSize: 11 }}>
        n={data.samples || 0}
      </div>
      <div style={{ width: 50, flexShrink: 0, color: '#aaa', textAlign: 'right', fontSize: 11 }}>
        hit={data.nonSilentCount || 0}
      </div>
      <div style={{ width: 60, flexShrink: 0, textAlign: 'center' }}>
        <span style={{ color: statusColor, fontSize: 11, fontWeight: 'bold' }}>
          {data.status === 'error' ? `ERR` : data.status}
        </span>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

export default function WebcamApp() {
  const logger = useMemo(() => getLogger().child({ component: 'WebcamDiag' }), []);

  // Fetch input preferences from device config
  const [inputPrefs, setInputPrefs] = useState({});
  useEffect(() => {
    DaylightAPI('api/v1/device/config')
      .then(config => {
        const devices = config?.devices || config || {};
        for (const dev of Object.values(devices)) {
          if (dev.input) { setInputPrefs(dev.input); break; }
        }
      })
      .catch(() => {});
  }, []);

  const {
    videoDevices, audioDevices,
    selectedVideoDevice, selectedAudioDevice,
    cycleVideoDevice, cycleAudioDevice,
  } = useMediaDevices({
    preferredCameraPattern: inputPrefs.preferred_camera,
    preferredMicPattern: inputPrefs.preferred_mic,
  });

  // Video only — no audio device passed, we manage audio separately
  const { videoRef, error: videoError } = useWebcamStream(selectedVideoDevice, null);

  // Live strategy results (mutable, not React state — updated at audio-frame rate)
  const liveRef = useRef({});
  // Display snapshot (React state — updated at 5 Hz for UI)
  const [display, setDisplay] = useState({});
  // Track metadata from acquired stream
  const [trackInfo, setTrackInfo] = useState(null);
  // Error acquiring stream
  const [streamError, setStreamError] = useState(null);

  // Refresh display from liveRef at 5 Hz
  useEffect(() => {
    const t = setInterval(() => {
      const snap = {};
      for (const key of STRATEGY_NAMES) {
        const src = liveRef.current[key];
        if (src) snap[key] = { ...src };
      }
      setDisplay(snap);
    }, 200);
    return () => clearInterval(t);
  }, []);

  // ── Run all strategies when audio device changes ───────────────────
  useEffect(() => {
    if (!selectedAudioDevice) return;

    let cancelled = false;
    const cleanups = [];
    liveRef.current = {};
    setDisplay({});
    setTrackInfo(null);
    setStreamError(null);

    const run = async () => {
      // Acquire audio stream
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: selectedAudioDevice } },
        });
      } catch (err) {
        setStreamError(err.message);
        logger.warn('diag-stream-acquire-failed', { deviceId: selectedAudioDevice, error: err.message });
        return;
      }

      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

      // Log track metadata
      const track = stream.getAudioTracks()[0];
      const info = {
        label: track?.label,
        enabled: track?.enabled,
        muted: track?.muted,
        readyState: track?.readyState,
        id: track?.id,
        contentHint: track?.contentHint || '(none)',
        constraints: track?.getConstraints?.() || {},
        settings: track?.getSettings?.() || {},
        capabilities: track?.getCapabilities?.() || {},
      };
      setTrackInfo(info);
      logger.info('diag-stream-acquired', { deviceId: selectedAudioDevice, track: info });

      // Start all 5 shared-stream strategies in parallel
      cleanups.push(startAnalyserNode(stream, liveRef, logger));
      cleanups.push(startScriptProcessor(stream, liveRef, logger));
      cleanups.push(startAudioWorklet(stream, liveRef, logger));
      cleanups.push(startRtcLoopback(stream, liveRef, logger));
      cleanups.push(startMediaRecorder(stream, liveRef, logger));

      // Start strategies that acquire their own streams
      cleanups.push(startRawAudio(selectedAudioDevice, liveRef, logger));
      cleanups.push(startCamcorderAudio(selectedAudioDevice, liveRef, logger));

      // Store stream for cleanup
      cleanups.push({ cleanup: () => stream.getTracks().forEach(t => t.stop()) });
    };

    run();

    return () => {
      cancelled = true;
      cleanups.forEach(c => c.cleanup());
    };
  }, [selectedAudioDevice, logger]);

  // ── Keyboard ───────────────────────────────────────────────────────
  const handleKey = useCallback((e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); cycleVideoDevice('next'); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); cycleVideoDevice('prev'); }
    else if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault(); cycleAudioDevice('next');
    }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cycleAudioDevice('prev'); }
  }, [cycleVideoDevice, cycleAudioDevice]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  // ── Current device info ────────────────────────────────────────────
  const currentAudioDev = audioDevices.find(d => d.deviceId === selectedAudioDevice);
  const audioIdx = audioDevices.findIndex(d => d.deviceId === selectedAudioDevice);

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#1a1a1a', color: '#eee', fontFamily: 'system-ui, sans-serif', overflow: 'hidden' }}>

      {/* Video preview — small corner */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ position: 'absolute', top: 8, right: 8, width: 200, height: 150, objectFit: 'cover', borderRadius: 6, border: '2px solid #444', zIndex: 2, transform: 'scaleX(-1)' }}
      />
      {videoError && (
        <div style={{ position: 'absolute', top: 8, right: 8, width: 200, background: '#c62828', color: '#fff', padding: 4, fontSize: 11, zIndex: 3, borderRadius: 4 }}>
          Video: {videoError.message}
        </div>
      )}

      {/* Diagnostic panel */}
      <div style={{ padding: '12px 16px', position: 'relative', zIndex: 1 }}>

        {/* Header */}
        <div style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 8, color: '#90caf9' }}>
          Audio Capture Diagnostic
        </div>

        {/* Device selector */}
        <div style={{ background: '#263238', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ color: '#78909c', fontSize: 12 }}>AUDIO DEVICE ({audioIdx + 1}/{audioDevices.length})</span>
              <div style={{ fontSize: 16, fontWeight: 'bold', color: '#fff', marginTop: 2 }}>
                {currentAudioDev?.label || selectedAudioDevice?.slice(0, 16) || 'None'}
              </div>
              <div style={{ fontSize: 11, color: '#78909c', marginTop: 2 }}>
                ID: {selectedAudioDevice?.slice(0, 24)}...
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 11, color: '#78909c' }}>
              <div>Space/Enter/Down = next</div>
              <div>Up = prev</div>
            </div>
          </div>
        </div>

        {/* Track metadata */}
        {trackInfo && (
          <div style={{ background: '#1b2a33', borderRadius: 4, padding: '6px 10px', marginBottom: 10, fontSize: 11, color: '#90a4ae', fontFamily: 'monospace' }}>
            <span>track: </span>
            <span style={{ color: trackInfo.enabled ? '#4caf50' : '#f44336' }}>enabled={String(trackInfo.enabled)}</span>
            {' | '}
            <span style={{ color: trackInfo.muted ? '#f44336' : '#4caf50' }}>muted={String(trackInfo.muted)}</span>
            {' | '}
            <span>state={trackInfo.readyState}</span>
            {' | '}
            <span>label="{trackInfo.label}"</span>
            {trackInfo.settings.sampleRate && <span> | rate={trackInfo.settings.sampleRate}</span>}
            {trackInfo.settings.channelCount && <span> | ch={trackInfo.settings.channelCount}</span>}
          </div>
        )}

        {streamError && (
          <div style={{ background: '#4a1010', borderRadius: 4, padding: '6px 10px', marginBottom: 10, fontSize: 13, color: '#ef9a9a' }}>
            Stream error: {streamError}
          </div>
        )}

        {/* Strategy meters */}
        <div style={{ background: '#212121', borderRadius: 6, padding: '8px 12px' }}>
          <div style={{ fontSize: 12, color: '#78909c', marginBottom: 6, borderBottom: '1px solid #333', paddingBottom: 4 }}>
            LIVE STRATEGY COMPARISON — all running simultaneously on same stream
          </div>
          {STRATEGY_NAMES.map(name => (
            <MeterRow key={name} name={name} label={STRATEGY_LABELS[name]} data={display[name]} />
          ))}
        </div>

        {/* All devices list */}
        <div style={{ marginTop: 12, background: '#1b2a33', borderRadius: 6, padding: '8px 12px' }}>
          <div style={{ fontSize: 12, color: '#78909c', marginBottom: 4 }}>ALL AUDIO DEVICES</div>
          {audioDevices.map((d, i) => (
            <div key={d.deviceId} style={{
              fontSize: 12, fontFamily: 'monospace', padding: '2px 0',
              color: d.deviceId === selectedAudioDevice ? '#4caf50' : '#90a4ae',
              fontWeight: d.deviceId === selectedAudioDevice ? 'bold' : 'normal',
            }}>
              {d.deviceId === selectedAudioDevice ? '>' : ' '} [{i + 1}] {d.label || '(no label)'} — {d.deviceId.slice(0, 16)}...
            </div>
          ))}
          {audioDevices.length === 0 && <div style={{ fontSize: 12, color: '#f44336' }}>No audio devices found</div>}
        </div>
      </div>
    </div>
  );
}
