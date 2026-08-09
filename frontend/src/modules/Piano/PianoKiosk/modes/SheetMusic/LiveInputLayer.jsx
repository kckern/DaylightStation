import { usePianoMidiNotes } from '../../PianoMidiContext.jsx';
import { WetNoteGlyph } from '../Composer/wetGlyphs.jsx';
import { spellMidi } from '../../../../MusicNotation/model/spellMidi.js';
import { inputKind, writtenMidisAtStep } from './inputKind.js';
import { expectedMidisAtStep } from './activeParts.js';

/**
 * LiveInputLayer — the notes you are holding that are NOT on the page here.
 *
 * It draws ghosts and nothing else. Whether a note you played was right or wrong
 * is reported as an EVENT, at the moment it is judged — green by the correct-note
 * flash, red by the wrong-note ink — because that is a claim about something that
 * happened, and held state cannot make it honestly. A key still down from the
 * previous note would otherwise be drawn correct against the note after it, which
 * on a repeated note means the page says "right" while the cursor waits for a
 * press that never came. See inputKind for the full reasoning.
 *
 * What held state CAN say is "I am holding this and it is not written here", so
 * that is what this layer draws: at the pitch played, in the cursor column,
 * spelled from the SOUNDING key so a transposed score still reads correctly.
 * While the gate is judging it draws nothing at all — every held pitch there is
 * either written (the flash owns it) or wrong (the red ink owns it).
 *
 * It subscribes to the live-note store ITSELF rather than taking held notes as a
 * prop. That is deliberate: `usePianoMidiNotes` re-renders its caller on every
 * note event by design, and the 2026-07-06 decoupling audit (R1) exists to keep
 * that traffic away from everything else. Holding the subscription here confines
 * the per-keypress re-render to this small component instead of ScorePlayer.
 *
 * Everything is ONE <svg> with many children — the same discipline as the wet-ink
 * layer: this redraws on every key event, and one node with N shapes costs a
 * single style/layout pass where N positioned elements cost N.
 *
 * @param {object} p
 * @param {{notes: Array<{midi:number, staff:number}>}|null} p.step - cursor step
 * @param {number} p.cursorX - x of the cursor column, layout pixel space
 * @param {number} p.system - which system the cursor is on
 * @param {Array<{system:number, staff:number, top:number, left:number, right:number, lineSpacing:number}>} p.staffBoxes
 * @param {Object} p.clefs - 0-based staff id → { sign }
 * @param {number} p.keyFifths - SOUNDING key signature, so transposed scores spell right
 * @param {boolean} p.gateActive - the gate is judging what you play
 * @param {Object} p.activeParts - 0-based staff id → true, the hands the gate is
 *   currently judging. Only consulted while `gateActive`.
 */
export default function LiveInputLayer({
  step = null, cursorX = 0, system = 0, staffBoxes = [], clefs = {}, keyFifths = 0, gateActive = false, activeParts = {},
}) {
  const { activeNotes } = usePianoMidiNotes();

  // While the gate grades, defer to ITS notion of what is expected — scoped to the
  // active hands. Otherwise a pitch the gate is calling wrong (the other hand's
  // note during one-handed practice) would be shown green as if it were right.
  const written = step
    ? (gateActive ? expectedMidisAtStep(step, activeParts) : writtenMidisAtStep(step))
    : new Set();

  const held = activeNotes && activeNotes.size ? [...activeNotes.keys()] : [];

  if (!step || !staffBoxes.length || !held.length) return null;

  const glyphs = [];
  for (const midi of held) {
    if (inputKind(midi, written, gateActive) !== 'ghost') continue;

    // Which staff does a ghost belong on? The staff of the nearest WRITTEN pitch,
    // so a fumbled left-hand note lands on the left-hand staff. With nothing
    // written here, fall back to the top staff.
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
