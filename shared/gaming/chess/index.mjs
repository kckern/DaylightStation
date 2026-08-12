/**
 * Chess core: rules, render projection, artwork, and chord addressing.
 *
 * Deliberately not wired into the game reducer. The core answers questions about
 * positions and moves; whatever gates a move — a practice rep, a lesson step, an
 * engine opponent, a mouse — is a layer above this one.
 *
 * Exports are explicit because `isPieceCode` has a home in both `pieces` (where
 * it guards artwork lookups) and `position` (where it guards the board map);
 * a star re-export would drop the name silently.
 */

export {
  INITIAL_FEN,
  applyMove,
  attackersOf,
  createGame,
  describeGame,
  describePosition,
  gameFromPgn,
  gameToPgn,
  isPromotion,
  isValidFen,
  legalDestinations,
  legalMoves,
  playMove,
  undoMove,
} from './engine.mjs';

export {
  FILES,
  RANKS,
  SQUARES,
  countMaterial,
  diffPositions,
  fenToPosition,
  isSquare,
  orderedSquares,
  positionToFen,
  squareColor,
  squareDistance,
} from './position.mjs';

export {
  BACKGROUNDS,
  COLOR_VARIANTS,
  PIECE_CODES,
  PIECE_NAMES,
  isPieceCode,
  parsePieceCode,
  pieceAssetFilename,
  pieceAssetId,
  resolvePieceAsset,
  resolvePieceTheme,
  toPieceCode,
} from './pieces.mjs';

export {
  CHORD_QUALITIES,
  DEFAULT_CHORD_SCHEME,
  chordBoard,
  chordPitchClasses,
  chordSymbol,
  chordToSquare,
  findChordCollisions,
  identifyChord,
  moveToChordPair,
  rootPitchClass,
  shuffleChordScheme,
  squareToChord,
  validateChordScheme,
} from './chordAddress.mjs';
