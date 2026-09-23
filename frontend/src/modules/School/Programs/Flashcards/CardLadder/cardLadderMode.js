/**
 * The card ladder's enrollment mode. The server canonicalises on read, but a
 * pre-rename `policy.mode: 'word-ladder'` (2026-09-23) is still the same
 * engine, so the client accepts it too rather than silently falling back to
 * the FSRS flashcard program.
 */
export const CARD_LADDER_MODE = 'card-ladder';
const MODE_ALIASES = Object.freeze(['word-ladder']);

export function isCardLadderMode(mode) {
  return mode === CARD_LADDER_MODE || MODE_ALIASES.includes(mode);
}

export function isCardLadderPolicy(policy) {
  return isCardLadderMode(policy?.mode);
}
