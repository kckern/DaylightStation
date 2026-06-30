import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../../lib/logging/Logger.js';
import { pickBuiltInMic, buildMicConstraints } from '../effectAudit/micSelect.js';
import { uploadClip, uploadManifest } from '../effectAudit/upload.js';
import { STIMULUS, recordTotalMs } from '../effectAudit/matrix.js';
import { buildCandidates, candidateNeedsSysex } from './candidates.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLUSH_MS = 30;     // BLE one-turn-late flush re-send (matches useWebMidiBLE)
const SPACING_MS = 90;   // gap between control messages so BLE can't coalesce them
const SETTLE_MS = 500;   // after applying a setup, before recording
const NOTE = STIMULUS.note;
const VEL = STIMULUS.velocity;

function recordFor(stream, ms) {
  return new Promise((resolve, reject) => {
    let rec;
    try { rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' }); }
    catch (e) { reject(e); return; }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = (e) => reject(e.error || new Error('recorder error'));
    rec.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));
    rec.start();
    setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, ms);
  });
}

/** Open a MIDI output, preferring SysEx access; fall back to non-sysex. */
async function openOutput() {
  const pick = (access) => {
    const outs = [...access.outputs.values()];
    return outs.find((o) => /widi|bluetooth|midi/i.test(o.name)) || outs[0] || null;
  };
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  try {
    const access = await withTimeout(navigator.requestMIDIAccess({ sysex: true }), 8000);
    const out = pick(access);
    if (out) { await out.open(); return { out, sysex: true }; }
  } catch (e) { /* fall through to non-sysex */ }
  const access = await navigator.requestMIDIAccess({ sysex: false });
  const out = pick(access);
  if (!out) throw new Error('no MIDI output found');
  await out.open();
  return { out, sysex: false };
}

/** EffectProbe — sweep reverb/chorus command candidates, record dry+wet, upload. */
export function EffectProbe({ autoRun = false }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-effect-probe' }), []);
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState('');
  const [progress, setProgress] = useState({ i: 0, n: 0 });
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    const runId = `probe-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    logger.info('effect-probe.start', { runId });
    let stream;
    try {
      setStatus('preflight'); setDetail('Opening MIDI (SysEx)…');
      const { out, sysex } = await openOutput();
      logger.info('effect-probe.midi', { output: out.name, sysex });

      setDetail('Opening microphone…');
      const perm = await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const micId = pickBuiltInMic(devices);
      perm.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia(buildMicConstraints(micId));
      logger.info('effect-probe.mic', { micId });

      // Reliable framed control send (flush re-send + spacing).
      const framed = (msg) => { out.send(msg); setTimeout(() => { try { out.send(msg); } catch { /* closed */ } }, FLUSH_MS); };
      const apply = async (msgs) => { for (const m of msgs) { framed(m); await sleep(SPACING_MS); } };
      const playNote = () => {
        out.send([0x90, NOTE, VEL]);
        out.send([0x80, NOTE, 0], (performance?.now?.() ?? 0) + STIMULUS.offMs);
      };
      const recordOne = async (label, msgs) => {
        await apply(msgs);
        await sleep(SETTLE_MS);
        const recording = recordFor(stream, recordTotalMs());
        await sleep(STIMULUS.recordLeadMs);
        playNote();
        const blob = await recording;
        await uploadClip(runId, label, blob);
        return blob.size;
      };

      const candidates = buildCandidates();
      const usable = candidates.filter((c) => sysex || !candidateNeedsSysex(c));
      const skipped = candidates.filter((c) => !sysex && candidateNeedsSysex(c)).map((c) => c.id);
      const clips = [];
      setProgress({ i: 0, n: usable.length * 2 });
      let done = 0;
      for (const c of candidates) {
        if (!sysex && candidateNeedsSysex(c)) { logger.warn('effect-probe.skip', { id: c.id, reason: 'no-sysex' }); continue; }
        for (const phase of ['dry', 'wet']) {
          const label = `${c.id}-${phase}`;
          setStatus('recording'); setDetail(`${c.label} (${phase})`);
          const bytes = await recordOne(label, c[phase]);
          clips.push({ label, candidate: c.id, kind: c.kind, phase, bytes });
          setProgress({ i: ++done, n: usable.length * 2 });
          logger.info('effect-probe.clip', { label, bytes });
        }
        // All Sound Off + reset effect sends between candidates.
        out.send([0xb0, 120, 0]); out.send([0xb0, 123, 0]);
      }

      stream.getTracks().forEach((t) => t.stop());
      await uploadManifest(runId, {
        runId, kind: 'effect-probe', sysex, startedAt: runId,
        stimulus: { ...STIMULUS, noteOnAtMs: STIMULUS.recordLeadMs, noteOffAtMs: STIMULUS.recordLeadMs + STIMULUS.offMs },
        skipped, clips,
      });
      setStatus('done'); setDetail(`${clips.length} clips · sysex=${sysex} · skipped ${skipped.length} · ${runId}`);
      logger.info('effect-probe.done', { runId, clips: clips.length, sysex, skipped });
    } catch (e) {
      setStatus('fail'); setDetail(String(e.message || e));
      logger.error('effect-probe.fail', { error: String(e.message || e) });
      try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    } finally {
      runningRef.current = false;
    }
  }, [logger]);

  useEffect(() => { if (autoRun) run(); }, [autoRun, run]);

  const color = { idle: '#888', preflight: '#06c', recording: '#0a0', done: '#0a0', fail: '#c00' }[status] || '#888';
  return (
    <div style={{ fontFamily: 'monospace', padding: 32, color: '#fff', background: '#111', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 40 }}>Effect Probe</h1>
      <div style={{ fontSize: 60, fontWeight: 'bold', color }}>{status.toUpperCase()}</div>
      <div style={{ fontSize: 30, margin: '16px 0' }}>{progress.n ? `${progress.i} / ${progress.n}` : ''}</div>
      <div style={{ fontSize: 26, wordBreak: 'break-all' }}>{detail}</div>
      {!autoRun && status !== 'recording' && (
        <button type="button" onClick={run} style={{ marginTop: 24, fontSize: 26, padding: '12px 24px' }}>Start probe</button>
      )}
    </div>
  );
}

export default EffectProbe;
