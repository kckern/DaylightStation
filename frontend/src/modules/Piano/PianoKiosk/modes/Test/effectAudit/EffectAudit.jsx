import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../../lib/logging/Logger.js';
import { usePianoMidi } from '../../../PianoMidiContext.jsx';
import { usePianoSound } from '../../../PianoSoundContext.jsx';
import { buildAuditMatrix, buildStimulus, recordTotalMs, STIMULUS } from './matrix.js';
import { pickBuiltInMic, buildMicConstraints } from './micSelect.js';
import { uploadClip, uploadManifest } from './upload.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SETTLE_MS = 500;       // after CC/voice before recording
const CC_VOLUME = 7;         // channel volume — set high for SNR

function recordFor(stream, ms) {
  return new Promise((resolve, reject) => {
    let rec;
    try {
      rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    } catch (e) { reject(e); return; }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = (e) => reject(e.error || new Error('recorder error'));
    rec.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));
    rec.start();
    setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, ms);
  });
}

/**
 * EffectAudit — autonomous sweep: for each permutation, apply the effect via
 * MIDI CC, play a fixed staccato note, record the mic, upload the clip. Renders
 * large status text so a Fully Kiosk screenshot reveals run state.
 */
export function EffectAudit({ autoRun = false }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-effect-audit' }), []);
  const midi = usePianoMidi();
  const { device } = usePianoSound();
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState('');
  const [progress, setProgress] = useState({ i: 0, n: 0 });
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    logger.info('effect-audit.start', { runId });
    try {
      // Preflight: MIDI.
      setStatus('preflight'); setDetail('Checking MIDI output…');
      if (!midi.connected) throw new Error('MIDI not connected (WIDI Master offline?)');
      const effects = device?.effects;
      if (!effects) throw new Error('No device profile / effects (config.device unset?)');

      // Preflight: mic. First request permission, then pin the built-in input.
      setDetail('Opening microphone…');
      let permStream;
      try {
        permStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) { throw new Error(`mic permission denied: ${e.name || e.message}`); }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const micId = pickBuiltInMic(devices);
      logger.info('effect-audit.mic', { micId, labels: devices.filter((d) => d.kind === 'audioinput').map((d) => d.label) });
      permStream.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia(buildMicConstraints(micId));

      // Un-mute onboard voice + set a consistent capture volume.
      midi.sendLocalControl(true);
      midi.sendControlChange(CC_VOLUME, 110);

      const matrix = buildAuditMatrix(effects);
      setProgress({ i: 0, n: matrix.length });
      const stimulus = buildStimulus();
      const clips = [];

      for (let i = 0; i < matrix.length; i++) {
        const setup = matrix[i];
        setStatus('recording');
        setDetail(setup.label);
        setProgress({ i: i + 1, n: matrix.length });

        // Apply the setup: voice, then every CC — spaced so the BLE peripheral
        // can't coalesce/defer them (the one-turn-late bug; sendControlChange
        // now also flushes each CC).
        midi.sendVoice(setup.voice.pc, setup.voice.bank || 0);
        await sleep(90);
        for (const cc of setup.cc) { midi.sendControlChange(cc.controller, cc.value); await sleep(90); }
        await sleep(SETTLE_MS);

        // Record; fire the stimulus recordLeadMs into the recording.
        const recording = recordFor(stream, recordTotalMs());
        await sleep(STIMULUS.recordLeadMs);
        midi.scheduleNotes(stimulus);
        const blob = await recording;

        await uploadClip(runId, setup.label, blob);
        logger.info('effect-audit.clip', { label: setup.label, bytes: blob.size });
        clips.push({
          label: setup.label, group: setup.group,
          voicePc: setup.voice.pc, cc: setup.cc, bytes: blob.size,
        });
        midi.sendPanic();
      }

      // Teardown: effects off, manifest.
      midi.sendControlChange(effects.reverb.levelCC, 0);
      midi.sendControlChange(effects.chorus.levelCC, 0);
      midi.sendPanic();
      stream.getTracks().forEach((t) => t.stop());

      await uploadManifest(runId, {
        runId,
        device: device?.id || 'unknown',
        startedAt: runId,
        stimulus: { ...STIMULUS, noteOnAtMs: STIMULUS.recordLeadMs, noteOffAtMs: STIMULUS.recordLeadMs + STIMULUS.offMs },
        clips,
      });

      setStatus('done'); setDetail(`${clips.length} clips uploaded — runId ${runId}`);
      logger.info('effect-audit.done', { runId, clips: clips.length });
    } catch (e) {
      setStatus('fail'); setDetail(String(e.message || e));
      logger.error('effect-audit.fail', { error: String(e.message || e) });
    } finally {
      runningRef.current = false;
    }
  }, [midi, device, logger]);

  useEffect(() => { if (autoRun) run(); }, [autoRun, run]);

  const color = { idle: '#888', preflight: '#06c', recording: '#0a0', done: '#0a0', fail: '#c00' }[status] || '#888';
  return (
    <div style={{ fontFamily: 'monospace', padding: 32, color: '#fff', background: '#111', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 40 }}>Effect Audit</h1>
      <div style={{ fontSize: 64, fontWeight: 'bold', color }}>{status.toUpperCase()}</div>
      <div style={{ fontSize: 32, margin: '16px 0' }}>{progress.n ? `${progress.i} / ${progress.n}` : ''}</div>
      <div style={{ fontSize: 28, wordBreak: 'break-all' }}>{detail}</div>
      {!autoRun && status !== 'recording' && (
        <button type="button" onClick={run} style={{ marginTop: 24, fontSize: 28, padding: '12px 24px' }}>
          Start audit
        </button>
      )}
    </div>
  );
}

export default EffectAudit;
