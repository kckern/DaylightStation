import Icon from '../../../../ui/icons/Icon.jsx';
import { useMemo } from 'react';
import { rimStaffExtent } from '../../../../../../../../__capabilities/music-notation/browser/renderers/RimStaffRenderer.jsx';
import { PIECE_NOTES, SHELF_NOTES } from './officeKeys.js';
import KeyCard from './KeyCard.jsx';
import { PassageMap, usePrintedTitle } from '../../../desk/PianoHomeDesk.jsx';
import { cardBadge, pieceFocus, piecePolishing } from '../../../desk/deskModel.js';

// One staff size for the whole row (C4 to C5), so every key's card matches.
const ROW_EXTENT = rimStaffExtent([...PIECE_NOTES, ...SHELF_NOTES]);

const KeyTip = ({ slot }) => (
  <span className="office-piece-key__tip">
    <KeyCard note={slot.note} extent={ROW_EXTENT} />
    <span className="office-piece-key__note">{slot.noteName}</span>
  </span>
);

const Poster = ({ src }) => (
  <span className="office-piece-key__poster" aria-hidden="true">
    {src ? <img src={src} alt="" decoding="async" /> : <Icon name="sheet-music" className="office-piece-key__stand-in" />}
  </span>
);

/**
 * One piece on its key: the note that opens it, its title, and — once the
 * player has started it — its level badge and passage map. A piece from the
 * catalog the player has not started says New.
 */
function PieceKey({ slot }) {
  const piece = slot.item;
  const title = usePrintedTitle(piece.scoreId);
  const started = Array.isArray(piece.passages);
  const badge = started ? cardBadge({ piece }) : { level: 'new', label: 'New' };
  const focus = started && !piecePolishing(piece) ? pieceFocus(piece) : null;
  return (
    <li className="office-piece-key" data-score={piece.scoreId}>
      <Poster src={piece.cover} />
      <span className="office-piece-key__badge piano-desk__badge" data-level={badge.level}>{badge.label}</span>
      <strong className="office-piece-key__title">{title}</strong>
      <span className="office-piece-key__map">{started && <PassageMap piece={piece} focusId={focus?.id} />}</span>
      <KeyTip slot={slot} />
    </li>
  );
}

/** One shelf (a catalog collection) on its key. */
function ShelfKey({ slot }) {
  return (
    <li className="office-piece-key office-piece-key--shelf" data-shelf={slot.item.label}>
      <Poster src={slot.item.cover} />
      <strong className="office-piece-key__title">{slot.item.label}</strong>
      <span className="office-piece-key__count">{slot.item.count == null ? '' : slot.item.count === 1 ? '1 piece' : `${slot.item.count} pieces`}</span>
      <KeyTip slot={slot} />
    </li>
  );
}

/**
 * The office screen's picker, drawn as keys because it is played, never tapped:
 * a row of pieces (six a page) or of shelves on the white keys from middle C,
 * and under it the browse keys — your pieces ⇄ all music, Previous, Next — each
 * fixed to its own key in the octave below, dim when it does nothing.
 */
export default function OfficePiecePicker({ title, status = null, kind = 'pieces', slots = [], browse = [], page = null, keyCount }) {
  const Key = kind === 'shelves' ? ShelfKey : PieceKey;
  const browseExtent = useMemo(() => rimStaffExtent(browse.map((slot) => slot.note)), [browse]);
  return (
    <section className="office-piece-picker" aria-label={title} data-kind={kind}>
      <header className="office-piece-picker__head">
        <h2>{title}</h2>
        <p>
          {page && page.pageCount > 1 ? `Page ${page.page + 1} of ${page.pageCount}` : ''}
        </p>
      </header>
      {status
        ? <p className="office-sheet-music__status office-piece-picker__status" role="status">{status}</p>
        : (
          <ol className="office-piece-picker__keys" style={{ '--key-count': keyCount ?? Math.max(slots.length, 4) }}>
            {slots.map((slot) => <Key key={slot.item.scoreId ?? slot.item.listPath ?? slot.note} slot={slot} />)}
          </ol>
        )}
      <ol className="office-piece-picker__pages" aria-label="Browse">
        {browse.map((slot) => (
          <li key={slot.note} className="office-piece-picker__page" data-browse={slot.id} data-enabled={slot.enabled || undefined}>
            <KeyCard note={slot.note} extent={browseExtent} />
            <span className="office-piece-picker__page-text">
              <span className="office-piece-picker__page-note">{slot.noteName}</span>
              <span className="office-piece-picker__page-label">{slot.label}</span>
            </span>
          </li>
        ))}
        <li className="office-piece-picker__leave">Hold the lowest and highest keys to leave</li>
      </ol>
    </section>
  );
}
