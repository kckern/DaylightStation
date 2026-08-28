import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MusicXmlRenderer } from '../../../../MusicNotation/renderers/MusicXmlRenderer.jsx';
import { parseMusicXml } from '../../../../MusicNotation/parseMusicXml.js';
import NoteHighlightLayer from '../SheetMusic/NoteHighlightLayer.jsx';
import { compileScoreExpectation } from '../../../performance/assessmentAttempt.js';

/**
 * ScorePassage — a few bars of REAL sheet music standing at the gate.
 *
 * The third material kind. `keys` synthesizes its ask and `exercise` reads one
 * out of the bank; a score has neither — the ask is whatever the engraver finds
 * in the document, which is why this component exists at all. It engraves the
 * MusicXML, waits for OSMD to report where every notehead landed, compiles the
 * named measure range into an assessment expectation, and hands that up. The
 * host builds the attempt from it; nothing is graded in here.
 *
 * Three things it deliberately does NOT do, all of them the reason this stayed
 * a stage and not a second ScorePlayer: no transport, no scroll or zoom, no
 * per-measure grades or ink layers. A gate passage is short enough to fit on
 * one screen and is over in seconds.
 *
 * ── Measure numbers are the ones on the PAGE ────────────────────────────────
 * `measures` is authored by a grown-up reading a printed score — `[2, 3]` means
 * the second and third bars, the way anyone would say it. The engraver counts
 * from zero (`step.measure`), and `compileScoreExpectation`'s `range` filters on
 * that same zero-based index, so the conversion happens HERE, once, at the
 * boundary between what a person wrote and what the geometry says. A config
 * naming bar 0 has already been rejected upstream (`gateMaterial`).
 *
 * @param {object} props
 * @param {string} props.musicXml Raw MusicXML document.
 * @param {string} props.sourceId Content id of the score — the expectation's source.
 * @param {[number,number]|null} [props.measures] Printed bar numbers, inclusive.
 *   `null` means the whole score.
 * @param {(expectation:object)=>void} [props.onExpectation] The compiled passage,
 *   published once the engraver has reported geometry. Fires again if a
 *   re-engrave changes the answer; a host that must not restart a running
 *   attempt is responsible for latching the first (`ExerciseRun` does).
 * @param {number} [props.cursorIndex] Which expectation event the run is on.
 * @param {number|null} [props.wrongMidi] A note that was played but not asked
 *   for. The note that WAS asked for flashes — the same thing the ABC stage
 *   says with `exercise-note-wrong`.
 */
