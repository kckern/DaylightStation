import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { MusicXmlRenderer } from '../../../../MusicNotation/renderers/MusicXmlRenderer.jsx';
import { parseMusicXml } from '../../../../MusicNotation/parseMusicXml.js';
import NoteHighlightLayer from '../SheetMusic/NoteHighlightLayer.jsx';
import { compileScoreExpectation } from '../../../performance/assessmentAttempt.js';
import { excerptMusicXml, selectMusicXmlParts } from './scorePassageXml.js';
import { scaleScoreTempoMap, scaledScoreBpm } from './scoreTempo.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-score-passage' });
  return _logger;
}

export function fitPassageLayout({ layout, scale, minScale, maxSystems }) {
  const systems = new Set((layout?.staves ?? []).map((staff) => staff.system).filter(Number.isInteger));
  const count = systems.size || 1;
  if (count <= maxSystems) return { accepted: true, nextScale: null };
  if (scale <= minScale) return { accepted: false, nextScale: null };
  const candidate = Math.max(minScale, Math.round(scale * (maxSystems / count) * 100) / 100);
  return { accepted: false, nextScale: candidate < scale ? candidate : null };
}

/**
 * Pick a single forced break that balances bar count. A system wrap is the
 * horizontal reset between adjacent measure boxes; their vertical bounds are
 * ink extents and legitimately vary between measures on the same system.
 */
export function balancedSystemBreak(measureBounds = []) {
  const bounds = measureBounds.filter((bound) => bound
    && Number.isFinite(bound.left) && Number.isFinite(bound.right) && Number.isFinite(bound.top)
    && bound.right > bound.left);
  if (bounds.length !== measureBounds.length || bounds.length < 3) return null;
  const currentBreak = firstHorizontalWrap(bounds);
  if (currentBreak < 0) return null;
  const minPerSystem = bounds.length >= 4 ? 2 : 1;
  const best = Math.min(bounds.length - minPerSystem, Math.max(minPerSystem, Math.ceil(bounds.length / 2)));
  return best === currentBreak ? null : best;
}

// Pure geometry is exported for regression coverage alongside the component.
// eslint-disable-next-line react-refresh/only-export-components
export function systemBreakMatches(measureBounds = [], breakBefore) {
  if (!Number.isInteger(breakBefore) || breakBefore <= 0 || breakBefore >= measureBounds.length) return false;
  if (measureBounds.some((bound) => !Number.isFinite(bound?.left))) return false;
  const wraps = measureBounds.flatMap((bound, index) => (
    index > 0 && bound.left < measureBounds[index - 1].left - 1 ? [index] : []
  ));
  const mirroredBreak = measureBounds.length - breakBefore;
  return wraps.length === 1 && (wraps[0] === breakBefore || wraps[0] === mirroredBreak);
}

function firstHorizontalWrap(bounds) {
  return bounds.findIndex((bound, index) => index > 0 && bound.left < bounds[index - 1].left - 1);
}

