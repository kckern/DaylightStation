import { GameButton } from '../game-platform/chrome/index.js';
import './ChessResignSheet.scss';

/**
 * "Start a new game?" — the confirm step in front of giving a game up.
 *
 * Two buttons, no slider, nothing to drag: a yes and a no, both full tap
 * height. The keys answer too, and the card says how, because a child at the
 * piano is looking at the board, not reaching for the glass. The question is
 * asked over the position rather than instead of it — the board is the reason
 * anyone wants out, and it stays in view.
 *
 * Opaque card on a solid-edged frame, no scrim: translucent layers over the
 * board are the documented frame-cost trap on the kiosk tablet.
 */
export default function ChessResignSheet({ plies = 0, onConfirm, onCancel }) {
  const moves = Math.ceil(plies / 2);
  return (
    <div className="chess-resign">
      <div
        className="chess-resign__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chess-resign-title"
      >
        <h2 id="chess-resign-title" className="chess-resign__title">Start a new game?</h2>
        <p className="chess-resign__body">
          {moves > 0
            ? `This game stops here, after ${moves} ${moves === 1 ? 'move' : 'moves'}. It won't count as a win or a loss.`
            : "This game stops here. It won't count as a win or a loss."}
        </p>
        <div className="chess-resign__actions">
          <GameButton variant="primary" className="chess-resign__yes" onClick={onConfirm}>Yes, new game</GameButton>
          <GameButton variant="ghost" className="chess-resign__no" onClick={onCancel}>Keep playing</GameButton>
        </div>
        <p className="chess-resign__keys">
          At the piano: six keys in a row again for a new game, or an octave to keep playing.
        </p>
      </div>
    </div>
  );
}
