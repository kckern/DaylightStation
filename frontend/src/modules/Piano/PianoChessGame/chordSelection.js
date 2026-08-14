/**
 * Naming a square and committing to it are different acts.
 *
 * In a game where every square is a chord, a player has to be able to try a
 * chord and see where it lands. So one play HOVERS — it lights the square and
 * commits nothing — and the same square played twice in a row picks the piece
 * up. Every action happens on full release: a preview is feedback about an
 * in-progress chord, never intent. Dropping needs only one play, because a held
 * piece can reach a handful of lit, labelled squares and intent is already
 * declared.
 *
 * This module knows nothing about chess: the caller says whether a piece is in
 * hand and whether the square is a legal destination.
 */

/**
 * How long after the first release the second chord may be RELEASED.
 *
 * Deliberately generous, and not a reaction-time test. It has to cover reading
 * the prompt that asks for the repeat in the first place — the logged misses
 * that prompted this value were players pausing to read, at ~2.1s and ~2.9s,
 * not players fumbling a fast repeat.
 *
 * The cost of generosity is bounded: a false double needs the SAME square
 * played twice with nothing in between, it only lifts a piece (never moves
 * one), and the escape gesture puts it back.
 */
export const DOUBLE_WINDOW_MS = 2500;

export function createSelection() {
  return { lastSquare: null, lastAt: 0 };
}

export function applyEvent(selection, { type, square, at, holdingPiece = false, isEligible = false }) {
  if (type === 'preview') {
    return { selection, action: { type: 'none' } };
  }

  // An unrecognised chord is worth saying out loud when the player is choosing
  // a piece — but not while they explore with one already in hand.
  if (!square) {
    return {
      selection: createSelection(),
      action: holdingPiece ? { type: 'hover', square: null } : { type: 'refuse', square: null },
    };
  }

  if (holdingPiece) {
    if (isEligible) return { selection: createSelection(), action: { type: 'drop', square } };
    // Exploring is never punished: an unlit, unlabelled square already says no.
    return { selection: createSelection(), action: { type: 'hover', square } };
  }

  // Decide the repeat only now, after every note has been released. A triad
  // heard while the hand was still building a seventh was merely a preview and
  // can never lift the wrong piece.
  const isDouble = selection.lastSquare === square && at - selection.lastAt <= DOUBLE_WINDOW_MS;
  if (isDouble) {
    return { selection: createSelection(), action: { type: 'pickup', square } };
  }

  // Remember this release: the next release of the same square is a pick-up.
  return {
    selection: { ...createSelection(), lastSquare: square, lastAt: at },
    action: { type: 'hover', square },
  };
}

export default { createSelection, applyEvent, DOUBLE_WINDOW_MS };
