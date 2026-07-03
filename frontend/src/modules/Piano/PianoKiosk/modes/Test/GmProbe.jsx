import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoMidi } from '../../PianoMidiContext.jsx';

/**
 * GmProbe — MDG-400 General MIDI capability probe (/piano/test/gm-probe).
 *
 * A person standing at the piano taps a button and LISTENS. The three probes
 * answer: "is the piano multi-timbral GM — does it honor Program Change on a
 * non-primary channel, and does it play GM drums on channel 10?"
 *
 *   ch2 bass   — Program Change 33 (Fingered Bass) on ch2 (0xC1), then an
 *                E1/A1/D2/G2 run on that channel. Bass timbre = GM yes.
 *   ch10 drums — kick/snare/hat one-bar pattern on ch10 (0x99). Drum kit
 *                sounds (not tuned piano notes) = GM drum map yes.
 *   ch1 piano  — the SAME E1/A1/D2/G2 run on ch1 with NO program change; the
 *                baseline the listener compares the bass probe against.
 *
 * The verdict is recorded by a human in piano config as
 * `producer.voiceTiers.onboardGm: true|false` — this component only makes the
 * evidence audible. Throwaway diagnostic: plain setTimeout chains, no transport.
 *
 * MIDI goes through the shared usePianoMidi() senders (sendProgramChange /
 * sendNote / sendControlChange all take a channel arg and carry the BLE
 * one-turn-late flush), so no raw output access is needed.
 */

// Ascending run shared by the bass + control probes: E1 A1 D2 G2.
const RUN_NOTES = [28, 33, 38, 43];
const RUN_STEP_MS = 300;
const RUN_NOTE_MS = 260;
const RUN_LEAD_MS = 150; // after the Program Change, before the first note

// One bar of GM drums at 120bpm: eighth-note closed hats (42), kick (36) on
// beats 1+3, snare (38) on beats 2+4.
const DRUM_STEP_MS = 250;
const DRUM_NOTE_MS = 120;
const KICK = 36;
const SNARE = 38;
const HAT = 42;

const TAIL_MS = 400; // after the last note, before all-notes-off + done

/** Build {t, ...} event plans. kind: 'pc' | 'note'. */
function bassPlan() {
  const events = [{ t: 0, kind: 'pc', program: 33, channel: 1 }];
  RUN_NOTES.forEach((note, i) => {
    events.push({ t: RUN_LEAD_MS + i * RUN_STEP_MS, kind: 'note', note, velocity: 100, channel: 1, durMs: RUN_NOTE_MS });
  });
  return events;
}

function drumsPlan() {
  const events = [];
  for (let step = 0; step < 8; step++) {
    const t = step * DRUM_STEP_MS;
    events.push({ t, kind: 'note', note: HAT, velocity: 80, channel: 9, durMs: DRUM_NOTE_MS });
    if (step === 0 || step === 4) events.push({ t, kind: 'note', note: KICK, velocity: 110, channel: 9, durMs: DRUM_NOTE_MS });
    if (step === 2 || step === 6) events.push({ t, kind: 'note', note: SNARE, velocity: 100, channel: 9, durMs: DRUM_NOTE_MS });
  }
  return events;
}

function controlPlan() {
  return RUN_NOTES.map((note, i) => (
    { t: i * RUN_STEP_MS, kind: 'note', note, velocity: 100, channel: 0, durMs: RUN_NOTE_MS }
  ));
}

const PROBES = [
  { id: 'ch2-bass', label: 'Probe ch2 bass', plan: bassPlan },
  { id: 'ch10-drums', label: 'Probe ch10 drums', plan: drumsPlan },
  { id: 'ch1-piano', label: 'Probe ch1 piano (control)', plan: controlPlan },
];

const BTN_STYLE = {
  display: 'block', width: '100%', minHeight: 96, fontSize: 30, fontWeight: 'bold',
  padding: '20px 28px', marginBottom: 20, borderRadius: 12, border: '2px solid #345',
  background: '#1c2733', color: '#dfe9f2', cursor: 'pointer',
};

