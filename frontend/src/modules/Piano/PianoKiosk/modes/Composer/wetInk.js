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
