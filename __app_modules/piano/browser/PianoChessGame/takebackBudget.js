/**
 * What a takeback costs, and whether one may be played right now.
 *
 * Two different questions, deliberately kept apart. The CAP is what the player
 * feels at the keys — three a game, or a cooldown between them — and it is
 * answered here, on the kiosk, because it has to be answered instantly and
 * because getting it wrong costs nothing but a toast. The CEILING is whether a
 * game still counts toward beating the opponent being climbed, and that is
 * decided by the server's ladder, never here: `willStillCount` only predicts
 * it, so the card can warn honestly before the player spends one.
 *
 * Knows nothing about chess. The caller supplies the tallies.
 */

export const DEFAULT_TAKEBACK_LIMITS = Object.freeze({ max_per_game: 3, cooldown_moves: 0 });

/** The ladder's own default, mirrored so a card can warn before the ladder loads. */
const DEFAULT_MAX_TAKEBACKS = 1;

function wholeNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

export function takebackLimits(config) {
  const limits = config?.help?.takebacks || {};
  // `null` is a real answer here — "no cap" — and it must not be confused with
  // an absent key, which means "use the house default".
  const max = limits.max_per_game === null
    ? null
    : wholeNumber(limits.max_per_game, DEFAULT_TAKEBACK_LIMITS.max_per_game);
  return {
    max_per_game: max,
    cooldown_moves: wholeNumber(limits.cooldown_moves, DEFAULT_TAKEBACK_LIMITS.cooldown_moves),
  };
}

/**
 * @param {object}      args
 * @param {object}      args.config          merged chess config
 * @param {number}      args.used            takebacks already spent this game
 * @param {number|null} args.movesSinceLast  the player's own moves since the
 *   last takeback, or null when there has not been one yet
 */
export function checkTakeback({ config, used = 0, movesSinceLast = null }) {
  const limits = takebackLimits(config);
  const remaining = limits.max_per_game === null ? null : Math.max(0, limits.max_per_game - used);

  if (limits.max_per_game !== null && used >= limits.max_per_game) {
    return { allowed: false, reason: 'no_takebacks_left', remaining: 0, movesLeft: 0, limits };
  }
  if (limits.cooldown_moves > 0 && movesSinceLast !== null && movesSinceLast < limits.cooldown_moves) {
    return {
      allowed: false,
      reason: 'cooling_down',
      remaining,
      movesLeft: limits.cooldown_moves - movesSinceLast,
      limits,
    };
  }
  return { allowed: true, reason: null, remaining, movesLeft: 0, limits };
}

/**
 * Would the NEXT takeback leave this game still counting toward promotion?
 *
 * A prediction of the server's decision, used only to warn. The ladder is still
 * the authority, and it re-decides from the record when the game is filed.
 */
export function willStillCount({ policy, used = 0 }) {
  const ceiling = Number(policy?.max_takebacks ?? DEFAULT_MAX_TAKEBACKS);
  if (!Number.isFinite(ceiling)) return true;
  return used + 1 <= ceiling;
}

export function takebackRefusalMessage(check) {
  if (check?.reason === 'cooling_down') {
    const moves = Math.max(1, Number(check.movesLeft) || 1);
    return `You can take another move back in ${moves} ${moves === 1 ? 'move' : 'moves'}.`;
  }
  if (check?.reason === 'no_takebacks_left') return 'No takebacks left this game.';
  return 'You cannot take a move back right now.';
}

/**
 * The line under the gesture card. It has one job: let a player decide whether
 * to spend one BEFORE they do, which means the cost that actually matters —
 * the game no longer counting — has to outrank the number remaining.
 */
export function takebackNote({ check, willCount, opponentName = null }) {
  if (!check?.allowed) {
    return check?.reason === 'cooling_down' ? 'not yet' : 'none left';
  }
  if (!willCount && opponentName) return `won't count against ${opponentName}`;
  if (!willCount) return "won't count toward the climb";
  if (check.remaining === null) return 'as many as you like';
  return `${check.remaining} left`;
}

/** How many moves the player themselves has made — the unit the cooldown counts in. */
export function playerMoveCount(history, playerColor) {
  return (history || []).filter((entry) => entry?.color === playerColor).length;
}

export default {
  DEFAULT_TAKEBACK_LIMITS, takebackLimits, checkTakeback, willStillCount,
  takebackRefusalMessage, takebackNote, playerMoveCount,
};