// eslint-disable-next-line react-refresh/only-export-components
export function passageCursorBounds({ noteBounds = [], staffBoxes = [], activeStaffs = [], onsetStaffs = [] }) {
  const notes = noteBounds.filter((box) => [box.left, box.right, box.top, box.bottom].every(Number.isFinite));
  if (!notes.length) return null;
  const noteTop = Math.min(...notes.map((box) => box.top));
  const noteBottom = Math.max(...notes.map((box) => box.bottom));
  const noteCenter = (noteTop + noteBottom) / 2;
  const systemCandidates = staffBoxes.filter((box) => !onsetStaffs.length || onsetStaffs.includes(box.staff));
  const system = systemCandidates.reduce((nearest, box) => {
    const distance = Math.abs(noteCenter - (box.top + (box.lineSpacing * 2)));
    return !nearest || distance < nearest.distance ? { system: box.system, distance } : nearest;
  }, null)?.system;
  const active = staffBoxes.filter((box) => box.system === system && activeStaffs.includes(box.staff));
  const spacing = Math.max(6, ...active.map((box) => box.lineSpacing || 0));
  const staffTop = active.length ? Math.min(...active.map((box) => box.top)) - spacing : noteTop - spacing * 2;
  const staffBottom = active.length ? Math.max(...active.map((box) => box.top + (box.lineSpacing * 4))) + spacing : noteBottom + spacing * 2;
  const left = Math.min(...notes.map((box) => box.left)) - 6;
  const right = Math.max(...notes.map((box) => box.right)) + 6;
  const top = Math.min(staffTop, noteTop - spacing);
  const bottom = Math.max(staffBottom, noteBottom + spacing);
  return { x: left, y: top, width: right - left, height: bottom - top };
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
 * @param {boolean} [props.showCursor] Draw the timed run's yellow cursor around
 *   the current engraved noteheads; negative cursor indices draw nothing.
 * @param {number|null} [props.wrongMidi] A note that was played but not asked
 *   for. The note that WAS asked for flashes — the same thing the ABC stage
 *   says with `exercise-note-wrong`.
 * @param {Map<number, Map<number, object>>|null} [props.verdicts] A timed run's
 *   RECORDED verdicts (`performance/timedVerdicts.js`), keyed by expectation
 *   event index (this passage's own compiled events) and then midi. When
 *   present they are the only colour on the ink: hit green, early/late amber
 *   with a ◂/▸ tick, lapsed/miss grey, and a recorded wrong pitch marks the
 *   notes still owed at its event with `piano-note-wrong` (an engraved score
 *   has no line to draw an unwritten pitch on). `wrongMidi` is then ignored.
 * @param {boolean} [props.windowOpen] Timed runs: the cursor is lit while the
 *   current event's window is open and dimmed between windows.
 */
export default function ScorePassage({
  musicXml, sourceId, measures = null, onExpectation, onUnrunnable, cursorIndex = 0, wrongMidi = null, showCursor = false,
  verdicts = null, windowOpen = undefined, activeParts: requestedParts = null, rangeIndices = null, tempoPercent = 100,
}) {
  const judged = verdicts instanceof Map;
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

  const [renderScale, setRenderScale] = useState(1);
  const [systemBreakBefore, setSystemBreakBefore] = useState(null);
  const [fitError, setFitError] = useState(null);

  const handleLayout = useCallback((result) => {
    const fit = fitPassageLayout({ layout: result, scale: renderScale, minScale: MIN_PASSAGE_SCALE, maxSystems: MAX_PASSAGE_SYSTEMS });
    if (fit.accepted) {
      const balancedBreak = systemBreakBefore == null ? balancedSystemBreak(result.measureBounds ?? []) : null;
      if (balancedBreak != null) {
        setLayout(null);
        setSystemBreakBefore(balancedBreak);
        logger().info('piano.score-passage-balanced', {
          id: sourceId ?? null, measures, breakBefore: balancedBreak, scale: renderScale,
        });
        return;
      }
      if (systemBreakBefore != null && !systemBreakMatches(result.measureBounds ?? [], systemBreakBefore)) {
        logger().warn('piano.score-passage-break-mismatch', {
          id: sourceId ?? null,
          measures,
          breakBefore: systemBreakBefore,
          measureBounds: (result.measureBounds ?? []).map(({ left, right, top, bottom }) => ({ left, right, top, bottom })),
        });
        setLayout(null);
        setFitError('passage-layout-unbalanced');
        return;
      }
      setFitError(null); setLayout(result); return;
    }
    setLayout(null);
    if (fit.nextScale != null) setRenderScale(fit.nextScale);
    else setFitError('passage-too-dense');
  }, [measures, renderScale, sourceId, systemBreakBefore]);

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
    if (rangeIndices && Number.isInteger(rangeIndices.start) && Number.isInteger(rangeIndices.end)
      && rangeIndices.start >= 0 && rangeIndices.end >= rangeIndices.start) return rangeIndices;
    if (!Array.isArray(measures) || measures.length !== 2) return null;
    const [start, end] = measures;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return null;
    return { start: start - 1, end: end - 1 };
  }, [measures, rangeIndices]);

  const excerpt = useMemo(
    () => excerptMusicXml(musicXml, range, { systemBreakBefore }),
    [musicXml, range, systemBreakBefore],
  );
  const focused = useMemo(
    () => (excerpt.musicXml ? selectMusicXmlParts(excerpt.musicXml, requestedParts) : { musicXml: null, originalStaffIndices: [], error: excerpt.error }),
    [excerpt.error, excerpt.musicXml, requestedParts],
  );

  /**
   * Every engraved note, in the shape the score compiler reads: the note as the
   * engraver reported it, plus the onset and measure of the step it sits in.
   * (`el` rides along and is dropped by the compiler's own whitelist — the same
   * thing happens on the Sheet Music surface.)
   */
  const notes = useMemo(() => (layout?.steps ?? []).flatMap((step) => (step.notes ?? []).map((note) => ({
    ...note,
    staff: focused.originalStaffIndices?.[note.staff ?? 0] ?? note.staff,
    onsetQuarter: step.onsetQuarter ?? 0,
    measureIndex: excerpt.originalMeasureIndices[step.measure] ?? step.measure,
  }))), [excerpt.originalMeasureIndices, focused.originalStaffIndices, layout]);

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
        tempoMap: scaleScoreTempoMap(layout.tempoEntries?.length ? layout.tempoEntries : excerpt.inheritedTempoMap, tempoPercent),
        fallbackBpm: scaledScoreBpm(fallbackBpm, tempoPercent),
        range: null,
        activeParts: requestedParts,
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
  }, [layout, notes, sourceId, fallbackBpm, requestedParts, excerpt.inheritedTempoMap, tempoPercent]);

  const expectation = compiled.state === 'ready' ? compiled.expectation : null;
  const systemCount = useMemo(
    () => new Set((layout?.staves ?? []).map((staff) => staff.system).filter(Number.isInteger)).size,
    [layout],
  );

  useLayoutEffect(() => {
    const terminalError = excerpt.error || focused.error || fitError;
    if (terminalError) {
      reportUnrunnable(terminalError);
      return;
    }
    if (compiled.state === 'pending') return;
    if (compiled.state === 'dead') {
      reportUnrunnable(compiled.reason, compiled.error ? { error: compiled.error } : {});
      return;
    }
    if (publishedRef.current === compiled.expectation) return;
    publishedRef.current = compiled.expectation;
    onExpectation?.(compiled.expectation);
  }, [compiled, excerpt.error, fitError, focused.error, onExpectation, reportUnrunnable]);

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

  // Timed passages need a visible clock cursor even before a note is played.
  // Insert behind the engraved ink, in the SVG's own coordinate system, so
  // resizing the score scales the cursor with its note. Onsets (above), not
  // raw step indices, keep tied notes and selected measure ranges aligned.
  useLayoutEffect(() => {
    if (!showCursor) return undefined;
    const notes = currentStep?.notes ?? [];
    const svg = notes.find((note) => note.el?.ownerSVGElement)?.el?.ownerSVGElement;
    let rectangle = null;
    if (svg) {
      const matrix = svg?.getScreenCTM?.();
      if (matrix) {
        const inverse = matrix.inverse();
        const point = svg.createSVGPoint();
        const noteBounds = notes.flatMap(({ el }) => {
          const bounds = el?.getBoundingClientRect?.();
          if (!bounds?.width || !bounds?.height) return [];
          point.x = bounds.left; point.y = bounds.top;
          const start = point.matrixTransform(inverse);
          point.x = bounds.right; point.y = bounds.bottom;
          const end = point.matrixTransform(inverse);
          return [{ left: start.x, right: end.x, top: start.y, bottom: end.y }];
        });
        const cursor = passageCursorBounds({
          noteBounds,
          staffBoxes: layout?.staffBoxes ?? [],
          activeStaffs: [...new Set((layout?.steps ?? []).flatMap((step) => (step.notes ?? []).map((note) => note.staff ?? 0)))],
          onsetStaffs: [...new Set(notes.map((note) => note.staff ?? 0))],
        });
        if (cursor) {
          rectangle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rectangle.setAttribute('class', `piano-score-passage__cursor${windowOpen === true ? ' is-window-open' : windowOpen === false ? ' is-window-closed' : ''}`);
          Object.entries(cursor).forEach(([name, value]) => rectangle.setAttribute(name, value));
          rectangle.setAttribute('rx', 4);
          rectangle.setAttribute('aria-hidden', 'true');
          svg.insertBefore(rectangle, svg.firstChild);
        }
      }
    }
    return () => rectangle?.remove();
  }, [currentStep, layout?.staffBoxes, layout?.steps, showCursor, windowOpen]);

  // Part selection happened in the MusicXML itself; every remaining staff is active.
  const activeParts = useMemo(() => {
    const parts = {};
    for (const step of layout?.steps ?? []) for (const note of step.notes ?? []) {
      const staff = note.staff ?? 0;
      parts[staff] = true;
    }
    return parts;
  }, [layout]);

  /** The wrong flash, on the note that was owed. Same pattern as the lit layer. */
  useLayoutEffect(() => {
    if (judged || wrongMidi == null) return undefined;
    const flashed = [];
    for (const note of currentStep?.notes ?? []) {
      if (!note.el) continue;
      note.el.classList.add(WRONG);
      flashed.push(note.el);
    }
    return () => { for (const el of flashed) el.classList.remove(WRONG); };
  }, [currentStep, judged, wrongMidi]);

  /**
   * The RECORD, painted onto the engraved notes of a timed run. Found by
   * onset, like the cursor, so ties and measure ranges stay aligned with the
   * expectation's event index.
   */
  useLayoutEffect(() => {
    if (!judged || !expectation) return undefined;
    const classed = [];
    const ticks = [];
    verdicts.forEach((byMidi, index) => {
      const event = expectation.events[index];
      if (!event) return;
      const notes = elsByOnset.get(onsetKey(event.onsetQuarter)) ?? [];
      const wrong = [...byMidi.values()].some((verdict) => verdict.state === 'wrong');
      for (const note of notes) {
        if (!note.el) continue;
        const verdict = byMidi.get(note.midi);
        const kind = verdict ? VERDICT_KIND[verdict.state] : null;
        const name = kind ? `piano-note-verdict-${kind}` : wrong ? WRONG : null;
        if (!name) continue;
        note.el.classList.add(name);
        note.el.setAttribute('data-verdict', verdict?.state ?? 'owed');
        classed.push([note.el, name]);
        if (kind === 'early' || kind === 'late') {
          const tick = driftTick(note.el, kind);
          if (tick) ticks.push(tick);
        }
      }
    });
    return () => {
      for (const [el, name] of classed) { el.classList.remove(name); el.removeAttribute('data-verdict'); }
      for (const tick of ticks) tick.remove();
    };
  }, [elsByOnset, expectation, judged, verdicts]);

  return (
    <div className="piano-score-passage" data-system-count={systemCount || undefined} data-cursor-enabled={String(showCursor)}>
      {focused.musicXml ? (
        <MusicXmlRenderer key={`${systemBreakBefore ?? 'auto'}:${renderScale}`} musicXml={focused.musicXml} scale={renderScale} newSystemFromXML onLayout={handleLayout} onFailed={handleEngraveFailed}>
          <NoteHighlightLayer step={currentStep} activeParts={activeParts} />
        </MusicXmlRenderer>
      ) : (
        <div className="musicxml-renderer musicxml-renderer--placeholder" role="status">
          <p>Could not read this score.</p>
        </div>
      )}
    </div>
  );
}

