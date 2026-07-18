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
  const x = past ? note.x + (note.width || 12) + 6 * scale : note.x;
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
      style={{ transform: `translate3d(${pos.x}px, ${pos.top}px, 0)`, width: Math.round(18 * scale), height: pos.height }}
    />
  );
}
