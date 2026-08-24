import { describeLevel } from '@shared-gaming/rulesets/chess/ladder.mjs';
import { cardIdenticonCells, GRID_SIZE } from '../../Gaming/experiences/card-battle/cardIdenticonModel.js';
import GameSheet from '../game-platform/chrome/GameSheet.jsx';
import './OpponentRoster.scss';

/**
 * The whole ladder, past and future.
 *
 * A climb you cannot see is not a climb. This shows who has been beaten, who is
 * being faced now, and who is still ahead — and the ones ahead are NOT greyed
 * out. Greying them says "not for you"; showing them with a word about what
 * they are like says "this is what you are working towards", which is the
 * entire point of arranging opponents in an order.
 *
 * Beaten characters stay visible because they can be played again. That is
 * practice, it earns nothing, and it is exactly what a child wants after a
 * hard loss.
 */

function Face({ opponent, size = 34 }) {
  if (opponent?.art) {
    return <img className="roster-face__art" src={opponent.art} alt="" loading="lazy" />;
  }
  // Each character's identicon wears that character's own colour — the same one
  // that tints the board when you face them. Twenty-one identical green stamps
  // told you nothing apart; this makes the roster scannable and ties the face to
  // the board you will be playing on.
  return (
    <svg
      className="roster-face__identicon"
      style={opponent?.theme ? { fill: opponent.theme } : undefined}
      viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`}
      width={size}
      height={size}
      aria-hidden="true"
    >
      {cardIdenticonCells(opponent?.name ?? '?').flatMap((row, r) => row.map((on, c) => (
        on ? <rect key={`${c}-${r}`} x={c + 0.08} y={r + 0.08} width="0.84" height="0.84" rx="0.16" /> : null
      )))}
    </svg>
  );
}

/**
 * The whole ladder as a modal, opened by pressing the opponent.
 *
 * It lives here rather than in the rail because it is a thing you go and LOOK
 * at — the sequence, who is behind you, who is coming — not something you need
 * beside the board every turn. In the rail it crowded the read-outs and still
 * only had room for three of the twenty.
 */
export function OpponentRosterModal({ roster = [], unlockedThrough = 0, onClose }) {
  if (!roster.length) return null;
  return (
    <GameSheet title="Opponents" onClose={onClose} className="opponent-roster-modal">
      <ol className="opponent-roster-modal__list">
        {roster.map((opponent) => {
          const state = opponent.level < unlockedThrough ? 'beaten'
            : opponent.level === unlockedThrough ? 'current' : 'ahead';
          return (
            <li key={opponent.level} className={`opponent-roster-modal__row opponent-roster-modal__row--${state}`}>
              <span className="opponent-roster-modal__level">{opponent.level}</span>
              <span className={`roster-face roster-face--${state}`}><Face opponent={opponent} /></span>
              <span className="opponent-roster__wing-text">
                <span className="opponent-roster__name">{opponent.name}</span>
                <span className="opponent-roster__blurb">{describeLevel(opponent.level)}</span>
              </span>
              <span className="opponent-roster-modal__state">
                {state === 'beaten' ? 'Beaten' : state === 'current' ? 'Now' : 'Locked'}
              </span>
            </li>
          );
        })}
      </ol>
    </GameSheet>
  );
}

export function OpponentRoster({ roster = [], unlockedThrough = 0 }) {
  if (!roster.length) return null;
  const beaten = roster.slice(0, unlockedThrough);
  // The character being faced is NOT repeated here — the opponent panel above
  // is that, with a bigger face and a live status. This is the rest of the
  // ladder: what has been beaten, and what is still coming.
  const ahead = roster.slice(unlockedThrough + 1);

  return (
    <section className="opponent-roster">
      {beaten.length > 0 && (
        <>
          <h3 className="piano-chess__slot-label">Beaten — play again any time</h3>
          <ul className="opponent-roster__grid">
            {beaten.map((opponent) => (
              <li key={opponent.level} className="roster-face roster-face--beaten" title={`${opponent.name} — ${describeLevel(opponent.level)}`}>
                <Face opponent={opponent} />
              </li>
            ))}
          </ul>
        </>
      )}

      {ahead.length > 0 && (
        <>
          <h3 className="piano-chess__slot-label">Waiting in the wings</h3>
          <ul className="opponent-roster__wings">
            {ahead.slice(0, 3).map((opponent) => (
              <li key={opponent.level} className="opponent-roster__wing">
                <span className="roster-face roster-face--ahead"><Face opponent={opponent} size={28} /></span>
                <span className="opponent-roster__wing-text">
                  <span className="opponent-roster__name">{opponent.name}</span>
                  <span className="opponent-roster__blurb">{describeLevel(opponent.level)}</span>
                </span>
              </li>
            ))}
          </ul>
          {ahead.length > 3 && (
            <p className="opponent-roster__more">and {ahead.length - 3} more, up to {roster[roster.length - 1].name}</p>
          )}
        </>
      )}
    </section>
  );
}

export default OpponentRoster;