/** The tempo a score that names none is counted at — the Sheet Music surface's own. */
const DEFAULT_BPM = 90;
const MAX_PASSAGE_SYSTEMS = 2;
const MIN_PASSAGE_SCALE = 0.65;
/** A recorded verdict state → the class suffix painted on its engraved note. */
const VERDICT_KIND = Object.freeze({ hit: 'hit', early: 'early', late: 'late', lapsed: 'unplayed', miss: 'unplayed' });
const DRIFT_TICK = Object.freeze({ early: '\u25C2', late: '\u25B8' });

/**
 * A ◂/▸ tick under an engraved note, in its SVG's own coordinates (the same
 * screen-to-user mapping the cursor uses). Returns the inserted element, or
 * null where there is no geometry (happy-dom, a detached note).
 */
function driftTick(el, side) {
  const svg = el?.ownerSVGElement;
  const matrix = svg?.getScreenCTM?.();
  if (!matrix) return null;
  const bounds = el.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const point = svg.createSVGPoint();
  point.x = bounds.left + bounds.width / 2; point.y = bounds.bottom;
  const at = point.matrixTransform(matrix.inverse());
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('class', `piano-score-passage__drift piano-score-passage__drift--${side}`);
  text.setAttribute('x', at.x);
  text.setAttribute('y', at.y + 12);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', 12);
  text.setAttribute('aria-hidden', 'true');
  text.textContent = DRIFT_TICK[side];
  svg.appendChild(text);
  return text;
}

/** The owed note, when something else was played. */
const WRONG = 'piano-note-wrong';
/** Onsets are floats; compare them the way the score compiler groups them. */
const onsetKey = (onsetQuarter) => (Number(onsetQuarter) || 0).toFixed(6);
