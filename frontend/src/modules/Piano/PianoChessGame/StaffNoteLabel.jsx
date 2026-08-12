import { SvgStaffRenderer } from '../../MusicNotation/renderers/SvgStaffRenderer.jsx';
import './StaffNoteLabel.scss';

/**
 * One note on a card, drawn on its own staff with its clef — a rim label for
 * the reading vocabulary.
 *
 * The staff itself is the shared `SvgStaffRenderer`, the same engraver the
 * side-scroller and Tetris action staves use, so a note on the chess rim is
 * drawn by exactly the code that draws a note anywhere else in the piano games
 * — clef, ledger lines, accidentals and all. It picks the clef from the pitch
 * (C4 and above is treble), which is why the ranks come out bass and the files
 * treble without being told.
 *
 * The card is the house treatment for notation on a dark screen: notation needs
 * paper under it, because staff lines and noteheads are drawn as ink.
 */
export function StaffNoteLabel({ midi }) {
  return (
    <div className="chess-staff-label action-staff">
      <SvgStaffRenderer targetPitches={[midi]} />
    </div>
  );
}

export default StaffNoteLabel;
