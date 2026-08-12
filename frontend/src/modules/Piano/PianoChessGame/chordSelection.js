/**
 * Naming a square and committing to it are different acts.
 *
 * In a game where every square is a chord, a player has to be able to try a
 * chord and see where it lands. So one play HOVERS — it lights the square and
 * commits nothing — and the same square played twice in a row picks the piece
 * up. Dropping needs only one play, because a held piece can reach a handful of
 * lit, labelled squares and intent is already declared.
 *
 * This module knows nothing about chess: the caller says whether a piece is in
 * hand and whether the square is a legal destination.
 */

/** How long after the first release the second chord may be RECOGNISED. */
export const DOUBLE_WINDOW_MS = 800;

export function createSelection() {
  return { lastSquare: null, lastAt: 0, swallowNextCommit: false };
}

export function applyEvent(selection, { type, square, at, holdingPiece = false, isEligible = false }) {
  if (type === 'preview') {
    // The pick-up fires HERE, on recognition, so the piece lifts under the
    // fingers that named it. The window runs from the previous chord's release
    // to this moment: a repeat needs no new fingering, and a player who then
    // holds this chord to study the board must not silently fail the double.
    if (holdingPiece || !square) return { selection, action: { type: 'none' } };
    const isDouble = selection.lastSquare === square && at - selection.lastAt <= DOUBLE_WINDOW_MS;
    if (!isDouble) return { selection, action: { type: 'none' } };
    return {
      selection: { ...createSelection(), swallowNextCommit: true },
      action: { type: 'pickup', square },
    };
  }

  // The release of the chord that just lifted a piece. It must not read as a
  // third hover on the square the piece has left.
  if (selection.swallowNextCommit) {
    return { selection: createSelection(), action: { type: 'swallowed' } };
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

  // Remember this release: the next recognition of the same square is a pick-up.
  return {
    selection: { ...createSelection(), lastSquare: square, lastAt: at },
    action: { type: 'hover', square },
  };
}

export default { createSelection, applyEvent, DOUBLE_WINDOW_MS };
