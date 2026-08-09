import { useLayoutEffect, useRef } from 'react';
import { usePianoMidiNotes } from '../../PianoMidiContext.jsx';
import { WetNoteGlyph } from '../Composer/wetGlyphs.jsx';
import { spellMidi } from '../../../../MusicNotation/model/spellMidi.js';
import { inputKind, writtenMidisAtStep } from './inputKind.js';
import { expectedMidisAtStep } from './activeParts.js';

/** Class the ENGRAVED notehead wears while the player is holding that exact pitch. */
export const MATCH_CLASS = 'piano-note-match';

/**
 * LiveInputLayer — what the player is holding RIGHT NOW, against the score.
 * Live in Listen, Learn and Polish; absent in Perform, which has no chrome.
 *
 * The two kinds are drawn by two different mechanisms, deliberately:
 *
 * - A **match** RECOLOURS the engraved notehead in place, the same way the lit and
 *   hit states do. It draws nothing of its own. An earlier version drew a mark at
 *   measured coordinates and it was wrong twice over: the cursor's x is not the
 *   notehead's centre, so the mark sat beside the note it was affirming, and when
 *   a notehead's own measurement was unavailable the geometry fell back to the
 *   cursor's box — which spans the whole grand staff — putting an oversized mark
 *   adrift mid-system. Recolouring removes coordinates from the problem entirely,
 *   and makes a match read as what it is: the printed note turning green.
 * - A **ghost** has no engraved note to recolour — the pitch isn't on the page —
 *   so it is drawn, as a full glyph in the cursor column, spelled from the
 *   SOUNDING key so a transposed score still reads correctly.
 *
 * Nothing is drawn for a non-match while Learn's gate is grading: that note is
 * already inked red by the wrong-note path (see inputKind).
 *
 * It subscribes to the live-note store ITSELF rather than taking held notes as a
 * prop. That is deliberate: `usePianoMidiNotes` re-renders its caller on every
 * note event by design, and the 2026-07-06 decoupling audit (R1) exists to keep
 * that traffic away from everything else. Holding the subscription here confines
 * the per-keypress re-render to this small component instead of ScorePlayer.
 *
 * Ghosts are ONE <svg> with many children — the same discipline as the wet-ink
 * layer: this redraws on every key event, and one node with N shapes costs a
 * single style/layout pass where N positioned elements cost N.
 *
 * @param {object} p
 * @param {{notes: Array<{midi:number, staff:number, el:Element}>}|null} p.step - cursor step
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

  // While the gate grades, defer to ITS notion of what is expected — scoped to the
  // active hands. Otherwise a pitch the gate is calling wrong (the other hand's
  // note during one-handed practice) would be shown green as if it were right.
  const written = step
    ? (gateActive ? expectedMidisAtStep(step, activeParts) : writtenMidisAtStep(step))
    : new Set();

  const held = activeNotes && activeNotes.size ? [...activeNotes.keys()] : [];

  // Matches: recolour the engraved noteheads. Cleared on the way out so a class is
  // never stranded on an element this component does not own — OSMD's SVG outlives
  // it across mode changes, and a re-engrave replaces the elements entirely.
  const litRef = useRef([]);
  const matchEls = [];
  if (step) {
    for (const midi of held) {
      if (inputKind(midi, written, gateActive) !== 'match') continue;
      const n = (step.notes || []).find((nn) => nn.midi === midi);
      if (n?.el) matchEls.push(n.el);
    }
  }
  // Identity of the set, so the effect only touches the DOM when it really changes.
  const matchKey = matchEls.length;
  const heldKey = held.join(',');
  useLayoutEffect(() => {
    for (const el of matchEls) el.classList?.add(MATCH_CLASS);
    litRef.current = matchEls;
    return () => { for (const el of litRef.current) el.classList?.remove(MATCH_CLASS); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldKey, matchKey, step, gateActive]);

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