export default function ScorePassage({
  musicXml, sourceId, measures = null, onExpectation, cursorIndex = 0, wrongMidi = null,
}) {
  const [layout, setLayout] = useState(null);
  const publishedRef = useRef(null);

  // A stable identity, or the renderer's engrave effect re-fires every render.
  const handleLayout = useCallback((result) => setLayout(result), []);

  /**
   * The score's own opening tempo, read from the document rather than from the
   * engraver. It is the fallback `compileScoreExpectation` uses when OSMD
   * reports no tempo entries, and a cued attempt is REJECTED outright by
   * `createAssessmentAttempt` unless the compiled tempo map starts at onset
   * zero — so this is what keeps a cued score passage buildable at all.
   */
  const fallbackBpm = useMemo(() => {
    try { return parseMusicXml(musicXml)?.tempo || DEFAULT_BPM; } catch { return DEFAULT_BPM; }
  }, [musicXml]);

  /** Printed bar numbers → the zero-based indices the geometry is stamped with. */
  const range = useMemo(() => {
    if (!Array.isArray(measures) || measures.length !== 2) return null;
    const [start, end] = measures.map((value) => Math.trunc(Number(value)) - 1);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
    return { start, end };
  }, [measures]);

  /**
   * Every engraved note, in the shape the score compiler reads: the note as the
   * engraver reported it, plus the onset and measure of the step it sits in.
   * (`el` rides along and is dropped by the compiler's own whitelist — the same
   * thing happens on the Sheet Music surface.)
   */
  const notes = useMemo(() => (layout?.steps ?? []).flatMap((step) => (step.notes ?? []).map((note) => ({
    ...note,
    onsetQuarter: step.onsetQuarter ?? 0,
    measureIndex: step.measure,
  }))), [layout]);

  const expectation = useMemo(() => {
    if (!notes.length) return null;
    try {
      const compiled = compileScoreExpectation({
        notes,
        source: { id: sourceId },
        tempoMap: layout?.tempoEntries,
        fallbackBpm,
        range,
      });
      // A range that selected nothing — a level naming bars the document does
      // not have. An empty expectation builds an attempt that is complete
      // before the first note, which is a gate that opens itself.
      return compiled.events.some((event) => event.notes.length) ? compiled : null;
    } catch {
      // Unreadable geometry is infrastructure, and infrastructure fails open:
      // saying nothing leaves the run unstarted, which its host resolves as
      // unavailable and turns into a granted match.
      return null;
    }
  }, [notes, sourceId, layout?.tempoEntries, fallbackBpm, range]);

  useLayoutEffect(() => {
    if (!expectation || publishedRef.current === expectation) return;
    publishedRef.current = expectation;
    onExpectation?.(expectation);
  }, [expectation, onExpectation]);

  /** Engraved noteheads by onset, so a cursor position can find its ink. */
  const elsByOnset = useMemo(() => {
    const byOnset = new Map();
    for (const step of layout?.steps ?? []) {
      const key = onsetKey(step.onsetQuarter ?? 0);
      const bucket = byOnset.get(key) ?? [];
      for (const note of step.notes ?? []) if (note.el) bucket.push(note);
      byOnset.set(key, bucket);
    }
    return byOnset;
  }, [layout]);

  /**
   * The notes under the cursor, found by ONSET rather than by index into the
   * step list. The compiler groups by onset and drops tie continuations, so a
   * step index and an expectation-event index are not the same number on
   * material carrying ties — and a cursor that drifts a note ahead of the ink
   * is worse than no cursor at all.
   */
  const currentStep = useMemo(() => {
    const event = expectation?.events?.[cursorIndex];
    if (!event) return null;
    return { notes: elsByOnset.get(onsetKey(event.onsetQuarter)) ?? [] };
  }, [expectation, cursorIndex, elsByOnset]);

  // Every staff the engraving has is lit; a gate passage has no hands control.
  const activeParts = useMemo(() => {
    const parts = {};
    for (const step of layout?.steps ?? []) for (const note of step.notes ?? []) parts[note.staff ?? 0] = true;
    return parts;
  }, [layout]);

  /** The bars either side of the passage, greyed back so the ask is the page. */
  useLayoutEffect(() => {
    if (!range) return undefined;
    const dimmed = [];
    for (const step of layout?.steps ?? []) {
      if (step.measure >= range.start && step.measure <= range.end) continue;
      for (const note of step.notes ?? []) {
        if (!note.el) continue;
        note.el.classList.add(DIM);
        dimmed.push(note.el);
      }
    }
    return () => { for (const el of dimmed) el.classList.remove(DIM); };
  }, [layout, range]);

  /** The wrong flash, on the note that was owed. Same pattern as the lit layer. */
  useLayoutEffect(() => {
    if (wrongMidi == null) return undefined;
    const flashed = [];
    for (const note of currentStep?.notes ?? []) {
      if (!note.el) continue;
      note.el.classList.add(WRONG);
      flashed.push(note.el);
    }
    return () => { for (const el of flashed) el.classList.remove(WRONG); };
  }, [currentStep, wrongMidi]);

  return (
    <div className="piano-score-passage">
      <MusicXmlRenderer musicXml={musicXml} onLayout={handleLayout}>
        <NoteHighlightLayer step={currentStep} activeParts={activeParts} />
      </MusicXmlRenderer>
    </div>
  );
}

/** The tempo a score that names none is counted at — the Sheet Music surface's own. */
const DEFAULT_BPM = 90;
/** Out of the passage: engraved, readable, and plainly not what is being asked for. */
const DIM = 'piano-score-passage__dim';
/** The owed note, when something else was played. */
const WRONG = 'piano-note-wrong';
/** Onsets are floats; compare them the way the score compiler groups them. */
const onsetKey = (onsetQuarter) => (Number(onsetQuarter) || 0).toFixed(6);
