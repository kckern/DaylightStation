import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../../lib/logging/Logger.js';
import { pickBuiltInMic, buildMicConstraints } from '../effectAudit/micSelect.js';
import { uploadClip, uploadManifest } from '../effectAudit/upload.js';
import { STIMULUS, recordTotalMs } from '../effectAudit/matrix.js';
import { buildCandidates, candidateNeedsSysex } from './candidates.js';
import { GS_RESET, gsReverbMacro, gsReverbLevel, GS_RQ_REVERB_MACRO, GS_RQ_REVERB_LEVEL } from './sysex.js';

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

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

/** Open MIDI access (in+out), preferring SysEx; fall back to non-sysex. */
async function openAccess() {
  const pickOut = (a) => { const o = [...a.outputs.values()]; return o.find((x) => /widi|bluetooth|midi/i.test(x.name)) || o[0] || null; };
  const pickIn = (a) => { const i = [...a.inputs.values()]; return i.find((x) => /widi|bluetooth|midi/i.test(x.name)) || i[0] || null; };
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  let access; let sysex = false;
  try { access = await withTimeout(navigator.requestMIDIAccess({ sysex: true }), 60000); sysex = true; }
  catch (e) { access = await navigator.requestMIDIAccess({ sysex: false }); sysex = false; }
  const out = pickOut(access); const input = pickIn(access);
  if (!out) throw new Error('no MIDI output found');
  await out.open();
  if (input) await input.open();
  return { out, input, sysex };
}

/**
 * Attach a SysEx-aware inbound monitor: reassembles F0..F7 frames (Web MIDI may
 * chunk them) and reports every SysEx + interesting CC. Returns a stop fn.
 */
function monitorInput(input, logger, sink) {
  if (!input) return () => {};
  let buf = null;
  input.onmidimessage = (ev) => {
    const d = ev.data;
    if (d[0] === 0xf0) buf = [...d];
    else if (buf) buf.push(...d);
    else {
      const status = d[0] & 0xf0;
      if (status === 0xb0) { logger.info('effect-probe.in.cc', { cc: d[1], value: d[2] }); sink.cc.push({ cc: d[1], value: d[2] }); }
      return;
    }
    if (buf && buf[buf.length - 1] === 0xf7) {
      const h = hex(buf);
      // Identity Reply: F0 7E <ch> 06 02 <mfr…> F7
      const isIdentity = buf[1] === 0x7e && buf[3] === 0x06 && buf[4] === 0x02;
      logger.info('effect-probe.in.sysex', { bytes: h, identity: isIdentity });
      sink.sysex.push({ bytes: h, identity: isIdentity });
      buf = null;
    }
  };
  return () => { try { input.onmidimessage = null; } catch { /* noop */ } };
}

