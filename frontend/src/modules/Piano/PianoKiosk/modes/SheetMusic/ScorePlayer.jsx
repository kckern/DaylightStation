import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { parseMusicXml } from '../../../../MusicNotation/parseMusicXml.js';
import { MusicXmlRenderer } from '../../../../MusicNotation/renderers/MusicXmlRenderer.jsx';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoPlayback } from '../../PianoPlaybackContext.jsx';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import useReloadGuard from '../../useReloadGuard.js';

const SOSTENUTO_CC = 66; // middle pedal — manual page turns

const MODES = [
  { id: 'follow', label: 'Follow', hint: 'advances when you play the right note' },
  { id: 'metronome', label: 'Metronome', hint: 'plays on tempo, like it or not' },
  { id: 'manual', label: 'Manual', hint: 'middle pedal turns the page' },
];

/**
 * ScorePlayer — interactive engraved score with three play modes:
 *  1. Follow   — MIDI detects where you are; correct notes advance + light green,
 *                wrong notes flash red but do NOT advance.
 *  2. Metronome — auto-advances the cursor at the score tempo.
 *  3. Manual   — no awareness; the sostenuto (middle) pedal scrolls/turns pages.
 */
export default function ScorePlayer({ score: scoreMeta }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-score-player' }), []);
  const navigate = useNavigate();
  const { activeNotes, subscribe, subscribeRaw } = usePianoMidi();
  const { setPlaying: setGlobalPlaying } = usePianoPlayback();

  usePianoBreadcrumb(useMemo(() => [{ label: scoreMeta?.title || 'Score' }], [scoreMeta?.title]));

  const parsed = useMemo(() => {
    try { return parseMusicXml(scoreMeta.musicXml); } catch { return null; }
  }, [scoreMeta.musicXml]);
  const tempo = parsed?.tempo || 90;

  const [layout, setLayout] = useState({ events: [], width: 0, height: 0 });
  const [step, setStep] = useState(0);           // index into layout.events
  const [mode, setMode] = useState('follow');
  const [running, setRunning] = useState(false); // metronome transport
  const [wrong, setWrong] = useState(false);     // transient wrong-note flash
  const scrollRef = useRef(null);
  const wrongTimer = useRef(null);
  const stepRef = useRef(0);
  stepRef.current = step;

  const flashWrong = useCallback(() => {
    setWrong(true);
    clearTimeout(wrongTimer.current);
    wrongTimer.current = setTimeout(() => setWrong(false), 280);
  }, []);
  useEffect(() => () => clearTimeout(wrongTimer.current), []);

  const events = layout.events;
  const current = events[step] || null;
  const onLayout = useCallback((res) => { setLayout(res); setStep(0); }, []);

  useReloadGuard(running);
  useEffect(() => { setGlobalPlaying(running); return () => setGlobalPlaying(false); }, [running, setGlobalPlaying]);

  // Auto-scroll the cursor into view whenever it (or its system) moves.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !current) return;
    const target = current.top - el.clientHeight * 0.35;
    el.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [current?.system, step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Follow mode: advance on the correct note, flash on a wrong one ──
  useEffect(() => {
    if (mode !== 'follow') return undefined;
    return subscribe((evt) => {
      if (evt.type !== 'note_on' || !evt.velocity) return;
      const ev = events[stepRef.current];
      if (!ev) return;
      if (evt.note === ev.midi) {
        setStep((s) => Math.min(events.length - 1, s + 1));
        logger.debug('score.follow.hit', { note: evt.note, step: stepRef.current });
      } else if (Math.abs(evt.note - ev.midi) <= 24) {
        flashWrong(); // a plausible wrong note (ignore far-off bass thuds)
      }
    });
  }, [mode, events, subscribe, logger]);

  // ── Metronome mode: advance at tempo while running ──
  useEffect(() => {
    if (mode !== 'metronome' || !running || !events.length) return undefined;
    const beatMs = 60000 / tempo;
    const id = setInterval(() => {
      setStep((s) => {
        if (s >= events.length - 1) { setRunning(false); return s; }
        return s + 1;
      });
    }, beatMs * estGapBeats(events, stepRef.current));
    return () => clearInterval(id);
  }, [mode, running, events, tempo, step]);

  // ── Manual mode: sostenuto (middle) pedal scrolls down a screenful ──
  useEffect(() => {
    if (mode !== 'manual') return undefined;
    return subscribeRaw(({ data }) => {
      if (!data || data.length < 3) return;
      const isCC = (data[0] & 0xf0) === 0xb0;
      if (isCC && data[1] === SOSTENUTO_CC && data[2] >= 64) {
        const el = scrollRef.current;
        if (el) el.scrollBy({ top: el.clientHeight * 0.85, behavior: 'smooth' });
        logger.info('score.manual.pageturn', {});
      }
    });
  }, [mode, subscribeRaw, logger]);

  const reset = () => { setStep(0); setRunning(false); scrollRef.current?.scrollTo({ top: 0 }); };
  const cursorColor = mode === 'follow' ? '#2ec46f' : '#6cf';

  return (
    <div className="piano-score-player">
      <div className="piano-score-player__bar">
        <button
          type="button"
          className="piano-score-mode piano-score-player__back"
          onClick={() => navigate('..', { relative: 'path' })}
          aria-label="Back to sheet music"
        >‹ Back</button>
        <div className="piano-score-player__modes" role="tablist">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`piano-score-mode${mode === m.id ? ' is-active' : ''}`}
              aria-selected={mode === m.id}
              onClick={() => { setMode(m.id); setRunning(false); }}
              title={m.hint}
            >{m.label}</button>
          ))}
        </div>
        <div className="piano-score-player__transport">
          {mode === 'metronome' && (
            <button type="button" className="piano-score-mode" onClick={() => setRunning((r) => !r)}>
              {running ? '❚❚ Pause' : '▶ Play'}
            </button>
          )}
          <button type="button" className="piano-score-mode" onClick={reset}>⟲ Start over</button>
          <span className="piano-score-player__pos">{events.length ? `${Math.min(step + 1, events.length)} / ${events.length}` : ''}</span>
        </div>
      </div>

      <div className="piano-score-player__scroll" ref={scrollRef}>
        <MusicXmlRenderer score={parsed} musicXml={scoreMeta.musicXml} onLayout={onLayout}>
          {current && (
            <div
              className={`piano-score-cursor${wrong ? ' is-wrong' : ''}`}
              style={{
                left: current.x - 9,
                top: current.top,
                height: Math.max(40, current.bottom - current.top),
                '--cursor-color': cursorColor,
              }}
            />
          )}
        </MusicXmlRenderer>
      </div>
    </div>
  );
}

// Beats until the next event (so the metronome dwells longer on longer notes).
function estGapBeats(events, i) {
  const a = events[i]?.onsetQuarter;
  const b = events[i + 1]?.onsetQuarter;
  if (a == null || b == null) return 1;
  return Math.max(0.25, b - a);
}
