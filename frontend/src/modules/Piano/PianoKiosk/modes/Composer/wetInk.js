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
        found = { measureIdx: m, notes: lNotes.slice(sNotes.length) };
      }
    }
  }
  return found || { measureIdx: null, notes: [] };
}
