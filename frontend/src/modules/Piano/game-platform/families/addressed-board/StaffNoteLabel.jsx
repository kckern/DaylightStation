import { SvgStaffRenderer } from '../../../../MusicNotation/renderers/SvgStaffRenderer.jsx';
import './StaffNoteLabel.scss';

/**
 * One note on a card, drawn on its own staff with its clef — a rim label for
 * the reading vocabulary, shared by every addressed-board game (chess's file
 * and rank rim, checkers' file and rank rim, Connect Four's column rail).
 *
 * The staff itself is the shared `SvgStaffRenderer`, the same engraver the
 * side-scroller and Tetris action staves use, so a note on any board's rim is
 * drawn by exactly the code that draws a note anywhere else in the piano games
 * — clef, ledger lines, accidentals and all. It picks the clef from the pitch
 * (C4 and above is treble), which is why a game's file axis comes out treble
 * and its rank axis bass without either caller having to say so.
 *
 * The card is the house treatment for notation on a dark screen: notation needs
 * paper under it, because staff lines and noteheads are drawn as ink.
 *
 * TWO CHANNELS OF ANSWER, both off by default and both supplied by the host:
 *
 * `held` are the keys down right now, drawn as ghost noteheads wherever they
 * land on this card's staff. The renderer has always been able to draw them and
 * nothing ever passed them, so the board's only reply to a wrong press was
 * "that chord is not on the board" — a child walking up the scale toward a note
 * got nothing back for getting closer.
 *
 * `locked` says this card's hand is exactly right. It stays lit while the other
 * hand is worked, because the player is still holding it, and it is the answer
 * to the thing that made a dyad board so punishing: a correct right hand earned
 * nothing until the left one landed, so it got thrown away and guessed again.
 *
 * @param {number|number[]} midi the note (or shape) this card names
 * @param {number[]} [held] MIDI notes currently down on this card's axis
 * @param {boolean} [locked] this card's hand is completely and correctly played
 * @param {'sharp'|'flat'} [accidental] spelling for black keys on this board
 */
export function StaffNoteLabel({ midi, midis = null, held = null, locked = false, accidental = undefined }) {
  const targetPitches = Array.isArray(midis) ? midis : (Array.isArray(midi) ? midi : [midi]);
  // `action-staff--matched` is the shared green treatment the other piano staves
  // already use for ink that is right; the local class adds the border and glow
  // that make it read as LOCKED from across the room.
  const className = `chess-staff-label action-staff${locked ? ' action-staff--matched chess-staff-label--locked' : ''}`;
  return (
    <div
      className={className}
      data-locked={locked ? 'true' : undefined}
    >
      <SvgStaffRenderer
        targetPitches={targetPitches}
        activeNotes={held}
        matched={locked}
        accidental={accidental}
      />
    </div>
  );
}

export default StaffNoteLabel;
