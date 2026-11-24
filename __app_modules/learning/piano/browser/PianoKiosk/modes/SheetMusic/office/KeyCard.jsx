import { StaffNoteLabel } from '../../../../game-platform/families/addressed-board/StaffNoteLabel.jsx';

/**
 * The note card on an office key: the key's note on its staff, with its clef,
 * drawn whole. A row of keys shares one `extent` (`rimStaffExtent` over the
 * row's notes) so every card in it is one size and the lowest note's ledger
 * lines fit: C2, two ledger lines under the bass staff, is drawn, not clipped.
 * The box is fixed by `.office-key-card`, never by the drawing.
 */
export default function KeyCard({ note, extent }) {
  return (
    <span className="office-key-card" aria-hidden="true">
      <StaffNoteLabel midi={note} extent={extent} />
    </span>
  );
}
