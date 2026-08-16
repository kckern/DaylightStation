import { useEffect, useState } from 'react';
import { clockState, formatClock } from './chessClock.js';
import './ChessClock.scss';

/**
 * Both sides' clocks, drawn beside the board.
 *
 * The model is pure and derived from move timestamps (see `chessClock.js`); the
 * only thing this component owns is "what time is it now", which it re-reads on
 * an interval so the running side's number moves.
 *
 * That interval is the reason the tick is one second and not a frame: this
 * screen re-renders on every MIDI note already, and a clock that drove its own
 * animation frame would add a standing render load to the weakest device in the
 * house for a digit that changes once a second. It also stops entirely when the
 * game does — a result screen has nothing left to count.
 */

const TICK_MS = 1000;

function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    // Read once on activation as well as on the interval, so switching turns
    // does not show a value up to a second stale.
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function ChessClock({ history, startedAt, turn, timing, gameOver = false, playerColor = 'w' }) {
  const now = useNow(!gameOver);
  const clock = clockState({ history, startedAt, now, turn, timing, gameOver });
  if (!clock.shown) return null;

  // The player's own clock sits at the bottom, the way it does on a real board
  // between two people: yours is the one nearest you.
  const order = playerColor === 'b' ? ['w', 'b'] : ['b', 'w'];

  return (
    <div className="chess-clock" aria-label="Clock">
      {order.map((color) => {
        const side = clock[color];
        const running = !gameOver && turn === color;
        const value = clock.mode === 'down' ? side.remainingMs : side.elapsedMs;
        return (
          <div
            key={color}
            className={[
              'chess-clock__side',
              running && 'chess-clock__side--running',
              side.flagged && 'chess-clock__side--flagged',
              color === playerColor && 'chess-clock__side--mine',
            ].filter(Boolean).join(' ')}
          >
            <span className="chess-clock__who">
              {color === playerColor ? 'You' : 'Them'}
            </span>
            <span className="chess-clock__time">{formatClock(value)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default ChessClock;