/** EffectProbe — sweep reverb/chorus command candidates, record dry+wet, upload. */
export function EffectProbe({ autoRun = false, monitor = false }) {
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
      const { out, input, sysex } = await openAccess();
      logger.info('effect-probe.midi', { output: out.name, input: input?.name, sysex });
      const inbound = { sysex: [], cc: [] };
      const stopMonitor = monitorInput(input, logger, inbound);

      // Identity Request — confirms SysEx round-trips over BLE and reveals the
      // device's real manufacturer/family/model (decides GS vs XG vs proprietary).
      let identity = null;
      if (sysex) {
        setDetail('Identity request…');
        out.send([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);
        await sleep(1200);
        identity = inbound.sysex.find((s) => s.identity)?.bytes || null;
        logger.info('effect-probe.identity', { identity, sysexSeen: inbound.sysex.length });
      }

      // GS read-back probe: set a KNOWN reverb value, then RQ1-query it. A DT1
      // reply (F0 41 10 42 12 …) means the piano supports synchronous state
      // read-back — enabling set→verify→retry instead of fire-and-forget.
      let readback = null;
      if (sysex) {
        setDetail('GS read-back (RQ1) probe…');
        inbound.sysex.length = 0;
        out.send(GS_RESET); await sleep(150);
        out.send(gsReverbMacro(8)); await sleep(150);   // Plate
        out.send(gsReverbLevel(100)); await sleep(250);
        out.send(GS_RQ_REVERB_MACRO); await sleep(200);
        out.send(GS_RQ_REVERB_LEVEL); await sleep(900);
        readback = { sent: { macro: 8, level: 100 }, replies: inbound.sysex.map((s) => s.bytes) };
        logger.info('effect-probe.readback', readback);
      }

      // MONITOR mode: skip the sweep; just watch inbound MIDI for 90s while the
      // user changes settings on the piano's PHYSICAL panel. Answers "does the
      // piano transmit its state when you change it?" (listen-and-reconcile).
      if (monitor) {
        inbound.sysex.length = 0; inbound.cc.length = 0;
        const seen = [];
        if (input) input.onmidimessage = (ev) => {
          const d = ev.data; const h = hex(d);
          seen.push(h);
          const st = d[0] & 0xf0;
          if (d[0] === 0xf0) logger.info('effect-probe.mon.sysex', { bytes: h });
          else if (st === 0xc0) logger.info('effect-probe.mon.programchange', { program: d[1] });
          else if (st === 0xb0) logger.info('effect-probe.mon.cc', { cc: d[1], value: d[2] });
          else if (st === 0x90 || st === 0x80) { /* notes — confirms return path */ }
          else logger.info('effect-probe.mon.other', { bytes: h });
        };
        const t0 = performance?.now?.() ?? 0;
        while ((performance?.now?.() ?? 0) - t0 < 90000) {
          const notes = seen.filter((h) => /^[89]/.test(h)).length;
          setStatus('recording'); setDetail(`MONITOR ${Math.round(90 - ((performance?.now?.() ?? 0) - t0) / 1000)}s · play a note + change a PANEL setting · msgs=${seen.length} notes=${notes}`);
          await sleep(1000);
        }
        stopMonitor();
        stream.getTracks().forEach((t) => t.stop());
        await uploadManifest(runId, { runId, kind: 'effect-probe-monitor', sysex, identity, readback, seen });
        setStatus('done'); setDetail(`MONITOR done · ${seen.length} inbound msgs · runId ${runId}`);
        logger.info('effect-probe.monitor-done', { runId, count: seen.length, identity, readback });
        return;
      }

      setDetail('Opening microphone…');
      const perm = await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const micId = pickBuiltInMic(devices);
      perm.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia(buildMicConstraints(micId));
      logger.info('effect-probe.mic', { micId });

      // Reliable framed control send (flush re-send + spacing).
      // Re-send only SHORT channel messages (the one-turn-late flush). SysEx is a
      // complete frame — re-sending big SysEx doubles BLE load and chokes the link.
      const framed = (msg) => { out.send(msg); if (msg[0] !== 0xf0) setTimeout(() => { try { out.send(msg); } catch { /* closed */ } }, FLUSH_MS); };
      const apply = async (msgs) => { for (const m of msgs) { framed(m); await sleep(SPACING_MS); } };
      // Frame the note too: a lone note_on is otherwise deferred by the BLE
      // one-turn-late bug and the clip records silence. Re-send note_on; the
      // scheduled note_off (a following packet) flushes it reliably.
      const playNote = () => {
        const t = performance?.now?.() ?? 0;
        out.send([0x90, NOTE, VEL]);
        out.send([0x90, NOTE, VEL], t + FLUSH_MS);
        out.send([0x80, NOTE, 0], t + STIMULUS.offMs);
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

      const REPS = 3; // replicate each phase; the analyzer averages (BLE is noisy)
      const candidates = buildCandidates();
      const usable = candidates.filter((c) => sysex || !candidateNeedsSysex(c));
      const skipped = candidates.filter((c) => !sysex && candidateNeedsSysex(c)).map((c) => c.id);
      const clips = [];
      const total = usable.length * 2 * REPS;
      setProgress({ i: 0, n: total });
      let done = 0;
      for (const c of candidates) {
        if (!sysex && candidateNeedsSysex(c)) { logger.warn('effect-probe.skip', { id: c.id, reason: 'no-sysex' }); continue; }
        for (const phase of ['dry', 'wet']) {
          for (let rep = 0; rep < REPS; rep++) {
            const label = `${c.id}-${phase}-${rep}`;
            setStatus('recording'); setDetail(`${c.label} (${phase} ${rep + 1}/${REPS})`);
            const bytes = await recordOne(label, c[phase]);
            clips.push({ label, candidate: c.id, kind: c.kind, phase, rep, bytes });
            setProgress({ i: ++done, n: total });
            logger.info('effect-probe.clip', { label, bytes });
          }
        }
        // All Sound Off + reset effect sends between candidates.
        out.send([0xb0, 120, 0]); out.send([0xb0, 123, 0]);
      }

      // Give a moment to catch any late inbound (e.g. physical volume wiggle).
      await sleep(500);
      stopMonitor();
      stream.getTracks().forEach((t) => t.stop());
      await uploadManifest(runId, {
        runId, kind: 'effect-probe', sysex, startedAt: runId,
        identity, readback, inbound,
        stimulus: { ...STIMULUS, noteOnAtMs: STIMULUS.recordLeadMs, noteOffAtMs: STIMULUS.recordLeadMs + STIMULUS.offMs },
        skipped, clips,
      });
      setStatus('done');
      setDetail(`identity=${identity || 'none'} · ${clips.length} clips · sysex=${sysex} · inSysex=${inbound.sysex.length} inCC=${inbound.cc.length} · ${runId}`);
      logger.info('effect-probe.done', { runId, clips: clips.length, sysex, identity, inbound, skipped });
    } catch (e) {
      setStatus('fail'); setDetail(String(e.message || e));
      logger.error('effect-probe.fail', { error: String(e.message || e) });
      try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    } finally {
      runningRef.current = false;
    }
  }, [logger, monitor]);

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