export function GmProbe() {
  const logger = useMemo(() => getLogger().child({ component: 'gm-probe' }), []);
  const midi = usePianoMidi();
  const { connected, sendProgramChange, sendNote, sendControlChange } = midi;
  const [running, setRunning] = useState(null); // probe id while sounding
  const [error, setError] = useState('');
  const timeoutsRef = useRef([]);

  const clearTimers = useCallback(() => {
    for (const id of timeoutsRef.current) clearTimeout(id);
    timeoutsRef.current = [];
  }, []);

  // All Notes Off (CC 123) on every channel a probe touches:
  // [0xB1,123,0] bass ch2, [0xB9,123,0] drums ch10, [0xB0,123,0] piano ch1.
  const allNotesOff = useCallback(() => {
    sendControlChange(123, 0, 1);
    sendControlChange(123, 0, 9);
    sendControlChange(123, 0, 0);
  }, [sendControlChange]);

  // Unmount: cancel any in-flight probe and silence all probe channels.
  useEffect(() => () => { clearTimers(); allNotesOff(); }, [clearTimers, allNotesOff]);

  const runProbe = useCallback((probe) => {
    if (running) return;
    setError('');
    const events = probe.plan();
    logger.info('gm-probe.start', { probe: probe.id, events: events.length });
    setRunning(probe.id);

    const abort = () => {
      clearTimers();
      allNotesOff();
      setRunning(null);
      setError('No MIDI output — connect the piano first');
      logger.warn('gm-probe.no-output', { probe: probe.id });
    };

    let endT = 0;
    for (const e of events) {
      endT = Math.max(endT, e.t + (e.durMs || 0));
      timeoutsRef.current.push(setTimeout(() => {
        const ok = e.kind === 'pc'
          ? sendProgramChange(e.program, e.channel)
          : sendNote(e.note, e.velocity, e.channel, e.durMs);
        if (!ok) abort();
      }, e.t));
    }
    timeoutsRef.current.push(setTimeout(() => {
      allNotesOff();
      setRunning(null);
      logger.info('gm-probe.end', { probe: probe.id });
    }, endT + TAIL_MS));
  }, [running, logger, clearTimers, allNotesOff, sendProgramChange, sendNote]);

  const disabled = !connected || !!running;

  return (
    <div data-testid="gm-probe" style={{ fontFamily: 'monospace', padding: 32, color: '#fff', background: '#111', minHeight: '100vh', overflowY: 'auto' }}>
      <h1 style={{ fontSize: 40 }}>GM Capability Probe</h1>
      {!connected && (
        <div style={{ fontSize: 28, fontWeight: 'bold', color: '#e66', margin: '12px 0 24px' }}>
          No MIDI output — connect the piano first
        </div>
      )}
      {error && <div style={{ fontSize: 26, color: '#e66', margin: '12px 0' }}>{error}</div>}
      {running && <div style={{ fontSize: 26, color: '#6d6', margin: '12px 0' }}>Sounding: {running}…</div>}

      <div style={{ maxWidth: 640, marginTop: 24 }}>
        {PROBES.map((p) => (
          <button key={p.id} type="button" disabled={disabled} onClick={() => runProbe(p)}
            style={{ ...BTN_STYLE, opacity: disabled ? 0.4 : 1 }}>
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 720, marginTop: 28, fontSize: 20, lineHeight: 1.5, color: '#9ab' }}>
        <p><b style={{ color: '#dfe9f2' }}>What to listen for:</b></p>
        <p>
          1. <b>ch2 bass</b> — if the run sounds like a plucked electric bass, the piano honors
          Program Change on non-primary channels (multi-timbral GM). If it sounds identical to
          the ch1 piano control, it does not.
        </p>
        <p>
          2. <b>ch10 drums</b> — if you hear kick / snare / hi-hat, the GM drum map is live on
          channel 10. If you hear low tuned piano notes (C2/D2/F#2), it is not.
        </p>
        <p>
          3. <b>ch1 piano (control)</b> — the same note run with no Program Change; your
          baseline piano sound for comparison.
        </p>
        <p>
          Record the verdict in piano config under <code style={{ color: '#dfe9f2' }}>producer.voiceTiers.onboardGm: true|false</code>
          {' '}(true only if BOTH bass and drums pass).
        </p>
      </div>
    </div>
  );
}

export default GmProbe;
