import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import LiveKeyboard from '../../LiveKeyboard.jsx';
import { AbcRenderer, generateMelodyAbc, expandDrill, handMidiSequence } from '../../../../MusicNotation/index.js';
import { computeTargetScrollLeft } from './lessonScroll.js';

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
  const { subscribe, pressNote, releaseNote } = usePianoMidi();
  const { config } = usePianoKioskConfig();
  const kb = config?.keyboard || { startNote: 21, endNote: 108 };
  const REST_FRACTION = 0.10; // active note rests ~10% from the left edge
  const SNAP_BACK_MS = 1500;  // idle delay after a scrub before returning to the cursor
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
  const scrollRef = useRef(null);          // .lesson-drill__staff (overflow-x scroll container)
  const userScrubbingRef = useRef(false);  // true while the player drags / within the snap-back window
  const snapBackTimer = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startScroll: 0, pointerId: null });
  useEffect(() => () => clearTimeout(snapBackTimer.current), []);

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
  }, []);

  // Scroll the staff so the active notehead rests ~REST_FRACTION from the left.
  // Reads geometry once (not per frame); the actual motion is a CSS-smooth
  // scrollLeft assignment (compositor-friendly — see webview-paint-performance.md).
  const scrollCursorToRest = useCallback((s) => {
    const container = scrollRef.current;
    const note = staffNotesRef.current?.[0]?.[s]?.els?.[0];
    if (!container || !note?.getBoundingClientRect) return;
    const cRect = container.getBoundingClientRect();
    const nRect = note.getBoundingClientRect();
    // note's left edge in content coordinates = its viewport-left minus the
    // container's viewport-left, plus how far we're already scrolled.
    const noteLeft = (nRect.left - cRect.left) + container.scrollLeft;
    const target = computeTargetScrollLeft({
      noteLeft,
      viewportWidth: container.clientWidth,
      contentWidth: container.scrollWidth,
      restFraction: REST_FRACTION,
    });
    logger.debug('piano.drill-scroll', { step: s, target, viewport: container.clientWidth, content: container.scrollWidth });
    container.scrollTo({ left: target, behavior: 'smooth' });
  }, [logger]);

  // Pointer-drag scrubbing: lets the player swipe back through played notes (and
  // a little ahead). Adjusts scrollLeft directly (no React state per move → no
  // re-render storm); releasing arms an idle snap-back to the cursor.
  const onScrubStart = useCallback((e) => {
    const container = scrollRef.current;
    if (!container) return;
    userScrubbingRef.current = true;
    clearTimeout(snapBackTimer.current);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startScroll: container.scrollLeft,
      pointerId: e.pointerId,
    };
    container.setPointerCapture?.(e.pointerId);
  }, []);

  const onScrubMove = useCallback((e) => {
    const d = dragRef.current;
    const container = scrollRef.current;
    if (!d.active || !container) return;
    // Direct, non-animated scrollLeft tracking: instantly follows the finger.
    container.scrollLeft = d.startScroll - (e.clientX - d.startX);
  }, []);

  const onScrubEnd = useCallback((e) => {
    const d = dragRef.current;
    const container = scrollRef.current;
    if (!d.active) return;
    d.active = false;
    container?.releasePointerCapture?.(d.pointerId);
    // Arm the snap-back: after SNAP_BACK_MS idle, smooth-scroll back to the cursor.
    clearTimeout(snapBackTimer.current);
    snapBackTimer.current = setTimeout(() => {
      userScrubbingRef.current = false;
      scrollCursorToRest(stepRef.current);
      logger.debug('piano.drill-snap-back', { step: stepRef.current });
    }, SNAP_BACK_MS);
  }, [scrollCursorToRest, logger]);

  const onRender = useCallback((_tune, staffNotes) => {
    staffNotesRef.current = staffNotes;
    if (staffNotes?.[0]?.length && staffNotes[0].length !== rhSeq.length) {
      logger.warn('piano.drill-highlight-mismatch', { staffNotes: staffNotes[0].length, sequence: rhSeq.length });
    }
    applyHighlight(stepRef.current, false);
    scrollCursorToRest(stepRef.current);
  }, [applyHighlight, scrollCursorToRest, rhSeq.length, logger]);

  // Repaint notehead classes on every step / wrong change.
  useEffect(() => { applyHighlight(step, wrong); }, [step, wrong, applyHighlight]);

  // Teleprompter scroll on advance — playing a note overrides an in-progress scrub.
  useEffect(() => {
    if (dragRef.current.active) return; // mid-drag: don't fight the finger
    userScrubbingRef.current = false;   // a new step means resume following
    clearTimeout(snapBackTimer.current);
    scrollCursorToRest(step);
  }, [step, scrollCursorToRest]);

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

      <div
        className="lesson-drill__staff"
        ref={scrollRef}
        onPointerDown={onScrubStart}
        onPointerMove={onScrubMove}
        onPointerUp={onScrubEnd}
        onPointerCancel={onScrubEnd}
      >
        {abc && <AbcRenderer abc={abc} scale={1.5} singleLine className="abc-renderer lesson-drill__abc" onRender={onRender} />}
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
        <LiveKeyboard
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
