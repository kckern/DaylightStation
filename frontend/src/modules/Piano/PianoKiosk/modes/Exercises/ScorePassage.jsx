import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { MusicXmlRenderer } from '../../../../MusicNotation/renderers/MusicXmlRenderer.jsx';
import { parseMusicXml } from '../../../../MusicNotation/parseMusicXml.js';
import NoteHighlightLayer from '../SheetMusic/NoteHighlightLayer.jsx';
import { compileScoreExpectation } from '../../../performance/assessmentAttempt.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-score-passage' });
  return _logger;
}

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
 * @param {(reason:string)=>void} [props.onUnrunnable] There will be no expectation
 *   from this document, ever — the ONLY other terminal answer this component can
 *   give. A host waiting on `onExpectation` needs it: without it, a score that
 *   cannot be engraved, a range naming bars the file does not have, and a
 *   passage of nothing but rests all leave a child sitting on "Getting the music
 *   ready…" with no way out but Leave, which costs them the game they earned.
 *   Reasons: `engrave-failed` | `no-engraved-notes` | `passage-empty` |
 *   `expectation-uncompilable`.
 * @param {number} [props.cursorIndex] Which expectation event the run is on.
 * @param {number|null} [props.wrongMidi] A note that was played but not asked
 *   for. The note that WAS asked for flashes — the same thing the ABC stage
 *   says with `exercise-note-wrong`.
 */
export default function ScorePassage({
  musicXml, sourceId, measures = null, onExpectation, onUnrunnable, cursorIndex = 0, wrongMidi = null,
}) {
  const [layout, setLayout] = useState(null);
  const publishedRef = useRef(null);
  /**
   * The terminal answer already given. Keyed by REASON, not a bare boolean, so a
   * re-render never repeats itself while a genuinely different dead end still
   * gets said. Deliberately not reset per document: the only caller latches the
   * first answer anyway, and a reset keyed on an array prop would fire on every
   * fresh `[2, 3]` literal a parent happened to render.
   */
  const reportedRef = useRef(null);

  // A stable identity, or the renderer's engrave effect re-fires every render.
  const handleLayout = useCallback((result) => setLayout(result), []);

  /**
   * The one place a dead end is announced. Every caller of this is a decision to
   * give a child nothing, and this repo has already learned what an unlogged one
   * costs: it becomes indistinguishable from a slow load, which is the shape of
   * a hang nobody goes looking for.
   */
  const reportUnrunnable = useCallback((reason, detail = {}) => {
    if (reportedRef.current === reason) return;
    reportedRef.current = reason;
    logger().warn('piano.score-passage-unrunnable', { id: sourceId ?? null, measures, reason, ...detail });
    onUnrunnable?.(reason);
  }, [measures, onUnrunnable, sourceId]);

  /** The engraver reached its placeholder: no geometry is coming from this file. */
  const handleEngraveFailed = useCallback(
    (info) => reportUnrunnable('engrave-failed', { error: info?.error ?? null }),
    [reportUnrunnable],
  );

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

  /**
   * Printed bar numbers → the zero-based indices the geometry is stamped with.
   *
   * Whole bars only, and NOT truncated: bar 1.9 is not a bar, and silently
   * reading it as bar 1 would put a child in front of music nobody asked for
   * with nothing on screen to say so. Unreadable means "the whole score", which
   * is always playable.
   */
  const range = useMemo(() => {
    if (!Array.isArray(measures) || measures.length !== 2) return null;
    const [start, end] = measures;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return null;
    return { start: start - 1, end: end - 1 };
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

  /**
   * The compile, as a DISCRIMINATED answer rather than an expectation-or-null.
   *
   * `null` conflated four different situations, and one of them — "the engraver
   * has not reported yet" — is the normal case for the first few hundred
   * milliseconds of every run. A host cannot act on a value that means both
   * "wait" and "this will never work", so it waited, and a passage that could
   * never compile hung instead of failing open.
   */
  const compiled = useMemo(() => {
    if (!layout) return { state: 'pending' };
    // The engraving landed and carried no notes at all — an empty document, or
    // one whose every part is rests (the geometry walk does not emit those).
    if (!notes.length) return { state: 'dead', reason: 'no-engraved-notes' };
    try {
      const expectation = compileScoreExpectation({
        notes,
        source: { id: sourceId },
        tempoMap: layout.tempoEntries,
        fallbackBpm,
        range,
      });
      // A range that selected nothing playable: bars the document does not have,
      // or a passage of nothing but rests. An expectation of no notes builds an
      // attempt that is COMPLETE before the first note — a gate that opens
      // itself, which is worse than one that declines.
      if (!expectation.events.some((event) => event.notes.length)) {
        return { state: 'dead', reason: 'passage-empty' };
      }
      return { state: 'ready', expectation };
    } catch (error) {
      return { state: 'dead', reason: 'expectation-uncompilable', error: error?.message ?? String(error) };
    }
  }, [layout, notes, sourceId, fallbackBpm, range]);

  const expectation = compiled.state === 'ready' ? compiled.expectation : null;

  useLayoutEffect(() => {
    if (compiled.state === 'pending') return;
    if (compiled.state === 'dead') {
      reportUnrunnable(compiled.reason, compiled.error ? { error: compiled.error } : {});
      return;
    }
    if (publishedRef.current === compiled.expectation) return;
    publishedRef.current = compiled.expectation;
    onExpectation?.(compiled.expectation);
  }, [compiled, onExpectation, reportUnrunnable]);

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
      <MusicXmlRenderer musicXml={musicXml} onLayout={handleLayout} onFailed={handleEngraveFailed}>
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
