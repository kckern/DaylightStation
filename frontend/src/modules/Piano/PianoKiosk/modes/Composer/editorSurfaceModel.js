// editorSurfaceModel.js — pure score-geometry and display-shaping helpers for
// EditorSurface.jsx, split out so Fast Refresh can hot-reload the surface
// component on its own.
import { serializeFromEditor, makeRest } from './model/index.js';
import { systemForY } from './caretGeometry.js';
import { MEASURE_START_UNITS } from './CaretLayer.jsx';
import { WET_ADVANCE_UNITS, WET_RX_UNITS } from './wetGlyphGeometry.js';

// How many measures a sheet shows even when the model has fewer. Manuscript
// paper is ruled ahead of what is written on it; a lone bar fragment on a big
// white card reads as a broken widget instead of something to fill in.
export const DISPLAY_MIN_BARS = 4;

// A blank fallback used by wetInkAnchor when no engraved geometry exists yet.
const NOTE_WIDTH_FALLBACK = 12;

/**
 * Where the FIRST wet-ink note should paint, in engraved pixel space, plus which
 * system it lands on. PendingLayer treats `anchorX` as a notehead CENTRE, while
 * an engraved step's `x` is its box LEFT edge — hence the half-width term.
 *
 * Three tiers, because the caret's bar is not always engraved:
 *  1. the caret's bar HAS engraved notes → one wet advance past the last one;
 *  2. it does not (a bar the previous settle just opened is still empty) → fall
 *     back to the last engraved note anywhere, plus a barline's breathing room;
 *  3. nothing is engraved at all (blank draft) → the head of the first system.
 *
 * @param {number} pendingCount how many notes will paint from this anchor. Tier
 *   2 needs it: the wrap decision has to consider where the LAST note of the run
 *   lands, not the first. A bar of sixteenths can leave 8+ notes pending, and
 *   judging by note 0 alone would let notes 3-8 clamp onto the margin in a pile.
 * @returns {{x:number, system:number}|null} null when there is no geometry yet.
 */
export function wetInkAnchor({ steps = [], staves = [], caretMeasureIdx = 0, pendingCount = 1 }) {
  if (!staves.length) return null;
  let inBar = null;
  for (let i = steps.length - 1; i >= 0; i--) {
    if ((steps[i].measure ?? 0) === caretMeasureIdx) { inBar = steps[i]; break; }
  }
  const box = (inBar || steps[steps.length - 1])?.notes?.[0];
  if (!box) return { x: staves[0].left + staves[0].lineSpacing * MEASURE_START_UNITS, system: 0 };

  const system = systemForY(box.top, staves);
  const staff = staves[system];
  const ls = staff.lineSpacing;
  const maxX = staff.right - ls * WET_RX_UNITS; // never spill past the system's end
  const x = box.x + (box.width || NOTE_WIDTH_FALLBACK) / 2 + ls * WET_ADVANCE_UNITS;

  // Tier 1 has NO wrap escape, deliberately: the caret's bar is already engraved
  // on THIS system, so its notes belong here. Moving them to the next system
  // would be wrong, not merely unimplemented — the clamp is the only option.
  if (inBar) return { x: Math.min(x, maxX), system };

  // Tier 2: anchoring off the PREVIOUS bar's last note. If the pending run
  // wouldn't fit before the end of this system, OSMD will have opened the new
  // bar on the next one — follow it there rather than clamping the tail of the
  // run into the margin, which stacks those notes into an unreadable pile.
  const runEnd = x + Math.max(0, pendingCount - 1) * ls * WET_ADVANCE_UNITS;
  if (runEnd > maxX && staves[system + 1]) {
    const next = staves[system + 1];
    return { x: next.left + next.lineSpacing * MEASURE_START_UNITS, system: system + 1 };
  }
  return { x: Math.min(x + ls, maxX), system };
}

// Caret model position → engraved step index. The renderer's buildSteps
// (osmdRender.js) groups same-onset notes — chords — into a SINGLE step, but
// the model stores each chord note as its own array entry flagged `chord:
// true` (model/editor.js). So a step index must count ONSET notes only (i.e.
// notes where !note.chord), never raw note-array length, or the caret drifts
// right by (chord-size - 1) per chord at/before it. The renderer's buildSteps
// also EXCLUDES rests entirely (`n.isRest()` — osmdRender.js ~line 40), so a
// model rest (makeRest: `rest: true`, no `chord` field) must be excluded here
// too, or the caret drifts right by the rest count.
export function caretStepIndex(score, caret) {
  const measures = score?.parts?.[0]?.measures || [];
  const onsets = (notes = [], upto = notes.length) => notes.slice(0, upto).filter((n) => !n.chord && !n.rest).length;
  let idx = 0;
  for (let m = 0; m < caret.measureIdx; m++) idx += onsets(measures[m]?.notes);
  return idx + onsets(measures[caret.measureIdx]?.notes, caret.noteIdx);
}

