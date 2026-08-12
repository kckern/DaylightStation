/**
 * Chess core: rules, render projection, and artwork.
 *
 * Squares and moves, nothing else. It knows no music, no MIDI, no chords, and no
 * input device — those live with whatever is driving the board, so the piano
 * kiosk, a mouse, and an engine match can all share this without any of them
 * leaking into it.
 *
 * Deliberately not wired into the game reducer either. The core answers
 * questions about positions and moves; whatever gates a move — a practice rep, a
 * lesson step, an opponent — is a layer above this one.
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
