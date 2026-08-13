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

/**
 * How long after the first release the second chord may be RECOGNISED.
 *
 * Deliberately generous, and not a reaction-time test. The window is charged
 * for time the player does not control: recognition costs a settle (see
 * DEFAULT_SETTLE_MS in chordCursor), so the fingers have the window MINUS the
 * settle to lift and re-press. It also has to cover reading the prompt that
 * asks for the repeat in the first place — the logged misses that prompted
 * this value were players pausing to read, at ~2.1s and ~2.9s, not players
 * fumbling a fast repeat.
 *
 * The cost of generosity is bounded: a false double needs the SAME square
 * played twice with nothing in between, it only lifts a piece (never moves
 * one), and the escape gesture puts it back.
 */
export const DOUBLE_WINDOW_MS = 2500;

export function createSelection() {
  return { lastSquare: null, lastAt: 0, swallowSquare: null };
}

export function applyEvent(selection, { type, square, at, holdingPiece = false, isEligible = false }) {
  const armedFor = selection.swallowSquare;

  // The release of the chord that just lifted a piece. Scoped to the exact
  // square the pick-up fired on: a bare boolean would eat ANY commit that
  // happened to land next, chord for a different square included. That is not
  // a corner case — it is ordinary legato, where the fingers move straight
  // from the picked-up chord into the next one without ever releasing to zero
  // notes, so the origin square's own release commit never arrives at all.
  if (armedFor !== null && type === 'commit' && square === armedFor) {
    return { selection: createSelection(), action: { type: 'swallowed' } };
  }

  // Any OTHER event un-arms a pending swallow rather than leaving it waiting
  // indefinitely for a release that, in true legato, may never come on its
  // own. The alternative — clearing only on the matching release — fails
  // worse: a lost or subsumed release would leave the flag armed forever,
  // silently eating an unrelated commit on that square at any point later in
  // the game. Clearing eagerly instead means the worst case is that the
  // origin's own release (if it ever does surface separately) falls through
  // to ordinary handling — typically a harmless hover, since the square a
  // piece just left is rarely itself an eligible destination.
  const base = armedFor !== null ? { ...selection, swallowSquare: null } : selection;

  if (type === 'preview') {
    // The pick-up fires HERE, on recognition, so the piece lifts under the
    // fingers that named it. The window runs from the previous chord's release
    // to this moment: a repeat needs no new fingering, and a player who then
    // holds this chord to study the board must not silently fail the double.
    if (holdingPiece || !square) return { selection: base, action: { type: 'none' } };
    const isDouble = base.lastSquare === square && at - base.lastAt <= DOUBLE_WINDOW_MS;
    if (!isDouble) return { selection: base, action: { type: 'none' } };
    return {
      selection: { ...createSelection(), swallowSquare: square },
      action: { type: 'pickup', square },
    };
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
