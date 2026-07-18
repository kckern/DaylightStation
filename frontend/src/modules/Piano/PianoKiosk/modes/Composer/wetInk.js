// wetInk.js — pure decision core of the PendingLayer (spec §2.1).
//
// OSMD has no incremental-edit API: every change costs a full serialize → load →
// re-engrave, which tears down and rebuilds the whole sheet. So rendering splits
// in two: a SETTLED score OSMD engraves rarely, and a wet-ink layer that paints
// just-added notes instantly with lightweight SVG.
//
// pendingAppendDiff(settled, live) answers the ONE question that split turns on:
// is `live` exactly `settled` plus zero-or-more notes APPENDED to a single
// measure? If yes, those notes can paint as wet ink and OSMD can wait. Anything
// else (delete, edit, undo, multi-measure growth, a new bar, an attribute
// change) returns null → the caller must settle (engrave).
//
// Kid-scale scores are a few dozen bars, so a JSON compare per keypress is
// cheap enough and far cheaper than the engrave it avoids.
//
// TRIPWIRE: stringify is a sound equality test only while the score stays
// JSON-plain. structuredClone faithfully clones Map/Set, and two DIFFERENT Maps
// both stringify to "{}" — a collision in the UNSAFE direction (a real change
// read as no-change, so it never engraves). Nothing in the model carries one
// today (part.clefs is a plain object); if that changes, this needs a real
// deep-equal.
import { useEffect, useMemo, useRef, useState } from 'react';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Everything about the score EXCEPT the note contents: title, key, tempo, clef,
 * part list, measure count and numbering. Any difference here is structural and
 * the wet-ink layer cannot express it, so skeleton inequality alone forces a
 * settle. Notably this catches the two cases a notes-only walk would miss:
 *   - a score-attribute edit (new key/time) touches no note, so a notes-only
 *     comparison would report "nothing changed" and the new key signature would
 *     never engrave;
 *   - a note that fills or straddles the bar opens a NEW measure, and a new
 *     measure means a new BARLINE — which only OSMD can draw.
 */
function skeleton(score) {
  return {
    ...score,
    parts: (score?.parts || []).map((p) => ({
      ...p,
      measures: (p.measures || []).map((m) => ({ ...m, notes: undefined })),
    })),
  };
}

export function pendingAppendDiff(settled, live) {
  if (!settled || !live) return null;
  if (!same(skeleton(settled), skeleton(live))) return null;

  const sParts = settled.parts || [];
  const lParts = live.parts || [];
  let found = null;
  for (let p = 0; p < lParts.length; p++) {
    const sMeasures = sParts[p]?.measures || [];
    const lMeasures = lParts[p]?.measures || [];
    for (let m = 0; m < lMeasures.length; m++) {
      const sNotes = sMeasures[m]?.notes || [];
      const lNotes = lMeasures[m]?.notes || [];
      if (lNotes.length < sNotes.length) return null; // something was removed
      // The kept notes must be untouched AND still in order — an edit or a
      // reorder is not an append.
      if (!same(sNotes, lNotes.slice(0, sNotes.length))) return null;
      if (lNotes.length > sNotes.length) {
        if (found) return null; // grew in two places → settle
        // The grown measure must be the LAST one, because wet ink can only paint
        // past the end of the engraving. Appending into an earlier measure widens
        // it, which REFLOWS every bar to its right — and the lightweight layer
        // can't move engraved bars, so the wet ink would land on top of them.
        // Reachable without any exotic input: deleteNote doesn't reflow, so
        // deleting from a full bar and moving the caret back into it leaves an
        // underfull non-final measure the kid can type into. An imported score
        // with a pickup bar has the same shape from the start.
        if (m !== lMeasures.length - 1) return null;
        const notes = lNotes.slice(sNotes.length);
        // Forward-looking: a chord member shares its principal's onset instead of
        // advancing time, but wet ink lays appended notes at successive
        // x-positions — it would draw the chord as a separate sequential note.
        // Nothing in the Composer input path sets `chord` today (chords arrive
        // only via parsed MusicXML, where they're already settled), so this costs
        // nothing now and fails safe if that changes.
        if (notes.some((n) => n.chord)) return null;
        found = { measureIdx: m, notes };
      }
    }
  }
  return found || { measureIdx: null, notes: [] };
}

// Stable identity so a settled editor hands its consumer the same `pending`
// object every render — PendingLayer then has nothing to diff.
const NO_PENDING = { measureIdx: null, notes: [] };

/**
 * The settle POLICY on top of pendingAppendDiff: owns WHEN the engraved
 * (settled) score is allowed to catch up to the live one.
 *
 * Two triggers, and BOTH are load-bearing — neither subsumes the other:
 *   - structural / measure-exit → settle NOW. This is what bounds wet ink during
 *     UNBROKEN fast entry, which never goes idle. insertNote's exact-fill branch
 *     calls ensureMeasure (model/editor.js), so the note that fills a bar opens
 *     the next one, pendingAppendDiff returns null, and we engrave. Hence the
 *     spec §2.1 promise: the settled score is never more than one bar behind.
 *   - idle → settle after `idleMs` of quiet. This is what covers the kid PAUSING
 *     mid-bar; without it the ink would stay wet indefinitely.
 *
 * @returns {{settledScore: object, pending: {measureIdx: number|null, notes: Array}}}
 */
export function useWetInk({ score, caretMeasureIdx, idleMs = 600, logger }) {
  const [settled, setSettled] = useState(score);
  // Logger identity is NOT an effect dep: a caller that rebuilds its child
  // logger each render would otherwise clear and reschedule the idle timer on
  // every render, and a busy component would strand the settle forever.
  const logRef = useRef(logger);
  logRef.current = logger;

  const diff = useMemo(() => pendingAppendDiff(settled, score), [settled, score]);

  useEffect(() => {
    if (settled === score) return undefined;
    // Closes over THIS render's `score`, which is correct precisely because the
    // effect re-runs (and the pending timer is cleared) on every score change:
    // the timer that finally fires is always the one holding the newest score.
    const settle = (reason) => {
      setSettled(score);
      logRef.current?.info('composer.wetink.settle', { reason });
    };
    if (diff === null) { settle('structural'); return undefined; }
    // The caret has walked out of the bar the ink is drying in, so the wet layer
    // is painting where the kid no longer is — engrave and re-anchor.
    if (diff.measureIdx !== null && diff.measureIdx !== caretMeasureIdx) { settle('measure-exit'); return undefined; }
    const id = setTimeout(() => settle('idle'), idleMs);
    return () => clearTimeout(id);
  }, [score, settled, diff, caretMeasureIdx, idleMs]);

  return { settledScore: settled, pending: diff ?? NO_PENDING };
}
