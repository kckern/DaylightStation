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

/**
 * `thinkMs`, when given, is the SAME floor opponentPacing.js is holding the
 * current reply for — not a decorative timing, the actual one. A strong
 * character broods visibly slower, not just for a flat 700ms, because the
 * pulse's own duration is that character's think time. Null (not currently
 * this character's turn) draws no pulse at all.
 */
/**
 * How the character should look right now.
 *
 * Reactions are derived from what actually happened on the board, never
 * scheduled or randomised — the same discipline `opponentStatus` follows. A
 * portrait that emotes on a timer is theatre, and a child stops reading it for
 * the same reason they stop reading a status that is sometimes invented.
 *
 * Separate from the thinking pulse and composable with it: the pulse says the
 * character is working, the mood says how the last move went for them.
 *
 * One reaction at a time, most consequential first: the game ending outranks a
 * check, which outranks a capture either way. `thinking` is accepted so a
 * caller without a `thinkMs` can still say so.
 */
export function opponentMood({ thinking, gameOver, result, tookPiece, lostPiece, givingCheck }) {
  if (gameOver) {
    if (result === 'win') return 'beaten';
    return result === 'loss' ? 'triumphant' : 'neutral';
  }
  if (thinking) return 'thinking';
  if (givingCheck) return 'attacking';
  if (tookPiece) return 'pleased';
  if (lostPiece) return 'hurt';
  return 'neutral';
}

/**
 * What the character says, for the moods that are worth a word.
 *
 * Driven by the SAME derived mood as the animation, so a line can never
 * contradict the face — and only for moods that have something to say. Silence
 * is the default: a character that comments on every move stops being read, the
 * same way an always-on status line does.
 *
 * Keyed by mood rather than written per character, because the roster is data:
 * twenty-one entries in YAML cannot each carry dialogue, and a line that only
 * some characters had would read as a bug.
 */
const MOOD_LINES = Object.freeze({
  pleased: 'Thank you.',
  hurt: 'Ow.',
  attacking: 'Check!',
  triumphant: 'Good game.',
  beaten: 'You got me.',
});

export function opponentLine(mood) {
  return MOOD_LINES[mood] ?? null;
}

export function OpponentPortrait({
  opponent, level, size = 'md', status = null, thinkMs = null, mood = null,
}) {
  const name = opponent?.name || `Level ${level ?? 0}`;
  const pulsing = Number.isFinite(thinkMs) && thinkMs > 0;
  return (
    <figure
      className={[
        'chess-opponent',
        `chess-opponent--${size}`,
        pulsing && 'chess-opponent--thinking',
        // `thinking` is the pulse; the mood is the reaction. Both may apply —
        // a character can be brooding AND have just lost a piece.
        mood && mood !== 'neutral' && mood !== 'thinking' && `chess-opponent--${mood}`,
      ].filter(Boolean).join(' ')}
      style={pulsing ? { '--pc-think-ms': `${thinkMs}ms` } : undefined}
    >
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
        {/* The character speaking. Below the status rather than replacing it:
            the status is what they DID, this is what they think of it. */}
        {opponentLine(mood) && (
          <span className="chess-opponent__says" key={`${mood}-${status}`}>{opponentLine(mood)}</span>
        )}
      </figcaption>
    </figure>
  );
}

export default OpponentPortrait;
