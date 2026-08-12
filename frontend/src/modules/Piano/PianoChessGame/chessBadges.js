import { squareToChord } from './chordAddress.js';
import { destinationsFor } from './chessGameState.js';

/**
 * The chord that sends the held piece to each square it can reach.
 *
 * Reading the rim and intersecting a file with a rank is too much work mid-game,
 * so the square says its own name. Empty when nothing is held: these are the
 * consequence of picking a piece up, not advice offered unasked — which is why
 * showing them is never charged to the game record.
 */
export function destinationBadges(game, scheme) {
  if (!game?.origin) return {};
  const badges = {};
  for (const square of destinationsFor(game, game.origin)) {
    const chord = squareToChord(square, scheme);
    if (chord?.symbol) badges[square] = chord.symbol;
  }
  return badges;
}

export default { destinationBadges };
