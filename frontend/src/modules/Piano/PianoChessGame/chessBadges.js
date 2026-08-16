import { squareToChord } from './chordAddress.js';
import { destinationsFor } from './chessGameState.js';

/**
 * The chord that sends the held piece to each square it can reach.
 *
 * Reading the rim and intersecting a file with a rank is too much work mid-game,
 * so the square says its own name. Empty when nothing is held: these are the
 * consequence of picking a piece up, not advice offered unasked — which is why
 * showing them is never charged to the game record.
 *
 * `destinations` may be passed by a caller that already has them. It matters on
 * the piano kiosk: deriving them here means another `new Chess(fen)` and a full
 * move generation, on a path that runs for every MIDI note event. Left out, the
 * behaviour is unchanged and the engine is consulted as before.
 */
export function destinationBadges(game, scheme, destinations = null) {
  if (!game?.origin) return {};
  const squares = destinations || destinationsFor(game, game.origin);
  const badges = {};
  for (const square of squares) {
    const chord = squareToChord(square, scheme);
    if (chord?.symbol) badges[square] = chord.symbol;
  }
  return badges;
}

export default { destinationBadges };