/**
 * DISPLAY copy of the score in which every note-less measure carries a
 * full-measure rest. OSMD cannot engrave an empty measure (and a MusicXML bar
 * can't be truly empty), which makes this the fix for two shapes:
 *
 *  - the untouched DRAFT — a kid lands on a real clef'd staff to play into,
 *    rather than on nothing;
 *  - the EMPTY TRAILING BAR the two-plane split parks on. insertNote's
 *    exact-fill branch calls ensureMeasure, so the note that fills a bar opens
 *    an empty one behind it — exactly the state a 'structural' settle engraves.
 *    Serialized as-is OSMD throws ("Cannot read properties of undefined
 *    (reading 'StaffEntries')"), MusicXmlRenderer sets `failed` and stops
 *    rendering its children, so the staff AND both overlays blank out. Verified
 *    in headless Chromium 2026-07-18; it reproduces on the pre-split code too,
 *    where it self-heals on the next keystroke because that re-serializes.
 *    Under the split it persists for a whole bar.
 *
 * DRAWING the empty bar (rather than trimming it away) is also what gives wet
 * ink somewhere to go: the engraved system extends to cover the new bar, so the
 * anchor has room inside it. Trimmed, the system stops at the previous bar and
 * every pending note clamps onto its right margin in an unreadable pile —
 * observed, screenshotted, and fixed this way.
 *
 * Render-only and NEVER saved: autosave serializes editorState directly.
 */
export function withDisplayRests(score) {
  const parts = score?.parts || [];
  if (!parts.some((p) => (p.measures || []).some((m) => !(m.notes || []).length))) return score;
  return {
    ...score,
    parts: parts.map((p) => ({
      ...p,
      measures: (p.measures || []).map((m) => ((m.notes || []).length ? m : { ...m, notes: [makeRest({ type: 'whole' })] })),
    })),
  };
}

/**
 * DISPLAY copy padded out to look like ruled manuscript paper: bars the model
 * does not have, appended so the sheet always shows something to fill in.
 *
 * Two rules, whichever asks for more:
 *  - a floor of `minBars`, so an untouched draft is a page of empty systems
 *    rather than one bar fragment adrift on a white card;
 *  - one empty RUNWAY bar past the last bar that has notes, so a kid writing
 *    into the last bar can always see where the next one goes.
 *
 * The runway is measured from the last FILLED bar, not from the model's length,
 * so the empty trailing bar ensureMeasure already opened counts AS the runway
 * instead of earning a second one behind it.
 *
 * Purely additive and non-mutating: the bars are appended to a copy. Autosave
 * serializes editorState directly (useAutosave), so none of this is ever saved.
 */
export function padDisplayMeasures(score, minBars = DISPLAY_MIN_BARS) {
  const parts = score?.parts || [];
  if (!parts.length) return score;
  let lastFilled = -1;
  let modelBars = 0;
  for (const p of parts) {
    const ms = p.measures || [];
    if (ms.length > modelBars) modelBars = ms.length;
    for (let i = 0; i < ms.length; i++) if ((ms[i].notes || []).length) lastFilled = Math.max(lastFilled, i);
  }
  const wanted = Math.max(minBars, lastFilled + 2); // +1 index→count, +1 runway
  if (wanted <= modelBars) return score;
  return {
    ...score,
    parts: parts.map((p) => {
      const measures = (p.measures || []).slice();
      while (measures.length < wanted) measures.push({ number: measures.length + 1, notes: [] });
      return { ...p, measures };
    }),
  };
}

// Pad FIRST, then rest: the bars padding appends are note-less, and a note-less
// bar is exactly what OSMD cannot engrave.
export function serializeForDisplay(editorState, minBars = DISPLAY_MIN_BARS) {
  const score = withDisplayRests(padDisplayMeasures(editorState?.score, minBars));
  return serializeFromEditor({ ...editorState, score });
}
