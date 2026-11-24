import Icon from '../../../../ui/icons/Icon.jsx';
import { StaffNoteLabel } from '../../../../game-platform/families/addressed-board/StaffNoteLabel.jsx';
import { PassageMap, usePrintedTitle } from '../../../desk/PianoHomeDesk.jsx';
import { cardBadge, pieceFocus, piecePolishing } from '../../../desk/deskModel.js';

/** One piece on its key: the note that opens it, its title, its level badge and its passage map. */
function PieceKey({ slot }) {
  const piece = slot.item;
  const title = usePrintedTitle(piece.scoreId);
  const badge = cardBadge({ piece });
  const focus = piecePolishing(piece) ? null : pieceFocus(piece);
  return (
    <li className="office-piece-key" data-score={piece.scoreId}>
      <span className="office-piece-key__poster" aria-hidden="true">
        {piece.cover ? <img src={piece.cover} alt="" decoding="async" /> : <Icon name="sheet-music" className="office-piece-key__stand-in" />}
      </span>
      <span className="office-piece-key__badge piano-desk__badge" data-level={badge.level}>{badge.label}</span>
      <strong className="office-piece-key__title">{title}</strong>
      <span className="office-piece-key__map"><PassageMap piece={piece} focusId={focus?.id} /></span>
      <span className="office-piece-key__tip">
        <StaffNoteLabel midi={slot.note} />
        <span className="office-piece-key__note">{slot.noteName}</span>
      </span>
    </li>
  );
}

/**
 * The office screen's piece picker: the player's pieces, newest first, one per
 * white key from middle C; the octave below turns the page when there are more
 * than one row holds. Drawn as keys because it is played, never tapped.
 */
export default function OfficePiecePicker({ playerName, page }) {
  const { slots, pageSlots, pageCount, page: at } = page;
  return (
    <section className="office-piece-picker" aria-label="Pick a piece">
      <header className="office-piece-picker__head">
        <h2>{playerName ? `${playerName}’s pieces` : 'Pieces'}</h2>
        <p>Play a piece’s key to practise it · hold the lowest and highest keys to leave</p>
      </header>
      <ol className="office-piece-picker__keys" style={{ '--key-count': Math.max(slots.length, 4) }}>
        {slots.map((slot) => <PieceKey key={slot.item.scoreId} slot={slot} />)}
      </ol>
      {pageCount > 1 && (
        <ol className="office-piece-picker__pages" aria-label={`Page ${at + 1} of ${pageCount}`}>
          {pageSlots.map((slot) => (
            <li key={slot.note} className="office-piece-picker__page" data-current={slot.current || undefined}>
              <span className="office-piece-picker__page-note">{slot.noteName}</span>
              <span>{slot.item.label}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
