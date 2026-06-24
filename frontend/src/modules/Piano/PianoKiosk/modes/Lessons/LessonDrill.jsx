import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { AbcRenderer, generateMelodyAbc, expandDrill, handMidiSequence } from '../../../../MusicNotation/index.js';

/** Render a drill's tempo object as text, whatever shape it takes. */
function tempoText(tempo) {
  if (!tempo) return null;
  const unit = tempo.unit === 'quarter' ? '♩' : tempo.unit || '♩';
  if (tempo.start_bpm != null && tempo.target_bpm != null) return `${unit} = ${tempo.start_bpm} → ${tempo.target_bpm}`;
  if (tempo.bpm != null) return `${unit} = ${tempo.bpm}`;
  return tempo.note || null;
}

/**
 * Generic single-drill view. Fetches a drill from a lesson collection, expands
 * its seed figure into the full exercise (the figure climbing the scale and back
 * — see expandDrill), engraves it, and runs a MIDI follow-along: the right hand
 * drives a cursor that lights the current notehead green and advances when the
 * player plays it (wrong notes within two octaves flash red). A live keyboard at
 * the foot lights the next key to press. Content-agnostic.
 */
export default function LessonDrill({ collection, drillId }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-lesson-drill' }), []);
  const { activeNotes, subscribe, pressNote, releaseNote } = usePianoMidi();
  const { config } = usePianoKioskConfig();
  const kb = config?.keyboard || { startNote: 21, endNote: 108 };
  const [drill, setDrill] = useState(undefined); // undefined = loading, null = not found

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        logger.info('piano.drill-open', { collection, id: drillId });
        const data = await DaylightAPI(`api/v1/piano/lessons/${collection}/${drillId}`);
        if (!cancelled) setDrill(data || null);
      } catch (err) {
        if (!cancelled) setDrill(null);
        logger.warn('piano.drill-open-failed', { collection, id: drillId, error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [logger, collection, drillId]);

  usePianoBreadcrumb(useMemo(() => [{ label: drill?.title || 'Drill' }], [drill?.title]));

  // Expand seed → full exercise; render and follow-targets share this one source.
  const expanded = useMemo(() => (drill ? expandDrill(drill) : null), [drill]);
  const abc = useMemo(() => (expanded ? generateMelodyAbc(expanded, expanded.key || 'C') : null), [expanded]);
  const rhSeq = useMemo(() => (expanded ? handMidiSequence(expanded.hands?.right) : []), [expanded]);
  const tempo = tempoText(drill?.tempo);

  // Follow state. The right-hand sequence is the target list; `step` is the index
  // of the next note to play.
  const [step, setStep] = useState(0);
  const [wrong, setWrong] = useState(false);
  const stepRef = useRef(0);
  stepRef.current = step;
  const staffNotesRef = useRef([]); // [staffIdx] → [{ midi, els }] from AbcRenderer
  const wrongTimer = useRef(null);

  // Reset progress whenever the engraved exercise changes.
  useEffect(() => { setStep(0); setWrong(false); }, [abc]);

  // Paint the right-hand (treble = staff 0) noteheads: played behind the cursor,
  // current note green (or red while flashing a wrong note), and scroll it in.
  const applyHighlight = useCallback((s, isWrong) => {
    const rh = staffNotesRef.current?.[0] || [];
    for (let i = 0; i < rh.length; i++) {
      for (const el of rh[i].els) {
        el.classList.remove('note-current', 'note-played', 'note-wrong');
        if (i < s) el.classList.add('note-played');
        else if (i === s) el.classList.add(isWrong ? 'note-wrong' : 'note-current');
      }
    }
    const cur = rh[s]?.els?.[0];
    if (cur?.scrollIntoView) cur.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const onRender = useCallback((_tune, staffNotes) => {
    staffNotesRef.current = staffNotes;
    if (staffNotes?.[0]?.length && staffNotes[0].length !== rhSeq.length) {
      logger.warn('piano.drill-highlight-mismatch', { staffNotes: staffNotes[0].length, sequence: rhSeq.length });
    }
    applyHighlight(stepRef.current, false);
  }, [applyHighlight, rhSeq.length, logger]);

  useEffect(() => { applyHighlight(step, wrong); }, [step, wrong, applyHighlight]);

  const flashWrong = useCallback(() => {
    setWrong(true);
    clearTimeout(wrongTimer.current);
    wrongTimer.current = setTimeout(() => setWrong(false), 280);
  }, []);
  useEffect(() => () => clearTimeout(wrongTimer.current), []);

  // Follow mode: advance on the correct right-hand note, flash on a plausible
  // wrong one (within two octaves). Mirrors the Sheet Music ScorePlayer.
  useEffect(() => {
    if (!rhSeq.length) return undefined;
    return subscribe((evt) => {
      if (evt.type !== 'note_on' || !evt.velocity) return;
      const target = rhSeq[stepRef.current];
      if (target == null) return;
      if (evt.note === target) setStep((s) => Math.min(rhSeq.length, s + 1));
      else if (Math.abs(evt.note - target) <= 24) flashWrong();
    });
  }, [rhSeq, subscribe, flashWrong]);

  if (drill === undefined) return <div className="piano-mode piano-mode--lessons"><p className="piano-mode__placeholder">Loading…</p></div>;
  if (drill === null) return <div className="piano-mode piano-mode--lessons"><p className="piano-mode__placeholder">This drill could not be loaded.</p></div>;

  const done = rhSeq.length > 0 && step >= rhSeq.length;
  const target = done ? null : rhSeq[step];

  return (
    <section className="piano-mode piano-mode--lessons lesson-drill">
      <header className="lesson-drill__header">
        <h1 className="lesson-drill__title">{drill.title}</h1>
        {drill.subtitle && <p className="lesson-drill__subtitle">{drill.subtitle}</p>}
      </header>

      <div className="lesson-drill__staff">
        {abc && <AbcRenderer abc={abc} scale={1.5} className="abc-renderer lesson-drill__abc" onRender={onRender} />}
      </div>

      <div className="lesson-drill__transport">
        <span className="lesson-drill__progress">
          {done ? 'Complete' : `${Math.min(step + 1, rhSeq.length)} / ${rhSeq.length}`}
        </span>
        <button type="button" className="lesson-drill__reset" onClick={() => setStep(0)} aria-label="Restart drill">⟲ Restart</button>
        <span className="lesson-drill__hint">Right hand leads — play the green note</span>
      </div>

      <dl className="lesson-drill__facts">
        {drill.meter && (<><dt>Meter</dt><dd>{drill.meter}</dd></>)}
        {drill.key && (<><dt>Key</dt><dd>{drill.key}</dd></>)}
        {tempo && (<><dt>Tempo</dt><dd>{tempo}</dd></>)}
        {drill.transpose?.mode && (
          <>
            <dt>Pattern</dt>
            <dd>
              {drill.transpose.mode}
              {drill.transpose.span_octaves ? `, ${drill.transpose.span_octaves} octaves ${drill.transpose.direction || ''}` : ''}
            </dd>
          </>
        )}
      </dl>

      {drill.focus && <p className="lesson-drill__focus">{drill.focus}</p>}

      <div className="lesson-drill__keys">
        <PianoKeyboard
          activeNotes={activeNotes}
          targetNotes={target != null ? new Set([target]) : null}
          startNote={kb.startNote}
          endNote={kb.endNote}
          onNoteOn={pressNote}
          onNoteOff={releaseNote}
        />
      </div>
    </section>
  );
}
