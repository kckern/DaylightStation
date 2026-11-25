import Icon from '../../../../ui/icons/Icon.jsx';
import { useMemo } from 'react';
import { rimStaffExtent } from '../../../../../../../../__capabilities/music-notation/browser/renderers/RimStaffRenderer.jsx';
import { PIECE_NOTES, SHELF_NOTES, pickerGrid } from './officeKeys.js';
import KeyCard from './KeyCard.jsx';
import PassageCoin from '../PassageCoin.jsx';
import { usePrintedTitle } from '../../../desk/PianoHomeDesk.jsx';
import { cardBadge, pieceFocus, piecePolishing } from '../../../desk/deskModel.js';
import { shelfTitle } from './shelfTitle.js';

// One staff size for the whole list (C4 to C5), so every key's card matches.
const ROW_EXTENT = rimStaffExtent([...PIECE_NOTES, ...SHELF_NOTES]);
/** Up to this many passages a piece shows one coin each; past it, one coin and a count. */
export const MAP_MOST = 6;

/** The key that picks this card: its staff card, with the note name under it. */
const KeyTip = ({ slot }) => (
  <span className="office-piece-key__tip">
    <KeyCard note={slot.note} extent={ROW_EXTENT} />
    <span className="office-piece-key__note">{slot.noteName}</span>
  </span>
);

/** A fixed 2:3 box: a poster of any shape is cropped into it from the top, where covers print their titles. */
const Poster = ({ src }) => (
  <span className="office-piece-key__poster" data-empty={src ? undefined : ''} aria-hidden="true">
    {src ? <img src={src} alt="" decoding="async" /> : <Icon name="sheet-music" className="office-piece-key__stand-in" />}
  </span>
);

/**
 * Where a started piece stands, on one line: a coin per passage (the next one
 * ringed) when it has few enough to read from the bench, else the coin of the
 * level in play and how many passages carry it.
 */
function PieceProgress({ piece, level }) {
  const focus = piecePolishing(piece) ? null : pieceFocus(piece);
  if (piece.passages.length <= MAP_MOST) {
    return (
      <span className="office-piece-key__progress" data-coins="">
        {piece.passages.map((passage) => (
          <i key={passage.id} data-passage={passage.state} data-current={passage.id === focus?.id || undefined}>
            <PassageCoin state={passage.state} size="100%" />
          </i>
        ))}
      </span>
    );
  }
  const gold = level === 'gold' || level === 'diamond';
  const done = gold ? piece.gold : piece.silver;
  return (
    <span className="office-piece-key__progress" data-count="">
      <i><PassageCoin state={gold ? 'gold' : 'silver'} size="100%" /></i>
      <span className="office-piece-key__tally">{`${done ?? 0} of ${piece.total ?? piece.passages.length} ${gold ? 'Gold' : 'Bronze'}`}</span>
    </span>
  );
}

/**
 * One piece on its key: the key, the poster, the title, and on one line under
 * it the level badge and where the piece stands. A piece from the catalog the
 * player has not started says New.
 */
function PieceKey({ slot }) {
  const piece = slot.item;
  const title = shelfTitle(usePrintedTitle(piece.scoreId));
  const started = Array.isArray(piece.passages) && piece.passages.length > 0;
  const badge = started ? cardBadge({ piece }) : { level: 'new', label: 'New' };
  return (
    <li className="office-piece-key" data-score={piece.scoreId}>
      <KeyTip slot={slot} />
      <Poster src={piece.cover} />
      <span className="office-piece-key__text">
        <strong className="office-piece-key__title">{title}</strong>
        <span className="office-piece-key__status">
          <span className="office-piece-key__badge" data-level={badge.level}>{badge.label}</span>
          {started && <PieceProgress piece={piece} level={badge.level} />}
        </span>
      </span>
    </li>
  );
}

/** One shelf (a catalog collection) on its key: the key, its first cover, its name and how many pieces open here. */
function ShelfKey({ slot }) {
  const { count } = slot.item;
  return (
    <li className="office-piece-key office-piece-key--shelf" data-shelf={slot.item.label}>
      <KeyTip slot={slot} />
      <Poster src={slot.item.cover} />
      <span className="office-piece-key__text">
        <strong className="office-piece-key__title">{slot.item.label}</strong>
        <span className="office-piece-key__count">{count == null ? '' : count === 1 ? '1 piece' : `${count} pieces`}</span>
      </span>
    </li>
  );
}

/** A browse key in the footer: drawn when it does something now; otherwise its slot stays, empty. */
const BrowseKey = ({ slot, extent }) => (
  <li className="office-piece-picker__page" data-browse={slot.id} data-enabled={slot.enabled || undefined}>
    {slot.enabled && (
      <>
        <KeyCard note={slot.note} extent={extent} />
        <span className="office-piece-picker__page-text">
          <span className="office-piece-picker__page-note">{slot.noteName}</span>
          <span className="office-piece-picker__page-label">{slot.label}</span>
        </span>
      </>
    )}
  </li>
);

/**
 * The office screen's picker, drawn as keys because it is played, never tapped:
 * a list of pieces (six a page) or of shelves (eight) on the white keys from
 * middle C, laid in one column or two, and under it the browse keys — your
 * pieces ⇄ all music, Previous, Next — each fixed to its own key in the octave
 * below. A page key with nothing to do keeps its slot and is not drawn.
 */
export default function OfficePiecePicker({ title, status = null, notice = null, kind = 'pieces', slots = [], browse = [], page = null, hint = null }) {
  const Key = kind === 'shelves' ? ShelfKey : PieceKey;
  const browseExtent = useMemo(() => rimStaffExtent(browse.map((slot) => slot.note)), [browse]);
  const grid = pickerGrid(slots.length);
  const at = (id) => browse.find((slot) => slot.id === id);
  const pageCount = page && page.pageCount > 1 ? `${page.page + 1} of ${page.pageCount}` : '';
  return (
    <section className="office-piece-picker" aria-label={title} data-kind={kind}>
      <header className="office-piece-picker__head">
        <h2>{title}</h2>
        {notice && <p>{notice}</p>}
      </header>
      {status
        ? <p className="office-piece-picker__status" role="status">{status}</p>
        : (
          <ol className="office-piece-picker__keys" data-size={slots.length <= 2 ? 'large' : undefined}
            style={{ '--columns': String(grid.columns), '--rows': String(grid.rows) }}>
            {slots.map((slot) => <Key key={slot.item.scoreId ?? slot.item.listPath ?? slot.note} slot={slot} />)}
          </ol>
        )}
      <footer className="office-piece-picker__browse" aria-label="Browse">
        <ol className="office-piece-picker__pages">
          {at('switch') && <BrowseKey slot={at('switch')} extent={browseExtent} />}
          {at('previous') && <BrowseKey slot={at('previous')} extent={browseExtent} />}
          <li className="office-piece-picker__page-count" aria-live="polite">{pageCount}</li>
          {at('next') && <BrowseKey slot={at('next')} extent={browseExtent} />}
        </ol>
        {hint && <p className="office-piece-picker__hint">{hint}</p>}
      </footer>
    </section>
  );
}
