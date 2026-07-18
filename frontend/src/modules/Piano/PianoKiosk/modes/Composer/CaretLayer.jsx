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

// Clef + key + time signature eat roughly this many staff spaces at the head of
// a system, so a bar with nothing engraved in it starts about here. Lives here
// rather than in EditorSurface because TWO things must agree on it: this file's
// blank-staff caret and EditorSurface's tier-3 wet-ink anchor. If they drifted
// apart, the first note a kid played on a blank draft would land somewhere other
// than where the caret promised it would.
export const MEASURE_START_UNITS = 8;

/**
 * The caret's VERTICAL extent against a stave — its own geometry, independent of
 * any note. Exported because EditorSurface's wet-ink override needs the identical
 * numbers: the caret must not change height or jump vertically at the moment ink
 * dries, so blank-staff, wet, and engraved paths all resolve to the same band.
 * The 40 * scale floor is the engraved path's floor, kept verbatim.
 */
export function staveCaretMetrics(staff, scale = 1) {
  return { top: staff.top, height: Math.max(40 * scale, staff.lineSpacing * 4) };
}

// Where the caret sits with NOTHING engraved — the screen every session opens
// on. The renderer's buildSteps excludes rests and a blank draft is displayed as
// a whole-measure rest, so `steps` is empty and the engraved math has nothing to
// work with. Stave geometry, however, is published even for a note-less staff.
function blankStavePosition(staves, scale) {
  const staff = staves[0]; // no steps ⇒ nothing has been engraved anywhere ⇒ first system
  if (!staff) return null;
  return { x: staff.left + staff.lineSpacing * MEASURE_START_UNITS, ...staveCaretMetrics(staff, scale) };
}

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
 * PRECEDENCE — override, then engraved, then blank stave. Each tier is a strictly
 * better-informed answer to "where will the next note go", so the order is by
 * freshness of knowledge, not by convenience:
 *
 *  1. OVERRIDE wins outright. It is supplied only while wet ink is drying, and
 *     the wet layer is the ONLY thing that knows where it just painted —
 *     `caretStepIndex` counts the MODEL while `steps` reflects the LAST ENGRAVE,
 *     so during pending notes the two disagree and the engraved math would park
 *     the caret to the LEFT of the notes the kid just played. It must also beat
 *     the blank-stave tier, because the first note on a blank draft is exactly
 *     the case where there is wet ink AND no engraving; deferring to the stave
 *     there would pin the caret at the bar's entry point while notes piled up to
 *     its right.
 *  2. ENGRAVED next: a real layout for a real note beats a guess at where a bar
 *     begins.
 *  3. BLANK STAVE last — a floor, not a preference. It answers only when nothing
 *     better exists, which includes a degenerate step carrying no note box:
 *     showing the caret at the bar's entry point beats showing no caret at all.
 *
 * @param {{x:number, top:number, height:number}} [override] wet-ink position.
 * @param {Array<{top:number,left:number,right:number,lineSpacing:number}>} [staves]
 *   per-system staff geometry from the layout extract — published even for a
 *   note-less staff, which is what makes tier 3 possible.
 */
export function CaretLayer({ steps = [], staves = [], caretStepIndex = 0, scale = 1, override = null }) {
  const pos = override || engravedPosition(steps, caretStepIndex, scale) || blankStavePosition(staves, scale);
  if (!pos) return null;
  return (
    <div
      className="composer-caret"
      style={{ transform: `translate3d(${pos.x}px, ${pos.top}px, 0)`, width: Math.round(CARET_WIDTH * scale), height: pos.height }}
    />
  );
}
