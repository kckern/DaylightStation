import { cardIdenticonCells, GRID_SIZE } from '../../Gaming/views/cardIdenticonModel.js';
import './OpponentPortrait.scss';

/**
 * The face of the character you are playing.
 *
 * A name and a face, because "Skill Level 7" is not something a child wants to
 * beat. The default face is an identicon generated from the name, so a roster
 * needs no artwork to be usable — and the same generator the card game uses, so
 * a given name always wears the same face across this house's games.
 *
 * A roster that DOES ship artwork (the Pokémon override) supplies `art`, and it
 * simply replaces the identicon. Nothing else about the ladder changes, which
 * is the point of keeping art out of the promotion arithmetic.
 */
/**
 * What the opponent is doing, in their own terms.
 *
 * Every state here is read off real game state — whose turn it is, what they
 * last played, what they lost doing it. Nothing is invented to fill the line,
 * because a status that is sometimes theatre is a status a child stops reading.
 */
export function opponentStatus({ thinking, lastMove, lastCapture, gameOver, result }) {
  if (gameOver) {
    if (result === 'win') return 'Beaten';
    if (result === 'loss') return 'Won';
    return 'Drew with you';
  }
  if (thinking) return 'Thinking…';
  if (lastCapture) return `Took your ${lastCapture}`;
  if (lastMove) return `Played ${lastMove}`;
  return 'Waiting for you';
}

export function OpponentPortrait({ opponent, level, size = 'md', status = null }) {
  const name = opponent?.name || `Level ${level ?? 0}`;
  return (
    <figure className={`chess-opponent chess-opponent--${size}`}>
      <div className="chess-opponent__face">
        {opponent?.art ? (
          <img className="chess-opponent__art" src={opponent.art} alt="" />
        ) : (
          <svg
            className="chess-opponent__identicon"
            viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`}
            aria-hidden="true"
            data-identicon={name}
          >
            {cardIdenticonCells(name).flatMap((row, rowIndex) => row.map((visible, columnIndex) => (
              visible ? (
                <rect
                  key={`${columnIndex}-${rowIndex}`}
                  x={columnIndex + 0.08}
                  y={rowIndex + 0.08}
                  width="0.84"
                  height="0.84"
                  rx="0.16"
                />
              ) : null
            )))}
          </svg>
        )}
      </div>
      <figcaption className="chess-opponent__text">
        <span className="chess-opponent__name">{name}</span>
        {status && <span className="chess-opponent__status">{status}</span>}
      </figcaption>
    </figure>
  );
}

export default OpponentPortrait;
