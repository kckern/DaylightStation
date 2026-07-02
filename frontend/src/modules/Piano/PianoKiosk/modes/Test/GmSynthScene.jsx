import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { createGmSynth, DRUM_CHANNEL } from '../../producer/gmSynth.js';

/**
 * GmSynthScene — browser GM synth probe (/piano/test/gm-synth).
 *
 * Human latency / polyphony check for the Producer's tier-2 voice output
 * (gmSynth.js, webaudiofont) on the tablet. Two buttons:
 *
 *   Load & play arpeggio — C major arpeggio staggered across three channels:
 *       piano (ch0, program 0), fingered bass (ch1, program 33), strings
 *       (ch2, program 48). First tap also creates + resumes the AudioContext
 *       (the FKB WebView starts it suspended until a gesture).
 *   Drum bar — one bar of kick / snare / closed-hat on channel 9 (MIDI ch10).
 *
 * Listen for: acceptable tap→sound latency, no glitching while the three
 * instruments overlap. Load timings land in `gm-synth` log events.
 */

const STEP_MS = 200;
const NOTE_MS = 350;

// {t, ch, note, vel} plans. Piano leads, bass enters a beat later, strings a beat after that.
function arpeggioPlan() {
  const events = [];
  const arp = [0, 4, 7, 12]; // C major arpeggio intervals
  arp.forEach((iv, i) => events.push({ t: i * STEP_MS, ch: 0, note: 60 + iv, vel: 100 }));
  arp.forEach((iv, i) => events.push({ t: 400 + i * STEP_MS, ch: 1, note: 36 + iv, vel: 110 }));
  arp.forEach((iv, i) => events.push({ t: 800 + i * STEP_MS, ch: 2, note: 48 + iv, vel: 90 }));
  return events;
}

// One bar at 120bpm: eighth-note closed hats (42), kick (36) on 1+3, snare (38) on 2+4.
function drumBarPlan() {
  const events = [];
  for (let step = 0; step < 8; step++) {
    const t = step * 250;
    events.push({ t, ch: DRUM_CHANNEL, note: 42, vel: 80 });
    if (step === 0 || step === 4) events.push({ t, ch: DRUM_CHANNEL, note: 36, vel: 110 });
    if (step === 2 || step === 6) events.push({ t, ch: DRUM_CHANNEL, note: 38, vel: 100 });
  }
  return events;
}

const BTN_STYLE = {
  display: 'block', width: '100%', minHeight: 96, fontSize: 30, fontWeight: 'bold',
  padding: '20px 28px', marginBottom: 20, borderRadius: 12, border: '2px solid #345',
  background: '#1c2733', color: '#dfe9f2', cursor: 'pointer',
};

export function GmSynthScene() {
  const logger = useMemo(() => getLogger().child({ component: 'gm-synth-test' }), []);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const synthRef = useRef(null);
  const ctxRef = useRef(null);
  const timeoutsRef = useRef([]);

  // Lazy: AudioContext must be created/resumed from a user gesture on the kiosk.
  const getSynth = useCallback(() => {
    if (!synthRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      ctxRef.current = new Ctx();
      synthRef.current = createGmSynth({ audioContext: ctxRef.current });
      logger.info('gm-synth-test.context-created', { state: ctxRef.current.state });
    }
    return synthRef.current;
  }, [logger]);

  const clearTimers = useCallback(() => {
    for (const id of timeoutsRef.current) clearTimeout(id);
    timeoutsRef.current = [];
  }, []);

  useEffect(() => () => {
    clearTimers();
    if (synthRef.current) synthRef.current.dispose();
    if (ctxRef.current) ctxRef.current.close().catch(() => {});
  }, [clearTimers]);

  const play = useCallback(async (name, prepare, plan) => {
    if (status === 'loading' || status === 'playing') return;
    setError('');
    const synth = getSynth();
    try {
      setStatus('loading');
      const t0 = performance.now();
      await prepare(synth);
      await synth.resume();
      logger.info('gm-synth-test.ready', { probe: name, loadMs: Math.round(performance.now() - t0) });
    } catch (err) {
      setStatus('idle');
      setError(`Load failed: ${err?.message}`);
      logger.warn('gm-synth-test.load-failed', { probe: name, error: err?.message });
      return;
    }
    setStatus('playing');
    const events = plan();
    let endT = 0;
    for (const e of events) {
      endT = Math.max(endT, e.t + NOTE_MS);
      timeoutsRef.current.push(setTimeout(() => {
        synth.noteOn(e.ch, e.note, e.vel);
        timeoutsRef.current.push(setTimeout(() => synth.noteOff(e.ch, e.note), NOTE_MS));
      }, e.t));
    }
    timeoutsRef.current.push(setTimeout(() => {
      synth.allNotesOff();
      setStatus('idle');
      logger.info('gm-synth-test.end', { probe: name, events: events.length });
    }, endT + 400));
  }, [status, getSynth, logger]);

  const playArpeggio = useCallback(() => play(
    'arpeggio',
    async (synth) => {
      synth.setChannelProgram(0, 0);   // acoustic grand
      synth.setChannelProgram(1, 33);  // fingered bass
      synth.setChannelProgram(2, 48);  // string ensemble
      await Promise.all([synth.load(0), synth.load(33), synth.load(48)]);
    },
    arpeggioPlan,
  ), [play]);

  const playDrumBar = useCallback(() => play(
    'drum-bar',
    (synth) => synth.loadDrums(),
    drumBarPlan,
  ), [play]);

  const busy = status !== 'idle';

  return (
    <div data-testid="gm-synth-scene" style={{ fontFamily: 'monospace', padding: 32, color: '#fff', background: '#111', minHeight: '100vh', overflowY: 'auto' }}>
      <h1 style={{ fontSize: 40 }}>Browser GM Synth Probe</h1>
      {error && <div style={{ fontSize: 26, color: '#e66', margin: '12px 0' }}>{error}</div>}
      {busy && <div style={{ fontSize: 26, color: '#6d6', margin: '12px 0' }}>{status}…</div>}

      <div style={{ maxWidth: 640, marginTop: 24 }}>
        <button type="button" disabled={busy} onClick={playArpeggio} style={{ ...BTN_STYLE, opacity: busy ? 0.4 : 1 }}>
          Load &amp; play arpeggio
        </button>
        <button type="button" disabled={busy} onClick={playDrumBar} style={{ ...BTN_STYLE, opacity: busy ? 0.4 : 1 }}>
          Drum bar
        </button>
      </div>

      <div style={{ maxWidth: 720, marginTop: 28, fontSize: 20, lineHeight: 1.5, color: '#9ab' }}>
        <p>
          Renders in the browser via webaudiofont (self-hosted presets under
          <code style={{ color: '#dfe9f2' }}> /webaudiofont/</code> — no network needed).
          First tap creates the AudioContext; instrument load times land in
          <code style={{ color: '#dfe9f2' }}> gm-synth</code> log events.
        </p>
        <p>
          <b style={{ color: '#dfe9f2' }}>Judge:</b> tap→sound latency on the tablet, and
          whether piano + bass + strings overlapping (12 staggered notes) stay glitch-free.
        </p>
      </div>
    </div>
  );
}

export default GmSynthScene;
