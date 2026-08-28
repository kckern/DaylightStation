// chessAddressingModel.js — addressing/vocabulary resolution for
// PianoChessGame.jsx, split out so Fast Refresh can hot-reload the game
// screen on its own.
import getLogger from '../../../lib/logging/Logger.js';
import { resolveAddressing } from '../game-platform/addressing/resolveAddressing.js';
import { schemeFor } from '../game-platform/addressing/buildScheme.js';
import { DEFAULT_CHORD_SCHEME } from './chordAddress.js';
import { isStaffScheme } from './staffAddress.js';

let cachedLogger;
function logger() {
  if (!cachedLogger) cachedLogger = getLogger().child({ component: 'piano-chess' });
  return cachedLogger;
}

/**
 * How loudly the board answers a mistake. Refusal loudness ONLY: legality
 * marks are not feedback but a gesture channel — they appear when the player
 * asks at the keys, never because a config said so.
 */
export const DEFAULT_FEEDBACK = Object.freeze({
  flashRejected: true,   // the refused square shakes and flares red
  toast: true,           // a sentence saying what was wrong
  sound: true,           // the board is audible: move, capture, refusal, check
});

/**
 * The addressing vocabulary, chosen by config rather than by code.
 *
 * `staff` is the reading level: a rank is a note on the bass staff, a file a
 * note on the treble staff, and a square is the two played together. It exists
 * for players who read both clefs long before they can spell a chord — which is
 * most beginners, for years — and it is the same 64 squares, so nothing else in
 * the game changes.
 */
export function chessAddressingFor(addressing, fallback = DEFAULT_CHORD_SCHEME, gameSeed = 0) {
  const stated = (addressing && typeof addressing === 'object') ? addressing : {};
  // The fallback carries what this game was already using, so a config that
  // says nothing about vocabulary keeps it rather than dropping to the house
  // default. Chess ships `chords`; the house floor is `staff`.
  const game = { vocabulary: isStaffScheme(fallback) ? 'staff' : 'chords', ...stated };

  const resolved = resolveAddressing({
    game,
    ladder: stated?.addressing?.ladder ?? null,
    axisSize: 8,
  });

  // The cadence is the RESOLVED one — config and ladder rung, through the same
  // layering as everything else — never read raw off the config, where a sparse
  // user file used to leave it undefined and the prop default (shuffle ON) won.
  //
  // `each_turn` re-deals per turn through chess's OWN machinery inside
  // `createChessGameState`, so the builder seeds at 0 — dealing here as well
  // would shuffle an already-shuffled board. `each_game` has no chess-side
  // machinery, so it IS dealt here, from the game's seed, which changes on
  // restart.
  const seed = resolved.shuffle === 'each_game' ? (Number(gameSeed) >>> 0) : 0;
  const shuffleEachTurn = resolved.shuffle === 'each_turn';
  const built = schemeFor(resolved, { size: 8, seed, fallback });
  if (!built.valid) {
    logger().warn('addressing.scheme-rejected', { errors: built.errors, source: built.source });
    return { scheme: fallback, shuffleEachTurn };
  }
  return { scheme: built.scheme, shuffleEachTurn };
}

/** The scheme alone, for callers with no stake in the cadence. */
export function schemeForAddressing(addressing, fallback = DEFAULT_CHORD_SCHEME) {
  return chessAddressingFor(addressing, fallback).scheme;
}

/** A chord takes three notes to name a square; a staff address takes two. */
export const minNotesFor = (scheme) => (isStaffScheme(scheme) ? 2 : 3);
