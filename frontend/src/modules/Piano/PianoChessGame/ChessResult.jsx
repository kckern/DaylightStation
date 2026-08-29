import BoardGameResult from '../game-platform/host/BoardGameResult.jsx';
import { formatThink } from './chessClock.js';
import './ChessResult.scss';

/**
 * The end of the game, given a moment.
 *
 * A finished game used to change a sentence in a rail and add four rows of
 * tallies. Win, loss and draw looked identical apart from the words, and the
 * ladder — the thing that makes a child want to sit down again — advanced with
 * no acknowledgement at all.
 *
 * Deliberately an overlay rather than a new screen: the position that produced
 * the result stays visible behind it, which is the first thing anyone wants to
 * look at when a game ends.
 */

/**
 * Confetti, for a win only.
 *
 * Twenty sprites, each a plain div moved by `transform` and faded by `opacity`
 * — nothing else, because this runs on the kiosk's 2018 tablet and a particle
 * effect is exactly the kind of thing that turns a celebration into a stutter.
 * Positions and delays are derived from the index rather than randomised, so a
 * win looks the same every time and a test can pin it.
 */
const CONFETTI_COUNT = 20;

function Confetti() {
  return (
    <div className="chess-result__confetti" aria-hidden="true">
      {Array.from({ length: CONFETTI_COUNT }, (unused, index) => (
        <span
          key={index}
          className={`chess-result__flake chess-result__flake--${index % 3}`}
          style={{
            left: `${(index * 97) % 100}%`,
            animationDelay: `${(index % 7) * 60}ms`,
            // Two durations interleaved so the fall does not read as a grid.
            animationDuration: `${1400 + ((index % 4) * 220)}ms`,
          }}
        />
      ))}
    </div>
  );
}

/** The one line that says what actually happened on the board. */
function outcomeLine(outcome, result, opponentName) {
  if (outcome === 'checkmate') return result === 'win' ? `Checkmate — ${opponentName} is trapped.` : 'Checkmate.';
  if (outcome === 'stalemate') return 'Stalemate — no legal move, and no check.';
  if (outcome === 'insufficient_material') return 'Neither side has enough left to mate.';
  if (outcome === 'fifty_move_rule') return 'Fifty moves without a capture or a pawn move.';
  if (outcome === 'threefold_repetition') return 'The same position, three times over.';
  return 'Game over.';
}

export function ChessResult({
  result, outcome, opponent, level, record, timing = null, ladder = null, onPlayAgain,
}) {
  const name = opponent?.name || 'your opponent';
  const promoted = ladder?.promoted === true;

  const metrics = record ? [
    ['Moves', record.moves], ['Hints', record.help.hints],
    ['Best moves', record.help.best_moves], ['Takebacks', record.help.takebacks],
    ...(timing?.timed ? [['Your time', formatThink(timing.totalMs)]] : []),
  ] : null;
  return <BoardGameResult
    result={result}
    opponent={opponent}
    level={level}
    message={outcomeLine(outcome, result, name)}
    promoted={promoted}
    metrics={metrics}
    onPlayAgain={onPlayAgain}
    classPrefix="chess-result"
    decoration={result === 'win' ? <Confetti /> : null}
  />;
}

export default ChessResult;
