import { usePianoMidiNotes } from '../../PianoMidiContext.jsx';
import { WetNoteGlyph } from '../Composer/wetGlyphs.jsx';
import { spellMidi } from '../../../../MusicNotation/model/spellMidi.js';
import { inputKind, writtenMidisAtStep } from './inputKind.js';
import { expectedMidisAtStep } from './activeParts.js';

// Notehead proportions for a MATCH mark, in fractions of the engraved note's own
// width (`step.notes[].width`, the note's rendered bounding-box width). 0.34 was
// picked to read as a normal notehead's vertical squash next to the horizontal
// half-width (rx = width / 2) — the same rounded-oval look WetNoteGlyph's own
// notehead uses (rx 0.62 / ry 0.42 of a staff line-spacing, a similar ~0.68 ratio),
// not a circle (too round) and not a sliver (too flat to read as a note).
const MATCH_HEAD_RY_RATIO = 0.34;

/**
 * LiveInputLayer — the notes being held RIGHT NOW, drawn in the cursor column at
 * the pitch played, spelled from the SOUNDING key so a transposed score reads
 * correctly. Green when that pitch is written at the cursor, ghosted when it is
 * not. Live in Listen, Learn and Polish; absent in Perform, which has no chrome.
 *
 * It subscribes to the live-note store ITSELF rather than taking held notes as a
 * prop. That is deliberate: `usePianoMidiNotes` re-renders its caller on every
 * note event by design, and the 2026-07-06 decoupling audit (R1) exists to keep
 * that traffic away from everything else. Holding the subscription here confines
 * the per-keypress re-render to this small component instead of ScorePlayer.
 *
 * Everything is ONE <svg> with many children — the same discipline as the wet-ink
 * layer: the layer redraws on every key event, and one node with N shapes costs a
 * single style/layout pass where N positioned elements cost N.
 *
 * A MATCH is a head-only mark registered on the WRITTEN note's own engraved
 * geometry (`step.notes[].x/top/bottom/width`) — not the cursor column. The
 * cursor's x is the OSMD cursor element's centre, a different point than the
 * notehead's true centre; drawing a full glyph there produced a smeared second
 * note beside the real one, with its own stem the engraving may not agree with.
 * A GHOST has no engraved note to register against, so it still draws a full
 * glyph at the cursor column via WetNoteGlyph.
 *
 * Nothing is drawn for a non-match while Learn's gate is grading; that note is
 * already inked red by the wrong-note path (see inputKind).
 *
 * @param {object} p
 * @param {{notes: Array<{midi:number, staff:number, x:number, top:number, bottom:number, width:number}>}|null} p.step - cursor step
 * @param {number} p.cursorX - x of the cursor column, layout pixel space
 * @param {number} p.system - which system the cursor is on
 * @param {Array<{system:number, staff:number, top:number, left:number, right:number, lineSpacing:number}>} p.staffBoxes
 * @param {Object} p.clefs - 0-based staff id → { sign }
 * @param {number} p.keyFifths - SOUNDING key signature, so transposed scores spell right
 * @param {boolean} p.gateActive - Learn's gate is grading this note
 * @param {Object} p.activeParts - 0-based staff id → true, the hands the gate is
 *   currently grading. Only consulted while `gateActive` — otherwise the layer
 *   answers "is this on the page right now?", hands irrelevant (see inputKind).
 */
export default function LiveInputLayer({
  step = null, cursorX = 0, system = 0, staffBoxes = [], clefs = {}, keyFifths = 0, gateActive = false, activeParts = {},
}) {
  const { activeNotes } = usePianoMidiNotes();
  if (!step || !staffBoxes.length || !activeNotes?.size) return null;

  // While the gate grades, defer to ITS notion of what is expected — scoped to the
  // active hands. Otherwise a pitch the gate is calling wrong (the other hand's
  // note during one-handed practice) would be drawn green as if it were right.
  const written = gateActive
    ? expectedMidisAtStep(step, activeParts)
    : writtenMidisAtStep(step);

  const glyphs = [];
  for (const midi of activeNotes.keys()) {
    const kind = inputKind(midi, written, gateActive);
    if (!kind) continue;

    if (kind === 'match') {
      const n = step.notes.find((nn) => nn.midi === midi);
      if (!n) continue; // shouldn't happen (written comes from these same notes), but don't guess geometry
      const cy = (n.top + n.bottom) / 2;
      const rx = n.width / 2;
      const ry = n.width * MATCH_HEAD_RY_RATIO;
      glyphs.push(
        <g key={midi} className="piano-live-input__note is-match">
          <ellipse cx={n.x} cy={cy} rx={rx} ry={ry} fill="currentColor" />
        </g>,
      );
      continue;
    }

    // Ghost: no engraved note to register against. Which staff does it belong on?
    // The staff of the nearest WRITTEN pitch, so a left-hand note lands on the
    // left-hand staff. With nothing written here, fall back to the top staff.
    let staff = 0;
    let best = Infinity;
    for (const n of step.notes || []) {
      const d = Math.abs(n.midi - midi);
      if (d < best) { best = d; staff = n.staff; }
    }
    const box = staffBoxes.find((b) => b.system === system && b.staff === staff)
      ?? staffBoxes.find((b) => b.staff === staff);
    if (!box) continue; // geometry not reported (mid re-engrave) — skip, don't guess
    glyphs.push(
      <g key={midi} className="piano-live-input__note is-ghost">
        <WetNoteGlyph
          x={cursorX}
          staff={box}
          type="quarter"
          clef={clefs[staff] || { sign: staff >= 1 ? 'F' : 'G' }}
          pitch={spellMidi(midi, keyFifths)}
          classPrefix="piano-live-input"
        />
      </g>,
    );
  }
  if (!glyphs.length) return null;

  return <svg className="piano-live-input" aria-hidden="true">{glyphs}</svg>;
}
