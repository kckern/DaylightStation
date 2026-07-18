// A layout note box occasionally arrives without a width. EditorSurface's
// wet-ink anchor reads the same field, so both substitute the same value for
// the same absence.
export const NOTE_WIDTH_FALLBACK = 12;

// How far the caret's LEFT EDGE clears the right edge of the note it parks
// after. Exported because EditorSurface reuses it: the wet caret must sit the
// same distance past the last WET notehead that this sits past the last
// ENGRAVED one, or the caret jumps sideways the moment ink dries.
export const CARET_GAP = 6;

// The caret is positioned by its LEFT edge (translate3d on a fixed-width div),
// and it is this width that has to stay inside the staff when clamped.
export const CARET_WIDTH = 18;

// Where the caret sits against the ENGRAVED layout: `steps` comes from the last
// OSMD engrave, so this is only right while the engraving is current.
function engravedPosition(steps, caretStepIndex, scale) {
  if (!steps.length) return null;
  const clamped = Math.min(caretStepIndex, steps.length - 1);
  const step = steps[clamped];
  const note = step?.notes?.[0];
  if (!note) return null;
  // Past-the-end caret parks just right of the last note; otherwise sits at the step's x.
  const past = caretStepIndex >= steps.length;
  const x = past ? note.x + (note.width || NOTE_WIDTH_FALLBACK) + CARET_GAP * scale : note.x;
  const height = Math.max(40 * scale, (note.bottom - note.top) || 40);
  return { x, top: note.top, height };
}

/**
 * @param {{x:number, top:number, height:number}} [override] — bypasses the
 * step-index math entirely. Needed while wet ink is drying: `caretStepIndex`
 * counts the MODEL, but `steps` reflects the LAST ENGRAVE, so during pending
 * notes the two disagree and the engraved math would park the caret to the LEFT
 * of the notes the kid just played. The wet-ink layer knows where it painted, so
 * it supplies the position directly.
 */
export function CaretLayer({ steps = [], caretStepIndex = 0, scale = 1, override = null }) {
  const pos = override || engravedPosition(steps, caretStepIndex, scale);
  if (!pos) return null;
  return (
    <div
      className="composer-caret"
      style={{ transform: `translate3d(${pos.x}px, ${pos.top}px, 0)`, width: Math.round(CARET_WIDTH * scale), height: pos.height }}
    />
  );
}
