import usePianoList from '../usePianoList.js';
import { PieceCount, usePrintedTitle } from './PianoHomeDesk.jsx';
import { pieceFocus } from './deskModel.js';

const players = (response) => (Array.isArray(response?.players) ? response.players : []);

/**
 * The current child's latest piece, beside an owed lesson: its poster, a play
 * disc and its Silver count. One tap opens the piece at its next passage.
 * Renders nothing when the child has no piece in progress.
 */
export default function LatestPieceCard({ userId, disabled, onOpen }) {
  const { data } = usePianoList('api/v1/piano/activity/desk', players, { alwaysRevalidate: true });
  const piece = (data ?? []).find((player) => player.userId === userId)?.piece ?? null;
  const title = usePrintedTitle(piece?.scoreId ?? null);
  if (!piece) return null;
  const focus = pieceFocus(piece);
  return (
    <button type="button" className="piano-latest-piece" disabled={disabled} aria-label={`Play ${title}`}
      onClick={() => onOpen?.(piece.scoreId, focus?.id ?? null)}>
      <span className="piano-latest-piece__top">
        {piece.cover
          ? <img className="piano-latest-piece__poster" src={piece.cover} alt="" decoding="async" />
          : <span className="piano-latest-piece__poster piano-latest-piece__poster--none" aria-hidden="true" />}
        <span className="piano-latest-piece__side">
          <span className="piano-latest-piece__play" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
          </span>
          <PieceCount piece={piece} />
        </span>
      </span>
      <strong className="piano-latest-piece__title">{title}</strong>
    </button>
  );
}
